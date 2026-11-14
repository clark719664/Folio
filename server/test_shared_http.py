import pymupdf as fitz
from fastapi.testclient import TestClient

import app


def signup(client, username):
    response = client.post("/api/auth/signup", json={"username": username, "password": "correct-pass-123", "displayName": username})
    assert response.status_code == 200
    return response.json()["user"]


def test_local_workspace_boundary_and_shared_invite_sessions(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    with fitz.open() as doc:
        doc.new_page().insert_text((30, 50), "Owner private file")
        source = app.persist(doc)
    with TestClient(app.app) as owner, TestClient(app.app) as member, TestClient(app.app) as anonymous:
        assert anonymous.get("/api/library").status_code == 200
        first = signup(owner, "owner")
        assert first["workspaceOwner"]
        assert anonymous.get("/api/library").status_code == 401
        second = signup(member, "member")
        assert not second["workspaceOwner"]
        assert member.get("/api/library").status_code == 403
        assert member.get(f"/api/documents/{source['id']}/file").status_code == 403
        assert owner.get("/api/library").status_code == 200
        shared = owner.post("/api/shared", json={"documentId": source["id"], "name": "Shared PDF"}).json()
        assert member.post("/api/shared", json={"documentId": source["id"]}).status_code == 403
        invitation = owner.post(f"/api/shared/{shared['id']}/invites", json={"role": "viewer"}).json()
        joined = member.post("/api/shared/join", json={"token": invitation["token"]})
        assert joined.status_code == 200
        assert member.get(f"/api/shared/{shared['id']}/file").status_code == 200
        assert anonymous.get(f"/api/shared/{shared['id']}/file").status_code == 401
        assert member.post(f"/api/shared/{shared['id']}/comments", json={"expectedVersion": 1, "text": "No", "page": 0}).status_code == 403
        assert owner.delete(f"/api/shared/{shared['id']}/members/{second['id']}").status_code == 200
        assert member.get(f"/api/shared/{shared['id']}/file").status_code == 404
        assert owner.post("/api/auth/logout").status_code == 200
        assert owner.get("/api/library").status_code == 401


def test_host_and_origin_rejected_before_signup(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    with TestClient(app.app) as client:
        payload = {"username": "owner", "password": "correct-pass-123"}
        assert client.post("/api/auth/signup", json=payload, headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.post("/api/auth/signup", json=payload, headers={"Host": "evil.example"}).status_code == 403
        assert client.get("/api/library", headers={"Host": "evil.example"}).status_code == 403
        assert client.post("/api/auth/signup", json=payload, headers={"Origin": "http://testserver"}).status_code == 200


def test_public_bootstrap_and_secure_cookie(tmp_path, monkeypatch):
    monkeypatch.setattr(app, 'ROOT', tmp_path)
    monkeypatch.setenv('FOLIO_PUBLIC', '1')
    monkeypatch.setenv('FOLIO_ALLOWED_ORIGINS', 'https://testserver')
    monkeypatch.setenv('FOLIO_BOOTSTRAP_TOKEN', 'test-only-bootstrap-secret-32-characters')
    payload = {'username': 'owner', 'password': 'correct-pass-123'}
    with TestClient(app.app, base_url='https://testserver') as client:
        assert client.get('/api/library').status_code == 401
        assert client.get('/api/conversion/formats').status_code == 401
        assert client.post('/api/auth/signup', json=payload).status_code == 403
        response = client.post('/api/auth/signup', json=payload, headers={'X-Folio-Bootstrap': 'test-only-bootstrap-secret-32-characters'})
        assert response.status_code == 200
        assert response.json()['user']['workspaceOwner']
        assert 'Secure' in response.headers['set-cookie'] and 'HttpOnly' in response.headers['set-cookie']
        assert client.get('/api/library').status_code == 200
        client.post('/api/auth/logout')
        response = client.post('/api/auth/signup', json={'username': 'member', 'password': 'correct-pass-123'})
        assert response.status_code == 200 and not response.json()['user']['workspaceOwner']
        assert client.get('/api/library').status_code == 403
