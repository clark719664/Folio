"""Editable Office exports. Geometry is retained where the format permits it."""
import io
import re

from fastapi import HTTPException
from fastapi.responses import Response


def export_docx(doc):
    from docx import Document
    from docx.shared import Pt, RGBColor
    from docx.enum.section import WD_SECTION_START
    output = Document()
    for index, page in enumerate(doc):
        section = output.sections[0] if index == 0 else output.add_section(WD_SECTION_START.NEW_PAGE)
        section.page_width = Pt(page.rect.width)
        section.page_height = Pt(page.rect.height)
        section.top_margin = section.bottom_margin = Pt(20)
        section.left_margin = section.right_margin = Pt(20)
        previous_bottom = 20
        for block in sorted(page.get_text("dict")["blocks"], key=lambda item: (item["bbox"][1], item["bbox"][0])):
            x0, y0, x1, y1 = block["bbox"]
            paragraph = output.add_paragraph()
            paragraph.paragraph_format.left_indent = Pt(max(0, x0 - 20))
            paragraph.paragraph_format.space_before = Pt(max(0, y0 - previous_bottom))
            paragraph.paragraph_format.space_after = Pt(0)
            paragraph.paragraph_format.line_spacing = 1
            if block["type"] == 1:
                paragraph.add_run().add_picture(io.BytesIO(block["image"]), width=Pt(x1 - x0), height=Pt(y1 - y0))
            else:
                for line_index, line in enumerate(block.get("lines", [])):
                    if line_index:
                        paragraph.add_run().add_break()
                    for span in line["spans"]:
                        run = paragraph.add_run(span["text"])
                        run.font.name = span["font"].split("+")[-1]
                        run.font.size = Pt(span["size"])
                        run.bold = bool(span["flags"] & 16)
                        run.italic = bool(span["flags"] & 2)
                        color = span["color"]
                        run.font.color.rgb = RGBColor((color >> 16) & 255, (color >> 8) & 255, color & 255)
            previous_bottom = max(previous_bottom, y1)
    buffer = io.BytesIO()
    output.save(buffer)
    return buffer.getvalue()


def numeric_value(value):
    if not isinstance(value, str):
        return value
    text = value.strip()
    # Preserve identifiers with leading zeroes and formula-like untrusted content as text.
    if re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d+)?", text):
        return float(text) if "." in text else int(text)
    return value


def export_xlsx(doc):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    workbook = Workbook()
    workbook.remove(workbook.active)
    for page in doc:
        tables = page.find_tables().tables
        if tables:
            for index, table in enumerate(tables):
                sheet = workbook.create_sheet(f"Page {page.number + 1} Table {index + 1}"[:31])
                for row in table.extract():
                    sheet.append([numeric_value(value) for value in row])
                for row in sheet:
                    for cell in row:
                        if isinstance(cell.value, str):
                            cell.data_type = "s"
                for cell in sheet[1]:
                    cell.font = Font(bold=True)
                sheet.freeze_panes = "A2"
        else:
            sheet = workbook.create_sheet(f"Page {page.number + 1}")
            for line in page.get_text().splitlines():
                cell = sheet.cell(sheet.max_row + 1 if sheet.cell(1, 1).value else 1, 1, line)
                cell.data_type = "s"
            sheet.column_dimensions["A"].width = 90
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def export_pptx(doc):
    from pptx import Presentation
    from pptx.util import Pt
    from pptx.dml.color import RGBColor
    presentation = Presentation()
    width = max(page.rect.width for page in doc)
    height = max(page.rect.height for page in doc)
    if not 72 <= width <= 4032 or not 72 <= height <= 4032:
        raise HTTPException(422, "Page sizes fall outside PowerPoint slide limits")
    presentation.slide_width = Pt(width)
    presentation.slide_height = Pt(height)
    for page in doc:
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        transform = page.rotation_matrix
        for block in page.get_text("dict")["blocks"]:
            import pymupdf as fitz
            rect = fitz.Rect(block["bbox"]) * transform
            if block["type"] == 1:
                slide.shapes.add_picture(io.BytesIO(block["image"]), Pt(rect.x0), Pt(rect.y0), Pt(rect.width), Pt(rect.height))
                continue
            for line in block.get("lines", []):
                bounds = fitz.Rect(line["bbox"]) * transform
                shape = slide.shapes.add_textbox(Pt(bounds.x0), Pt(bounds.y0), Pt(max(bounds.width, 1)), Pt(max(bounds.height * 1.2, 1)))
                frame = shape.text_frame
                frame.word_wrap = False
                frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
                paragraph = frame.paragraphs[0]
                for span in line["spans"]:
                    run = paragraph.add_run()
                    run.text = span["text"]
                    run.font.name = span["font"].split("+")[-1]
                    run.font.size = Pt(span["size"])
                    run.font.bold = bool(span["flags"] & 16)
                    run.font.italic = bool(span["flags"] & 2)
                    color = span["color"]
                    run.font.color.rgb = RGBColor((color >> 16) & 255, (color >> 8) & 255, color & 255)
    buffer = io.BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()


def office_response(doc, format):
    if format == "docx":
        data = export_docx(doc)
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif format == "xlsx":
        data = export_xlsx(doc)
        mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        data = export_pptx(doc)
        mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    return Response(data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="Document.{format}"'})
