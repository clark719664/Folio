"""Serve the built SPA without swallowing API errors or exposing arbitrary files."""
import os
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse


def register(app):
    configured = os.environ.get('FOLIO_STATIC_DIR')
    root = Path(configured).resolve() if configured else Path(__file__).resolve().parent.parent / 'dist'
    if not (root / 'index.html').is_file():
        return

    @app.get('/{asset_path:path}', include_in_schema=False)
    def frontend(asset_path: str):
        if asset_path == 'api' or asset_path.startswith('api/'):
            raise HTTPException(404, 'API endpoint not found')
        target = (root / asset_path).resolve()
        if not target.is_relative_to(root):
            raise HTTPException(404, 'File not found')
        if target.is_file():
            return FileResponse(target)
        if Path(asset_path).suffix:
            raise HTTPException(404, 'File not found')
        return FileResponse(root / 'index.html', headers={'Cache-Control': 'no-cache'})
