import io

import pymupdf as fitz
import pytest
from fastapi import HTTPException
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, BooleanObject, DictionaryObject, NameObject, NumberObject, TextStringObject, DecodedStreamObject

import app
from accessibility import AccessibilityEdit, inspect, mutate


def tagged_pdf():
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((40, 50), "Accessible heading")
        source = doc.tobytes()
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(source)))
    page = writer.pages[0]
    stream = DecodedStreamObject()
    stream.set_data(b"/H1 <</MCID 0>> BDC\n" + page.get_contents().get_data() + b"\nEMC")
    page[NameObject("/Contents")] = writer._add_object(stream)
    page[NameObject("/StructParents")] = NumberObject(0)
    tree = DictionaryObject({NameObject("/Type"): NameObject("/StructTreeRoot")})
    tree_ref = writer._add_object(tree)
    heading = DictionaryObject({NameObject("/Type"): NameObject("/StructElem"), NameObject("/S"): NameObject("/H1"), NameObject("/P"): tree_ref, NameObject("/Pg"): page.indirect_reference, NameObject("/K"): NumberObject(0)})
    heading_ref = writer._add_object(heading)
    figure = DictionaryObject({NameObject("/Type"): NameObject("/StructElem"), NameObject("/S"): NameObject("/Figure"), NameObject("/P"): tree_ref})
    figure_ref = writer._add_object(figure)
    tree[NameObject("/K")] = ArrayObject([heading_ref, figure_ref])
    tree[NameObject("/ParentTree")] = writer._add_object(DictionaryObject({NameObject("/Nums"): ArrayObject([NumberObject(0), ArrayObject([heading_ref])])}))
    writer.root_object[NameObject("/StructTreeRoot")] = tree_ref
    writer.root_object[NameObject("/MarkInfo")] = DictionaryObject({NameObject("/Marked"): BooleanObject(True)})
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def test_inspection_and_semantic_edit_preserve_rendering():
    original = tagged_pdf()
    report = inspect(PdfReader(io.BytesIO(original)))
    assert report["tagged"] and report["marked"]
    assert any(issue["code"] == "figure-alt-missing" for issue in report["issues"])
    updated = mutate(PdfReader(io.BytesIO(original)), AccessibilityEdit(operation="element", path=[1], alt="A diagram", role="Figure"))
    updated = mutate(PdfReader(io.BytesIO(updated)), AccessibilityEdit(operation="document", title="Accessible sample", language="en-US"))
    updated = mutate(PdfReader(io.BytesIO(updated)), AccessibilityEdit(operation="reorder", path=[], order=[1, 0]))
    reader = PdfReader(io.BytesIO(updated))
    report = inspect(reader)
    assert report["title"] == "Accessible sample" and report["language"] == "en-US"
    assert report["tree"][0]["alt"] == "A diagram"
    tree = reader.trailer["/Root"]["/StructTreeRoot"]
    assert tree["/ParentTree"]["/Nums"][1][0].get_object() == tree["/K"][1].get_object()
    assert tree["/K"][1]["/K"] == 0
    with fitz.open(stream=original, filetype="pdf") as before, fitz.open(stream=updated, filetype="pdf") as after:
        assert before[0].get_pixmap().samples == after[0].get_pixmap().samples
        assert before[0].get_text() == after[0].get_text()


def test_immutable_endpoint_preserves_structure(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    with fitz.open(stream=tagged_pdf(), filetype="pdf") as doc:
        source = app.persist(doc)
    endpoint = next(route.endpoint for route in app.app.routes if getattr(route, "path", "") == "/api/documents/{document_id}/accessibility" and "POST" in route.methods)
    changed = endpoint(source["id"], AccessibilityEdit(operation="element", path=[1], alt="New alt text"))
    assert changed["id"] != source["id"]
    assert inspect(PdfReader(app.location(changed["id"])))["tree"][1]["alt"] == "New alt text"
    assert inspect(PdfReader(app.location(source["id"])))["tree"][1]["alt"] == ""
    files = list(tmp_path.glob("*.pdf"))
    with pytest.raises(HTTPException):
        endpoint(source["id"], AccessibilityEdit(operation="element", path=[99], alt="Invalid"))
    assert list(tmp_path.glob("*.pdf")) == files


def test_invalid_order_and_role_rejected():
    reader = PdfReader(io.BytesIO(tagged_pdf()))
    for request in [AccessibilityEdit(operation="reorder", order=[0, 0]), AccessibilityEdit(operation="element", path=[0], role="Invented"), AccessibilityEdit(operation="element", path=[] , alt="Invalid")]:
        with pytest.raises(HTTPException):
            mutate(reader, request)
    with fitz.open() as doc:
        doc.new_page()
        report = inspect(PdfReader(io.BytesIO(doc.tobytes())))
    assert not report["tagged"]
    assert report["validation"] == "partial-automated-inspection"
    assert report["manualChecks"]


def test_false_mark_and_cyclic_structure_are_reported():
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(tagged_pdf())))
    root = writer.root_object
    root["/MarkInfo"][NameObject("/Marked")] = BooleanObject(False)
    tree = root["/StructTreeRoot"]
    heading = tree["/K"][0].get_object()
    heading[NameObject("/K")] = tree["/K"]
    output = io.BytesIO()
    writer.write(output)
    report = inspect(PdfReader(io.BytesIO(output.getvalue())))
    assert not report["marked"]
    assert any(issue["code"] == "structure-cycle-or-limit" for issue in report["issues"])
