"""PDF-native comment threads and calibrated measurement annotations."""
import csv
import io
import json
import math

import pymupdf as fitz
from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


class CommentRequest(BaseModel):
    operation: str = "add"
    page: int = 0
    rect: list[float] | None = None
    text: str = Field(default="", max_length=100000)
    author: str = Field(default="", max_length=300)
    replyTo: int | None = None
    xref: int | None = None
    resolved: bool = False


class MeasurementRequest(BaseModel):
    page: int = 0
    kind: str = "distance"
    points: list[tuple[float, float]]
    unitsPerPoint: float = Field(default=1, gt=0, le=1e12)
    unit: str = Field(default="pt", min_length=1, max_length=30)
    label: str = Field(default="", max_length=300)


def annotation_rows(doc):
    rows = []
    for page in doc:
        for annotation in page.annots() or []:
            state = doc.xref_get_key(annotation.xref, "State")[1]
            rows.append({"page": page.number, "xref": annotation.xref, "type": annotation.type[1],
                         "rect": list(annotation.rect), "text": annotation.info["content"],
                         "author": annotation.info["title"], "replyTo": annotation.irt_xref or None,
                         "resolved": state == "Accepted"})
    return rows


def measure(request):
    points = request.points
    minimum = 2 if request.kind == "distance" else 3
    if request.kind not in {"distance", "perimeter", "area"} or len(points) < minimum or len(points) > 1000:
        raise HTTPException(422, "Provide a supported measurement and sufficient points")
    if request.kind == "distance" and len(points) != 2:
        raise HTTPException(422, "Distance measurement needs exactly two points")
    if not all(math.isfinite(value) for point in points for value in point):
        raise HTTPException(422, "Measurement coordinates must be finite")
    if request.kind == "area":
        value = abs(sum(points[i][0] * points[(i + 1) % len(points)][1] - points[(i + 1) % len(points)][0] * points[i][1] for i in range(len(points)))) / 2
        return value * request.unitsPerPoint ** 2
    pairs = zip(points, points[1:] + ([points[0]] if request.kind == "perimeter" else []))
    return sum(math.dist(a, b) for a, b in pairs) * request.unitsPerPoint


def measurement_rows(doc):
    result = []
    for page in doc:
        for annotation in page.annots() or []:
            kind, value = doc.xref_get_key(annotation.xref, "FolioMeasurement")
            if kind == "string":
                try:
                    item = json.loads(value)
                    if isinstance(item, dict):
                        result.append({**item, "page": page.number, "xref": annotation.xref})
                except ValueError:
                    continue
    return result


def register(app, open_document, persist, describe, checked_page, checked_rect, lock):
    @app.get("/api/documents/{document_id}/comments")
    def comments(document_id: str):
        with open_document(document_id) as doc:
            return {"comments": annotation_rows(doc)}

    @app.post("/api/documents/{document_id}/comments")
    def update_comment(document_id: str, request: CommentRequest):
        with lock, open_document(document_id) as doc:
            page = checked_page(doc, request.page)
            if request.operation == "add":
                if not request.text.strip():
                    raise HTTPException(422, "Comment text is required")
                parent = None
                if request.replyTo is not None:
                    if request.replyTo not in {annotation.xref for annotation in page.annots() or []}:
                        raise HTTPException(422, "Parent comment not found on this page")
                    parent = page.load_annot(request.replyTo)
                    if parent is None:
                        raise HTTPException(422, "Parent comment not found on this page")
                rect = parent.rect if parent else checked_rect(page, request.rect)
                annotation = page.add_text_annot(rect.top_left, request.text)
                annotation.set_info(title=request.author)
                if parent:
                    annotation.set_irt_xref(parent.xref)
                annotation.update()
            elif request.operation in {"edit", "resolve", "delete"}:
                if request.xref not in {annotation.xref for annotation in page.annots() or []}:
                    raise HTTPException(422, "Comment not found on this page")
                annotation = page.load_annot(request.xref)
                if request.operation == "delete":
                    if any(item.irt_xref == annotation.xref for item in page.annots() or []):
                        raise HTTPException(422, "Delete replies before deleting their parent comment")
                    page.delete_annot(annotation)
                elif request.operation == "edit":
                    annotation.set_info(content=request.text, title=request.author or annotation.info["title"])
                    annotation.update()
                else:
                    doc.xref_set_key(annotation.xref, "StateModel", fitz.get_pdf_str("Review"))
                    doc.xref_set_key(annotation.xref, "State", fitz.get_pdf_str("Accepted" if request.resolved else "None"))
            else:
                raise HTTPException(422, "Unknown comment operation")
            return persist(doc, describe(document_id, doc)["name"])

    @app.get("/api/documents/{document_id}/comments/summary")
    def summary(document_id: str):
        with open_document(document_id) as doc:
            rows = annotation_rows(doc)
        text = "\n\n".join(f"Page {row['page'] + 1} — {row['author'] or 'Anonymous'}\n{row['text']}\n{'Resolved' if row['resolved'] else 'Open'}" for row in rows)
        return Response(text, media_type="text/plain", headers={"Content-Disposition": 'attachment; filename="Comments.txt"'})

    @app.post("/api/documents/{document_id}/measurements")
    def add_measurement(document_id: str, request: MeasurementRequest):
        value = measure(request)
        with lock, open_document(document_id) as doc:
            page = checked_page(doc, request.page)
            bounds = fitz.Rect(0, 0, page.cropbox.width, page.cropbox.height)
            if any(not bounds.contains(fitz.Point(point)) for point in request.points):
                raise HTTPException(422, "Measurement points must lie within the page")
            annotation = page.add_line_annot(*request.points) if request.kind == "distance" else page.add_polygon_annot(request.points)
            unit = request.unit + ("²" if request.kind == "area" else "")
            annotation.set_info(content=f"{request.label + ': ' if request.label else ''}{value:.6g} {unit}", subject="Measurement")
            annotation.set_colors(stroke=(0.1, 0.4, 0.8))
            annotation.update()
            record = {"kind": request.kind, "points": request.points, "value": value, "unit": unit,
                      "unitsPerPoint": request.unitsPerPoint, "label": request.label}
            doc.xref_set_key(annotation.xref, "FolioMeasurement", fitz.get_pdf_str(json.dumps(record)))
            return persist(doc, describe(document_id, doc)["name"])

    @app.get("/api/documents/{document_id}/measurements")
    def measurements(document_id: str):
        with open_document(document_id) as doc:
            return {"measurements": measurement_rows(doc)}

    @app.get("/api/documents/{document_id}/measurements/csv")
    def measurement_csv(document_id: str):
        with open_document(document_id) as doc:
            rows = measurement_rows(doc)
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(["Page", "Label", "Kind", "Value", "Unit", "Units per point"])
        def safe(value):
            text = str(value)
            return "'" + text if text.startswith(("=", "+", "-", "@")) else text
        for item in rows:
            writer.writerow([item["page"] + 1, safe(item.get("label", "")), safe(item.get("kind", "")), safe(item.get("value", "")), safe(item.get("unit", "")), safe(item.get("unitsPerPoint", ""))])
        return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="Measurements.csv"'})
