import pymupdf as fitz
from fastapi.testclient import TestClient

import app


def test_stream_rewrite_parent_and_named_download(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    with fitz.open() as doc:
        doc.new_page().insert_text((30, 50), "Library test")
        content = doc.tobytes()
    with TestClient(app.app) as client:
        uploaded = client.post("/api/documents", files={"file": ("Original.pdf", content, "application/pdf")})
        assert uploaded.status_code == 200
        original = uploaded.json()["id"]
        edited = client.post(f"/api/documents/{original}/accessibility", json={"operation": "document", "title": "A title", "language": "en-US"})
        assert edited.status_code == 200
        changed = edited.json()["id"]
        revisions = client.get(f"/api/documents/{changed}/history").json()["revisions"]
        assert revisions[0]["parentId"] == original
        assert len(client.get("/api/library").json()["documents"]) == 1
        renamed = client.patch(f"/api/library/{changed}", json={"name": "Reopened.pdf"})
        assert renamed.status_code == 200
        assert client.get(f"/api/documents/{changed}").json()["name"] == "Reopened.pdf"
        assert "Reopened.pdf" in client.get(f"/api/documents/{changed}/file").headers["content-disposition"]
        assert client.put("/api/library-recovery/test", json={"documentId": changed, "page": 0, "zoom": 1.4}).status_code == 200
        assert client.get("/api/library-recovery/test").json()["state"]["zoom"] == 1.4
