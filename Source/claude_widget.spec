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
        # Bundle the entire fonts/ directory (only if it exists at build time).
        # Drop SUIT-SemiBold.ttf into Source/assets/fonts/ before building
        # to ship it with the binary; otherwise the runtime falls back to
        # system-installed SUIT or Segoe UI.
        *(
            [(os.path.join(ROOT, 'assets', 'fonts'), 'assets/fonts')]
            if os.path.isdir(os.path.join(ROOT, 'assets', 'fonts'))
            else []
        ),
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
        # Heavy ML/scientific stacks — never imported by main.py
        'tkinter', 'matplotlib', 'numpy', 'pandas',
        'scipy', 'PIL', 'cv2', 'sklearn',
        # Qt modules we don't use (PyInstaller often pulls them by default)
        'PyQt6.QtNetwork', 'PyQt6.QtMultimedia', 'PyQt6.QtMultimediaWidgets',
        'PyQt6.QtSql', 'PyQt6.QtPrintSupport', 'PyQt6.QtSvg', 'PyQt6.QtSvgWidgets',
        'PyQt6.QtTest', 'PyQt6.QtXml', 'PyQt6.QtOpenGL', 'PyQt6.QtOpenGLWidgets',
        'PyQt6.QtPdf', 'PyQt6.QtPdfWidgets', 'PyQt6.QtQuick', 'PyQt6.QtQml',
        'PyQt6.QtWebEngineCore', 'PyQt6.QtWebEngineWidgets', 'PyQt6.QtWebChannel',
        'PyQt6.QtBluetooth', 'PyQt6.QtSerialPort', 'PyQt6.QtNfc',
        'PyQt6.QtSensors', 'PyQt6.QtPositioning', 'PyQt6.QtLocation',
        # Std-lib pieces we never reach in this app
        'unittest', 'pydoc', 'doctest', 'xmlrpc', 'pickletools',
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
