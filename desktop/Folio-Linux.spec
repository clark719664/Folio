# Build on Linux from the repository root.
from pathlib import Path

root = Path(SPECPATH).parent
a = Analysis([str(root / "desktop/launcher_linux.py")],
             pathex=[str(root), str(root / "desktop")],
             binaries=[], datas=[(str(root / "dist"), "dist"), (str(root / "LICENSE"), ".")],
             hiddenimports=["uvicorn.logging", "uvicorn.loops.asyncio",
                            "uvicorn.protocols.http.h11_impl", "uvicorn.lifespan.on"],
             excludes=["webview", "clr", "pythonnet", "pytest", "tkinter", "IPython",
                       "matplotlib", "PyQt5", "PyQt6", "PySide6"], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Folio", debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="Folio")
