import io
import zipfile

import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient

import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    with TestClient(app.app) as client:
        yield client


def upload(client):
    with fitz.open() as doc:
        doc.new_page().insert_text((60, 80), "Original sentence", fontsize=12)
        doc[0].insert_text((60, 160), "Unaffected content", fontsize=12)
        doc.new_page().insert_text((60, 80), "Second page")
        result = client.post("/api/documents", files={"file": ("Sample.pdf", doc.tobytes(), "application/pdf")})
    assert result.status_code == 200, result.text
    return result.json()


def test_real_edit_preserves_original_revision(client):
    initial = upload(client)
    spans = client.get(f"/api/documents/{initial['id']}/pages/0/text").json()["spans"]
    rect = spans[0]["bbox"]
    result = client.post(f"/api/documents/{initial['id']}/edit", json={"operation": "text", "rect": rect, "text": "New sentence", "fontSize": 12})
    assert result.status_code == 200, result.text
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(client.get(f"/api/documents/{result.json()['id']}/file").content))
    assert "New sentence" in reader.pages[0].extract_text()
    assert "Original sentence" not in reader.pages[0].extract_text()
    with fitz.open(stream=client.get(f"/api/documents/{result.json()['id']}/file").content, filetype="pdf") as doc:
        assert "New sentence" in doc[0].get_text()
        assert "Original sentence" not in doc[0].get_text()
        assert "Unaffected content" in doc[0].get_text()
        assert "Second page" in doc[1].get_text()
    assert "Original sentence" in client.get(f"/api/documents/{initial['id']}/pages/0/text").json()["text"]


def test_failed_edit_is_atomic(client):
    initial = upload(client)
    before = set(app.ROOT.glob("*.pdf"))
    result = client.post(f"/api/documents/{initial['id']}/edit", json={"operation": "text", "rect": [60, 60, 70, 80], "text": "This cannot fit in this rectangle"})
    assert result.status_code == 422
    assert set(app.ROOT.glob("*.pdf")) == before


def test_pages_merge_split_and_render(client):
    initial = upload(client)
    result = client.post(f"/api/documents/{initial['id']}/edit", json={"operation": "rotate", "pages": [0], "angle": 90})
    assert result.json()["pages"][0]["rotation"] == 90
    rotated_id = result.json()["id"]
    span = client.get(f"/api/documents/{rotated_id}/pages/0/text").json()["spans"][0]
    changed = client.post(f"/api/documents/{rotated_id}/edit", json={"operation": "text", "rect": span["bbox"], "text": "New sentence"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["pages"][0]["rotation"] == 90
    assert "New sentence" in client.get(f"/api/documents/{changed.json()['id']}/pages/0/text").json()["text"]
    assert client.get(f"/api/documents/{result.json()['id']}/pages/0/render").content.startswith(b"\x89PNG")
    reordered = client.post(f"/api/documents/{initial['id']}/edit", json={"operation": "reorder", "order": [1, 0]}).json()
    assert "Second page" in client.get(f"/api/documents/{reordered['id']}/pages/0/text").json()["text"]
    merged = client.post("/api/merge", json={"ids": [initial["id"], reordered["id"]]}).json()
    assert merged["pageCount"] == 4
    split = client.post(f"/api/documents/{merged['id']}/split").json()
    assert len(split["documents"]) == 4
    assert all(item["pageCount"] == 1 for item in split["documents"])


def test_password_roundtrip(client):
    initial = upload(client)
    encrypted = client.post(f"/api/documents/{initial['id']}/edit", json={"operation": "encrypt", "password": "secret"}).json()
    content = client.get(f"/api/documents/{encrypted['id']}/file").content
    files = {"file": ("Locked.pdf", content, "application/pdf")}
    assert client.post("/api/documents", files=files).status_code == 423
    result = client.post("/api/documents", files=files, data={"password": "secret"})
    assert result.status_code == 200, result.text
    assert client.get(f"/api/documents/{result.json()['id']}/pages/0/text").status_code == 200


def test_input_validation_and_exports(client):
    initial = upload(client)
    base = f"/api/documents/{initial['id']}"
    assert client.get(base + "/pages/-1/text").status_code == 422
    assert client.get("/api/documents/invalid").status_code == 404
    assert client.post(base + "/edit", json={"operation": "delete", "pages": [0, 1]}).status_code == 422
    assert client.post(base + "/edit", json={"operation": "reorder", "order": [0, 0]}).status_code == 422
    assert client.post(base + "/edit", json={"operation": "attachment", "name": "../bad", "content": "YQ=="}).status_code == 422
    assert "Original sentence" in client.get(base + "/export/txt").text
    with zipfile.ZipFile(io.BytesIO(client.get(base + "/export/png").content)) as archive:
        assert len(archive.namelist()) == 2
    from docx import Document
    doc = Document(io.BytesIO(client.get(base + "/export/docx").content))
    assert any("Original sentence" in p.text for p in doc.paragraphs)


def test_redaction_and_attachment(client):
    initial = upload(client)
    base = f"/api/documents/{initial['id']}"
    span = client.get(base + "/pages/0/text").json()["spans"][0]
    redacted = client.post(base + "/edit", json={"operation": "redact", "rect": span["bbox"]}).json()
    assert "Original sentence" not in client.get(f"/api/documents/{redacted['id']}/pages/0/text").json()["text"]
    attached = client.post(base + "/edit", json={"operation": "attachment", "name": "hello.txt", "content": "aGVsbG8="}).json()
    assert client.get(f"/api/documents/{attached['id']}/attachments/hello.txt").content == b"hello"


def test_advanced_http_compare_and_batch(client):
    initial = upload(client)
    route = f"/api/documents/{initial['id']}"
    changed = client.post(route + "/tools", json={"operation": "find_replace", "find": "Original sentence", "replacement": "New sentence"})
    assert changed.status_code == 200, changed.text
    comparison = client.post("/api/compare", json={"before": initial["id"], "after": changed.json()["id"]}).json()
    assert comparison["mode"] == "text"
    assert len(comparison["differences"]) == 1
    assert comparison["differences"][0]["page"] == 0
    actions = [{"operation": "bookmarks", "bookmarks": [[1, "Start", 1]]}]
    result = client.post("/api/batch", json={"ids": [initial["id"], "missing"], "actions": actions}).json()
    assert result["results"][0]["document"]["pageCount"] == 2
    assert result["results"][1]["status"] == 404
    assert "Original sentence" in client.get(route + "/html").text


def test_advanced_http_forms(client):
    initial = upload(client)
    created = client.post(f"/api/documents/{initial['id']}/tools", json={"operation": "create_field", "name": "customer", "rect": [40, 200, 250, 230]})
    assert created.status_code == 200, created.text
    document_id = created.json()["id"]
    filled = client.post(f"/api/documents/{document_id}/tools", json={"operation": "fill_forms", "values": {"customer": "Clark"}})
    assert filled.status_code == 200, filled.text
    assert client.get(f"/api/documents/{filled.json()['id']}/forms/data").json() == {"customer": "Clark"}
