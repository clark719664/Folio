import pytest
import pymupdf as fitz

import app
from review import MeasurementRequest, CommentRequest, measure
from advanced import CompareRequest


def endpoint(path):
    return next(route.endpoint for route in app.app.routes if getattr(route, "path", None) == path)


@pytest.fixture
def document(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    with fitz.open() as doc:
        doc.new_page().insert_text((50, 60), "First unique page")
        doc.new_page().insert_text((50, 60), "Second unique page")
        return app.persist(doc)


def test_calibrated_measurements_saved_and_exported(document):
    assert measure(MeasurementRequest(points=[(0, 0), (3, 4)], unitsPerPoint=2)) == 10
    assert measure(MeasurementRequest(kind="area", points=[(0, 0), (10, 0), (10, 10), (0, 10)], unitsPerPoint=2)) == 400
    added = endpoint("/api/documents/{document_id}/measurements")(document["id"], MeasurementRequest(kind="perimeter", points=[(20, 20), (30, 20), (30, 30), (20, 30)], unit="cm", label="=unsafe"))
    # Resolve the GET endpoint explicitly because POST shares its route path.
    read = next(route.endpoint for route in app.app.routes if getattr(route, "path", None) == "/api/documents/{document_id}/measurements" and "GET" in route.methods)
    assert read(added["id"])["measurements"][0]["value"] == 40
    csv = endpoint("/api/documents/{document_id}/measurements/csv")(added["id"]).body.decode()
    assert "'=unsafe" in csv


def test_comment_thread_resolution_and_export(document):
    mutate = next(route.endpoint for route in app.app.routes if getattr(route, "path", None) == "/api/documents/{document_id}/comments" and "POST" in route.methods)
    read = endpoint("/api/documents/{document_id}/comments")
    first = mutate(document["id"], CommentRequest(rect=[30, 100, 50, 120], text="Review this", author="Clark"))
    parent = read(first["id"])["comments"][0]
    second = mutate(first["id"], CommentRequest(replyTo=parent["xref"], text="Done", author="Reviewer"))
    rows = read(second["id"])["comments"]
    assert len(rows) == 2
    assert rows[1]["replyTo"] == rows[0]["xref"]
    resolved = mutate(second["id"], CommentRequest(operation="resolve", xref=rows[0]["xref"], resolved=True))
    assert read(resolved["id"])["comments"][0]["resolved"]
    assert "Review this" in endpoint("/api/documents/{document_id}/comments/summary")(resolved["id"]).body.decode()


def test_page_moves(document):
    changed = app.edit_document(document["id"], app.Edit(operation="reorder", order=[1, 0]))
    result = endpoint("/api/compare")(CompareRequest(before=document["id"], after=changed["id"]))
    assert result["pageMoves"] == [{"beforePage": 0, "afterPage": 1}, {"beforePage": 1, "afterPage": 0}]
