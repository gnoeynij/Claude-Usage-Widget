# Claude Usage Monitor (PyQt6) — 설치 & 빌드 가이드

## 1. 사전 요구사항

Python **3.10 이상** 정식 설치 필요.

### Python 설치
1. <https://www.python.org/downloads/> 에서 최신 버전 다운로드
2. 설치 시 **"Add Python to PATH"** 반드시 체크

---

## 2. 패키지 설치

```powershell
cd "C:\Users\GeumdoSys\Desktop\Claude-Widget-Cross"
python -m pip install -r requirements.txt
```

`requirements.txt` 내용:
```
PyQt6>=6.6.0
requests>=2.31.0
```

---

## 3. 실행

```powershell
python main.py
```

---

## 4. PyInstaller로 단일 .exe 빌드

```powershell
# PyInstaller 설치
python -m pip install pyinstaller

# 단일 exe 빌드 (콘솔 창 숨김, 아이콘 포함)
pyinstaller --onefile --windowed --name "Claude-Widget" main.py
```

빌드 완료 후 `dist\Claude-Widget.exe` 파일이 생성됩니다.

### 고급 빌드 옵션 (.spec 파일 사용)

```python
# claude_widget.spec
# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'PyQt6.QtCore',
        'PyQt6.QtGui',
        'PyQt6.QtWidgets',
        'requests',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
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
    console=False,      # 콘솔 창 숨김 (GUI 전용)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
```

```powershell
pyinstaller claude_widget.spec
```

---

## 5. 윈도우 시작 프로그램 등록 (자동 실행)

빌드된 exe를 시작프로그램에 등록:

```powershell
$exe = "C:\Users\GeumdoSys\Desktop\Claude-Widget-Cross\dist\Claude-Widget.exe"
$startup = [System.Environment]::GetFolderPath("Startup")
$lnk = "$startup\Claude-Widget.lnk"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($lnk)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = Split-Path $exe
$shortcut.Save()

Write-Host "시작 프로그램에 등록 완료: $lnk"
```

---

## 6. 위젯 사용법

| 기능 | 방법 |
|------|------|
| 이동 | 상단 드래그 바(──) 드래그 |
| 동기화 | 하단 [Sync] 버튼 or 트레이 우클릭 → 동기화 |
| 설정 패널 | 우상단 ⚙ 버튼 클릭 |
| 언어 변경 | 설정 → Language → English / 한국어 |
| 항상 위 | 설정 → Always on Top 버튼 토글 |
| 트레이 숨기기 | 창 X 버튼 (완전 종료 X, 트레이로 최소화) |
| 완전 종료 | 하단 [Quit] 버튼 or 트레이 → 종료 |
| 자동 동기화 | 5m / 10m / 30m / 1h / manual 선택 |

---

## 7. 인증 정보 경로

```
%USERPROFILE%\.claude\.credentials.json
```

Claude Code CLI가 로그인되어 있으면 자동 감지됩니다.
JSON 구조: `{ "claudeAiOauth": { "accessToken": "..." } }`
