import pytest


@pytest.fixture(autouse=True)
def permit_test_client_host(monkeypatch):
    # Starlette's in-process client uses this host, independently of production hosts.
    monkeypatch.setenv("FOLIO_ALLOWED_ORIGINS", "http://testserver")
