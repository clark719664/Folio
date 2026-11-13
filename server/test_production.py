import base64
import io

import pymupdf as fitz
import pytest
from fastapi import HTTPException
from PIL import Image, ImageCms
from pypdf import PdfReader

import app
from production import Imposition, OutputIntent, PageBoxes, PreflightProfile, PreflightRule, add_output_intent, imposition, inspect_document, preflight, set_boxes


def source():
    doc = fitz.open()
    for index in range(1, 6):
        page = doc.new_page(width=300, height=400)
        page.insert_text((30, 50), f"Page {index}")
        page.draw_rect(fitz.Rect(30, 80, 80, 130), color=(1, 0, 0), fill=(1, 0, 0))
    image = Image.new("RGB", (20, 20), "blue")
    data = io.BytesIO()
    image.save(data, format="PNG")
    doc[0].insert_image(fitz.Rect(100, 100, 244, 244), stream=data.getvalue())
    return doc


def test_preflight_reports_precise_font_resolution_and_color_findings():
    with source() as doc:
        inspection = inspect_document(doc)
        assert inspection["pages"][0]["images"][0]["dpiX"] == 10
        assert not inspection["pages"][0]["fonts"][0]["embedded"]
        profile = PreflightProfile(name="CMYK print", rules=[PreflightRule(kind="minimum-image-dpi", minimumDpi=200), PreflightRule(kind="allowed-image-colorspaces", allowedColorspaces=["DeviceCMYK"]), PreflightRule(kind="font-embedded"), PreflightRule(kind="document-title")])
        result = preflight(doc, profile)
        assert not result["passed"] and not result["conformanceCertified"]
        image_finding = next(item for item in result["findings"] if item["kind"] == "minimum-image-dpi")
        assert image_finding["page"] == 0 and image_finding["actualDpi"] == 10
        assert len([item for item in result["findings"] if item["kind"] == "font-embedded"]) == 5
        assert PreflightProfile.model_validate_json(profile.model_dump_json()) == profile


def test_nup_and_booklet_keep_vector_text_and_padded_order():
    with source() as doc:
        output, sheets = imposition(doc, Imposition(columns=2, rows=2, width=600, height=800, margin=0, gutter=0))
        with output:
            assert sheets == [[0, 1, 2, 3], [4]]
            assert output[0].get_text().splitlines() == ["Page 1", "Page 2", "Page 3", "Page 4"]
            assert len(output[0].get_drawings()) == 4
            assert output[0].get_pixmap().width == 600
        booklet, sheets = imposition(doc, Imposition(mode="booklet"))
        with booklet:
            assert sheets == [[None, 0], [1, None], [None, 2], [3, 4]]
            assert booklet[0].get_text().strip() == "Page 1"
            assert booklet[3].get_text().splitlines() == ["Page 4", "Page 5"]
            reader = PdfReader(io.BytesIO(booklet.tobytes()))
            assert "Page 5" in reader.pages[3].extract_text()
        with pytest.raises(HTTPException):
            imposition(doc, Imposition(width=72, margin=100))


def test_boxes_and_output_intent_preserve_content():
    with source() as doc:
        set_boxes(doc, PageBoxes(pages=[0], trim=[10, 10, 290, 390], bleed=[5, 5, 295, 395]))
        assert list(doc[0].trimbox) == [10, 10, 290, 390]
        before_text = doc[0].get_text()
        source_reader = PdfReader(io.BytesIO(doc.tobytes()))
        before_stream = source_reader.pages[0].get_contents().get_data()
        icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        data = add_output_intent(PdfReader(io.BytesIO(doc.tobytes())), OutputIntent(profile=base64.b64encode(icc).decode(), identifier="sRGB"))
        reader = PdfReader(io.BytesIO(data))
        intent = reader.trailer["/Root"]["/OutputIntents"][0].get_object()
        assert intent["/DestOutputProfile"].get_data() == icc
        assert intent["/DestOutputProfile"]["/N"] == 3
        assert reader.pages[0].get_contents().get_data() == before_stream
        with fitz.open(stream=data, filetype="pdf") as after:
            assert before_text == after[0].get_text()
            assert after[0].get_pixmap().width == 300
        with pytest.raises(HTTPException):
            add_output_intent(reader, OutputIntent(profile="bm90IGljYw==", identifier="bad"))


def test_print_endpoint_immutable_and_annotations_visible(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    with source() as doc:
        doc[0].add_freetext_annot(fitz.Rect(20, 300, 250, 340), "Print annotation")
        saved = app.persist(doc)
    endpoint = next(route.endpoint for route in app.app.routes if getattr(route, "path", "") == "/api/documents/{document_id}/impose")
    changed = endpoint(saved["id"], Imposition(columns=1, rows=1, pages=[0]))
    assert changed["id"] != saved["id"]
    with app.open_document(changed["id"]) as output:
        assert "Print annotation" in output[0].get_text()
    with app.open_document(saved["id"]) as original:
        assert len(list(original[0].annots())) == 1
    preview = next(route.endpoint for route in app.app.routes if getattr(route, "path", "") == "/api/documents/{document_id}/print-preview")(changed["id"])
    assert preview.headers["content-disposition"].startswith("inline")
