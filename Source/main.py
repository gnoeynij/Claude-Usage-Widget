"""
Claude Usage Monitor — PyQt6 Desktop Widget
============================================
다크/라이트 모드, 다국어(ko/en), 트레이 아이콘, 드래그, 자동동기화 지원.

API  : https://api.anthropic.com/api/oauth/usage
Auth : ~/.claude/.credentials.json  (claudeAiOauth.accessToken)
Header: anthropic-beta: oauth-2025-04-20
"""

from __future__ import annotations
import sys, os, json, math, webbrowser
from pathlib import Path
from datetime import datetime, timezone


def resource_path(relative: str) -> str:
    """Return absolute path to bundled resource (works with PyInstaller --onefile)."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative)

import requests
from PyQt6.QtCore import (
    Qt, QTimer, QPoint, QSettings, QThread, pyqtSignal, QRect, QEvent,
)
from PyQt6.QtGui import (
    QColor, QPainter, QPainterPath, QFont, QIcon, QPixmap,
    QBrush, QPen, QLinearGradient, QAction,
)
from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QFrame, QSizePolicy, QSystemTrayIcon, QMenu,
    QGraphicsDropShadowEffect, QSlider,
)

APP_VERSION   = "v1.2.0"
USAGE_URL     = "https://api.anthropic.com/api/oauth/usage"
LEARN_MORE_URL = "https://support.claude.com/ko/"

SESSION = requests.Session()

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
        "syncNote":       "Note: API has rate limits. Min 5 min recommended.",
        "sync":           "Sync",
        "quit":           "Quit",
        "closeWindow":    "Close",
        "settings":       "Settings",
        "never":          "never",
        "resetsSoon":     "Resets soon",
        "resetsIn":       lambda h, m: (f"Resets in {h}h {m}m" if h > 0 else f"Resets in {m}m"),
        "resetsAt":       lambda d: f"Resets {d}",
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
        "syncNote":       "참고: API 속도 제한. 최소 5분 권장.",
        "sync":           "동기화",
        "quit":           "종료",
        "closeWindow":    "닫기",
        "settings":       "설정",
        "never":          "동기화 안됨",
        "resetsSoon":     "곧 초기화",
        "resetsIn":       lambda h, m: (f"{h}시간 {m}분 후 초기화" if h > 0 else f"{m}분 후 초기화"),
        "resetsAt":       lambda d: f"{d}에 초기화",
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
    },
}


# ════════════════════════════════════════════════════════════
#  Background fetch worker
# ════════════════════════════════════════════════════════════
class FetchWorker(QThread):
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

        weekly_reset_date = ""
        if seven_d.get("resets_at"):
            try:
                rd  = datetime.fromisoformat(seven_d["resets_at"].replace("Z", "+00:00"))
                loc = rd.astimezone()
                day = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][loc.weekday()]
                h12 = loc.hour % 12 or 12
                ap  = "AM" if loc.hour < 12 else "PM"
                weekly_reset_date = f"{day} {h12}:{loc.minute:02d} {ap}"
            except Exception:
                pass

        def pct(d): return float(d.get("utilization") or 0)

        return {
            "isConnected":             True,
            "sessionUsagePercent":     pct(five_h),
            "sessionResetSeconds":     session_reset_secs,
            "weeklyAllModelsPercent":  pct(seven_d),
            "weeklyAllModelsResetDate": weekly_reset_date,
            "weeklySonnetPercent":     pct(seven_s),
            "planName": "Max (Extra)" if extra.get("is_enabled") else "Max",
        }


# ════════════════════════════════════════════════════════════
#  Custom Progress Bar
# ════════════════════════════════════════════════════════════
class ProgressBar(QWidget):
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
        if pct >= 80: return QColor(248, 113, 113, a)
        if pct >= 50: return QColor(245, 158, 11, a)
        return QColor(16, 185, 129, a)

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
            p.setFont(QFont("Segoe UI", font_px))
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
            font-size:{sp(11)}px;
            padding: {sp(4)}px {sp(10)}px;
            border: 1px solid rgba({bd.red()},{bd.green()},{bd.blue()},{bd.alpha()});
            border-radius: {sp(6)}px;
            background: transparent;
            color: rgba({ts.red()},{ts.green()},{ts.blue()},220);
        }}
        QPushButton:checked {{
            color: rgb(217,119,87);
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

    def __init__(self):
        super().__init__()
        self._cfg = QSettings("ClaudeWidget", "Claude-Widget-Cross")
        self._lang     = self._cfg.value("lang",          "en")
        self._interval = int(self._cfg.value("sync_interval", 300))
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
        self._theme    = THEMES["dark"] if self._dark else THEMES["light"]
        self._resize_border = 8

        self._drag_pos    = QPoint()
        self._dragging    = False
        self._collapsed_height: int | None = None
        self._internal_toggle_resize = False
        self._is_syncing  = False
        self._worker: FetchWorker | None = None
        self._sync_timer  = QTimer(self)
        self._sync_timer.timeout.connect(self.do_sync)

        self._setup_window()
        self._build_ui()
        self.resize(326, max(360, self.sizeHint().height()))
        QApplication.instance().installEventFilter(self)
        self._setup_tray()
        self._apply_language()
        self._apply_widget_scale()
        self._apply_theme()
        self._setup_auto_sync()

        pos = self._cfg.value("pos")
        if pos:
            self.move(pos)
        else:
            scr = QApplication.primaryScreen().geometry()
            self.move(scr.width() - self.width() - 24, 24)

        saved_size = self._cfg.value("widget_size")
        if saved_size:
            self.resize(saved_size)



    # ── window ──────────────────────────────────────────────
    def _setup_window(self):
        # NOTE: Qt.WindowType.Tool 은 삭제 — Tool 창은 작업표시줄에서 자동 제외됨
        flags = (
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
        )
        if not self._aot:
            flags &= ~Qt.WindowType.WindowStaysOnTopHint
        self.setWindowFlags(flags)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, False)
        self.setMinimumWidth(220)
        self.setMinimumHeight(280)
        self.setMouseTracking(True)

    # ── tray ────────────────────────────────────────────────
    def _make_tray_icon(self) -> QIcon:
        ico_path = resource_path(os.path.join("assets", "icon.ico"))
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
        p.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
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
        pl.addWidget(self._make_header())

        self._settings_panel = self._make_settings_panel()
        self._settings_panel.setVisible(False)
        pl.addWidget(self._settings_panel)

        self._div_after_header = _divider(self._theme)
        pl.addWidget(self._div_after_header)

        # content
        cw = QWidget()
        cl = QVBoxLayout(cw)
        self._content_layout = cl
        cl.setContentsMargins(14, 14, 14, 14)
        cl.setSpacing(12)
        cl.addWidget(self._make_session_card())
        cl.addWidget(self._make_weekly_card())
        cl.addWidget(self._make_sync_row_widget())

        self._sync_note = QLabel()
        self._sync_note.setWordWrap(True)
        cl.addWidget(self._sync_note)
        pl.addWidget(cw)

        self._div_before_footer = _divider(self._theme)
        pl.addWidget(self._div_before_footer)
        pl.addWidget(self._make_footer())

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

        # icon
        header_png = resource_path(os.path.join("assets", "claude-header.png"))
        ico_path = resource_path(os.path.join("assets", "icon.ico"))
        self._header_icon = QLabel()
        self._header_png_path = header_png if os.path.isfile(header_png) else None
        self._header_ico_path = ico_path if os.path.isfile(ico_path) else None
        self._update_header_icon()
        left.addWidget(self._header_icon)

        info = QVBoxLayout(); info.setSpacing(2)
        tr = QHBoxLayout(); tr.setSpacing(8)
        self._title_lbl = QLabel("Claude Monitor")
        self._plan_badge = QLabel("Max")
        self._plan_badge.setStyleSheet(
            "font-size:9px;font-weight:600;color:rgb(217,119,87);"
            "background:rgba(217,119,87,26);border:1px solid rgba(217,119,87,64);"
            "border-radius:4px;padding:1px 6px;"
        )
        tr.addWidget(self._title_lbl); tr.addWidget(self._plan_badge); tr.addStretch()
        info.addLayout(tr)

        sr = QHBoxLayout(); sr.setSpacing(4)
        self._status_icon = QLabel("↻")
        self._status_text = QLabel()
        sr.addWidget(self._status_icon); sr.addWidget(self._status_text); sr.addStretch()
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
        l = QVBoxLayout(w); l.setContentsMargins(14, 0, 14, 12); l.setSpacing(10)

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
        self._cred_status.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        self._cred_refresh = QPushButton()
        self._cred_refresh.clicked.connect(self._refresh_creds_and_sync)
        cr.addWidget(self._cred_dot); cr.addWidget(self._cred_status); cr.addWidget(self._cred_refresh)
        l.addLayout(cr)

        # toggles row
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
    def _make_sync_row_widget(self) -> QWidget:
        w = QWidget()
        l = QHBoxLayout(w); l.setContentsMargins(0,0,0,0); l.setSpacing(6)
        self._auto_sync_lbl = QLabel(); l.addWidget(self._auto_sync_lbl); l.addStretch()

        self._interval_btns: dict[int, QPushButton] = {}
        for lbl, secs in [("manual",0),("5m",300),("10m",600),("30m",1800),("1h",3600)]:
            b = QPushButton(lbl); b.setCheckable(True)
            b.setChecked(secs == self._interval)
            b.setFixedHeight(self._sp(22))
            b.setProperty("isecs", secs)
            b.clicked.connect(lambda _, bb=b: self._set_interval(bb.property("isecs")))
            self._interval_btns[secs] = b
            l.addWidget(b)
        return w

    def _sp(self, px: int) -> int:
        return max(1, int(round(px * self._widget_scale)))

    def _alpha_color(self, c: QColor, apply_opacity: bool = True) -> QColor:
        if not apply_opacity:
            return QColor(c.red(), c.green(), c.blue(), c.alpha())
        if self._bg_opacity == 0:
            return QColor(c.red(), c.green(), c.blue(), 255)
        # 0%: opaque, 100%: fully transparent
        a = int(round(c.alpha() * (1.0 - (self._bg_opacity / 100.0))))
        return QColor(c.red(), c.green(), c.blue(), max(0, min(255, a)))

    def _rgba(self, c: QColor) -> str:
        return f"rgba({c.red()},{c.green()},{c.blue()},{c.alpha()})"

    def _update_header_icon(self):
        w = self._sp(48)
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
        pp.setFont(QFont("Segoe UI", max(8, self._sp(9)), QFont.Weight.Bold))
        pp.drawText(QRect(0, 0, side, side), Qt.AlignmentFlag.AlignCenter, "AI")
        pp.end()
        self._header_icon.setPixmap(px)
        self._header_icon.setFixedSize(side, side)

    def _apply_widget_scale(self):
        self._widget_scale = max(0.7, min(1.6, self.width() / 326.0))
        self._resize_border = max(6, self._sp(8))

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
        self.setMinimumSize(max(220, self._sp(220)), max(280, self._sp(280)))

    def _on_opacity_changed(self, value: int):
        self._bg_opacity = max(0, min(100, int(value)))
        self._cfg.setValue("bg_opacity", self._bg_opacity)
        self._opacity_value.setText(f"{self._bg_opacity}%")
        self._apply_theme()

    # footer
    def _make_footer(self) -> QWidget:
        w = QWidget()
        l = QHBoxLayout(w); l.setContentsMargins(14,8,14,8); l.setSpacing(8)
        ver = QLabel(APP_VERSION); ver.setObjectName("footerSub")
        self._last_sync_lbl = QLabel()
        self._last_sync_lbl.setObjectName("footerSub")
        self._last_sync_lbl.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self._sync_btn = QPushButton()
        self._sync_btn.clicked.connect(self.do_sync)
        sep = QLabel("|"); sep.setObjectName("footerSep")
        self._quit_btn = QPushButton()
        self._quit_btn.clicked.connect(self.hide)

        l.addWidget(ver); l.addWidget(self._last_sync_lbl, 1)
        l.addWidget(self._sync_btn); l.addWidget(sep); l.addWidget(self._quit_btn)
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
        self._status_text.setStyleSheet(f"font-size:{self._sp(10)}px;color:{tsc};")
        self._settings_btn.setStyleSheet(f"""
            QPushButton {{
                background:transparent;border:none;
                color:{tsc};font-size:{self._sp(14)}px;border-radius:{self._sp(6)}px;
            }}
            QPushButton:hover {{
                color:rgb(217,119,87);background:rgba(217,119,87,20);
            }}
        """)

        # settings panel
        for lbl in (self._sett_lang_label, self._sett_cred_label, self._sett_opacity_label):
            lbl.setStyleSheet(f"font-size:{self._sp(11)}px;font-weight:600;color:{tsc};")
        for btn in (self._btn_en, self._btn_ko, self._aot_btn, self._dark_btn):
            btn.setStyleSheet(tog)
        self._cred_status.setStyleSheet(f"font-size:{self._sp(11)}px;color:{tpc};")
        self._opacity_value.setStyleSheet(f"font-size:{self._sp(11)}px;color:{tpc};")
        self._cred_refresh.setStyleSheet("""
            QPushButton {
                font-size:10px;font-weight:600;color:rgb(217,119,87);
                background:rgba(217,119,87,20);border:1px solid rgba(217,119,87,60);
                border-radius:4px;padding:3px 8px;
            }
            QPushButton:hover { background:rgba(217,119,87,40); }
        """)

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
            w.setStyleSheet(f"font-size:{self._sp(13)}px;font-weight:700;color:{tpc};")
        for w in (self._session_pct,):
            w.setStyleSheet(f"font-size:{self._sp(22)}px;font-weight:700;color:{SUCCESS.name()};")
        for w in (self._all_models_lbl, self._sonnet_lbl):
            w.setStyleSheet(f"font-size:{self._sp(12)}px;font-weight:500;color:{tpc};")
        for w in (self._all_models_pct, self._sonnet_pct):
            w.setStyleSheet(f"font-size:{self._sp(12)}px;font-weight:700;color:{SUCCESS.name()};")
        for w in (self._session_reset, self._all_models_reset):
            w.setStyleSheet(f"font-size:{self._sp(11)}px;color:{tsc};")
        self._learn_more_btn.setStyleSheet(
            f"QPushButton{{font-size:{self._sp(10)}px;color:rgb(217,119,87);background:transparent;border:none;padding:0;}}"
            "QPushButton:hover{text-decoration:underline;}"
        )
        self._auto_sync_lbl.setStyleSheet(f"font-size:{self._sp(11)}px;color:{tsc};")
        self._sync_note.setStyleSheet(f"font-size:{self._sp(9)}px;color:rgba({ts.red()},{ts.green()},{ts.blue()},160);")

        # interval buttons
        for b in self._interval_btns.values():
            b.setStyleSheet(tog)

        # footer
        self._last_sync_lbl.setStyleSheet(f"font-size:{self._sp(10)}px;color:{tsc};")
        self.findChild(QLabel, "footerSub")  # version label – update via objectName below
        self._sync_btn.setStyleSheet(
            f"QPushButton{{font-size:{self._sp(10)}px;font-weight:600;color:rgb(217,119,87);background:transparent;border:none;}}"
            "QPushButton:hover{opacity:0.7;}"
        )
        bd = t["border"]
        self.findChildren(QLabel, "footerSep")[0].setStyleSheet(
            f"font-size:{self._sp(10)}px;color:rgba({bd.red()},{bd.green()},{bd.blue()},{bd.alpha()});"
        ) if self.findChildren(QLabel, "footerSep") else None
        self._quit_btn.setStyleSheet(
            f"QPushButton{{font-size:{self._sp(10)}px;font-weight:600;color:rgb(248,113,113);background:transparent;border:none;}}"
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

        self.update()

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
        self._status_text.setText(s["checking"])
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
        self._sett_opacity_label.setText(s["bgOpacity"])
        self._opacity_value.setText(f"{self._bg_opacity}%")
        lv = self._cfg.value("last_sync_time", None)
        self._last_sync_lbl.setText(s["lastSync"](lv) if lv else s["never"])

    # ── Toggle helpers ────────────────────────────────────────
    def _toggle_settings(self):
        is_visible = self._settings_panel.isVisible()
        keep_w = self.width()

        self._internal_toggle_resize = True
        try:
            if not is_visible:
                # Save current (collapsed) height before expanding settings panel.
                self._collapsed_height = self.height()
                self._settings_panel.setVisible(True)
                self.adjustSize()
                self.resize(keep_w, self.height())
            else:
                self._settings_panel.setVisible(False)
                target_h = self._collapsed_height if self._collapsed_height is not None else self.height()
                target_h = max(self.minimumHeight(), int(target_h))
                self.resize(keep_w, target_h)
                self._cfg.setValue("widget_size", self.size())
        finally:
            self._internal_toggle_resize = False

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        self._apply_widget_scale()
        self._apply_theme()
        if not self._settings_panel.isVisible() and not self._internal_toggle_resize:
            self._cfg.setValue("widget_size", self.size())

    def _toggle_aot(self):
        self._aot = not self._aot
        self._cfg.setValue("always_on_top", "true" if self._aot else "false")
        self._aot_btn.setChecked(self._aot)
        flags = self.windowFlags()
        if self._aot:
            flags |= Qt.WindowType.WindowStaysOnTopHint
        else:
            flags &= ~Qt.WindowType.WindowStaysOnTopHint
        self.setWindowFlags(flags)
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
        self._sync_timer.stop()
        if self._interval > 0:
            self.do_sync()
            self._sync_timer.start(self._interval * 1000)

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
        t = self._theme
        tp = t["text_primary"]
        tpc = f"rgb({tp.red()},{tp.green()},{tp.blue()})"

        self._sync_btn.setText(s["sync"])

        # cred dot
        creds = FetchWorker.read_credentials()
        if creds:
            self._cred_dot.setStyleSheet(f"font-size:10px;color:rgb(16,185,129);")
            self._cred_status.setText(s["autoDetected"])
        else:
            self._cred_dot.setStyleSheet(f"font-size:10px;color:rgb(248,113,113);")
            self._cred_status.setText(s["notFound"])

        err = usage.get("error")
        if err == "NO_CREDENTIALS":
            self._set_status_error(s["notLoggedIn"]); return
        if err == "TOKEN_EXPIRED":
            self._set_status_error(s["tokenExpired"]); return
        if err:
            self._set_status_error(err[:40]); return

        # session
        sp = usage["sessionUsagePercent"]
        self._session_bar.set_percent(sp)
        self._session_pct.setText(f"{round(sp)}%")
        self._set_pct_color(self._session_pct, sp, big=True)

        secs = usage["sessionResetSeconds"]
        h, m = secs // 3600, (secs % 3600) // 60
        self._session_reset.setText(
            s["resetsSoon"] if (h == 0 and m == 0) else s["resetsIn"](h, m)
        )

        # all models
        ap = usage["weeklyAllModelsPercent"]
        self._all_models_bar.set_percent(ap)
        self._all_models_pct.setText(f"{round(ap)}%")
        self._set_pct_color(self._all_models_pct, ap)
        rd = usage.get("weeklyAllModelsResetDate", "")
        self._all_models_reset.setText(s["resetsAt"](rd) if rd else "")

        # sonnet
        so = usage["weeklySonnetPercent"]
        self._sonnet_bar.set_percent(so)
        self._sonnet_pct.setText(f"{round(so)}%")
        self._set_pct_color(self._sonnet_pct, so)

        # plan
        self._plan_badge.setText(usage.get("planName", "Max"))

        # status
        self._status_icon.setText("✓")
        self._status_icon.setStyleSheet("font-size:11px;color:rgb(16,185,129);")
        self._status_text.setText(s["connected"])
        self._status_text.setStyleSheet("font-size:10px;color:rgb(16,185,129);")

        # last sync
        now  = datetime.now()
        h12  = now.hour % 12 or 12
        ap2  = "AM" if now.hour < 12 else "PM"
        tstr = f"{h12}:{now.minute:02d} {ap2}".lower()
        self._cfg.setValue("last_sync_time", tstr)
        self._last_sync_lbl.setText(s["lastSync"](tstr))

    def _set_status_error(self, msg: str):
        self._status_icon.setText("✗")
        self._status_icon.setStyleSheet("font-size:11px;color:rgb(248,113,113);")
        self._status_text.setText(msg)
        self._status_text.setStyleSheet("font-size:10px;color:rgb(248,113,113);")

    def _set_pct_color(self, lbl: QLabel, pct: float, big: bool = False):
        sz = f"{self._sp(22)}px" if big else f"{self._sp(12)}px"
        if pct >= 80:
            c = "rgb(248,113,113)"
        elif pct >= 50:
            c = "rgb(245,158,11)"
        else:
            c = "rgb(16,185,129)"
        lbl.setStyleSheet(f"font-size:{sz};font-weight:700;color:{c};")

    def _refresh_creds_and_sync(self):
        creds = FetchWorker.read_credentials()
        s = I18N[self._lang]
        if creds:
            self._cred_dot.setStyleSheet("font-size:10px;color:rgb(16,185,129);")
            self._cred_status.setText(s["autoDetected"])
        else:
            self._cred_dot.setStyleSheet("font-size:10px;color:rgb(248,113,113);")
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
        g = self.frameGeometry()
        b = self._resize_border
        on_left = g.left() <= gp.x() < g.left() + b
        on_right = g.right() - b < gp.x() <= g.right()
        on_top = g.top() <= gp.y() < g.top() + b
        on_bottom = g.bottom() - b < gp.y() <= g.bottom()

        edges = Qt.Edge(0)
        if on_left:
            edges |= Qt.Edge.LeftEdge
        if on_right:
            edges |= Qt.Edge.RightEdge
        if on_top:
            edges |= Qt.Edge.TopEdge
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
    if sys.platform == "win32":
        try:
            import ctypes
            # Must set AppUserModelID so Windows uses our icon instead of Python's default for taskbar
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
    app.setFont(QFont("Segoe UI", 10))

    # Set application icon (works for taskbar + alt-tab even on frameless windows)
    ico_path = resource_path(os.path.join("assets", "icon.ico"))
    if os.path.isfile(ico_path):
        app.setWindowIcon(QIcon(ico_path))

    if not QSystemTrayIcon.isSystemTrayAvailable():
        print("[WARN] System tray not available.")

    w = ClaudeWidget()
    w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
