**English** | [한국어](README.ko.md)

# Claude Usage Widget

A desktop widget for **Claude Code** that shows your **Anthropic API usage** — current session, weekly limits, recent blocks, and per-model cost — at a glance, without opening a browser or terminal. Rebuilt from scratch with **Tauri 2 + SolidJS + Rust** for **Windows**.

![Tauri 2](https://img.shields.io/badge/Tauri-2-blue.svg)
![SolidJS](https://img.shields.io/badge/SolidJS-1.9-2C4F7C.svg)
![Rust](https://img.shields.io/badge/Rust-1.77+-orange.svg)
![Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)
![License](https://img.shields.io/badge/License-MIT-orange.svg)

> This project is a Windows-only personal fork of [INNO-HI/ClaudeUsageWidget](https://github.com/INNO-HI/ClaudeUsageWidget), published with the original author [@khwee2000](https://velog.io/@khwee2000)'s permission. Original copyright belongs to [INNO-HI](https://github.com/INNO-HI). See [LICENSE](LICENSE) for terms and the [Releases](../../releases) page for the full change log.

A lightweight desktop tool that sits in a corner of your screen and tracks your Claude Code usage in real time. Aimed at developers who use Claude Code daily and want a passive, always-visible usage monitor instead of polling a dashboard.

---

## ✨ Features

### Three-mode widget
- **Mini** (240×112) — Donut + 2-row capsule. Minimum footprint
- **Normal** (360×420) — Donut hero + weekly capsules. Default
- **Detail** (600×680) — 4-card dashboard: Active session, Periods (today / yesterday / week / month), Recent 5h blocks, per-model usage

Switch via footer SegmentedControl or tray menu. Each mode has its own default size + minSize, and any size you drag-adjust is remembered per mode.

### Liquid Glass + Win11 Mica/Acrylic
System backdrop composited with OS-level vibrancy. The background-opacity slider fades only the background — text, donuts, and gauges stay fully opaque.

### Live tray icon
- Anthropic pixel character on a radial halo
- Halo color is the threshold (green / amber / red, Apple stoplight)
- Gentle breathing pulse (4-second cycle) you can toggle in Settings
- 1px black stroke around the character for contrast on any background
- On a connection error, the halo turns neutral grey and a red status dot appears in the top-right corner

### Auto-update
Silent check 3 seconds after boot + manual button in Settings. When an update is available, you get a dot badge on the gear icon and a "Restart now" button after the background download finishes. Signed manifests via `tauri-plugin-updater`.

### OAuth token auto-recovery
Polls `~/.claude/.credentials.json` mtime so a Claude Code CLI token refresh triggers an immediate retry without waiting for the next sync. On expiry, the in-app banner tells you to run `claude` once and the widget self-heals.

### Bilingual (English / Korean)
Every string switches instantly, including time labels and AM/PM.

### Diagnostic log
Settings → "Open logs folder" reveals `widget.log` with timestamped entries for every sync, error, update event, and UI action — useful for bug reports.

---

## 🚀 Installation & Usage

1. **Download** — Grab the latest `Claude Widget_X.Y.Z_x64-setup.exe` from the [Releases](../../releases) tab.
2. **Install** — Double-click the installer. WebView2 Runtime installs automatically on Windows 10 (Windows 11 ships with it).
3. **Run** — The widget needs an existing [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) login on the same PC (`~/.claude/.credentials.json`).
4. **Controls**
   - **Mode** — Footer SegmentedControl (Mini / Normal / Detail) or tray right-click menu
   - **Move** — Drag the header bar (or any non-interactive surface in Mini)
   - **Resize** — Drag window corners/edges; each mode remembers your size
   - **Hide** — `×` in the footer sends the widget to the tray; left-click the tray icon to bring it back
   - **Quit** — Right-click the tray icon → `Quit`
   - **Settings** — `⚙` button in the header
5. **Auto-sync** — Settings → Auto sync (`Off / 5m / 10m / 30m / 1h`, default `5m`).

<p align="center">
  <img src="docs/screenshots/normal.png" alt="Normal mode" width="280" />
  &nbsp;
  <img src="docs/screenshots/detail.png" alt="Detail mode" width="420" />
</p>
<p align="center">
  <img src="docs/screenshots/mini.png" alt="Mini mode" width="320" />
</p>

This is an unsigned-installer personal open-source build, so Windows SmartScreen may warn you on first launch. It is not malware — click `More info → Run anyway` to proceed.

> ⚠️ The widget calls Claude Code's OAuth usage endpoint. If Anthropic changes the endpoint or policy, the widget may stop working until updated.

---

## 🛠️ Build from Source

> v2.0+ uses **Tauri 2 + Rust + SolidJS + Vite + UnoCSS + Motion One**. The legacy PyQt6 source is preserved on the `v1.5.1` tag; the instructions below build the current `main` branch.

Requires Node ≥ 20, the Rust toolchain (`rustup`), and the Microsoft C++ Build Tools on Windows ("Desktop development with C++" workload). WebView2 Runtime ships with Windows 11; on Windows 10 the installer bootstrapper fetches it automatically.

```bash
# 1. Clone
git clone https://github.com/gnoeynij/Claude-Usage-Widget.git
cd Claude-Usage-Widget

# 2. Install dependencies
npm install

# 3. Run in dev mode
npm run tauri dev

# 4. Production build
npm run tauri build

# 5. Output
#   src-tauri/target/release/bundle/nsis/Claude Widget_<ver>_x64-setup.exe  (recommended)
#   src-tauri/target/release/claude-widget.exe                              (portable)
```

> The NSIS installer is the recommended distribution because it bootstraps WebView2 on Windows 10 and integrates with `tauri-plugin-updater` for silent in-place upgrades.

---

## 📝 Change Log

For v2.0.0 onward, see [docs/release-notes/](docs/release-notes/) and the [Releases](../../releases) page.

### v1.5.1 (PyQt6 line, legacy)
- Token expiry handling — pre-check `expiresAt` to skip doomed GETs, and on a 401 retry once with freshly-read credentials (catches the race where Claude Code rotates the token mid-sync)

For earlier history (v1.0.0 – v1.5.0), see the [v1.5.1 tag README](https://github.com/gnoeynij/Claude-Usage-Widget/blob/v1.5.1/README.md).

---

## 📄 License

Released under the [MIT License](LICENSE).

- Original work © 2026 [INNO-HI](https://github.com/INNO-HI/ClaudeUsageWidget)
- Modifications and additional features © 2026 choi jinyeong

Published with the original author's prior permission. The MIT license preserves attribution while allowing free use, modification, and redistribution.

Fonts: [SUIT](https://sun.fo/suit/) by Sun (SIL Open Font License). Pixel mark `src/assets/claude-header.png` is an Anthropic asset used for brand identity.
