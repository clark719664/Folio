# Run from the repository root with: python -m PyInstaller desktop/Folio.spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

root = Path(SPECPATH).parent
datas = [(str(root / "dist"), "dist"), (str(root / "LICENSE"), ".")]
datas += collect_data_files("webview")
hiddenimports = ["webview.platforms.winforms", "webview.platforms.edgechromium", "clr", "pythonnet",
                 "uvicorn.logging", "uvicorn.loops.asyncio", "uvicorn.protocols.http.h11_impl", "uvicorn.lifespan.on"]
a = Analysis([str(root / "desktop" / "launcher.py")], pathex=[str(root)],
             binaries=collect_dynamic_libs("webview"), datas=datas, hiddenimports=hiddenimports,
             hookspath=[], hooksconfig={}, runtime_hooks=[],
             excludes=["pytest", "tkinter", "IPython", "matplotlib", "PyQt5", "PyQt6", "PySide6"], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Folio", debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, console=False,
          disable_windowed_traceback=False, uac_admin=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="Folio")
