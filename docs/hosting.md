# Hosted service

The container builds the frontend and serves it with FastAPI on port 8765. It includes LibreOffice, Tesseract English and open fonts. It runs as UID 10001. Persist `/data` on a volume writable by that UID; this contains PDFs, the library, account/session records and shared revisions. Back it up as sensitive application data. A single service process is required for the current in-process edit lock and conversion concurrency limit.

Required production settings:

- `FOLIO_PUBLIC=1` (container default): require authentication even before any account exists; force Secure session cookies.
- `FOLIO_ALLOWED_ORIGINS=https://your-domain.example`: exact public origin, comma-separated if necessary. This also authorizes its Host header. Serve API and frontend from the same HTTPS origin.
- `FOLIO_BOOTSTRAP_TOKEN`: a randomly generated secret of at least 32 characters, supplied through the hosting provider's secrets store, never a frontend variable. The first `/api/auth/signup` must carry this value in `X-Folio-Bootstrap`. After the owner exists, this header is no longer required; remove the secret from deployment settings. Ordinary signups have no local workspace privileges.
- `FOLIO_DATA_DIR=/data` and `FOLIO_STATIC_DIR=/app/dist` are container defaults.
- `FOLIO_CONVERSION_WORKERS=2` (1–4): native conversions allowed concurrently. Extra jobs receive an actionable busy error. LibreOffice jobs have a 90-second process timeout.

The first owner initializes the service using an HTTPS API request with `username`, `displayName` and a password of at least 10 characters in its JSON body. Keep the bootstrap header and password out of shell history/logs. Account creation is serialized so a simultaneous visitor cannot claim ownership without that secret. Until initialization, public local-file routes return 401 and signup without the secret returns 403. The desktop/local service uses `FOLIO_PUBLIC=0` and binds loopback.

Put an HTTPS reverse proxy in front of port 8765. Set a 200 MB body limit and an appropriate conversion request timeout, and apply per-IP request rate limits. Keep the application port private to that proxy. Use container memory/CPU/PID limits (for example 2 GB / 2 CPU / 256 PIDs), no privileged mode, no Docker socket, and no personal filesystem mounts. Grant outbound network only when operationally necessary. PDF/Office parsers are native code and are not individually sandboxed by the application.

Host checks use the actual Host header; configure the proxy to preserve the approved public host. The app forces Secure cookies in public mode, so direct HTTP public login will not work. `/api/health` is a public liveness endpoint. Missing API paths return JSON 404 and never the SPA document. Shared content stays behind per-request membership checks; the host owner alone has the local library/conversion workspace. This is a single hosted workspace with invited collaborators, not separate personal libraries for arbitrary accounts.

Docker image build and deployment require validation on the target Linux host. Windows native tests alone do not verify the container image.
