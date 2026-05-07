"""
Claude Usage Monitor — 공유 모듈
================================
두 위젯 entry point(`main.py`, `main_next.py`)가 함께 쓰는 코드.

**왜 분리:** 같은 OAuth 토큰 / requests.Session / 워커 클래스를 두 위젯이
재사용해야 한다. CLAUDE.md "단일 main.py" 정책의 분할 트리거(*"외부에서
import해 재사용해야 하는 코드가 새로 등장"*)가 발동되어 추출.

**포함:**
1) 모듈 상수 (USAGE_URL, RELEASES_API_URL)
2) 전역 SESSION (requests.Session)
3) FetchWorker — 사용량 API 호출 워커
4) UpdateCheckWorker / UpdateDownloadWorker — GitHub Releases 자동 업데이트

**미포함 (의도적):**
- ProgressBar, ClaudeWidget — 기존 UI는 main.py에 그대로
- 신규 디자인 위젯 — main_next.py가 직접 작성
- JSONL 파서 / 가격표 — 별도 _jsonl.py / _pricing.py 파일로 분리 예정
"""

from __future__ import annotations
import os
import json
import math
from pathlib import Path
from datetime import datetime, timezone

import requests
from PyQt6.QtCore import QThread, pyqtSignal


# ── 상수 ────────────────────────────────────────────────────
USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
# GitHub Releases API — used as the auto-update backend (no separate server).
# Anonymous calls require this repo to be public; while the repo is private,
# the call returns 404 and the startup check stays silent, the manual button
# shows "확인 실패: HTTP 404". Both behaviors are intentional fallbacks.
RELEASES_API_URL = "https://api.github.com/repos/gnoeynij/Claude-Usage-Widget/releases/latest"

# 두 위젯이 공유하는 단일 HTTP 세션 — connection pool 재사용으로 latency 최소화.
SESSION = requests.Session()


# ════════════════════════════════════════════════════════════
#  Background fetch worker
# ════════════════════════════════════════════════════════════
class FetchWorker(QThread):
    """Anthropic OAuth 사용량 API를 호출하는 백그라운드 워커.

    UI 스레드를 막지 않기 위해 QThread로 분리. ~/.claude/.credentials.json
    에서 OAuth 액세스 토큰을 읽어 GET 요청을 보내고, 응답을 가공한 dict
    하나를 result 시그널로 UI 스레드에 전달한다. 에러는 예외를 던지지 않고
    {"error": "..."} 형태로 같은 시그널에 실어 보낸다 — 호출자는 한 곳에서
    정상/에러 분기를 할 수 있다.
    """
    result = pyqtSignal(dict)

    @staticmethod
    def read_credentials() -> dict | None:
        p = Path.home() / ".claude" / ".credentials.json"
        try:
            raw = json.loads(p.read_text("utf-8"))
            oauth = raw.get("claudeAiOauth")
            return oauth if (oauth and oauth.get("accessToken")) else None
        except Exception:
            return None

    def run(self):
        self.result.emit(self._fetch())

    def _fetch(self) -> dict:
        creds = self.read_credentials()
        if not creds:
            return {"error": "NO_CREDENTIALS"}

        headers = {
            "Authorization": f"Bearer {creds['accessToken']}",
            "anthropic-beta": "oauth-2025-04-20",
            "Accept": "application/json",
        }
        try:
            resp = SESSION.get(USAGE_URL, headers=headers, timeout=15)
        except Exception as e:
            return {"error": str(e)[:60]}

        if resp.status_code in (401, 403):
            return {"error": "TOKEN_EXPIRED"}
        if resp.status_code == 429:
            return {"error": "RATE_LIMITED"}
        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}"}

        try:
            j = resp.json()
        except Exception:
            return {"error": "JSON_PARSE_ERROR"}

        five_h   = j.get("five_hour",        {})
        seven_d  = j.get("seven_day",         {})
        seven_s  = j.get("seven_day_sonnet",  {})
        extra    = j.get("extra_usage",       {})

        session_reset_secs = 0
        if five_h.get("resets_at"):
            try:
                dt   = datetime.fromisoformat(five_h["resets_at"].replace("Z", "+00:00"))
                diff = (dt - datetime.now(timezone.utc)).total_seconds()
                session_reset_secs = max(0, math.floor(diff))
            except Exception:
                pass

        # Weekly reset: emit raw components so the UI thread can localize.
        weekly_reset = None
        if seven_d.get("resets_at"):
            try:
                rd  = datetime.fromisoformat(seven_d["resets_at"].replace("Z", "+00:00"))
                loc = rd.astimezone()
                weekly_reset = (loc.weekday(), loc.hour, loc.minute)
            except Exception:
                pass

        def pct(d): return float(d.get("utilization") or 0)

        return {
            "isConnected":             True,
            "sessionUsagePercent":     pct(five_h),
            "sessionResetSeconds":     session_reset_secs,
            "weeklyAllModelsPercent":  pct(seven_d),
            "weeklyAllModelsReset":    weekly_reset,
            "weeklySonnetPercent":     pct(seven_s),
            "planName": "Max (Extra)" if extra.get("is_enabled") else "Max",
        }


# ════════════════════════════════════════════════════════════
#  Update workers — GitHub Releases API as auto-update backend
# ════════════════════════════════════════════════════════════
class UpdateCheckWorker(QThread):
    """GitHub Releases API에서 최신 릴리즈 정보를 조회하는 워커.

    익명 호출이므로 레포가 public이어야 200을 받을 수 있다. private이면 404.
    GitHub의 익명 Rate Limit은 IP당 시간당 60회 — 시작 시 1회 + 사용자 클릭
    체크 정도로는 절대 부족하지 않음.
    """
    finished_with = pyqtSignal(dict)

    def run(self):
        try:
            resp = SESSION.get(
                RELEASES_API_URL, timeout=10,
                headers={"Accept": "application/vnd.github+json"},
            )
        except Exception as e:
            self.finished_with.emit({"error": str(e)[:80]})
            return
        if resp.status_code != 200:
            self.finished_with.emit({"error": f"HTTP {resp.status_code}"})
            return
        try:
            j = resp.json()
        except Exception:
            self.finished_with.emit({"error": "JSON_PARSE_ERROR"})
            return
        tag = j.get("tag_name", "") or ""
        # Pick the first .exe asset — releases are produced by our gh release script.
        exe_url = ""
        exe_name = "Claude-Widget.exe"
        for a in j.get("assets", []) or []:
            name = (a.get("name") or "")
            if name.lower().endswith(".exe"):
                exe_url = a.get("browser_download_url") or ""
                exe_name = name or exe_name
                break
        self.finished_with.emit({"latest": tag, "url": exe_url, "name": exe_name})


class UpdateDownloadWorker(QThread):
    """새 버전 .exe를 사용자 Downloads 폴더로 스트리밍 다운로드하는 워커.

    핵심 디자인:
    - 진행률(0~100)은 progress 시그널로 매 청크마다 송출 → UI는 ProgressDialog로 표시
    - 사용자가 다이얼로그에서 취소를 누르면 cancel() → 다음 청크 전에 멈추고 .part 파일 삭제
    - 다운로드는 <dest>.part 임시 파일에 쓰고, 완료 후에만 정식 파일명으로 rename
      (atomic rename) — 중간에 끊겨도 Downloads 폴더에 깨진 파일이 남지 않음
    """
    progress = pyqtSignal(int)
    finished_with = pyqtSignal(dict)

    def __init__(self, url: str, dest_path: str, parent=None):
        super().__init__(parent)
        self._url = url
        self._dest = dest_path
        self._cancel = False

    def cancel(self):
        self._cancel = True

    def run(self):
        tmp = self._dest + ".part"
        try:
            with SESSION.get(self._url, stream=True, timeout=30, allow_redirects=True) as r:
                if r.status_code != 200:
                    self.finished_with.emit({"error": f"HTTP {r.status_code}"})
                    return
                total = int(r.headers.get("Content-Length") or 0)
                got = 0
                last_pct = -1
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(chunk_size=64 * 1024):
                        if self._cancel:
                            try: os.remove(tmp)
                            except Exception: pass
                            self.finished_with.emit({"error": "CANCELLED"})
                            return
                        if not chunk:
                            continue
                        f.write(chunk)
                        got += len(chunk)
                        if total:
                            pct = int(got * 100 / total)
                            if pct != last_pct:
                                self.progress.emit(pct)
                                last_pct = pct
            if os.path.exists(self._dest):
                os.remove(self._dest)
            os.rename(tmp, self._dest)
            self.finished_with.emit({"path": self._dest})
        except Exception as e:
            try: os.remove(tmp)
            except Exception: pass
            self.finished_with.emit({"error": str(e)[:80]})


# ════════════════════════════════════════════════════════════
#  Local usage logs — Claude Code JSONL parser
# ════════════════════════════════════════════════════════════
# Claude Code는 사용 기록을 ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
# 에 라인당 한 이벤트씩 append-only로 남긴다. 각 assistant 메시지 라인에는
# model, usage.{input_tokens, output_tokens, cache_creation_input_tokens,
# cache_read_input_tokens}, timestamp, cwd, gitBranch가 들어있어 — Anthropic
# 공개 API가 주지 않는 풍부한 정보(모델별, 시계열, 프로젝트별, 정확한 토큰 수)
# 를 모두 로컬에서 정확히 산출할 수 있다. ccusage 등이 사용하는 방식.

CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"


# 모델별 단가 — USD per million tokens.
# 공식 가격: https://www.anthropic.com/pricing  (구현 시 실값 재검증 필요)
# 키는 jsonl `model` 필드 값과 정확히 매치 (예: "claude-opus-4-7").
# 누락된 모델은 cost 계산 시 0 반환 + 호출 측에서 "단가 미상" 처리.
PRICING_USD_PER_MTOK: dict[str, dict[str, float]] = {
    # Claude 4 family (현행)
    "claude-opus-4-7":         {"input": 15.0, "output": 75.0, "cache_write_5m": 18.75, "cache_write_1h": 30.0, "cache_read": 1.5},
    "claude-opus-4-6":         {"input": 15.0, "output": 75.0, "cache_write_5m": 18.75, "cache_write_1h": 30.0, "cache_read": 1.5},
    "claude-opus-4-5":         {"input": 15.0, "output": 75.0, "cache_write_5m": 18.75, "cache_write_1h": 30.0, "cache_read": 1.5},
    "claude-sonnet-4-6":       {"input":  3.0, "output": 15.0, "cache_write_5m":  3.75, "cache_write_1h":  6.0, "cache_read": 0.3},
    "claude-sonnet-4-5":       {"input":  3.0, "output": 15.0, "cache_write_5m":  3.75, "cache_write_1h":  6.0, "cache_read": 0.3},
    "claude-haiku-4-5":        {"input":  1.0, "output":  5.0, "cache_write_5m":  1.25, "cache_write_1h":  2.0, "cache_read": 0.1},
    # Claude 3.x family (구버전 — 과거 세션이 jsonl에 남아있을 수 있음)
    "claude-3-7-sonnet-latest": {"input": 3.0, "output": 15.0, "cache_write_5m":  3.75, "cache_write_1h":  6.0, "cache_read": 0.3},
    "claude-3-5-sonnet-latest": {"input": 3.0, "output": 15.0, "cache_write_5m":  3.75, "cache_write_1h":  6.0, "cache_read": 0.3},
    "claude-3-5-haiku-latest":  {"input": 0.8, "output":  4.0, "cache_write_5m":  1.0,  "cache_write_1h":  1.6, "cache_read": 0.08},
}


def _resolve_pricing(model: str) -> dict[str, float] | None:
    """모델 ID → 단가 dict 찾기. 정확 매치 실패 시 prefix 매치 fallback.

    이유: jsonl에 기록되는 모델 ID에 종종 날짜 suffix가 붙는다
    (예: "claude-haiku-4-5-20251001"). 가격표는 base 이름("claude-haiku-4-5")
    으로 두고 — suffix가 붙은 변형은 prefix 매치로 수용.
    """
    p = PRICING_USD_PER_MTOK.get(model)
    if p:
        return p
    for base, pricing in PRICING_USD_PER_MTOK.items():
        if model.startswith(base):
            return pricing
    return None


def cost_usd(model: str, usage: dict) -> float:
    """단일 assistant 메시지의 USD 비용. 가격표에 없는 모델은 0.

    cache_creation 토큰은 5m write 단가 기준 (1h vs 5m 구분 정밀화는 향후 옵션).
    """
    p = _resolve_pricing(model)
    if not p:
        return 0.0
    input_t  = usage.get("input_tokens", 0) or 0
    output_t = usage.get("output_tokens", 0) or 0
    cwrite   = usage.get("cache_creation_input_tokens", 0) or 0
    cread    = usage.get("cache_read_input_tokens", 0) or 0
    return (
        input_t  * p["input"]          / 1_000_000
        + output_t * p["output"]         / 1_000_000
        + cwrite   * p["cache_write_5m"] / 1_000_000
        + cread    * p["cache_read"]     / 1_000_000
    )


SESSION_BLOCK_HOURS = 5  # Claude Code 세션 한도 윈도우


def _parse_iso(ts: str) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def group_into_blocks(records: list[dict]) -> list[dict]:
    """시간순 정렬된 records를 5시간 블록으로 묶는다.

    한 블록의 정의: 첫 record의 시각을 기준으로 +5h 윈도우. 그 안의 모든
    record가 같은 블록. 윈도우 밖의 첫 record가 새 블록을 시작.
    이는 ccusage 등이 사용하는 단순 근사 — 실제 Claude 세션 윈도우와
    완벽히 일치하지는 않지만, "작업 흐름 단위"를 시각적으로 잡기에 충분.

    각 반환 블록 (dict):
      start_dt:  datetime (UTC)
      end_dt:    datetime — 마지막 record의 시각 (윈도우 끝 아님)
      records:   list[dict]
      cost_usd:  float — 블록 내 총 USD
      total_tokens: int — input + output + cache_creation + cache_read
      by_model:  dict[str, {"cost": float, "tokens": int}]
    """
    blocks: list[dict] = []
    if not records:
        return blocks

    records_sorted = sorted(records, key=lambda r: r.get("timestamp") or "")
    cur: dict | None = None

    for r in records_sorted:
        ts = _parse_iso(r.get("timestamp") or "")
        if ts is None:
            continue
        if cur is None or (ts - cur["start_dt"]).total_seconds() > SESSION_BLOCK_HOURS * 3600:
            cur = {
                "start_dt": ts,
                "end_dt": ts,
                "records": [],
                "cost_usd": 0.0,
                "total_tokens": 0,
                "by_model": {},
            }
            blocks.append(cur)
        cur["records"].append(r)
        cur["end_dt"] = ts
        c = cost_usd(r["model"], r["usage"])
        cur["cost_usd"] += c
        u = r["usage"]
        toks = (
            (u.get("input_tokens") or 0)
            + (u.get("output_tokens") or 0)
            + (u.get("cache_creation_input_tokens") or 0)
            + (u.get("cache_read_input_tokens") or 0)
        )
        cur["total_tokens"] += toks
        m = r["model"]
        if m not in cur["by_model"]:
            cur["by_model"][m] = {"cost": 0.0, "tokens": 0}
        cur["by_model"][m]["cost"] += c
        cur["by_model"][m]["tokens"] += toks

    return blocks


def find_active_block(blocks: list[dict], now: datetime | None = None) -> dict | None:
    """현재 활성 블록 = 마지막 블록의 start_dt + 5h가 아직 미래라면 그 블록.

    None이면 활성 세션 없음. now는 테스트용 주입 (기본: 현재 UTC).
    """
    if not blocks:
        return None
    last = blocks[-1]
    if now is None:
        now = datetime.now(timezone.utc)
    if (now - last["start_dt"]).total_seconds() < SESSION_BLOCK_HOURS * 3600:
        return last
    return None


def iter_usage_records(root: Path = CLAUDE_PROJECTS_DIR):
    """~/.claude/projects/ 하위 모든 *.jsonl을 walk하며 assistant 사용 record yield.

    각 yield 항목 (dict):
      timestamp:  str (ISO 8601, UTC) — jsonl line의 timestamp
      model:      str — "claude-opus-4-7" 등
      cwd:        str — 작업 디렉토리 절대 경로
      gitBranch:  str | "" — 있으면 브랜치명
      sessionId:  str — 세션 UUID
      usage:      dict — 원본 usage 객체 (토큰 분해 포함)

    `message.role == "assistant"` && `usage` 존재인 라인만 통과.
    파일/라인 단위 에러는 silent skip — 일부 jsonl이 손상돼도 전체가 죽지 않게.

    서브에이전트 jsonl(`subagents/agent-*.jsonl`)도 함께 walk됨. ccusage 대조
    검증 시 중복 집계 여부 확인 후 필터링 정책 결정 (1차: 다 합산).
    """
    if not root.exists():
        return
    for jsonl_path in root.rglob("*.jsonl"):
        try:
            with open(jsonl_path, "r", encoding="utf-8", errors="replace") as f:
                for raw_line in f:
                    raw_line = raw_line.strip()
                    if not raw_line:
                        continue
                    try:
                        rec = json.loads(raw_line)
                    except Exception:
                        continue
                    msg = rec.get("message")
                    if not isinstance(msg, dict):
                        continue
                    if msg.get("role") != "assistant":
                        continue
                    usage = msg.get("usage")
                    if not isinstance(usage, dict):
                        continue
                    yield {
                        "timestamp": rec.get("timestamp", ""),
                        "model":     msg.get("model", ""),
                        "cwd":       rec.get("cwd", ""),
                        "gitBranch": rec.get("gitBranch", "") or "",
                        "sessionId": rec.get("sessionId", ""),
                        "usage":     usage,
                    }
        except Exception:
            # 파일 자체 read 실패 — skip하고 다음 파일로
            continue

