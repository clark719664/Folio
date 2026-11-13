"""Inspect and edit existing PDF structure without changing marked content."""
from __future__ import annotations

import io
import json
from typing import Literal

import pymupdf as fitz
from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, TextStringObject


class AccessibilityEdit(BaseModel):
    operation: Literal["document", "element", "reorder"]
    path: list[int] = Field(default_factory=list, max_length=64)
    language: str | None = Field(default=None, max_length=80)
    title: str | None = Field(default=None, max_length=2000)
    role: str | None = Field(default=None, max_length=80)
    alt: str | None = Field(default=None, max_length=10000)
    actualText: str | None = Field(default=None, max_length=10000)
    order: list[int] | None = None


def children(node):
    value = node.get("/K")
    if value is None:
        return []
    value = value.get_object()
    return list(value) if isinstance(value, ArrayObject) else [value]


def structure_element(value):
    value = value.get_object()
    return isinstance(value, DictionaryObject) and "/S" in value


def element_at(root, path):
    node = root.get("/StructTreeRoot")
    if node is None:
        raise HTTPException(422, "This PDF has no structure tree")
    node = node.get_object()
    for index in path:
        items = children(node)
        if index < 0 or index >= len(items) or not structure_element(items[index]):
            raise HTTPException(422, "Structure path does not identify an existing element")
        node = items[index].get_object()
    return node


def inspect(reader):
    root = reader.trailer["/Root"]
    tree = root.get("/StructTreeRoot")
    issues = []
    seen = set()
    count = 0

    def visit(node, path):
        nonlocal count
        node = node.get_object()
        identity = id(node)
        count += 1
        if identity in seen or len(path) > 64 or count > 10000:
            issues.append({"code": "structure-cycle-or-limit", "path": path, "severity": "error"})
            return None
        seen.add(identity)
        role = str(node.get("/S", "" )).lstrip("/")
        result = {"path": path, "role": role, "alt": str(node.get("/Alt", "")),
                  "actualText": str(node.get("/ActualText", "")),
                  "language": str(node.get("/Lang", "")), "children": [], "contentItems": 0}
        if role == "Figure" and not result["alt"] and not result["actualText"]:
            issues.append({"code": "figure-alt-missing", "path": path, "severity": "error"})
        for index, child in enumerate(children(node)):
            if structure_element(child):
                nested = visit(child, path + [index])
                if nested is not None:
                    result["children"].append(nested)
            else:
                result["contentItems"] += 1
        return result

    nodes = []
    if tree is not None:
        for index, value in enumerate(children(tree.get_object())):
            if structure_element(value):
                result = visit(value, [index])
                if result is not None:
                    nodes.append(result)
    else:
        issues.append({"code": "structure-tree-missing", "severity": "error"})
    language = str(root.get("/Lang", ""))
    title = str((reader.metadata or {}).get("/Title", ""))
    if not language:
        issues.append({"code": "document-language-missing", "severity": "error"})
    if not title:
        issues.append({"code": "document-title-missing", "severity": "error"})
    mark_info = root.get("/MarkInfo", {}).get_object() if "/MarkInfo" in root else {}
    marked_value = mark_info.get("/Marked", False)
    marked = bool(getattr(marked_value, "value", marked_value))
    if not marked:
        issues.append({"code": "marked-flag-missing", "severity": "error"})
    fields = reader.get_fields() or {}
    for name, field in fields.items():
        if not field.get("/TU"):
            issues.append({"code": "form-tooltip-missing", "field": name, "severity": "warning"})
    role_map = tree.get_object().get("/RoleMap", {}) if tree is not None else {}
    if hasattr(role_map, "get_object"):
        role_map = role_map.get_object()
    return {"language": language, "title": title, "marked": marked, "tagged": tree is not None,
            "tree": nodes, "roleMap": {str(k).lstrip("/"): str(v).lstrip("/") for k, v in role_map.items()},
            "issues": issues, "validation": "partial-automated-inspection",
            "manualChecks": ["Reading order and heading hierarchy", "Alternative text accuracy",
                             "Table headers and associations", "Screen reader navigation",
                             "Color contrast and meaningful link text", "PDF/UA conformance with an independent validator"]}


def mutate(reader, request):
    writer = PdfWriter(clone_from=reader)
    root = writer.root_object
    if request.operation == "document":
        if request.language is not None:
            root[NameObject("/Lang")] = TextStringObject(request.language)
        if request.title is not None:
            writer.add_metadata({"/Title": request.title})
    else:
        node = element_at(root, request.path)
        if request.operation == "element":
            if not request.path:
                raise HTTPException(422, "Select a structure element")
            if request.role is not None:
                standard = {"Document", "Part", "Art", "Sect", "Div", "BlockQuote", "Caption", "TOC", "TOCI", "Index", "NonStruct", "Private", "P", "H", "H1", "H2", "H3", "H4", "H5", "H6", "L", "LI", "Lbl", "LBody", "Table", "TR", "TH", "TD", "THead", "TBody", "TFoot", "Span", "Quote", "Note", "Reference", "BibEntry", "Code", "Link", "Annot", "Ruby", "RB", "RT", "RP", "Warichu", "WT", "WP", "Figure", "Formula", "Form"}
                mapped = root["/StructTreeRoot"].get("/RoleMap", {})
                if request.role not in standard and "/" + request.role not in mapped:
                    raise HTTPException(422, "Choose a standard or existing mapped structure role")
                node[NameObject("/S")] = NameObject("/" + request.role)
            for key, value in [("/Alt", request.alt), ("/ActualText", request.actualText), ("/Lang", request.language)]:
                if value is not None:
                    node[NameObject(key)] = TextStringObject(value)
        else:
            items = children(node)
            if request.order is None or sorted(request.order) != list(range(len(items))):
                raise HTTPException(422, "Order must include every child index exactly once")
            node[NameObject("/K")] = ArrayObject([items[index] for index in request.order])
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def register(app, location, open_document, describe, persist, lock):
    @app.get("/api/documents/{document_id}/accessibility")
    def report(document_id: str):
        return inspect(PdfReader(location(document_id)))

    @app.get("/api/documents/{document_id}/accessibility/report")
    def download_report(document_id: str):
        data = json.dumps(report(document_id), ensure_ascii=False, indent=2)
        return Response(data, media_type="application/json", headers={"Content-Disposition": 'attachment; filename="accessibility.json"'})

    @app.post("/api/documents/{document_id}/accessibility")
    def edit(document_id: str, request: AccessibilityEdit):
        with lock:
            with open_document(document_id) as original:
                name = describe(document_id, original)["name"]
            result = mutate(PdfReader(location(document_id)), request)
            with fitz.open(stream=result, filetype="pdf") as changed:
                return persist(changed, name)
