import threading
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from starlette.requests import Request

import conversion
import shared
import static_site


def test_public_bootstrap_requires_secret_then_stops_applying(tmp_path, monkeypatch):
    monkeypatch.setenv('FOLIO_PUBLIC', '1')
    def request(token=''):
        return Request({'type': 'http', 'method': 'POST', 'path': '/api/auth/signup', 'headers': [(b'x-folio-bootstrap', token.encode())]})
    with shared.database(tmp_path) as db:
        with pytest.raises(HTTPException) as error:
            shared.bootstrap_guard(db, request())
        assert error.value.status_code == 403
        monkeypatch.setenv('FOLIO_BOOTSTRAP_TOKEN', 'a' * 40)
        with pytest.raises(HTTPException):
            shared.bootstrap_guard(db, request('wrong'))
        shared.bootstrap_guard(db, request('a' * 40))
        db.execute('INSERT INTO users VALUES(?,?,?,?,?)', ('owner', 'owner', 'Owner', b'salt', b'hash'))
        shared.bootstrap_guard(db, request())


def test_static_spa_boundary(tmp_path, monkeypatch):
    (tmp_path / 'index.html').write_text('<h1>Folio</h1>')
    (tmp_path / 'asset.js').write_text('document.title="Folio"')
    monkeypatch.setenv('FOLIO_STATIC_DIR', str(tmp_path))
    app = FastAPI()
    static_site.register(app)
    endpoint = app.routes[-1].endpoint
    assert Path(endpoint('shared/session').path).name == 'index.html'
    assert Path(endpoint('asset.js').path).name == 'asset.js'
    for path in ['api/not-real', '../private.txt', 'missing.js']:
        with pytest.raises(HTTPException) as error:
            endpoint(path)
        assert error.value.status_code == 404


def test_conversion_saturation_and_slot_release(monkeypatch):
    slot = threading.BoundedSemaphore(1)
    monkeypatch.setattr(conversion, 'CONVERSION_SLOTS', slot)
    slot.acquire()
    with pytest.raises(ValueError, match='busy'):
        conversion.convert_bytes(b'text', 'txt')
    slot.release()
    with pytest.raises(ValueError):
        conversion.convert_bytes(b'x', 'unsupported')
    assert conversion.convert_bytes(b'Available after failure', 'txt').startswith(b'%PDF')
