# Claude Code 세션 기록

이 디렉터리는 Claude Usage Widget을 만들면서 Claude Code와 진행한 세션의 원본 transcript(`.jsonl`)를 보관합니다.

## 세션 목록

| 파일 | 날짜 | 범위 |
|---|---|---|
| (없음) | — | 하네스 도입 후 누적 시작 |

## 다른 PC에서 컨텍스트 이어가는 방법

### 권장 — `CLAUDE.md` + `BACKLOG.md` 활용
- [`CLAUDE.md`](../../CLAUDE.md) "현재 진행 스냅샷"이 버전·빌드·알려진 빈 구멍을 압축.
- [`BACKLOG.md`](../../BACKLOG.md) P0~P3 가 다음 작업 후보.

새 Claude Code 세션은 `CLAUDE.md`를 자동으로 읽어 컨텍스트를 잡습니다. 대부분 작업은 이걸로 충분.

### 정확한 과거 결정·논의가 필요할 때
이 폴더의 `.jsonl` 파일을 직접 검색하거나 Claude에 일부를 붙여넣어 활용. 한 줄 = 한 메시지(JSON 형식). 예:

```powershell
# 특정 키워드가 등장한 메시지 찾기
Select-String -Pattern "updater" docs/sessions/*.jsonl

# 사용자 메시지만 추출
Get-Content docs/sessions/*.jsonl | ConvertFrom-Json | Where-Object role -eq user | Select-Object -ExpandProperty content
```

## 새 세션을 추가할 때

향후 새 PC·새 세션의 transcript도 이 폴더에 누적해 두면 모든 결정 흐름 추적 가능:

```powershell
# Windows
Copy-Item "$env:USERPROFILE\.claude\projects\C--Users-cjy15-Desktop-Projects-Claude-Usage-Widget\<session-id>.jsonl" `
          "docs/sessions/$(Get-Date -Format 'yyyy-MM-dd')-<short-desc>.jsonl"
```

git에 commit하면 다른 PC에서도 동일 history.

## 주의

- `.jsonl` 파일은 도구 호출 결과·이미지 base64·환경 정보가 그대로 있어 사이즈 큼. 정기적으로 `.gitattributes`로 LFS 처리 검토 권장.
- `~/.claude/.credentials.json` 의 OAuth 토큰·refreshToken이 메시지 본문이나 도구 결과에 노출된 경우가 없는지 확인 후 커밋. 의심되면 해당 라인 redact 또는 세션 자체를 제외.
- 이 repo는 public이므로 비밀 정보 점검은 *커밋 전 의무*.
