"""Standalone Linux service with a system-browser interface."""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
import webbrowser

from launcher import exercise_service, request_json


def exercise_office(base: str, fixtures: Path) -> list[str]:
    checked = []
    for extension in ("docx", "xlsx", "pptx"):
        source = fixtures / f"smoke.{extension}"
        boundary = uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{source.name}"\r\n'
                'Content-Type: application/octet-stream\r\n\r\n').encode()
        body += source.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
        result = request_json(base + "/api/convert", body,
                              {"Content-Type": f"multipart/form-data; boundary={boundary}"})
        assert len(result["documents"]) == 1, result
        document_id = result["documents"][0]["id"]
        extracted = request_json(f"{base}/api/documents/{document_id}/pages/0/text")
        assert "Folio office smoke" in extracted["text"], extracted
        checked.append(extension)
    return checked


def main() -> int:
    parser = argparse.ArgumentParser(description="Open Folio in your browser; Ctrl+C stops the local service.")
    parser.add_argument("--smoke-test", action="store_true")
    parser.add_argument("--office-fixtures", type=Path)
    parser.add_argument("--result", type=Path)
    args = parser.parse_args()
    bundled = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    if not getattr(sys, "frozen", False):
        sys.path.insert(0, str(bundled))
    data_home = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "Folio"
    scratch = tempfile.TemporaryDirectory(prefix="folio-linux-smoke-") if args.smoke_test else None
    home = Path(scratch.name) if scratch else data_home
    home.mkdir(parents=True, exist_ok=True)
    os.environ["FOLIO_DATA_DIR"] = str(home / "data")
    os.environ["FOLIO_STATIC_DIR"] = str(bundled / "dist")
    os.environ["FOLIO_PUBLIC"] = "0"
    logging.basicConfig(filename=home / "desktop.log", level=logging.INFO)
    report = {"ok": False, "frozen": bool(getattr(sys, "frozen", False))}
    server = thread = listener = None
    try:
        import uvicorn
        from server.app import app
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        base = f"http://127.0.0.1:{listener.getsockname()[1]}"
        server = uvicorn.Server(uvicorn.Config(app, log_config=None, access_log=False,
                                             loop="asyncio", http="h11", ws="none"))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        deadline = time.monotonic() + 30
        last_error = None
        while time.monotonic() < deadline:
            if not thread.is_alive():
                raise RuntimeError("The local PDF service stopped before it was ready.")
            try:
                with urllib.request.urlopen(base + "/api/health", timeout=1) as response:
                    assert response.status == 200
                break
            except (OSError, ValueError) as error:
                last_error = error
                time.sleep(0.1)
        else:
            raise RuntimeError(f"The local PDF service did not start within 30 seconds: {last_error}")
        if args.smoke_test:
            report.update(exercise_service(base))
            if args.office_fixtures:
                assert report["officeAvailable"], "LibreOffice is required for Office smoke tests"
                report["officeConversions"] = exercise_office(base, args.office_fixtures)
        else:
            print(f"Folio is running at {base}\nKeep this terminal open. Press Ctrl+C to stop.", flush=True)
            if not webbrowser.open(base):
                print("Open the address above in your browser.", flush=True)
            try:
                while thread.is_alive():
                    thread.join(timeout=1)
            except KeyboardInterrupt:
                pass
        report["ok"] = True
    except Exception as error:
        logging.exception("Folio could not start")
        report["error"] = str(error)
        print(f"Folio could not start: {error}\nDetails: {home / 'desktop.log'}", file=sys.stderr)
    finally:
        if server:
            server.should_exit = True
        if thread:
            thread.join(timeout=10)
        if listener:
            listener.close()
        if args.result:
            args.result.parent.mkdir(parents=True, exist_ok=True)
            args.result.write_text(json.dumps(report, indent=2), encoding="utf-8")
        logging.shutdown()
        if scratch:
            scratch.cleanup()
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
