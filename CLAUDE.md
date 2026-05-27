# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project-Specific Guidelines

> **Note:** v2.0부터 본 프로젝트는 **Tauri 2 (Rust + System WebView) + Vite +
> SolidJS + TypeScript** 스택입니다. v1.5.x의 PyQt6 코드는 `v1.5.1` 이하 태그에
> 보존되어 있으며, `main` 브랜치에는 더 이상 존재하지 않습니다. 아래 항목들은
> 실제 도구·정책에 기반합니다.

### 응답 언어

- **사용자에게 보내는 모든 응답은 한국어로 작성한다.**
- 코드 내 식별자/문자열/주석은 기존 파일의 컨벤션을 따른다 (영문 식별자 + 한국어 사용자 노출 문자열).

### 빌드 도구 & 명령어

- **스택:** Tauri 2 (Rust + System WebView) + Vite + SolidJS + TypeScript +
  UnoCSS + Motion One.
- **사전 요구:**
  - Node ≥ 20, npm
  - Rust toolchain (`rustup` 권장)
  - Windows: Microsoft C++ Build Tools (Visual Studio Build Tools,
    "Desktop development with C++" 워크로드)
  - WebView2 Runtime (Win11 기본 탑재, Win10은 빌드 시 bootstrapper로 자동 설치)
  - 새 머신 첫 빌드 전 `where.exe link` 로 MSVC `link.exe` 가 먼저
    나오는지 확인. Git for Windows의 `link.exe`(coreutils)가 PATH
    앞쪽에 있으면 cargo가 그걸 호출해 *"Try 'link --help' for more
    information"* 같은 misleading 에러로 실패한다. 회피: vcvars64.bat
    소싱 또는 MSVC 경로 우선화 (회귀 사례 §1).
  - macOS: Xcode Command Line Tools (`xcode-select --install`). 순정 머신
    setup·미구현 영역·작업 흐름은 [`docs/macos-setup.md`](docs/macos-setup.md)
    참조. v2.0.1 기준 *macOS 빌드·동작 OK*: vibrancy
    ([`vibrancy_mac.rs`](src-tauri/src/vibrancy_mac.rs) NSVisualEffectView),
    트레이, Keychain 사용량 집계 ([`usage_api.rs`](src-tauri/src/usage_api.rs)
    `security` CLI), .app + .dmg + .app.tar.gz 번들. *첫 macOS release 발행*은
    BACKLOG P0 (집 Windows signing key 가져온 후).
  - macOS DMG 첫 빌드 시 Terminal 에 Finder Automation 권한 필요
    (System Settings → Privacy & Security → Automation → Terminal → Finder).
    권한 없으면 bundle_dmg.sh 가 AppleEvent `-1712` timeout 으로 실패
    (회귀 사례 §8).
- **최초 설치:** `npm install`
- **개발 서버:** `npm run tauri dev`
- **프로덕션 빌드:** `npm run tauri build`
- **아이콘 일괄 생성 (자산 변경 시):** `npm run tauri icon path/to/source.png`
- **타입 체크:** `npm run typecheck`
- **산출물 (Windows):**
  - NSIS 인스톨러: `src-tauri/target/release/bundle/nsis/Claude Widget_<ver>_x64-setup.exe`
  - NSIS signature (서명 빌드 시): `<인스톨러>.exe.sig`
  - 포터블 exe: `src-tauri/target/release/claude-widget.exe`
- **산출물 (macOS):**
  - .app 번들: `src-tauri/target/release/bundle/macos/Claude Widget.app`
  - .dmg: `src-tauri/target/release/bundle/dmg/Claude Widget_<ver>_aarch64.dmg`
  - 자동 업데이트 tarball: `src-tauri/target/release/bundle/macos/Claude Widget.app.tar.gz` + `.sig` (서명 빌드 시)
- **자동 업데이트 매니페스트** (양 OS 공통): `src-tauri/target/release/bundle/updater/latest.json` — Tauri CLI가 자동 생성하지 *않음*. 빌드 후 `node scripts/make-updater-manifest.mjs` 실행 — Windows NSIS `.sig` + macOS `.app.tar.gz.sig` 둘 다 자동 감지해 platforms 키 채움.
- **서명 빌드 환경 변수** (릴리즈 빌드 시 필요, dev 빌드는 생략):
  - `TAURI_SIGNING_PRIVATE_KEY` — `~/.tauri/claude-widget.key` 경로
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — 1Password 등에서 복사
  - PowerShell prefix 예시: `$env:TAURI_SIGNING_PRIVATE_KEY="$env:USERPROFILE\.tauri\claude-widget.key"; $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=(Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText); npm run tauri build`

### 빌드 후 동작 워크플로 (자동)

코드를 수정했고 빌드가 필요한 경우, 다음 흐름을 **사용자 확인 없이 자동 수행**한다:

1. 파일 수정
2. 실행 중인 `claude-widget.exe` 프로세스가 있으면
   `Stop-Process -Name "claude-widget" -Force -ErrorAction SilentlyContinue` 로 종료
3. `npm run tauri build` 실행
4. 새로 빌드된 `src-tauri/target/release/claude-widget.exe` 재실행
5. 결과(빌드 성공/재시작 PID 등) 한 번에 요약 보고

> Cargo `[package] name = "claude-widget"` 이 산출물 이름의 진실
> 출처. `tauri.conf.json` `productName: "Claude Widget"` 은 NSIS
> 인스톨러 표시 이름·창 제목에만 적용된다.

**이유:** Windows의 .exe 락(WinError 5)에 빌드가 막히는 흐름을 매번 사용자에게
확인받지 않도록 한다. 빌드와 무관한 다른 사용자 프로세스(브라우저, 에디터 등)는
절대 함부로 종료하지 않는다.

### 테스트 프레임워크

- **자동화된 테스트 프레임워크는 구성되어 있지 않다.** 저장소에 `tests/`, `test_*.py`, `pytest.ini`, `tox.ini`, `pyproject.toml`, `setup.cfg` 가 모두 없다.
- 검증은 수동(빌드된 .exe 실행 → UI 동작 확인)으로 한다.
- 따라서 Karpathy §4의 "테스트 작성 후 통과시키기" 패턴은 **기본적으로 적용 불가**. 대안: PR/커밋 시 *어떤 시나리오를 손으로 확인했는지* 텍스트로 명시한다 (예: "AOT toggle on/off, 옵션 패널 열고 닫기, sync 1회").

### 프로젝트 구조

```
src/                    # SolidJS + TypeScript 프론트엔드
  main.tsx              # 진입점
  App.tsx               # 뷰 라우팅
  components/           # 재사용 컴포넌트 (LiquidGlass, GlassCard, CapsuleProgress, …)
  views/                # 3-mode 뷰 + Header/Footer/Settings
  styles/               # tokens.css / base.css / glass.css (디자인 시스템 단일 진실 출처)
  state/store.ts        # Solid signals
  i18n/{en,ko}.ts       # 다국어 사전
  assets/               # 폰트, SVG, PNG
src-tauri/              # Rust 백엔드
  Cargo.toml
  tauri.conf.json       # 윈도우/번들 설정
  capabilities/         # 권한 매니페스트
  src/
    lib.rs              # 앱 부트
    commands.rs         # #[tauri::command] 노출
    usage_api.rs        # OAuth 사용량 API
    jsonl_aggregator.rs # JSONL 5h 블록·기간·모델별 집계
    pricing.rs          # 모델 단가 테이블
    tray.rs             # 시스템 트레이
    migration.rs        # 레거시 QSettings → tauri-plugin-store 1회 이관 (Windows-only)
    vibrancy_win.rs     # Win11 Mica/Acrylic
    vibrancy_mac.rs     # macOS NSVisualEffectView (HudWindow material)
  icons/icon.ico
```

- **단일 파일 정책은 폐기**. Tauri 표준 다중 모듈 레이아웃을 따른다.
- **디자인 토큰**: 모든 색·간격·타이포·모션 값은 `src/styles/tokens.css`에서
  CSS Custom Property로 정의하고 컴포넌트는 `var(--*)`로만 참조 — 인라인 매직
  넘버 금지.
- **자산 갱신**: 아이콘 변경 시 `npm run tauri icon` 한 줄로 전 OS 사이즈 재생성.
- **레거시 PyQt6 코드**: `v1.5.1` 이하 태그에서 `git checkout v1.5.1 -- Source/`로
  꺼내볼 수 있다. `main` 브랜치에는 없다.

### 코드 스타일 (TypeScript / Rust / CSS)

- **TypeScript**: 들여쓰기 2-space, `strict: true`. 타입 힌트는 export되는 함수
  시그니처와 컴포넌트 props에 필수, 내부는 추론 허용.
- **Rust**: 표준 `cargo fmt` 기본값(4-space, 100 cols). `cargo clippy` 경고는
  수정하지만 자동 포매터를 *기존 코드 전체에 강제 돌리지 말 것* (대량 diff 회피).
- **CSS**: 모든 색·간격·모션 토큰은 `src/styles/tokens.css`에서 정의하고
  컴포넌트는 `var(--*)`로만 참조 — 인라인 매직 넘버 금지.
- **주석**: 기본은 작성하지 않는다. *왜 이렇게 했는지*가 비자명한 경우(숨은
  제약, 과거 버그 우회, Win11 API 차이 등)에만 짧게 추가한다.
- **포매터/린터**: 자동 포매터를 기존 코드 *전체에* 돌리지 말 것 ("Surgical
  Changes" 위반).

### 릴리즈 정책 — 단일 레포

**모든 릴리즈는 메인 레포 `gnoeynij/Claude-Usage-Widget` 한 곳에서만 발행한다.**

이전에 별도 운영하던 public 미러 레포(`Claude-Widget-Releases`)는 2026-04-29 라이선스 정리 과정에서 삭제됨. 원작자(INNO-HI) 양해 후 attribution + LICENSE를 정비했으므로 단일 레포로 충분.

**표준 발행 시퀀스** (GitHub Actions CI — v2.0.2 이후):

```bash
# 어느 머신에서든 (macOS / Windows / 회사 / 집)
# 1. 6 곳 버전 bump (회귀 사례 §3) + 코드 변경 commit + push
git push

# 2. 태그 push — CI 자동 빌드 시작
git tag vX.Y.Z && git push origin vX.Y.Z
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) 가
`v*.*.*` 태그 push (또는 manual `workflow_dispatch`) 를 trigger 로 잡아서:

- Windows runner + macOS runner *동시* 서명 빌드 (tauri-action v0)
- 양 OS 자산 + `latest.json` 자동 합본 생성·upload
- GitHub Release 자동 발행 — dash 포함 (`v2.0.3-rc1`) 시 prerelease 자동 판별

소요 5~10분. 사용자 burden: *tag push 한 줄*. 양 OS 머신 왕복 불필요
(v2.0.2 이전의 수동 cross-machine 흐름 — Windows 빌드 → iCloud 전송 →
macOS 빌드 → 통합 release — 가 매 회 30분~1시간 burden 이었음).

### CI secrets

repo `Settings → Secrets and variables → Actions` 에 등록 완료:
- `TAURI_SIGNING_PRIVATE_KEY` — minisign secret key 파일 내용 (base64-wrap
  포함, 회귀 사례 §11 참조)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — 1Password 비밀번호

### Signing key 다중 백업 (disaster recovery — 비가역 영역)

signing key 또는 password 가 단일 source 만 갖고 있으면 분실 시 *모든*
사용자 자동 업데이트가 비가역 차단됨. 최소 3 위치 백업 의무:

| 위치 | 용도 | 단일 분실 영향 |
|---|---|---|
| **GitHub Secret** | CI 빌드용 | 재등록 가능 (다른 source 살아있으면) |
| **로컬 `~/.tauri/claude-widget.key`** (양 머신) | 비상 수동 빌드용 + secret 재등록 source | 한 머신만 분실 = 다른 머신·1Password 로 복원 |
| **1Password 등 secure cloud** | 최종 fallback | 위 둘 동시 분실 시 last resort |

> **always-spot-check** — 분기마다 *복원 가능*성 검증 권장 (예: 1Password
> → 임시 머신 `~/.tauri/` 복원 + `npm run tauri build` exit 0).

### 수동 발행 (CI 우회 — 비상시)

CI 장애 / emergency hotfix 시 수동 흐름:

```bash
# 양 OS 머신에서 각각 (macOS · Windows)
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/claude-widget.key"  # PowerShell: $env:...
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"
npm run tauri build  # OS 에 맞는 산출물 자동

# 한 머신에 양 OS 산출물 모은 뒤
node scripts/make-updater-manifest.mjs
gh release create vX.Y.Z --target main --title "..." --notes "..." \
  <양 OS assets...> latest.json
```

한 OS 산출물만 있으면 manifest 의 그 platform 키만 채워짐 → 다른 OS
사용자는 자동 업데이트 미수신.

### 자동 업데이트 동작 조건

`src-tauri/tauri.conf.json`의 `plugins.updater.endpoints`는 메인 레포의
`releases/latest/download/latest.json`을 가리킨다. **익명 GitHub Releases 다운로드는
메인 레포가 public일 때만 200을 반환**한다.

| 메인 레포 visibility | tauri-plugin-updater 체크 |
|---|---|
| public | ✅ 동작 — `latest.json`에 명시된 새 버전이 있을 때 알림 |
| private | ❌ 404로 silent 실패 — 위젯 본체 및 사용량 동기화에는 영향 없음 |

> **개인 토큰을 .exe에 임베드해 private 상태에서도 동작시키려는 시도는 금지.**
> Tauri 빌드도 NSIS 인스톨러를 해체해 임베드된 문자열을 회수할 수 있어
> 어떤 토큰 암호화 방식도 보안적 의미가 없다.

---

## 현재 진행 스냅샷

이 섹션은 새 PC·새 Claude Code 세션이 이 프로젝트의 *현재 상태*를 빠르게 잡기 위한 요약. 사실이 바뀌면 갱신하고, 추정이 섞이면 명시한다.

- **버전**: `v2.1.4` ([package.json](package.json), [package-lock.json](package-lock.json), [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json), [src-tauri/Cargo.toml](src-tauri/Cargo.toml), [src-tauri/Cargo.lock](src-tauri/Cargo.lock), [src/state/store.ts](src/state/store.ts) 모두 동일. **bump 헬퍼** `node scripts/bump-version.mjs <semver>` (또는 `--check`) — 회귀 사례 §3 재발 방어.
- **빌드**: `npm run tauri build` exit 0. Windows MSVC 14.44.35207 + rustc 1.95.0 + Node 환경에서 51~96s (v2.1.0 측정 1m 36s — notification plugin 첫 컴파일). macOS Apple Silicon (rustc 1.95.0 + Node 20.20.2) 에서 19~31s. **CI 자동 빌드** ([.github/workflows/release.yml](.github/workflows/release.yml)) — tag push 시 양 OS runner 동시 (~5~10분).
- **자동화 테스트**: **없음.** 검증은 빌드된 `.exe`/`.app` 실행 + UI 동작 + 캡처 스크립트로 수동 (`capture-widget.ps1` / `capture-widget.sh`).
- **자동 업데이트**: 양 OS 활성 (v2.1.4). `releases/latest/download/latest.json` endpoint, minisign 서명 검증. macOS 는 ad-hoc 서명 (Apple Developer 미가입), Gatekeeper 첫 실행 우회 README 안내.
- **알려진 빈 구멍** ([BACKLOG.md](BACKLOG.md) 참조):
  - OAuth 토큰 **full refresh (B 방식 — refresh_token 으로 새 access token 발급)** 미구현 — recovery (만료 banner + mtime polling + 자동 retry) 는 v2.0.0 에서 완료 (BACKLOG ✓ 60). 토큰 만료 시 사용자가 `claude` CLI 1회 실행 필요. B 방식은 Anthropic spec 미공개·client_id 폐기 위험으로 P0 → P1 격하.
  - macOS Universal binary 미지원 — Apple Silicon only (Intel Mac 수요 시 후속, BACKLOG P2)
  - macOS 트레이 템플릿 이미지 미적용 — 다크 메뉴바 자동 색반전 X (BACKLOG P2)
- **다음 작업 후보**: [`BACKLOG.md`](BACKLOG.md) P0 참조.

## UI 변경 표준 절차 (SOP)

위젯은 **transparent + Win11 Mica/Acrylic + Liquid Glass** 합성이라 *dev 서버 캡처*(브라우저 렌더)와 *실 .exe 캡처*(OS composited)가 다르다. 시각 검증은 실 .exe 캡처가 정답.

### 의무 절차 — 커밋 전 (UI 영향이 있을 때)
1. 빌드 후 동작 워크플로(위 섹션) 1~4단계 실행 — 새 .exe로 띄움.
2. [`scripts/capture-widget.ps1`](scripts/capture-widget.ps1) 으로 화면 캡처.
   - 기본 출력: `%USERPROFILE%\Desktop\imgs\widget-capture.png`
   - 커밋 전 *시각적 이상 없음* 명시적 자기 보고.
3. 모드 전환·모달·다크/라이트·투명도 조절은 각각 1회씩 직접 확인.
4. 푸시는 사용자 신호 받을 때까지 보류.

### 시각 회귀 방어층

자동화된 테스트가 없으니 *수동 + 캡처*가 유일한 방어. 다음 영역은 코드 변경만으로 회귀 위험이 큼:

| 영역 | 위험 | 검증 |
|---|---|---|
| `src/styles/tokens.css` 색·alpha·spacing | 토큰 한 줄 변경이 카드·트랙·foreground 가독성에 동시 영향 | 라이트·다크 둘 다 캡처 |
| `vibrancy_win.rs` Win11 Mica/Acrylic | Windows 빌드 따라 API 동작 차이 | Win11 실 머신 캡처 |
| `LiquidGlass`, `GlassCard` | backdrop-filter + alpha 조합이 OS 합성과 만나면 dev 서버 미리보기와 다르게 보임 | 실 .exe 캡처 의무 |
| `SegmentedControl` thumb transition | 컴포넌트 측정 기반이라 폰트 로드 타이밍·DPI에 민감 | 실 .exe에서 전환 1회 |
| **opacity slider 영역** (`tokens.css --bg-alpha-mult` / `--scrim-bg` / `glass.css ::before` `::after` / `vibrancy_*.rs set_mica_enabled`) | 6 layer 합성 (OS vibrancy · panel bg · panel ::before/::after · card bg · card ::before · Settings scrim) 중 한 layer 만 fade 시키면 다른 layer leak — 사용자 시각엔 *"위젯 본체 안 사라짐"* 또는 *"라이트에서 어두운 회색 wash"* 로 인지 (회귀 사례 §16) | **라이트/다크 × opacity 0%/50%/100% = 6 컷 캡처** 자기 보고 의무. 자동화 0% 영역, 사람 눈만 잡음 |

## 회귀 사례 기록

v2.0.0-alpha 진행 중 발견된 사고 누적. *왜 이렇게 됐는지·재발 방어 단서*만 기록 — 코드 fix는 커밋·BACKLOG로 보낸다.

1. **MSVC `link.exe` vs GNU `link.exe` 충돌** — Rust MSVC 타깃은 Visual Studio Build Tools의 `link.exe`를 요구한다. Build Tools 미설치 + Git for Windows의 `link.exe`(coreutils)가 PATH에 있으면 cargo가 그걸 호출해 *"Try 'link --help' for more information"* 같은 misleading 에러로 실패한다. 사전 요구를 만족시키지 않은 상태에서 빌드를 돌리면 메시지 만으로 원인 추적이 어려움. **재발 방어**: 새 머신 첫 빌드 전 `where link.exe`로 MSVC 경로가 먼저 나오는지 또는 vcvars64.bat 소싱이 되었는지 확인.
2. **OAuth 토큰 자동 refresh 부재** — [`usage_api.rs`](src-tauri/src/usage_api.rs)는 `refreshToken`을 *읽기만* 한다. `.credentials.json`이 만료된 채 사용자가 Claude Code CLI를 한동안 안 쓰면 위젯이 silent로 `TOKEN_EXPIRED` 상태가 되고, 사용자는 "연결 안 됨"이라고 인지한다. **재발 방어**: 위젯 UI에 만료 사실 + "claude CLI 실행" 안내를 노출하거나, refresh 호출을 위젯에 추가([BACKLOG](BACKLOG.md) P0).
3. **버전 표기 다중 출처** — `package.json` / `package-lock.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src/state/store.ts` 여섯 곳이 각각 버전을 들고 있다. 한 곳만 바꾸면 NSIS 파일명·footer 표시·updater 매니페스트가 어긋남. 4aa3443에서 한 차례 정렬. **재발 방어**: v2.1.0 에서 `scripts/bump-version.mjs` 헬퍼 도입 — `node scripts/bump-version.mjs <semver>` 로 6 파일 일괄 bump, `--check` 로 동기화 검증. CRLF/LF 양립 (`\r?\n` regex), 6 파일 불일치 시 *refuse to bump*.
4. ~~**`bundle.targets`에 `"updater"` 누락 + `updater.pubkey` 빈 문자열**~~ — *해결됨* (signing key 발급·`createUpdaterArtifacts: true`·`scripts/make-updater-manifest.mjs` 추가). 단 Tauri 2 schema는 `targets`에 `"updater"`를 받지 *않고* `bundle.createUpdaterArtifacts` 옵션이 별개라는 점은 v1과 다름. `latest.json`은 CLI가 자동 생성 안 함 — 후속 스크립트 의무.
5. **워크트리 간 stale fast-forward** — 메인 워크트리와 `.claude/worktrees/*` 둘 다 같은 origin/main을 트래킹. 한쪽에서만 pull하면 다른 쪽은 `behind N`. **재발 방어**: 작업 시작 시 양쪽 모두 `git status`/`pull --ff-only`.
6. **Cargo.toml LF↔CRLF 라인엔딩 modification** — Windows 빌드 후 `git status`에 `Cargo.toml`이 *modified*로 잡혀도 실제 내용 diff는 비어있을 수 있음 (line-ending 정규화 비교). `git checkout -- <file>` 로 해소되고 손상 아님. **재발 방어**: 정규화 경고만 출력되면 무시.
7. **Mica vibrancy가 opacity slider fade를 시각적으로 무력화 (5번 실패의 진짜 원인)** — `.glass-panel` 의 background-color 가 `rgba(255,255,255, 0)` 까지 *완벽히 적용*되어도 (DOM·computed style 다 transparent 확정) 위젯이 *흰색 그대로*로 보임. 원인: Win11 Mica가 *밝은 desktop 위에서 흰색에 가깝게 paint*하면서 panel의 *진짜 fade*가 시각적으로 묻힘. 5번 시도가 모두 CSS·OS-level만 만진 이유는 *Mica를 분리 검증하지 않고* 첫 가설 (backdrop-filter cache)에 갇혀서. **재발 방어**: 시각 회귀 진단 시 *layer를 한 번에 하나씩 비활성*(.glass-panel inline override·backdrop-filter·Mica) 하면서 *원인 분리*. 23222cf 회고 + 본 fix 커밋 참조.
8. **macOS .dmg 빌드 — Finder AppleEvent `-1712` timeout** — `bundle_dmg.sh` 가 *DMG 창 예쁘게 꾸미는* (icon 배치) 단계에서 AppleScript 로 Finder 에 명령. Terminal 에 Finder Automation 권한 없으면 *silent dialog 없이* timeout 으로 실패하고 빌드 중단 → `.app.tar.gz` updater artifact 도 미생성 (후속 단계 차단). **재발 방어**: 첫 .dmg 빌드 전 System Settings → Privacy & Security → Automation → Terminal/iTerm → Finder 토글 ON. 또한 `npm run tauri build` stdout 만 보면 *진짜 stderr* 안 보임 — `npx tauri build --verbose` 로 회수.
9. **macOS Claude Code credentials는 *Keychain*, Rust `keyring` crate 매치 실패** — Windows 와 달리 macOS 의 Claude Code CLI 는 `~/.claude/.credentials.json` 을 *만들지 않음*. token 은 *login Keychain* (`security` 서비스 `Claude Code-credentials`, account `$USER`). JSON 구조는 cross-platform 동일 (`claudeAiOauth`). Rust `keyring` v3 `Entry::new(service, user).get_password()` 는 *No matching entry found* 로 실패 (ACL 또는 query 차이 추정) — 그러나 *`security` CLI subprocess* 는 동작. 우회: `std::process::Command::new("security").args(["find-generic-password", "-a", &user, "-s", "Claude Code-credentials", "-w"])`. **재발 방어**: macOS Keychain 통합 시 Rust crate 무조건 시도 X — *그 OS 의 표준 CLI* 호출도 후보. [usage_api.rs:33-66](src-tauri/src/usage_api.rs) 참조.
10. **Apple Developer Program 미가입 정책 — ad-hoc 서명 + Gatekeeper 안내** — $99/yr 비용 대비 사이드 프로젝트 ROI 부족. 결정: 미가입, ad-hoc 서명만 (Tauri 기본). 영향: 다른 사용자가 .dmg 받아 .app 첫 실행 시 *"확인되지 않은 개발자"* 경고. README 에 우회 안내 (우클릭 → 열기 / `xattr -d com.apple.quarantine`). **자동 업데이트는 minisign 키 (Apple 과 무관) 로 동작** — Windows 와 같은 키 그대로 macOS `.app.tar.gz` 서명. **재발 방어**: macOS 배포 = Apple 인증서 라는 자동 가정 피하기, Tauri updater 서명 / Apple 코드 서명은 *완전 별개* 영역.
11. **minisign secret key 파일이 base64-wrap 된 단일 라인** — Tauri 의 `TAURI_SIGNING_PRIVATE_KEY` 환경변수는 *key content 자체*를 받음. *file path* 가 아님 (PowerShell `$env:...="$env:USERPROFILE\.tauri\claude-widget.key"` 형태가 *path* 로 보이지만 Tauri 가 내부에서 file content 를 read 한다 — Windows 에선 그렇게 동작했지만 macOS Tauri 2 CLI 는 *값을 그대로 base64 minisign content* 로 decode 시도). 표준 minisign CLI 의 *2-line plain text* 형식 (`untrusted comment: ...\n<base64>`) 으로 file 을 *decode* 하면 Tauri 는 "Invalid symbol 32 (space) offset 9" 로 실패한다 — `untrusted` 의 9 번째 char (공백) 가 base64 alphabet 외. **재발 방어**: `~/.tauri/claude-widget.key` 는 *base64-wrap 단일 라인* 형식 그대로 보존 (iCloud 전송·다른 머신 복사 시 *decode 금지*). 파일 검사: `head -c 50` 했을 때 `dW50cnVzdGVkIGNvbW1lbnQ6...` (base64 인코딩된 "untrusted comment:") 로 시작해야 정상.
12. **macOS WKWebView 가 `-webkit-app-region: drag` 미지원 + `start_dragging` ACL 부재** — Tauri 2 frameless transparent 윈도우의 드래그가 Windows 에선 CSS `-webkit-app-region: drag` (Chromium 전용) 로 OS-native 처리되어 ACL 무관하지만, macOS WKWebView 는 이를 무시한다. fallback 으로 `getCurrentWindow().startDragging()` JS API 호출이 필요한데, *capabilities/default.json 에 `core:window:allow-start-dragging` 가 없으면* IPC 가 *"Command plugin:window|start_dragging not allowed by ACL"* 로 silently fail. **재발 방어**: 새 capability 추가 시 *macOS 의 IPC 의존 흐름*을 분리 검증. CSS-only drag 가 Windows 에서 통과한다고 macOS 도 통과한다는 가정 X.
13. **NSVisualEffectView 가 contentView 의 `masksToBounds` 로 clip 되지 않음** — vibrancy_mac.rs 의 `apply_rounded_corners` 가 *contentView 한 곳*에만 `layer.cornerRadius + masksToBounds` 적용했을 때 4 모서리에 *HudWindow material (검은 톤)* 이 그대로 보임. 원인: `window-vibrancy` 가 NSVisualEffectView 를 *contentView 의 sibling layer* 로 추가 → contentView 의 mask 가 sibling 까지 clip 하지 않음. 추가로 `tauri.conf.json` `transparent: true` 만으로는 일부 macOS 빌드에서 `NSWindow.backgroundColor` 가 clear 가 아니라 검은색 paint → 모서리 검은색. **재발 방어**: macOS frameless transparent + vibrancy 조합에서 corner round 적용 시 `(a) NSWindow.opaque = false + backgroundColor = NSColor.clearColor` 명시 set, `(b) contentView 의 모든 직접 subview layer 에 corner mask` 둘 다 의무.
14. **`gh release upload <file>#<displayname>` 의 `#displayname` 은 *UI 라벨*만 변경** — asset 이름과 URL 은 *원본 파일명 그대로* (공백→dot 변환만). 즉 `gh release upload "Claude Widget.app.tar.gz#Claude Widget_2.0.2_universal.app.tar.gz"` 를 하면 *UI 표시는 universal*, *실 URL 은 `Claude.Widget.app.tar.gz`*. v2.0.2 release 의 macOS 자동 업데이트 *404* 회귀가 이 영역. **재발 방어**: `scripts/make-updater-manifest.mjs` 의 `assetName` 은 *Tauri 번들러가 emit 하는 generic name* (`Claude Widget.app.tar.gz`) 그대로 사용. release tag (URL path 의 `vX.Y.Z`) 가 버전 identity 를 제공한다. 또는 *upload 전*에 파일 자체를 `cp` 로 rename.
15. **Persist gap — setter 가 메모리만 갱신, init 시 default 복원** — v2.0.0~v2.0.2 동안 [store.ts](src/state/store.ts) 의 `setLang` / `setDark` / `setAlwaysOnTop` / `setSyncIntervalMin` / `setOpacity` / `setMode` 가 모두 `setStore()` 만 호출하고 `tauri-plugin-store` 에 *persist 안 함*. 사용자가 한 번 한국어·다크·5분→10분·opacity 50%·mini 모드 설정해도 위젯 재시작 시 *전부 default (en / light / off / 5분 / 0% / normal)* 로 복원. 그동안 *사용자 신고 안 들어온 이유*: 본인이 default 값을 그대로 쓰는 경우가 많고, 재시작 빈도가 낮으면 인지 못 함. 추가로 [migration.rs:58](src-tauri/src/migration.rs:58) 의 `app.store("settings.json")` 가 store.ts 의 `widget-settings.json` 과 *다른 파일* — PyQt6 마이그레이션이 작동해도 새 코드가 그 파일을 안 읽어 *사실상 dead code* 였음. v2.0.3 에서 (a) `persistSetting` / `loadSetting` generic helper + 6 setter persist + initStore boot load + suppressPersist race 방어, (b) migration.rs 파일명 통일 + PyQt6 키 ↔ camelCase 매핑 + `sync_interval` seconds→minutes 변환 한 묶음으로 해소. **재발 방어**: 새 store 키 추가 시 *setter 안에 persist 호출 + initStore 에 load 호출* 같이 페어. *마이그레이션 코드와 새 코드의 파일명·키 셋*은 *반드시 동일 source* — migration.rs 작성 시 store.ts default object 와 cross-check 의무. 검증: 빌드된 .exe 에서 lang/dark/opacity/mode 변경 → 종료 → 재실행 후 복원되는지 확인.
16. **opacity slider 의 부분 paint 누락 — `.glass-panel::before/::after`·`.glass-card::before`·Settings scrim 동기화 의무** — 회귀 사례 §7 (v2.0.0 Mica 토글 fix) 가 *위젯 본체 main background* 의 opacity 슬라이더 동작을 해결했지만 *pseudo-element layer* (`.glass-panel::before` specular border + `.glass-panel::after` inner glow + `.glass-card::before` 카드 외곽선) 는 `--bg-alpha-mult` 영향 안 받아 *opacity 100% 에서도 그대로 paint* → 사용자 시각엔 "위젯 본체는 안 사라지고 옵션 패널만 fade" 로 인지. 추가로 Settings 오버레이 scrim 이 `rgba(0,0,0,0.32)` *고정 검은 톤* 이라 라이트 모드 + opacity 100% 시 위젯 본체 사라진 뒤 *검은 wash 만 남아 desktop 위 어두운 회색* 으로 보임. v2.1.1 에서 (a) `::before/::after` 에 `opacity: var(--bg-alpha-mult)` 적용 (inner glow 는 `calc(0.55 * mult)`), (b) `--scrim-bg` 토큰 라이트 (`rgba(255,255,255,0.55)`) / 다크 (`rgba(0,0,0,0.32)`) 분기로 해소. **재발 방어**: opacity slider 에 닿는 PR 은 *모든 paint layer 가 동일 fade 동기화* 의무 — main background 만 mult 받는 흐름 X. 검증 = 라이트/다크 × 0/50/100% **6 컷 캡처 자기 보고** (UI SOP "시각 회귀 방어층" 섹션 참조). 자동화 0% 인 영역이라 사람 눈만 잡을 수 있음.
17. **macOS WKWebView opaque backing — opacity slider 의 Windows 패턴 비호환** (⚠ 2026-05-26 §18 정정 — fundamental 결론 부분 부정, Tauri `macos-private-api` opt-in 누락이 진짜 영역) — Windows WebView2 (Chromium) 가 natively transparent 인 반면, macOS WKWebView 는 *system 색 opaque backing* (라이트=흰색, 다크=어두운 회색). Tauri `transparent: true` 가 *NSWindow 만* 처리하고 *WKWebView 까지 안 닿음* (추정 — wry 로 transparent attribute 전달 경로 누락). 결과: `.glass-panel { background: rgba(...,0) }` 만으로 desktop 비치지 않고 *WKWebView default 색 paint*. 10시간 시도 끝에 작동 패턴 발견 — *Tauri setup hook 의 `with_webview` callback 안에서 `setBackgroundColor:clearColor + setOpaque:NO`* (runtime IPC 시점은 `_postDidFinishNotification` observer 안 영역이라 NSException 발생, `objc2::exception::catch` 도 unwind 경로 달라 우회됨). 안전책 3중: `respondsToSelector:` + `objc2::exception::catch` + `AssertUnwindSafe`. CSS 차원도 `--bg-alpha-mult` floor 라이트 0.05 / 다크 0.3 의무 — WKWebView transparent + .glass-panel alpha 0 합성 시 content (text/donut) 도 desktop blending 으로 invisible, floor 가 content layer anchor. **함정** — KVC key `drawsBackground` 는 iOS UIWebView 잔재, macOS WKWebView 는 `backgroundColor` (1~5차 시도 시간 손실 영역). **safe fallback** — `NSWindow.alphaValue` 토글 (공식 property, NSException 없음) 단 *전체 윈도우 fade* 라 background-only fade 모방 불가. **v2.1.1 시점 결정** — 전체 폐기·원복. **재시도 결정 시 의무 사전 read**: [docs/sessions/2026-05-24-macos-opacity-attempts.md](docs/sessions/2026-05-24-macos-opacity-attempts.md) (8 단계 시도 + 부수 시도 + root cause + 깨달음 5건 전체). 향후 wry → WKWebView transparent 전달 경로가 upstream 에서 패치되면 자연 해결 가능성.
18. **macOS opacity slider 진짜 root cause** (회귀 §17 부분 정정, v2.1.2 `140dcfc`) — wry 0.55.1 의 `transparent` feature 는 *default 비활성*, Tauri 가 `macos-private-api` opt-in 시에만 `wry/transparent` 활성화. 우리 프로젝트가 opt-in 안 했음. wry source ([wkwebview/mod.rs](https://github.com/tauri-apps/wry) `new_ns_view`) 의 `config.setValue_forKey(NSNumber(false), ns_string!("drawsBackground"))` 가 *이미 구현* (wry 0.54.2 `#1662`). **즉 §17 의 1-8차 시도 + 7차 수동 ObjC 패턴이 *대부분 우회 가능* 영역이었음** — `src-tauri/Cargo.toml` 의 tauri features 에 `macos-private-api` 추가 + `src-tauri/tauri.conf.json` 의 `app.macOSPrivateApi: true` + `src/state/store.ts` 의 macOS 한정 `--bg-alpha-mult` floor (라이트 0.05 / 다크 0.3, `IS_MAC` + `effectiveBgAlphaMult` helper) 묶음으로 동작 확정. **여전한 fundamental 한계**: macOS WKWebView 가 *content + background layer 분리 합성* 을 *안 함 또는 다르게 함* (Chromium WebView2 와 architecture 차이) — background alpha 0 시 content (text/donut) 도 desktop blending 으로 invisible. floor 가 *content layer anchor* 역할. 즉 *fade 동작* + *desktop blending wash* (사용자 wallpaper 색 영향) 까지가 한계 — Windows 의 *content opaque + background invisible* 시각 *macOS 에서 fundamental 못 만듦*. **검증** (Production .app, macOS Apple Silicon, 6 컷): 라이트/다크 × 0/50/100% 모두 fade 명확. 다크 100% 가 *밝은 회색* 인 건 *밝은 wallpaper desktop blending* 영향 — 어두운 wallpaper 사용자는 *어두운 회색*. **재발 방어**: (a) *추정* 영역 작성 시 *검증 단계 yes/no* 명시 의무 — §17 의 추정이 *진짜 검증 안 함* 으로 8 차 시도 시간 대부분 손실, *wry source `grep transparent`* 30분 검증만 했으면 *2 줄 변경* 으로 끝났을 작업. (b) *fundamental 불가능* 결론 전 upstream source/docs 직접 확인 최소 1회 의무. (c) Tauri/wry feature gate 의심 시 *Cargo.toml features 매핑 + 의존성 `[features]` 섹션* 먼저 확인. (d) 사용자 신호 *원복* 의 진짜 원인이 *완전 transparent 시각 만족 X* 였다면 *Apple WebKit upstream 영역* 으로 기대 관리 — 코드로 해결 못 함.

## Plan·검토 워크플로우 SOP

`murim-inn`·`murim-idle`에서 검증된 패턴. 1인 사이드 프로젝트엔 plan perfection-seeking이 *안정화의 적*이라는 전제.

### 검토 횟수 곡선 (Claude 자기 인지)

| 회차 | 결함 발견 성격 | 신호/노이즈 |
|---|---|---|
| 1차 | 큰 결함 sweep | 신호 우세 |
| 2차 | 중간 결함 + 1차 retract | 절반·절반 |
| 3차+ | nitpick·edge case | 노이즈 우세 |

3차부터는 *Claude가 신중해 보이려는 편향* 영역.

### Self-stop 신호 (Claude 책임)
- 검토 요청 시 *새 진짜 결함 없으면* "추가 검토 가치 없음. 실행 권고" 명시.
- "결함 찾기 임무" 편향 인지 — sycophancy 반대 방향(과도 비판)도 같은 위험.

### 중요도 높은 작업 검토 분기 — 6-메뉴

사용자가 *"중요 작업 검증 요청"* 신호를 주면 다음 6-메뉴 제시. 1-5에서 조합 선택, 6은 명시적 신호로만:

```
1. 자동화 가드 다중 가동 (typecheck + tauri build + capture-widget.ps1 + cargo clippy)
2. 독립 Plan 에이전트 재기동 (다른 맥락의 시선)
3. 증거 강화 (한 것·안 한 것 더 깊이)
4. 실 .exe 캡처 (시각·사용 흐름 사고 가능성)
5. /clear 또는 새 세션 (long-session 영향 의심 시)
6. Claude 추가 검토 (3회차 이상, ⚠ 잡음 영역 명시)
```

위젯은 vitest/Playwright이 없으니 1번의 "자동화 가드"는 typecheck + 빌드 exit code + 캡처 비교까지가 한계 — 의식적으로 인지.

## Session handover 룰

긴 세션은 *"이미 안다"는 무근거 가정*을 키워 verify 건너뜀.

**트리거** — Claude 측에서 다음 발생 시 명시적 신호:
- Compaction 발생 이후
- 이번 작업이 cross-cutting 결정·judgement·해석 비중 큼 + 컨텍스트 누적이 가정 의존을 키울 위험

**Claude 신호 문구 형식**:
> "이전 세션이 compaction 후 N 메시지 진행 중. 이번 작업이 [judgement/cross-cutting/해석]이라 `/clear` 또는 새 세션 권장.
>
> **남은 작업** (clear 전 처리·기록 권장):
> - [미커밋 변경 — `git status` 기반]
> - [결정만 되고 실행 안 된 사항]
> - [미해결 질문·보류된 사용자 요청]
>
> 처리 후 clear할까, 아니면 지금 진행할까?"

**남은 작업 처리 원칙**:
- *커밋 가능* → clear 전 커밋·푸시 (히스토리 보존)
- *커밋 불가 (결정·맥락 등)* → `BACKLOG.md`에 메모 후 clear
- *어느 쪽도 안 되면* → 사용자에게 명시: *"이건 다음 세션 첫 메시지에 다시 던져줘"*

## Claude 출력 자체 규약 (자기 표시 의무)

증거 기반 표시 — **자평가 라벨 제거**.

### 1. 코드 변경·plan 제안 시 끝에 2줄 부착
- **한 것**: 실제 실행 명령·읽은 파일·라인 (예: `✓ npm run typecheck exit 0`, `✓ Read src-tauri/src/usage_api.rs:81-110`, `✓ tauri build exit 0 (51.84s)`)
- **안 한 것**: verify 안 한 가정·skip한 검증·blind spot 후보 (예: `실 .exe UI 미캡처`, `Win10 미테스트`, `cargo clippy 미실행`)

### 2. "신뢰도 high/medium/low" 라벨 X
자평가 라벨은 anchoring bias 유발해 *사용자 점검 displacement*. 환각을 "high"로 표시할 가능성이 가장 높음.

### 3. "한 것"은 검증 가능한 형태
"정말 그 라인 읽었어?" 같은 질문으로 검증 가능. 단정 X.

### 4. "안 한 것" 정직히
"없음"이라 적기 쉽지만 거의 항상 *뭔가 안 했음*. 핵심 정직 신호.

### Always-spot-check 영역 (사용자 별도 검토 의무)

다음 영역은 *증거가 풍부해도* 사용자 spot check 의무. Claude는 변경 시 명시적으로 *"always-spot-check 영역. 별도 검토 권장."* 신호 부착.

- **OAuth 토큰 처리** (`src-tauri/src/usage_api.rs`) — Windows `.credentials.json` / macOS Keychain (`security` CLI) 읽기·refresh·만료 분기. 사용자 인증에 직결.
- **tauri-plugin-store 마이그레이션** (`src-tauri/src/migration.rs`) — 한 번 잘못 동작하면 사용자 설정 손실.
- **Win11 Mica/Acrylic vibrancy** (`src-tauri/src/vibrancy_win.rs`) — OS API 차이로 머신마다 다르게 보일 수 있음.
- **자동 업데이트** (`tauri.conf.json` `plugins.updater`, signing key, `latest.json`) — 잘못된 pubkey/매니페스트는 모든 사용자 업데이트를 막음. 비가역.
- **릴리즈 발행** (`gh release create`, 태그 push) — public 노출. amend·삭제 가능하지만 다운로드된 후엔 회수 불가.
- **비가역 git 동작** — `push --force`, `reset --hard`, 태그 삭제 후 재생성, 릴리즈 삭제. 항상 사용자 확인 후.

### 근본 한계 인지
위 규약 다 적용해도 *Claude가 모르는 줄도 모르는 영역*은 남음. 사용자 점검은 영원히 필요.

## 다음 작업 후보

[`BACKLOG.md`](BACKLOG.md) 참조 (P0~P3 우선순위 별).
