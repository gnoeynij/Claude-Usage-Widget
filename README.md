**English** | [한국어](README.ko.md)

# Claude Usage Widget

A desktop widget for **Claude Code** that shows your **Anthropic API usage** — current session, weekly limits, recent blocks, and per-model cost — at a glance, without opening a browser or terminal. Rebuilt from scratch with **Tauri 2 + SolidJS + Rust** for **Windows** and **macOS**.

![Tauri 2](https://img.shields.io/badge/Tauri-2-blue.svg)
![SolidJS](https://img.shields.io/badge/SolidJS-1.9-2C4F7C.svg)
![Rust](https://img.shields.io/badge/Rust-1.77+-orange.svg)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-lightgrey.svg)
![License](https://img.shields.io/badge/License-MIT-orange.svg)

> This project is a personal project based on [INNO-HI/ClaudeUsageWidget](https://github.com/INNO-HI/ClaudeUsageWidget), published with the original author [@khwee2000](https://velog.io/@khwee2000)'s permission. Original copyright belongs to [INNO-HI](https://github.com/INNO-HI). See [LICENSE](LICENSE) for terms and the [Releases](../../releases) page for the full change log.

A lightweight desktop tool that sits in a corner of your screen and tracks your Claude Code usage in real time. Aimed at developers who use Claude Code daily and want a passive, always-visible usage monitor instead of polling a dashboard.

---

## ✨ Features

### Three-mode widget
- **Mini** (240×112) — Donut + 2-row capsule. Minimum footprint
- **Normal** (360×420) — Donut hero + weekly capsules. Default
- **Detail** (600×680) — 4-card dashboard: Active session, Periods (today / yesterday / week / month), Recent 5h blocks, per-model usage

Switch via footer SegmentedControl or tray menu. Each mode has its own default size + minSize, and any size you drag-adjust is remembered per mode.

### Liquid Glass + OS-native vibrancy
System backdrop composited with OS-level vibrancy — **Win11 Mica/Acrylic** on Windows, **NSVisualEffectView (HudWindow material)** on macOS. The background-opacity slider fades only the background — text, donuts, and gauges stay fully opaque.

### Live tray icon
- Anthropic pixel character on a radial halo
- Halo color is the threshold (green / amber / red, Apple stoplight)
- Gentle breathing pulse (4-second cycle) you can toggle in Settings
- 1px black stroke around the character for contrast on any background
- On a connection error, the halo turns neutral grey and a red status dot appears in the top-right corner

### Auto-update
Silent check 3 seconds after boot + manual button in Settings. When an update is available, you get a dot badge on the gear icon and a "Restart now" button after the background download finishes. Signed manifests via `tauri-plugin-updater`.

### OAuth token auto-recovery
Reads Claude Code's OAuth token from the platform-native store — `~/.claude/.credentials.json` on Windows, the **macOS Keychain** (`Claude Code-credentials` service) on macOS. On expiry, the in-app banner tells you to run `claude` once and the widget self-heals on the next sync.

### Bilingual (English / Korean)
Every string switches instantly, including time labels and AM/PM.

### Diagnostic log
Settings → "Open logs folder" reveals `widget.log` with timestamped entries for every sync, error, update event, and UI action — useful for bug reports.

---

## 🚀 Installation & Usage

### Windows
1. **Download** — Grab the latest `Claude Widget_X.Y.Z_x64-setup.exe` from the [Releases](../../releases) tab.
2. **Install** — Double-click the installer. WebView2 Runtime installs automatically on Windows 10 (Windows 11 ships with it).
3. **First launch — SmartScreen bypass** — This is an unsigned-installer personal open-source build, so Windows SmartScreen may warn you on first launch. It is not malware — click `More info → Run anyway` to proceed.
4. **Run** — The widget needs an existing [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) login on the same PC (`~/.claude/.credentials.json`).

### macOS
1. **Download** — Grab the latest `Claude Widget_X.Y.Z_aarch64.dmg` from the [Releases](../../releases) tab (Apple Silicon).
2. **Install** — Open the .dmg, drag `Claude Widget.app` into `/Applications`.
3. **First launch — Gatekeeper bypass** — The .dmg is *ad-hoc signed* (not paid Apple Developer ID), so macOS refuses the first launch with *"Apple could not verify…"*. Two options:
   - **Right-click → Open** in Finder, then click *Open* in the dialog. macOS remembers the choice — subsequent launches are normal.
   - Or run once in Terminal: `xattr -d com.apple.quarantine "/Applications/Claude Widget.app"`
4. **Run** — The widget reads your OAuth token from the macOS Keychain — wherever the `claude` CLI stored it. No extra setup if you've used Claude Code at least once on this Mac.

### Controls (Windows & macOS)
- **Mode** — Footer SegmentedControl (Mini / Normal / Detail) or tray right-click menu
- **Move** — Drag the header bar (or any non-interactive surface in Mini)
- **Resize** — Drag window corners/edges; each mode remembers your size
- **Hide** — `×` in the footer sends the widget to the tray; left-click the tray icon to bring it back
- **Quit** — Right-click the tray icon → `Quit`
- **Settings** — `⚙` button in the header
- **Auto-sync** — Settings → Auto sync (`Off / 5m / 10m / 30m / 1h`, default `5m`).

<p align="center">
  <img src="docs/screenshots/normal.png" alt="Normal mode" width="280" />
  &nbsp;
  <img src="docs/screenshots/detail.png" alt="Detail mode" width="420" />
</p>
<p align="center">
  <img src="docs/screenshots/mini.png" alt="Mini mode" width="320" />
</p>

> ⚠️ The widget calls Claude Code's OAuth usage endpoint. If Anthropic changes the endpoint or policy, the widget may stop working until updated.

---

## 🛠️ Build from Source

> v2.0+ uses **Tauri 2 + Rust + SolidJS + Vite + UnoCSS + Motion One**. The legacy PyQt6 source is preserved on the `v1.5.1` tag; the instructions below build the current `main` branch.

Requires Node ≥ 20 and the Rust toolchain (`rustup`). Platform extras:
- **Windows** — Microsoft C++ Build Tools ("Desktop development with C++" workload). WebView2 Runtime ships with Windows 11; on Windows 10 the installer bootstrapper fetches it automatically.
- **macOS** — Xcode Command Line Tools (`xcode-select --install`). First-time DMG bundling needs Terminal to have Finder Automation permission (System Settings → Privacy & Security → Automation → Terminal → Finder). See [`docs/macos-setup.md`](docs/macos-setup.md) for the full setup walk-through.

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

# 5. Output (Windows)
#   src-tauri/target/release/bundle/nsis/Claude Widget_<ver>_x64-setup.exe  (recommended)
#   src-tauri/target/release/claude-widget.exe                              (portable)
#
# 5. Output (macOS)
#   src-tauri/target/release/bundle/dmg/Claude Widget_<ver>_aarch64.dmg     (recommended)
#   src-tauri/target/release/bundle/macos/Claude Widget.app                 (raw bundle)
```

> Tauri's bundler picks the right output per host OS — running `npm run tauri build` on Windows produces the NSIS installer, and on macOS produces the .app + .dmg.

---

## 📝 Change Log

### v2.0.x (Tauri 2 + SolidJS line)

- [**v2.0.2**](docs/release-notes/v2.0.2.md) — first macOS release (vibrancy, Keychain credentials, drag region, DMG) + black-corner fix + unified Windows/macOS auto-updater + Detail-mode UX (hourly cost, per-model tokens, drag overlay).
- [**v2.0.1**](docs/release-notes/v2.0.1.md) — first public v2.0.x release (v2.0.0 was an internal cut); signing key rotation.
- [**v2.0.0**](docs/release-notes/v2.0.0.md) — *internal cut.* Full PyQt6 → Tauri 2 + SolidJS rewrite. Liquid Glass + Win11 Mica/Acrylic, 3-mode widget (Mini/Normal/Detail), auto-updater, tray, OAuth recovery, en/ko i18n.

Full notes also on the [Releases](../../releases) page.

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
