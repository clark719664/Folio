"""Folio's Windows entry point. The bundled backend only listens on loopback."""
from __future__ import annotations

import argparse
import ctypes
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


def request_json(url: str, data: bytes | None = None, headers: dict | None = None):
    request = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def exercise_service(base: str) -> dict:
    """Exercise packaged assets, real text conversion, PDF bytes, and rendering."""
    with urllib.request.urlopen(base, timeout=30) as response:
        assert b'<div id="root"' in response.read(), "Bundled frontend did not load"
    boundary = "FolioDesktopSmokeBoundary"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"mode\"\r\n\r\nseparate\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"smoke.txt\"\r\n"
            f"Content-Type: text/plain\r\n\r\nStandalone Folio works\r\n--{boundary}--\r\n").encode()
    result = request_json(base + "/api/convert", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
    assert len(result["documents"]) == 1, result
    document_id = result["documents"][0]["id"]
    text = request_json(f"{base}/api/documents/{document_id}/pages/0/text")
    assert "Standalone Folio works" in text["text"], text
    with urllib.request.urlopen(f"{base}/api/documents/{document_id}/file", timeout=30) as response:
        assert response.read(5) == b"%PDF-", "Download is not a PDF"
    with urllib.request.urlopen(f"{base}/api/documents/{document_id}/pages/0/render", timeout=30) as response:
        assert response.read(8) == b"\x89PNG\r\n\x1a\n", "Rendering is not PNG"
    formats = request_json(base + "/api/conversion/formats")
    return {"frontend": True, "conversion": True, "pdfDownload": True, "render": True,
            "officeAvailable": formats["officeAvailable"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke-test", action="store_true")
    parser.add_argument("--smoke-window", action="store_true")
    parser.add_argument("--result", type=Path)
    args = parser.parse_args()
    bundled = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    if not getattr(sys, "frozen", False):
        sys.path.insert(0, str(bundled))
    app_home = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Folio"
    smoke = args.smoke_test or args.smoke_window
    scratch = tempfile.TemporaryDirectory(prefix="folio-desktop-smoke-", ignore_cleanup_errors=True) if smoke else None
    home = Path(scratch.name) if scratch else app_home
    home.mkdir(parents=True, exist_ok=True)
    os.environ["FOLIO_DATA_DIR"] = str(home / "data")
    os.environ["FOLIO_STATIC_DIR"] = str(bundled / "dist")
    os.environ["FOLIO_PUBLIC"] = "0"
    logging.basicConfig(filename=home / "desktop.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    server = None
    thread = None
    listener = None
    report = {"ok": False, "frozen": bool(getattr(sys, "frozen", False))}
    exit_code = 1
    try:
        import uvicorn
        from server.app import app
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        port = listener.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        server = uvicorn.Server(uvicorn.Config(app, log_config=None, access_log=False,
                                              loop="asyncio", http="h11", ws="none"))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        for _ in range(300):
            if not thread.is_alive():
                raise RuntimeError("The local PDF service stopped before it was ready.")
            try:
                request_json(base + "/api/health")
                break
            except (OSError, ValueError):
                time.sleep(.1)
        else:
            raise RuntimeError("The local PDF service did not start within 30 seconds.")
        if smoke:
            report.update(exercise_service(base))
        if not args.smoke_test:
            import webview
            webview.settings["ALLOW_DOWNLOADS"] = True
            webview.settings["ALLOW_FILE_URLS"] = False
            webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
            window = webview.create_window("Folio", base, width=1280, height=860,
                                           min_size=(700, 540), background_color="#f5f5f7")
            if args.smoke_window:
                def verify_window():
                    try:
                        title = window.evaluate_js("document.title")
                        assert "Folio" in title or "folio" in title, title
                        assert window.evaluate_js("Boolean(document.querySelector('.app'))"), "React app did not render"
                        report["nativeWindow"] = True
                    except Exception as error:
                        report["windowError"] = str(error)
                    finally:
                        window.destroy()
                def loaded():
                    check = threading.Timer(2, verify_window)
                    check.daemon = True
                    check.start()
                window.events.loaded += loaded
                watchdog = threading.Timer(45, window.destroy)
                watchdog.daemon = True
                watchdog.start()
            webview.start(gui="edgechromium", private_mode=False, storage_path=str(home / "browser"))
            if args.smoke_window:
                watchdog.cancel()
            if args.smoke_window and not report.get("nativeWindow"):
                raise RuntimeError(report.get("windowError", "Native window did not finish loading"))
        report["ok"] = True
        exit_code = 0
    except Exception as error:
        logging.exception("Folio could not start")
        report["error"] = str(error)
        if not smoke:
            ctypes.windll.user32.MessageBoxW(None,
                f"Folio could not start.\n\n{error}\n\nIf Microsoft Edge WebView2 Runtime is missing, run Install-WebView2.cmd beside Folio.exe.\n\nDetails: {home / 'desktop.log'}",
                "Folio", 0x10)
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
        if scratch:
            logging.shutdown()
            scratch.cleanup()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
