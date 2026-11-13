"""Authenticated local collaboration with atomic immutable PDF versions."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
import uuid
from urllib.parse import urlparse

import pymupdf as fitz
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from typing import Literal

COOKIE = "folio_session"
MAX_PDF_BYTES = 100 * 1024 * 1024
ROLES = {"viewer": 0, "commenter": 1, "editor": 2, "owner": 3}


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=60, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=10, max_length=512)
    displayName: str = Field(default="", max_length=120)


class CreateShared(BaseModel):
    documentId: str
    name: str | None = Field(default=None, min_length=1, max_length=200)


class SharedEdit(BaseModel):
    expectedVersion: int = Field(ge=1)
    edit: dict


class CommentCreate(BaseModel):
    expectedVersion: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=10000)
    page: int = Field(ge=0)


class CommentUpdate(BaseModel):
    expectedVersion: int = Field(ge=1)
    resolved: bool


class InviteCreate(BaseModel):
    role: Literal["viewer", "commenter", "editor"]


class Join(BaseModel):
    token: str = Field(min_length=20, max_length=200)


class Presence(BaseModel):
    page: int = Field(ge=0)


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, maxmem=64 * 1024 * 1024)


@contextmanager
def database(root):
    directory = Path(root) / "shared"
    directory.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(directory / "shared.sqlite3", timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL, salt BLOB NOT NULL, password BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,name TEXT NOT NULL,version INTEGER NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions(document_id TEXT NOT NULL REFERENCES documents(id),version INTEGER NOT NULL,
          pdf BLOB NOT NULL,author TEXT NOT NULL REFERENCES users(id),created REAL NOT NULL,PRIMARY KEY(document_id,version));
        CREATE TABLE IF NOT EXISTS members(document_id TEXT NOT NULL REFERENCES documents(id),user_id TEXT NOT NULL REFERENCES users(id),
          role TEXT NOT NULL,PRIMARY KEY(document_id,user_id));
        CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),role TEXT NOT NULL,expires REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),user_id TEXT NOT NULL REFERENCES users(id),
          text TEXT NOT NULL,page INTEGER NOT NULL,created REAL NOT NULL,resolved INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS presence(document_id TEXT NOT NULL REFERENCES documents(id),user_id TEXT NOT NULL REFERENCES users(id),page INTEGER NOT NULL,seen REAL NOT NULL,PRIMARY KEY(document_id,user_id));
        CREATE TABLE IF NOT EXISTS login_failures(key TEXT PRIMARY KEY,count INTEGER NOT NULL,updated REAL NOT NULL);
    """)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def origin_guard(request):
    hostname = request.url.hostname
    configured = [value.strip() for value in os.environ.get("FOLIO_ALLOWED_ORIGINS", "").split(",") if value.strip()]
    allowed_hosts = {"localhost", "127.0.0.1", "::1"}
    allowed_hosts.update(urlparse(value).hostname for value in configured)
    if hostname not in allowed_hosts:
        raise HTTPException(403, "Request host is not allowed")
    origin = request.headers.get("origin")
    if origin is None:
        return
    allowed = {f"http://{host}:{port}" for host in ["localhost", "127.0.0.1"] for port in [4317, 4318, 4320, 5173, 4173, 8765]}
    allowed.update(value.strip() for value in os.environ.get("FOLIO_ALLOWED_ORIGINS", "").split(",") if value.strip())
    if origin not in allowed:
        raise HTTPException(403, "Request origin is not allowed")


def identity(connection, request):
    origin_guard(request)
    token = request.cookies.get(COOKIE, "")
    authorization = request.headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        token = authorization[7:]
    row = connection.execute("SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>?", (digest(token), time.time())).fetchone()
    if row is None:
        raise HTTPException(401, "Sign in to access shared documents")
    return row


def workspace_owner(connection, user_id):
    row = connection.execute("SELECT id FROM users ORDER BY rowid LIMIT 1").fetchone()
    return row is not None and row[0] == user_id


def access(connection, document_id, user_id, minimum="viewer"):
    row = connection.execute("SELECT d.*,m.role FROM documents d JOIN members m ON d.id=m.document_id WHERE d.id=? AND m.user_id=?", (document_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(404, "Shared document not found")
    if ROLES[row["role"]] < ROLES[minimum]:
        raise HTTPException(403, "Your role does not allow this action")
    return row


def version_check(row, expected):
    if row["version"] != expected:
        raise HTTPException(409, {"message": "This PDF changed. Refresh before applying your edit.", "currentVersion": row["version"]})


def pdf_bytes(connection, row):
    return connection.execute("SELECT pdf FROM revisions WHERE document_id=? AND version=?", (row["id"], row["version"])).fetchone()[0]


def describe_shared(doc, document_id, name):
    return {"id": document_id, "name": name, "pageCount": len(doc), "pages": [
        {"index": page.number, "width": page.cropbox.width, "height": page.cropbox.height, "rotation": page.rotation} for page in doc], "metadata": doc.metadata}


def state(connection, row):
    with fitz.open(stream=pdf_bytes(connection, row), filetype="pdf") as doc:
        descriptor = describe_shared(doc, row["id"], row["name"])
    comments = connection.execute("SELECT c.*,u.display_name FROM comments c JOIN users u ON c.user_id=u.id WHERE c.document_id=? ORDER BY c.created", (row["id"],)).fetchall()
    result = {"id": row["id"], "name": row["name"], "version": row["version"], "role": row["role"], "document": descriptor,
              "comments": [{"id": item["id"], "author": item["display_name"], "text": item["text"], "page": item["page"], "created": item["created"], "resolved": bool(item["resolved"])} for item in comments]}
    if row["role"] == "owner":
        result["members"] = [{"id": item["user_id"], "displayName": item["display_name"], "role": item["role"]} for item in connection.execute("SELECT m.*,u.display_name FROM members m JOIN users u ON m.user_id=u.id WHERE m.document_id=?", (row["id"],))]
    return result


def commit_revision(connection, row, data, user_id):
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(413, "Shared PDF exceeds 100 MB")
    version = row["version"] + 1
    changed = connection.execute("UPDATE documents SET version=?,updated=? WHERE id=? AND version=?", (version, time.time(), row["id"], row["version"]))
    if changed.rowcount != 1:
        raise HTTPException(409, "Shared document changed during this edit")
    connection.execute("INSERT INTO revisions VALUES(?,?,?,?,?)", (row["id"], version, data, user_id, time.time()))


def register(app, root_getter, location, apply_edit, Edit, checked_page, checked_rect, lock):
    @app.middleware("http")
    async def workspace_boundary(request, call_next):
        if request.url.path.startswith("/api/"):
            try:
                origin_guard(request)
                local_route = not request.url.path.startswith(("/api/auth/", "/api/shared")) and request.url.path != "/api/health"
                if local_route and (Path(root_getter()) / "shared" / "shared.sqlite3").exists():
                    with database(root_getter()) as connection:
                        if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                            user = identity(connection, request)
                            if not workspace_owner(connection, user["id"]):
                                raise HTTPException(403, "Only the workspace owner can access local files. Open Shared documents instead.")
            except HTTPException as error:
                return JSONResponse({"detail": error.detail}, status_code=error.status_code)
        response = await call_next(request)
        if request.url.path.startswith(("/api/shared", "/api/auth/")):
            response.headers["Cache-Control"] = "no-store"
        return response

    def authenticate(request, credentials, signup):
        origin_guard(request)
        username = credentials.username.lower()
        with database(root_getter()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            if signup:
                salt = secrets.token_bytes(16)
                try:
                    connection.execute("INSERT INTO users VALUES(?,?,?,?,?)", (uuid.uuid4().hex, username, credentials.displayName.strip() or username, salt, password_hash(credentials.password, salt)))
                except sqlite3.IntegrityError as error:
                    raise HTTPException(409, "That username is already in use") from error
            user = connection.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
            failure = connection.execute("SELECT * FROM login_failures WHERE key=?", (username,)).fetchone()
            if failure and failure["count"] >= 8 and time.time() - failure["updated"] < 300:
                raise HTTPException(429, "Too many sign-in attempts. Try again in five minutes")
            salt = user["salt"] if user else b"\x00" * 16
            actual = password_hash(credentials.password, salt)
            if user is None or not hmac.compare_digest(actual, user["password"]):
                count = failure["count"] + 1 if failure and time.time() - failure["updated"] < 300 else 1
                connection.execute("INSERT INTO login_failures VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,updated=excluded.updated", (username, count, time.time()))
                connection.commit()
                raise HTTPException(401, "Incorrect username or password")
            connection.execute("DELETE FROM login_failures WHERE key=?", (username,))
            token = secrets.token_urlsafe(32)
            connection.execute("INSERT INTO sessions VALUES(?,?,?)", (digest(token), user["id"], time.time() + 7 * 86400))
            response = JSONResponse({"user": {"id": user["id"], "username": username, "displayName": user["display_name"], "workspaceOwner": workspace_owner(connection, user["id"])}})
            response.set_cookie(COOKIE, token, httponly=True, secure=request.url.scheme == "https", samesite="strict", max_age=7 * 86400, path="/api")
            return response

    @app.post("/api/auth/signup")
    def signup(request: Request, credentials: Credentials):
        return authenticate(request, credentials, True)

    @app.post("/api/auth/login")
    def login(request: Request, credentials: Credentials):
        return authenticate(request, credentials, False)

    @app.get("/api/auth/me")
    def me(request: Request):
        with database(root_getter()) as connection:
            user = identity(connection, request)
            return {"user": {"id": user["id"], "username": user["username"], "displayName": user["display_name"], "workspaceOwner": workspace_owner(connection, user["id"])}}

    @app.post("/api/auth/logout")
    def logout(request: Request):
        origin_guard(request)
        with database(root_getter()) as connection:
            token = request.cookies.get(COOKIE, "")
            authorization = request.headers.get("authorization", "")
            if authorization.startswith("Bearer "):
                token = authorization[7:]
            connection.execute("DELETE FROM sessions WHERE token=?", (digest(token),))
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE, path="/api")
        return response

    @app.get("/api/shared")
    def listing(request: Request):
        with database(root_getter()) as connection:
            user = identity(connection, request)
            rows = connection.execute("SELECT d.*,m.role FROM documents d JOIN members m ON d.id=m.document_id WHERE m.user_id=? ORDER BY d.updated DESC", (user["id"],)).fetchall()
            return {"documents": [dict(row) for row in rows]}

    @app.post("/api/shared")
    def create(request: Request, payload: CreateShared):
        origin_guard(request)
        with lock, database(root_getter()) as connection:
            user = identity(connection, request)
            if not workspace_owner(connection, user["id"]):
                raise HTTPException(403, "Only the workspace owner can share a local file")
            data = location(payload.documentId).read_bytes()
            if len(data) > MAX_PDF_BYTES:
                raise HTTPException(413, "Maximum shared PDF size is 100 MB")
            with fitz.open(stream=data, filetype="pdf") as doc:
                if doc.needs_pass:
                    raise HTTPException(423, "Unlock the PDF before sharing")
            document_id = uuid.uuid4().hex
            connection.execute("INSERT INTO documents VALUES(?,?,1,?)", (document_id, payload.name or "Shared.pdf", time.time()))
            connection.execute("INSERT INTO revisions VALUES(?,1,?,?,?)", (document_id, data, user["id"], time.time()))
            connection.execute("INSERT INTO members VALUES(?,?,?)", (document_id, user["id"], "owner"))
            return state(connection, access(connection, document_id, user["id"]))

    @app.get("/api/shared/{document_id}")
    def read(document_id: str, request: Request):
        with lock, database(root_getter()) as connection:
            user = identity(connection, request)
            return state(connection, access(connection, document_id, user["id"]))

    @app.get("/api/shared/{document_id}/file")
    def file(document_id: str, request: Request):
        with database(root_getter()) as connection:
            user = identity(connection, request)
            row = access(connection, document_id, user["id"])
            return Response(pdf_bytes(connection, row), media_type="application/pdf", headers={"Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="Shared.pdf"'})

    @app.get("/api/shared/{document_id}/pages/{page_index}/render")
    def render(document_id: str, page_index: int, request: Request, scale: float = 1.5):
        if not 0.1 <= scale <= 4:
            raise HTTPException(422, "Scale must be between 0.1 and 4")
        with lock, database(root_getter()) as connection:
            user = identity(connection, request)
            row = access(connection, document_id, user["id"])
            with fitz.open(stream=pdf_bytes(connection, row), filetype="pdf") as doc:
                page = checked_page(doc, page_index)
                if page.rect.width * page.rect.height * scale * scale > 32000000:
                    raise HTTPException(413, "Requested rendering is too large")
                return Response(page.get_pixmap(matrix=fitz.Matrix(scale, scale)).tobytes("png"), media_type="image/png", headers={"Cache-Control": "no-store"})

    @app.get("/api/shared/{document_id}/pages/{page_index}/text")
    def text(document_id: str, page_index: int, request: Request):
        with lock, database(root_getter()) as connection:
            user = identity(connection, request)
            row = access(connection, document_id, user["id"])
            with fitz.open(stream=pdf_bytes(connection, row), filetype="pdf") as doc:
                page = checked_page(doc, page_index)
                spans = [{**span, "block": bi, "line": li, "direction": line.get("dir", [1, 0])} for bi, block in enumerate(page.get_text("dict")["blocks"]) for li, line in enumerate(block.get("lines", [])) for span in line["spans"]]
                return {"page": page_index, "width": page.cropbox.width, "height": page.cropbox.height, "rotation": page.rotation, "spans": spans, "text": page.get_text()}

    @app.post("/api/shared/{document_id}/edit")
    def edit(document_id: str, request: Request, payload: SharedEdit):
        origin_guard(request)
        try:
            operation = Edit.model_validate(payload.edit)
        except ValueError as error:
            raise HTTPException(422, "Invalid PDF edit") from error
        if operation.operation not in {"text", "redact", "annotate", "rotate", "reorder", "delete", "metadata"}:
            raise HTTPException(422, "This operation is not available in shared editing")
        with lock, database(root_getter()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            user = identity(connection, request)
            row = access(connection, document_id, user["id"], "commenter" if operation.operation == "annotate" else "editor")
            version_check(row, payload.expectedVersion)
            with fitz.open(stream=pdf_bytes(connection, row), filetype="pdf") as doc:
                apply_edit(doc, operation)
                data = doc.tobytes(garbage=4, deflate=True)
            commit_revision(connection, row, data, user["id"])
            return state(connection, access(connection, document_id, user["id"]))

    @app.post("/api/shared/{document_id}/comments")
    def comment(document_id: str, request: Request, payload: CommentCreate):
        origin_guard(request)
        with lock, database(root_getter()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            user = identity(connection, request)
            row = access(connection, document_id, user["id"], "commenter")
            version_check(row, payload.expectedVersion)
            data = pdf_bytes(connection, row)
            with fitz.open(stream=data, filetype="pdf") as doc:
                checked_page(doc, payload.page)
            connection.execute("INSERT INTO comments VALUES(?,?,?,?,?,?,0)", (uuid.uuid4().hex, document_id, user["id"], payload.text, payload.page, time.time()))
            commit_revision(connection, row, data, user["id"])
            return state(connection, access(connection, document_id, user["id"]))

    @app.patch("/api/shared/{document_id}/comments/{comment_id}")
    def resolve(document_id: str, comment_id: str, request: Request, payload: CommentUpdate):
        origin_guard(request)
        with lock, database(root_getter()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            user = identity(connection, request)
            row = access(connection, document_id, user["id"], "commenter")
            version_check(row, payload.expectedVersion)
            found = connection.execute("SELECT * FROM comments WHERE id=? AND document_id=?", (comment_id, document_id)).fetchone()
            if found is None:
                raise HTTPException(404, "Comment not found")
            if found["user_id"] != user["id"] and ROLES[row["role"]] < ROLES["editor"]:
                raise HTTPException(403, "Only the author or an editor can resolve this comment")
            connection.execute("UPDATE comments SET resolved=? WHERE id=?", (payload.resolved, comment_id))
            commit_revision(connection, row, pdf_bytes(connection, row), user["id"])
            return state(connection, access(connection, document_id, user["id"]))

    @app.post("/api/shared/{document_id}/invites")
    def invite(document_id: str, request: Request, payload: InviteCreate):
        origin_guard(request)
        with database(root_getter()) as connection:
            user = identity(connection, request)
            access(connection, document_id, user["id"], "owner")
            token = secrets.token_urlsafe(32)
            expires = time.time() + 86400
            connection.execute("INSERT INTO invites VALUES(?,?,?,?,0)", (digest(token), document_id, payload.role, expires))
            return {"token": token, "expires": expires}

    @app.get("/api/shared/{document_id}/invites")
    def invitations(document_id: str, request: Request):
        with database(root_getter()) as connection:
            user = identity(connection, request)
            access(connection, document_id, user["id"], "owner")
            rows = connection.execute("SELECT token,role,expires FROM invites WHERE document_id=? AND used=0 AND expires>?", (document_id, time.time())).fetchall()
            return {"invites": [{"id": row["token"], "role": row["role"], "expires": row["expires"]} for row in rows]}

    @app.delete("/api/shared/{document_id}/invites/{invite_id}")
    def cancel_invite(document_id: str, invite_id: str, request: Request):
        origin_guard(request)
        with database(root_getter()) as connection:
            user = identity(connection, request)
            access(connection, document_id, user["id"], "owner")
            deleted = connection.execute("DELETE FROM invites WHERE document_id=? AND token=? AND used=0", (document_id, invite_id))
            if deleted.rowcount != 1:
                raise HTTPException(404, "Pending invitation not found")
            return {"ok": True}

    @app.post("/api/shared/join")
    def join(request: Request, payload: Join):
        origin_guard(request)
        with lock, database(root_getter()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            user = identity(connection, request)
            invitation = connection.execute("SELECT * FROM invites WHERE token=? AND expires>? AND used=0", (digest(payload.token), time.time())).fetchone()
            if invitation is None:
                raise HTTPException(404, "Invitation has expired or was already used")
            existing = connection.execute("SELECT role FROM members WHERE document_id=? AND user_id=?", (invitation["document_id"], user["id"])).fetchone()
            if existing:
                raise HTTPException(409, "You already have access to this document")
            connection.execute("INSERT INTO members VALUES(?,?,?)", (invitation["document_id"], user["id"], invitation["role"]))
            connection.execute("UPDATE invites SET used=1 WHERE token=?", (digest(payload.token),))
            return state(connection, access(connection, invitation["document_id"], user["id"]))

    @app.delete("/api/shared/{document_id}/members/{user_id}")
    def revoke(document_id: str, user_id: str, request: Request):
        origin_guard(request)
        with lock, database(root_getter()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            user = identity(connection, request)
            row = access(connection, document_id, user["id"], "owner")
            target = connection.execute("SELECT role FROM members WHERE document_id=? AND user_id=?", (document_id, user_id)).fetchone()
            if target is None:
                raise HTTPException(404, "Member not found")
            if target["role"] == "owner":
                raise HTTPException(422, "The document owner cannot be removed")
            connection.execute("DELETE FROM members WHERE document_id=? AND user_id=?", (document_id, user_id))
            connection.execute("DELETE FROM presence WHERE document_id=? AND user_id=?", (document_id, user_id))
            return state(connection, row)

    @app.post("/api/shared/{document_id}/presence")
    def presence(document_id: str, request: Request, payload: Presence):
        origin_guard(request)
        with lock, database(root_getter()) as connection:
            user = identity(connection, request)
            row = access(connection, document_id, user["id"])
            with fitz.open(stream=pdf_bytes(connection, row), filetype="pdf") as doc:
                checked_page(doc, payload.page)
            connection.execute("INSERT INTO presence VALUES(?,?,?,?) ON CONFLICT(document_id,user_id) DO UPDATE SET page=excluded.page,seen=excluded.seen", (document_id, user["id"], payload.page, time.time()))
            rows = connection.execute("SELECT p.*,u.display_name FROM presence p JOIN users u ON p.user_id=u.id JOIN members m ON m.document_id=p.document_id AND m.user_id=p.user_id WHERE p.document_id=? AND p.seen>?", (document_id, time.time() - 60)).fetchall()
            return {"presence": [{"userId": item["user_id"], "displayName": item["display_name"], "page": item["page"], "seen": item["seen"]} for item in rows]}
