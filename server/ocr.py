"""Discover a local OCR executable and its installed languages."""
import os
from pathlib import Path
import shutil
import subprocess


def executable():
    configured = os.environ.get("FOLIO_TESSERACT")
    candidates = [configured, shutil.which("tesseract")]
    for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]:
        base = os.environ.get(variable)
        if base:
            candidates.extend([str(Path(base) / "Tesseract-OCR" / "tesseract.exe"),
                               str(Path(base) / "Programs" / "Tesseract-OCR" / "tesseract.exe")])
    return next((candidate for candidate in candidates if candidate and Path(candidate).is_file()), None)


def readiness():
    path = executable()
    if path is None:
        return {"available": False, "languages": [], "message": "Install Tesseract with language data, or set FOLIO_TESSERACT to its executable."}
    try:
        result = subprocess.run([path, "--list-langs"], capture_output=True, text=True, timeout=5, check=True)
        languages = [line.strip() for line in result.stdout.splitlines() if line.strip() and not line.startswith("List of available")]
        return {"available": bool(languages), "languages": languages, "message": "" if languages else "Install Tesseract language data."}
    except (OSError, subprocess.SubprocessError):
        return {"available": False, "languages": [], "message": "Tesseract was found but its language data could not be loaded."}
