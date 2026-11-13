"""Reuse an original font when it can represent replacement characters."""
import hashlib
import re
import pymupdf as fitz

BASE_FONTS = {
    "Helvetica": "helv", "Helvetica-Bold": "hebo", "Helvetica-Oblique": "heit", "Helvetica-BoldOblique": "hebi",
    "Times-Roman": "tiro", "Times-Bold": "tibo", "Times-Italic": "tiit", "Times-BoldItalic": "tibi",
    "Courier": "cour", "Courier-Bold": "cobo", "Courier-Oblique": "coit", "Courier-BoldOblique": "cobi",
}


def replacement_font(page, rect, text):
    spans = [span for block in page.get_text("dict")["blocks"] for line in block.get("lines", []) for span in line["spans"] if fitz.Rect(span["bbox"]).intersects(rect)]
    if not spans:
        return ("helv" if all(ord(char) <= 255 for char in text) else None), None
    names = {span["font"] for span in spans}
    if len(names) != 1:
        return ("helv" if all(ord(char) <= 255 for char in text) else None), None
    name = next(iter(names))
    if name in BASE_FONTS and all(ord(char) <= 255 for char in text):
        return BASE_FONTS[name], None
    for font in page.get_fonts(full=True):
        xref, _, _, basefont, *_ = font
        if re.sub(r"[\s-]", "", basefont.split("+", 1)[-1]) != re.sub(r"[\s-]", "", name.split("+", 1)[-1]):
            continue
        content = page.parent.extract_font(xref)[3]
        if not content:
            continue
        try:
            candidate = fitz.Font(fontbuffer=content)
            if not all(character.isspace() or candidate.has_glyph(ord(character), fallback=False) for character in text):
                continue
            resource = "Folio" + hashlib.sha256(content).hexdigest()[:12]
            return resource, content
        except (ValueError, RuntimeError):
            continue
    return ("helv" if all(ord(char) <= 255 for char in text) else None), None
