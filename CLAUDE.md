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

> **Note:** 이 프로젝트는 IntelliJ IDEA에서 열리지만 **Python(PyQt6)** 프로젝트입니다. 아래 항목들은 실제 도구·정책에 기반하며, Java/Kotlin 등가물이 아닙니다.

### 응답 언어

- **사용자에게 보내는 모든 응답은 한국어로 작성한다.**
- 코드 내 식별자/문자열/주석은 기존 파일의 컨벤션을 따른다 (영문 식별자 + 한국어 사용자 노출 문자열).

### 빌드 도구 & 명령어

- **패키저:** PyInstaller (설정: `Source/claude_widget.spec`)
- **의존성 설치:** `pip install -r Source/requirements.txt` (PyQt6 ≥ 6.6, requests ≥ 2.31)
- **빌드 명령** (`Source/` 디렉토리에서 실행):
  ```bash
  python -m PyInstaller claude_widget.spec --noconfirm --clean
  ```
- **산출물:** `Source/dist/Claude-Widget.exe`

### 빌드 후 동작 워크플로 (자동)

코드를 수정했고 빌드가 필요한 경우, 다음 흐름을 **사용자 확인 없이 자동 수행**한다:

1. 파일 수정
2. PyInstaller 빌드 실행
3. 실행 중인 `Claude-Widget.exe` 프로세스가 있으면 `taskkill //F //IM Claude-Widget.exe` 로 종료
4. 새로 빌드된 `Source/dist/Claude-Widget.exe` 재실행
5. 결과(빌드 성공/재시작 PID 등) 한 번에 요약 보고

**이유:** 빌드가 dist의 .exe 락(WinError 5)에 막히는 흐름을 매번 사용자에게 확인받지 않도록 한다. 단, 빌드와 무관한 다른 사용자 프로세스(브라우저, 에디터 등)는 절대 함부로 종료하지 않는다.

### 테스트 프레임워크

- **자동화된 테스트 프레임워크는 구성되어 있지 않다.** 저장소에 `tests/`, `test_*.py`, `pytest.ini`, `tox.ini`, `pyproject.toml`, `setup.cfg` 가 모두 없다.
- 검증은 수동(빌드된 .exe 실행 → UI 동작 확인)으로 한다.
- 따라서 Karpathy §4의 "테스트 작성 후 통과시키기" 패턴은 **기본적으로 적용 불가**. 대안: PR/커밋 시 *어떤 시나리오를 손으로 확인했는지* 텍스트로 명시한다 (예: "AOT toggle on/off, 옵션 패널 열고 닫기, sync 1회").

### 패키지 구조 & 단일 파일 유지 정책

- **모든 애플리케이션 코드는 `Source/main.py` 한 파일에 있다** (≈ 2,200줄).
  클래스 5개(`ProgressBar`, `FetchWorker`, `UpdateCheckWorker`, `UpdateDownloadWorker`, `ClaudeWidget`) 모두 이 파일에 정의되어 있다. 탐색 시 하나의 논리 단위로 다룬다 (라인 범위 로드맵은 `PROJECT_NOTES.md` 참고 — 이 문서는 gitignore되어 있음).
- **유지 정책:** 신규 코드는 기본적으로 `Source/main.py` 안에 추가한다. 새 모듈/패키지를 만들지 않는다. 1인 개발 흐름에서 vibe-coded 컨텍스트를 유지하기 위함.
- **분할을 *제안*하고 사용자 결정을 받아야 하는 트리거** (이 중 하나라도 만족 시):
  - `main.py`가 **4,000줄을 초과**
  - 외부에서 `import` 해 재사용해야 하는 코드가 새로 등장
  - 새 클래스가 기존 클래스/함수와 import 의존성이 전혀 없는 독립 모듈
  - 트리거 미충족 시에는 임의로 분할하지 않는다.

### Python 스타일

- 베이스: **PEP 8** + **기존 `main.py` 스타일에 일치** (Karpathy §3 "Match existing style").
- 들여쓰기: 4-space (기존 파일 일관).
- 라인 길이: **100자 권장** (강제 X). 영문 주석/긴 URL 등 자연스럽게 길어지는 라인은 OK.
- 따옴표: 기존 파일의 혼합 사용 패턴을 그대로 둔다 — 일괄 변환 금지.
- 타입 힌트: **권장(강제 X)**. 새 함수 시그니처와 클래스 변수 선언에는 가능하면 추가한다 (예: `self._worker: FetchWorker | None = None` 패턴 유지).
- 주석: 기본은 작성하지 않는다. *왜 이렇게 했는지*가 비자명한 경우(숨은 제약, 과거 버그 우회, Windows API 동작 차이 등)에만 짧게 추가한다.
- 포매터/린터: 별도 강제 없음. `black` / `ruff` 같은 자동 포매터를 *기존 코드 전체에* 돌리지 말 것 (대량 diff 발생 → Karpathy §3 위반).

### 릴리즈 정책 — 두 레포 미러링

**모든 GitHub 릴리즈는 두 레포 양쪽에 동일한 태그·노트·`.exe` 자산으로 발행한다.**

| 레포 | 역할 |
|---|---|
| `gnoeynij/Claude-Usage-Widget` (private, 메인) | 소스 커밋·태그·릴리즈 노트 보관용 |
| `gnoeynij/Claude-Widget-Releases` (public) | 위젯 자동 업데이트 기능이 익명 호출하는 엔드포인트 (`RELEASES_API_URL` 상수가 가리킴) |

**표준 발행 시퀀스**:
```bash
# 1. 메인 레포에 코드 변경 커밋·태그·푸시
git push && git push origin vX.Y.Z

# 2. 메인 레포 릴리즈 (보관용)
gh release create vX.Y.Z --repo gnoeynij/Claude-Usage-Widget \
  --title "..." --notes "..." Release/Claude-Widget.exe

# 3. public 레포 릴리즈 (자동 업데이트 엔드포인트) — 동일 인자 미러
gh release create vX.Y.Z --repo gnoeynij/Claude-Widget-Releases \
  --title "..." --notes "..." Release/Claude-Widget.exe
```

**둘 중 하나만 누락되면 안 된다.**
- public 누락 → 사용자 위젯의 `Check for Updates`가 옛 버전을 보게 됨 (사실상 업데이트 차단).
- 메인 누락 → 소스 커밋과 릴리즈 노트 매칭 단절.

> 자동 업데이트가 public 레포 분리 구조인 이유: 메인 레포가 private이므로 익명 GitHub Releases API 호출이 404를 받는다. 토큰을 .exe에 임베드하는 방식은 PyInstaller 분해(`pyinstxtractor` + `decompyle3`)로 거의 원본 복원이 가능해 보안적 의미가 없다.
