"""Local library metadata and immutable revision ancestry."""
from __future__ import annotations

from contextvars import ContextVar
from contextlib import contextmanager
import re
import sqlite3
import time
import uuid
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel, Field

PARENT_REVISION = ContextVar("folio_parent_revision", default=None)
IDENTIFIER = re.compile(r"^[a-f0-9]{32}$")


class LibraryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    folder: str | None = Field(default=None, max_length=120)
    favorite: bool | None = None


class RecoveryState(BaseModel):
    documentId: str
    page: int = Field(default=0, ge=0)
    zoom: float = Field(default=1, ge=0.1, le=8)


@contextmanager
def connect(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(root / "library.sqlite3", timeout=30)
    connection.row_factory = sqlite3.Row
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version > 1:
        connection.close()
        raise HTTPException(503, "This library was created by a newer Folio version")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT NOT NULL DEFAULT '',
            favorite INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
            document_id TEXT NOT NULL REFERENCES documents(id),
            parent_id TEXT REFERENCES revisions(id), created REAL NOT NULL,
            restored_from TEXT REFERENCES revisions(id));
        CREATE INDEX IF NOT EXISTS revisions_document ON revisions(document_id, sequence);
        CREATE TABLE IF NOT EXISTS recovery (
            client TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id),
            page INTEGER NOT NULL, zoom REAL NOT NULL, updated REAL NOT NULL);
        PRAGMA user_version=1;
    """)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def validate_id(revision):
    if not IDENTIFIER.fullmatch(revision):
        raise HTTPException(404, "Document not found")


def seed_legacy(root, connection):
    known = {row[0] for row in connection.execute("SELECT id FROM revisions")}
    for path in sorted(Path(root).glob("*.pdf"), key=lambda item: item.stat().st_mtime):
        revision = path.stem
        if revision in known or not IDENTIFIER.fullmatch(revision):
            continue
        sidecar = path.with_suffix(".name")
        name = sidecar.read_text(encoding="utf-8") if sidecar.exists() else "Document.pdf"
        created = path.stat().st_mtime
        connection.execute("INSERT OR IGNORE INTO documents(id,name,created) VALUES(?,?,?)", (revision, name, created))
        connection.execute("INSERT OR IGNORE INTO revisions(id,document_id,created) VALUES(?,?,?)", (revision, revision, created))


def record_revision(root, revision, name, parent=None, restored_from=None):
    validate_id(revision)
    if not (Path(root) / f"{revision}.pdf").is_file():
        raise HTTPException(404, "Document file not found")
    with connect(root) as connection:
        connection.execute("BEGIN IMMEDIATE")
        # Seed parents before recording this output, so crashes never hide recoverable files.
        if parent and connection.execute("SELECT 1 FROM revisions WHERE id=?", (parent,)).fetchone() is None:
            seed_legacy(root, connection)
        parent_row = connection.execute("SELECT document_id FROM revisions WHERE id=?", (parent,)).fetchone() if parent else None
        document_id = parent_row[0] if parent_row else revision
        if parent_row is None:
            connection.execute("INSERT OR IGNORE INTO documents(id,name,created) VALUES(?,?,?)", (document_id, name, time.time()))
        connection.execute("INSERT INTO revisions(id,document_id,parent_id,created,restored_from) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id,parent_id=excluded.parent_id,restored_from=excluded.restored_from",
                           (revision, document_id, parent if parent_row else None, time.time(), restored_from))


def document_name(root, revision):
    if not (Path(root) / "library.sqlite3").exists():
        return None
    with connect(root) as connection:
        row = connection.execute("SELECT d.name FROM documents d JOIN revisions r ON r.document_id=d.id WHERE r.id=?", (revision,)).fetchone()
        return row[0] if row else None


def library_rows(root, query="", folder=None, favorites=False):
    with connect(root) as connection:
        connection.execute("BEGIN IMMEDIATE")
        seed_legacy(root, connection)
        rows = connection.execute("""SELECT d.*,r.id AS revision_id,r.created AS updated,
            (SELECT count(*) FROM revisions x WHERE x.document_id=d.id) AS revision_count
            FROM documents d JOIN revisions r ON r.sequence=(SELECT max(sequence) FROM revisions x WHERE x.document_id=d.id)
            ORDER BY r.sequence DESC""").fetchall()
    return [{"id": row["id"], "documentId": row["revision_id"], "name": row["name"], "folder": row["folder"],
             "favorite": bool(row["favorite"]), "created": row["created"], "updated": row["updated"], "revisionCount": row["revision_count"]}
            for row in rows if (not query or query.casefold() in row["name"].casefold())
            and (folder is None or folder == row["folder"]) and (not favorites or row["favorite"])
            and (Path(root) / f"{row['revision_id']}.pdf").is_file()]


def register(app, root_getter, location, open_document, describe, lock):
    @app.middleware("http")
    async def revision_context(request, call_next):
        match = re.match(r"^/api/documents/([a-f0-9]{32})(?:/|$)", request.url.path)
        token = PARENT_REVISION.set(match.group(1) if match and request.method in {"POST", "PUT", "PATCH"} else None)
        try:
            return await call_next(request)
        finally:
            PARENT_REVISION.reset(token)

    @app.get("/api/library")
    def listing(query: str = "", folder: str | None = None, favorites: bool = False):
        return {"documents": library_rows(root_getter(), query, folder, favorites)}

    @app.patch("/api/library/{revision_id}")
    def update(revision_id: str, request: LibraryUpdate):
        location(revision_id)
        if request.name is not None and (request.name.strip() == "" or any(character in request.name for character in '\\/:*?"<>|\r\n') or any(ord(character) < 32 for character in request.name)):
            raise HTTPException(422, "Choose a filename without path separators or reserved characters")
        with connect(root_getter()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            seed_legacy(root_getter(), connection)
            document_id = connection.execute("SELECT document_id FROM revisions WHERE id=?", (revision_id,)).fetchone()[0]
            for column, value in request.model_dump(exclude_none=True).items():
                # Column names come only from the fixed Pydantic schema.
                connection.execute(f"UPDATE documents SET {column}=? WHERE id=?", (value, document_id))
        return next(row for row in library_rows(root_getter()) if row["id"] == document_id)

    @app.get("/api/documents/{document_id}/history")
    def history(document_id: str):
        location(document_id)
        with connect(root_getter()) as connection:
            seed_legacy(root_getter(), connection)
            rows = connection.execute("SELECT * FROM revisions WHERE document_id=(SELECT document_id FROM revisions WHERE id=?) ORDER BY sequence DESC", (document_id,)).fetchall()
        return {"revisions": [{"id": row["id"], "parentId": row["parent_id"], "created": row["created"], "restoredFrom": row["restored_from"]} for row in rows]}

    @app.post("/api/documents/{document_id}/restore")
    def restore(document_id: str):
        source = location(document_id)
        with lock:
            prior = history(document_id)["revisions"]
            latest = prior[0]["id"]
            new_id = uuid.uuid4().hex
            target = source.parent / f"{new_id}.pdf"
            temporary = target.with_suffix(".tmp")
            temporary.write_bytes(source.read_bytes())
            temporary.replace(target)
            name = document_name(root_getter(), document_id) or "Restored.pdf"
            target.with_suffix(".name").write_text(name, encoding="utf-8")
            record_revision(root_getter(), new_id, name, latest, document_id)
            with open_document(new_id) as doc:
                return describe(new_id, doc)

    @app.put("/api/library-recovery/{client}")
    def save_recovery(client: str, state: RecoveryState):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", client):
            raise HTTPException(422, "Invalid recovery identifier")
        with open_document(state.documentId) as doc:
            if state.page >= len(doc):
                raise HTTPException(422, "Page index is outside this document")
        with connect(root_getter()) as connection:
            seed_legacy(root_getter(), connection)
            connection.execute("INSERT INTO recovery VALUES(?,?,?,?,?) ON CONFLICT(client) DO UPDATE SET revision_id=excluded.revision_id,page=excluded.page,zoom=excluded.zoom,updated=excluded.updated", (client, state.documentId, state.page, state.zoom, time.time()))
        return state.model_dump()

    @app.get("/api/library-recovery/{client}")
    def recovery(client: str):
        with connect(root_getter()) as connection:
            row = connection.execute("SELECT * FROM recovery WHERE client=?", (client,)).fetchone()
        if row is None:
            return {"state": None}
        return {"state": {"documentId": row["revision_id"], "page": row["page"], "zoom": row["zoom"], "updated": row["updated"]}}
