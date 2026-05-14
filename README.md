**English** | [한국어](README.ko.md)

# Claude Usage Widget

A desktop widget for **Claude Code** that shows your **Anthropic API usage** — current session and weekly limits — at a glance, without opening a browser or terminal. Built with **PyQt6** for **Windows**.

![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)
![PyQt6](https://img.shields.io/badge/PyQt6-Framework-green.svg)
![Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)
![License](https://img.shields.io/badge/License-MIT-orange.svg)

> This project is a Windows-only personal fork of [INNO-HI/ClaudeUsageWidget](https://github.com/INNO-HI/ClaudeUsageWidget), published with the original author [@khwee2000](https://velog.io/@khwee2000)'s permission. Original copyright belongs to [INNO-HI](https://github.com/INNO-HI). See the [Change Log](#-change-log) for fork-specific changes and [LICENSE](LICENSE) for terms.

Claude Usage Widget is a lightweight desktop tool that sits in a corner of your screen and tracks your Claude Code usage in real time. It is aimed at developers who use Claude Code daily and want a passive, always-visible usage monitor instead of polling a dashboard.

---

## ✨ Features

- **Real-time usage monitoring** — Current session and weekly usage (All Models / Sonnet) shown as percentages
- **Full mode / Mini mode** — Card-based full view and a compact icon + percent mini view. Toggle by clicking the Claude icon in the header
- **Glassmorphism design** — Frameless widget tuned for Windows, with dark/light mode
- **Free positioning & resizing** — Drag the top bar to move, drag corners/edges to resize, double-click to hide
- **System tray** — Closing the widget keeps it running in the system tray
- **Options panel** — Language, authentication, auto-sync, always-on-top, dark mode, opacity, and update check, all in one place
- **Instant Korean / English switching** — Every string (including weekday and AM/PM) re-translates dynamically
- **Bundled SUIT SemiBold font** — Clean Korean readability
- **Resilient API calls** — 0–2s random startup delay, ±10% jitter per sync cycle, exponential backoff (2× → 16× cap) on HTTP 429
- **Auto-update** — One click in the options panel downloads the new release and restarts the app
- **Auto-authentication** — Reuses `~/.claude/.credentials.json`; no separate login required

---

## 🚀 Installation & Usage

1. **Download** — Grab the latest `Claude-Widget.exe` from the [Releases](../../releases) tab.
2. **Run** — Double-click `Claude-Widget.exe`. The widget needs an existing [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) login on the same PC (`~/.claude/.credentials.json`).
3. **Controls**
   - Full ↔ Mini — Click the Claude icon in the header or mini view
   - Move — Drag the gray top bar
   - Resize — Drag window corners/edges
   - Hide — Double-click the top bar, or press `Close` in the footer
   - Quit — Right-click the system tray icon → `Exit`
   - Settings — `⚙` button in the header
4. **Auto-sync** — In the options panel, choose `Off / 5m / 10m / 30m / 1h`. Default is 10 minutes.

<p align="center">
  <img src="docs/claude_widget_full_mode.png" alt="Full Mode" width="32%">
  <img src="docs/claude_widget_options.png" alt="Options Panel" width="32%">
  <img src="docs/claude_widget_mini_mode.png" alt="Mini Mode" width="32%">
</p>
<p align="center"><sub>Full mode · Options panel · Mini mode</sub></p>

This is an unsigned personal open-source build, so Windows SmartScreen may warn you on first launch. It is not malware — click `More info → Run anyway` to proceed.

> ⚠️ The widget calls Claude Code's OAuth usage endpoint. If Anthropic changes the endpoint or policy, the widget may stop working until updated.

---

## 🛠️ Build from Source

Built with Python 3.10+ and PyQt6.

```bash
# 1. Clone
git clone https://github.com/gnoeynij/Claude-Usage-Widget.git
cd Claude-Usage-Widget/Source

# 2. Install dependencies
pip install -r requirements.txt
pip install pyinstaller

# 3. (Optional) Bundle the SUIT SemiBold font
#    Download from https://sun.fo/suit/
#    and place SUIT-SemiBold.ttf in Source/assets/fonts/.
#    Without it, the widget falls back to system SUIT → Segoe UI.

# 4. Build with PyInstaller
python -m PyInstaller claude_widget.spec --noconfirm --clean

# 5. Output
# Source/dist/Claude-Widget.exe
```

---

## 📝 Change Log

### v1.5.1 (current)
- Token expiry handling — pre-check `expiresAt` to skip doomed GETs, and on a 401 retry once with freshly-read credentials (catches the race where Claude Code rotates the token mid-sync)

### v1.5.0
- Detail mode added (mini ↔ full ↔ detail 3-state) with local JSONL-based usage stats (cost, tokens, per-model)
- Mode-switching fixes — settings panel auto-close on every transition; first-entry mini sizing no longer gets stuck oversized

### v1.4.0
- Auto-update (`Check for Updates` downloads the new release and restarts automatically)
- Always-on-top now hides the widget from the taskbar / Alt+Tab
- Smoother mode switching, size restore, font polish

### v1.3.0
- Mini mode added; SUIT SemiBold Korean font bundled
- API stability (jitter + 429 exponential backoff), Korean i18n improvements

### v1.2.0
- Resize via window corners/edges, responsive scaling
- Background opacity behavior fixed

### v1.1.0
- Background widget mode + cleaned-up tray menu
- API stability and memory cleanup

---

## 📄 License

Released under the [MIT License](LICENSE).

- Original work © 2026 [INNO-HI](https://github.com/INNO-HI/ClaudeUsageWidget)
- Modifications and additional features © 2026 choi jinyeong

Published with the original author's prior permission. The MIT license preserves attribution while allowing free use, modification, and redistribution.

This program uses [PyQt6](https://www.riverbankcomputing.com/software/pyqt/) (GPL-3.0). Per PyQt6's GPL-3.0 obligation, the full source code of this project is available in this GitHub repository.

Font: [SUIT](https://sun.fo/suit/) by Sun (SIL Open Font License)
