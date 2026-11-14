import io
import threading

import fitz
import pytest
from PIL import Image
from pypdf import PdfReader
from starlette.datastructures import UploadFile

import conversion


def test_images_multiframe_orientation_and_transparency():
    source = io.BytesIO()
    Image.new('RGB', (80, 40), 'red').save(source, format='TIFF', save_all=True, append_images=[Image.new('RGB', (30, 60), 'blue')])
    output = conversion.convert_bytes(source.getvalue(), 'tiff')
    reader = PdfReader(io.BytesIO(output))
    assert len(reader.pages) == 2
    assert float(reader.pages[0].mediabox.width) == 80
    assert float(reader.pages[1].mediabox.height) == 60
    with fitz.open(stream=output) as doc:
        assert doc[0].get_pixmap().pixel(10, 10) == (255, 0, 0)
    source = io.BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    Image.new('RGB', (80, 40), 'green').save(source, format='JPEG', exif=exif)
    reader = PdfReader(io.BytesIO(conversion.convert_bytes(source.getvalue(), 'jpg')))
    assert float(reader.pages[0].mediabox.width) == 40


def test_text_markdown_html_and_svg_no_external_resources():
    for extension, source in [('txt', b'Hello PDF\nSecond line'), ('md', b'# Hello PDF\nSecond line'), ('html', b'<h1>Hello PDF</h1><script>secret script</script><img src="file:///secret"><p>Second line</p>')]:
        reader = PdfReader(io.BytesIO(conversion.convert_bytes(source, extension)))
        text = ''.join(page.extract_text() for page in reader.pages)
        assert 'Hello PDF' in text and 'Second line' in text
        assert 'secret script' not in text
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>'
    with fitz.open(stream=conversion.convert_bytes(svg, 'svg')) as doc:
        assert doc[0].get_pixmap().pixel(10, 10) == (255, 0, 0)
    with pytest.raises(ValueError, match='self-contained'):
        conversion.convert_bytes(b'<svg><image href="file:///secret"/></svg>', 'svg')


def test_batch_partial_success_order_and_library_names():
    from fastapi import FastAPI
    app = FastAPI()
    saved = []
    def persist(document, name):
        saved.append((name, document.tobytes()))
        return {'id': str(len(saved)), 'name': name, 'pageCount': len(document)}
    conversion.register(app, persist, threading.RLock())
    endpoint = next(route.endpoint for route in app.routes if route.path == '/api/convert')
    files = lambda: [UploadFile(io.BytesIO(data), filename=name) for name, data in [('one.txt', b'First file'), ('broken.xyz', b'x'), ('two.txt', b'Second file')]]
    response = endpoint(files(), 'combine')
    assert [item['status'] for item in response['results']] == ['converted', 'error', 'converted']
    assert len(response['documents']) == 1
    reader = PdfReader(io.BytesIO(saved[0][1]))
    assert len(reader.pages) == 2
    assert 'First file' in reader.pages[0].extract_text()
    assert 'Second file' in reader.pages[1].extract_text()
    response = endpoint(files(), 'separate')
    assert [doc['name'] for doc in response['documents']] == ['one.pdf', 'two.pdf']


def test_office_unavailable_actionable_and_subprocess_isolated(monkeypatch):
    monkeypatch.setattr(conversion, 'office_executable', lambda: None)
    with pytest.raises(ValueError, match='Install LibreOffice'):
        conversion.convert_bytes(b'office', 'docx')
    monkeypatch.setattr(conversion, 'office_executable', lambda: 'soffice')
    profiles = []
    def run(args, **kwargs):
        from pathlib import Path
        from types import SimpleNamespace
        assert isinstance(args, list) and '--headless' in args and kwargs['timeout'] == 90
        assert not kwargs.get('shell')
        profile = next(arg for arg in args if arg.startswith('-env:'))
        profiles.append(profile)
        root = Path(args[-1]).parent
        assert 'MacroSecurityLevel' in (root / 'profile/user/registrymodifications.xcu').read_text()
        with fitz.open() as doc:
            doc.new_page().insert_text((20, 30), 'Converted Office')
            doc.save(root / 'input.pdf')
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(conversion.subprocess, 'run', run)
    for _ in range(2):
        reader = PdfReader(io.BytesIO(conversion.convert_bytes(b'office', 'docx')))
        assert 'Converted Office' in reader.pages[0].extract_text()
    assert profiles[0] != profiles[1]


def test_ebook_and_comic_native_fixtures():
    import zipfile
    epub = io.BytesIO()
    with zipfile.ZipFile(epub, 'w') as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        archive.writestr('content.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture</dc:title><dc:identifier id="book">fixture</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>')
        archive.writestr('chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Ebook fixture</h1><p>Readable ebook content</p></body></html>')
    reader = PdfReader(io.BytesIO(conversion.convert_bytes(epub.getvalue(), 'epub')))
    assert 'Readable ebook content' in ''.join(page.extract_text() for page in reader.pages)
    cbz = io.BytesIO()
    with zipfile.ZipFile(cbz, 'w') as archive:
        for index, color in enumerate(['red', 'blue']):
            png = io.BytesIO()
            Image.new('RGB', (40, 60), color).save(png, format='PNG')
            archive.writestr(f'{index:02}.png', png.getvalue())
    with fitz.open(stream=conversion.convert_bytes(cbz.getvalue(), 'cbz')) as doc:
        assert len(doc) == 2
        assert doc[0].get_pixmap().pixel(10, 10) == (255, 0, 0)
        assert doc[1].get_pixmap().pixel(10, 10) == (0, 0, 255)


@pytest.mark.skipif(not conversion.office_executable(), reason='LibreOffice is not installed')
def test_real_office_docx_xlsx_pptx():
    from docx import Document
    from openpyxl import Workbook
    from pptx import Presentation
    from pptx.util import Inches
    fixtures = []
    doc = Document()
    doc.add_heading('Word conversion fixture', 0)
    doc.add_paragraph('Editable word processing content')
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = 'Product'
    table.cell(1, 0).text = 'Notebook'
    output = io.BytesIO()
    doc.save(output)
    fixtures.append(('docx', output.getvalue(), ['Word conversion fixture', 'Notebook']))
    book = Workbook()
    sheet = book.active
    sheet.append(['Spreadsheet fixture', 'Amount'])
    sheet.append(['Notebook', 42])
    sheet.column_dimensions['A'].width = 30
    output = io.BytesIO()
    book.save(output)
    fixtures.append(('xlsx', output.getvalue(), ['Spreadsheet fixture', '42']))
    slides = Presentation()
    slide = slides.slides.add_slide(slides.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(2))
    box.text_frame.text = 'Presentation fixture'
    output = io.BytesIO()
    slides.save(output)
    fixtures.append(('pptx', output.getvalue(), ['Presentation fixture']))
    for extension, data, expected in fixtures:
        result = conversion.convert_bytes(data, extension)
        reader = PdfReader(io.BytesIO(result))
        assert len(reader.pages) >= 1
        text = ''.join(page.extract_text() for page in reader.pages)
        for value in expected:
            assert value in text, (extension, value, text)
        with fitz.open(stream=result) as rendered:
            pix = rendered[0].get_pixmap()
            assert len(set(pix.samples)) > 1
