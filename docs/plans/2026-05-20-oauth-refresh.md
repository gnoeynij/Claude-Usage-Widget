# OAuth 토큰 만료 — 위젯 회복 전략 (BACKLOG P0-2)

> **상태**: 정밀 검토 완료·구현 미시작·사용자 결정 대기.
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
