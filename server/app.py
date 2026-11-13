"""Local PDF processing. Every write creates a new immutable document revision."""
from __future__ import annotations

import base64
import io
import html
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
import zipfile
from pathlib import Path
from typing import Any

import pymupdf as fitz
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

try:
    from .library import PARENT_REVISION, document_name, record_revision, register as register_library
except ImportError:
    from library import PARENT_REVISION, document_name, record_revision, register as register_library

ROOT = Path(os.environ.get("FOLIO_DATA_DIR", Path(__file__).parent / "data")).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD = 100 * 1024 * 1024
LOCK = threading.RLock()
app = FastAPI(title="Folio PDF service", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=[
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:4173", "http://127.0.0.1:4173",
], allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Content-Type"])


class Edit(BaseModel):
    operation: str
    page: int = 0
    rect: list[float] | None = None
    text: str = ""
    fontSize: float = Field(default=12, gt=0, le=300)
    color: list[float] = Field(default_factory=lambda: [0, 0, 0])
    pages: list[int] = Field(default_factory=list)
    order: list[int] = Field(default_factory=list)
    angle: int = 90
    kind: str = "highlight"
    metadata: dict[str, str] = Field(default_factory=dict)
    name: str = "attachment.bin"
    content: str = ""
    password: str = ""
    ownerPassword: str = ""
    language: str = "eng"
    permissions: list[str] = Field(default_factory=lambda: ["print", "copy", "annotate", "fill", "modify", "assemble", "accessibility"])


class Merge(BaseModel):
    ids: list[str]


def location(document_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", document_id):
        raise HTTPException(404, "Document not found")
    path = ROOT / f"{document_id}.pdf"
    if not path.is_file():
        raise HTTPException(404, "Document not found")
    return path


def open_document(document_id: str) -> fitz.Document:
    doc = fitz.open(location(document_id))
    if doc.needs_pass:
        doc.close()
        raise HTTPException(423, "Reopen this encrypted file with its password")
    return doc


def describe(document_id: str, doc: fitz.Document, name: str | None = None) -> dict:
    name_file = ROOT / f"{document_id}.name"
    return {"id": document_id, "name": name or document_name(ROOT, document_id) or (name_file.read_text(encoding="utf-8") if name_file.exists() else "Document.pdf"),
            "pageCount": len(doc), "pages": [{"index": p.number, "width": p.cropbox.width,
            "height": p.cropbox.height, "rotation": p.rotation} for p in doc], "metadata": doc.metadata}


def persist(doc: fitz.Document, name: str = "Document.pdf", **options: Any) -> dict:
    document_id = uuid.uuid4().hex
    parent = PARENT_REVISION.get()
    if parent is None and doc.name:
        candidate = Path(doc.name).stem
        parent = candidate if re.fullmatch(r"[a-f0-9]{32}", candidate) and (ROOT / f"{candidate}.pdf").is_file() else None
    if parent:
        name = document_name(ROOT, parent) or name
    result = describe(document_id, doc, name)
    data = doc.tobytes(garbage=4, deflate=True, **options)
    temporary = ROOT / f"{document_id}.tmp"
    temporary.write_bytes(data)
    temporary.replace(ROOT / f"{document_id}.pdf")
    (ROOT / f"{document_id}.name").write_text(Path(name).name, encoding="utf-8")
    record_revision(ROOT, document_id, Path(name).name, parent)
    return result


def checked_page(doc: fitz.Document, index: int) -> fitz.Page:
    if index < 0 or index >= len(doc):
        raise HTTPException(422, "Page index is outside the document")
    return doc[index]


def checked_rect(page: fitz.Page, values: list[float] | None) -> fitz.Rect:
    import math
    if values is None or len(values) != 4 or not all(math.isfinite(v) for v in values):
        raise HTTPException(422, "A finite rectangle [x0,y0,x1,y1] is required")
    rect = fitz.Rect(values)
    bounds = fitz.Rect(0, 0, page.cropbox.width, page.cropbox.height)
    if rect.is_empty or rect.is_infinite or not bounds.contains(rect):
        raise HTTPException(422, "Rectangle must fit within the unrotated page")
    return rect


@app.get("/api/health")
def health():
    return {"status": "ok", "engine": "PyMuPDF", "ocr": bool(shutil.which("tesseract"))}


@app.post("/api/documents")
async def upload(file: UploadFile = File(...), password: str = Form(default="")):
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Maximum file size is 100 MB")
    try:
        with fitz.open(stream=data, filetype="pdf") as doc:
            if doc.needs_pass and not doc.authenticate(password):
                raise HTTPException(423, "Password required or incorrect")
            if not len(doc):
                raise HTTPException(422, "PDF has no pages")
            return persist(doc, file.filename or "Document.pdf")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, "Could not open this PDF") from exc


@app.get("/api/documents/{document_id}")
def document_info(document_id: str):
    with open_document(document_id) as doc:
        return describe(document_id, doc)


@app.get("/api/documents/{document_id}/file")
def download(document_id: str):
    path = location(document_id)
    return FileResponse(path, media_type="application/pdf", filename=document_name(ROOT, document_id) or "Document.pdf")


@app.get("/api/documents/{document_id}/pages/{index}/render")
def render(document_id: str, index: int, scale: float = 1.5):
    if not 0.1 <= scale <= 4:
        raise HTTPException(422, "Scale must be between 0.1 and 4")
    with open_document(document_id) as doc:
        page = checked_page(doc, index)
        if page.rect.width * page.rect.height * scale * scale > 32_000_000:
            raise HTTPException(422, "Choose a smaller rendering scale")
        return Response(page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).tobytes("png"), media_type="image/png")


@app.get("/api/documents/{document_id}/pages/{index}/text")
def page_text(document_id: str, index: int):
    with open_document(document_id) as doc:
        page = checked_page(doc, index)
        spans = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    spans.append({key: span[key] for key in ("text", "bbox", "font", "size", "color")})
        return {"page": index, "width": page.cropbox.width, "height": page.cropbox.height,
                "rotation": page.rotation, "spans": spans, "text": page.get_text()}


@app.post("/api/documents/{document_id}/edit")
def edit_document(document_id: str, edit: Edit):
    if len(edit.color) != 3 or not all(0 <= c <= 1 for c in edit.color):
        raise HTTPException(422, "Color must contain three values from 0 to 1")
    with LOCK, open_document(document_id) as doc:
        name = describe(document_id, doc)["name"]
        op = edit.operation
        if op in {"text", "redact", "annotate"}:
            page = checked_page(doc, edit.page)
            rect = checked_rect(page, edit.rect)
            original_rotation = page.rotation
            page.set_rotation(0)
            if op in {"text", "redact"}:
                page.add_redact_annot(rect, fill=(1, 1, 1) if op == "text" else tuple(edit.color))
                page.apply_redactions(images=0 if op == "text" else 2, graphics=0 if op == "text" else 1)
                if op == "text" and edit.text:
                    # Span boxes include ascenders and descenders; preserve the intended font size.
                    box = fitz.Rect(rect.x0, rect.y0, rect.x1,
                                    min(page.cropbox.height, max(rect.y1, rect.y0 + edit.fontSize * 1.8)))
                    if any(ord(c) > 255 for c in edit.text):
                        color = ",".join(str(round(value * 255)) for value in edit.color)
                        css = f"* {{ margin:0; padding:0; font-family:sans-serif; font-size:{edit.fontSize}pt; color:rgb({color}); }}"
                        remaining, _ = page.insert_htmlbox(box, "<div>" + html.escape(edit.text).replace("\n", "<br>") + "</div>", css=css, scale_low=1)
                    else:
                        remaining = page.insert_textbox(box, edit.text, fontsize=edit.fontSize, fontname="helv", color=tuple(edit.color))
                    if remaining < 0:
                        raise HTTPException(422, "Replacement text does not fit. Use a wider selection or smaller font")
            elif edit.kind == "highlight":
                annotation = page.add_highlight_annot(rect)
                annotation.set_colors(stroke=tuple(edit.color))
                annotation.update()
            elif edit.kind == "note":
                page.add_text_annot(rect.top_left, edit.text)
            elif edit.kind in {"underline", "strikeout", "squiggly", "rectangle", "circle"}:
                creators = {"underline": page.add_underline_annot, "strikeout": page.add_strikeout_annot,
                            "squiggly": page.add_squiggly_annot, "rectangle": page.add_rect_annot, "circle": page.add_circle_annot}
                annotation = creators[edit.kind](rect)
                annotation.set_colors(stroke=tuple(edit.color))
                annotation.set_info(content=edit.text)
                annotation.update()
            elif edit.kind == "text":
                page.add_freetext_annot(rect, edit.text, fontsize=edit.fontSize, text_color=tuple(edit.color))
            else:
                raise HTTPException(422, "Unknown annotation kind")
            page.set_rotation(original_rotation)
        elif op == "rotate":
            if edit.angle % 90:
                raise HTTPException(422, "Rotation must be a multiple of 90")
            for index in set(edit.pages):
                page = checked_page(doc, index)
                page.set_rotation((page.rotation + edit.angle) % 360)
        elif op == "delete":
            for index in edit.pages:
                checked_page(doc, index)
            if len(set(edit.pages)) >= len(doc):
                raise HTTPException(422, "Keep at least one page")
            for index in sorted(set(edit.pages), reverse=True):
                doc.delete_page(index)
        elif op == "reorder":
            if sorted(edit.order) != list(range(len(doc))):
                raise HTTPException(422, "Order must contain every page index exactly once")
            doc.select(edit.order)
        elif op == "metadata":
            allowed = {"title", "author", "subject", "keywords", "creator", "producer", "creationDate", "modDate", "trapped"}
            if not set(edit.metadata).issubset(allowed):
                raise HTTPException(422, "Unsupported metadata property")
            metadata = dict(doc.metadata)
            metadata.update(edit.metadata)
            doc.set_metadata(metadata)
        elif op == "attachment":
            if Path(edit.name).name != edit.name or len(edit.name) > 200:
                raise HTTPException(422, "Use a simple attachment filename")
            try:
                content = base64.b64decode(edit.content, validate=True)
            except ValueError as exc:
                raise HTTPException(422, "Attachment must be base64 encoded") from exc
            if len(content) > MAX_UPLOAD:
                raise HTTPException(413, "Attachment too large")
            doc.embfile_add(edit.name, content, filename=edit.name)
        elif op == "encrypt":
            if not edit.password:
                raise HTTPException(422, "A password is required")
            flags = {"print": fitz.PDF_PERM_PRINT, "copy": fitz.PDF_PERM_COPY, "annotate": fitz.PDF_PERM_ANNOTATE,
                     "fill": fitz.PDF_PERM_FORM, "modify": fitz.PDF_PERM_MODIFY, "assemble": fitz.PDF_PERM_ASSEMBLE,
                     "accessibility": fitz.PDF_PERM_ACCESSIBILITY}
            if not set(edit.permissions).issubset(flags):
                raise HTTPException(422, "Unknown permission")
            if len(edit.permissions) < len(flags) and (not edit.ownerPassword or edit.ownerPassword == edit.password):
                raise HTTPException(422, "Restricted permissions require a distinct owner password")
            return persist(doc, name, encryption=fitz.PDF_ENCRYPT_AES_256,
                           user_pw=edit.password, owner_pw=edit.ownerPassword or edit.password,
                           permissions=sum(flags[value] for value in set(edit.permissions)))
        elif op == "compress":
            pass  # persist performs resource garbage collection and stream deflation.
        elif op == "ocr":
            executable = shutil.which("tesseract")
            if not executable:
                raise HTTPException(503, "Install Tesseract and its language data to run OCR")
            if not re.fullmatch(r"[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*", edit.language):
                raise HTTPException(422, "Invalid OCR language")
            selected = sorted(set(edit.pages or range(len(doc))))
            for index in selected:
                checked_page(doc, index)
            with tempfile.TemporaryDirectory(prefix="folio-ocr-") as directory:
                for index in selected:
                    page = doc[index]
                    if page.get_text().strip():
                        raise HTTPException(422, "OCR currently accepts image-only pages. Select scanned pages")
                    source = Path(directory) / "scan.png"
                    output = Path(directory) / "recognized"
                    page.get_pixmap(dpi=200).save(source)
                    try:
                        subprocess.run([executable, str(source), str(output), "-l", edit.language, "pdf"],
                                       capture_output=True, check=True, timeout=180)
                    except subprocess.TimeoutExpired as exc:
                        raise HTTPException(504, "OCR timed out on this page") from exc
                    except subprocess.CalledProcessError as exc:
                        raise HTTPException(422, "OCR failed. Check the installed language data") from exc
                    with fitz.open(output.with_suffix(".pdf")) as recognized:
                        doc.insert_pdf(recognized, start_at=index)
                    doc.delete_page(index + 1)
        else:
            raise HTTPException(422, "Unknown editing operation")
        return persist(doc, name)


@app.post("/api/merge")
def merge_documents(request: Merge):
    if not 2 <= len(request.ids) <= 100:
        raise HTTPException(422, "Choose between 2 and 100 documents")
    with fitz.open() as merged:
        for document_id in request.ids:
            with open_document(document_id) as source:
                merged.insert_pdf(source)
        return persist(merged, "Combined.pdf")


@app.post("/api/documents/{document_id}/split")
def split_document(document_id: str):
    results = []
    with open_document(document_id) as doc:
        for index in range(len(doc)):
            with fitz.open() as part:
                part.insert_pdf(doc, from_page=index, to_page=index)
                results.append(persist(part, f"Page {index + 1}.pdf"))
    return {"documents": results}


@app.get("/api/documents/{document_id}/attachments")
def attachments(document_id: str):
    with open_document(document_id) as doc:
        return {"attachments": [doc.embfile_info(name) for name in doc.embfile_names()]}


@app.get("/api/documents/{document_id}/attachments/{name}")
def attachment(document_id: str, name: str):
    with open_document(document_id) as doc:
        if name not in doc.embfile_names():
            raise HTTPException(404, "Attachment not found")
        return Response(doc.embfile_get(name), media_type="application/octet-stream")


@app.get("/api/documents/{document_id}/export/{format}")
def export_document(document_id: str, format: str):
    with open_document(document_id) as doc:
        if format in {"docx", "xlsx", "pptx"}:
            if __package__:
                from .exports import office_response
            else:
                from exports import office_response
            return office_response(doc, format)
        if format == "txt":
            return Response("\n\f\n".join(page.get_text() for page in doc), media_type="text/plain")
        if format == "png":
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
                for page in doc:
                    archive.writestr(f"page-{page.number + 1}.png", page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).tobytes("png"))
            return Response(buffer.getvalue(), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="Pages.zip"'})
        raise HTTPException(422, "Supported exports are txt, docx and png")


if __package__:
    from .advanced import register
else:
    from advanced import register
register(app, open_document, persist, describe, checked_page, checked_rect, LOCK)

if __package__:
    from .signatures import register as register_signatures
else:
    from signatures import register as register_signatures
register_signatures(app, location, describe)

if __package__:
    from .review import register as register_review
else:
    from review import register as register_review
register_review(app, open_document, persist, describe, checked_page, checked_rect, LOCK)

try:
    from .accessibility import register as register_accessibility
except ImportError:
    from accessibility import register as register_accessibility
register_accessibility(app, location, open_document, describe, persist, LOCK)

try:
    from .production import register as register_production
except ImportError:
    from production import register as register_production
register_production(app, location, open_document, describe, persist, LOCK)

register_library(app, lambda: ROOT, location, open_document, describe, LOCK)
