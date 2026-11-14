"""Local conversion with isolated Office profiles and resource-free HTML rendering."""
from __future__ import annotations

import html
import csv
import io
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
from typing import Annotated
from html.parser import HTMLParser

import fitz
from fastapi import File, Form, HTTPException, UploadFile
from PIL import Image, ImageOps, ImageSequence

IMAGES = {"png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp", "gif", "ico"}
REFLOW = {"epub", "xps", "oxps", "cbz", "svg"}
OFFICE = {"doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"}
TEXT = {"txt", "md", "markdown", "html", "htm", "csv", "tsv"}
MAX_BYTES = 100 * 1024 * 1024
CONVERSION_SLOTS = threading.BoundedSemaphore(max(1, min(4, int(os.environ.get("FOLIO_CONVERSION_WORKERS", "2")))))


def office_executable():
    candidates = [os.environ.get("FOLIO_LIBREOFFICE"), shutil.which("soffice"), shutil.which("libreoffice")]
    for root in [os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)")]:
        if root:
            candidates.append(str(Path(root) / "LibreOffice/program/soffice.exe"))
    return next((value for value in candidates if value and Path(value).is_file()), None)


class SafeHTML(HTMLParser):
    allowed = {"p", "div", "span", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "b", "strong", "i", "em", "u", "s", "pre", "code", "blockquote", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "sup", "sub"}
    blocked = {"script", "style", "iframe", "object", "svg", "math", "head"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.blocked:
            self.hidden += 1
        if not self.hidden and tag in self.allowed:
            self.parts.append(f"<{tag}>")

    def handle_endtag(self, tag):
        if tag in self.blocked:
            self.hidden = max(0, self.hidden - 1)
        elif not self.hidden and tag in self.allowed:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(html.escape(data))


def text_html(data, extension):
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("Save text as UTF-8 before converting.") from error
    if extension in {"csv", "tsv"}:
        rows = csv.reader(io.StringIO(text, newline=""), delimiter="\t" if extension == "tsv" else ",")
        parts = ['<table style="border-collapse:collapse;width:100%">']
        for index, row in enumerate(rows):
            if index >= 10000 or len(row) > 100:
                raise ValueError("Tables are limited to 10,000 rows and 100 columns. Split this file before converting.")
            parts.append('<tr>' + ''.join('<td style="border:1px solid #bbb;padding:4px">' + html.escape(cell).replace('\n', '<br>') + '</td>' for cell in row) + '</tr>')
        return ''.join(parts) + '</table>'
    if extension in {"html", "htm"}:
        parser = SafeHTML()
        parser.feed(text)
        return "".join(parser.parts)
    if extension in {"md", "markdown"}:
        lines = []
        for line in text.splitlines():
            heading = re.match(r"^(#{1,6})\s+(.*)$", line)
            if heading:
                level = len(heading[1])
                lines.append(f"<h{level}>{html.escape(heading[2])}</h{level}>")
            else:
                lines.append(f"<p>{html.escape(line) or '&#160;'}</p>")
        return "".join(lines)
    return "<pre>" + html.escape(text) + "</pre>"


def render_text(data, extension):
    story = fitz.Story(html=text_html(data, extension), user_css="body { font-family: sans-serif; font-size: 11pt; } pre { white-space: pre-wrap; font-family: monospace; }")
    output = io.BytesIO()
    writer = fitz.DocumentWriter(output)
    try:
        for _ in range(2000):
            device = writer.begin_page(fitz.Rect(0, 0, 595, 842))
            more, _ = story.place(fitz.Rect(42, 42, 553, 800))
            story.draw(device)
            writer.end_page()
            if not more:
                break
        else:
            raise ValueError("Text exceeds the 2,000-page conversion limit.")
    finally:
        writer.close()
    return output.getvalue()


def convert_office(data, extension):
    executable = office_executable()
    if not executable:
        raise ValueError("Install LibreOffice to convert Office documents, or set FOLIO_LIBREOFFICE to its executable.")
    with tempfile.TemporaryDirectory(prefix="folio-convert-") as directory:
        root = Path(directory)
        source = root / f"input.{extension}"
        source.write_bytes(data)
        profile = root / "profile"
        (profile / "user").mkdir(parents=True)
        (profile / "user/registrymodifications.xcu").write_text('''<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop></item></oor:items>''', encoding="utf-8")
        try:
            result = subprocess.run([executable, f"-env:UserInstallation={profile.as_uri()}", "--headless", "--nologo", "--nodefault", "--nolockcheck", "--norestore", "--convert-to", "pdf", "--outdir", str(root), str(source)], capture_output=True, timeout=90, check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired as error:
            raise ValueError("LibreOffice conversion exceeded 90 seconds. Try a smaller document.") from error
        target = root / "input.pdf"
        if result.returncode != 0 or not target.is_file():
            raise ValueError("LibreOffice could not convert this document. It may be damaged or password-protected.")
        return target.read_bytes()


def convert_bytes(data, extension, *, paper="original", orientation="portrait", margin=0):
    if paper not in {"original", "a4", "letter"}:
        raise ValueError("Choose a supported paper size.")
    if orientation not in {"portrait", "landscape"}:
        raise ValueError("Choose portrait or landscape orientation.")
    if not 0 <= margin <= 144:
        raise ValueError("Image margin must be between 0 and 144 points.")
    if not CONVERSION_SLOTS.acquire(blocking=False):
        raise ValueError("Conversion workers are busy. Try again after the current conversions finish.")
    try:
        return _convert_bytes(data, extension, paper, orientation, margin)
    finally:
        CONVERSION_SLOTS.release()


def _convert_bytes(data, extension, paper="original", orientation="portrait", margin=0):
    extension = extension.lower()
    if not data:
        raise ValueError("The file is empty.")
    if len(data) > MAX_BYTES:
        raise ValueError("Each file must be smaller than 100 MB.")
    if extension in OFFICE:
        return convert_office(data, extension)
    if extension in TEXT:
        return render_text(data, extension)
    if extension in IMAGES:
        output = fitz.open()
        try:
            with Image.open(io.BytesIO(data)) as source:
                for frame in ImageSequence.Iterator(source):
                    if len(output) >= 2000:
                        raise ValueError("Images exceed the 2,000-page conversion limit.")
                    frame = ImageOps.exif_transpose(frame.copy()).convert("RGBA")
                    if frame.width * frame.height > 80_000_000:
                        raise ValueError("An image exceeds 80 million pixels.")
                    white = Image.new("RGBA", frame.size, "white")
                    white.alpha_composite(frame)
                    image = io.BytesIO()
                    white.convert("RGB").save(image, format="PNG")
                    scale = min(1, 14400 / max(frame.size))
                    width, height = frame.width * scale, frame.height * scale
                    if paper != "original":
                        width, height = (595, 842) if paper == "a4" else (612, 792)
                        if orientation == "landscape":
                            width, height = height, width
                    else:
                        width, height = width + 2 * margin, height + 2 * margin
                    page = output.new_page(width=width, height=height)
                    page.insert_image(fitz.Rect(margin, margin, width - margin, height - margin), stream=image.getvalue(), keep_proportion=True)
            return output.tobytes(garbage=4, deflate=True)
        finally:
            output.close()
    if extension == "svg":
        # Do not allow XML entities or references to local/network resources.
        markup = data.decode("utf-8-sig")
        if re.search(r"<!DOCTYPE|<!ENTITY|@import|(?:href\s*=\s*['\"]\s*(?!#))|url\s*\(\s*(?!#)", markup, re.I):
            raise ValueError("SVG must be self-contained without external resources or XML entities.")
    if extension in REFLOW or extension == "pdf":
        with fitz.open(stream=data, filetype=extension) as document:
            if document.needs_pass:
                raise ValueError("Unlock password-protected PDFs before converting.")
            if len(document) > 2000:
                raise ValueError("Document exceeds the 2,000-page conversion limit.")
            return document.tobytes() if extension == "pdf" else document.convert_to_pdf()
    raise ValueError(f".{extension or '(no extension)'} is not supported. Choose a format shown in Convert.")


def register(app, persist, lock):
    @app.get("/api/conversion/formats")
    def formats():
        available = bool(office_executable())
        return {"officeAvailable": available, "notes": ["HTML preserves text and basic structure; scripts, images, styles and external resources are removed.", "Markdown supports headings and plain body text; advanced syntax is not rendered.", "Office layout can differ when original fonts are unavailable. Password-protected files must be unlocked first.", "SVG must be self-contained. Animated images become one PDF page per frame."], "formats": [
            {"extensions": sorted(IMAGES), "label": "Images and multi-page TIFF", "available": True, "engine": "Pillow"},
            {"extensions": sorted(REFLOW | {"pdf"}), "label": "PDF, ebooks and vector documents", "available": True, "engine": "MuPDF"},
            {"extensions": sorted(TEXT), "label": "Text, CSV, TSV, basic Markdown and HTML text", "available": True, "engine": "MuPDF Story"},
            {"extensions": sorted(OFFICE), "label": "Office documents", "available": available, "engine": "LibreOffice"}]}

    @app.post("/api/convert")
    def convert(files: list[UploadFile] = File(...), mode: str = Form("separate"), paper: Annotated[str, Form()] = "original", orientation: Annotated[str, Form()] = "portrait", margin: Annotated[float, Form()] = 0):
        if mode not in {"separate", "combine"}:
            raise HTTPException(422, "Mode must be separate or combine")
        if not 1 <= len(files) <= 40:
            raise HTTPException(422, "Choose between 1 and 40 files")
        results, documents = [], []
        total = 0
        combined = fitz.open()
        try:
            for upload in files:
                name = Path((upload.filename or "Untitled").replace("\\", "/")).name
                try:
                    data = upload.file.read(MAX_BYTES + 1)
                    total += len(data)
                    if total > MAX_BYTES * 2:
                        raise ValueError("Batch exceeds 200 MB. Convert remaining files in another batch.")
                    converted = convert_bytes(data, Path(name).suffix.lstrip("."), paper=paper, orientation=orientation, margin=margin)
                    with fitz.open(stream=converted, filetype="pdf") as document:
                        if len(document) == 0:
                            raise ValueError("No pages were produced.")
                        if mode == "combine":
                            combined.insert_pdf(document)
                        else:
                            with lock:
                                documents.append(persist(document, Path(name).stem + ".pdf"))
                        results.append({"name": name, "status": "converted", "pages": len(document)})
                except Exception as error:
                    message = str(error) if isinstance(error, (ValueError, Image.DecompressionBombError)) else "Could not read this file. Check that its format and extension match and it is not damaged."
                    results.append({"name": name, "status": "error", "error": message})
            if len(combined):
                with lock:
                    documents.append(persist(combined, "Combined.pdf"))
        finally:
            combined.close()
        return {"mode": mode, "documents": documents, "results": results}
