"""Form, navigation, image, comparison and batch operations."""
import base64
import difflib
import html
import io
import sqlite3
import zipfile
from urllib.parse import urlparse

import pymupdf as fitz
from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


class ToolRequest(BaseModel):
    operation: str
    page: int = 0
    rect: list[float] | None = None
    name: str = ""
    label: str = ""
    kind: str = "text"
    value: str | bool = ""
    choices: list[str] = Field(default_factory=list)
    required: bool = False
    readOnly: bool = False
    values: dict[str, str | bool] = Field(default_factory=dict)
    bookmarks: list[tuple[int, str, int]] = Field(default_factory=list)
    url: str = ""
    targetPage: int | None = None
    content: str = ""
    find: str = ""
    replacement: str = ""
    fontSize: float = Field(default=12, gt=0, le=300)
    pages: list[int] = Field(default_factory=list)
    text: str = ""
    prefix: str = ""
    start: int = Field(default=1, ge=0)
    digits: int = Field(default=6, ge=1, le=20)
    opacity: float = Field(default=0.25, ge=0, le=1)
    xref: int | None = None
    labels: list[dict] = Field(default_factory=list)


class CompareRequest(BaseModel):
    before: str
    after: str
    mode: str = "text"


class SearchRequest(BaseModel):
    ids: list[str]
    query: str
    matchCase: bool = False


class BatchRequest(BaseModel):
    ids: list[str]
    actions: list[ToolRequest]


def form_values(doc):
    fields = []
    for page in doc:
        for widget in page.widgets() or []:
            fields.append({"page": page.number, "name": widget.field_name,
                           "label": widget.field_label, "kind": widget.field_type_string,
                           "value": widget.field_value, "rect": list(widget.rect),
                           "choices": widget.choice_values or [], "flags": widget.field_flags})
    return fields


def apply_tool(doc, request, checked_page, checked_rect):
    op = request.operation
    if op == "page_labels":
        previous = -1
        for rule in request.labels:
            if set(rule) - {"startpage", "prefix", "style", "firstpagenum"}:
                raise HTTPException(422, "Unknown page label property")
            startpage = rule.get("startpage")
            if not isinstance(startpage, int) or not previous < startpage < len(doc):
                raise HTTPException(422, "Page labels require increasing valid startpage indexes")
            if rule.get("style", "") not in {"", "D", "r", "R", "a", "A"}:
                raise HTTPException(422, "Unsupported page label style")
            if not isinstance(rule.get("firstpagenum", 1), int) or rule.get("firstpagenum", 1) < 1:
                raise HTTPException(422, "First label number must be positive")
            if not isinstance(rule.get("prefix", ""), str):
                raise HTTPException(422, "Label prefix must be text")
            previous = startpage
        doc.set_page_labels(request.labels)
    elif op in {"background", "stamp"}:
        try:
            data = base64.b64decode(request.content, validate=True)
            from PIL import Image
            with Image.open(io.BytesIO(data)) as image:
                image.verify()
        except Exception as exc:
            raise HTTPException(422, "Provide a valid image") from exc
        for index in request.pages or list(range(len(doc))):
            page = checked_page(doc, index)
            rotation = page.rotation
            page.set_rotation(0)
            rect = checked_rect(page, request.rect) if request.rect else page.rect
            page.insert_image(rect, stream=data, overlay=op == "stamp", keep_proportion=True)
            page.set_rotation(rotation)
    elif op in {"crop", "watermark", "bates", "header", "footer"}:
        pages = request.pages or list(range(len(doc)))
        if len(set(pages)) != len(pages):
            raise HTTPException(422, "Page indexes must be unique")
        for index in pages:
            checked_page(doc, index)
        for position, index in enumerate(pages):
            page = doc[index]
            rotation = page.rotation
            page.set_rotation(0)
            if op == "crop":
                rect = checked_rect(page, request.rect)
                rect += (page.cropbox.x0, page.cropbox.y0, page.cropbox.x0, page.cropbox.y0)
                page.set_cropbox(rect)
            else:
                text = f"{request.prefix}{request.start + position:0{request.digits}d}" if op == "bates" else request.text.replace("{page}", str(index + 1)).replace("{pages}", str(len(doc)))
                if not text or any(ord(c) > 255 for c in text):
                    raise HTTPException(422, "Provide Latin-1 text")
                default_rect = fitz.Rect(24, 15, page.rect.width - 24, 50) if op == "header" else fitz.Rect(24, page.rect.height - 50, page.rect.width - 24, page.rect.height - 15)
                rect = checked_rect(page, request.rect) if request.rect else default_rect
                if page.insert_textbox(rect, text, fontsize=request.fontSize, fontname="helv", align=1,
                                       fill_opacity=request.opacity if op == "watermark" else 1) < 0:
                    raise HTTPException(422, "Text does not fit in the selected region")
            page.set_rotation(rotation)
    elif op == "sanitize":
        doc.scrub(attached_files=True, clean_pages=True, embedded_files=True, hidden_text=True,
                  javascript=True, metadata=True, redactions=True, redact_images=2,
                  remove_links=False, reset_fields=False, reset_responses=True, thumbnails=True, xml_metadata=True)
    elif op == "delete_link":
        page = checked_page(doc, request.page)
        links = [link for link in page.get_links() if link["xref"] == request.xref]
        if not links:
            raise HTTPException(422, "Link not found on this page")
        page.delete_link(links[0])
    elif op in {"delete_image", "replace_image", "move_image"}:
        page = checked_page(doc, request.page)
        if request.xref not in {item[0] for item in page.get_images()}:
            raise HTTPException(422, "Image not found on this page")
        # A PDF image can be shared by several pages; deleting it changes every reference.
        if sum(request.xref in {item[0] for item in other.get_images()} for other in doc) > 1:
            raise HTTPException(422, "Image is shared across pages; removal requires per-placement editing")
        if op == "delete_image":
            page.delete_image(request.xref)
        elif op == "replace_image":
            try:
                data = base64.b64decode(request.content, validate=True)
                from PIL import Image
                with Image.open(io.BytesIO(data)) as image:
                    image.verify()
                page.replace_image(request.xref, stream=data)
            except Exception as exc:
                raise HTTPException(422, "Provide a valid replacement image") from exc
        else:
            placements = page.get_image_rects(request.xref)
            if len(placements) != 1:
                raise HTTPException(422, "Moving repeated image placements requires per-placement editing")
            rect = checked_rect(page, request.rect)
            image = doc.extract_image(request.xref)
            page.delete_image(request.xref)
            page.insert_image(rect, stream=image["image"], keep_proportion=False)
    elif op == "create_field":
        types = {"text": fitz.PDF_WIDGET_TYPE_TEXT, "checkbox": fitz.PDF_WIDGET_TYPE_CHECKBOX,
                 "dropdown": fitz.PDF_WIDGET_TYPE_COMBOBOX, "list": fitz.PDF_WIDGET_TYPE_LISTBOX,
                 "signature": fitz.PDF_WIDGET_TYPE_SIGNATURE}
        if request.kind not in types or not request.name.strip():
            raise HTTPException(422, "Choose a supported field type and a name")
        if any(field["name"] == request.name for field in form_values(doc)):
            raise HTTPException(422, "A field with this name already exists")
        if request.kind in {"dropdown", "list"} and len(request.choices) < 2:
            raise HTTPException(422, "Choice fields need at least two choices")
        page = checked_page(doc, request.page)
        widget = fitz.Widget()
        widget.field_name = request.name
        widget.field_label = request.label or request.name
        widget.field_type = types[request.kind]
        widget.rect = checked_rect(page, request.rect)
        widget.field_flags = (2 if request.required else 0) | (1 if request.readOnly else 0)
        widget.text_font = "Helv"
        widget.text_fontsize = request.fontSize
        widget.border_color = (0.5, 0.5, 0.5)
        if request.kind in {"dropdown", "list"}:
            widget.choice_values = request.choices
        widget.field_value = request.value
        page.add_widget(widget)
    elif op == "fill_forms":
        existing = {field["name"] for field in form_values(doc)}
        if not set(request.values).issubset(existing):
            raise HTTPException(422, "One or more field names do not exist")
        for page in doc:
            for widget in page.widgets() or []:
                if widget.field_name not in request.values:
                    continue
                if widget.field_flags & 1:
                    raise HTTPException(422, f"Field {widget.field_name} is read only")
                if widget.field_type == fitz.PDF_WIDGET_TYPE_SIGNATURE:
                    raise HTTPException(422, "Signature fields require a signing operation")
                value = request.values[widget.field_name]
                if widget.choice_values and value not in widget.choice_values:
                    raise HTTPException(422, f"Invalid choice for {widget.field_name}")
                if widget.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                    if not isinstance(value, bool):
                        raise HTTPException(422, "Checkbox values must be true or false")
                    value = widget.on_state() if value else "Off"
                widget.field_value = value
                widget.update()
    elif op == "flatten_forms":
        doc.bake(annots=False, widgets=True)
    elif op == "bookmarks":
        previous = 0
        for level, title, page in request.bookmarks:
            if level < 1 or level > previous + 1 or not title.strip() or not 1 <= page <= len(doc):
                raise HTTPException(422, "Bookmarks need a valid hierarchy, title and 1-based destination page")
            previous = level
        doc.set_toc([list(item) for item in request.bookmarks])
    elif op == "link":
        page = checked_page(doc, request.page)
        link = {"from": checked_rect(page, request.rect)}
        if request.targetPage is not None:
            checked_page(doc, request.targetPage)
            link.update(kind=fitz.LINK_GOTO, page=request.targetPage, to=fitz.Point(0, 0))
        else:
            if urlparse(request.url).scheme not in {"http", "https", "mailto"}:
                raise HTTPException(422, "Use an HTTP, HTTPS or mailto link")
            link.update(kind=fitz.LINK_URI, uri=request.url)
        page.insert_link(link)
    elif op == "image":
        try:
            data = base64.b64decode(request.content, validate=True)
            if len(data) > 25 * 1024 * 1024:
                raise HTTPException(413, "Image must be smaller than 25 MB")
            from PIL import Image
            with Image.open(io.BytesIO(data)) as image:
                image.verify()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(422, "Provide a valid base64 image") from exc
        page = checked_page(doc, request.page)
        page.insert_image(checked_rect(page, request.rect), stream=data, keep_proportion=True)
    elif op == "find_replace":
        if not request.find or any(ord(c) > 255 for c in request.replacement):
            raise HTTPException(422, "Provide search text and a Latin-1 replacement")
        count = 0
        for page in doc:
            rotation = page.rotation
            page.set_rotation(0)
            matches = page.search_for(request.find)
            # search_for can split one hit across multiple lines. Reject that case until layout-aware replacement exists.
            for rect in matches:
                found = page.get_textbox(rect).strip()
                if found.casefold() != request.find.casefold():
                    raise HTTPException(422, "Multiline replacement requires manual selection")
            for rect in matches:
                page.add_redact_annot(rect, fill=(1, 1, 1))
            if matches:
                page.apply_redactions(images=0, graphics=0)
            for rect in matches:
                box = fitz.Rect(rect.x0, rect.y0, rect.x1, min(page.cropbox.height, max(rect.y1, rect.y0 + request.fontSize * 1.8)))
                if request.replacement and page.insert_textbox(box, request.replacement, fontsize=request.fontSize, fontname="helv") < 0:
                    raise HTTPException(422, "A replacement does not fit its original text region")
                count += 1
            page.set_rotation(rotation)
        if not count:
            raise HTTPException(422, "Search text was not found")
    else:
        raise HTTPException(422, "Unknown tool operation")


def register(app, open_document, persist, describe, checked_page, checked_rect, lock):
    @app.post("/api/documents/{document_id}/tools")
    def tools(document_id: str, request: ToolRequest):
        with lock, open_document(document_id) as doc:
            name = describe(document_id, doc)["name"]
            apply_tool(doc, request, checked_page, checked_rect)
            return persist(doc, name)

    @app.get("/api/documents/{document_id}/forms")
    def forms(document_id: str):
        with open_document(document_id) as doc:
            return {"fields": form_values(doc)}

    @app.get("/api/documents/{document_id}/forms/data")
    def forms_data(document_id: str):
        with open_document(document_id) as doc:
            return {field["name"]: field["value"] for field in form_values(doc)}

    @app.get("/api/documents/{document_id}/bookmarks")
    def bookmarks(document_id: str):
        with open_document(document_id) as doc:
            return {"bookmarks": doc.get_toc()}

    @app.get("/api/documents/{document_id}/labels")
    def labels(document_id: str):
        with open_document(document_id) as doc:
            return {"rules": doc.get_page_labels(), "labels": [page.get_label() for page in doc]}

    @app.get("/api/documents/{document_id}/images")
    def images(document_id: str):
        buffer = io.BytesIO()
        with open_document(document_id) as doc, zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            seen = set()
            for page in doc:
                for item in page.get_images():
                    xref = item[0]
                    if xref in seen:
                        continue
                    seen.add(xref)
                    image = doc.extract_image(xref)
                    archive.writestr(f"image-{xref}.{image['ext']}", image["image"])
        return Response(buffer.getvalue(), media_type="application/zip")

    @app.get("/api/documents/{document_id}/objects")
    def objects(document_id: str):
        with open_document(document_id) as doc:
            pages = []
            for page in doc:
                links = []
                for link in page.get_links():
                    links.append({"xref": link["xref"], "rect": list(link["from"]), "url": link.get("uri"), "targetPage": link.get("page")})
                images = [{"xref": item[0], "width": item[2], "height": item[3],
                           "rects": [list(rect) for rect in page.get_image_rects(item[0])]} for item in page.get_images()]
                pages.append({"page": page.number, "links": links, "images": images})
            return {"pages": pages}

    @app.post("/api/compare")
    def compare(request: CompareRequest):
        if request.mode not in {"text", "visual"}:
            raise HTTPException(422, "Choose text or visual comparison")
        with open_document(request.before) as before, open_document(request.after) as after:
            if request.mode == "visual":
                from PIL import Image, ImageChops
                differences = []
                for index in range(max(len(before), len(after))):
                    if index >= min(len(before), len(after)):
                        differences.append({"page": index, "status": "added" if index >= len(before) else "removed"})
                        continue
                    pages = [before[index], after[index]]
                    if any(page.rect.width * page.rect.height > 16_000_000 for page in pages):
                        raise HTTPException(422, "Page is too large for visual comparison")
                    images = [Image.open(io.BytesIO(page.get_pixmap(alpha=False).tobytes("png"))).convert("RGB") for page in pages]
                    size = (max(image.width for image in images), max(image.height for image in images))
                    canvases = []
                    for image in images:
                        canvas = Image.new("RGB", size, "white")
                        canvas.paste(image, (0, 0))
                        canvases.append(canvas)
                    diff = ImageChops.difference(*canvases)
                    bounds = diff.getbbox()
                    if bounds or images[0].size != images[1].size:
                        buffer = io.BytesIO()
                        diff.save(buffer, "PNG")
                        differences.append({"page": index, "status": "changed", "bbox": bounds,
                                            "diffPng": base64.b64encode(buffer.getvalue()).decode()})
                return {"mode": "visual", "beforePages": len(before), "afterPages": len(after), "differences": differences}
            left = [page.get_text().splitlines() for page in before]
            right = [page.get_text().splitlines() for page in after]
        differences = []
        page_moves = []
        # Report unambiguous exact-text moves. Repeated identical pages cannot be uniquely paired.
        left_pages = ["\n".join(lines) for lines in left]
        right_pages = ["\n".join(lines) for lines in right]
        for before_index, content in enumerate(left_pages):
            if content and left_pages.count(content) == 1 and right_pages.count(content) == 1:
                after_index = right_pages.index(content)
                if before_index != after_index:
                    page_moves.append({"beforePage": before_index, "afterPage": after_index})
        for index in range(max(len(left), len(right))):
            a = left[index] if index < len(left) else []
            b = right[index] if index < len(right) else []
            changes = [{"kind": tag, "before": a[i:j], "after": b[k:l]}
                       for tag, i, j, k, l in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes() if tag != "equal"]
            if changes or index >= min(len(left), len(right)):
                differences.append({"page": index, "changes": changes,
                                    "status": "added" if index >= len(left) else "removed" if index >= len(right) else "changed"})
        return {"mode": "text", "beforePages": len(left), "afterPages": len(right), "differences": differences, "pageMoves": page_moves}

    @app.post("/api/search")
    def search(request: SearchRequest):
        if not request.query.strip() or not 1 <= len(request.ids) <= 100:
            raise HTTPException(422, "Provide a query and 1–100 document IDs")
        hits = []
        for document_id in request.ids:
            with open_document(document_id) as doc:
                for page in doc:
                    for rect in page.search_for(request.query):
                        text = page.get_textbox(rect)
                        if request.matchCase and request.query not in text:
                            continue
                        hits.append({"id": document_id, "page": page.number, "rect": list(rect), "text": text})
                        if len(hits) >= 10000:
                            return {"hits": hits, "truncated": True}
        return {"hits": hits, "truncated": False}

    @app.post("/api/index")
    def build_index(request: SearchRequest):
        if not 1 <= len(request.ids) <= 100:
            raise HTTPException(422, "Choose 1–100 documents")
        # Derive the private index location from an opened document, never from a client path.
        with open_document(request.ids[0]) as first:
            from pathlib import Path
            database = Path(first.name).parent / "search.sqlite3"
        with lock, sqlite3.connect(database) as connection:
            connection.execute("CREATE VIRTUAL TABLE IF NOT EXISTS pages USING fts5(document_id UNINDEXED, page UNINDEXED, text)")
            count = 0
            for document_id in request.ids:
                with open_document(document_id) as doc:
                    connection.execute("DELETE FROM pages WHERE document_id = ?", (document_id,))
                    for page in doc:
                        connection.execute("INSERT INTO pages VALUES (?, ?, ?)", (document_id, page.number, page.get_text()))
                        count += 1
        return {"documents": len(request.ids), "pages": count}

    @app.post("/api/index/search")
    def search_index(request: SearchRequest):
        if not request.query.strip() or not 1 <= len(request.ids) <= 100:
            raise HTTPException(422, "Provide a query and 1–100 document IDs")
        build_index(request)
        with open_document(request.ids[0]) as first:
            from pathlib import Path
            database = Path(first.name).parent / "search.sqlite3"
        placeholders = ",".join("?" for _ in request.ids)
        query = '"' + request.query.replace('"', '""') + '"'
        with sqlite3.connect(database) as connection:
            rows = connection.execute(
                f"SELECT document_id, page, snippet(pages, 2, '', '', '…', 24) FROM pages WHERE pages MATCH ? AND document_id IN ({placeholders}) ORDER BY rank LIMIT 1000",
                [query, *request.ids]).fetchall()
        return {"hits": [{"id": row[0], "page": int(row[1]), "text": row[2]} for row in rows]}

    @app.post("/api/batch")
    def batch(request: BatchRequest):
        if not 1 <= len(request.ids) <= 100 or not 1 <= len(request.actions) <= 30:
            raise HTTPException(422, "Choose 1–100 files and 1–30 actions")
        results = []
        for document_id in request.ids:
            try:
                with lock, open_document(document_id) as doc:
                    name = describe(document_id, doc)["name"]
                    for action in request.actions:
                        apply_tool(doc, action, checked_page, checked_rect)
                    results.append({"source": document_id, "document": persist(doc, name)})
            except HTTPException as exc:
                results.append({"source": document_id, "error": exc.detail, "status": exc.status_code})
        return {"results": results}

    @app.get("/api/documents/{document_id}/html")
    def export_html(document_id: str):
        with open_document(document_id) as doc:
            pages = "\n".join(f'<section aria-label="Page {page.number + 1}"><pre>{html.escape(page.get_text())}</pre></section>' for page in doc)
        return Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>Document</title><body>' + pages + '</body></html>', media_type="text/html",
                        headers={"Content-Disposition": 'attachment; filename="Document.html"'})
