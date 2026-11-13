"""Print preparation, transparent rule checks and vector-preserving imposition."""
from __future__ import annotations

import base64
import binascii
import io
import math
from typing import Literal

import pymupdf as fitz
from PIL import ImageCms
from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject, NumberObject, TextStringObject


class PreflightRule(BaseModel):
    kind: Literal["font-embedded", "minimum-image-dpi", "allowed-image-colorspaces", "document-title", "maximum-page-size", "page-boxes"]
    minimumDpi: float = Field(default=150, gt=0, le=2400)
    allowedColorspaces: list[str] = Field(default_factory=lambda: ["DeviceGray", "DeviceRGB", "DeviceCMYK"])
    width: float = Field(default=14400, gt=0, le=14400)
    height: float = Field(default=14400, gt=0, le=14400)


class PreflightProfile(BaseModel):
    name: str = Field(default="Print checks", min_length=1, max_length=120)
    rules: list[PreflightRule] = Field(default_factory=lambda: [PreflightRule(kind="font-embedded"), PreflightRule(kind="minimum-image-dpi"), PreflightRule(kind="page-boxes")], max_length=100)


class PageBoxes(BaseModel):
    pages: list[int] = Field(min_length=1, max_length=10000)
    media: list[float] | None = None
    crop: list[float] | None = None
    bleed: list[float] | None = None
    trim: list[float] | None = None
    art: list[float] | None = None


class OutputIntent(BaseModel):
    profile: str = Field(max_length=8_000_000)
    identifier: str = Field(min_length=1, max_length=250)
    description: str = Field(default="", max_length=1000)
    subtype: Literal["GTS_PDFX", "GTS_PDFA1"] = "GTS_PDFX"


class Imposition(BaseModel):
    mode: Literal["nup", "booklet"] = "nup"
    pages: list[int] | None = Field(default=None, max_length=10000)
    columns: int = Field(default=2, ge=1, le=8)
    rows: int = Field(default=2, ge=1, le=8)
    width: float = Field(default=842, ge=72, le=14400)
    height: float = Field(default=595, ge=72, le=14400)
    margin: float = Field(default=18, ge=0, le=1000)
    gutter: float = Field(default=12, ge=0, le=1000)
    rightToLeft: bool = False
    borders: bool = False
    includeAnnotations: bool = True


def inspect_document(doc):
    pages = []
    for page in doc:
        fonts = []
        for xref, extension, font_type, basefont, resource, encoding, *_ in page.get_fonts(full=True):
            font_bytes = doc.extract_font(xref)[3] if xref else b""
            fonts.append({"xref": xref, "name": basefont, "resource": resource, "type": font_type,
                          "encoding": encoding, "embedded": bool(font_bytes), "format": extension})
        images = []
        for info in page.get_image_info(xrefs=True):
            matrix = fitz.Matrix(info["transform"])
            display_width = math.hypot(matrix.a, matrix.b)
            display_height = math.hypot(matrix.c, matrix.d)
            images.append({"xref": info["xref"], "width": info["width"], "height": info["height"],
                           "colorspace": info["cs-name"], "bitsPerComponent": info["bpc"],
                           "rect": list(info["bbox"]),
                           "dpiX": round(info["width"] * 72 / display_width, 2) if display_width else None,
                           "dpiY": round(info["height"] * 72 / display_height, 2) if display_height else None})
        pages.append({"index": page.number, "rotation": page.rotation,
                      "boxes": {key: list(getattr(page, key + "box")) for key in ["media", "crop", "bleed", "trim", "art"]},
                      "fonts": fonts, "images": images})
    return {"pages": pages, "title": doc.metadata.get("title", ""),
            "inspectionLimits": ["Image colorspaces are reported; vector separations and overprint require further inspection.",
                                 "This inspection does not certify PDF/X or PDF/A conformance."]}


def preflight(doc, profile):
    report = inspect_document(doc)
    findings = []
    for rule_index, rule in enumerate(profile.rules):
        if rule.kind == "document-title" and not report["title"]:
            findings.append({"rule": rule_index, "kind": rule.kind, "message": "Set the document title."})
        for page in report["pages"]:
            base = {"rule": rule_index, "kind": rule.kind, "page": page["index"]}
            if rule.kind == "font-embedded":
                for font in page["fonts"]:
                    if not font["embedded"]:
                        findings.append({**base, "xref": font["xref"], "message": f"Embed font {font['name']} before sending to a printer that requires embedded fonts."})
            elif rule.kind == "minimum-image-dpi":
                for image in page["images"]:
                    dpi = min(image["dpiX"] or 0, image["dpiY"] or 0)
                    if dpi < rule.minimumDpi:
                        findings.append({**base, "xref": image["xref"], "rect": image["rect"], "actualDpi": dpi,
                                         "message": f"Image resolution is {dpi:g} dpi; replace with at least {rule.minimumDpi:g} dpi at this placement size."})
            elif rule.kind == "allowed-image-colorspaces":
                for image in page["images"]:
                    if image["colorspace"] not in rule.allowedColorspaces:
                        findings.append({**base, "xref": image["xref"], "colorspace": image["colorspace"],
                                         "message": "Convert this image to an allowed colorspace using the correct ICC profile."})
            elif rule.kind == "maximum-page-size":
                box = fitz.Rect(page["boxes"]["media"])
                if box.width > rule.width or box.height > rule.height:
                    findings.append({**base, "message": f"Page is {box.width:g} × {box.height:g} pt; maximum is {rule.width:g} × {rule.height:g} pt."})
            elif rule.kind == "page-boxes":
                media = fitz.Rect(page["boxes"]["media"])
                for key in ["crop", "bleed", "trim", "art"]:
                    if not media.contains(fitz.Rect(page["boxes"][key])):
                        findings.append({**base, "box": key, "message": f"Place the {key} box inside the media box."})
    return {"profile": profile.model_dump(), "findings": findings, "passed": not findings,
            "scope": "configured-rules-only", "conformanceCertified": False}


def set_boxes(doc, request):
    if any(index < 0 or index >= len(doc) for index in request.pages):
        raise HTTPException(422, "Page index is outside this document")
    boxes = {}
    for name in ["media", "crop", "bleed", "trim", "art"]:
        values = getattr(request, name)
        if values is not None:
            if len(values) != 4 or not all(math.isfinite(value) for value in values):
                raise HTTPException(422, "Each box needs four finite coordinates")
            rect = fitz.Rect(values)
            if rect.is_empty or rect.is_infinite:
                raise HTTPException(422, "Boxes must have positive width and height")
            boxes[name] = rect
    if not boxes:
        raise HTTPException(422, "Choose at least one page box")
    try:
        for index in request.pages:
            page = doc[index]
            for name, rect in boxes.items():
                getattr(page, "set_" + name + "box")(rect)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def imposition(doc, request):
    pages = request.pages if request.pages is not None else list(range(len(doc)))
    if not pages or any(index < 0 or index >= len(doc) for index in pages):
        raise HTTPException(422, "Choose valid pages to print")
    columns, rows = (2, 1) if request.mode == "booklet" else (request.columns, request.rows)
    cell_width = (request.width - 2 * request.margin - (columns - 1) * request.gutter) / columns
    cell_height = (request.height - 2 * request.margin - (rows - 1) * request.gutter) / rows
    if cell_width <= 0 or cell_height <= 0:
        raise HTTPException(422, "Margins and gutters leave no printable area")
    if request.includeAnnotations:
        doc.bake(annots=True, widgets=True)
    sheets = []
    if request.mode == "booklet":
        padded = list(pages) + [None] * ((-len(pages)) % 4)
        for index in range(len(padded) // 4):
            front = [padded[-1 - 2 * index], padded[2 * index]]
            back = [padded[2 * index + 1], padded[-2 - 2 * index]]
            sheets.extend([front[::-1] if request.rightToLeft else front, back[::-1] if request.rightToLeft else back])
    else:
        count = columns * rows
        sheets = [pages[index:index + count] for index in range(0, len(pages), count)]
    output = fitz.open()
    for sheet in sheets:
        target = output.new_page(width=request.width, height=request.height)
        for slot, source in enumerate(sheet):
            column, row = slot % columns, slot // columns
            left = request.margin + column * (cell_width + request.gutter)
            top = request.margin + row * (cell_height + request.gutter)
            rect = fitz.Rect(left, top, left + cell_width, top + cell_height)
            if source is not None and doc[source].get_contents():
                target.show_pdf_page(rect, doc, source, keep_proportion=True)
            if request.borders:
                target.draw_rect(rect, color=(0.6, 0.6, 0.6), width=0.25)
    return output, sheets


def add_output_intent(reader, request):
    try:
        profile = base64.b64decode(request.profile, validate=True)
    except (ValueError, binascii.Error) as error:
        raise HTTPException(422, "ICC profile must be base64 encoded") from error
    if len(profile) < 132 or profile[36:40] != b"acsp" or int.from_bytes(profile[:4], "big") != len(profile):
        raise HTTPException(422, "Invalid ICC profile header or size")
    components = {b"GRAY": 1, b"RGB ": 3, b"CMYK": 4}.get(profile[16:20])
    if components is None:
        raise HTTPException(422, "Use a Gray, RGB or CMYK ICC profile")
    try:
        ImageCms.ImageCmsProfile(io.BytesIO(profile))
    except (OSError, ValueError) as error:
        raise HTTPException(422, "ICC profile cannot be parsed") from error
    writer = PdfWriter(clone_from=reader)
    stream = DecodedStreamObject()
    stream.set_data(profile)
    stream[NameObject("/N")] = NumberObject(components)
    intent = DictionaryObject({NameObject("/Type"): NameObject("/OutputIntent"),
                               NameObject("/S"): NameObject("/" + request.subtype),
                               NameObject("/OutputConditionIdentifier"): TextStringObject(request.identifier),
                               NameObject("/Info"): TextStringObject(request.description),
                               NameObject("/DestOutputProfile"): writer._add_object(stream)})
    writer.root_object[NameObject("/OutputIntents")] = ArrayObject([writer._add_object(intent)])
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def register(app, location, open_document, describe, persist, lock):
    @app.get("/api/documents/{document_id}/print-preview")
    def print_preview(document_id: str):
        return FileResponse(location(document_id), media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="Print.pdf"'})

    @app.get("/api/documents/{document_id}/production")
    def inspection(document_id: str):
        with open_document(document_id) as doc:
            return inspect_document(doc)

    @app.post("/api/documents/{document_id}/preflight")
    def check(document_id: str, profile: PreflightProfile):
        with open_document(document_id) as doc:
            return preflight(doc, profile)

    @app.post("/api/documents/{document_id}/boxes")
    def boxes(document_id: str, request: PageBoxes):
        with lock, open_document(document_id) as doc:
            name = describe(document_id, doc)["name"]
            set_boxes(doc, request)
            return persist(doc, name)

    @app.post("/api/documents/{document_id}/impose")
    def impose(document_id: str, request: Imposition):
        with lock, open_document(document_id) as doc:
            output, sheets = imposition(doc, request)
            with output:
                result = persist(output, "Print.pdf")
            result["sheets"] = sheets
            result["notes"] = ["Output is a print layout; interactive links and form fields are not carried to imposed sheets.",
                               "Print booklet sheets double-sided with short-edge binding; verify printer orientation with a sample."]
            return result

    @app.post("/api/documents/{document_id}/output-intent")
    def output_intent(document_id: str, request: OutputIntent):
        with lock:
            with open_document(document_id) as doc:
                name = describe(document_id, doc)["name"]
            data = add_output_intent(PdfReader(location(document_id)), request)
            with fitz.open(stream=data, filetype="pdf") as output:
                result = persist(output, name)
            result["notes"] = ["An output intent declares the intended printing profile. It does not convert page colors or certify conformance."]
            return result
