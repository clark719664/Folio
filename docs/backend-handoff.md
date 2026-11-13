# Backend handoff

The user requires the entire Acrobat paid-feature equivalent scope in the FIRST release, with every feature free and all source open. Current code is a development build. Never relabel remaining inventory work as optional roadmap. Donation destination is https://cash.app/$ClarkLangloisII. Root owns deployment and dependency approvals. Frontend agent owns UI. Future backend workers own `server/` and must coordinate request/response changes with the frontend agent.

## Environment and execution

Workspace is `C:/Users/lil_c/Folio`. Python 3.14.5 virtual environment is `server/.venv`. Dependencies are installed, including PyMuPDF, FastAPI, pypdf, python-docx, openpyxl, python-pptx, Pillow and pyHanko 0.38.1. `server/requirements.txt` records ranges. Root should pin the resolved production environment before release.

Run from repository root with `server/.venv/Scripts/python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8765`. Running `python -m uvicorn app:app` from the server directory also works. Vite proxies `/api` to port 8765.

Root confirmed **25 tests passed** in the complete suite after the latest review/measurement increment. Run from server directory with `.venv/Scripts/python.exe -m pytest -q`. Windows sandbox blocks Python asyncio's socketpair initialization, causing HTTP and async certificate tests to hang before application work. Root successfully runs these tests with escalation. Do not wait indefinitely or repeatedly request dependency approvals. Send root the command and failure evidence. Direct tests that avoid event loops work in the sandbox.

The local LLM wrapper was absent and Ollama unavailable earlier in this session. Root authorized continuing directly. User requires targeted reads, no repeated whole-file reads and no large unfiltered output.

## Files and architecture

- `server/app.py` defines the FastAPI app, upload/revision store, validation helpers, base editing, rendering, export dispatch and route registration.
- `server/advanced.py` provides AcroForms, bookmarks, links, images, page production tools, sanitization, batch execution, comparison, collection search and SQLite FTS5 indexing.
- `server/exports.py` creates editable DOCX/PPTX and XLSX table extraction output.
- `server/signatures.py` signs incrementally with pyHanko and verifies offline with explicit certificate trust roots.
- `server/review.py` provides native PDF comment replies/resolution and calibrated measurement annotations/CSV.
- `server/API.md` is the precise integration contract. Read only the relevant section when implementing a feature.
- `server/test_app.py` tests HTTP upload/edit/download, immutable revision atomicity, pages, passwords, attachments, exports, forms, batches and comparison.
- `server/test_advanced.py` tests form persistence/flattening, validation, bookmarks/links/images and find-and-replace.
- `server/test_exports.py` tests Office editable structure/image geometry, numeric table cells, formula protection, crop, watermarks, Bates, sanitization, labels and headers/backgrounds.
- `server/test_extended.py` tests Unicode replacement, permissions, image movement/replacement, visual diff, indexed search and rich annotations.
- `server/test_signatures.py` generates ephemeral certificates and tests self-signed trust status, explicit roots, incremental multiple signatures, wrong password and cryptographic tampering.
- `server/test_review.py` tests geometry/calibration, saved measurement export, comment thread resolution and page moves.

Mutation operations open an immutable revision, edit it in memory and persist a NEW random 32-hex ID. Original revisions stay intact for undo. Document files use `server/data` by default, overridden by `FOLIO_DATA_DIR`. The store has `{id}.pdf` and `{id}.name`. Index search creates `search.sqlite3` containing extracted text in the same directory. Tests monkeypatch `app.ROOT` to a pytest temp directory, so test documents do not enter the normal store.

`persist()` rewrites/garbage-collects/deflates PDF objects. Signing deliberately bypasses this helper and writes the exact pyHanko incremental output, preserving prior signed bytes. Ordinary edits of signed revisions invalidate existing signatures and need explicit UI handling before release.

Coordinates throughout the API are unrotated page points relative to the crop box. Frontend handles page rotation for overlays. Text editing temporarily sets rotation to zero, removes original content, inserts replacement and restores rotation. Failed fit produces 422 without a new PDF. Latin-1 uses Helvetica; other scripts use HTML-escaped MuPDF shaping with bundled font fallback. Exact original-font matching remains incomplete.

## API map

Base prefix `/api`.

- Documents — multipart `POST /documents` with `file` and optional `password`; metadata `GET /documents/{id}`; file download `GET .../file`; rendering/text `GET .../pages/{index}/render` and `/text`.
- Base mutation — `POST .../edit` for text, redact, annotate, rotate, delete, reorder, metadata, attachment, encrypt, compress, OCR.
- Advanced mutation — `POST .../tools` for forms, bookmarks, links, images, find/replace, crop, watermarks, Bates, sanitization, labels, headers, footers, backgrounds and stamps.
- Collections — `POST /merge`, `POST .../split`, `POST /batch`, `POST /compare`, `POST /search`, `/index` and `/index/search`.
- Read/export — `.../forms`, `/forms/data`, `/bookmarks`, `/labels`, `/objects`, `/images` ZIP, `/attachments`, `/html`, `/export/{txt|docx|png|xlsx|pptx}`.
- Signing — `POST .../signatures` takes base64 PKCS12 plus password, field name and certification options; `POST .../signatures/verify` takes optional explicit PEM/base64-DER trust roots.
- Review — GET/POST `.../comments`, GET `/comments/summary`; GET/POST `.../measurements`, GET `/measurements/csv`.

## Important unresolved engineering constraints

This localhost service has no user authentication or hosted multi-user boundary. CORS accepts local Vite origins, but CORS alone is not an authorization mechanism. Upload is capped at 100 MB and rendering at 32 million pixels. Several JSON base64 paths and export operations need consistent byte/time/memory limits before public deployment. PyMuPDF concurrency needs isolation or comprehensive serialization; the current write lock does not serialize reads. Move heavy PDF processing into isolated worker processes before hosted deployment.

The store currently has no cleanup/retention API. Ordinary revision persistence can leave an orphan PDF if sidecar writing fails. Batch actions commit each successful file independently and report expected HTTP errors; unexpected engine errors still need consistent per-file recovery. Index queries refresh selected documents every time, so incremental indexing and deletion synchronization remain pending.

Current text replacement uses a white redaction fill and fallback fonts, so original background/font fidelity remains incomplete. Multi-line global replacement is rejected. Font substitution and unsupported glyphs need explicit UI behavior. Rich annotations exist, but ink, full stamp annotation semantics, import/export formats and annotation appearance compatibility need more coverage.

OCR requires external Tesseract in PATH. It was not installed/verified in this increment. OCR operates on image-only selected pages, rasterizes them and replaces those pages with searchable output. It can lose links/annotations and requires preservation work. DOCX is approximate block-flow reconstruction, PPTX lacks vectors/glyph rotation, and XLSX lacks merged-cell/multi-page recovery. Compression currently garbage-collects/deflates streams, without image optimization.

Image movement extracts image bytes and reinserts them, so masks, transforms and layering need stronger fidelity. Shared/repeated placement changes are rejected. Sanitization uses MuPDF scrub with explicit options; full forensic removal verification and all hidden-content cases remain pending. Cropping only changes visibility.

Certificate signing is real but invisible, offline, without timestamping, OCSP/CRL fetching or long-term validation. Trust defaults to an empty explicit root set. Valid cryptography is reported separately from identity trust. Key archives/passwords are held in memory and never deliberately stored. Memory zeroization is not guaranteed by Python. Multiple incremental signatures and tamper detection were tested.

Measurement polygons use shoelace area and require simple polygons; self-intersection detection, snapping and standard PDF Measure dictionaries are pending. Comment reply xrefs must be refreshed after every immutable revision because garbage collection can renumber objects. Resolution uses PDF Review/Accepted state. There is no shared-author identity or network synchronization yet.

## Recommended next independent priority

Implement **accessibility inspection and structure editing** in a new `server/accessibility.py`, leaving current mutation files untouched except registration. This is independently testable with local PDFs and avoids introducing a public collaboration service before its authentication/storage boundary exists.

1. Add `GET /documents/{id}/accessibility` reporting document language/title, MarkInfo, StructTreeRoot presence, a traversable structure tree, role mappings, alt text, table headers, form labels and reading-order issues. Mark heuristic findings and manual-review requirements explicitly. Never infer full conformance from tag presence.
2. Use pypdf low-level objects to implement immutable edits of language/title, existing element alternative text, existing role tags, and sibling reading order. Preserve ParentTree, MCID relationships, references and unrelated page content. Add an explicit API schema with stable element paths scoped to the current revision, not guessed xrefs from an earlier revision.
3. Create small valid tagged fixtures with heading, paragraph, image and table structure. Verify semantic changes using pypdf AND render before/after with MuPDF to confirm unchanged visible content. Test invalid element references and malformed structure with no partial revision.
4. Add a downloadable inspection report and frontend tree/issue list controls. Track full automatic tagging, remediation and independent PDF/UA validation as unfinished until implemented and validated.

After this, collaboration should be a separate service module with SQLite-backed identities, role grants, hashed access tokens, immutable revisions, optimistic concurrency and audit events. Write authorization tests before exposing shared IDs, then wire UI. Signature requests, mail delivery and external connectors need root-managed operational configuration. Existing local random document IDs must never become the sole hosted authorization control.
