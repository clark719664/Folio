# Local PDF API

Run `.venv/Scripts/python.exe -m uvicorn app:app --host 127.0.0.1 --port 8765` from this directory. Open `/docs` for the generated request schema. Tests use `python -m pytest -q`. Install requirements in a virtual environment.

All routes start with `/api`. Uploaded documents and immutable revisions live in `server/data`, overridable with `FOLIO_DATA_DIR`. IDs are random 32-character hexadecimal values. Indexes are zero-based. Rectangles and text spans use unrotated page coordinates in points, including for rotated pages. The UI must transform overlays when displaying rotation.

- `POST /documents` multipart `file` and optional `password`. Returns document metadata. Password failures return 423.
- `GET /documents/{id}` returns `{id,name,pageCount,pages:[{index,width,height,rotation}],metadata}`.
- `GET /documents/{id}/file` downloads the PDF.
- `GET /documents/{id}/pages/{index}/render?scale=1.5` returns PNG.
- `GET /documents/{id}/pages/{index}/text` returns `{page,width,height,rotation,text,spans:[{text,bbox,font,size,color}]}`.
- `POST /documents/{id}/edit` accepts the `Edit` schema and returns a new document revision. Originals remain available for undo.
- `POST /merge` accepts `{ids:[id,id]}`.
- `POST /documents/{id}/split` returns `{documents:[metadata,...]}` with one revision per page.
- `GET /documents/{id}/attachments` lists embedded files. Append `/{name}` to retrieve bytes.
- `GET /documents/{id}/export/{format}` supports `txt`, `docx` and `png` (ZIP).

Edit operations and fields

- `text` uses `page`, `rect`, `text`, `fontSize`, RGB `color` values in 0..1. Removes selected old text without painting over the page background, then inserts replacement. Reuses supported original base-14 or embedded fonts when they contain the required glyphs; otherwise uses a fallback. Overflow returns 422 and creates no revision.
- `redact` uses `page`, `rect`, `color`. Applies permanent content removal and stream cleanup.
- `annotate` uses `page`, `rect`, `kind` (`highlight`, `note`, `text`), `text`, `fontSize`, `color`.
- `rotate` uses `pages`, `angle` in multiples of 90.
- `delete` uses `pages`, retaining at least one page.
- `reorder` uses `order`, an exact permutation of all indexes.
- `metadata` uses a metadata property dictionary.
- `attachment` uses simple filename `name` and base64 `content`.
- `encrypt` uses `password`, optional `ownerPassword`. The result is locked. `POST /api/documents/{id}/unlock` with `{password}` creates an unlocked revision while retaining the encrypted original; incorrect passwords return 423.
- `compress` removes unreachable objects and deflates streams. It does not yet downsample images.
- `ocr` uses `pages` (empty means all) and `language` such as `eng` or `eng+fra`. Requires Tesseract, discovered through `FOLIO_TESSERACT`, PATH, or standard Windows install directories. Adds invisible searchable text to scans, preserving page appearance, annotations and links. Pages already containing text are skipped. Health reports readiness and available languages; install language data separately when needed.

DOCX export preserves styled editable text, embedded images, page sizes and approximate block spacing. Overlapping objects, multi-column layouts and table reconstruction remain limited. This service does not claim full Acrobat parity.

The server is intended for localhost. Shared documents require authentication and membership. After the first account is created, local workspace APIs require that account's session. Public hosting additionally requires TLS, operational request limits and separately isolated PDF processing. Host and Origin checks accept loopback defaults and explicitly configured `FOLIO_ALLOWED_ORIGINS`. Invalid IDs never resolve filesystem paths supplied by clients. Uploads are limited to 100 MB.

## Forms and advanced tools

`POST /api/documents/{id}/tools` returns a new immutable revision. Its operations are:

- `create_field` with `page`, `rect`, `name`, `label`, `kind` (`text`, `checkbox`, `dropdown`, `list`, `signature`), `value`, `choices`, `required`, `readOnly`, `fontSize`. Choice fields need two or more options. Names must be unique.
- `fill_forms` with `values`, a map of field names to string values or checkbox booleans. Unknown/read-only fields and invalid choices are rejected atomically.
- `flatten_forms` converts fields to permanent page content while preserving annotations.
- `bookmarks` with `bookmarks`, an array of `[level,title,destinationPage]` tuples. Destinations are 1-based; levels start at 1 and increase by at most one.
- `link` with `page`, `rect` and either `url` (HTTP/HTTPS/mailto) or zero-based `targetPage`.
- `image` with `page`, `rect`, base64 `content`; valid raster images up to 25 MB. Aspect ratio is preserved.
- `find_replace` with `find`, `replacement`, `fontSize`. Searches all pages and replaces matching single-line regions. Case-insensitive engine search, Helvetica Latin-1 replacement, overflow/multiline hits rejected. This remains a limited compatibility mode.

Read and export routes:

- `GET /api/documents/{id}/forms` returns `{fields:[{page,name,label,kind,value,rect,choices,flags}]}`.
- `GET /api/documents/{id}/forms/data` returns the name/value map as JSON.
- `GET /api/documents/{id}/bookmarks` returns `{bookmarks:[[level,title,page],...]}`.
- `GET /api/documents/{id}/images` downloads a ZIP of deduplicated original embedded images.
- `GET /api/documents/{id}/html` downloads escaped extracted text organized by page. Layout-preserving HTML remains pending.
- `POST /api/compare` with `{before:id,after:id}` returns `{mode:'text',beforePages,afterPages,differences:[{page,status,changes:[{kind,before:[lines],after:[lines]}]}]}`. This is textual comparison; image and vector changes are pending.
- `POST /api/batch` with `{ids:[id,...],actions:[toolRequest,...]}` returns `{results:[{source,document}|{source,error,status}]}`. Each file is atomic across all actions. A failed file produces no revision. Earlier successfully processed files remain available.

Advanced regression tests run with `python -m pytest test_advanced.py -q`. Five cases verify saved form values and flattening, validation failures, bookmark/link/image roundtrips, replacement content removal and unsafe-link rejection.

## Office exports and production tools

`GET /api/documents/{id}/export/xlsx` detects tables and writes one editable sheet per detected table. Numeric decimal values become number cells, leading-zero IDs stay strings, and formula-like text remains inert. Pages with no detected table export their text lines to a separate sheet. Merged-cell and cross-page table recovery remain pending.

`GET /api/documents/{id}/export/pptx` creates one slide per page with editable text runs, font/style/color and image placements. Mixed page sizes share the largest slide dimensions. Vector shapes and glyph rotation fidelity remain pending. DOCX export now includes styled text and images with approximate block spacing.

Additional `/tools` operations:

- `crop` with `pages` and `rect`, measured in current unrotated page coordinates. Empty pages means all pages. Cropping adjusts the viewing box and does not permanently remove outside content.
- `watermark` with `pages`, `text`, optional `rect`, `fontSize`, `opacity`. Defaults to a footer region.
- `bates` with `pages`, `prefix`, `start`, `digits`, optional `rect`, `fontSize`. Defaults to a footer region. Numbers increase in supplied page order.
- `sanitize` scrubs metadata, embedded/attached files, hidden text, JavaScript, pending redactions, comments' response information, thumbnails and XML metadata using MuPDF. Full forensic sanitization requires further coverage.
- `delete_link` with `page`, `xref`.
- `delete_image` with `page`, `xref`. Images shared across pages are rejected to avoid changing unrelated pages.

`GET /api/documents/{id}/objects` returns `{pages:[{page,links:[{xref,rect,url,targetPage}],images:[{xref,width,height,rects}]}]}` for selection and editing.

Run `python -m pytest test_exports.py -q` for Office structure, image geometry, table numeric typing, formula protection, cropping, watermarking, Bates numbering and metadata/attachment sanitization regression checks.

## Unicode, object editing and comparison

The `text` edit operation now accepts Unicode through MuPDF's HTML text shaping and bundled fallback fonts when Latin-1 cannot represent the text. User text is HTML-escaped before insertion. Chinese and Cyrillic export/reopen checks pass. Full script/font matching remains pending, and insufficient space returns 422 with no revision.

`annotate` additionally supports `underline`, `strikeout`, `squiggly`, `rectangle` and `circle`.

`encrypt` accepts `permissions`, a list containing any of `print`, `copy`, `annotate`, `fill`, `modify`, `assemble`, `accessibility`. Restricting permissions requires a distinct `ownerPassword`. These PDF permission flags depend on the viewer honoring them.

`/tools` additionally supports `replace_image` with `page`, `xref`, base64 `content`, and `move_image` with `page`, `xref`, target `rect`. Replacement retains existing image placement geometry. Move stretches the extracted image into the target rectangle. Shared/repeated placements are rejected to preserve unrelated content. Soft-mask/transparency fidelity for moved images remains pending.

`POST /api/compare` accepts `mode: 'visual'` to compare rendered pixels at 72 DPI. Changed pages return `bbox` and base64 `diffPng`. Added/removed pages return status. Visual comparison detects graphics changes that text comparison misses; subpixel differences and semantic matching of moved pages remain pending.

`POST /api/search` accepts `{ids:[...],query,matchCase:false}` and returns `{hits:[{id,page,rect,text}],truncated}` for text matches across documents.

`POST /api/index` accepts `{ids:[...],query:''}` and persists a local SQLite FTS5 page index. `POST /api/index/search` accepts `{ids:[...],query}` and returns ranked literal-phrase hits `{id,page,text}`. Selected IDs are refreshed before indexed search. Index files remain in the local document store and contain extracted document text.

## Certificates and page presentation

`POST /api/documents/{id}/signatures` accepts JSON `{pkcs12:base64,password,fieldName,reason,location,certify:false,allowedChanges:'forms'}`. It loads a PFX/P12 key archive in memory and returns a new revision containing an incremental SHA-256 signature. The private archive and password are never written by the service. `fieldName` must identify an empty signature field or a new unique field. `allowedChanges` accepts `none`, `forms`, or `annotations` for certification. Current generated signatures are invisible. Visible certificate appearance, timestamp authority integration and long-term validation are pending.

`POST /api/documents/{id}/signatures/verify` accepts `{trustRoots:[]}`. Optional roots are PEM certificates or base64 DER. Result contains `signatures` with `fieldName`, `signer`, `intact`, `valid`, `trusted`, `coverage`, `modificationLevel`, `certificationSatisfied`, `summary`. Verification uses explicit roots and offline mode. With no roots supplied, a mathematically valid self-signed certificate remains untrusted. The response explicitly reports `revocationChecked:false` and `timestampServiceUsed:false`. This does not establish real-world identity or current revocation status. Editing a signed revision through ordinary PDF rewrite operations can invalidate signatures; incremental signing preserves earlier signed bytes.

Additional `/tools` operations:

- `page_labels` with `labels:[{startpage:0,prefix:'',style:'D',firstpagenum:1}]`. Styles are decimal `D`, roman `r/R`, alphabetic `a/A`, or empty for prefix-only labels. Rule indexes increase. `GET /api/documents/{id}/labels` returns `rules` and resolved page labels.
- `header` and `footer` with `text`, `pages`, optional `rect`, `fontSize`. `{page}` and `{pages}` expand to physical page number and count.
- `background` or `stamp` with base64 image `content`, `pages`, optional `rect`. Backgrounds render behind existing content; stamps render above it. These currently insert permanent image content, not editable PDF stamp annotations.

Certificate implementation follows [pyHanko signing documentation](https://docs.pyhanko.eu/en/latest/lib-guide/signing.html) and [explicit validation trust configuration](https://docs.pyhanko.eu/en/latest/lib-guide/validation/general-api.html). Run `test_signatures.py` to verify signing, trust handling, incremental multi-signature preservation and cryptographic tamper detection.

## Review threads and measurements

`GET /api/documents/{id}/comments` returns PDF annotations as `{comments:[{page,xref,type,rect,text,author,replyTo,resolved}]}`. IDs are PDF xrefs in the current revision and must be refreshed after mutation.

`POST /api/documents/{id}/comments` creates a new revision. Add with `{operation:'add',page,rect,text,author}`. Reply with `replyTo:xref` on the same page. Edit with `{operation:'edit',page,xref,text,author}`. Resolve/reopen with `{operation:'resolve',page,xref,resolved:true|false}`. Delete with `{operation:'delete',page,xref}` after deleting replies. Threads persist as native PDF reply relationships. Resolved status uses PDF Review/Accepted state. `GET .../comments/summary` downloads a plain-text review summary; the regular comments endpoint provides JSON export. These local PDF annotations are separate from authenticated shared discussion threads.

`POST /api/documents/{id}/measurements` accepts `{page,kind:'distance'|'perimeter'|'area',points:[[x,y],...],unitsPerPoint:1,unit:'pt',label:''}`. Distance uses exactly two points; perimeter/area use at least three. Perimeter closes the polygon. Area uses the absolute shoelace area; use simple non-self-intersecting polygons. Coordinates are unrotated page points. Calibration scales distance/perimeter linearly and area quadratically. Measurement marks are saved as PDF line/polygon annotations with Folio measurement metadata.

`GET .../measurements` returns stored measurements with value, unit, calibration, points and label. `GET .../measurements/csv` exports values with spreadsheet formula prefixes escaped. Snapping and interoperable PDF Measure dictionaries remain pending.

Text comparison now also returns `pageMoves:[{beforePage,afterPage}]` for uniquely identifiable exact-text page moves. Repeated identical pages and image-only moves remain ambiguous and are not reported as definitive moves.

## Accessibility inspection and existing structure editing

GET `/api/documents/{id}/accessibility` returns document `language`, `title`, `marked`, `tagged`, `roleMap`, `tree`, `issues`, `validation`, and `manualChecks`. Validation is explicitly `partial-automated-inspection`. No PDF/UA certification is implied.

Each tree node has `path` (revision-scoped child indices), `role`, `alt`, `actualText`, `language`, `children`, and `contentItems`. Paths include actual /K array indices, including marked-content items. Cycles and excessive depth/node counts produce findings. Missing figure alt text, document language/title, MarkInfo, and form tooltips produce findings. Reading order correctness, tables, heading hierarchy, contrast, alt accuracy and independent conformance remain manual checks.

POST the same endpoint returns a new document revision. Accepted bodies are `{operation:"document",language?,title?}`, `{operation:"element",path,role?,alt?,actualText?,language?}`, and `{operation:"reorder",path,order}`. Element paths must identify existing structure elements. Roles must be standard PDF 1.7 roles or present in the current RoleMap. Reordering requires every immediate /K child index once, including content children. Parent path `[]` refers to StructTreeRoot. ParentTree and MCID associations remain intact. Unsupported paths/orders fail before persistence. Reading order changes semantics only, leaving page drawing operations intact.

GET `/api/documents/{id}/accessibility/report` downloads the inspection as JSON. Untagged PDFs support title/language correction but require future tagging implementation before structure controls can be used. Existing signed PDFs are rewritten by these mutations and signatures require revalidation.

## Print production

GET `/documents/{id}/production` returns page boxes (points), rotation, referenced fonts and embedding status, image placements/colorspaces/bit depths and effective horizontal/vertical DPI. Image colorspace reporting does not inspect all vector color operators, separations or overprint.

POST `/documents/{id}/preflight` accepts a JSON profile `{name,rules}`. Rule kinds are `font-embedded`, `minimum-image-dpi` (`minimumDpi`), `allowed-image-colorspaces` (`allowedColorspaces`), `document-title`, `maximum-page-size` (`width`,`height`), and `page-boxes`. Response echoes the profile, actionable `findings` with rule index/page/xref as relevant, `passed` for configured rules, `scope:"configured-rules-only"`, `conformanceCertified:false`. Profiles can be exported/imported as this JSON schema. Full PDF/A, PDF/X and PDF/E validation requires an independent standards validator.

POST `/documents/{id}/boxes` accepts `{pages:[zeroBasedIndices],media?,crop?,bleed?,trim?,art?}`. Each supplied rectangle is four finite point coordinates. The operation returns a new revision and leaves drawing streams intact; box changes can alter visible clipping.

POST `/documents/{id}/output-intent` accepts `{profile:base64ICC,identifier,description?,subtype:"GTS_PDFX"|"GTS_PDFA1"}`. The ICC header and LittleCMS parser validate the supplied profile. A new revision contains the profile output intent. This declares intended color reproduction and can affect viewer color interpretation, while drawing streams stay intact. It does not convert existing colors or certify PDF conformance.

POST `/documents/{id}/impose` accepts `{mode:"nup"|"booklet",pages?,columns?,rows?,width?,height?,margin?,gutter?,rightToLeft?,borders?,includeAnnotations?}`. Defaults are two columns/two rows on 842x595pt sheets, 18pt margins and 12pt gutter. Booklet uses two-up front/back ordering with blank padding to a multiple of four. Response is a new PDF descriptor plus `sheets` containing zero-based original page indices and null blanks. Text and vectors remain printable PDF content. By default annotations and form appearances are baked into the imposed output; interactive fields/links are not transferred. Originals remain intact. Booklets need duplex printing with appropriate short-edge orientation, checked on the target printer.

GET `/documents/{id}/print-preview` serves the PDF inline for the browser's print workflow. Physical printer output and printer-specific orientation remain manual acceptance checks.

## Local library and revision recovery

GET `/api/library?query=&folder=&favorites=true` lists logical documents with `{id,documentId,name,folder,favorite,created,updated,revisionCount}`. `id` identifies the logical document and `documentId` is its latest immutable PDF revision. Timestamps are Unix seconds. Query matches names case-insensitively; folder is an exact logical label. Legacy UUID PDF files are discovered with their `.name` sidecars. Existing untracked versions have no reconstructable ancestry and are imported as separate documents.

PATCH `/api/library/{revisionId}` accepts `{name?,folder?,favorite?}` and updates the logical document across all revisions. The document read and download routes use this canonical filename. GET `/api/documents/{id}/history` returns newest-first `{revisions:[{id,parentId,created,restoredFrom}]}`. POST `/api/documents/{historicId}/restore` copies the exact historic PDF bytes to a new revision, preserving old files, with the latest revision as parent and the chosen historical ID as `restoredFrom`.

PUT `/api/library-recovery/{client}` accepts `{documentId,page,zoom}` and GET returns `{state:null|{documentId,page,zoom,updated}}`. Client keys use 1–80 ASCII letters/digits/underscore/hyphen. Recovery metadata survives process restarts. Document IDs, page indices and zoom bounds are validated. This recovers saved PDF revisions and viewing position; unsaved editor keystrokes require frontend draft persistence.

SQLite `library.sqlite3` uses WAL, foreign keys, a 30-second busy timeout and transactional writes. Initial schema version is 1. Normal persistence records source ancestry from the opened document and request context; incremental certificate signing records ancestry explicitly. Multi-source merges currently establish new logical documents; provenance for all merge inputs is pending. Operations creating branches keep all revisions and choose the latest committed one for library listing. Recovery can discover completed PDFs after an interrupted metadata write, but their missing ancestry cannot be inferred. No file deletion or retention policy is applied.

## Shared workspace

Accounts and shared revision bytes persist in `shared/shared.sqlite3`, separate from local UUID files. Passwords use scrypt; session and invitation tokens are stored hashed. Browser sessions use HttpOnly SameSite=Strict cookies. Shared/auth responses disable caching. Missing Origin is permitted for native clients; browser Origins and request Hosts are checked. The first registered account owns the local workspace; other accounts can access only shared documents granted to them.

- `POST /api/auth/signup` `{username,password,displayName}`; `POST /api/auth/login` `{username,password}`; `GET /api/auth/me`: return `{user:{id,username,displayName,workspaceOwner}}`. Passwords require at least 10 characters. `POST /api/auth/logout` invalidates the current session.
- `GET /api/shared` lists accessible documents. `POST /api/shared` `{documentId,name?}` copies a local PDF into a shared document (workspace owner only).
- `GET /api/shared/{id}` returns `{id,name,version,role,document,comments,members}`. `document` has the usual PDF page descriptor. Comments include `id,author,text,page,created,resolved`; author is the authenticated display name. Only owners receive the member list (`id,displayName,role`).
- `GET /api/shared/{id}/file`, `/pages/{page}/render`, and `/pages/{page}/text` require membership for every request. No shared file is exposed through a local document ID.
- `POST /api/shared/{id}/edit` `{expectedVersion,edit}` accepts text, redact, annotate, rotate, reorder, delete and metadata operations using the existing edit schema. Editors and owners may edit; commenters may annotate; viewers may only read.
- `POST /api/shared/{id}/comments` `{expectedVersion,text,page}` requires commenter or higher. `PATCH /api/shared/{id}/comments/{commentId}` `{expectedVersion,resolved}` allows the author or an editor to resolve/reopen.
- Editing and commenting use an atomic version comparison. Stale submissions return 409 with `detail:{message,currentVersion}` and never overwrite newer content. Clients poll state to receive durable updates; this is action-level collaboration, not character-level simultaneous text merging.
- Owners create single-use, one-day invitations with `POST /api/shared/{id}/invites` `{role}` (`viewer`, `commenter`, `editor`), returning `{token,expires}`. `POST /api/shared/join` `{token}` redeems it. `GET /api/shared/{id}/invites` lists unused invitations; `DELETE /api/shared/{id}/invites/{inviteId}` cancels one. `DELETE /api/shared/{id}/members/{userId}` revokes membership immediately; the owner cannot be removed.
- `POST /api/shared/{id}/presence` `{page}` returns members seen within 60 seconds. Presence is informational; all writes still require permission and version checks.

Advanced local export and production tools remain local workspace operations. Shared discussion threads live in the collaboration database and are not embedded in downloaded PDF files. Public deployment is not configured by the local launcher.
