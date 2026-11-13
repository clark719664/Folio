import io

import pymupdf as fitz
from PIL import Image
from openpyxl import load_workbook
from pptx import Presentation

from exports import export_docx, export_pptx, export_xlsx
from advanced import ToolRequest, apply_tool
from app import checked_page, checked_rect


def test_editable_slide_text_and_image_geometry():
    with fitz.open() as doc:
        page = doc.new_page(width=600, height=400)
        page.insert_text((50, 70), "Editable heading", fontsize=20)
        image = io.BytesIO()
        Image.new("RGB", (80, 40), "blue").save(image, "PNG")
        page.insert_image(fitz.Rect(200, 100, 360, 180), stream=image.getvalue())
        presentation = Presentation(io.BytesIO(export_pptx(doc)))
        slide = presentation.slides[0]
        assert any(shape.has_text_frame and "Editable heading" in shape.text for shape in slide.shapes)
        pictures = [shape for shape in slide.shapes if shape.shape_type == 13]
        assert len(pictures) == 1
        assert abs(pictures[0].left.pt - 200) < 0.1
        assert abs(pictures[0].width.pt - 160) < 0.1
        from docx import Document
        word = Document(io.BytesIO(export_docx(doc)))
        assert any("Editable heading" in paragraph.text for paragraph in word.paragraphs)
        assert len(word.inline_shapes) == 1
        assert abs(word.sections[0].page_width.pt - 600) < 0.1


def test_table_export_numbers_and_formula_protection():
    with fitz.open() as doc:
        page = doc.new_page()
        for x in (50, 200, 350):
            page.draw_line((x, 50), (x, 170))
        for y in (50, 90, 130, 170):
            page.draw_line((50, y), (350, y))
        for y, values in ((75, ("Name", "Value")), (115, ("Revenue", "1200.50")), (155, ("=HYPERLINK(1)", "0012"))):
            for x, value in zip((60, 210), values):
                page.insert_text((x, y), value)
        workbook = load_workbook(io.BytesIO(export_xlsx(doc)))
        sheet = workbook.worksheets[0]
        assert sheet["B2"].value == 1200.5
        assert sheet["B3"].value == "0012"
        assert sheet["A3"].data_type == "s"


def test_crop_watermark_bates_and_sanitize():
    with fitz.open() as doc:
        doc.new_page()
        doc.new_page()
        doc.set_metadata({"author": "Private author", "title": "Private title"})
        doc.embfile_add("secret.txt", b"hidden information")
        for request in [ToolRequest(operation="crop", pages=[0], rect=[10, 10, 500, 700]),
                        ToolRequest(operation="watermark", text="DRAFT"),
                        ToolRequest(operation="bates", prefix="CASE-", start=8),
                        ToolRequest(operation="sanitize")]:
            apply_tool(doc, request, checked_page, checked_rect)
        with fitz.open(stream=doc.tobytes(garbage=4), filetype="pdf") as reopened:
            assert reopened[0].cropbox.width == 490
            assert "DRAFT" in reopened[0].get_text()
            assert "CASE-000008" in reopened[0].get_text()
            assert "CASE-000009" in reopened[1].get_text()
            assert not reopened.metadata["author"]
            assert reopened.embfile_count() == 0


def test_labels_headers_and_backgrounds():
    with fitz.open() as doc:
        doc.new_page()
        doc.new_page()
        image = io.BytesIO()
        Image.new("RGB", (20, 20), "yellow").save(image, "PNG")
        import base64
        requests = [ToolRequest(operation="page_labels", labels=[{"startpage": 0, "style": "r", "firstpagenum": 1}]),
                    ToolRequest(operation="header", text="Page {page} of {pages}"),
                    ToolRequest(operation="background", content=base64.b64encode(image.getvalue()).decode())]
        for request in requests:
            apply_tool(doc, request, checked_page, checked_rect)
        with fitz.open(stream=doc.tobytes(), filetype="pdf") as reopened:
            assert reopened[0].get_label() == "i"
            assert reopened[1].get_label() == "ii"
            assert "Page 2 of 2" in reopened[1].get_text()
            assert len(reopened[0].get_images()) == 1
