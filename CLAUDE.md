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
- **최초 설치:** `npm install`
- **개발 서버:** `npm run tauri dev`
- **프로덕션 빌드:** `npm run tauri build`
- **아이콘 일괄 생성 (자산 변경 시):** `npm run tauri icon path/to/source.png`
- **타입 체크:** `npm run typecheck`
- **산출물:**
  - NSIS 인스톨러: `src-tauri/target/release/bundle/nsis/Claude Widget_<ver>_x64-setup.exe`
  - 포터블 exe: `src-tauri/target/release/Claude Widget.exe`
  - 자동 업데이트 매니페스트: `src-tauri/target/release/bundle/updater/latest.json`

### 빌드 후 동작 워크플로 (자동)

코드를 수정했고 빌드가 필요한 경우, 다음 흐름을 **사용자 확인 없이 자동 수행**한다:

1. 파일 수정
2. 실행 중인 `Claude Widget.exe` 프로세스가 있으면
   `Stop-Process -Name "Claude Widget" -Force -ErrorAction SilentlyContinue` 로 종료
3. `npm run tauri build` 실행
4. 새로 빌드된 `src-tauri/target/release/Claude Widget.exe` 재실행
5. 결과(빌드 성공/재시작 PID 등) 한 번에 요약 보고

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
    migration.rs        # 레거시 QSettings → tauri-plugin-store 1회 이관
    vibrancy_win.rs     # Win11 Mica/Acrylic
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

**표준 발행 시퀀스**:
```bash
# 1. 코드 변경 커밋·태그·푸시
git push && git push origin vX.Y.Z

# 2. Tauri 빌드 (Windows 빌더에서 실행)
npm run tauri build

# 3. 메인 레포 릴리즈 (NSIS 인스톨러 + updater 매니페스트)
gh release create vX.Y.Z --repo gnoeynij/Claude-Usage-Widget \
  --title "..." --notes "..." \
  "src-tauri/target/release/bundle/nsis/Claude Widget_X.Y.Z_x64-setup.exe" \
  "src-tauri/target/release/bundle/updater/latest.json"
```

`latest.json`은 tauri-plugin-updater가 발견하는 매니페스트 파일.
메인 레포가 public인 한 자동 업데이트가 동작한다.

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
