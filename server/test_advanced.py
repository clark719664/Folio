import base64
import io

import pymupdf as fitz
import pytest
from PIL import Image
from fastapi import HTTPException
from advanced import ToolRequest, apply_tool, form_values
from app import checked_page, checked_rect


def apply(doc, **values):
    apply_tool(doc, ToolRequest(**values), checked_page, checked_rect)


def test_form_roundtrip_and_flatten():
    with fitz.open() as doc:
        doc.new_page()
        apply(doc, operation="create_field", name="customer", rect=[30, 30, 250, 60], label="Customer name", required=True)
        apply(doc, operation="create_field", name="approved", kind="checkbox", rect=[30, 80, 50, 100])
        apply(doc, operation="create_field", name="choice", kind="dropdown", choices=["One", "Two"], rect=[30, 120, 200, 150])
        apply(doc, operation="fill_forms", values={"customer": "Clark", "approved": True, "choice": "Two"})
        with fitz.open(stream=doc.tobytes(), filetype="pdf") as reopened:
            fields = {field["name"]: field for field in form_values(reopened)}
            assert fields["customer"]["value"] == "Clark"
            assert fields["approved"]["value"] != "Off"
            assert fields["choice"]["value"] == "Two"
            apply(reopened, operation="flatten_forms")
            assert form_values(reopened) == []
            assert "Clark" in reopened[0].get_text()


def test_form_validation():
    with fitz.open() as doc:
        doc.new_page()
        apply(doc, operation="create_field", name="fixed", rect=[30, 30, 250, 60], readOnly=True)
        with pytest.raises(HTTPException):
            apply(doc, operation="fill_forms", values={"fixed": "changed"})
        with pytest.raises(HTTPException):
            apply(doc, operation="fill_forms", values={"missing": "changed"})
        with pytest.raises(HTTPException):
            apply(doc, operation="create_field", name="fixed", rect=[30, 30, 250, 60])


def test_bookmarks_links_images_roundtrip():
    with fitz.open() as doc:
        doc.new_page()
        doc.new_page()
        apply(doc, operation="bookmarks", bookmarks=[(1, "First", 1), (2, "Second", 2)])
        apply(doc, operation="link", rect=[30, 30, 150, 60], url="https://example.com")
        buffer = io.BytesIO()
        Image.new("RGB", (20, 20), "red").save(buffer, format="PNG")
        apply(doc, operation="image", rect=[30, 80, 100, 150], content=base64.b64encode(buffer.getvalue()).decode())
        with fitz.open(stream=doc.tobytes(), filetype="pdf") as reopened:
            assert reopened.get_toc()[1] == [2, "Second", 2]
            assert reopened[0].get_links()[0]["uri"] == "https://example.com"
            assert len(reopened[0].get_images()) == 1


def test_find_replace():
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((30, 60), "Original text", fontsize=12)
        page.insert_text((30, 120), "Original text", fontsize=12)
        page.insert_text((30, 180), "Keep this", fontsize=12)
        apply(doc, operation="find_replace", find="Original text", replacement="New text")
        with fitz.open(stream=doc.tobytes(), filetype="pdf") as reopened:
            text = reopened[0].get_text()
            assert text.count("New text") == 2
            assert "Original text" not in text
            assert "Keep this" in text


def test_unsafe_link_rejected():
    with fitz.open() as doc:
        doc.new_page()
        with pytest.raises(HTTPException):
            apply(doc, operation="link", rect=[30, 30, 150, 60], url="javascript:alert(1)")
