import base64
import io

import pymupdf as fitz
from PIL import Image

import app
from advanced import ToolRequest, CompareRequest, SearchRequest, apply_tool


def endpoint(path):
    return next(route.endpoint for route in app.app.routes if getattr(route, "path", None) == path)


def test_unicode_edit_and_permissions(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    with fitz.open() as doc:
        doc.new_page().insert_text((30, 60), "Original sentence", fontsize=12)
        original = app.persist(doc)
    edited = app.edit_document(original["id"], app.Edit(operation="text", rect=[30, 40, 300, 90], text="中文 Привет café"))
    text = app.page_text(edited["id"], 0)["text"]
    assert "中文" in text and "Привет" in text
    assert "Original sentence" not in text
    encrypted = app.edit_document(edited["id"], app.Edit(operation="encrypt", password="reader", ownerPassword="owner", permissions=["print"]))
    with fitz.open(app.location(encrypted["id"])) as doc:
        assert doc.authenticate("reader")
        assert doc.permissions & fitz.PDF_PERM_PRINT
        assert not doc.permissions & fitz.PDF_PERM_COPY


def test_image_replace_move():
    with fitz.open() as doc:
        page = doc.new_page()
        def content(color):
            buffer = io.BytesIO()
            Image.new("RGB", (30, 20), color).save(buffer, "PNG")
            return buffer.getvalue()
        xref = page.insert_image(fitz.Rect(30, 30, 90, 70), stream=content("red"))
        apply_tool(doc, ToolRequest(operation="replace_image", xref=xref, content=base64.b64encode(content("blue")).decode()), app.checked_page, app.checked_rect)
        assert Image.open(io.BytesIO(doc.extract_image(xref)["image"])).getpixel((0, 0)) == (0, 0, 255)
        apply_tool(doc, ToolRequest(operation="move_image", xref=xref, rect=[100, 100, 220, 180]), app.checked_page, app.checked_rect)
        with fitz.open(stream=doc.tobytes(), filetype="pdf") as reopened:
            assert any(rect == fitz.Rect(100, 100, 220, 180) for item in reopened[0].get_images() for rect in reopened[0].get_image_rects(item[0]))


def test_visual_compare_search_and_annotations(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    with fitz.open() as doc:
        doc.new_page().insert_text((30, 60), "Searchable phrase")
        original = app.persist(doc)
    changed = app.edit_document(original["id"], app.Edit(operation="annotate", kind="rectangle", rect=[30, 90, 150, 160], color=[1, 0, 0]))
    compare = endpoint("/api/compare")
    assert compare(CompareRequest(before=original["id"], after=changed["id"]))["differences"] == []
    visual = compare(CompareRequest(before=original["id"], after=changed["id"], mode="visual"))
    assert len(visual["differences"]) == 1
    assert base64.b64decode(visual["differences"][0]["diffPng"]).startswith(b"\x89PNG")
    assert compare(CompareRequest(before=original["id"], after=original["id"], mode="visual"))["differences"] == []
    search = endpoint("/api/search")
    assert len(search(SearchRequest(ids=[original["id"], changed["id"]], query="Searchable"))["hits"]) == 2
    indexed = endpoint("/api/index/search")(SearchRequest(ids=[original["id"], changed["id"]], query="Searchable phrase"))
    assert len(indexed["hits"]) == 2
    assert (tmp_path / "search.sqlite3").is_file()
