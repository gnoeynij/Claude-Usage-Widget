# 맥북에서 Claude Widget 작업 시작 가이드

순정 macOS 머신에서 본 리포를 체크아웃하고 첫 빌드까지 가는 단계별 가이드.
현재 본 위젯은 v2.0.1 기준 **Windows-only**로 출시되어 있으며 macOS 분기는
미구현. 코드의 `cfg` 분기가 대부분 잘 되어 있어 *빌드 시도는 가능*하지만,
실 동작에 필요한 모듈 일부가 비어있다 ([§알려진 미구현 영역](#알려진-미구현-영역)).

---

## 1. 사전 요구 — 순정 macOS

### 1-1. Xcode Command Line Tools (git + clang + system headers)

```bash
xcode-select --install
```

- 팝업 따라 설치 (수 분 ~ 십수 분)
- 검증: `xcode-select -p` 가 `/Library/Developer/CommandLineTools` 출력하면 OK
- `git` 명령은 CLT에 포함, 별도 설치 불필요

### 1-2. Homebrew (Node·도구 매니저 — 선택이지만 권장)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

- Apple Silicon: 설치 후 PATH 추가 안내가 출력됨. `~/.zshrc` 에 append:
  ```bash
  eval "$(/opt/homebrew/bin/brew shellenv)"
  ```
- Intel Mac: `/usr/local/bin/brew shellenv` 경로
- 검증: `brew --version`

### 1-3. Node ≥ 20

```bash
brew install node@20
brew link --overwrite --force node@20
```

- nvm·fnm 등 사용해도 무방
- 검증: `node --version` → `v20.x.x`, `npm --version`

### 1-4. Rust toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

- 기본 설치 옵션 (default toolchain: stable) 선택
- 설치 후 셸 재시작 또는 `source $HOME/.cargo/env`
- 검증: `rustc --version`, `cargo --version`

### 1-5. (선택) Universal binary 빌드용 rustup target

본인 머신만 빌드한다면 default target으로 충분.
Intel·Apple Silicon 둘 다 지원하려면:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

빌드 명령은 `npm run tauri build -- --target universal-apple-darwin`.

---

## 2. 리포 체크아웃 + 의존성

```bash
mkdir -p ~/Desktop/Projects && cd ~/Desktop/Projects
git clone https://github.com/gnoeynij/Claude-Usage-Widget.git
cd Claude-Usage-Widget
npm install
```

- `npm install`은 SolidJS·Tauri CLI·UnoCSS 등 frontend 의존성 설치
- Rust 의존성은 첫 `cargo build` 시 자동 fetch

---

## 3. 첫 빌드 시도

```bash
npm run tauri dev
```

- 첫 컴파일은 수 분 소요 (Rust 의존성 + tauri 매크로 컴파일)
- *깨질 가능성이 있는 영역*은 [§알려진 미구현 영역](#알려진-미구현-영역) 참조

빌드 산출물 (성공 시 예상 경로):
- `.app` 번들: `src-tauri/target/release/bundle/macos/Claude Widget.app`
- `.dmg`: `src-tauri/target/release/bundle/dmg/Claude Widget_<ver>_aarch64.dmg`

⚠ **현재 [tauri.conf.json](../src-tauri/tauri.conf.json) 의 `bundle.targets: ["nsis"]` 는 Windows 전용**.
macOS 빌드 시 에러 또는 무시. macOS 작업 첫 단계에서 `["app", "dmg"]` 분기
필요 (cfg 기반 동적 target 또는 `--bundles` CLI 옵션).

---

## 4. 알려진 미구현 영역

v2.0.1 기준. 대부분 `cfg(target_os = "windows")` 분기가 되어있어 *macOS 컴파일은
통과*하지만, 시각·기능적으로 비어있는 영역.

| 영역 | 상태 | 위치 | macOS 분기 시 필요 작업 |
|---|---|---|---|
| Mica/Acrylic vibrancy | Windows-only | [src-tauri/src/vibrancy_win.rs](../src-tauri/src/vibrancy_win.rs) | `vibrancy_mac.rs` 신규. `NSVisualEffectView` (sidebar / hud-window / titlebar 등 material). [`window-vibrancy`](https://crates.io/crates/window-vibrancy) crate가 macOS도 지원 (이미 의존성 등록). |
| 번들 target | NSIS만 | [src-tauri/tauri.conf.json:38](../src-tauri/tauri.conf.json:38) | `bundle.targets` 를 `["app", "dmg"]` 또는 cfg 분기로 |
| 트레이 (메뉴바) 동작 | Windows 가정 | [src-tauri/src/tray.rs](../src-tauri/src/tray.rs) | macOS `NSStatusItem` 동작 검증. 좌클릭 toggle·X 버튼 hide → 메뉴바 복귀 흐름이 macOS HIG와 맞물리는지 |
| 트레이 아이콘 시각 | Cross-platform 가정 | [src-tauri/src/icon_render.rs](../src-tauri/src/icon_render.rs) | tiny-skia 순수 Rust이라 컴파일은 OK. macOS 메뉴바의 template image (다크 메뉴바 자동 색반전) 동작과의 조합 확인 필요 |
| 자동 시작 | Windows 레지스트리 | (`winreg` Cargo 의존성, Windows-only target) | macOS는 `~/Library/LaunchAgents/com.gnoeynij.claude-widget.plist` 생성. 별도 모듈 |
| `.credentials.json` 경로 | Windows·macOS 동일? | [src-tauri/src/usage_api.rs](../src-tauri/src/usage_api.rs) | Claude Code CLI가 macOS에서 `~/.claude/.credentials.json` 동일 경로 쓰는지 확인. 다르다면 OS 분기 |
| 자동 업데이트 (macOS) | 미테스트 | [scripts/make-updater-manifest.mjs](../scripts/make-updater-manifest.mjs) | `latest.json` 의 `platforms` 에 `darwin-aarch64` / `darwin-x86_64` 키 추가. 기존 minisign 키 *그대로 .app.tar.gz 서명 가능* — 새 키 발급 불필요 |

---

## 5. 작업 시작 흐름

```bash
# main을 base로 새 브랜치
git checkout -b feat/macos-vibrancy   # 영역별로 분리 권장

# cfg 분기 작업 시 Windows 빌드 영향 없는지 인식
# - 새 macOS 전용 모듈은 mod 선언에 #[cfg(target_os = "macos")] gate
# - Windows·macOS 양쪽 함수 시그니처는 동일, 내부 구현만 cfg 분기
```

**검증** (자동화 가드 — [CLAUDE.md "검토 6-메뉴"](../CLAUDE.md) 참조):
- `npm run typecheck` — TypeScript 회귀
- `cargo check --target aarch64-apple-darwin` — macOS 컴파일 통과
- `npm run tauri build` — 실 빌드 + .app 동작 확인

자동화 테스트 없으므로 *실 .app 캡처*가 시각 회귀 방어층. macOS는
`screencapture -i` 또는 SwiftUI 기반 캡처 스크립트 (Windows의
`scripts/capture-widget.ps1` 대응 — 별도 작성 필요).

---

## 6. 양쪽 OS git 동기화 (Windows ↔ macOS)

- **작업 시작 시 양쪽 머신 모두**: `git pull --ff-only`
- 한 OS에서만 작업 후 다른 OS pull 안 하면 stale ([CLAUDE.md 회귀 사례 §5](../CLAUDE.md))
- macOS는 LF, Windows는 CRLF — 현재 `.gitattributes` 없어 line-ending 정규화
  경고가 자주 발생 ([CLAUDE.md 회귀 사례 §6](../CLAUDE.md)). 손상 아님,
  무시 가능. 정리하려면 `.gitattributes` 추가:
  ```
  * text=auto
  *.sh text eol=lf
  *.ps1 text eol=crlf
  ```

---

## 7. 자주 쓰는 명령 요약 (setup 완료 후)

```bash
cd ~/Desktop/Projects/Claude-Usage-Widget
git pull --ff-only
npm run tauri dev               # 개발 서버 (hot reload)
npm run tauri build             # 프로덕션 .app + .dmg
npm run typecheck               # TS 타입 체크
cargo check --release           # Rust 컴파일 통과 검증 (src-tauri/)
```

---

## 8. 막혔을 때

- 첫 빌드 에러는 그대로 [`BACKLOG.md`](../BACKLOG.md) P2 macOS 행에 기록 →
  영역별로 분기 작업 진입
- `cargo build` 의 에러는 *진짜 원인* 추적: clang 헤더 누락 / linker 경로 /
  rustup target 누락 등. 메시지만으로 추측하지 말 것
