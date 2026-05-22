# 맥북에서 Claude Widget 작업 시작 가이드

순정 macOS 머신에서 본 리포를 체크아웃하고 첫 빌드까지 가는 단계별 가이드.
v2.0.1 기준으로 **macOS 빌드는 동작** (vibrancy, 트레이, Keychain 사용량 집계,
.dmg 번들 다 통과). 단 *첫 macOS GitHub Release 발행*은 아직 — Windows 측의
minisign signing key 가져온 후 정식 서명 빌드 + release 예정
([§알려진 미구현 영역](#알려진-미구현-영역)).

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

현재 [tauri.conf.json](../src-tauri/tauri.conf.json) 의 `bundle.targets`은
`["nsis", "app", "dmg"]` — Tauri 가 호스트 OS 에 맞는 타깃만 빌드한다
(Windows 에선 nsis 만, macOS 에선 app + dmg 만 만들어진다).

⚠ **첫 .dmg 빌드 시 Finder Automation 권한** — bundle_dmg.sh 가
Finder 에 AppleEvent 로 DMG 창 정렬을 보내는데, Terminal 에 Finder
Automation 권한이 없으면 `-1712` timeout 으로 실패한다. System Settings
→ Privacy & Security → Automation → Terminal → Finder 토글 ON.

---

## 4. 알려진 미구현 영역

v2.0.1 기준 상태 — 대부분 완료. 남은 영역은 *첫 release 발행*과
*기능 추가 후보*.

| 영역 | 상태 | 비고 |
|---|---|---|
| ✅ Mica/Acrylic vibrancy | 완료 | [vibrancy_mac.rs](../src-tauri/src/vibrancy_mac.rs) — `NSVisualEffectMaterial.HudWindow` + `NSVisualEffectState.Active`. `window-vibrancy` crate (cross-platform). |
| ✅ 번들 target | 완료 | [tauri.conf.json](../src-tauri/tauri.conf.json) `bundle.targets: ["nsis", "app", "dmg"]` + `bundle.macOS.minimumSystemVersion: "11.0"` |
| ✅ 트레이 (메뉴바) 동작 | 동작 검증 | Tauri 2 `tray-icon` cross-platform — `NSStatusItem` 자동 처리. 좌클릭 toggle·메뉴 동작 OK. *템플릿 이미지 자동 색반전*은 미적용 (icon_render 가 컬러 PNG) — 다크 메뉴바에 컬러 그대로 보임, 사용성 OK |
| ✅ `.credentials.json` 경로 | 완료 | macOS 는 *Keychain* (`security` 서비스 `Claude Code-credentials`, account `$USER`) — `.credentials.json` 파일 *부재*. [usage_api.rs:33-66](../src-tauri/src/usage_api.rs) 에 macOS 분기 — `security` CLI subprocess 호출 (Rust `keyring` crate 는 매치 실패, CLI 는 OK). JSON 구조는 cross-platform 동일. |
| ⏳ 자동 업데이트 (macOS) | 코드는 준비됨 | [make-updater-manifest.mjs](../scripts/make-updater-manifest.mjs) — `darwin-aarch64` / `darwin-x86_64` 자동 감지. Apple Silicon `.app.tar.gz` 생성 통과. *첫 release 미발행* — Windows 의 minisign signing key 를 macOS 로 가져온 후 서명 빌드 + `latest.json` 갱신 + `gh release upload` 필요 |
| 🔻 자동 시작 (LaunchAgent) | Windows 에도 없음 | 본 위젯은 자동 시작 기능 자체가 미구현. BACKLOG 신규 항목 (Windows+macOS 같이 추가) 검토 |
| 🔻 트레이 템플릿 이미지 | 미적용 | macOS 메뉴바 다크/라이트 자동 색반전. 현재 컬러 PNG 그대로 보여 사용성엔 무리 없음. 필요 시 별도 PR |
| 🔻 Universal binary | aarch64 only | 첫 release 는 Apple Silicon 전용. Intel Mac 수요 있을 때 `--target universal-apple-darwin` |
| 🔻 코드 서명 (Apple Developer) | 미적용 | $99/yr 비용 정책으로 미가입. ad-hoc 서명만. README 에 Gatekeeper 우회 안내. 자동 업데이트는 minisign 키 (Apple 과 무관) 로 OK |

---

## 5. 작업 시작 흐름

```bash
# main을 base로 새 브랜치
git checkout -b feat/macos-...   # 영역별로 분리 권장

# cfg 분기 작업 시 Windows 빌드 영향 없는지 인식
# - 새 macOS 전용 모듈은 mod 선언에 #[cfg(target_os = "macos")] gate
# - Windows·macOS 양쪽 함수 시그니처는 동일, 내부 구현만 cfg 분기
```

**검증** (자동화 가드 — [CLAUDE.md "검토 6-메뉴"](../CLAUDE.md) 참조):
- `npm run typecheck` — TypeScript 회귀
- `cargo check` — macOS 컴파일 통과 (호스트 target)
- `npm run tauri build --bundles app,dmg` — 실 빌드 + .app + .dmg 동작 확인

자동화 테스트 없으므로 *실 .app 캡처*가 시각 회귀 방어층.
macOS 캡처: [`scripts/capture-widget.sh`](../scripts/capture-widget.sh) —
AppleScript 로 위젯 윈도우 좌표 추출 + `screencapture -R` (Accessibility
권한 부여 시) 또는 인터랙티브 `screencapture -w` fallback.

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
