# Folio

A free, open-source PDF workspace with a quiet interface and local document processing.

## Development

Requires Node.js 20.19+ and Python 3.11+.

1. Run `npm install` in this directory.
2. Install the Python dependencies with `python -m pip install -r server/requirements.txt`.
3. Start the local PDF service with `python -m uvicorn server.app:app --host 127.0.0.1 --port 8765`.
4. Run `npm run dev` and open http://127.0.0.1:4317.

Vite forwards `/api` to the local service. PDFs are processed by that service and stored under `server/data`, or the directory set by `FOLIO_DATA_DIR`.

## Development checkpoint

The current interface connects file opening, page rendering, text selection and replacement, highlights, notes, redaction, page rotation/reordering/deletion, merging, splitting, metadata, compression, encryption, and PDF/text/Word export. Undo and redo retain earlier document versions. The Tools panel also connects forms, bookmarks, images, links, attachments, OCR, text comparison, cropping, watermarking, Bates numbering, sanitization, and content exports. OCR requires a working local Tesseract installation with language data.

Text replacement currently uses Helvetica and supports Latin-1 text. The backend rejects replacements that do not fit their selected rectangle. Search covers every page, with results indexed as they load. Text selection handles rotated pages. Word export reconstructs extracted text and does not preserve the original layout.

The complete release target includes all paid Acrobat workflows. This development checkpoint has not reached that target. See the design and implementation documents under `docs` for the remaining work.

## Support

Folio is free to use. Optional donations support development.

[Donate via Cash App](https://cash.app/$ClarkLangloisII)

## License

AGPL-3.0-only. The full license text is in `LICENSE`. Third-party dependencies retain their respective licenses.
