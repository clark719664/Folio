import io
from pathlib import Path

import pymupdf as fitz
import pytest
from fastapi import HTTPException
from PIL import Image

import app
import ocr


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    return tmp_path


def test_encrypted_library_can_unlock_without_altering_original(store):
    with fitz.open() as doc:
        doc.new_page().insert_text((30, 60), "Protected original")
        original = app.persist(doc, "Private.pdf")
    protected = app.edit_document(original["id"], app.Edit(operation="encrypt", password="user-secret"))
    protected_bytes = app.location(protected["id"]).read_bytes()
    with pytest.raises(HTTPException) as error:
        app.unlock_document(protected["id"], app.UnlockRequest(password="wrong"))
    assert error.value.status_code == 423
    opened = app.unlock_document(protected["id"], app.UnlockRequest(password="user-secret"))
    with app.open_document(opened["id"]) as doc:
        assert "Protected original" in doc[0].get_text()
        assert not doc.is_encrypted
    assert app.location(protected["id"]).read_bytes() == protected_bytes


def test_text_edit_keeps_background_and_unrelated_text(store):
    with fitz.open() as doc:
        page = doc.new_page()
        page.draw_rect(page.rect, fill=(0.2, 0.4, 0.7))
        page.insert_text((40, 60), "Original", fontsize=14)
        page.insert_text((40, 130), "Keep this", fontsize=14)
        original = app.persist(doc)
        rect = list(page.search_for("Original")[0])
        pixel = page.get_pixmap().pixel(int(rect[0]) + 2, int(rect[3]) - 1)
    changed = app.edit_document(original["id"], app.Edit(operation="text", rect=rect, text="New", fontSize=14))
    with app.open_document(changed["id"]) as doc:
        assert "Original" not in doc[0].get_text()
        assert "Keep this" in doc[0].get_text()
        assert doc[0].get_pixmap().pixel(int(rect[0]) + 2, int(rect[3]) - 1) == pixel


def test_ocr_text_layer_preserves_page_links_rotation_and_pixels(store, monkeypatch):
    image = Image.new("RGB", (300, 400), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    with fitz.open() as doc:
        page = doc.new_page(width=300, height=400)
        page.insert_image(page.rect, stream=buffer.getvalue())
        page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(20, 20, 100, 40), "uri": "https://example.com"})
        page.add_rect_annot(fitz.Rect(20, 100, 80, 150))
        page.set_rotation(90)
        original = app.persist(doc)
    with app.open_document(original["id"]) as doc:
        pixels = doc[0].get_pixmap().samples
    monkeypatch.setattr(app, "ocr_executable", lambda: "fake-tesseract")

    def fake_ocr(arguments, **kwargs):
        assert arguments[-3:] == ["-c", "textonly_pdf=1", "pdf"]
        with fitz.open() as recognized:
            page = recognized.new_page(width=300, height=400)
            page.insert_text((20, 60), "Recognized text", render_mode=3)
            recognized.save(Path(arguments[2]).with_suffix(".pdf"))

    monkeypatch.setattr(app.subprocess, "run", fake_ocr)
    changed = app.edit_document(original["id"], app.Edit(operation="ocr"))
    with app.open_document(changed["id"]) as doc:
        assert doc[0].rotation == 90
        assert "Recognized text" in doc[0].get_text()
        assert len(doc[0].get_links()) == 1
        assert len(list(doc[0].annots())) == 1
        assert pixels == doc[0].get_pixmap().samples


def test_ocr_discovers_explicit_executable(store, monkeypatch):
    executable = store / "tesseract.exe"
    executable.write_bytes(b"fixture")
    monkeypatch.setenv("FOLIO_TESSERACT", str(executable))
    assert ocr.executable() == str(executable)
    monkeypatch.setattr(ocr.subprocess, "run", lambda *args, **kwargs: type("Result", (), {"stdout": "List of available languages (2):\neng\nfra\n"})())
    assert ocr.readiness() == {"available": True, "languages": ["eng", "fra"], "message": ""}


def test_existing_serif_and_embedded_fonts_are_reused(store):
    for embedded in [False, True]:
        with fitz.open() as doc:
            page = doc.new_page()
            if embedded:
                page.insert_font(fontname="OriginalEmbedded", fontbuffer=fitz.Font("hebo").buffer)
            page.insert_text((40, 60), "Original long sentence", fontsize=14, fontname="OriginalEmbedded" if embedded else "tiro")
            rect = list(page.search_for("Original long sentence")[0])
            original_font = page.get_text("dict")["blocks"][0]["lines"][0]["spans"][0]["font"]
            source = app.persist(doc)
        result = app.edit_document(source["id"], app.Edit(operation="text", rect=rect, text="New words", fontSize=14))
        with app.open_document(result["id"]) as changed:
            span = changed[0].get_text("dict")["blocks"][0]["lines"][0]["spans"][0]
            assert span["text"] == "New words"
            assert span["font"] == original_font
