# OAuth 토큰 만료 — 위젯 회복 전략 (BACKLOG P0-2)

> **상태**: A+D 구현 완료 (v2.0.0) → **C-변형 (CLI spawn 트리거) 구현 완료 (2026-07-03)**.
> 아래 "4 옵션 비교"는 당시 기록. 최신 실측·구현 내용은 문서 하단
> **"2026-07-03 부록"** 참조.
> **트리거**: 2026-05-19 사용자 "위젯 왜 연결 안돼?" 신호 (`.credentials.json` 65시간 전 만료, 위젯은 silent 상태).
> **작성**: 2026-05-20 (다른 PC 이어 작업용 컨텍스트 보존).

## 근본 원인 — 토큰 만료 자체가 아니라 위젯의 silence

[src/state/store.ts:83](../../src/state/store.ts) `syncIntervalMin: 0` 디폴트.
[store.ts:213](../../src/state/store.ts) `if (m > 0)` 분기로 **auto-sync setInterval 자체가 비활성**. 사용자가 설정에서 켜지 않는 한 위젯은 토큰 만료 후 *영원히 stale*. 새로고침 버튼을 안 누르면 회복할 길 없음.

UI 표시도 빈약 — [HeaderBar.tsx:11,22](../../src/views/HeaderBar.tsx) 가 빨간 점 + `t().syncFailed` 만 보여줌. error 종류 분기 없음 ([store.ts:138](../../src/state/store.ts) `syncError: String(e)`).

## 4 옵션 비교

| 옵션 | 무엇 | LOC | 시간 | 위험 | 효과 |
|---|---|---|---|---|---|
| **A** UI 안내 | error code 분기 + 만료 메시지 banner | 30~50 | 30분~1h | 낮음 | 사용자 인지·조치 수동 |
| **B** 직접 refresh | Anthropic OAuth endpoint 호출·`.credentials.json` 쓰기 | 150~250 | 4~6h | **높음** (spec 미검증·cred 파일 race·잘못된 client_id 시 토큰 폐기·Claude Code 동시 사망) | 완전 자동 |
| **C** Claude CLI spawn | child process 로 silent refresh trigger | 50~80 | 2~3h | 중간 (CLI 동작 미검증·terminal 의존) | B의 80% |
| **D** mtime polling | `.credentials.json` 변화 감지 시 자동 재시도 | 40~60 | 1~2h | 낮음 (read-only) | claude 실행 후 자동 복구 |

## 권장 — **A + D 결합 + auto-sync default 활성**

총 ~70~100 LOC, 1.5~2h, 위험 낮음. 어제 시나리오를 정확히 깬다 — 사용자가 위젯 보면 *원인 즉시 인지* → `claude` 한 번 실행 → 1분 내 위젯이 새 토큰 자동 감지 → 복구.

### 구현 단계

1. **`usage_api.rs`**: 현재 `Err(anyhow!("TOKEN_EXPIRED"))` 그대로 유지 (이미 작동). 추가 변경 0.
2. **`store.ts`**:
   - `syncIntervalMin: 0` → `5` 디폴트 (설정에서 0으로 끌 수 있게 유지)
   - `errorCode: "TOKEN_EXPIRED" | "NO_CREDENTIALS" | "RATE_LIMITED" | "NETWORK" | null` 파생 store 필드 추가
   - `syncNow()` catch 분기에서 `String(e)` 파싱해 `errorCode` 채움
3. **mtime polling**: `~/.claude/.credentials.json` mtime을 1분 간격으로 read. 변화 감지 시 즉시 `syncNow()` trigger.
   - 옵션 1: Rust `#[tauri::command]` `credentials_mtime()` 추가 → frontend 폴링
   - 옵션 2: Rust 측 background task로 watch → `emit` 이벤트 → frontend listen
   - 권장: 옵션 1 (단순)
4. **Banner 컴포넌트**: `errorCode === "TOKEN_EXPIRED"` 시 hero 위에 "토큰 만료 — `claude` CLI 실행 시 자동 복구" (i18n ko/en). 기타 errorCode는 기존 빨간 점만 유지.
5. **i18n**: `tokenExpired`·`tokenExpiredHint` 키 추가 (ko/en).

### 검증

- 빌드 exit 0 + capture-widget.ps1 캡처 (banner 시각 확인)
- 토큰 만료 시나리오 수동 재현 — `.credentials.json` `expiresAt` 을 과거로 임시 수정 후 위젯 동작 확인
- `claude` CLI 실행 → 1분 내 자동 회복 확인

## B 격하 근거 (P1 후보로)

- Anthropic OAuth refresh endpoint·client_id·payload **공개 spec 없음**. Claude Code CLI 자체 closed source. 추정·reverse engineer 의존.
- `.credentials.json` 을 위젯이 쓰는 순간 Claude CLI 와 race condition. atomic write·file lock 필요.
- 잘못된 client_id 사용 시 Anthropic 이 *전체 토큰 폐기* → 위젯이 Claude Code 자체를 죽임.
- 진짜 자동 refresh 필요한 시점 = 사용자가 Claude Code 며칠간 안 쓸 때. 그 사용자는 위젯도 거의 안 봄. 가치 vs 비용 균형 불리.
- B 진행 결정 시 Plan agent 위임 권장: (1) OAuth refresh spec 검색 (2) reverse engineer 결과 (3) atomic write 패턴 plan.

## Always-spot-check 영역

본 작업 자체는 **인증 영역 안 건드림** (A+D 권장안 한정). 단:
- `.credentials.json` *읽기* 만 — 기존 `usage_api.rs` 패턴 동일
- mtime 만 polling — 파일 내용 노출 X
- 인증 토큰을 위젯 메모리에 신규로 저장하지 않음

B 로 진행 시점부터는 **always-spot-check** (`usage_api.rs` 변경·`.credentials.json` 쓰기·OAuth endpoint 호출).

## 다른 PC 시작 메시지 예시

> "Claude Usage Widget BACKLOG P0-2 진행. plan: docs/plans/2026-05-20-oauth-refresh.md A+D 권장안 구현."

---

## 2026-07-03 부록 — CLI spawn 트리거 실측·구현 (옵션 C 변형)

실제 `.credentials.json` `expiresAt` 백데이트 실험으로 Claude Code CLI 의
refresh 동작을 실측한 결과와, 그에 따라 구현한 자동 갱신 흐름.

### 실측 결과 (2026-07-03, Claude Code 2.1.195)

| 명령 | 만료 토큰 조용히 refresh? | 비고 |
|---|---|---|
| `claude auth status --json` | ❌ | 로컬 파일만 읽음. 만료 토큰에도 `loggedIn: true` — **만료 감지 용도로도 못 씀** |
| `claude -p "ok" --model haiku` | ✅ (refresh token 유효 시) | **유일하게 검증된 트리거.** 중립 cwd + `--tools ""` + `--no-session-persistence` 조합 실측 $0.015/회, ~2초 |
| `claude auth login` | ❌ — 저장된 자격증명 **즉시 wipe** 후 브라우저 OAuth 시작 | 중간 이탈 시 로그아웃 상태로 남음. **자동 호출 절대 금지**, 사용자 클릭 뒤에만 |

### 핵심 발견 — rotating refresh token (회귀 사례 §21)

- Anthropic refresh token 은 **회전식**: refresh 성공 시 새 refresh token 발급,
  구 토큰 재사용 시 서버가 **토큰 체인 전체 폐기** (아직 유효하던 access token 포함).
- 실험 중 "백업 복원" (구 refresh token 을 파일에 되돌림) 이 체인을 오염시켜
  실제 로그아웃 사고 발생 → 사용자 재로그인 1회로 복구.
- **교훈: `.credentials.json` 백업·복원 절대 금지.** 위젯은 영원히 read-only
  (기존 정책 그대로) + refresh 는 CLI 에 위임.

### 구현 (2026-07-03)

- `commands.rs` `trigger_token_refresh`: `claude -p ok --model haiku
  --no-session-persistence --tools "" --max-budget-usd 0.25` 를 임시 디렉토리
  cwd 로 spawn (CREATE_NO_WINDOW, 60s 타임아웃 kill). `--no-session-persistence`
  가 JSONL 전사 생성을 막아 위젯 비용 집계 오염 없음 (실측 확인 — 빈 memory
  디렉토리만 생성).
- `commands.rs` `open_login_terminal`: 보이는 터미널로 `claude auth login` 실행
  (Windows `cmd /c start`, macOS `osascript` Terminal — macOS 미실측).
- `store.ts`: `syncNow` catch 에서 `TOKEN_EXPIRED` → `maybeSpawnTokenRefresh()`.
  도넛 클릭·auto-sync 모두 `syncNow` 경유라 훅 하나로 커버. spawn 완료 후
  `syncNow` 재호출로 수렴.
- `ErrorBanner`: `NO_CREDENTIALS` 배너에 "로그인 열기" 버튼 (`pointer-events:
  auto` + `.no-drag`), 실패 시 toast. 상태기계 수렴: 죽은 refresh token 으로
  spawn → CLI 가 wipe → 다음 sync `NO_CREDENTIALS` → 로그인 버튼으로 자연 전환.

### 비용 가드 설계 (2026-07-03 코드리뷰 반영 — 초기 "10분 쿨다운+성공 시 리셋" 안 폐기)

초기 설계 (rolling 10분 쿨다운, sync 성공 시 0 리셋) 는 코드리뷰에서 두 가지
치명 결함 확인: (a) *수렴 불가 상태* — 지속 403 (usage_api 가 TOKEN_EXPIRED 로
매핑) 또는 사용자가 `ANTHROPIC_API_KEY` 를 설정해 spawn 된 CLI 가 OAuth 를 안
건드리고 성공하는 경우, creds 가 안 지워져 NO_CREDENTIALS 수렴이 영영 없음 →
10분마다 유료 spawn 무한 반복 (~$2.16/일). (b) 성공 시 0 리셋이 flap 에서
재무장 + 위젯 재시작 시 모듈 변수 소실 → 실행 중인 CLI 와 두 번째 spawn 이
같은 1회용 rotating token 을 경쟁 (§21 체인 폐기 재현 벡터).

**최종 가드 3중**:
1. `spawnedThisEpisode` — 에피소드(sync 성공으로 errorCode 가 걷힐 때까지)당
   *CLI 실행 1회* 상한. CLI 가 돌았으면 (exit code 무관) 재시도 없음 — 수렴
   불가 상태에서도 과금 총량 = $0.015 × 1. invoke 자체가 reject 된 경우 (bin
   없음·spawn 실패 = CLI 미실행·과금 0) 만 플래그 해제해 수동 재시도 허용.
2. `lastRefreshSpawnAt` — 10분 hard floor, **성공 시에도 리셋 안 함** (flap
   재무장 차단) + **tauri-plugin-store 에 영속** (재시작 직후 부팅 sync 가
   실행 중일 수 있는 기존 CLI 와 경쟁하는 것 차단).
3. `refreshSpawnInFlight` — 동일 프로세스 내 동시 spawn 차단.

Rust 쪽은 kill-timeout 제거 (SIGKILL 이 서버측 토큰 회전 후·파일 쓰기 전에
떨어지면 소비된 토큰이 디스크에 남는 §21 벡터 + kill 후 미회수 좀비) — plain
`wait()` + stderr 캡처 (비정상 종료 시 로그로 진단 가능, 이전엔 완전 불가시).
