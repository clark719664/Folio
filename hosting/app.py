"""Anonymous, bounded conversion gateway. Run one uvicorn worker on loopback only."""
import asyncio
from collections import OrderedDict, deque
import ipaddress
import os
from pathlib import Path
import shutil
import signal
import tempfile
import time

from fastapi import FastAPI, HTTPException, Request
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse

MIB = 1024 * 1024
MAX_FILE = 25 * MIB
MAX_BODY = MAX_FILE + 64 * 1024
MAX_OUTPUT = 50 * MIB
FORMATS = ('doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf')
PUBLIC_ORIGIN = 'https://folio-pdf.clark719664.chatgpt.site'
TRUST_CLOUDFLARE = os.environ.get('FOLIO_TRUST_CLOUDFLARE') == '1'
ORIGINS = [PUBLIC_ORIGIN]
qa_origin = os.environ.get('FOLIO_QA_ORIGIN', '')
if qa_origin:
    from urllib.parse import urlsplit
    parsed = urlsplit(qa_origin)
    if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1') or parsed.path or parsed.query or parsed.fragment:
        raise RuntimeError('FOLIO_QA_ORIGIN must be an exact localhost HTTP origin')
    ORIGINS.append(qa_origin)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])
busy = False
rates = OrderedDict()
waiting = deque()


async def acquire_job():
    global busy
    if not busy:
        busy = True
        return
    if len(waiting) >= 3:
        raise HTTPException(503, 'Conversion queue is full. Try again shortly.', headers={'Retry-After': '10'})
    ticket = asyncio.get_running_loop().create_future()
    waiting.append(ticket)
    try:
        await asyncio.wait_for(asyncio.shield(ticket), timeout=30)
    except BaseException as exc:
        if ticket in waiting:
            waiting.remove(ticket)
            ticket.cancel()
        elif ticket.done() and not ticket.cancelled():
            release_job()
        if isinstance(exc, TimeoutError):
            raise HTTPException(503, 'Conversion queue wait exceeded 30 seconds. Try again shortly.', headers={'Retry-After': '10'}) from exc
        raise


def release_job():
    global busy
    while waiting:
        ticket = waiting.popleft()
        if not ticket.done():
            ticket.set_result(None)
            return
    busy = False


def rate_limit(key):
    now = time.monotonic()
    recent = rates.pop(key, deque())
    while recent and recent[0] <= now - 60:
        recent.popleft()
    rates[key] = recent
    while len(rates) > 1024:
        rates.popitem(last=False)
    if len(recent) >= 3:
        raise HTTPException(429, 'Please wait a minute before converting again.', headers={'Retry-After': '60'})
    recent.append(now)


def client_rate_key(request):
    peer = request.client.host if request.client else 'unknown'
    if not TRUST_CLOUDFLARE:
        return peer
    try:
        if not ipaddress.ip_address(peer).is_loopback:
            return peer
        values = request.headers.getlist('cf-connecting-ip')
        if len(values) != 1 or '%' in values[0]:
            return peer
        address = ipaddress.ip_address(values[0])
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        return str(address)
    except ValueError:
        return peer


def memory_available():
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemAvailable:'):
            return int(line.split()[1]) * 1024
    raise RuntimeError('MemAvailable unavailable')


def cpu_sample():
    values = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
    if len(values) != 8:
        raise RuntimeError('CPU counters unavailable')
    return sum(values), values[3] + values[4]


def cpu_fraction(before, after):
    elapsed = after[0] - before[0]
    if elapsed <= 0:
        raise RuntimeError('CPU sample unavailable')
    return 1 - (after[1] - before[1]) / elapsed


async def check_resources():
    try:
        if memory_available() < 2 * 1024 * MIB:
            raise HTTPException(503, 'Computer is busy: less than 2 GB RAM available. Try again later.')
        first = cpu_sample()
        await asyncio.sleep(.25)
        if cpu_fraction(first, cpu_sample()) >= .85:
            raise HTTPException(503, 'Computer CPU is busy. Try again later.')
    except HTTPException:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        raise HTTPException(503, 'Resource monitoring unavailable; conversion paused.') from exc


def sandbox_command(job):
    bwrap = shutil.which('bwrap')
    prlimit = shutil.which('prlimit')
    if not bwrap or not prlimit or not Path('/usr/bin/libreoffice').is_file():
        raise HTTPException(503, 'Isolated converter unavailable.')
    cmd = [prlimit, f'--fsize={MAX_OUTPUT}', '--', bwrap,
           '--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
           '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/sbin', '/sbin']
    for directory in ('/lib', '/lib64'):
        if Path(directory).exists():
            cmd += ['--ro-bind', directory, directory]
    cmd += ['--dir', '/etc']
    for path in ('/etc/fonts', '/etc/libreoffice', '/etc/ld.so.cache'):
        if Path(path).exists():
            cmd += ['--ro-bind', path, path]
    cmd += ['--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
            '--dir', '/tmp/profile', '--dir', '/tmp/profile/user',
            '--ro-bind', str(job / 'profile.xcu'), '/tmp/profile/user/registrymodifications.xcu',
            '--ro-bind', str(job / 'input'), '/input', '--bind', str(job / 'output'), '/output',
            '--setenv', 'HOME', '/tmp', '--setenv', 'TMPDIR', '/tmp',
            '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8',
            '--chdir', '/tmp', '/usr/bin/libreoffice', '-env:UserInstallation=file:///tmp/profile',
            '--headless', '--nologo', '--nodefault', '--norestore', '--nofirststartwizard',
            '--convert-to', 'pdf', '--outdir', '/output', str(Path('/input') / next((job / 'input').iterdir()).name)]
    return cmd


PROFILE = '''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Jobs/Jobs/UpdateCheck/Arguments"><prop oor:name="AutoCheckEnabled" oor:op="fuse"><value>false</value></prop></item>
</oor:items>'''


def output_size(job):
    return sum(p.lstat().st_size for p in (job / 'output').rglob('*') if p.is_file())


async def kill_process(proc):
    if proc.returncode is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    await proc.wait()


async def run_converter(job):
    try:
        proc = await asyncio.create_subprocess_exec(*sandbox_command(job), stdout=asyncio.subprocess.DEVNULL,
                                                   stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
    except OSError as exc:
        raise HTTPException(503, 'Isolated converter unavailable.') from exc
    try:
        deadline = time.monotonic() + 90
        while proc.returncode is None:
            try:
                await asyncio.wait_for(proc.wait(), timeout=.5)
            except asyncio.TimeoutError:
                pass
            if time.monotonic() >= deadline:
                raise HTTPException(504, 'Conversion exceeded 90 seconds.')
            try:
                if memory_available() < 2 * 1024 * MIB:
                    raise HTTPException(503, 'Conversion stopped to preserve memory for other applications. Try later.')
            except (OSError, ValueError, RuntimeError) as exc:
                raise HTTPException(503, 'Resource monitoring unavailable; conversion stopped.') from exc
            if output_size(job) > MAX_OUTPUT:
                raise HTTPException(413, 'Converted output exceeds 50 MB.')
        if proc.returncode:
            raise HTTPException(422, 'Document could not be converted in isolation.')
    finally:
        await asyncio.shield(kill_process(proc))


class CleanFileResponse(FileResponse):
    def __init__(self, path, job):
        super().__init__(path, media_type='application/pdf', filename='converted.pdf', headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
        self.job = job

    async def __call__(self, scope, receive, send):
        global busy
        try:
            async with asyncio.timeout(60):
                await super().__call__(scope, receive, send)
        finally:
            shutil.rmtree(self.job, ignore_errors=True)
            release_job()


@app.get('/health')
async def health():
    return {'status': 'ok', 'busy': busy, 'waiting': len(waiting)}


@app.get('/formats')
async def formats():
    return {'extensions': list(FORMATS), 'max_file_bytes': MAX_FILE}


@app.post('/convert')
async def convert(request: Request):
    global busy
    origin = request.headers.get('origin')
    if origin and origin not in ORIGINS:
        raise HTTPException(403, 'Origin not allowed.')
    # Only an explicitly trusted loopback Cloudflare tunnel may supply visitor identity.
    rate_limit(client_rate_key(request))
    await acquire_job()
    job = None
    handed_off = False
    try:
        await check_resources()
        if not request.headers.get('content-type', '').lower().startswith('multipart/form-data;'):
            raise HTTPException(415, 'Expected multipart form with one file field.')
        try:
            if int(request.headers.get('content-length', '0')) > MAX_BODY:
                raise HTTPException(413, 'File exceeds 25 MB.')
        except ValueError:
            raise HTTPException(400, 'Invalid Content-Length.')
        body = bytearray()
        try:
            async with asyncio.timeout(30):
                async for chunk in request.stream():
                    if len(body) + len(chunk) > MAX_BODY:
                        raise HTTPException(413, 'File exceeds 25 MB.')
                    body.extend(chunk)
        except TimeoutError:
            raise HTTPException(408, 'Upload timed out.')
        # Parsing starts only after the actual streamed body has passed the hard bound.
        request._body = bytes(body)
        del body
        async with request.form(max_files=1, max_fields=0, max_part_size=MAX_FILE) as form:
            upload = form.get('file')
            if len(form) != 1 or not hasattr(upload, 'filename'):
                raise HTTPException(400, 'Provide exactly one file field.')
            extension = Path(upload.filename or '').suffix.lower().lstrip('.')
            if extension not in FORMATS:
                raise HTTPException(415, 'Unsupported document extension.')
            if not upload.size or upload.size > MAX_FILE:
                raise HTTPException(413, 'Document must be nonempty and at most 25 MB.')
            job = Path(tempfile.mkdtemp(prefix='folio-convert-'))
            (job / 'input').mkdir()
            (job / 'output').mkdir()
            (job / 'profile.xcu').write_text(PROFILE)
            with (job / 'input' / f'document.{extension}').open('wb') as target:
                while chunk := await upload.read(MIB):
                    target.write(chunk)
        await run_converter(job)
        pdf = job / 'output' / 'document.pdf'
        if pdf.is_symlink() or not pdf.is_file() or not (0 < pdf.stat().st_size <= MAX_OUTPUT):
            raise HTTPException(422, 'Converter did not produce a bounded PDF.')
        with pdf.open('rb') as result:
            if result.read(5) != b'%PDF-':
                raise HTTPException(422, 'Converter output was not a PDF.')
        response = CleanFileResponse(pdf, job)
        handed_off = True
        return response
    finally:
        if not handed_off:
            if job:
                shutil.rmtree(job, ignore_errors=True)
            release_job()
