"""Create tiny real Office documents for testing the compiled Linux binary."""
import argparse
from pathlib import Path

from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
directory = parser.parse_args().directory
directory.mkdir(parents=True, exist_ok=True)
document = Document()
document.add_paragraph("Folio office smoke")
document.save(directory / "smoke.docx")
workbook = Workbook()
workbook.active["A1"] = "Folio office smoke"
workbook.active.column_dimensions["A"].width = 30
workbook.save(directory / "smoke.xlsx")
presentation = Presentation()
slide = presentation.slides.add_slide(presentation.slide_layouts[6])
slide.shapes.add_textbox(Inches(1), Inches(1), Inches(7), Inches(1)).text = "Folio office smoke"
presentation.save(directory / "smoke.pptx")
