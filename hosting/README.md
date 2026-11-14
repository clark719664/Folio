# Isolated conversion gateway

This service exposes conversion only, with no app library or document storage API.
It accepts anonymous uploads from the exact public Folio origin, plus command-line
clients. CORS is not authentication. Do not put credentials in the frontend.

Install trusted distro packages `python3-venv bubblewrap util-linux libreoffice-writer
libreoffice-calc libreoffice-impress fonts-dejavu-core fonts-liberation`. Copy this
directory to `/opt/folio-converter`, create its `.venv`, install `requirements.txt`,
and create a dedicated system user/group `folio` with no home or login shell.
The service files and virtualenv should be root-owned and not writable by folio.
Install `folio-converter.service` in `/etc/systemd/system/`, reload systemd and
start it. Requires Python 3.11+ and working unprivileged user namespaces. A sandbox
failure never falls back to running LibreOffice directly. Keep distro security
updates enabled. Tunnel only `http://127.0.0.1:8091`, not the main app or SSH.

Run **one worker, one service instance**. The in-process gate admits one conversion
including upload and download, with at most three waiting requests and a 30-second
queue deadline. Waiting requests do not read or parse uploads. `/health` reports the gate,
not sandbox readiness. Proxy headers are disabled; requests from a loopback tunnel
share a three-per-minute rate limit by default. After proving the named Cloudflare
tunnel is the exclusive backend ingress, set `FOLIO_TRUST_CLOUDFLARE=1` in the unit
to use canonical `CF-Connecting-IP` for a per-visitor limit. This header is accepted
only from loopback peers; malformed or duplicate values fall back to the socket peer.
Do not enable this mode behind a proxy that preserves a caller-supplied header or
exposes this backend to untrusted local callers. `X-Forwarded-For` is never trusted.
Use `FOLIO_QA_ORIGIN=http://127.0.0.1:5173` only for an intentional local QA origin.

`POST /convert` expects multipart field `file`. Supported extensions come from
`GET /formats`. Successful responses are `application/pdf`, attachment
`converted.pdf`, with no-store headers. Errors are JSON `{"detail":"..."}`.
503 means busy or unavailable; 429 means rate limited. The frontend should explain
these states and let the person retry. A claimed extension is not a security
boundary: every document is processed only within the same isolation.

RAM must have at least 2 GiB available before accepting a job; CPU must measure
below 85% during a 250ms sample. Running jobs stop with 503 if free RAM falls below
2 GiB or the probe fails. CPU/IO run at normal priority; a separate trusted host
governor may temporarily reduce the systemd CPU quota under pressure. This service
does not change any other application's settings. The unit has a hard 2 GiB memory
ceiling and no swap. A malicious or difficult document may exhaust that ceiling
and restart the service. PrivateTmp is removed by systemd on service shutdown.

Uploads are bounded to 25 MiB with 64 KiB multipart overhead **before parsing**, and
have a 30s receive deadline. Conversion has a 90s deadline; response sending has a
60s deadline so a stalled client cannot retain the active slot indefinitely. Output has a 50 MiB
per-file OS limit and a 50 MiB aggregate monitor. Bubblewrap has no network, private
namespaces, no personal mounts, a read-only input, a writable job-only output, a
private tmpfs profile with macros disabled, and no shell invocation. Parent death
terminates the sandbox. Temp data is removed on normal completion, failure and
response cancellation; systemd removes the service private tmp on process death.
These are defense layers, not proof against all LibreOffice/kernel vulnerabilities.

Local unit tests (no real Office process):
`python -m pytest hosting/test_app.py -q` from the repository, with pytest/httpx installed.
Before public exposure, perform a real Linux conversion under the actual systemd
unit and verify its journal, cleanup, namespace isolation and resource governor.

## Cloudflare deployment

`cloudflare/` contains the small Workers gateway, deployed with `cf deploy`.
Its VPC service binding reaches only the converter on port 8091 through a named
outbound Cloudflare Tunnel. No router port forwarding or purchased domain is
required. The public endpoint is https://folio-converter.clark719664.workers.dev.
The gateway allows only health, formats and conversion routes, strips forwarding
and authorization headers, and rejects upstream redirects. Keep the account,
tunnel and VPC service identifiers in the config aligned when self-hosting.

Install `folio-tunnel.service` with the official cloudflared binary at
`/usr/local/bin/folio-cloudflared`. Store the tunnel token only in root-owned
`/etc/folio-converter/tunnel-token` (0600), loaded via systemd credentials.
Never commit tokens. Enable `FOLIO_TRUST_CLOUDFLARE=1` only under the conditions
above. The public Worker supplies Cloudflare's visitor IP for rate limiting.

Install `pressure-governor.py` and its systemd service alongside the converter.
Only the converter's CPU quota is changed: 50% under high CPU, 25% under memory
pressure, unlimited after recovery with hysteresis. Nice and IO priorities stay
normal. Other services are not reconfigured. This is a bounded single-machine
service, not unlimited capacity. Cloudflare plan limits and laptop availability
still apply. No paid plan was enabled for this deployment.
