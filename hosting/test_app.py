import asyncio
from pathlib import Path
import sys

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import app as gateway


@pytest.fixture
def client(monkeypatch):
    gateway.busy = False
    gateway.rates.clear()
    gateway.waiting.clear()
    async def resources():
        pass
    monkeypatch.setattr(gateway, 'check_resources', resources)
    return TestClient(gateway.app)


def test_success_cleanup(client, monkeypatch):
    jobs = []
    async def convert(job):
        jobs.append(job)
        assert (job / 'input' / 'document.docx').read_bytes() == b'office'
        (job / 'output' / 'document.pdf').write_bytes(b'%PDF-1.4\nmock')
    monkeypatch.setattr(gateway, 'run_converter', convert)
    response = client.post('/convert', files={'file': ('../../private.docx', b'office')}, headers={'Origin': gateway.PUBLIC_ORIGIN})
    assert response.status_code == 200
    assert response.headers['access-control-allow-origin'] == gateway.PUBLIC_ORIGIN
    assert response.content.startswith(b'%PDF-')
    assert not jobs[0].exists()
    assert not gateway.busy


def test_failure_cleanup(client, monkeypatch):
    jobs = []
    async def convert(job):
        jobs.append(job)
        raise HTTPException(503, 'memory pressure')
    monkeypatch.setattr(gateway, 'run_converter', convert)
    assert client.post('/convert', files={'file': ('test.doc', b'x')}).status_code == 503
    assert not jobs[0].exists()
    assert not gateway.busy


def test_busy_origin_type_and_resource(client, monkeypatch):
    assert client.post('/convert', headers={'Origin': 'https://evil.example'}).status_code == 403
    gateway.busy = True
    gateway.waiting.extend([None, None, None])
    assert client.post('/convert').status_code == 503
    gateway.waiting.clear()
    gateway.busy = False
    assert client.post('/convert', files={'file': ('x.exe', b'x')}).status_code == 415
    gateway.rates.clear()
    async def reject():
        raise HTTPException(503, 'resource monitoring unavailable')
    monkeypatch.setattr(gateway, 'check_resources', reject)
    assert client.post('/convert', files={'file': ('x.doc', b'x')}).status_code == 503
    assert not gateway.busy


def test_real_stream_cap_without_length(client, monkeypatch):
    monkeypatch.setattr(gateway, 'MAX_BODY', 16)
    def chunks():
        yield b'x' * 10
        yield b'x' * 10
    response = client.post('/convert', content=chunks(), headers={'Content-Type': 'multipart/form-data; boundary=x'})
    assert response.status_code == 413
    assert not gateway.busy


def test_rate_does_not_trust_forwarded_ip(client):
    for i in range(3):
        assert client.post('/convert', headers={'X-Forwarded-For': str(i)}).status_code == 415
    assert client.post('/convert', headers={'X-Forwarded-For': 'other'}).status_code == 429
    for i in range(1100):
        gateway.rate_limit(str(i))
    assert len(gateway.rates) == 1024


def test_missing_resource_probe_fails_closed(monkeypatch):
    def absent():
        raise OSError('missing proc')
    monkeypatch.setattr(gateway, 'memory_available', absent)
    with pytest.raises(HTTPException) as err:
        asyncio.run(gateway.check_resources())
    assert err.value.status_code == 503


def test_sandbox_exact_mounts(tmp_path, monkeypatch):
    (tmp_path / 'input').mkdir()
    (tmp_path / 'input' / 'document.docx').write_bytes(b'x')
    monkeypatch.setattr(gateway.shutil, 'which', lambda name: '/usr/bin/' + name)
    original_isfile = Path.is_file
    monkeypatch.setattr(Path, 'is_file', lambda self: True if str(self).replace('\\', '/') == '/usr/bin/libreoffice' else original_isfile(self))
    cmd = gateway.sandbox_command(tmp_path)
    for flag in ('--unshare-all', '--die-with-parent', '--new-session', '--clearenv'):
        assert flag in cmd
    binds = [(cmd[i + 1], cmd[i + 2]) for i, arg in enumerate(cmd) if arg in ('--bind', '--ro-bind')]
    assert (str(tmp_path / 'input'), '/input') in binds
    assert (str(tmp_path / 'output'), '/output') in binds
    assert (str(tmp_path / 'profile.xcu'), '/tmp/profile/user/registrymodifications.xcu') in binds
    assert not any(source in ('/', '/home', '/root', '/run', '/mnt', '/etc') for source, target in binds)
    assert cmd.count('--bind') == 1
    assert cmd[0].endswith('prlimit')
    assert 'MacroSecurityLevel' in gateway.PROFILE


def test_missing_sandbox_fails_closed(monkeypatch):
    monkeypatch.setattr(gateway.shutil, 'which', lambda name: None)
    with pytest.raises(HTTPException) as err:
        gateway.sandbox_command(Path('unused'))
    assert err.value.status_code == 503


def test_memory_pressure_kills_process(tmp_path, monkeypatch):
    class Proc:
        returncode = None
        pid = 123456
        async def wait(self):
            self.returncode = 0
            return 0
    process = Proc()
    async def spawn(*args, **kwargs):
        return process
    killed = []
    async def kill(proc):
        killed.append(proc)
    monkeypatch.setattr(gateway, 'sandbox_command', lambda job: ['mock'])
    monkeypatch.setattr(gateway.asyncio, 'create_subprocess_exec', spawn)
    monkeypatch.setattr(gateway, 'kill_process', kill)
    monkeypatch.setattr(gateway, 'memory_available', lambda: 0)
    with pytest.raises(HTTPException) as err:
        asyncio.run(gateway.run_converter(tmp_path))
    assert err.value.status_code == 503
    assert killed == [process]


def test_five_concurrent_requests_bounded_queue(monkeypatch):
    import httpx
    gateway.busy = False
    gateway.waiting.clear()
    monkeypatch.setattr(gateway, 'rate_limit', lambda key: None)
    async def scenario():
        entered = asyncio.Event()
        finish = asyncio.Event()
        async def resources():
            pass
        async def convert(job):
            entered.set()
            await finish.wait()
            (job / 'output' / 'document.pdf').write_bytes(b'%PDF-1.4\nmock')
        monkeypatch.setattr(gateway, 'check_resources', resources)
        monkeypatch.setattr(gateway, 'run_converter', convert)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=gateway.app), base_url='http://test') as client:
            async def submit():
                return await client.post('/convert', files={'file': ('test.doc', b'x')})
            first = asyncio.create_task(submit())
            await asyncio.wait_for(entered.wait(), 3)
            queued = [asyncio.create_task(submit()) for _ in range(3)]
            for _ in range(100):
                if len(gateway.waiting) == 3:
                    break
                await asyncio.sleep(.01)
            assert len(gateway.waiting) == 3
            assert (await submit()).status_code == 503
            health = (await client.get('/health')).json()
            assert health['waiting'] == 3 and health['busy']
            finish.set()
            assert [r.status_code for r in await asyncio.gather(first, *queued)] == [200] * 4
        assert not gateway.busy and not gateway.waiting
    asyncio.run(scenario())


@pytest.mark.parametrize('trusted,peer,header,expected', [
    (False, '127.0.0.1', '203.0.113.9', '127.0.0.1'),
    (True, '198.51.100.1', '203.0.113.9', '198.51.100.1'),
    (True, '127.0.0.1', '203.0.113.9', '203.0.113.9'),
    (True, '::1', '2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'),
    (False, '::1', '2001:db8::1', '::1'),
    (True, '2001:db8::5', '2001:db8::1', '2001:db8::5'),
    (True, '::1', '::ffff:203.0.113.9', '203.0.113.9'),
    (True, '127.0.0.1', '999.2.3.4', '127.0.0.1'),
    (True, '::1', '2001:db8:::1', '::1'),
    (True, '::1', 'fe80::1%attacker', '::1'),
    (True, '127.0.0.1', '203.0.113.9, 203.0.113.10', '127.0.0.1'),
])
def test_cloudflare_rate_identity(monkeypatch, trusted, peer, header, expected):
    from starlette.requests import Request
    monkeypatch.setattr(gateway, 'TRUST_CLOUDFLARE', trusted)
    request = Request({'type': 'http', 'client': (peer, 123), 'headers': [(b'cf-connecting-ip', header.encode()), (b'x-forwarded-for', b'1.2.3.4')]})
    assert gateway.client_rate_key(request) == expected


def test_cloudflare_duplicate_and_missing_header(monkeypatch):
    from starlette.requests import Request
    monkeypatch.setattr(gateway, 'TRUST_CLOUDFLARE', True)
    for headers in ([], [(b'cf-connecting-ip', b'1.2.3.4'), (b'cf-connecting-ip', b'5.6.7.8')]):
        request = Request({'type': 'http', 'client': ('127.0.0.1', 123), 'headers': headers})
        assert gateway.client_rate_key(request) == '127.0.0.1'
