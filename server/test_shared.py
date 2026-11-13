from concurrent.futures import ThreadPoolExecutor
from http.cookies import SimpleCookie
import io
import json

import pymupdf as fitz
import pytest
from fastapi import HTTPException
from starlette.requests import Request

import app
from shared import Credentials, CreateShared, SharedEdit, CommentCreate, InviteCreate, Join, Presence, database


def endpoint(path, method="GET"):
    return next(route.endpoint for route in app.app.routes if getattr(route, "path", "") == path and method in route.methods)


def request(cookie="", origin=None):
    headers = [(b"cookie", cookie.encode())]
    if origin:
        headers.append((b"origin", origin.encode()))
    return Request({"type": "http", "method": "POST", "scheme": "http", "server": ("localhost", 8765), "path": "/api", "headers": headers, "query_string": b""})


def user(username):
    response = endpoint("/api/auth/signup", "POST")(request(), Credentials(username=username, password="good-password-123", displayName=username.title()))
    cookie = SimpleCookie()
    cookie.load(response.headers["set-cookie"])
    return request("folio_session=" + cookie["folio_session"].value), json.loads(response.body)["user"]


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((40, 60), "Original text", fontsize=14)
        source = app.persist(doc)
        rect = list(page.search_for("Original text")[0])
    owner, owner_user = user("owner")
    editor, editor_user = user("editor")
    shared = endpoint("/api/shared", "POST")(owner, CreateShared(documentId=source["id"], name="Shared contract.pdf"))
    return tmp_path, source, rect, owner, owner_user, editor, editor_user, shared


def grant(owner, member, document_id, role):
    invitation = endpoint("/api/shared/{document_id}/invites", "POST")(document_id, owner, InviteCreate(role=role))
    return endpoint("/api/shared/join", "POST")(member, Join(token=invitation["token"])), invitation


def test_shared_auth_access_and_private_store(setup):
    root, source, rect, owner, _, editor, _, shared = setup
    read = endpoint("/api/shared/{document_id}")
    with pytest.raises(HTTPException) as error:
        read(shared["id"], request())
    assert error.value.status_code == 401
    with pytest.raises(HTTPException) as error:
        read(shared["id"], editor)
    assert error.value.status_code == 404
    assert not (root / f"{shared['id']}.pdf").exists()
    with pytest.raises(HTTPException):
        app.document_info(shared["id"])
    with database(root) as connection:
        row = connection.execute("SELECT password,salt FROM users LIMIT 1").fetchone()
        assert row["password"] != b"good-password-123" and len(row["salt"]) == 16
        assert all(len(row[0]) == 64 for row in connection.execute("SELECT token FROM sessions"))
    with pytest.raises(HTTPException) as error:
        endpoint("/api/auth/signup", "POST")(request(origin="https://evil.example"), Credentials(username="evil", password="good-password-123"))
    assert error.value.status_code == 403


def test_edit_conflicts_preserve_both_current_state_and_history(setup):
    root, source, rect, owner, _, editor, _, shared = setup
    grant(owner, editor, shared["id"], "editor")
    edit = endpoint("/api/shared/{document_id}/edit", "POST")

    def change(actor, text):
        try:
            return edit(shared["id"], actor, SharedEdit(expectedVersion=1, edit={"operation": "text", "rect": rect, "text": text, "fontSize": 14}))
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(change, owner, "Owner")
        b = pool.submit(change, editor, "Editor")
        results = [a.result(), b.result()]
    assert results.count(409) == 1
    current = endpoint("/api/shared/{document_id}")(shared["id"], editor)
    assert current["version"] == 2
    content = endpoint("/api/shared/{document_id}/file")(shared["id"], editor).body
    with fitz.open(stream=content, filetype="pdf") as doc:
        assert "Original text" not in doc[0].get_text()
        assert "Owner" in doc[0].get_text() or "Editor" in doc[0].get_text()
    with database(root) as connection:
        original = connection.execute("SELECT pdf FROM revisions WHERE document_id=? AND version=1", (shared["id"],)).fetchone()[0]
    with fitz.open(stream=original, filetype="pdf") as doc:
        assert "Original text" in doc[0].get_text()


def test_invite_one_use_revoke_and_comment_permissions(setup):
    root, _, rect, owner, _, editor, editor_user, shared = setup
    state, invite = grant(owner, editor, shared["id"], "commenter")
    outsider, _ = user("outsider")
    with pytest.raises(HTTPException) as error:
        endpoint("/api/shared/join", "POST")(outsider, Join(token=invite["token"]))
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        endpoint("/api/shared/{document_id}/edit", "POST")(shared["id"], editor, SharedEdit(expectedVersion=1, edit={"operation": "text", "rect": rect, "text": "Bad"}))
    assert error.value.status_code == 403
    commented = endpoint("/api/shared/{document_id}/comments", "POST")(shared["id"], editor, CommentCreate(expectedVersion=1, text="Please check", page=0))
    assert commented["version"] == 2 and commented["comments"][0]["author"] == "Editor"
    presence = endpoint("/api/shared/{document_id}/presence", "POST")(shared["id"], editor, Presence(page=0))
    assert presence["presence"][0]["userId"] == editor_user["id"]
    endpoint("/api/shared/{document_id}/members/{user_id}", "DELETE")(shared["id"], editor_user["id"], owner)
    for route in ["/api/shared/{document_id}", "/api/shared/{document_id}/file"]:
        with pytest.raises(HTTPException) as error:
            endpoint(route)(shared["id"], editor)
        assert error.value.status_code == 404


def test_login_logout_and_failed_edit_atomicity(setup):
    root, _, rect, owner, _, editor, _, shared = setup
    with pytest.raises(HTTPException):
        endpoint("/api/auth/login", "POST")(request(), Credentials(username="owner", password="wrong-password"))
    with pytest.raises(HTTPException) as error:
        endpoint("/api/shared/{document_id}/edit", "POST")(shared["id"], owner, SharedEdit(expectedVersion=1, edit={"operation": "text", "rect": rect, "text": "Far too much text " * 200, "fontSize": 14}))
    assert error.value.status_code == 422
    assert endpoint("/api/shared/{document_id}")(shared["id"], owner)["version"] == 1
    endpoint("/api/auth/logout", "POST")(owner)
    with pytest.raises(HTTPException) as error:
        endpoint("/api/auth/me")(owner)
    assert error.value.status_code == 401


def test_owner_can_cancel_pending_invite(setup):
    _, _, _, owner, _, editor, _, shared = setup
    invitation = endpoint("/api/shared/{document_id}/invites", "POST")(shared["id"], owner, InviteCreate(role="editor"))
    pending = endpoint("/api/shared/{document_id}/invites")(shared["id"], owner)["invites"]
    assert len(pending) == 1
    with pytest.raises(HTTPException):
        endpoint("/api/shared/{document_id}/invites/{invite_id}", "DELETE")(shared["id"], pending[0]["id"], editor)
    endpoint("/api/shared/{document_id}/invites/{invite_id}", "DELETE")(shared["id"], pending[0]["id"], owner)
    with pytest.raises(HTTPException) as error:
        endpoint("/api/shared/join", "POST")(editor, Join(token=invitation["token"]))
    assert error.value.status_code == 404
