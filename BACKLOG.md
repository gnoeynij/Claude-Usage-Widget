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
| **OAuth 토큰 만료 회복 (A+D)** | UX | [docs/plans/2026-05-20-oauth-refresh.md](docs/plans/2026-05-20-oauth-refresh.md), [usage_api.rs:81-110](src-tauri/src/usage_api.rs) | 정밀 검토 결과 근본 원인은 `syncIntervalMin: 0` 디폴트로 auto-sync OFF. **A+D 결합 권장** (~70-100 LOC·1.5-2h·위험 낮음): error code 분기 + 만료 banner + auto-sync 5분 default + `.credentials.json` mtime polling. 인증 영역 안 건드림. |
| ~~OAuth 직접 refresh (B)~~ → P1 격하 | UX·인증 | 같은 plan §"B 격하 근거" | Anthropic spec 미공개·cred 파일 race·client_id 폐기 위험. A+D로 80% 효과 달성 시 미진행. **always-spot-check** (진행 결정 시) |

---

## P1 — 알파 마감 청소

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| **버전 단일 출처 헬퍼** | 인프라 | [회귀 사례 §3](CLAUDE.md) | `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src/state/store.ts` 5곳 동시 bump. `scripts/bump-version.mjs` 또는 README 체크리스트 중 택1. 4aa3443에서 한 번 손으로 정렬 — 다음 bump 전엔 자동화. |
| **`pricing.rs:9` `cache_write_1h` dead field 정리** | 코드 위생 | [src-tauri/src/pricing.rs:9](src-tauri/src/pricing.rs:9) | `Pricing` 구조체의 미사용 필드. `cargo build` 경고 1건. 실제 비용 계산에 사용될 예정이면 `#[allow(dead_code)]` + 주석, 아니면 삭제. |
| **CLAUDE.md "사전 요구"에 `link.exe` 충돌 메모 추가** | 문서 | [회귀 사례 §1](CLAUDE.md) | MSVC `link.exe` 가 PATH 우선이 아니거나 vcvars64.bat 미소싱 시 GNU `link.exe`(Git for Windows)가 호출되어 misleading 에러. 새 머신 첫 빌드 함정. |
| **빌드 산출물 이름 vs `productName` 불일치** | 문서·인프라 | [회귀 사례 부산물](CLAUDE.md) | `tauri.conf.json` `productName` 은 "Claude Widget"이지만 빌드 산출물은 `claude-widget.exe` (Cargo `[package] name`). CLAUDE.md "산출물" / "빌드 후 동작 워크플로" 항목에 *Claude Widget.exe* 라고 적혀있어 실제와 어긋남. 문서 갱신 또는 conf 양쪽 정렬. |

---

## P2 — 베타 무렵 검토

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| **자동화 테스트 도입 검토** | 인프라·품질 | [CLAUDE.md "테스트 프레임워크"](CLAUDE.md) | 현재 0%. 후보: (a) Rust 단위 테스트 — `jsonl_aggregator`·`pricing`·`migration`이 순수 함수 비중 커서 ROI 높음. (b) Vitest — `src/state/store.ts` Solid 신호 로직. (c) Playwright — Tauri WebView 한정이라 dev URL에서만, 실 .exe 시각 회귀는 여전히 `capture-widget.ps1` 의존. 1인 사이드 프로젝트 ROI 고려해 (a)부터. |
| **Win10 호환 검증** | 시각 회귀 | [vibrancy_win.rs](src-tauri/src/vibrancy_win.rs) | Mica/Acrylic은 Win11 전제. Win10에서 fallback이 정상인지 실 머신 확인 필요. |
| **모바일 외 OS 지원** | 인프라 | (없음) | macOS·Linux는 Tauri 2가 지원하나 OAuth 사용량 API + `.credentials.json` 경로·vibrancy_win 분기·NSIS만 빌드 등 다수 작업 필요. 수요 신호 있을 때만. |

---

## P3 — 미세 후보 / 출시 후

| 항목 | 영역 | 출처 | 비고 |
|---|---|---|---|
| **다크/라이트 토큰 분리 강화** | 디자인 | [src/styles/tokens.css](src/styles/tokens.css) | 현재 라이트·다크 별도 토큰. 시스템 테마 변경 watcher가 즉시 반영되는지 확인. |
| **메인 → 워크트리 동기화 헬퍼** | 인프라 | [회귀 사례 §5](CLAUDE.md) | 워크트리 fast-forward 자동화 (현재 양쪽 수동). |

---

## ✓ 완료 (기록용)

| 항목 | commit | 완료일 |
|---|---|---|
| v2.0.0-alpha — Tauri 2 + Liquid Glass 재작성 | `7d66dd4` | 2026-05-19 |
| v2.0.0-alpha.1 — 버전 5곳 정렬 + `Source/` 레거시 제거 | `4aa3443` | 2026-05-19 |
| 하네스 setup (CLAUDE.md 7개 섹션 + BACKLOG + docs/sessions) — 현재진행 스냅샷·UI SOP·회귀 사례·검토 워크플로·Session handover·출력 규약·페르소나 자동 detect | `5250c8a` | 2026-05-19 |
| 자동 업데이트 매니페스트 (`latest.json`) 빌드 활성 — signing key 발급·`createUpdaterArtifacts: true`·`scripts/make-updater-manifest.mjs`·.gitignore signing key 패턴 | (진행 중) | 2026-05-20 |

---

## stale 의심 / 재평가 후보

(현재 없음)
