# -*- mode: python ; coding: utf-8 -*-
# Claude Usage Monitor — PyInstaller spec

import os

ROOT = os.path.dirname(os.path.abspath(SPEC))          # noqa: F821

a = Analysis(
    [os.path.join(ROOT, 'main.py')],
    pathex=[ROOT],
    binaries=[],
    datas=[
        (os.path.join(ROOT, 'assets', 'icon.ico'), 'assets'),  # bundle icon
        (os.path.join(ROOT, 'assets', 'claude-header.png'), 'assets'),  # bundle header icon
    ],
    hiddenimports=[
        'PyQt6.QtCore',
        'PyQt6.QtGui',
        'PyQt6.QtWidgets',
        'PyQt6.sip',
        'requests',
        'urllib3',
        'certifi',
        'charset_normalizer',
        'idna',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter', 'matplotlib', 'numpy', 'pandas',
        'scipy', 'PIL', 'cv2', 'sklearn',
    ],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(a.pure)                                      # noqa: F821

exe = EXE(                                             # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='Claude-Widget',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,                  # GUI only — no console window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(ROOT, 'assets', 'icon.ico'),
    version_file=None,
)
