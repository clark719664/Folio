from concurrent.futures import ThreadPoolExecutor

import pymupdf as fitz
import pytest

import app
from library import LibraryUpdate, PARENT_REVISION, RecoveryState, library_rows, record_revision


def endpoint(path, method="GET"):
    return next(route.endpoint for route in app.app.routes if getattr(route, "path", "") == path and method in route.methods)


def create(name="Original.pdf"):
    with fitz.open() as doc:
        doc.new_page().insert_text((30, 50), "Original text")
        return app.persist(doc, name)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    return tmp_path


def test_persist_history_rename_restore_and_recovery(store):
    first = create()
    changed = app.edit_document(first["id"], app.Edit(operation="rotate", page=0, angle=90))
    rows = library_rows(store)
    assert len(rows) == 1 and rows[0]["revisionCount"] == 2
    assert rows[0]["documentId"] == changed["id"]
    rename = endpoint("/api/library/{revision_id}", "PATCH")
    renamed = rename(changed["id"], LibraryUpdate(name="Annual report.pdf", folder="Reports", favorite=True))
    assert renamed["favorite"] and renamed["folder"] == "Reports"
    assert library_rows(store, query="annual", favorites=True)[0]["name"] == "Annual report.pdf"
    assert app.document_info(first["id"])["name"] == "Annual report.pdf"
    restored = endpoint("/api/documents/{document_id}/restore", "POST")(first["id"])
    assert restored["id"] != first["id"] and restored["name"] == "Annual report.pdf"
    assert app.location(restored["id"]).read_bytes() == app.location(first["id"]).read_bytes()
    history = endpoint("/api/documents/{document_id}/history")(restored["id"])["revisions"]
    assert history[0]["parentId"] == changed["id"] and history[0]["restoredFrom"] == first["id"]
    save = endpoint("/api/library-recovery/{client}", "PUT")
    save("browser_one", RecoveryState(documentId=restored["id"], page=0, zoom=1.2))
    state = endpoint("/api/library-recovery/{client}")("browser_one")["state"]
    assert state["documentId"] == restored["id"] and state["zoom"] == 1.2


def test_legacy_discovery_and_concurrent_revisions_survive_new_connections(store):
    legacy_id = "a" * 32
    with fitz.open() as doc:
        doc.new_page()
        doc.save(store / f"{legacy_id}.pdf")
    (store / f"{legacy_id}.name").write_text("Legacy.pdf", encoding="utf-8")
    assert library_rows(store)[0]["name"] == "Legacy.pdf"

    def child(index):
        revision = f"{index:032x}"
        (store / f"{revision}.pdf").write_bytes((store / f"{legacy_id}.pdf").read_bytes())
        record_revision(store, revision, "Legacy.pdf", legacy_id)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(child, range(1, 9)))
    rows = library_rows(store)
    assert len(rows) == 1 and rows[0]["revisionCount"] == 9
    assert len(endpoint("/api/documents/{document_id}/history")(legacy_id)["revisions"]) == 9


def test_context_parent_for_stream_rewrites_and_invalid_rename(store):
    first = create()
    token = PARENT_REVISION.set(first["id"])
    try:
        with fitz.open(stream=app.location(first["id"]).read_bytes(), filetype="pdf") as doc:
            changed = app.persist(doc)
    finally:
        PARENT_REVISION.reset(token)
    assert library_rows(store)[0]["revisionCount"] == 2
    assert endpoint("/api/documents/{document_id}/history")(changed["id"])["revisions"][0]["parentId"] == first["id"]
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        endpoint("/api/library/{revision_id}", "PATCH")(changed["id"], LibraryUpdate(name="../bad.pdf"))


def test_newer_library_schema_is_never_downgraded(store):
    import sqlite3
    from fastapi import HTTPException
    with sqlite3.connect(store / "library.sqlite3") as database:
        database.execute("PRAGMA user_version=2")
    with pytest.raises(HTTPException) as error:
        library_rows(store)
    assert error.value.status_code == 503
    with sqlite3.connect(store / "library.sqlite3") as database:
        assert database.execute("PRAGMA user_version").fetchone()[0] == 2
