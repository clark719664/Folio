# Folio

A free, open-source PDF workspace with a quiet interface and local document processing.

## Development

Requires Node.js 20.19+ and Python 3.11+.

1. Run `npm install` in this directory.
2. Create a virtual environment with `python -m venv server/.venv`. Install dependencies with `server/.venv/Scripts/python.exe -m pip install -r server/requirements.txt` on Windows, or `server/.venv/bin/python -m pip install -r server/requirements.txt` on macOS/Linux.
3. Start the local PDF service using that environment's Python with `-m uvicorn server.app:app --host 127.0.0.1 --port 8765`. On Windows, `./start.ps1` starts both the service and development interface after installation.
4. Run `npm run dev` and open http://127.0.0.1:4317.

Vite forwards `/api` to the local service. PDFs are processed by that service and stored under `server/data`, or the directory set by `FOLIO_DATA_DIR`.

## Development checkpoint

The interface opens local PDFs, renders and searches pages, edits existing text, inserts text and images, and saves document revisions with undo/redo. Page controls include rotation, reordering, deletion, merge, split, crop, headers, footers, backgrounds, watermarks, page labels and Bates numbering.

Tools include forms, bookmarks, links, attachments, rich markup, review threads, calibrated measurements, visual/text comparison, collection search, batch operations, compression, password permissions, sanitization and PDF/Word/Excel/PowerPoint/image/text/HTML exports. Certificate signing supports incremental signatures and offline verification with explicit trust roots. Drawn signatures are also available. Accessibility inspection and existing structure-tag editing retain explicit manual-review findings. OCR requires a local Tesseract installation and language data.

Print tools open the PDF in the browser's native print viewer and prepare multiple-page sheets or booklet layouts with configurable paper, margins, gutters, annotations and page ranges. Production tools inspect fonts/images, run configurable preflight checks, import/export profiles, edit page boxes and embed output ICC profiles. Embedding an output profile does not perform color conversion or certify a PDF standard.

Text replacement uses Helvetica for Latin-1 and fallback fonts with shaping for Unicode. Original font fidelity and complex paragraph reflow remain incomplete. Oversized replacements are rejected without changing the original revision. Office exports produce editable content, with remaining layout, vector, merged-table and rotation limitations. Certificate verification currently runs offline and does not establish revocation or timestamp status. Automated accessibility inspection covers a subset of checks and does not establish PDF/UA conformance. See `server/API.md` for precise operation limits.

The complete release target includes all paid Acrobat workflows. This development checkpoint has not reached that target. See the design and implementation documents under `docs` for the remaining work.

## Verification

`npm run build` typechecks and builds the interface. Run the backend tests with the virtual environment's Python and `-m pytest server -q`. Browser regression scripts under `tests/browser*.cjs` cover edits/export/reopen, forms, bookmarks, signatures, comments, measurements and accessibility. Their current Playwright/Chromium paths are specific to the development workstation and must be configured before running on another machine. Browser tests default to `http://127.0.0.1:4320`; set `FOLIO_URL` to the actual development server URL.

## Support

Folio is free to use. Optional donations support development.

[Donate via Cash App](https://cash.app/$ClarkLangloisII)

## License

AGPL-3.0-only. The full license text is in `LICENSE`. Third-party dependencies retain their respective licenses.

Appearance follows your system by default. Choose Light, Dark, or System in More actions > Appearance; the preference stays on this browser. PDF pages retain their original colors.

The local Library keeps document names, folders, favorites and immutable revision history. Reopen or restore an earlier revision; this browser also remembers the last document, page and zoom. Documents remain in the local service data directory.
