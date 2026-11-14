import io

import fitz
import pytest
from PIL import Image
from pypdf import PdfReader

from server.conversion import convert_bytes


def test_csv_is_native_and_preserves_quoted_cells():
    data = b'Item,Amount,Note\r\n"Paper, white",12,"<b>literal</b>"\r\nInk,25,"two\nlines"\r\n'
    result = convert_bytes(data, 'csv')
    text = ''.join(p.extract_text() for p in PdfReader(io.BytesIO(result)).pages)
    for value in ['Paper, white', '12', '<b>literal</b>', 'Ink', '25', 'two', 'lines']:
        assert value in text


@pytest.mark.parametrize('paper,orientation,size', [('a4', 'portrait', (595, 842)), ('letter', 'landscape', (792, 612))])
def test_image_page_layout_preserves_aspect_and_margin(paper, orientation, size):
    source = io.BytesIO()
    Image.new('RGB', (200, 100), 'red').save(source, format='PNG')
    output = convert_bytes(source.getvalue(), 'png', paper=paper, orientation=orientation, margin=36)
    with fitz.open(stream=output, filetype='pdf') as doc:
        page = doc[0]
        assert (page.rect.width, page.rect.height) == size
        box = page.get_image_rects(page.get_images()[0][0])[0]
        assert box.width / box.height == pytest.approx(2)
        assert box.x0 >= 36 and box.y0 >= 36
        assert box.x1 <= size[0] - 36 and box.y1 <= size[1] - 36
        assert page.get_pixmap().pixel(5, 5) == (255, 255, 255)


def test_invalid_page_options_rejected():
    with pytest.raises(ValueError, match='paper'):
        convert_bytes(b'Hello', 'txt', paper='bad')
    with pytest.raises(ValueError, match='margin'):
        convert_bytes(b'Hello', 'txt', margin=-1)
