"""
Claude Usage Monitor — PyQt6 Desktop Widget
============================================
다크/라이트 모드, 다국어(ko/en), 트레이 아이콘, 드래그, 자동동기화 지원.

API  : https://api.anthropic.com/api/oauth/usage
Auth : ~/.claude/.credentials.json  (claudeAiOauth.accessToken)
Header: anthropic-beta: oauth-2025-04-20

────────────────────────────────────────────────────────────
파일 구조 한눈에 보기
────────────────────────────────────────────────────────────
1) 모듈 상수 / 폰트 로딩         (~50–110 줄)
2) THEMES (라이트/다크 팔레트)   (~110–170 줄)
3) I18N (en/ko 사전)             (~170–280 줄)
4) FetchWorker                   — 사용량 API 호출 워커
5) UpdateCheckWorker             — GitHub Releases 최신 버전 조회
6) UpdateDownloadWorker          — 새 .exe 다운로드 (스트리밍 + 취소)
7) ProgressBar                   — 임계치 색상 + 눈금 옵션 커스텀 위젯
8) ClaudeWidget                  — 메인 위젯 (헤더/카드/푸터/미니/옵션)
9) main()                        — 진입점 (단일 인스턴스 mutex 포함)
"""

from __future__ import annotations
import sys, os, json, math, random, gc, subprocess, tempfile, webbrowser
from pathlib import Path
from datetime import datetime, timezone


def resource_path(relative: str) -> str:
    """Return absolute path to bundled resource (works with PyInstaller --onefile)."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative)

import requests
from PyQt6.QtCore import (
    Qt, QTimer, QPoint, QSettings, QThread, pyqtSignal, QRect, QEvent,
    QPropertyAnimation, QEasingCurve, QSize,
)
from PyQt6.QtGui import (
    QColor, QPainter, QPainterPath, QFont, QFontDatabase, QIcon, QPixmap,
    QBrush, QPen, QLinearGradient, QAction,
)
from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, QLabel,
    QPushButton, QFrame, QSizePolicy, QSystemTrayIcon, QMenu,
    QGraphicsDropShadowEffect, QSlider, QMessageBox, QProgressDialog,
)

APP_VERSION   = "v1.4.0"
USAGE_URL     = "https://api.anthropic.com/api/oauth/usage"
LEARN_MORE_URL = "https://support.claude.com/ko/"
# GitHub Releases API — used as the auto-update backend (no separate server).
# Anonymous calls require this repo to be public; while the repo is private,
# the call returns 404 and the startup check stays silent, the manual button
# shows "확인 실패: HTTP 404". Both behaviors are intentional fallbacks.
RELEASES_API_URL = "https://api.github.com/repos/gnoeynij/Claude-Usage-Widget/releases/latest"


def _version_tuple(v: str) -> tuple[int, ...]:
    """Parse 'v1.3.10' / '1.3.10' → (1, 3, 10). Pre-release suffixes ignored.
    Non-numeric components default to 0 so malformed tags don't crash compare."""
    s = v.lstrip("vV").split("-")[0].split("+")[0]
    out: list[int] = []
    for p in s.split("."):
        try:
            out.append(int(p))
        except ValueError:
            out.append(0)
    return tuple(out)

# Default app font family — replaced at startup by _load_app_font() if SUIT
# SemiBold (open-license, sandollcloud) is available either bundled or system-installed.
APP_FONT_FAMILY = "Segoe UI"

# ── UI sizing & scaling ─────────────────────────────────────
DEFAULT_WIDGET_WIDTH = 326                      # design width — scale 1.0 baseline
SCALE_FLOOR, SCALE_CEIL = 0.85, 1.6             # clamp range for self._widget_scale
SCALE_QUANTUM = 0.05                            # quantize to this step → smooth resize
FULL_MIN_W, FULL_MIN_H = 280, 450               # full-mode minimum widget size
# 178 = empirical floor that fits "Sonnet 100%" in English at scale 0.85
# (panel border 2 + padding 4 + icon 51 + spacing 5 + label 50 + gap 3 + pct 60
#  = 175 exact, plus 3px buffer for sub-pixel font rendering).
# Korean labels are narrower so they fit comfortably at the same floor.
MINI_MIN_W, MINI_MIN_H = 178, 95                # mini-mode minimum widget size

# Mini view: label ↔ percent gap is adaptive — full at wide, tight at narrow.
MINI_GAP_BASE   = 38                            # sp(38) ≈ 1cm at 96 DPI
MINI_GAP_OFFSET = 15                            # absolute offset on top of sp(BASE)
MINI_GAP_TIGHT  = 4                             # collapsed gap at narrow width
MINI_GAP_FULL_AT  = 240                         # widget widths at/above this → full gap
MINI_GAP_FLOOR_AT = 178                         # widget widths at/below this → tight gap

# ── Auto-sync ───────────────────────────────────────────────
DEFAULT_SYNC_INTERVAL_SEC = 600                 # 10 min — gentle on shared accounts
RATE_LIMIT_BACKOFF_CAP_EXP = 4                  # 2^4 = 16× max backoff multiplier
SYNC_STARTUP_JITTER_MS = 2000                   # 0–N random delay before first sync
SYNC_JITTER_RATIO = 0.10                        # ±10% per-cycle interval jitter

SESSION = requests.Session()


def _load_app_font() -> str:
    """Resolve the application font family.

    Lookup order (first match wins):
      1. Bundled  Source/assets/fonts/SUIT-SemiBold.ttf  (loaded into QFontDatabase)
      2. System-installed family containing 'suit' in its name (case-insensitive)
      3. Segoe UI fallback

    Returns the family name to pass into QFont(...). Safe to call before any
    widgets are constructed — only depends on QApplication being instantiated.
    """
    bundled = resource_path(os.path.join("assets", "fonts", "SUIT-SemiBold.ttf"))
    if os.path.isfile(bundled):
        font_id = QFontDatabase.addApplicationFont(bundled)
        if font_id != -1:
            families = QFontDatabase.applicationFontFamilies(font_id)
            if families:
                return families[0]
    # System-installed fallback — match 'suit' loosely so both 'SUIT'
    # and 'SUIT SemiBold' (depending on installer) are accepted.
    for fam in QFontDatabase.families():
        if "suit" in fam.lower():
            return fam
    return "Segoe UI"

# ────────────────────────────────────────────────────────────
#  Theme palettes
# ────────────────────────────────────────────────────────────
THEMES: dict[str, dict] = {
    "light": {
        "panel_bg":       QColor(255, 255, 255, 218),
        "card_bg":        QColor(248, 250, 252, 245),
        "text_primary":   QColor(31,  41,  55),
        "text_secondary": QColor(107, 114, 128),
        "border":         QColor(229, 231, 235),
        "progress_bg":    QColor(229, 231, 235, 140),
        "drag_bar":       QColor(107, 114, 128, 63),
        "divider":        QColor(229, 231, 235, 128),
        # panel QSS
        "panel_qss": """
            #mainPanel {
                background: rgba(255,255,255,218);
                border-radius: 0px;
                border: 1px solid rgba(255,255,255,160);
            }
        """,
        "card_qss": """
            #glassCard {
                background: rgba(248,250,252,245);
                border: 1px solid rgba(229,231,235,160);
                border-radius: 12px;
            }
        """,
        "shadow_color": QColor(0, 0, 0, 55),
        "card_shadow":  QColor(0, 0, 0, 18),
    },
    "dark": {
        "panel_bg":       QColor(24,  27,  32,  230),
        "card_bg":        QColor(32,  36,  44,  240),
        "text_primary":   QColor(229, 231, 235),
        "text_secondary": QColor(156, 163, 175),
        "border":         QColor(55,  65,  81),
        "progress_bg":    QColor(55,  65,  81,  160),
        "drag_bar":       QColor(156, 163, 175, 90),
        "divider":        QColor(55,  65,  81,  180),
        "panel_qss": """
            #mainPanel {
                background: rgba(24,27,32,230);
                border-radius: 0px;
                border: 1px solid rgba(80,90,110,130);
            }
        """,
        "card_qss": """
            #glassCard {
                background: rgba(32,36,44,240);
                border: 1px solid rgba(55,65,81,180);
                border-radius: 12px;
            }
        """,
        "shadow_color": QColor(0, 0, 0, 120),
        "card_shadow":  QColor(0, 0, 0, 60),
    },
}

ORANGE  = QColor(217, 119, 87)
DANGER  = QColor(248, 113, 113)
WARNING = QColor(245, 158, 11)
SUCCESS = QColor(16,  185, 129)

# QSS에 그대로 꽂아 쓸 수 있는 RGB 문자열 — 각 색상의 단일 출처.
# alpha 변동이 있는 hover/disabled 상태는 호출부에서 inline rgba(...)로 합성한다.
ORANGE_RGB  = f"rgb({ORANGE.red()},{ORANGE.green()},{ORANGE.blue()})"
DANGER_RGB  = f"rgb({DANGER.red()},{DANGER.green()},{DANGER.blue()})"
SUCCESS_RGB = f"rgb({SUCCESS.red()},{SUCCESS.green()},{SUCCESS.blue()})"

# 사용량 % 임계치 — 진행바 색상과 % 라벨 색상이 동일 기준을 공유.
PCT_THRESHOLD_DANGER = 80   # ≥ 이 값 → DANGER (빨강)
PCT_THRESHOLD_WARN   = 50   # ≥ 이 값 → WARNING (주황) / 이하 → SUCCESS (초록)

# 자동 sync 간격 옵션 (초). 0 = 수동(Off).
SYNC_INTERVAL_OPTIONS_SEC = (0, 300, 600, 1800, 3600)

# 시작 시 자동 버전 체크가 발화되기까지의 지연.
# UI가 완전히 그려진 뒤 + 사용량 sync와 시점이 부딪히지 않도록 분리.
STARTUP_UPDATE_CHECK_DELAY_MS = 1500

# 번들 아이콘 자산의 상대 경로 — resource_path()와 함께 사용.
ICON_ASSET_PATH = os.path.join("assets", "icon.ico")

# ────────────────────────────────────────────────────────────
#  i18n
# ────────────────────────────────────────────────────────────
I18N: dict[str, dict] = {
    "en": {
        "appTitle":       "Claude Monitor",
        "checking":       "Checking credentials…",
        "connected":      "Connected via OAuth",
        "notLoggedIn":    "Claude Code not logged in",
        "tokenExpired":   "Token expired. Please use Claude Code to refresh",
        "currentSession": "Current session",
        "weeklyLimits":   "Weekly limits",
        "allModels":      "All models",
        "sonnetOnly":     "Sonnet only",
        "learnMore":      "Learn more",
        "autoSync":       "Auto-sync",
        "syncNote":       "Note: API has rate limits. Min 10 min recommended.",
        "sync":           "Sync",
        "quit":           "Quit",
        "closeWindow":    "Close",
        "settings":       "Settings",
        "never":          "never",
        "resetsSoon":     "Resets soon",
        "resetsIn":       lambda h, m: (f"Resets in {h}h {m}m" if h > 0 else f"Resets in {m}m"),
        "resetsAt":       lambda d: f"Resets {d}",
        "formatResetTime": lambda wd, h, m: (
            f"{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][wd]} "
            f"{h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"
        ),
        "lastSync":       lambda t: f"last sync {t}",
        "language":       "Language",
        "credentials":    "Credentials",
        "autoDetected":   "Auto-detected from credentials file",
        "notFound":       "Not found",
        "refresh":        "Refresh",
        "alwaysOnTop":    "Always on Top",
        "darkMode":       "Dark Mode",
        "trayRunning":    "Running in system tray",
        "widgetSize":     "Widget size",
        "bgOpacity":      "Background opacity",
        "manual":         "Off",
        "miniMode":       "Mini",
        "miniSession":    "Session",
        "miniAll":        "All",
        "miniSonnet":     "Sonnet",
        "miniExitTip":    "Click icon to exit mini mode",
        "miniEnterTip":   "Click icon to enter mini mode",
        "rateLimited":    "Rate limited — backing off",
        "updateSection":  "Updates",
        "checkForUpdate": "Check for Updates",
        "checkingUpdate": "Checking…",
        "upToDate":       lambda v: f"Up to date ({v})",
        "updateAvailable": lambda v: f"Update available: {v}",
        "updateAvailableMsg": lambda new, cur: (
            f"A new version ({new}) is available.\nCurrent: {cur}\n\n"
            "Download to your Downloads folder and restart now?"
        ),
        "downloading":    lambda p: f"Downloading… {p}%",
        "downloadFailed": "Download failed",
        "checkFailed":    "Check failed",
        "restartingNow":  "Restarting…",
        "cancel":         "Cancel",
        "upToDateShort":   "✓ Up to date",
        "newVersionShort": lambda v: f"● New: {v}",
    },
    "ko": {
        "appTitle":       "Claude 모니터",
        "checking":       "인증 정보 확인 중…",
        "connected":      "OAuth 연결됨",
        "notLoggedIn":    "Claude Code 로그인 필요",
        "tokenExpired":   "토큰 만료. Claude Code를 한 번 실행해주세요",
        "currentSession": "현재 세션",
        "weeklyLimits":   "주간 사용량",
        "allModels":      "전체 모델",
        "sonnetOnly":     "Sonnet 전용",
        "learnMore":      "자세히 알아보기",
        "autoSync":       "자동 동기화",
        "syncNote":       "참고: API 속도 제한. 최소 10분 권장.",
        "sync":           "동기화",
        "quit":           "종료",
        "closeWindow":    "닫기",
        "settings":       "설정",
        "never":          "동기화 안됨",
        "resetsSoon":     "곧 초기화",
        "resetsIn":       lambda h, m: (f"{h}시간 {m}분 후 초기화" if h > 0 else f"{m}분 후 초기화"),
        "resetsAt":       lambda d: f"{d}에 초기화",
        "formatResetTime": lambda wd, h, m: (
            f"{['월','화','수','목','금','토','일'][wd]}요일 "
            f"{'오전' if h < 12 else '오후'} "
            f"{h % 12 or 12}:{m:02d}"
        ),
        "lastSync":       lambda t: f"마지막 동기화 {t}",
        "language":       "언어",
        "credentials":    "인증 정보",
        "autoDetected":   "자격증명 파일에서 자동 감지됨",
        "notFound":       "찾을 수 없음",
        "refresh":        "새로고침",
        "alwaysOnTop":    "항상 위",
        "darkMode":       "다크 모드",
        "trayRunning":    "트레이에서 실행 중",
        "widgetSize":     "위젯 크기",
        "bgOpacity":      "배경 투명도",
        "manual":         "수동",
        "miniMode":       "미니",
        "miniSession":    "세션",
        "miniAll":        "전체",
        "miniSonnet":     "Sonnet",
        "miniExitTip":    "아이콘 클릭 시 미니 모드 종료",
        "miniEnterTip":   "아이콘 클릭 시 미니 모드 진입",
        "rateLimited":    "API 한도 초과 — 자동 재시도 대기",
        "updateSection":  "업데이트",
        "checkForUpdate": "업데이트 확인",
        "checkingUpdate": "확인 중…",
        "upToDate":       lambda v: f"최신 버전입니다 ({v})",
        "updateAvailable": lambda v: f"새 버전 사용 가능: {v}",
        "updateAvailableMsg": lambda new, cur: (
            f"새 버전 {new}이(가) 있습니다.\n현재: {cur}\n\n"
            "다운로드 폴더로 받고 지금 재시작할까요?"
        ),
        "downloading":    lambda p: f"다운로드 중… {p}%",
        "downloadFailed": "다운로드 실패",
        "checkFailed":    "확인 실패",
        "restartingNow":  "재시작 중…",
        "cancel":         "취소",
        "upToDateShort":   "✓ 최신 버전",
        "newVersionShort": lambda v: f"● 새 버전 {v}",
    },
}


# ════════════════════════════════════════════════════════════
#  Background fetch worker
# ════════════════════════════════════════════════════════════
class FetchWorker(QThread):
    """Anthropic OAuth 사용량 API를 호출하는 백그라운드 워커.

    UI 스레드를 막지 않기 위해 QThread로 분리. ~/.claude/.credentials.json
    에서 OAuth 액세스 토큰을 읽어 GET 요청을 보내고, 응답을 가공한 dict
    하나를 result 시그널로 UI 스레드에 전달한다. 에러는 예외를 던지지 않고
    {"error": "..."} 형태로 같은 시그널에 실어 보낸다 — 호출자는 한 곳에서
    정상/에러 분기를 할 수 있다.
    """
    result = pyqtSignal(dict)

    @staticmethod
    def read_credentials() -> dict | None:
        p = Path.home() / ".claude" / ".credentials.json"
        try:
            raw = json.loads(p.read_text("utf-8"))
            oauth = raw.get("claudeAiOauth")
            return oauth if (oauth and oauth.get("accessToken")) else None
        except Exception:
            return None

    def run(self):
        self.result.emit(self._fetch())

    def _fetch(self) -> dict:
        creds = self.read_credentials()
        if not creds:
            return {"error": "NO_CREDENTIALS"}

        headers = {
            "Authorization": f"Bearer {creds['accessToken']}",
            "anthropic-beta": "oauth-2025-04-20",
            "Accept": "application/json",
        }
        try:
            resp = SESSION.get(USAGE_URL, headers=headers, timeout=15)
        except Exception as e:
            return {"error": str(e)[:60]}

        if resp.status_code in (401, 403):
            return {"error": "TOKEN_EXPIRED"}
        if resp.status_code == 429:
            return {"error": "RATE_LIMITED"}
        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}"}

        try:
            j = resp.json()
        except Exception:
            return {"error": "JSON_PARSE_ERROR"}

        five_h   = j.get("five_hour",        {})
        seven_d  = j.get("seven_day",         {})
        seven_s  = j.get("seven_day_sonnet",  {})
        extra    = j.get("extra_usage",       {})

        session_reset_secs = 0
        if five_h.get("resets_at"):
            try:
                dt   = datetime.fromisoformat(five_h["resets_at"].replace("Z", "+00:00"))
                diff = (dt - datetime.now(timezone.utc)).total_seconds()
                session_reset_secs = max(0, math.floor(diff))
            except Exception:
                pass

        # Weekly reset: emit raw components so the UI thread can localize.
        weekly_reset = None
        if seven_d.get("resets_at"):
            try:
                rd  = datetime.fromisoformat(seven_d["resets_at"].replace("Z", "+00:00"))
                loc = rd.astimezone()
                weekly_reset = (loc.weekday(), loc.hour, loc.minute)
            except Exception:
                pass

        def pct(d): return float(d.get("utilization") or 0)

        return {
            "isConnected":             True,
            "sessionUsagePercent":     pct(five_h),
            "sessionResetSeconds":     session_reset_secs,
            "weeklyAllModelsPercent":  pct(seven_d),
            "weeklyAllModelsReset":    weekly_reset,
            "weeklySonnetPercent":     pct(seven_s),
            "planName": "Max (Extra)" if extra.get("is_enabled") else "Max",
        }


# ════════════════════════════════════════════════════════════
#  Update workers — GitHub Releases API as auto-update backend
# ════════════════════════════════════════════════════════════
class UpdateCheckWorker(QThread):
    """GitHub Releases API에서 최신 릴리즈 정보를 조회하는 워커.

    익명 호출이므로 레포가 public이어야 200을 받을 수 있다. private이면 404.
    GitHub의 익명 Rate Limit은 IP당 시간당 60회 — 시작 시 1회 + 사용자 클릭
    체크 정도로는 절대 부족하지 않음.
    """
    finished_with = pyqtSignal(dict)

    def run(self):
        try:
            resp = SESSION.get(
                RELEASES_API_URL, timeout=10,
                headers={"Accept": "application/vnd.github+json"},
            )
        except Exception as e:
            self.finished_with.emit({"error": str(e)[:80]})
            return
        if resp.status_code != 200:
            self.finished_with.emit({"error": f"HTTP {resp.status_code}"})
            return
        try:
            j = resp.json()
        except Exception:
            self.finished_with.emit({"error": "JSON_PARSE_ERROR"})
            return
        tag = j.get("tag_name", "") or ""
        # Pick the first .exe asset — releases are produced by our gh release script.
        exe_url = ""
        exe_name = "Claude-Widget.exe"
        for a in j.get("assets", []) or []:
            name = (a.get("name") or "")
            if name.lower().endswith(".exe"):
                exe_url = a.get("browser_download_url") or ""
                exe_name = name or exe_name
                break
        self.finished_with.emit({"latest": tag, "url": exe_url, "name": exe_name})


class UpdateDownloadWorker(QThread):
    """새 버전 .exe를 사용자 Downloads 폴더로 스트리밍 다운로드하는 워커.

    핵심 디자인:
    - 진행률(0~100)은 progress 시그널로 매 청크마다 송출 → UI는 ProgressDialog로 표시
    - 사용자가 다이얼로그에서 취소를 누르면 cancel() → 다음 청크 전에 멈추고 .part 파일 삭제
    - 다운로드는 <dest>.part 임시 파일에 쓰고, 완료 후에만 정식 파일명으로 rename
      (atomic rename) — 중간에 끊겨도 Downloads 폴더에 깨진 파일이 남지 않음
    """
    progress = pyqtSignal(int)
    finished_with = pyqtSignal(dict)

    def __init__(self, url: str, dest_path: str, parent=None):
        super().__init__(parent)
        self._url = url
        self._dest = dest_path
        self._cancel = False

    def cancel(self):
        self._cancel = True

    def run(self):
        tmp = self._dest + ".part"
        try:
            with SESSION.get(self._url, stream=True, timeout=30, allow_redirects=True) as r:
                if r.status_code != 200:
                    self.finished_with.emit({"error": f"HTTP {r.status_code}"})
                    return
                total = int(r.headers.get("Content-Length") or 0)
                got = 0
                last_pct = -1
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(chunk_size=64 * 1024):
                        if self._cancel:
                            try: os.remove(tmp)
                            except Exception: pass
                            self.finished_with.emit({"error": "CANCELLED"})
                            return
                        if not chunk:
                            continue
                        f.write(chunk)
                        got += len(chunk)
                        if total:
                            pct = int(got * 100 / total)
                            if pct != last_pct:
                                self.progress.emit(pct)
                                last_pct = pct
            if os.path.exists(self._dest):
                os.remove(self._dest)
            os.rename(tmp, self._dest)
            self.finished_with.emit({"path": self._dest})
        except Exception as e:
            try: os.remove(tmp)
            except Exception: pass
            self.finished_with.emit({"error": str(e)[:80]})


# ════════════════════════════════════════════════════════════
#  Custom Progress Bar
# ════════════════════════════════════════════════════════════
class ProgressBar(QWidget):
    """임계치별 색상이 바뀌는 커스텀 진행바 (둥근 모서리 + 그라디언트).

    - <50%: 초록 / 50–79%: 주황 / ≥80%: 빨강
    - show_scale=True 면 0/25/50/75/100 눈금 라벨을 아래에 그림
    - 위젯 스케일 변경 시 set_scale()로 높이/폰트 비례 조정
    paintEvent 직접 그리는 방식이라 QSS만으로 표현하기 까다로운 알파/그라디언트도 자유로움.
    """
    def __init__(self, theme: dict, show_scale: bool = False, parent=None):
        super().__init__(parent)
        self._pct   = 0.0
        self._scale = show_scale
        self._theme = theme
        self._ui_scale = 1.0
        self.set_scale(1.0)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

    def set_theme(self, theme: dict):
        self._theme = theme
        self.update()

    def set_percent(self, pct: float):
        self._pct = max(0.0, min(100.0, pct))
        self.update()

    def set_scale(self, scale: float):
        self._ui_scale = max(0.7, min(1.4, float(scale)))
        base_h = 34 if self._scale else 20
        self.setFixedHeight(int(round(base_h * self._ui_scale)))
        self.update()

    @staticmethod
    def _bar_color(pct, alpha=1.0):
        a = int(255 * alpha)
        # 임계치는 _set_pct_color()와 단일 출처(PCT_THRESHOLD_*)를 공유한다.
        base = (
            DANGER  if pct >= PCT_THRESHOLD_DANGER else
            WARNING if pct >= PCT_THRESHOLD_WARN   else
            SUCCESS
        )
        return QColor(base.red(), base.green(), base.blue(), a)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        bar_h = max(12, int(round(20 * self._ui_scale)))
        rect = self.rect()
        track_w = max(1, rect.width())

        # track
        track = QPainterPath()
        track.addRoundedRect(0, 0, track_w, bar_h, max(4, int(6 * self._ui_scale)), max(4, int(6 * self._ui_scale)))
        p.fillPath(track, self._theme["progress_bg"])

        # fill
        fw = int(track_w * self._pct / 100)
        if fw > 0:
            grad = QLinearGradient(0, 0, fw, 0)
            grad.setColorAt(0, self._bar_color(self._pct, 0.65))
            grad.setColorAt(1, self._bar_color(self._pct, 1.0))
            fp = QPainterPath()
            fp.addRoundedRect(0, 0, fw, bar_h, max(4, int(6 * self._ui_scale)), max(4, int(6 * self._ui_scale)))
            p.fillPath(fp, QBrush(grad))

        # scale
        if self._scale:
            font_px = max(7, int(round(8 * self._ui_scale)))
            p.setFont(QFont(APP_FONT_FAMILY, font_px))
            p.setPen(self._theme["text_secondary"])
            label_w = max(18, int(round(24 * self._ui_scale)))
            label_h = max(10, int(round(12 * self._ui_scale)))
            y = min(rect.height() - label_h, bar_h + max(2, int(round(3 * self._ui_scale))))
            for i, lb in enumerate(["0", "25", "50", "75", "100"]):
                xc = int(track_w * i / 4)
                x = max(0, min(track_w - label_w, xc - label_w // 2))
                p.drawText(x, y, label_w, label_h, Qt.AlignmentFlag.AlignCenter, lb)
        p.end()


# ════════════════════════════════════════════════════════════
#  Reusable helpers
# ════════════════════════════════════════════════════════════
def _divider(theme: dict) -> QWidget:
    w = QWidget()
    w.setFixedHeight(1)
    w.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
    c = theme["divider"]
    w.setStyleSheet(f"background:rgba({c.red()},{c.green()},{c.blue()},{c.alpha()});")
    return w


def _toggle_style(theme: dict, scale: float = 1.0) -> str:
    def sp(px: int) -> int:
        return max(1, int(round(px * scale)))

    tp  = theme["text_primary"]
    ts  = theme["text_secondary"]
    bd  = theme["border"]
    return f"""
        QPushButton {{
            font-size:{sp(13)}px;
            padding: {sp(4)}px {sp(10)}px;
            border: 1px solid rgba({bd.red()},{bd.green()},{bd.blue()},{bd.alpha()});
            border-radius: {sp(6)}px;
            background: transparent;
            color: rgba({ts.red()},{ts.green()},{ts.blue()},220);
        }}
        QPushButton:checked {{
            color: {ORANGE_RGB};
            background: rgba(217,119,87,30);
            border-color: rgba(217,119,87,90);
            font-weight: 600;
        }}
        QPushButton:hover:!checked {{
            background: rgba({ts.red()},{ts.green()},{ts.blue()},25);
        }}
    """


# ════════════════════════════════════════════════════════════
#  Main widget
# ════════════════════════════════════════════════════════════
class ClaudeWidget(QWidget):
    """프레임리스 메인 위젯. 모든 UI/상태/이벤트가 이 클래스에 모여 있다.

    구성 요소
    - 헤더: 드래그 핸들 + Claude 아이콘 + 상태 텍스트 + 옵션 ⚙ 버튼
    - 콘텐츠: 현재 세션 카드 + 주간 사용량 카드
    - 미니뷰: 풀모드 영역과 visibility를 토글하는 컴팩트 그리드
    - 옵션 패널: 언어/인증/자동동기화/AOT/다크/투명도/업데이트
    - 푸터: 버전 / 마지막 sync / 동기화 / 닫기

    상태 보존: QSettings("ClaudeWidget", "Claude-Widget-Cross") — 언어, 사이즈,
    위치, AOT, 다크 모드, 투명도, 미니 모드 여부, 동기화 주기, 마지막 sync 시각.
    """

    def __init__(self):
        super().__init__()
        # ── 설정값 로드 (이전 세션 상태 복원) ─────────────────
        self._cfg = QSettings("ClaudeWidget", "Claude-Widget-Cross")
        self._lang     = self._cfg.value("lang",          "en")
        # Default auto-sync = 10 min — a gentle call rate combined with the
        # jitter + exponential-backoff logic in _schedule_next_sync.
        self._interval = int(self._cfg.value("sync_interval", DEFAULT_SYNC_INTERVAL_SEC))
        self._aot      = self._cfg.value("always_on_top", "true") == "true"
        self._dark     = self._cfg.value("dark_mode",     "false") == "true"
        self._widget_scale = 1.0
        has_opacity = self._cfg.contains("bg_opacity")
        raw_opacity = int(self._cfg.value("bg_opacity", 0))
        if self._cfg.value("bg_opacity_mode", "") != "v2":
            raw_opacity = (100 - raw_opacity) if has_opacity else 0
            self._cfg.setValue("bg_opacity_mode", "v2")
            self._cfg.setValue("bg_opacity", raw_opacity)
        self._bg_opacity = raw_opacity
        self._bg_opacity = max(0, min(100, self._bg_opacity))
        self._mini_mode = self._cfg.value("mini_mode", "false") == "true"
        self._theme    = THEMES["dark"] if self._dark else THEMES["light"]
        self._resize_border = 8

        self._drag_pos    = QPoint()
        self._dragging    = False
        self._collapsed_height: int | None = None
        self._internal_toggle_resize = False
        self._is_syncing  = False
        self._worker: FetchWorker | None = None
        # Update-check / download workers (manual, triggered from settings panel).
        self._update_check_worker: UpdateCheckWorker | None = None
        self._dl_worker: UpdateDownloadWorker | None = None
        self._dl_progress: QProgressDialog | None = None
        # Debounce timer for theme reapply during continuous resize. Crossing
        # a 0.05 scale-quantum mid-drag (especially diagonal corner drags) used
        # to fire a full QSS rebuild every frame — visibly stuttery. Now we
        # restart the timer on each quantum cross and only reapply once the
        # drag pauses, while geometry/margin updates still run every frame so
        # layout responsiveness is unaffected.
        self._theme_reapply_timer = QTimer(self)
        self._theme_reapply_timer.setSingleShot(True)
        self._theme_reapply_timer.timeout.connect(self._apply_theme)
        # Single shared geometry animation, reused for mini↔full transitions.
        # We suppress the resize-event size-save while it runs so intermediate
        # interpolated sizes don't overwrite the user's saved geometry.
        self._resize_anim = QPropertyAnimation(self, b"size", self)
        self._resize_anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._resize_anim.finished.connect(
            lambda: setattr(self, "_internal_toggle_resize", False)
        )
        # Single-shot timer re-armed by _schedule_next_sync() after each fetch.
        # This lets us apply jitter/backoff per-cycle instead of a fixed interval —
        # smooths out call timing and recovers gracefully from 429 responses.
        self._sync_timer  = QTimer(self)
        self._sync_timer.setSingleShot(True)
        self._sync_timer.timeout.connect(self.do_sync)
        self._consecutive_429 = 0  # exponential-backoff counter for rate limits

        # Runtime state — survives _apply_theme() overrides
        self._status_state: str = "checking"   # "checking" | "connected" | "error"
        self._status_error_key: str | None = None  # i18n key for error, if applicable
        self._status_error_raw: str | None = None  # raw error text fallback
        self._last_session_pct: float | None = None
        self._last_all_pct: float | None = None
        self._last_sonnet_pct: float | None = None
        self._last_reset: tuple | None = None  # (weekday, hour, minute)
        # 마지막으로 받은 세션 초기화까지 남은 시간(초). 언어 전환 시 다시 그릴 때 사용.
        self._last_session_reset_secs: int | None = None
        self._cred_present: bool | None = None

        self._setup_window()
        self._build_ui()
        self.resize(326, max(360, self.sizeHint().height()))
        QApplication.instance().installEventFilter(self)
        self._setup_tray()
        self._apply_language()
        self._apply_widget_scale()
        self._apply_theme()
        self._apply_mini_mode(initial=True)
        self._setup_auto_sync()
        # One-shot startup version check — populates the short status next to
        # the "Check for Updates" button. Delay so the UI is fully visible and
        # the usage-API sync gets a head start (constant at module top).
        QTimer.singleShot(STARTUP_UPDATE_CHECK_DELAY_MS, self._startup_update_check)

        pos = self._cfg.value("pos")
        if pos:
            self.move(pos)
        else:
            scr = QApplication.primaryScreen().geometry()
            self.move(scr.width() - self.width() - 24, 24)

        saved_size = self._cfg.value("widget_size")
        if saved_size:
            self.resize(saved_size)



    # ── 창 플래그 설정 ─────────────────────────────────────
    def _setup_window(self):
        """프레임리스 창 + AOT 상태에 따른 Tool 플래그 설정.

        Qt.WindowType.Tool 은 작업표시줄에서 창을 자동 제외시킨다.
        AOT 활성 시에만 Tool 플래그를 켜서 "항상 위 → 작업표시줄 숨김"으로 묶는다.
        AOT가 꺼져 있으면 일반 창처럼 작업표시줄/Alt+Tab에 노출된다.
        """
        flags = Qt.WindowType.FramelessWindowHint
        if self._aot:
            flags |= Qt.WindowType.WindowStaysOnTopHint | Qt.WindowType.Tool
        self.setWindowFlags(flags)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, False)
        self.setMinimumWidth(220)
        self.setMinimumHeight(280)
        self.setMouseTracking(True)

    # ── tray ────────────────────────────────────────────────
    def _make_tray_icon(self) -> QIcon:
        ico_path = resource_path(ICON_ASSET_PATH)
        if os.path.isfile(ico_path):
            return QIcon(ico_path)
            
        # fallback
        px = QPixmap(32, 32)
        px.fill(Qt.GlobalColor.transparent)
        p = QPainter(px)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        bg = QColor(24, 27, 32) if self._dark else ORANGE
        p.setBrush(QBrush(bg))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawRoundedRect(2, 2, 28, 28, 6, 6)
        p.setPen(QPen(QColor(255, 255, 255), 1.8))
        p.setFont(QFont(APP_FONT_FAMILY, 10, QFont.Weight.Bold))
        p.drawText(QRect(0, 0, 32, 32), Qt.AlignmentFlag.AlignCenter, "C")
        p.end()
        return QIcon(px)

    def _setup_tray(self):
        self._tray = QSystemTrayIcon(self._make_tray_icon(), self)
        self._tray_menu = QMenu()
        self._rebuild_tray_menu()
        self._tray.setContextMenu(self._tray_menu)
        self._tray.setToolTip("Claude Usage Monitor")
        self._tray.activated.connect(self._on_tray_click)
        self._tray.show()

    def _rebuild_tray_menu(self):
        s = I18N[self._lang]
        m = self._tray_menu
        m.clear()

        # Dark background for menu in dark mode
        if self._dark:
            m.setStyleSheet("""
                QMenu { background:#1e2128; color:#e5e7eb; border:1px solid #374151; }
                QMenu::item:selected { background:rgba(217,119,87,80); }
                QMenu::separator { background:#374151; }
            """)
        else:
            m.setStyleSheet("")

        def act(label, fn, checkable=False, checked=False):
            a = QAction(label, self)
            if checkable:
                a.setCheckable(True)
                a.setChecked(checked)
            a.triggered.connect(fn)
            return a

        m.addAction(act(s["sync"], self.do_sync))
        m.addSeparator()
        m.addAction(act(s["alwaysOnTop"], self._toggle_aot, True, self._aot))
        m.addAction(act(s["darkMode"],    self._toggle_dark, True, self._dark))
        m.addAction(act(s["miniMode"],    self._toggle_mini, True, self._mini_mode))
        m.addSeparator()
        lm = m.addMenu(s["language"])
        lm.addAction(act("English",  lambda: self._set_lang("en")))
        lm.addAction(act("한국어",   lambda: self._set_lang("ko")))
        m.addSeparator()
        m.addAction(act(s["quit"], self._quit))

    def _on_tray_click(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.DoubleClick:
            self.setVisible(not self.isVisible())

    # ── UI build ────────────────────────────────────────────
    def _build_ui(self):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        self._panel = QFrame(self)
        self._panel.setObjectName("mainPanel")
        
        # Shadow removed because margins are 0 and it wouldn't be visible without clipping

        pl = QVBoxLayout(self._panel)
        self._panel_layout = pl
        pl.setContentsMargins(0, 0, 0, 0)
        pl.setSpacing(0)

        pl.addWidget(self._make_drag_handle())
        self._header_widget = self._make_header()
        pl.addWidget(self._header_widget)

        self._settings_panel = self._make_settings_panel()
        self._settings_panel.setVisible(False)
        pl.addWidget(self._settings_panel)

        self._div_after_header = _divider(self._theme)
        pl.addWidget(self._div_after_header)

        # content (full mode)
        self._content_wrapper = QWidget()
        cl = QVBoxLayout(self._content_wrapper)
        self._content_layout = cl
        cl.setContentsMargins(14, 14, 14, 14)
        cl.setSpacing(12)
        # Session card stays at its natural compact height (3 rows: header,
        # progress bar, reset text). Only the weekly card expands so that
        # extra vertical space lands in the card with more content rather
        # than inflating padding inside the small session card.
        session_card = self._make_session_card()
        weekly_card = self._make_weekly_card()
        session_card.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Preferred)
        weekly_card.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Expanding)
        cl.addWidget(session_card)
        cl.addWidget(weekly_card)
        pl.addWidget(self._content_wrapper)

        # mini view (mini mode) — hidden until enabled
        self._mini_view = self._make_mini_view()
        self._mini_view.setVisible(False)
        pl.addWidget(self._mini_view)

        self._div_before_footer = _divider(self._theme)
        pl.addWidget(self._div_before_footer)
        self._footer_widget = self._make_footer()
        pl.addWidget(self._footer_widget)

        outer.addWidget(self._panel)

    # drag handle
    def _make_drag_handle(self) -> QWidget:
        w = QWidget()
        w.setObjectName("dragHandle")
        self._drag_handle = w
        w.setFixedHeight(self._sp(20))
        w.setCursor(Qt.CursorShape.SizeAllCursor)
        l = QHBoxLayout(w)
        self._drag_handle_layout = l
        l.setContentsMargins(0, 8, 0, 4)
        l.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._drag_bar = QFrame()
        self._drag_bar.setFixedSize(self._sp(36), self._sp(4))
        self._drag_bar.setObjectName("dragBar")
        l.addWidget(self._drag_bar)
        w.mousePressEvent       = self._drag_press
        w.mouseMoveEvent        = self._drag_move
        w.mouseReleaseEvent     = self._drag_release
        w.mouseDoubleClickEvent = lambda ev: self.hide()
        return w

    # header
    def _make_header(self) -> QWidget:
        w = QWidget()
        l = QHBoxLayout(w)
        self._header_layout = l
        l.setContentsMargins(14, 8, 14, 12)
        left = QHBoxLayout(); left.setSpacing(10)

        # icon — clickable, enters mini mode
        header_png = resource_path(os.path.join("assets", "claude-header.png"))
        ico_path = resource_path(ICON_ASSET_PATH)
        self._header_icon = QLabel()
        self._header_icon.setCursor(Qt.CursorShape.PointingHandCursor)
        self._header_icon.mousePressEvent = self._header_icon_clicked
        self._header_png_path = header_png if os.path.isfile(header_png) else None
        self._header_ico_path = ico_path if os.path.isfile(ico_path) else None
        self._update_header_icon()
        left.addWidget(self._header_icon)

        info = QVBoxLayout(); info.setSpacing(2)
        tr = QHBoxLayout(); tr.setSpacing(8)
        self._title_lbl = QLabel("Claude Monitor")
        self._plan_badge = QLabel("Max")
        self._plan_badge.setStyleSheet(
            f"font-size:9px;font-weight:600;color:{ORANGE_RGB};"
            "background:rgba(217,119,87,26);border:1px solid rgba(217,119,87,64);"
            "border-radius:4px;padding:1px 6px;"
        )
        tr.addWidget(self._title_lbl); tr.addWidget(self._plan_badge); tr.addStretch()
        info.addLayout(tr)

        sr = QHBoxLayout(); sr.setSpacing(4)
        self._status_icon = QLabel("↻")
        self._status_text = QLabel()
        # Long status messages (e.g. "Token expired. Please use Claude Code to refresh")
        # would otherwise be clipped at narrow widget widths. wordWrap lets them
        # flow to a second line; the stretch factor lets the label fill horizontal
        # space so wrapping triggers when needed.
        self._status_text.setWordWrap(True)
        self._status_text.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        sr.addWidget(self._status_icon); sr.addWidget(self._status_text, 1)
        info.addLayout(sr)
        left.addLayout(info)
        l.addLayout(left); l.addStretch()

        # settings button
        self._settings_btn = QPushButton("⚙")
        self._settings_btn.setFixedSize(self._sp(28), self._sp(28))
        self._settings_btn.clicked.connect(self._toggle_settings)
        l.addWidget(self._settings_btn)
        return w

    # settings panel
    def _make_settings_panel(self) -> QWidget:
        w = QWidget()
        l = QVBoxLayout(w); l.setContentsMargins(14, 10, 14, 14); l.setSpacing(10)

        self._sett_lang_label = QLabel()
        self._sett_lang_label.setObjectName("settLabel")
        l.addWidget(self._sett_lang_label)

        lr = QHBoxLayout(); lr.setSpacing(4)
        self._btn_en = QPushButton("English"); self._btn_en.setCheckable(True)
        self._btn_ko = QPushButton("한국어");  self._btn_ko.setCheckable(True)
        self._btn_en.setProperty("lang_code", "en")
        self._btn_ko.setProperty("lang_code", "ko")
        for btn in (self._btn_en, self._btn_ko):
            btn.clicked.connect(
                lambda _, b=btn: self._set_lang(b.property("lang_code"))
            )
            lr.addWidget(btn)
        lr.addStretch(); l.addLayout(lr)
        (self._btn_ko if self._lang == "ko" else self._btn_en).setChecked(True)

        self._sett_cred_label = QLabel()
        self._sett_cred_label.setObjectName("settLabel")
        l.addWidget(self._sett_cred_label)

        cr = QHBoxLayout(); cr.setSpacing(8)
        self._cred_dot = QLabel("●")
        self._cred_dot.setFixedWidth(12)
        self._cred_status = QLabel("…")
        self._cred_status.setWordWrap(True)
        self._cred_status.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        self._cred_refresh = QPushButton()
        self._cred_refresh.clicked.connect(self._refresh_creds_and_sync)
        cr.addWidget(self._cred_dot); cr.addWidget(self._cred_status); cr.addWidget(self._cred_refresh)
        l.addLayout(cr)

        # auto-sync section
        self._auto_sync_lbl = QLabel()
        self._auto_sync_lbl.setObjectName("settLabel")
        l.addWidget(self._auto_sync_lbl)
        l.addWidget(self._make_sync_row_widget())
        self._sync_note = QLabel()
        self._sync_note.setWordWrap(True)
        l.addWidget(self._sync_note)

        # toggles row (mini button lives in the footer instead)
        tog = QHBoxLayout(); tog.setSpacing(6)
        self._aot_btn  = QPushButton(); self._aot_btn.setCheckable(True); self._aot_btn.setChecked(self._aot)
        self._dark_btn = QPushButton(); self._dark_btn.setCheckable(True); self._dark_btn.setChecked(self._dark)
        self._aot_btn.clicked.connect(self._toggle_aot)
        self._dark_btn.clicked.connect(self._toggle_dark)
        tog.addWidget(self._aot_btn); tog.addWidget(self._dark_btn); tog.addStretch()
        l.addLayout(tog)

        self._sett_opacity_label = QLabel()
        self._sett_opacity_label.setObjectName("settLabel")
        l.addWidget(self._sett_opacity_label)
        orow = QHBoxLayout(); orow.setSpacing(8)
        self._opacity_slider = QSlider(Qt.Orientation.Horizontal)
        self._opacity_slider.setRange(0, 100)
        self._opacity_slider.setSingleStep(5)
        self._opacity_slider.setValue(self._bg_opacity)
        self._opacity_slider.valueChanged.connect(self._on_opacity_changed)
        self._opacity_value = QLabel()
        self._opacity_value.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self._opacity_value.setFixedWidth(44)
        orow.addWidget(self._opacity_slider, 1)
        orow.addWidget(self._opacity_value)
        l.addLayout(orow)

        # Update section — last block in the panel so it doesn't push more
        # commonly-used controls below the fold.
        self._sett_update_label = QLabel()
        self._sett_update_label.setObjectName("settLabel")
        l.addWidget(self._sett_update_label)
        ur = QHBoxLayout(); ur.setSpacing(8)
        self._update_btn = QPushButton()
        self._update_btn.clicked.connect(self._check_for_updates)
        self._update_status = QLabel("")
        self._update_status.setWordWrap(True)
        self._update_status.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        ur.addWidget(self._update_btn); ur.addWidget(self._update_status, 1)
        l.addLayout(ur)

        return w

    # session card
    def _make_session_card(self) -> QFrame:
        f = QFrame(); f.setObjectName("glassCard")
        l = QVBoxLayout(f); l.setContentsMargins(14,14,14,14); l.setSpacing(10)
        self._session_layout = l
        self._card_shadow_session = QGraphicsDropShadowEffect(f)
        self._card_shadow_session.setBlurRadius(8); self._card_shadow_session.setOffset(0,2)
        f.setGraphicsEffect(self._card_shadow_session)

        hdr = QHBoxLayout()
        self._session_title = QLabel(); self._session_title.setObjectName("cardTitle")
        self._session_pct   = QLabel("0%")
        hdr.addWidget(self._session_title); hdr.addStretch(); hdr.addWidget(self._session_pct)
        l.addLayout(hdr)

        self._session_bar   = ProgressBar(self._theme, show_scale=True)
        l.addWidget(self._session_bar)
        self._session_reset = QLabel("Resets in --"); self._session_reset.setObjectName("resetText")
        self._session_reset.setWordWrap(True)
        l.addWidget(self._session_reset)
        self._session_frame = f
        return f

    # weekly card
    def _make_weekly_card(self) -> QFrame:
        f = QFrame(); f.setObjectName("glassCard")
        l = QVBoxLayout(f); l.setContentsMargins(14,14,14,14); l.setSpacing(10)
        self._weekly_layout = l
        self._card_shadow_weekly = QGraphicsDropShadowEffect(f)
        self._card_shadow_weekly.setBlurRadius(8); self._card_shadow_weekly.setOffset(0,2)
        f.setGraphicsEffect(self._card_shadow_weekly)

        hdr = QHBoxLayout()
        self._weekly_title    = QLabel(); self._weekly_title.setObjectName("cardTitle")
        self._learn_more_btn  = QPushButton(); self._learn_more_btn.clicked.connect(
            lambda: webbrowser.open(LEARN_MORE_URL)
        )
        hdr.addWidget(self._weekly_title); hdr.addStretch(); hdr.addWidget(self._learn_more_btn)
        l.addLayout(hdr)

        # All models
        ah = QHBoxLayout()
        self._all_models_lbl = QLabel(); self._all_models_lbl.setObjectName("subTitle")
        self._all_models_pct = QLabel("0%"); self._all_models_pct.setObjectName("subPct")
        ah.addWidget(self._all_models_lbl); ah.addStretch(); ah.addWidget(self._all_models_pct)
        l.addLayout(ah)
        self._all_models_bar   = ProgressBar(self._theme)
        l.addWidget(self._all_models_bar)
        self._all_models_reset = QLabel("")
        self._all_models_reset.setObjectName("resetText")
        self._all_models_reset.setWordWrap(True)
        l.addWidget(self._all_models_reset)

        self._weekly_div = _divider(self._theme)
        l.addWidget(self._weekly_div)

        # Sonnet
        sh = QHBoxLayout()
        self._sonnet_lbl = QLabel(); self._sonnet_lbl.setObjectName("subTitle")
        self._sonnet_pct = QLabel("0%"); self._sonnet_pct.setObjectName("subPct")
        sh.addWidget(self._sonnet_lbl); sh.addStretch(); sh.addWidget(self._sonnet_pct)
        l.addLayout(sh)
        self._sonnet_bar = ProgressBar(self._theme)
        l.addWidget(self._sonnet_bar)

        self._weekly_frame = f
        return f

    # sync row
    def _interval_label(self, secs: int) -> str:
        if secs == 0:
            return I18N[self._lang]["manual"]
        if secs >= 3600:
            return f"{secs // 3600}h"
        return f"{secs // 60}m"

    def _make_sync_row_widget(self) -> QWidget:
        w = QWidget()
        l = QHBoxLayout(w); l.setContentsMargins(0,0,0,0); l.setSpacing(6)

        self._interval_btns: dict[int, QPushButton] = {}
        for secs in SYNC_INTERVAL_OPTIONS_SEC:
            b = QPushButton(self._interval_label(secs))
            b.setCheckable(True)
            b.setChecked(secs == self._interval)
            b.setFixedHeight(self._sp(22))
            b.setProperty("isecs", secs)
            b.clicked.connect(lambda _, bb=b: self._set_interval(bb.property("isecs")))
            self._interval_btns[secs] = b
            l.addWidget(b)
        l.addStretch()
        return w

    def _sp(self, px: int) -> int:
        return max(1, int(round(px * self._widget_scale)))

    def _alpha_color(self, c: QColor, apply_opacity: bool = True) -> QColor:
        if not apply_opacity:
            return QColor(c.red(), c.green(), c.blue(), c.alpha())
        if self._bg_opacity == 0:
            return QColor(c.red(), c.green(), c.blue(), 255)

        # 100% 완전 투명이면 마우스 이벤트가 통과되므로 99%로 처리
        opacity = self._bg_opacity
        if opacity >= 100:
            opacity = 99

        # 0%: opaque, 100%: fully transparent
        a = int(round(c.alpha() * (1.0 - (opacity / 100.0))))
        return QColor(c.red(), c.green(), c.blue(), max(0, min(255, a)))

    def _rgba(self, c: QColor) -> str:
        return f"rgba({c.red()},{c.green()},{c.blue()},{c.alpha()})"

    def _update_header_icon(self):
        w = self._sp(48)
        cache = getattr(self, "_header_icon_cache", {})
        if cache.get("w") == w:
            return  # already at this size — skip the disk read + rescale
        cache["w"] = w
        self._header_icon_cache = cache
        if self._header_png_path:
            px = QPixmap(self._header_png_path).scaledToWidth(w, Qt.TransformationMode.SmoothTransformation)
            self._header_icon.setPixmap(px)
            self._header_icon.setFixedSize(w, px.height())
            return
        if self._header_ico_path:
            side = self._sp(34)
            self._header_icon.setPixmap(QIcon(self._header_ico_path).pixmap(side, side))
            self._header_icon.setFixedSize(side, side)
            return

        side = self._sp(28)
        px = QPixmap(side, side)
        px.fill(Qt.GlobalColor.transparent)
        pp = QPainter(px)
        pp.setRenderHint(QPainter.RenderHint.Antialiasing)
        pp.setBrush(QBrush(ORANGE))
        pp.setPen(Qt.PenStyle.NoPen)
        rr = max(4, self._sp(6))
        pp.drawRoundedRect(0, 0, side, side, rr, rr)
        pp.setPen(QPen(QColor(255, 255, 255), max(1, self._sp(2) / 2)))
        pp.setFont(QFont(APP_FONT_FAMILY, max(8, self._sp(9)), QFont.Weight.Bold))
        pp.drawText(QRect(0, 0, side, side), Qt.AlignmentFlag.AlignCenter, "AI")
        pp.end()
        self._header_icon.setPixmap(px)
        self._header_icon.setFixedSize(side, side)

    def _apply_widget_scale(self) -> bool:
        """위젯 너비를 기반으로 스케일을 계산하고 모든 사이즈 종속 요소를 재배치.

        스케일은 0.05 단위로 양자화 → 드래그 중 폰트 크기가 매 프레임 흔들리는 현상 방지.
        반환값이 True면 양자 경계를 넘은 것이므로 호출자(`resizeEvent`)가
        `_apply_theme()`도 트리거. False면 스타일 시트는 그대로 두어 매끄러운 드래그 유지.

        Recompute scale-dependent layout. Returns True iff the quantized
        scale changed, so the caller can skip an _apply_theme() pass when
        nothing actually needs restyling. Quantizing to 0.05 steps avoids
        font-size jitter while the user drags to resize."""
        # Scale floor 0.85 — below this, fonts/borders/icons start to break.
        # Combined with mode-specific minimum sizes below, this guarantees
        # readable content at any user-chosen widget size.
        raw = max(SCALE_FLOOR, min(SCALE_CEIL, self.width() / DEFAULT_WIDGET_WIDTH))
        quantized = round(raw / SCALE_QUANTUM) * SCALE_QUANTUM
        if getattr(self, "_widget_scale_applied", None) == quantized:
            return False
        self._widget_scale_applied = quantized
        self._widget_scale = quantized
        self._resize_border = max(6, self._sp(8))

        if self._mini_mode:
            # Tightest possible drag handle in mini mode — just enough
            # visual affordance to signal it's draggable.
            self._drag_handle.setFixedHeight(self._sp(7))
            self._drag_handle_layout.setContentsMargins(0, self._sp(1), 0, self._sp(1))
            self._drag_bar.setFixedSize(self._sp(24), max(2, self._sp(2)))
        else:
            self._drag_handle.setFixedHeight(self._sp(20))
            self._drag_handle_layout.setContentsMargins(0, self._sp(8), 0, self._sp(4))
            self._drag_bar.setFixedSize(self._sp(36), max(2, self._sp(4)))
        self._header_layout.setContentsMargins(self._sp(14), self._sp(8), self._sp(14), self._sp(12))
        self._content_layout.setContentsMargins(self._sp(14), self._sp(14), self._sp(14), self._sp(14))
        self._content_layout.setSpacing(self._sp(12))
        self._settings_btn.setFixedSize(self._sp(28), self._sp(28))
        self._session_layout.setContentsMargins(self._sp(14), self._sp(14), self._sp(14), self._sp(14))
        self._session_layout.setSpacing(self._sp(10))
        self._weekly_layout.setContentsMargins(self._sp(14), self._sp(14), self._sp(14), self._sp(14))
        self._weekly_layout.setSpacing(self._sp(10))

        for b in self._interval_btns.values():
            b.setFixedHeight(self._sp(22))

        self._session_bar.set_scale(self._widget_scale)
        self._all_models_bar.set_scale(self._widget_scale)
        self._sonnet_bar.set_scale(self._widget_scale)
        self._update_header_icon()

        if hasattr(self, "_mini_view"):
            self._mini_layout.setContentsMargins(
                self._sp(2), self._sp(2), self._sp(2), self._sp(2)
            )
            self._mini_layout.setSpacing(self._sp(6))
            self._mini_grid.setHorizontalSpacing(self._sp(MINI_GAP_BASE) + MINI_GAP_OFFSET)
            self._mini_grid.setVerticalSpacing(self._sp(2))
            self._update_mini_icon()

        # Mode-specific minimum sizes (absolute floor — won't shrink below
        # these regardless of scale, so content never breaks).
        # Full-mode min height = drag(20) + header(68) + dividers(2) + footer(30)
        # + content margins(28) + session card(~117) + spacing(12) + weekly card(~185) ≈ 462,
        # rounded to 450 for tight-but-safe fit at scale 0.86 (the floor at width 280).
        # Mini width floor 170 lets the user shrink ~2cm (≈70px) below the
        # natural mini width (~240). The adaptive grid spacing in
        # _update_mini_grid_spacing() compresses the label↔percent gap as
        # width approaches the floor, so content stays unclipped throughout.
        self._apply_minimum_size()

        return True

    def _apply_minimum_size(self):
        """Set the widget minimum size based on the current mode + scale.
        Called from _apply_widget_scale (on scale change) and _apply_mini_mode
        (on mode toggle) — same calculation in both places, kept DRY here.

        Width may scale with the current widget_scale so wider windows still
        have room for content. Height stays at the absolute mode floor on
        purpose: scaling min-height with width meant that pulling the side
        edge outward inflated the height clamp too, so a follow-up corner
        drag inward would jam mid-motion when height hit the new min."""
        if self._mini_mode:
            self.setMinimumSize(max(MINI_MIN_W, self._sp(MINI_MIN_W)), MINI_MIN_H)
        else:
            self.setMinimumSize(max(FULL_MIN_W, self._sp(FULL_MIN_W)), FULL_MIN_H)

    def _on_opacity_changed(self, value: int):
        self._bg_opacity = max(0, min(100, int(value)))
        self._cfg.setValue("bg_opacity", self._bg_opacity)
        self._opacity_value.setText(f"{self._bg_opacity}%")
        self._apply_theme()

    # mini view ────────────────────────────────────────────
    def _make_mini_view(self) -> QWidget:
        w = QWidget()
        w.setObjectName("miniView")
        l = QHBoxLayout(w)
        # Maximally tight padding — only 2px from the panel border.
        l.setContentsMargins(self._sp(2), self._sp(2), self._sp(2), self._sp(2))
        l.setSpacing(self._sp(6))
        self._mini_layout = l

        self._mini_icon = QLabel()
        self._mini_icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._mini_icon.setCursor(Qt.CursorShape.PointingHandCursor)
        self._mini_icon.mousePressEvent = self._mini_icon_clicked
        l.addWidget(self._mini_icon, 0, Qt.AlignmentFlag.AlignVCenter)

        # 2-column grid: labels | percentages.
        # Using a grid (instead of HBox+stretch) keeps the gap between label
        # and percentage at the column spacing only — it doesn't expand with
        # widget width, so the layout stays tight when shrunk horizontally.
        # Initial spacing is the "full" gap; _update_mini_grid_spacing()
        # rewrites it adaptively as the user resizes.
        grid = QGridLayout()
        grid.setHorizontalSpacing(self._sp(MINI_GAP_BASE) + MINI_GAP_OFFSET)
        grid.setVerticalSpacing(self._sp(2))
        grid.setContentsMargins(0, 0, 0, 0)
        self._mini_grid = grid

        self._mini_session_lbl = QLabel()
        self._mini_session_lbl.setObjectName("miniLabel")
        self._mini_session_pct = QLabel("0%")
        self._mini_session_pct.setObjectName("miniPct")
        self._mini_all_lbl = QLabel()
        self._mini_all_lbl.setObjectName("miniLabel")
        self._mini_all_pct = QLabel("0%")
        self._mini_all_pct.setObjectName("miniPct")
        self._mini_sonnet_lbl = QLabel()
        self._mini_sonnet_lbl.setObjectName("miniLabel")
        self._mini_sonnet_pct = QLabel("0%")
        self._mini_sonnet_pct.setObjectName("miniPct")

        for row_idx, (lbl, pct) in enumerate((
            (self._mini_session_lbl, self._mini_session_pct),
            (self._mini_all_lbl, self._mini_all_pct),
            (self._mini_sonnet_lbl, self._mini_sonnet_pct),
        )):
            pct.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            grid.addWidget(lbl, row_idx, 0)
            grid.addWidget(pct, row_idx, 1)

        l.addLayout(grid)        # natural width — no horizontal stretch
        l.addStretch()           # absorb extra widget width on the right
        return w

    def _update_mini_icon(self):
        side = self._sp(60)
        cache = getattr(self, "_mini_icon_cache", {})
        if cache.get("side") == side:
            return  # already at this size
        cache["side"] = side
        self._mini_icon_cache = cache
        self._mini_icon.setFixedSize(side, side)
        if self._header_png_path:
            px = QPixmap(self._header_png_path).scaledToWidth(side, Qt.TransformationMode.SmoothTransformation)
            self._mini_icon.setPixmap(px)
        elif self._header_ico_path:
            self._mini_icon.setPixmap(QIcon(self._header_ico_path).pixmap(side, side))
        else:
            px = QPixmap(side, side)
            px.fill(Qt.GlobalColor.transparent)
            pp = QPainter(px)
            pp.setRenderHint(QPainter.RenderHint.Antialiasing)
            pp.setBrush(QBrush(ORANGE))
            pp.setPen(Qt.PenStyle.NoPen)
            rr = max(4, self._sp(6))
            pp.drawRoundedRect(0, 0, side, side, rr, rr)
            pp.end()
            self._mini_icon.setPixmap(px)

    def _update_mini_grid_spacing(self):
        """Adaptive horizontal spacing for the mini view's label↔percent gap.

        At MINI_GAP_FULL_AT (~240px) and above, use the user-preferred
        sp(BASE)+OFFSET (~1cm + 15px) gap so percentages sit visibly to the
        right. As the widget shrinks toward MINI_GAP_FLOOR_AT (~170px), the
        gap compresses linearly to MINI_GAP_TIGHT so content keeps fitting
        without clipping.

        Called from resizeEvent so it tracks every width change (independent
        of the quantized scale early-return in _apply_widget_scale)."""
        if not hasattr(self, "_mini_grid") or not self._mini_mode:
            return
        width = self.width()
        full_gap = self._sp(MINI_GAP_BASE) + MINI_GAP_OFFSET
        tight_gap = self._sp(MINI_GAP_TIGHT)
        if width >= MINI_GAP_FULL_AT:
            gap = full_gap
        elif width <= MINI_GAP_FLOOR_AT:
            gap = tight_gap
        else:
            ratio = (width - MINI_GAP_FLOOR_AT) / (MINI_GAP_FULL_AT - MINI_GAP_FLOOR_AT)
            gap = int(tight_gap + (full_gap - tight_gap) * ratio)
        self._mini_grid.setHorizontalSpacing(gap)

    def _mini_icon_clicked(self, ev):
        if ev.button() == Qt.MouseButton.LeftButton:
            self._toggle_mini()
            ev.accept()

    def _header_icon_clicked(self, ev):
        if ev.button() == Qt.MouseButton.LeftButton:
            self._toggle_mini()
            ev.accept()

    def _apply_mini_mode(self, initial: bool = False):
        """풀↔미니 모드 전환의 핵심 로직.

        별도 위젯이 아니라 동일 위젯 안에서 풀모드 chrome과 미니뷰의 visibility를
        토글하는 방식. initial=True (시작 시 1회)는 즉시 resize, 그 외에는
        180ms OutCubic 애니메이션으로 부드러운 사이즈 보간.

        타깃 사이즈는 모드별 키(widget_size / widget_size_mini)에 저장된 값을
        그대로 복원 — 사용자가 모드 사이를 오갈 때 그 모드에서 마지막에
        본인이 직접 조정한 사이즈로 정확히 돌아간다.
        """
        is_mini = self._mini_mode

        # Auto-close settings when entering mini (settings is unreachable there).
        # Done before content-wrapper restoration so the in-memory full-size cache
        # — populated by the most recent full-mode resizeEvent — is what we restore from.
        if is_mini and self._settings_panel.isVisible():
            self._settings_panel.setVisible(False)
            self._collapsed_height = None
            # Re-show content_wrapper visibility flag to its full-mode state so
            # the size cache reflects the user's chosen card-mode geometry.
            self._content_wrapper.setVisible(True)
            self._div_after_header.setVisible(True)

        # Toggle visibility of full-mode chrome.
        self._header_widget.setVisible(not is_mini)
        self._div_after_header.setVisible(not is_mini)
        self._content_wrapper.setVisible(not is_mini)
        self._div_before_footer.setVisible(not is_mini)
        self._footer_widget.setVisible(not is_mini)
        self._mini_view.setVisible(is_mini)

        # Apply initial adaptive grid spacing for mini view (will be refined
        # on subsequent resize events as the user drags).
        if is_mini:
            self._update_mini_grid_spacing()

        # Resize the window. Mini mode shrinks; full mode restores prior size.
        # Mode toggles use an animated tween (OutCubic, ~180ms) for a smooth
        # transition; the very first call at startup uses an instant resize
        # so the widget appears at its remembered size without an opening jump.
        self._internal_toggle_resize = True
        try:
            self._apply_minimum_size()
            if is_mini:
                target = self._cfg.value("widget_size_mini")
            else:
                # widget_size is updated on every full-mode resizeEvent,
                # so it always holds the last user-chosen full-mode geometry.
                target = self._cfg.value("widget_size")

            if target and target.isValid():
                if initial:
                    self.resize(target)
                else:
                    self._animate_resize_to(target)
            else:
                self.adjustSize()
        finally:
            # If we kicked off an animation, the finished-signal handler will
            # clear this flag instead — leave it set so resize-event saves stay
            # suppressed for the duration of the tween.
            if self._resize_anim.state() != QPropertyAnimation.State.Running:
                self._internal_toggle_resize = False

    def _animate_resize_to(self, target: QSize, duration: int = 180):
        """Tween the window from its current size to `target` size."""
        if self._resize_anim.state() == QPropertyAnimation.State.Running:
            self._resize_anim.stop()
        self._resize_anim.setDuration(duration)
        self._resize_anim.setStartValue(self.size())
        self._resize_anim.setEndValue(target)
        self._resize_anim.start()

    def _toggle_mini(self):
        """헤더/미니뷰의 Claude 아이콘 클릭 또는 트레이 메뉴에서 호출.

        모드 플립 직전에 *떠나는 모드*의 현재 사이즈를 그 모드 키에 즉시 스냅샷.
        resizeEvent가 평소엔 연속 저장하지만 옵션 패널 열림/programmatic resize
        등의 가드 케이스에서 누락될 수 있어 여기서 한 번 더 보장.
        """
        leaving_key = "widget_size_mini" if self._mini_mode else "widget_size"
        self._cfg.setValue(leaving_key, self.size())

        self._mini_mode = not self._mini_mode
        self._cfg.setValue("mini_mode", "true" if self._mini_mode else "false")
        self._apply_mini_mode()
        self._rebuild_tray_menu()

    # footer
    def _make_footer(self) -> QWidget:
        w = QWidget()
        l = QHBoxLayout(w); l.setContentsMargins(14,8,14,8); l.setSpacing(8)
        self._version_lbl = QLabel(APP_VERSION)
        self._version_lbl.setObjectName("footerVersion")
        self._last_sync_lbl = QLabel()
        self._last_sync_lbl.setObjectName("footerSub")
        self._last_sync_lbl.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self._sync_btn = QPushButton()
        self._sync_btn.clicked.connect(self.do_sync)
        self._footer_sep = QLabel("|")
        self._footer_sep.setObjectName("footerSep")
        self._quit_btn = QPushButton()
        self._quit_btn.clicked.connect(self.hide)

        l.addWidget(self._version_lbl)
        l.addWidget(self._last_sync_lbl, 1)
        l.addWidget(self._sync_btn); l.addWidget(self._footer_sep); l.addWidget(self._quit_btn)
        return w

    # ── Theme application ────────────────────────────────────
    def _apply_theme(self):
        t  = self._theme
        tp = t["text_primary"]
        ts = t["text_secondary"]
        tpc = f"rgb({tp.red()},{tp.green()},{tp.blue()})"
        tsc = f"rgba({ts.red()},{ts.green()},{ts.blue()},220)"
        tog = _toggle_style(t, self._widget_scale)

        panel_bg = self._alpha_color(t["panel_bg"])
        card_bg = self._alpha_color(t["card_bg"])
        divider_color = self._alpha_color(t["divider"])
        progress_bg = self._alpha_color(t["progress_bg"])
        drag_bar = self._alpha_color(t["drag_bar"])
        border = self._alpha_color(t["border"])

        runtime_theme = dict(t)
        runtime_theme["progress_bg"] = progress_bg
        runtime_theme["divider"] = divider_color
        runtime_theme["drag_bar"] = drag_bar

        # panel
        self._panel.setStyleSheet(
            f"#mainPanel{{background:{self._rgba(panel_bg)};border-radius:0px;border:1px solid {self._rgba(border)};}}"
        )

        # drag bar
        db = drag_bar
        self._drag_bar.setStyleSheet(
            f"background:rgba({db.red()},{db.green()},{db.blue()},{db.alpha()});border-radius:2px;"
        )

        # header labels
        self._title_lbl.setStyleSheet(
            f"font-size:{self._sp(15)}px;font-weight:700;color:{tpc};letter-spacing:-0.2px;"
        )
        self._status_icon.setStyleSheet(f"font-size:{self._sp(11)}px;color:{tsc};")
        self._status_text.setStyleSheet(f"font-size:{self._sp(12)}px;color:{tsc};")
        self._settings_btn.setStyleSheet(f"""
            QPushButton {{
                background:transparent;border:none;
                color:{tsc};font-size:{self._sp(14)}px;border-radius:{self._sp(6)}px;
            }}
            QPushButton:hover {{
                color:{ORANGE_RGB};background:rgba(217,119,87,20);
            }}
        """)

        # settings panel
        for lbl in (self._sett_lang_label, self._sett_cred_label,
                    self._sett_opacity_label, self._auto_sync_lbl,
                    self._sett_update_label):
            lbl.setStyleSheet(f"font-size:{self._sp(14)}px;font-weight:600;color:{tsc};")
        for btn in (self._btn_en, self._btn_ko, self._aot_btn,
                    self._dark_btn):
            btn.setStyleSheet(tog)
        self._cred_status.setStyleSheet(f"font-size:{self._sp(11)}px;color:{tpc};")
        self._update_status.setStyleSheet(f"font-size:{self._sp(13)}px;color:{tpc};")
        self._opacity_value.setStyleSheet(f"font-size:{self._sp(13)}px;color:{tpc};")
        accent_btn_qss = f"""
            QPushButton {{
                font-size:{self._sp(13)}px;font-weight:600;color:{ORANGE_RGB};
                background:rgba(217,119,87,20);border:1px solid rgba(217,119,87,60);
                border-radius:{self._sp(5)}px;padding:{self._sp(4)}px {self._sp(10)}px;
            }}
            QPushButton:hover {{ background:rgba(217,119,87,40); }}
            QPushButton:disabled {{ color:rgba(217,119,87,120); }}
        """
        self._cred_refresh.setStyleSheet(accent_btn_qss)
        self._update_btn.setStyleSheet(accent_btn_qss)

        # cards
        card_qss = (
            f"#glassCard{{background:{self._rgba(card_bg)};"
            f"border:1px solid {self._rgba(border)};border-radius:{self._sp(12)}px;}}"
        )
        for f in (self._session_frame, self._weekly_frame):
            f.setStyleSheet(card_qss)

        for sh in (self._card_shadow_session, self._card_shadow_weekly):
            sh.setColor(t["card_shadow"])

        # card text
        for w in (self._session_title, self._weekly_title):
            w.setStyleSheet(f"font-size:{self._sp(17)}px;font-weight:700;color:{tpc};")
        for w in (self._session_pct,):
            w.setStyleSheet(f"font-size:{self._sp(28)}px;font-weight:700;color:{SUCCESS.name()};")
        for w in (self._all_models_lbl, self._sonnet_lbl):
            w.setStyleSheet(f"font-size:{self._sp(16)}px;font-weight:500;color:{tpc};")
        for w in (self._all_models_pct, self._sonnet_pct):
            w.setStyleSheet(f"font-size:{self._sp(22)}px;font-weight:700;color:{SUCCESS.name()};")
        for w in (self._session_reset, self._all_models_reset):
            w.setStyleSheet(f"font-size:{self._sp(13)}px;color:{tsc};")
        self._learn_more_btn.setStyleSheet(
            f"QPushButton{{font-size:{self._sp(12)}px;color:{ORANGE_RGB};background:transparent;border:none;padding:0;}}"
            "QPushButton:hover{text-decoration:underline;}"
        )
        self._sync_note.setStyleSheet(f"font-size:{self._sp(11)}px;color:rgba({ts.red()},{ts.green()},{ts.blue()},160);")

        # interval buttons
        for b in self._interval_btns.values():
            b.setStyleSheet(tog)

        # footer
        self._last_sync_lbl.setStyleSheet(f"font-size:{self._sp(12)}px;color:{tsc};")
        self._version_lbl.setStyleSheet(
            f"font-size:{self._sp(12)}px;font-weight:600;color:{ORANGE_RGB};"
            "letter-spacing:0.3px;"
        )
        self._sync_btn.setStyleSheet(
            f"QPushButton{{font-size:{self._sp(12)}px;font-weight:600;color:{ORANGE_RGB};background:transparent;border:none;}}"
            "QPushButton:hover{opacity:0.7;}"
        )
        bd = t["border"]
        self._footer_sep.setStyleSheet(
            f"font-size:{self._sp(12)}px;color:{self._rgba(bd)};"
        )
        self._quit_btn.setStyleSheet(
            f"QPushButton{{font-size:{self._sp(12)}px;font-weight:600;color:{DANGER_RGB};background:transparent;border:none;}}"
            "QPushButton:hover{opacity:0.7;}"
        )

        # dividers
        for d in (self._div_after_header, self._div_before_footer, self._weekly_div):
            dv = divider_color
            d.setStyleSheet(f"background:rgba({dv.red()},{dv.green()},{dv.blue()},{dv.alpha()});")

        # progress bars
        for bar in (self._session_bar, self._all_models_bar, self._sonnet_bar):
            bar.set_theme(runtime_theme)

        # tray icon
        if hasattr(self, "_tray"):
            self._tray.setIcon(self._make_tray_icon())

        # mini view labels — primary text color, larger weight for readability
        if hasattr(self, "_mini_session_lbl"):
            for lbl in (self._mini_session_lbl, self._mini_all_lbl, self._mini_sonnet_lbl):
                lbl.setStyleSheet(
                    f"font-size:{self._sp(17)}px;font-weight:700;color:{tpc};"
                    "letter-spacing:-0.1px;"
                )

        # Re-apply state-dependent colors (status text, percent labels)
        # so resize/theme changes don't reset them to the gray/green defaults.
        self._apply_runtime_colors()

        self.update()

    # ── Runtime (state-dependent) styling ────────────────────
    def _apply_runtime_colors(self):
        """Re-apply colors that depend on current connection state and last
        observed percent values. Called at the end of _apply_theme() so
        toggling settings / resizing the window doesn't reset status to gray
        or percent labels to default green."""
        if self._status_state == "connected":
            c = SUCCESS_RGB
        elif self._status_state == "error":
            c = DANGER_RGB
        else:
            ts = self._theme["text_secondary"]
            c = f"rgba({ts.red()},{ts.green()},{ts.blue()},220)"
        self._status_icon.setStyleSheet(f"font-size:{self._sp(11)}px;color:{c};")
        self._status_text.setStyleSheet(f"font-size:{self._sp(12)}px;color:{c};")

        # Full-mode percent colors stay tied to last successful values so
        # context isn't lost when a sync fails. Mini-mode percent colors
        # collapse to "0% green" on error/checking — matches the "0%" text
        # set by _reset_mini_pct_to_zero() so both stay in sync.
        is_connected = self._status_state == "connected"
        if self._last_session_pct is not None:
            self._set_pct_color(self._session_pct, self._last_session_pct, big=True)
        if self._last_all_pct is not None:
            self._set_pct_color(self._all_models_pct, self._last_all_pct)
        if self._last_sonnet_pct is not None:
            self._set_pct_color(self._sonnet_pct, self._last_sonnet_pct)

        if hasattr(self, "_mini_session_pct"):
            for mini_lbl, last_pct in (
                (self._mini_session_pct, self._last_session_pct),
                (self._mini_all_pct, self._last_all_pct),
                (self._mini_sonnet_pct, self._last_sonnet_pct),
            ):
                pct_for_color = last_pct if (is_connected and last_pct is not None) else 0.0
                self._set_pct_color(mini_lbl, pct_for_color, mini=True)

    # ── Language ─────────────────────────────────────────────
    def _set_lang(self, lc: str):
        self._lang = lc
        self._cfg.setValue("lang", lc)
        self._btn_en.setChecked(lc == "en")
        self._btn_ko.setChecked(lc == "ko")
        self._apply_language()
        self._rebuild_tray_menu()

    def _apply_language(self):
        s = I18N[self._lang]
        self._title_lbl.setText(s["appTitle"])
        self._session_title.setText(s["currentSession"])
        self._weekly_title.setText(s["weeklyLimits"])
        self._all_models_lbl.setText(s["allModels"])
        self._sonnet_lbl.setText(s["sonnetOnly"])
        self._learn_more_btn.setText(s["learnMore"])
        self._auto_sync_lbl.setText(s["autoSync"])
        self._sync_note.setText(s["syncNote"])
        self._sync_btn.setText(s["sync"])
        self._quit_btn.setText(s["closeWindow"])
        self._sett_lang_label.setText(s["language"])
        self._sett_cred_label.setText(s["credentials"])
        self._cred_refresh.setText(s["refresh"])
        self._aot_btn.setText(s["alwaysOnTop"])
        self._dark_btn.setText(s["darkMode"])
        self._mini_session_lbl.setText(s["miniSession"])
        self._mini_all_lbl.setText(s["miniAll"])
        self._mini_sonnet_lbl.setText(s["miniSonnet"])
        self._mini_icon.setToolTip(s["miniExitTip"])
        self._header_icon.setToolTip(s["miniEnterTip"])
        self._sett_opacity_label.setText(s["bgOpacity"])
        self._opacity_value.setText(f"{self._bg_opacity}%")
        self._sett_update_label.setText(s["updateSection"])
        self._update_btn.setText(s["checkForUpdate"])
        lv = self._cfg.value("last_sync_time", None)
        self._last_sync_lbl.setText(s["lastSync"](lv) if lv else s["never"])

        # Status text — re-render in current language based on tracked state.
        if self._status_state == "connected":
            self._status_text.setText(s["connected"])
        elif self._status_state == "error":
            if self._status_error_key and self._status_error_key in s:
                self._status_text.setText(s[self._status_error_key])
            elif self._status_error_raw:
                self._status_text.setText(self._status_error_raw)
        else:
            self._status_text.setText(s["checking"])

        # Credentials status — re-localize, preferring tracked state to avoid
        # an extra filesystem read when we already know the result.
        if self._cred_present is None:
            self._cred_present = FetchWorker.read_credentials() is not None
        self._cred_status.setText(s["autoDetected"] if self._cred_present else s["notFound"])

        # Interval buttons — only "manual" (secs=0) is language-dependent.
        for secs, btn in self._interval_btns.items():
            btn.setText(self._interval_label(secs))

        # Weekly reset text (day name + AM/PM is language-dependent)
        if self._last_reset:
            formatted = s["formatResetTime"](*self._last_reset)
            self._all_models_reset.setText(s["resetsAt"](formatted))

        # Session reset text (language-dependent — "Resets in 1h 4m" / "1시간 4분 후 초기화")
        if self._last_session_reset_secs is not None:
            secs = self._last_session_reset_secs
            h, m = secs // 3600, (secs % 3600) // 60
            self._session_reset.setText(
                s["resetsSoon"] if (h == 0 and m == 0) else s["resetsIn"](h, m)
            )

    # ── Toggle helpers ────────────────────────────────────────
    def _toggle_settings(self):
        is_visible = self._settings_panel.isVisible()
        keep_w = self.width()

        self._internal_toggle_resize = True
        try:
            if not is_visible:
                # Save current (collapsed) height before expanding settings panel.
                self._collapsed_height = self.height()
                # Hide cards while settings is open so the panel takes the
                # middle area cleanly — keeps top/middle/bottom proportions natural.
                self._content_wrapper.setVisible(False)
                self._div_after_header.setVisible(False)
                self._settings_panel.setVisible(True)
                self.adjustSize()
                self.resize(keep_w, self.height())
            else:
                self._settings_panel.setVisible(False)
                self._content_wrapper.setVisible(True)
                self._div_after_header.setVisible(True)
                target_h = self._collapsed_height if self._collapsed_height is not None else self.height()
                target_h = max(self.minimumHeight(), int(target_h))
                self.resize(keep_w, target_h)
                self._cfg.setValue("widget_size", self.size())
        finally:
            self._internal_toggle_resize = False

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        # Only re-apply the (expensive) theme stylesheet pass when the quantized
        # scale actually changed — this keeps drag-resize smooth instead of
        # restyling every widget on every mouse-move event. Additionally
        # debounce the QSS pass so diagonal corner drags don't stutter when
        # multiple quantum crossings happen in quick succession.
        if self._apply_widget_scale():
            self._theme_reapply_timer.start(50)
        # Mini-grid spacing tracks width continuously so the layout compresses
        # smoothly as the user drags the mini widget narrower.
        self._update_mini_grid_spacing()
        if not self._settings_panel.isVisible() and not self._internal_toggle_resize:
            key = "widget_size_mini" if self._mini_mode else "widget_size"
            self._cfg.setValue(key, self.size())

    # ── Update check / download ─────────────────────────────
    def _startup_update_check(self):
        """One-shot silent check at program launch — populates the short
        status next to the update button. Errors are suppressed because
        the user didn't request this check."""
        if self._update_check_worker is not None:
            return
        self._update_check_worker = UpdateCheckWorker(self)
        self._update_check_worker.finished_with.connect(self._on_startup_update_check_done)
        self._update_check_worker.finished.connect(self._update_check_worker.deleteLater)
        self._update_check_worker.start()

    def _on_startup_update_check_done(self, res: dict):
        self._update_check_worker = None
        if "error" in res:
            return
        latest = res.get("latest", "")
        if not latest:
            return
        s = I18N[self._lang]
        if _version_tuple(latest) <= _version_tuple(APP_VERSION):
            self._update_status.setText(s["upToDateShort"])
        else:
            self._update_status.setText(s["newVersionShort"](latest))

    def _check_for_updates(self):
        if self._update_check_worker is not None or self._dl_worker is not None:
            return
        s = I18N[self._lang]
        self._update_btn.setEnabled(False)
        self._update_status.setText(s["checkingUpdate"])
        self._update_check_worker = UpdateCheckWorker(self)
        self._update_check_worker.finished_with.connect(self._on_update_check_done)
        self._update_check_worker.finished.connect(self._update_check_worker.deleteLater)
        self._update_check_worker.start()

    def _on_update_check_done(self, res: dict):
        self._update_check_worker = None
        self._update_btn.setEnabled(True)
        s = I18N[self._lang]
        if "error" in res:
            self._update_status.setText(f"{s['checkFailed']}: {res['error']}")
            return
        latest = res.get("latest", "")
        cur    = APP_VERSION
        if not latest or _version_tuple(latest) <= _version_tuple(cur):
            self._update_status.setText(s["upToDate"](cur))
            return
        url  = res.get("url", "")
        name = res.get("name", "Claude-Widget.exe")
        if not url:
            self._update_status.setText(f"{s['checkFailed']}: no .exe asset")
            return
        self._update_status.setText(s["updateAvailable"](latest))
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Icon.Question)
        box.setWindowTitle(s["checkForUpdate"])
        box.setText(s["updateAvailableMsg"](latest, cur))
        box.setStandardButtons(QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        box.setDefaultButton(QMessageBox.StandardButton.Yes)
        if box.exec() != QMessageBox.StandardButton.Yes:
            return
        self._begin_update_download(url, name, latest)

    def _begin_update_download(self, url: str, name: str, latest: str):
        s = I18N[self._lang]
        downloads = self._windows_downloads_dir()
        base, ext = os.path.splitext(name)
        # Stamp the version in the filename so users can keep multiple builds.
        if latest and latest.lstrip("vV") not in base:
            fname = f"{base}-{latest}{ext}"
        else:
            fname = name
        dest = self._unique_path(os.path.join(downloads, fname))

        # Open Explorer at the Downloads folder so the user can watch the file
        # land. Silent on failure — the download itself is unaffected.
        try:
            os.startfile(downloads)
        except Exception:
            pass

        self._update_btn.setEnabled(False)
        self._dl_progress = QProgressDialog(
            s["downloading"](0), s["cancel"], 0, 100, self
        )
        self._dl_progress.setWindowTitle(s["checkForUpdate"])
        self._dl_progress.setWindowModality(Qt.WindowModality.WindowModal)
        self._dl_progress.setMinimumDuration(0)
        self._dl_progress.setAutoClose(False)
        self._dl_progress.setAutoReset(False)

        self._dl_worker = UpdateDownloadWorker(url, dest, self)
        self._dl_worker.progress.connect(self._on_download_progress)
        self._dl_worker.finished_with.connect(self._on_download_done)
        self._dl_worker.finished.connect(self._dl_worker.deleteLater)
        self._dl_progress.canceled.connect(self._dl_worker.cancel)
        self._dl_worker.start()
        self._dl_progress.show()

    def _on_download_progress(self, pct: int):
        s = I18N[self._lang]
        if self._dl_progress is not None:
            self._dl_progress.setValue(pct)
            self._dl_progress.setLabelText(s["downloading"](pct))

    def _on_download_done(self, res: dict):
        s = I18N[self._lang]
        if self._dl_progress is not None:
            self._dl_progress.close()
            self._dl_progress = None
        self._dl_worker = None
        self._update_btn.setEnabled(True)
        if "error" in res:
            if res["error"] == "CANCELLED":
                self._update_status.setText("")
            else:
                self._update_status.setText(f"{s['downloadFailed']}: {res['error']}")
                QMessageBox.warning(self, s["checkForUpdate"],
                                    f"{s['downloadFailed']}\n{res['error']}")
            return
        new_path = res["path"]
        self._update_status.setText(s["restartingNow"])
        self._restart_with_new_exe(new_path)

    def _windows_downloads_dir(self) -> str:
        """Resolve the user's Downloads folder. The on-disk name is always
        'Downloads' even on localized Windows (the folder is just *displayed*
        with the localized label), so a simple join is reliable."""
        p = Path.home() / "Downloads"
        if p.is_dir():
            return str(p)
        return str(Path.home())

    def _unique_path(self, path: str) -> str:
        if not os.path.exists(path):
            return path
        base, ext = os.path.splitext(path)
        i = 1
        while os.path.exists(f"{base} ({i}){ext}"):
            i += 1
        return f"{base} ({i}){ext}"

    def _restart_with_new_exe(self, new_exe_path: str):
        """새 .exe를 실행하고 자기 자신을 종료해 자동 재시작 효과를 만든다.

        문제: main.py의 단일 인스턴스 mutex(`ClaudeWidget_Mutex_v1`)가 살아 있는
        상태에서 새 .exe를 즉시 실행하면 새 인스턴스가 mutex 충돌로 즉시 종료됨.
        해결: 임시 .bat 헬퍼를 detached로 띄워 2초 대기 후 새 exe를 실행.
        그 사이 우리 프로세스는 quit() → mutex 해제 → 새 exe가 정상 시작.
        """
        bat_path = Path(tempfile.gettempdir()) / "claude_widget_restart.bat"
        bat_path.write_text(
            "@echo off\r\n"
            "timeout /t 2 /nobreak >nul\r\n"
            f'start "" "{new_exe_path}"\r\n'
            'del "%~f0"\r\n',
            encoding="ascii",
        )
        DETACHED_PROCESS = 0x00000008
        CREATE_NO_WINDOW = 0x08000000
        try:
            subprocess.Popen(
                ["cmd", "/c", str(bat_path)],
                creationflags=DETACHED_PROCESS | CREATE_NO_WINDOW,
                close_fds=True,
            )
        except Exception:
            # If we can't spawn the helper, surface the path so the user can run it.
            QMessageBox.information(
                self, I18N[self._lang]["checkForUpdate"],
                f"{new_exe_path}",
            )
            return
        self._tray.hide()
        QApplication.quit()

    def _toggle_aot(self):
        self._aot = not self._aot
        self._cfg.setValue("always_on_top", "true" if self._aot else "false")
        self._aot_btn.setChecked(self._aot)
        # Preserve geometry — setWindowFlags can re-create the native window
        # and reset position/size on some Windows compositor paths.
        geo = self.geometry()
        flags = self.windowFlags()
        if self._aot:
            flags |= Qt.WindowType.WindowStaysOnTopHint | Qt.WindowType.Tool
        else:
            flags &= ~(Qt.WindowType.WindowStaysOnTopHint | Qt.WindowType.Tool)
        self.setWindowFlags(flags)
        self.setGeometry(geo)
        self.show()
        self._rebuild_tray_menu()

    def _toggle_dark(self):
        self._dark = not self._dark
        self._cfg.setValue("dark_mode", "true" if self._dark else "false")
        self._dark_btn.setChecked(self._dark)
        self._theme = THEMES["dark"] if self._dark else THEMES["light"]
        self._apply_theme()
        self._rebuild_tray_menu()

    def _set_interval(self, secs: int):
        self._interval = secs
        self._cfg.setValue("sync_interval", secs)
        for k, b in self._interval_btns.items():
            b.setChecked(k == secs)
        self._setup_auto_sync()

    # ── Sync ─────────────────────────────────────────────────
    def _setup_auto_sync(self):
        """자동 동기화 사이클 시작/재시작.

        첫 sync는 0–2초 랜덤 지연 후 실행 — 매번 정확히 같은 시각에 첫 호출이
        떨어지지 않게 분산. 이후 sync는 _schedule_next_sync()가 ±10% jitter와
        429 응답 시 지수 백오프를 적용해 매 사이클 단발성 타이머로 다시 잡는다.
        """
        self._sync_timer.stop()
        self._consecutive_429 = 0
        if self._interval > 0:
            self._sync_timer.start(random.randint(0, SYNC_STARTUP_JITTER_MS))

    def _schedule_next_sync(self):
        """fetch 완료 후 다음 sync까지의 대기 타이머를 다시 설정.

        - 사용자가 설정한 주기(예: 600초)에 ±10% 랜덤 jitter를 붙여서 호출
          시점이 고정되지 않도록 함 → 자연스러운 분산.
        - 직전 응답이 `429 Rate Limited` 였다면 지수 백오프 적용:
          1× → 2× → 4× → 8× → 16× (상한). 한 번이라도 성공하면 카운터를
          0으로 리셋해 즉시 정상 주기로 복귀 — 백오프가 누적되어 멈춰있지 않음.
        """
        if self._interval <= 0:
            return  # manual mode
        backoff = 2 ** min(self._consecutive_429, RATE_LIMIT_BACKOFF_CAP_EXP)
        base_ms = self._interval * 1000 * backoff
        jitter_ms = int(base_ms * random.uniform(-SYNC_JITTER_RATIO, SYNC_JITTER_RATIO))
        self._sync_timer.start(max(1000, base_ms + jitter_ms))

    def do_sync(self):
        if self._is_syncing:
            return
        self._is_syncing = True
        self._sync_btn.setText("↻")
        self._status_icon.setText("↻")
        self._status_icon.setStyleSheet("font-size:11px;color:rgb(107,114,128);")

        self._worker = FetchWorker(self)
        self._worker.result.connect(self._on_done)
        self._worker.finished.connect(self._worker.deleteLater)
        self._worker.start()

    def _on_done(self, usage: dict):
        self._is_syncing = False
        s = I18N[self._lang]
        self._sync_btn.setText(s["sync"])

        self._update_cred_indicator(s)

        err = usage.get("error")
        # Track 429s for exponential backoff. Other errors leave the counter
        # alone so a transient hiccup doesn't slow down recovery.
        if err == "RATE_LIMITED":
            self._consecutive_429 += 1
        elif not err:
            self._consecutive_429 = 0
        # Re-arm the auto-sync timer with jitter (and backoff if applicable).
        # Done unconditionally before any early returns so polling continues
        # whatever the outcome.
        self._schedule_next_sync()

        if err:
            self._handle_sync_error(err, s)
            return

        self._render_session(usage, s)
        self._render_weekly(usage, s)
        self._render_sonnet(usage)
        self._plan_badge.setText(usage.get("planName", "Max"))
        self._set_status_connected(s)
        self._record_last_sync_time(s)
        # Sync 1회 사이클이 끝나는 시점은 short-lived 객체(JSON 파싱 결과,
        # response 객체, deleteLater 예약 워커 등)를 정리하기 좋은 자연스러운
        # 휴식 지점. 백그라운드로 오래 띄워둘 때 메모리 누적을 줄여 준다.
        gc.collect()

    # ── _on_done helpers ────────────────────────────────────
    def _update_cred_indicator(self, s: dict):
        creds = FetchWorker.read_credentials()
        self._cred_present = creds is not None
        ok_color = SUCCESS_RGB if creds else DANGER_RGB
        self._cred_dot.setStyleSheet(f"font-size:10px;color:{ok_color};")
        self._cred_status.setText(s["autoDetected"] if creds else s["notFound"])

    def _handle_sync_error(self, err: str, s: dict):
        # Mini view shows only percentages, so reset them to "0%" on
        # disconnect — stale "--" or last-known values would mislead at a glance.
        self._reset_mini_pct_to_zero()
        if err == "NO_CREDENTIALS":
            self._set_status_error(s["notLoggedIn"], key="notLoggedIn")
        elif err == "TOKEN_EXPIRED":
            self._set_status_error(s["tokenExpired"], key="tokenExpired")
        elif err == "RATE_LIMITED":
            self._set_status_error(s["rateLimited"], key="rateLimited")
        else:
            self._set_status_error(err[:40])

    def _render_session(self, usage: dict, s: dict):
        pct = usage["sessionUsagePercent"]
        self._last_session_pct = pct
        self._session_bar.set_percent(pct)
        self._render_pct(self._session_pct, pct, big=True)
        self._render_pct(self._mini_session_pct, pct, mini=True)
        secs = usage["sessionResetSeconds"]
        self._last_session_reset_secs = secs
        h, m = secs // 3600, (secs % 3600) // 60
        self._session_reset.setText(
            s["resetsSoon"] if (h == 0 and m == 0) else s["resetsIn"](h, m)
        )

    def _render_weekly(self, usage: dict, s: dict):
        pct = usage["weeklyAllModelsPercent"]
        self._last_all_pct = pct
        self._all_models_bar.set_percent(pct)
        self._render_pct(self._all_models_pct, pct)
        self._render_pct(self._mini_all_pct, pct, mini=True)
        self._last_reset = usage.get("weeklyAllModelsReset")
        if self._last_reset:
            formatted = s["formatResetTime"](*self._last_reset)
            self._all_models_reset.setText(s["resetsAt"](formatted))
        else:
            self._all_models_reset.setText("")

    def _render_sonnet(self, usage: dict):
        pct = usage["weeklySonnetPercent"]
        self._last_sonnet_pct = pct
        self._sonnet_bar.set_percent(pct)
        self._render_pct(self._sonnet_pct, pct)
        self._render_pct(self._mini_sonnet_pct, pct, mini=True)

    def _set_status_connected(self, s: dict):
        self._status_state = "connected"
        self._status_error_key = None
        self._status_error_raw = None
        self._status_icon.setText("✓")
        self._status_icon.setStyleSheet(f"font-size:{self._sp(11)}px;color:{SUCCESS_RGB};")
        self._status_text.setText(s["connected"])
        self._status_text.setStyleSheet(f"font-size:{self._sp(12)}px;color:{SUCCESS_RGB};")

    def _record_last_sync_time(self, s: dict):
        now = datetime.now()
        h12 = now.hour % 12 or 12
        ap = "AM" if now.hour < 12 else "PM"
        tstr = f"{h12}:{now.minute:02d} {ap}".lower()
        self._cfg.setValue("last_sync_time", tstr)
        self._last_sync_lbl.setText(s["lastSync"](tstr))

    def _set_status_error(self, msg: str, key: str | None = None):
        self._status_state = "error"
        self._status_error_key = key
        self._status_error_raw = msg if key is None else None
        self._status_icon.setText("✗")
        self._status_icon.setStyleSheet(f"font-size:{self._sp(11)}px;color:{DANGER_RGB};")
        self._status_text.setText(msg)
        self._status_text.setStyleSheet(f"font-size:{self._sp(12)}px;color:{DANGER_RGB};")

    def _reset_mini_pct_to_zero(self):
        """Show '0%' on the mini-mode percent labels when the API is unreachable.
        Full-mode cards keep their last-known values (still useful as context);
        mini view has no other state cue, so a clear '0%' is preferable to stale data.
        _apply_runtime_colors() also forces mini color to 0%-green while
        _status_state == 'error', keeping text and color in sync after theme changes."""
        if not hasattr(self, "_mini_session_pct"):
            return
        for lbl in (self._mini_session_pct, self._mini_all_pct, self._mini_sonnet_pct):
            lbl.setText("0%")
            self._set_pct_color(lbl, 0.0, mini=True)

    def _render_pct(self, lbl: QLabel, pct: float, *, big: bool = False, mini: bool = False):
        """Update a percent label's text + color in one shot.
        Replaces the `lbl.setText(f"{round(p)}%"); self._set_pct_color(lbl, p, ...)`
        idiom that was repeated 6× in _on_done."""
        lbl.setText(f"{round(pct)}%")
        self._set_pct_color(lbl, pct, big=big, mini=mini)

    def _set_pct_color(self, lbl: QLabel, pct: float, big: bool = False, mini: bool = False):
        # Sizes must mirror the corresponding card-text rules in _apply_theme,
        # because this method overwrites the same labels' stylesheets every
        # sync — a divergence here means the QSS-driven sizes silently revert.
        if mini:
            sz = f"{self._sp(26)}px"
        elif big:
            sz = f"{self._sp(28)}px"
        else:
            sz = f"{self._sp(22)}px"
        if pct >= PCT_THRESHOLD_DANGER:
            c = DANGER.name()
        elif pct >= PCT_THRESHOLD_WARN:
            c = WARNING.name()
        else:
            c = SUCCESS.name()
        lbl.setStyleSheet(f"font-size:{sz};font-weight:700;color:{c};letter-spacing:-0.2px;")

    def _refresh_creds_and_sync(self):
        creds = FetchWorker.read_credentials()
        self._cred_present = creds is not None
        s = I18N[self._lang]
        if creds:
            self._cred_dot.setStyleSheet(f"font-size:10px;color:{SUCCESS_RGB};")
            self._cred_status.setText(s["autoDetected"])
        else:
            self._cred_dot.setStyleSheet(f"font-size:10px;color:{DANGER_RGB};")
            self._cred_status.setText(s["notFound"])
        self.do_sync()

    # ── Drag ─────────────────────────────────────────────────
    def _drag_press(self, ev):
        if ev.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = ev.globalPosition().toPoint() - self.frameGeometry().topLeft()
            self._dragging = True; ev.accept()

    def _drag_move(self, ev):
        if self._dragging and ev.buttons() == Qt.MouseButton.LeftButton:
            self.move(ev.globalPosition().toPoint() - self._drag_pos); ev.accept()

    def _drag_release(self, ev):
        self._dragging = False
        self._cfg.setValue("pos", self.pos()); ev.accept()

    def _resize_edges_from_global(self, gp: QPoint):
        # Top edge (and top-left/top-right corners) intentionally NOT resizable:
        # the drag handle and Claude icon live there, so resize would steal
        # mouse events that should belong to the move/click flow — especially
        # noticeable in mini mode where the entire top strip is interactive.
        g = self.frameGeometry()
        b = self._resize_border
        on_left = g.left() <= gp.x() < g.left() + b
        on_right = g.right() - b < gp.x() <= g.right()
        on_bottom = g.bottom() - b < gp.y() <= g.bottom()

        edges = Qt.Edge(0)
        if on_left:
            edges |= Qt.Edge.LeftEdge
        if on_right:
            edges |= Qt.Edge.RightEdge
        if on_bottom:
            edges |= Qt.Edge.BottomEdge
        return edges

    @staticmethod
    def _cursor_from_edges(edges: Qt.Edge):
        has_left = bool(edges & Qt.Edge.LeftEdge)
        has_right = bool(edges & Qt.Edge.RightEdge)
        has_top = bool(edges & Qt.Edge.TopEdge)
        has_bottom = bool(edges & Qt.Edge.BottomEdge)

        if (has_left and has_top) or (has_right and has_bottom):
            return Qt.CursorShape.SizeFDiagCursor
        if (has_right and has_top) or (has_left and has_bottom):
            return Qt.CursorShape.SizeBDiagCursor
        if has_left or has_right:
            return Qt.CursorShape.SizeHorCursor
        if has_top or has_bottom:
            return Qt.CursorShape.SizeVerCursor
        return None

    def eventFilter(self, obj, ev):
        if ev.type() == QEvent.Type.MouseMove and hasattr(ev, "globalPosition") and self.isVisible():
            gp = ev.globalPosition().toPoint()
            if self.frameGeometry().contains(gp):
                edges = self._resize_edges_from_global(gp)
                shape = self._cursor_from_edges(edges)
                if shape is not None:
                    self.setCursor(shape)
                else:
                    self.unsetCursor()
            else:
                self.unsetCursor()

        if ev.type() == QEvent.Type.MouseButtonPress and hasattr(ev, "globalPosition"):
            if ev.button() == Qt.MouseButton.LeftButton and self.isVisible():
                gp = ev.globalPosition().toPoint()
                if self.frameGeometry().contains(gp):
                    edges = self._resize_edges_from_global(gp)
                    if edges != Qt.Edge(0):
                        wh = self.windowHandle()
                        if wh and wh.startSystemResize(edges):
                            return True

        if ev.type() == QEvent.Type.Leave:
            self.unsetCursor()

        return super().eventFilter(obj, ev)

    # ── Misc ─────────────────────────────────────────────────
    def _quit(self):
        self._tray.hide(); QApplication.quit()

    def closeEvent(self, ev):
        ev.ignore(); self.hide()
        s = I18N[self._lang]
        self._tray.showMessage(
            "Claude Widget", s["trayRunning"],
            QSystemTrayIcon.MessageIcon.Information, 2000,
        )

    def paintEvent(self, _):
        pass  # transparent root widget


# ════════════════════════════════════════════════════════════
#  Entry point
# ════════════════════════════════════════════════════════════
def main():
    """애플리케이션 진입점.

    순서: AppUserModelID 등록 → 단일 인스턴스 mutex → 폰트/아이콘 → 위젯 생성/표시.
    """
    if sys.platform == "win32":
        try:
            import ctypes
            # AppUserModelID — Windows가 작업표시줄 아이콘을 Python 기본 아이콘 대신
            # 우리 아이콘으로 표시하도록 식별자를 등록한다.
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("ClaudeWidget.Desktop.App.v1")
        except Exception:
            pass

    os.environ.setdefault("QT_ENABLE_HIGHDPI_SCALING", "1")
    app = QApplication(sys.argv)
    
    # ────────────────────────────────────────────────────────────
    # SINGLE INSTANCE LOCK
    # ────────────────────────────────────────────────────────────
    if sys.platform == "win32":
        import ctypes
        app._single_instance_mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "ClaudeWidget_Mutex_v1")
        if ctypes.windll.kernel32.GetLastError() == 183: # ERROR_ALREADY_EXISTS
            print("Already running! Exiting.")
            sys.exit(0)
    app.setApplicationName("Claude Widget")
    app.setOrganizationName("ClaudeWidget")
    app.setQuitOnLastWindowClosed(False)  # CRITICAL: keeps alive in tray after all windows hidden

    # Resolve and apply the global font (SUIT SemiBold preferred — bundled
    # or system-installed; falls back to Segoe UI so the app still runs cleanly
    # even before the user drops the .ttf into Source/assets/fonts/).
    global APP_FONT_FAMILY
    APP_FONT_FAMILY = _load_app_font()
    app_font = QFont(APP_FONT_FAMILY, 10)
    app_font.setWeight(QFont.Weight.DemiBold)  # request SemiBold weight
    app.setFont(app_font)

    # Set application icon (works for taskbar + alt-tab even on frameless windows)
    ico_path = resource_path(ICON_ASSET_PATH)
    if os.path.isfile(ico_path):
        app.setWindowIcon(QIcon(ico_path))

    if not QSystemTrayIcon.isSystemTrayAvailable():
        print("[WARN] System tray not available.")

    w = ClaudeWidget()
    w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
