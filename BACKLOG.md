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
| **v2.1.5 릴리즈 — pricing fix 전 사용자 전달** | 릴리즈 | 이번 세션 로컬 5 커밋 (`git log origin/main..HEAD`) | Opus 단가 3배 과대 + 1h cache 과소 회귀 fix 가 *전 사용자 영향*이라 릴리즈 우선. 순서: ① 5 커밋 push, ② 버전 6곳 bump (`node scripts/bump-version.mjs 2.1.5`), ③ `docs/release-notes/v2.1.5.md` 작성, ④ tag push → CI. **always-spot-check**: 단가 공식 표 재확인 + **macOS 실측 또는 CI cargo test (이번 세션 Windows 만 검증)**. |

(OAuth 직접 refresh 는 P1 으로 격하.)

---

## P1 — 알파 마감 청소

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| **OAuth 직접 refresh (B 방식)** — P0 에서 격하 | UX·인증 | [docs/plans/2026-05-20-oauth-refresh.md](docs/plans/2026-05-20-oauth-refresh.md) §"B 격하 근거" | Anthropic spec 미공개·cred 파일 race·client_id 폐기 위험. recovery (A+D, ✓ 60) 로 80% 효과 달성. **always-spot-check** (진행 결정 시) |

---

## P2 — 베타 무렵 검토

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| **자동화 테스트 도입 검토** | 인프라·품질 | [CLAUDE.md "테스트 프레임워크"](CLAUDE.md) | (a) **부분 이행** — `cargo test` 20개: `pricing.rs` 12 (cost_usd/resolve/family_of/web_search/inference_geo, 회귀 §19 방어) + `jsonl_aggregator.rs` 8 (group_blocks 5h 경계/active_view/overall_stats/family_totals/recent_blocks). 후속: `period_totals` (Local::now 주입 리팩터 필요) + `migration` 단위 테스트. (b) Vitest — `src/state/store.ts` Solid 신호 로직 미도입. (c) Playwright — Tauri WebView 한정이라 dev URL에서만, 실 .exe 시각 회귀는 여전히 `capture-widget.ps1` 의존. **(d) CI 미통합** — [release.yml](.github/workflows/release.yml) 이 양 OS 빌드하나 `cargo test` 스텝 없음 → macOS 자동 검증 공백. test 스텝 추가 권장. |
| **Win10 호환 검증** | 시각 회귀 | [vibrancy_win.rs](src-tauri/src/vibrancy_win.rs) | Mica/Acrylic은 Win11 전제. Win10에서 fallback이 정상인지 실 머신 확인 필요. |
| **Linux 지원** | 인프라 | (없음) | Tauri 2가 지원하나 OAuth + `.credentials.json` 경로 + vibrancy 미구현 + AppImage·deb 분기 등 macOS와 별개. 수요 신호 있을 때만. |
| **자동 시작 (Windows + macOS 동시)** | UX | (없음) | 현재 자동 시작 기능 자체가 미구현. Windows 추가 시 macOS LaunchAgent 도 같이 (`~/Library/LaunchAgents/com.gnoeynij.claude-widget.plist`). Settings UI 토글 + cfg 분기 모듈. 수요 있을 때. |
| **macOS 트레이 템플릿 이미지** | 디자인 | [src-tauri/src/icon_render.rs](src-tauri/src/icon_render.rs) | macOS 다크 메뉴바 자동 색반전 (NSImage `isTemplate = true`). 현재 컬러 PNG 그대로 — 사용성 OK 지만 macOS HIG 부정합. 별도 PR. |
| **macOS Universal binary** | 인프라 | (없음) | aarch64 only 첫 release. Intel Mac 수요 있을 때 `--target universal-apple-darwin`. `rustup target add x86_64-apple-darwin` 은 이미 설치됨. |

---

## P3 — 미세 후보 / 출시 후

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| **fast mode 비용 분기** | 비용 정확도 | [회귀 §19](CLAUDE.md) | `speed:"fast"` 시 Opus 4.6/4.7 $30/$150 (6x) + cache multiplier 상호작용. `Pricing` 에 fast 단가 버전 필요. 저빈도·복잡이라 후순위. web search + inference_geo 는 v2.1.x 구현됨 (`server_tool_use.web_search_requests` × $10/1k, `inference_geo:"us"` 1.1x). |
| **다크/라이트 토큰 분리 강화** | 디자인 | [src/styles/tokens.css](src/styles/tokens.css) | 현재 라이트·다크 별도 토큰. 시스템 테마 변경 watcher가 즉시 반영되는지 확인. |
| **메인 → 워크트리 동기화 헬퍼** | 인프라 | [회귀 사례 §5](CLAUDE.md) | 워크트리 fast-forward 자동화 (현재 양쪽 수동). |
| **`CLAUDE_CODE_OAUTH_TOKEN` env var fallback** | UX·인증 | (Claude Desktop App 사용자 호환) | `.credentials.json` 미존재 시 환경변수에서 token 읽어 API 호출. Claude Code CLI 미설치 환경에서도 동기화 가능. 사용자가 직접 token 발급·관리해야 하니 README 안내 필요. |
| **`tray icon throttle` 정량 검증** | 성능 | (Windows shell hypothesis) | 이번 breath 작업에서 tick 100ms → 200ms → 50ms 거치며 throttle 가설 세움. 실측 (Windows tray API 호출 빈도 + 갱신 ms) 안 함. throttle 진짜인지 정량 검증하면 tick 더 줄일 수 있음. |
| **Switch 다크 OFF 가독성 — 후속 피드백 대기** | 디자인 | [Switch.tsx](src/components/Switch.tsx) | v2.0.3 세션에서 다크 모드 Switch OFF 트랙이 다크 패널과 시각 분리 부족 신고. alpha 0.52 / 0.92 / solid 140,143,156 / solid 78,80,92 (방향 반대 어두운 cool-gray) 4 단계 시도 모두 사용자 신호 *"여전히 그대로"* → 전체 revert (라이트 모드는 OK 신호). 원인 미특정 — CSS 자체는 paint 되는 게 빌드 시각/CSS hash 매칭으로 확인됐고, 라이트 모드에선 동일 패턴이 잘 보이는데 다크에선 안 보임 → *Mica/glass blend 합성* 또는 *사용자 디스플레이 환경* (시야각·캘리브레이션·HDR off 등) 가능성. 다음 단계 후보: (a) DevTools 로 실 paint 색 inspect, (b) thumb 크기/위치 조정으로 visible 트랙 영역 늘리기 (22px → 20px), (c) 트랙 inset border, (d) Switch 컴포넌트 자체 디자인 변경. 후속 다른 사용자 피드백 들어오거나 동일 머신 다른 시야 (낮 vs 밤·디스플레이 교체) 확인 후 재진행. |

---

## ✓ 완료 (기록용)

| 항목 | commit | 완료일 |
|---|---|---|
| v2.0.0-alpha — Tauri 2 + Liquid Glass 재작성 | `7d66dd4` | 2026-05-19 |
| v2.0.0-alpha.1 — 버전 5곳 정렬 + `Source/` 레거시 제거 | `4aa3443` | 2026-05-19 |
| 하네스 setup (CLAUDE.md 7개 섹션 + BACKLOG + docs/sessions) — 현재진행 스냅샷·UI SOP·회귀 사례·검토 워크플로·Session handover·출력 규약·~~페르소나 자동 detect~~ *(2026-05-24 회수·시범 결과 cosmetic 확정)* | `5250c8a` | 2026-05-19 |
| 자동 업데이트 매니페스트 (`latest.json`) 빌드 활성 — signing key 발급·`createUpdaterArtifacts: true`·`scripts/make-updater-manifest.mjs`·.gitignore signing key 패턴 | `b937337` | 2026-05-20 |
| **OAuth 토큰 만료 회복 (A+D)** — `usage_api.rs` TOKEN_EXPIRED 응답·errorCode 파생 store·hero 위 ErrorBanner i18n(ko/en)·auto-sync 5분 default·`.credentials.json` mtime polling. 수동 재현(expiresAt=1) → banner 렌더 + 백업 복구 후 polling cycle 내 syncNow 자동 호출 확인 | `3d1e899` + `266405b` | 2026-05-20 |
| `pricing.rs:9 cache_write_1h` dead field — `#[allow(dead_code)]` + 주석 보존 (Anthropic 공식 가격 테이블·향후 1h cache 구분 시 0비용 활성화) | `01942b0` | 2026-05-20 |
| CLAUDE.md 문서 정렬 — "사전 요구"에 `link.exe` PATH 충돌 회피 메모 + "빌드 후 동작 워크플로"의 산출물 이름 `Claude Widget.exe` → `claude-widget.exe` (Cargo `[package] name` 이 진실 출처) | (본 커밋) | 2026-05-20 |
| **opacity slider fix (5번 실패 영역)** — 진짜 원인은 Mica vibrancy가 panel fade를 시각적으로 묻힘. fix: `vibrancy_win::clear_vibrancy` + `set_mica_enabled` command + setOpacity가 opacity 0/>0 에 따라 Mica 토글. `--glass-base-alpha` 1.0 (light/dark 모두). 검증: 0% Mica on alpha 1.0·50% Mica off alpha 0.5 (뒤 GitHub README 비침)·100% Mica off alpha 0 (panel 완전 투명) 3컷 캡처 확인 | (본 커밋) | 2026-05-20 |
| **v2.0.0 stable** — 자동 업데이트 frontend (3s silent + manual button + restart) + 모드별 리사이즈 (mini/normal/detail + persist) + UI 폴리시 (Mini visionOS handle + SegmentedControl grid) + 로그 진단 (`widget.log` + open log dir 버튼은 backlog로 제거) + 리팩토링 (utils/{math,format,color,error} + createMemo + 일부 dead code) + 트레이/태스크바 아이콘 v2 (radial halo + Gaussian gradient 5-stop + 흰 crab + 1px 검은 stroke + 호흡 + Settings toggle + error 우상단 빨간 dot). 버전 6곳(`package.json`/`package-lock.json`/`tauri.conf.json`/`Cargo.toml`/`Cargo.lock`/`store.ts`) `2.0.0-alpha.1` → `2.0.0`. | (이번 세션) | 2026-05-21 |
| **v2.0.1 dead code 청소** — `set_window_opacity` + `apply_opacity_win` + `FULL_OPACITY_THRESHOLD` (commands.rs) + lib.rs invoke_handler 등록 + Cargo.toml `Win32_UI_WindowsAndMessaging` feature + `--blur-mult` (tokens.css 정의 + store.ts removeProperty) + store.ts `style.opacity = ""` legacy cleanup 한 묶음 제거. opacity 처리가 v2.0 Mica 토글 + CSS mult로 옮긴 뒤 잔존이었음. typecheck + cargo check exit 0. | (이번 세션) | 2026-05-21 |
| **macOS 지원 — 빌드·vibrancy·credentials** — `vibrancy_mac.rs` (NSVisualEffectMaterial.HudWindow + Active state) + lib.rs/commands.rs cfg 분기. `tauri.conf.json` `bundle.targets: ["nsis", "app", "dmg"]` + `bundle.macOS.minimumSystemVersion: "11.0"`. `usage_api.rs` macOS 분기 — Claude Code CLI 가 *Keychain* (`security` 서비스 `Claude Code-credentials`, account `$USER`) 에 token 저장, `.credentials.json` 부재. Rust `keyring` crate 는 매치 실패 → `security` CLI subprocess 호출로 우회. `make-updater-manifest.mjs` darwin-aarch64/x86_64 자동 감지. `scripts/capture-widget.sh` 신규 (AppleScript 좌표 + `screencapture`). README/README.ko/`docs/macos-setup.md` 갱신. 검증: cargo check exit 0, `npm run tauri build --bundles app,dmg` exit 0, 실 .app 실행 → vibrancy·트레이·메뉴·사용량 게이지 (Anthropic API HTTP 200) 동작 확인. 단 *첫 release 발행은 후속* (집 Windows signing key 가져온 후). | (이번 세션) | 2026-05-22 |
| **v2.0.2 정식 release — Windows + macOS 자동 업데이트 활성화** — PR #1 (macOS 지원) + PR #2 (꼭지점 검은 모서리 fix: NSWindow.opaque=false + clearColor + contentView 모든 subview cornerRadius). v2.0.2-rc1 검증 단계 거쳐 정식 발행. macOS Apple Silicon (.app + .dmg + .app.tar.gz + .sig) + Windows (.exe + .sig) + latest.json 6 자산. 실측: v2.0.2-rc1 → v2.0.2 자동 업데이트 흐름 (download → install) 양 OS 정상 동작 확인. 회귀 fix: `make-updater-manifest.mjs` 의 macOS asset URL 을 Tauri 번들러 generic name (`Claude Widget.app.tar.gz`) 그대로 사용 — `gh release upload #displayname` 한계로 인한 404 회귀 (`2faa8da`). 회귀 사례 §11~14 추가. | `5d0bf9c` + `2faa8da` | 2026-05-23 |
| **CI 자동 release (GitHub Actions)** — `.github/workflows/release.yml` (tauri-action v0) + matrix [macos-latest, windows-latest] + tag push (`v*.*.*`) / `workflow_dispatch` trigger. dash 포함 (`v*-rc*`) prerelease 자동 판별. secrets 등록 완료 (`TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). 이전 수동 cross-machine 워크플로 (Windows 빌드 → iCloud → macOS 빌드 → 통합 release, 매회 30분~1시간) 가 *tag push 한 줄* 로 축소. CLAUDE.md "릴리즈 정책" 섹션 갱신 — CI 흐름 + 다중 백업 + 비상 수동. | `c800961` | 2026-05-23 |
| **PR #1 머지 + drag.ts 공통화 + Normal/Detail drag overlay** — macOS PR (#1: vibrancy + Keychain + drag region + DMG + Mini handle 하단) 로컬 머지. `make-updater-manifest.mjs` conflict resolve 시 `8ff720b` 의 공백→dot URL fix 를 `releaseBase()` 함수에 흡수해 자동 업데이트 404 회귀 재발 방지. `startWindowDrag` 헬퍼 `src/utils/drag.ts` 신설로 3 곳 (HeaderBar/MiniView/Normal+Detail) 통합. `format.ts formatTokens` (K/M/B short) + DetailView ActiveCard 시간당 비용 + ModelsCard 4-col grid + Normal/Detail 상단 28px drag overlay (Windows + macOS 호환 — `class="drag" + data-tauri-drag-region + onMouseDown=startWindowDrag`). 검증: typecheck exit 0 + `npm run tauri build` (signing 단계만 키 부재로 실패, 회귀 사례 §4) + Normal 모드 캡처 정상. | `f32554e` + `6a52b79` + `e7f8ac9` | 2026-05-22 |
| **docs/release-notes/ stale 해소** — v2.0.1.md (internal cut → 첫 공개 framing + 서명 키 교체) + v2.0.2.md (macOS 첫 정식 + 검은 모서리 fix + 자동 업데이트 양 OS 통합 + Detail UX) 신설. README/README.ko Change Log 한 줄 링크 → v2.0.x 3개 버전 한 줄 요약 + 노트 링크. | `d882b2d` | 2026-05-24 |
| **macOS opacity slider 진짜 root cause + 동작** ([회귀 §18](CLAUDE.md)) — wry 0.55.1 의 `transparent` feature 는 default 비활성, Tauri `macos-private-api` opt-in 시에만 활성화. (1) Cargo features 에 `macos-private-api` 추가, (2) `tauri.conf.json` `app.macOSPrivateApi: true`, (3) `store.ts` macOS 한정 `--bg-alpha-mult` floor (라이트 0.05 / 다크 0.3, `IS_MAC` + `effectiveBgAlphaMult` helper) 묶음. 6 컷 검증 (Production .app, macOS Apple Silicon) — 라이트/다크 × 0/50/100% 모두 fade 명확. **여전한 fundamental 한계**: WKWebView content + background layer 동일 합성 (Chromium WebView2 와 architecture 차이) → Windows 의 *content opaque + background invisible* 시각 fundamental 못 함, *fade + desktop blending wash* 까지만. 다크 100% 가 *밝은 회색* 인 건 *밝은 wallpaper blending* 영향. **§17 의 1-8차 10시간 시도가 대부분 우회 가능 영역이었음** — wry source `grep transparent` 30분 검증이 *2 줄 변경* 으로 끝낼 수 있었음. typecheck/cargo check exit 0. | `140dcfc` | 2026-05-26 |
| **v2.1.1 hotfix — 배경 투명도 시각 정합성** ([회귀 사례 §16](CLAUDE.md)) — v2.1.0 release 직후 사용자 신고. 사실 v2.0.0 부터 누적된 회귀였고 *라이트 모드 + opacity 100%* 조합을 사용자가 처음 만져본 시점에 드러남. (1) `.glass-panel::before/::after` + `.glass-card::before` 에 `opacity: var(--bg-alpha-mult)` 적용 — opacity slider 가 *위젯 본체 main bg 만* fade 시키고 *외곽선 + inner glow 는 그대로* paint 되던 영역 동기화. (2) `--scrim-bg` 토큰 라이트 `rgba(255,255,255,0.55)` / 다크 `rgba(0,0,0,0.32)` 분기 — Settings 오버레이가 *라이트 모드에서 검은 wash 로 어두운 회색* 으로 보이던 영역 분리. (3) CLAUDE.md 회귀 사례 §16 + UI SOP "시각 회귀 방어층" 에 *라이트/다크 × opacity 0/50/100% 6 컷 의무* 추가. 버전 6곳 v2.1.0 → v2.1.1 (헬퍼 사용). | (이번 세션) | 2026-05-24 |
| **v2.1.0 — 사용량 임계치 알림 + Detail 모드 mtime 캐싱 + 청소** | (1) `tauri-plugin-notification` 추가 + `store.ts maybeNotifyThreshold` — 5h 세션 85%/95% 도달 시 OS native notification, 권한은 첫 임계치 도달 시점에 lazy 요청. 블록당 1회 (notifiedBlock/notifiedLevels persist) + reset 시 재set. Settings "사용량 알림" 토글 + i18n en/ko 키 4 추가. (2) `jsonl_aggregator.rs FILE_CACHE` — Mutex<HashMap<PathBuf, CachedFile{mtime, records}>>, mtime 비교로 변경된 파일만 재파싱, 삭제된 파일 자동 제거, log info 로 hits/misses/ms 측정. (3) `lib.rs RotationStrategy::KeepAll → KeepSome(5)` — `widget.log` 최대 ~5MB 상한. (4) `scripts/bump-version.mjs` 신설 — 6 파일 일괄 bump + `--check` 동기화 검증 (회귀 사례 §3 재발 방어). 버전 6곳 v2.0.3 → v2.1.0 (헬퍼 첫 사용). typecheck exit 0 + tauri build exit 0 (1m 36s 첫 빌드, notification plugin 컴파일 포함). | (이번 세션) | 2026-05-24 |
| **v2.0.3 — persist gap + 트레이 i18n + 에러 배너 4종** ([회귀 사례 §15](CLAUDE.md)) — (1) `store.ts` `persistSetting`/`loadSetting` generic helper + setLang/setDark/setAlwaysOnTop/setSyncIntervalMin/setOpacity/setMode 6곳 persist + initStore boot load + `suppressPersist` race 방어. (2) `migration.rs` 파일명 `settings.json` → `widget-settings.json` 통일 + PyQt6 키 ↔ camelCase 매핑 + `sync_interval` seconds→minutes 변환 + `read_u32_loose`/`read_bool_loose` helper. (3) `tray.rs` 메뉴 라벨 i18n (`TrayLabels` struct + ko/en 분기) + `lib.rs` boot 시 widget-settings.json 의 `lang` 읽어 전달. (4) `ErrorBanner.tsx` TOKEN_EXPIRED only → 4종 (NO_CREDENTIALS / RATE_LIMITED / NETWORK 추가) + tone (warn/info/danger) 분기 + lucide 아이콘 (AlertTriangle/AlertCircle/Clock/WifiOff). i18n en/ko 키 6 추가. 버전 6곳 v2.0.2 → v2.0.3. typecheck exit 0 + tauri build exit 0 (54s, NSIS installer + claude-widget.exe 생성, signing 만 키 부재로 expected fail). 부수 시도 — Switch 다크 OFF 가독성 (alpha 0.52 / 0.92 / solid 140,143,156 / solid 78,80,92 4 단계) — 모든 시도 시각 분리 불충분으로 *전체 revert*. 원인 미특정 (CSS 적용 자체는 paint 됨, 사용자 시각 인지 한계 가능성) → 후속 피드백 대기, [P3 후보 추가](#p3--미세-후보--출시-후). | (이번 세션) | 2026-05-24 |
| **pricing 정정 + 1h cache 분기 활성화** ([회귀 사례 §19](CLAUDE.md)) — Anthropic 공식 [pricing 페이지](https://platform.claude.com/docs/en/about-claude/pricing) 확인 후 위젯에 누적된 *이중 회귀* fix. (1) `pricing.rs` Opus 4.5/4.6/4.7 단가 $15/$75 → $5/$25 (3배 과대 fix) + 새 변수 `opus_current` / `opus_legacy` 분리. (2) `claude-opus-4-1` · `claude-opus-4` · `claude-sonnet-4` deprecated entry 추가 — 2026-06-15 retirement 까지 그 모델 사용자도 cost_usd=0 회귀 없이 추정. (3) `UsageTokens` 의 `cache_creation: u64` → `cache_creation_5m: u64` + `cache_creation_1h: u64` 분리 + `cost_usd` 1h 단가 분리 합산. (4) `jsonl_aggregator.rs parse_jsonl` nested `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` 우선 + flat `cache_creation_input_tokens` 5m fallback (구버전 호환). (5) `resolve()` HashMap iter 비결정 순서 + partial match 두 결함 동시 fix — 가장 긴 prefix 우선 + base 뒤가 끝/하이픈 확인. (6) CLAUDE.md 회귀 사례 §19 + always-spot-check 영역 *pricing.rs* 추가. **사용자 비용 표시 직접 영향** — always-spot-check 의무. 사용자 본인 JSONL `claude-opus-4-7` + 1h cache 100% 사용 중이어서 fix 전 대비 cost 약 1/2 수준 감소 예상. | (이번 세션) | 2026-05-28 |

---

## stale 의심 / 재평가 후보

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| `.claude/worktrees/awesome-kepler-2868ae/` 빈 고아 디렉토리 | 인프라 | (점검 발견 2026-05-24) | `git worktree list` 미등록 + ChildCount 0. 정리 시점에 현 세션 cwd 였어서 in-use lock 으로 자동 삭제 불가. 다음 세션 외부 셸에서 `Remove-Item -Recurse -Force .claude/worktrees/awesome-kepler-2868ae`. |
