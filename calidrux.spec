"""PyInstaller spec — Calidrux lightweight build (FastAPI + pywebview)."""

from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None
root = Path(SPECPATH)

binaries = []
datas = [
    # Static frontend files served by FastAPI
    (str(root / "src" / "calidrux" / "api" / "static"), "static"),
    # Sample CSV seed data
    (str(root / "data" / "seed"), "data/seed"),
]
hiddenimports = [
    # Application modules
    "calidrux",
    "calidrux.main",
    "calidrux.config",
    "calidrux.seed",
    "calidrux.db.session",
    "calidrux.db.models",
    "calidrux.api.app",
    # uvicorn internals that PyInstaller misses
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.config",
    # starlette / fastapi
    "starlette.routing",
    "starlette.staticfiles",
    "starlette.responses",
    "anyio",
    "anyio.lowlevel",
    # DB
    "sqlalchemy.dialects.sqlite",
    "alembic",
]

# Collect everything OR-Tools needs (native DLLs + hidden imports)
for pkg in ("ortools",):
    _bins, _datas, _hidden = collect_all(pkg)
    binaries += _bins
    datas    += _datas
    hiddenimports += _hidden

a = Analysis(
    [str(root / "src" / "calidrux" / "main.py")],
    pathex=[str(root / "src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "tkinter", "PySide6", "matplotlib", "shiboken6", "IPython", "notebook"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Calidrux",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    version=str(root / "installer" / "version_info.txt") if (root / "installer" / "version_info.txt").exists() else None,
    icon=str(root / "installer" / "calidrux.ico") if (root / "installer" / "calidrux.ico").exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="Calidrux",
)
