# BACKLOG — Claude Usage Widget

다음 작업 후보를 우선순위별로 단일 출처화. [`CLAUDE.md`](CLAUDE.md)의 "다음 작업 후보" 섹션은 본 파일을 가리키는 포인터만 유지.

**갱신 SOP**:
- 새 후보가 생기면 즉시 추가 (우선순위·영역 추정)
- 진행/완료 시 체크 또는 ✓ 섹션으로 이동 (커밋 SHA 함께 표기 권장)
- *stale 의심* 항목은 행 끝에 `// stale?` 마커, 다음 갱신 사이클에 재평가

---

## P0 — 알파→베타 가기 전 막힘

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| ~~OAuth 직접 refresh (B)~~ → P1 격하 | UX·인증 | [docs/plans/2026-05-20-oauth-refresh.md](docs/plans/2026-05-20-oauth-refresh.md) §"B 격하 근거" | Anthropic spec 미공개·cred 파일 race·client_id 폐기 위험. A+D로 80% 효과 달성. **always-spot-check** (진행 결정 시) |
| **v2.0.2 release — macOS 자동 업데이트 활성화** | 인프라 | 본 파일 §"v2.0.2 발행 흐름" | 코드 작업 (PR #1 머지 + drag overlay) 본 세션 (2026-05-22 Windows) 에서 완료. 다음 액션은 **집 머신 (signing key 보유)** 에서 v2.0.2 bump + RC1 사전 검증 → 정식 발행. **always-spot-check** (자동 업데이트·릴리즈 영역·minisign 키 관리). |

---

## v2.0.2 발행 흐름 (집 머신 — signing key 보유 환경)

본 항목은 P0 의 "**v2.0.2 release**" 의 자세한 단계. 본 세션 (2026-05-22 Windows) 에서 *코드 작업까지* 완료. 다음 액션은 **집 머신** 에서 실행.

### 본 세션 산출물

- 코드 변경: `f32554e` (PR #1 머지 + manifest.mjs conflict resolve) + `6a52b79` (drag.ts 공통화) + `e7f8ac9` (formatTokens · Active 시간당 비용 · Models 토큰 열 · Normal/Detail drag overlay).
- main 이 origin/main 보다 5 commits ahead. 본 세션은 push 미실행 — *다음 세션*에서 사용자 수정사항과 함께 push.
- 버전 bump 미반영 — v2.0.1 그대로.

### Phase 1 — v2.0.2 bump (다음 세션에서 사용자 수정사항과 함께)

CLAUDE.md 회귀 사례 §3 — 6 곳 동시 갱신:
- [package.json](package.json) `"version"`
- [package-lock.json](package-lock.json) `"version"` + `"packages.''.version"`
- [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) `"version"`
- [src-tauri/Cargo.toml](src-tauri/Cargo.toml) `[package] version`
- [src-tauri/Cargo.lock](src-tauri/Cargo.lock) `[[package]] name = "claude-widget"` 의 `version`
- [src/state/store.ts](src/state/store.ts) `appVersion` 상수

확인: `git grep -F '2.0.1'` 결과 0 (test fixture 무관 빼고).

### Phase 2 — RC1 사전 검증 (강력 권고)

자동 업데이트 macOS 활성화는 *PR test plan 마지막 항목 unchecked* 상태. v2.0.2-rc1 임시 prerelease 로 양 OS 자동 업데이트 흐름 실측.

#### Windows 서명 빌드

```powershell
git pull --ff-only
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\claude-widget.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText)
npm run tauri build
```

#### macOS 서명 빌드 (별도 macOS 머신)

```bash
git pull --ff-only
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/claude-widget.key"
read -s -p "Password: " TAURI_SIGNING_PRIVATE_KEY_PASSWORD; export TAURI_SIGNING_PRIVATE_KEY_PASSWORD; echo
npm run tauri build -- --bundles app,dmg
```

#### 통합 manifest + RC1 발행

산출물을 한 머신에 모은 뒤:

```powershell
node scripts/make-updater-manifest.mjs
gh release create v2.0.2-rc1 --prerelease `
  --title "v2.0.2-rc1 — 자동 업데이트 macOS 검증" `
  --notes "RC. macOS 자동 업데이트 실측용. 정식 v2.0.2 발행 전 단계." `
  "src-tauri/target/release/bundle/nsis/Claude Widget_2.0.2_x64-setup.exe" `
  "src-tauri/target/release/bundle/nsis/Claude Widget_2.0.2_x64-setup.exe.sig" `
  "src-tauri/target/release/bundle/macos/Claude Widget.app.tar.gz" `
  "src-tauri/target/release/bundle/macos/Claude Widget.app.tar.gz.sig" `
  "src-tauri/target/release/bundle/dmg/Claude Widget_2.0.2_aarch64.dmg" `
  "src-tauri/target/release/bundle/updater/latest.json"
```

#### 실측 (양 OS)

- Windows: v2.0.1 깔린 머신 → 위젯이 v2.0.2-rc1 알림 띄우는지 → 다운로드·재시작 후 정상 동작
- macOS: v2.0.2-rc1 DMG 수동 설치 → Gatekeeper 우회 → 위젯 띄움. **prerelease tag 는 tauri-plugin-updater 의 `releases/latest` endpoint 가 인식하지 않으므로** 정식 발행 전 검증은 *manifest URL 을 임시로 prerelease tag 로 patch* 하거나 *endpoint 를 prerelease 도 포함하도록 일시 변경* 필요.
- Gatekeeper 첫 실행 경고가 자동 업데이트 *후에도* 동일하게 발생하는지 (예상: yes, ad-hoc 서명)

### Phase 3 — 정식 v2.0.2 발행

RC1 검증 통과 시:

```powershell
gh release edit v2.0.2-rc1 --prerelease=false --tag v2.0.2
# 또는 새 release 로 v2.0.2 발행
```

### 위험·always-spot-check

- **signing key 분실** = 모든 사용자 업데이트 비가역 차단. 1Password 등 secure cloud 백업 *재확인 필수*.
- **macOS Gatekeeper** — Apple Developer 미가입 상태 (회귀 사례 §10). 자동 업데이트 후에도 quarantine 경고 가능. README 우회 안내 의존.
- **prerelease 와 updater endpoint** — RC1 검증 시 manifest patch 또는 endpoint 변경 필요. 정식 발행 후 원복.
- **v2.0.1 사용자 → v2.0.2 자동 업데이트** — `latest.json` URL 의 공백→dot 변환은 `8ff720b` 에서 fix. PR #1 머지 시 resolve 에서 `releaseBase()` 함수에 흡수 (`e7f8ac9` 직전 머지). 회귀 재발 방지 확인 (Phase 2 Windows 실측).

---

## P1 — 알파 마감 청소

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| **버전 단일 출처 헬퍼** | 인프라 | [회귀 사례 §3](CLAUDE.md) | `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src/state/store.ts` 5곳 동시 bump. `scripts/bump-version.mjs` 또는 README 체크리스트 중 택1. 4aa3443에서 한 번 손으로 정렬 — 다음 bump 전엔 자동화. |

---

## P2 — 베타 무렵 검토

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| **자동화 테스트 도입 검토** | 인프라·품질 | [CLAUDE.md "테스트 프레임워크"](CLAUDE.md) | 현재 0%. 후보: (a) Rust 단위 테스트 — `jsonl_aggregator`·`pricing`·`migration`이 순수 함수 비중 커서 ROI 높음. (b) Vitest — `src/state/store.ts` Solid 신호 로직. (c) Playwright — Tauri WebView 한정이라 dev URL에서만, 실 .exe 시각 회귀는 여전히 `capture-widget.ps1` 의존. 1인 사이드 프로젝트 ROI 고려해 (a)부터. |
| **Win10 호환 검증** | 시각 회귀 | [vibrancy_win.rs](src-tauri/src/vibrancy_win.rs) | Mica/Acrylic은 Win11 전제. Win10에서 fallback이 정상인지 실 머신 확인 필요. |
| **Linux 지원** | 인프라 | (없음) | Tauri 2가 지원하나 OAuth + `.credentials.json` 경로 + vibrancy 미구현 + AppImage·deb 분기 등 macOS와 별개. 수요 신호 있을 때만. |
| **자동 시작 (Windows + macOS 동시)** | UX | (없음) | 현재 자동 시작 기능 자체가 미구현. Windows 추가 시 macOS LaunchAgent 도 같이 (`~/Library/LaunchAgents/com.gnoeynij.claude-widget.plist`). Settings UI 토글 + cfg 분기 모듈. 수요 있을 때. |
| **macOS 트레이 템플릿 이미지** | 디자인 | [src-tauri/src/icon_render.rs](src-tauri/src/icon_render.rs) | macOS 다크 메뉴바 자동 색반전 (NSImage `isTemplate = true`). 현재 컬러 PNG 그대로 — 사용성 OK 지만 macOS HIG 부정합. 별도 PR. |
| **macOS Universal binary** | 인프라 | (없음) | aarch64 only 첫 release. Intel Mac 수요 있을 때 `--target universal-apple-darwin`. `rustup target add x86_64-apple-darwin` 은 이미 설치됨. |

---

## P3 — 미세 후보 / 출시 후

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| **다크/라이트 토큰 분리 강화** | 디자인 | [src/styles/tokens.css](src/styles/tokens.css) | 현재 라이트·다크 별도 토큰. 시스템 테마 변경 watcher가 즉시 반영되는지 확인. |
| **메인 → 워크트리 동기화 헬퍼** | 인프라 | [회귀 사례 §5](CLAUDE.md) | 워크트리 fast-forward 자동화 (현재 양쪽 수동). |
| **`CLAUDE_CODE_OAUTH_TOKEN` env var fallback** | UX·인증 | (Claude Desktop App 사용자 호환) | `.credentials.json` 미존재 시 환경변수에서 token 읽어 API 호출. Claude Code CLI 미설치 환경에서도 동기화 가능. 사용자가 직접 token 발급·관리해야 하니 README 안내 필요. |
| **`tray icon throttle` 정량 검증** | 성능 | (Windows shell hypothesis) | 이번 breath 작업에서 tick 100ms → 200ms → 50ms 거치며 throttle 가설 세움. 실측 (Windows tray API 호출 빈도 + 갱신 ms) 안 함. throttle 진짜인지 정량 검증하면 tick 더 줄일 수 있음. |

---

## ✓ 완료 (기록용)

| 항목 | commit | 완료일 |
|---|---|---|
| v2.0.0-alpha — Tauri 2 + Liquid Glass 재작성 | `7d66dd4` | 2026-05-19 |
| v2.0.0-alpha.1 — 버전 5곳 정렬 + `Source/` 레거시 제거 | `4aa3443` | 2026-05-19 |
| 하네스 setup (CLAUDE.md 7개 섹션 + BACKLOG + docs/sessions) — 현재진행 스냅샷·UI SOP·회귀 사례·검토 워크플로·Session handover·출력 규약·페르소나 자동 detect | `5250c8a` | 2026-05-19 |
| 자동 업데이트 매니페스트 (`latest.json`) 빌드 활성 — signing key 발급·`createUpdaterArtifacts: true`·`scripts/make-updater-manifest.mjs`·.gitignore signing key 패턴 | `b937337` | 2026-05-20 |
| **OAuth 토큰 만료 회복 (A+D)** — `usage_api.rs` TOKEN_EXPIRED 응답·errorCode 파생 store·hero 위 ErrorBanner i18n(ko/en)·auto-sync 5분 default·`.credentials.json` mtime polling. 수동 재현(expiresAt=1) → banner 렌더 + 백업 복구 후 polling cycle 내 syncNow 자동 호출 확인 | `3d1e899` + `266405b` | 2026-05-20 |
| `pricing.rs:9 cache_write_1h` dead field — `#[allow(dead_code)]` + 주석 보존 (Anthropic 공식 가격 테이블·향후 1h cache 구분 시 0비용 활성화) | `01942b0` | 2026-05-20 |
| CLAUDE.md 문서 정렬 — "사전 요구"에 `link.exe` PATH 충돌 회피 메모 + "빌드 후 동작 워크플로"의 산출물 이름 `Claude Widget.exe` → `claude-widget.exe` (Cargo `[package] name` 이 진실 출처) | (본 커밋) | 2026-05-20 |
| **opacity slider fix (5번 실패 영역)** — 진짜 원인은 Mica vibrancy가 panel fade를 시각적으로 묻힘. fix: `vibrancy_win::clear_vibrancy` + `set_mica_enabled` command + setOpacity가 opacity 0/>0 에 따라 Mica 토글. `--glass-base-alpha` 1.0 (light/dark 모두). 검증: 0% Mica on alpha 1.0·50% Mica off alpha 0.5 (뒤 GitHub README 비침)·100% Mica off alpha 0 (panel 완전 투명) 3컷 캡처 확인 | (본 커밋) | 2026-05-20 |
| **v2.0.0 stable** — 자동 업데이트 frontend (3s silent + manual button + restart) + 모드별 리사이즈 (mini/normal/detail + persist) + UI 폴리시 (Mini visionOS handle + SegmentedControl grid) + 로그 진단 (`widget.log` + open log dir 버튼은 backlog로 제거) + 리팩토링 (utils/{math,format,color,error} + createMemo + 일부 dead code) + 트레이/태스크바 아이콘 v2 (radial halo + Gaussian gradient 5-stop + 흰 crab + 1px 검은 stroke + 호흡 + Settings toggle + error 우상단 빨간 dot). 버전 6곳(`package.json`/`package-lock.json`/`tauri.conf.json`/`Cargo.toml`/`Cargo.lock`/`store.ts`) `2.0.0-alpha.1` → `2.0.0`. | (이번 세션) | 2026-05-21 |
| **v2.0.1 dead code 청소** — `set_window_opacity` + `apply_opacity_win` + `FULL_OPACITY_THRESHOLD` (commands.rs) + lib.rs invoke_handler 등록 + Cargo.toml `Win32_UI_WindowsAndMessaging` feature + `--blur-mult` (tokens.css 정의 + store.ts removeProperty) + store.ts `style.opacity = ""` legacy cleanup 한 묶음 제거. opacity 처리가 v2.0 Mica 토글 + CSS mult로 옮긴 뒤 잔존이었음. typecheck + cargo check exit 0. | (이번 세션) | 2026-05-21 |
| **macOS 지원 — 빌드·vibrancy·credentials** — `vibrancy_mac.rs` (NSVisualEffectMaterial.HudWindow + Active state) + lib.rs/commands.rs cfg 분기. `tauri.conf.json` `bundle.targets: ["nsis", "app", "dmg"]` + `bundle.macOS.minimumSystemVersion: "11.0"`. `usage_api.rs` macOS 분기 — Claude Code CLI 가 *Keychain* (`security` 서비스 `Claude Code-credentials`, account `$USER`) 에 token 저장, `.credentials.json` 부재. Rust `keyring` crate 는 매치 실패 → `security` CLI subprocess 호출로 우회. `make-updater-manifest.mjs` darwin-aarch64/x86_64 자동 감지. `scripts/capture-widget.sh` 신규 (AppleScript 좌표 + `screencapture`). README/README.ko/`docs/macos-setup.md` 갱신. 검증: cargo check exit 0, `npm run tauri build --bundles app,dmg` exit 0, 실 .app 실행 → vibrancy·트레이·메뉴·사용량 게이지 (Anthropic API HTTP 200) 동작 확인. 단 *첫 release 발행은 후속* (집 Windows signing key 가져온 후). | (이번 세션) | 2026-05-22 |
| **PR #1 머지 + drag.ts 공통화 + Normal/Detail drag overlay** — macOS PR (#1: vibrancy + Keychain + drag region + DMG + Mini handle 하단) 로컬 머지. `make-updater-manifest.mjs` conflict resolve 시 `8ff720b` 의 공백→dot URL fix 를 `releaseBase()` 함수에 흡수해 자동 업데이트 404 회귀 재발 방지. `startWindowDrag` 헬퍼 `src/utils/drag.ts` 신설로 3 곳 (HeaderBar/MiniView/Normal+Detail) 통합. `format.ts formatTokens` (K/M/B short) + DetailView ActiveCard 시간당 비용 + ModelsCard 4-col grid + Normal/Detail 상단 28px drag overlay (Windows + macOS 호환 — `class="drag" + data-tauri-drag-region + onMouseDown=startWindowDrag`). 검증: typecheck exit 0 + `npm run tauri build` (signing 단계만 키 부재로 실패, 회귀 사례 §4) + Normal 모드 캡처 정상. | `f32554e` + `6a52b79` + `e7f8ac9` | 2026-05-22 |

---

## stale 의심 / 재평가 후보

(현재 없음)
