import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WidgetChrome } from "../App";
import { setStore, applyDarkClass, type Mode } from "../state/store";
import { projectLimit, SESSION_WINDOW_MS } from "../utils/project";

// Standalone guide window. Renders the REAL widget (WidgetChrome) at its real
// per-mode size with a seeded store; a slider drives the usage level so the
// reader can scrub through every state (color levels, safe→risk). Callouts are
// positioned by measuring the live `data-guide` anchors, and some appear only
// in the matching state. Own webview = own store → lang/dark in memory only.

type Txt = { en: string; ko: string };
type Cond = "always" | "risk" | "safe";
type Callout = { anchor: string; side: "left" | "right"; y: number; cond?: Cond; title: Txt; desc: Txt };

let lang: "en" | "ko" = "en";
const tx = (t: Txt) => t[lang];

const HEAD: Txt = { en: "Widget guide", ko: "위젯 가이드" };
const SLIDER: Txt = { en: "Drag to change the usage level", ko: "사용량을 조절해 보세요" };
const TRAY_TITLE: Txt = { en: "System tray icon", ko: "시스템 트레이 아이콘" };
const TRAY_DESC: Txt = {
  en: "The widget keeps running in the tray when hidden. Right-click for Show / Quit. The icon color reflects sync status:",
  ko: "위젯을 숨겨도 트레이에 남아 동작합니다. 우클릭으로 표시/종료. 아이콘 색이 동기화 상태를 나타냅니다:",
};
const TRAY_OK: Txt = { en: "OK", ko: "정상" };
const TRAY_ERR: Txt = { en: "Error / expired", ko: "오류 · 만료" };
const MODES: { mode: Mode; label: Txt }[] = [
  { mode: "mini", label: { en: "Mini", ko: "미니" } },
  { mode: "normal", label: { en: "Normal", ko: "기본" } },
  { mode: "detail", label: { en: "Detail", ko: "상세" } },
];

const CALLOUTS: Record<Mode, Callout[]> = {
  normal: [
    { anchor: "status", side: "left", y: 96,
      title: { en: "Sync status", ko: "동기화 상태" },
      desc: { en: "Dot color shows how fresh the last sync is.", ko: "최근 동기화 상태를 점 색으로 표시." } },
    { anchor: "donut", side: "left", y: 180,
      title: { en: "Session usage (5h)", ko: "세션 사용량 (5시간)" },
      desc: { en: "Current use, colored by level. Click the donut to refresh now.", ko: "현재 사용량을 색으로(낮음·주의·높음). 도넛을 클릭하면 즉시 새로고침." } },
    { anchor: "session-caption", side: "left", y: 300, cond: "safe",
      title: { en: "Reset & projection", ko: "초기화 · 예상" },
      desc: { en: "Time to reset, plus where you'll be at reset at this pace.", ko: "초기화까지 시간 + 이 속도로 갈 때 초기화 시점 예상치." } },
    { anchor: "session-caption", side: "left", y: 300, cond: "risk",
      title: { en: "Limit warning", ko: "한도 도달 경고" },
      desc: { en: "On pace to run out — shows how long until you hit the limit.", ko: "이 속도면 부족 — 한도 도달까지 남은 시간을 경고." } },
    { anchor: "sync", side: "right", y: 96,
      title: { en: "Refresh", ko: "새로고침" },
      desc: { en: "Re-read your usage manually.", ko: "사용량을 수동으로 다시 불러옵니다." } },
    { anchor: "settings", side: "right", y: 156,
      title: { en: "Options", ko: "옵션" },
      desc: { en: "Language, theme, opacity, auto-sync, multi-device totals, updates, this guide.", ko: "언어·테마·투명도·자동 동기화·기기 통합·업데이트, 이 가이드." } },
    { anchor: "weekly", side: "right", y: 256,
      title: { en: "Weekly usage", ko: "주간 사용량" },
      desc: { en: "Resets every 7 days. All models · Sonnet (and Opus on some plans).", ko: "7일마다 초기화. 전체 모델·Sonnet (플랜에 따라 Opus)." } },
    { anchor: "modes", side: "right", y: 356,
      title: { en: "Mode switch", ko: "모드 전환" },
      desc: { en: "Mini · Normal · Detail.", ko: "미니·기본·상세." } },
    { anchor: "hide", side: "right", y: 416,
      title: { en: "Hide to tray", ko: "트레이로 숨기기" },
      desc: { en: "Closes the window but keeps running in the tray.", ko: "창을 닫아도 트레이에 남아 동작합니다." } },
  ],
  mini: [
    { anchor: "donut", side: "left", y: 150,
      title: { en: "Session usage", ko: "세션 사용량" },
      desc: { en: "Current use, always on top. Click the donut to refresh now.", ko: "현재 사용량을 항상 위에. 도넛을 클릭하면 즉시 새로고침." } },
    { anchor: "expand", side: "left", y: 270,
      title: { en: "Expand", ko: "기본 모드로" },
      desc: { en: "The handle (or double-click) expands to Normal mode.", ko: "아래 핸들(또는 더블클릭)로 기본 모드로 확장합니다." } },
    { anchor: "badge", side: "right", y: 120, cond: "risk",
      title: { en: "Warning mark", ko: "경고 표시" },
      desc: { en: "Appears only when on pace to hit a limit. Click for details.", ko: "한도에 도달할 추세일 때만 나타남. 클릭하면 상세 정보." } },
    { anchor: "weekly", side: "right", y: 240,
      title: { en: "Weekly usage", ko: "주간 사용량" },
      desc: { en: "All models · Sonnet, as compact bars.", ko: "전체 모델·Sonnet, 얇은 막대로." } },
  ],
  detail: [
    { anchor: "active", side: "left", y: 120,
      title: { en: "Active session", ko: "활성 세션" },
      desc: { en: "Current 5h block: spend · time left · spend per hour.", ko: "현재 5시간 블록의 비용·남은 시간·시간당 비용." } },
    { anchor: "chart", side: "left", y: 280,
      title: { en: "Daily cost trend", ko: "일별 비용 추세" },
      desc: { en: "7/14/30 days by model. Tap a day for its breakdown.", ko: "7/14/30일을 모델별로. 막대를 누르면 그날 내역." } },
    { anchor: "totals", side: "right", y: 360,
      title: { en: "Totals & lifetime", ko: "합계 · 누적" },
      desc: { en: "This week / month, lifetime spend, combined across devices.", ko: "이번 주·달, 누적 비용, 여러 기기 합산." } },
  ],
};

const MODE_SIZE: Record<Mode, [number, number]> = {
  mini: [240, 112],
  normal: [320, 360],
  detail: [592, 619],
};
const CANVAS_W = 1140;
const FRAME_CX = CANVAS_W / 2;
const FRAME_TOP = 92;

function nowPlus(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

// Session (5h) and weekly (7d) windows are seeded with the SAME elapsed
// fraction (0.7) so the slider drives a single coherent usage level — both
// project at the same multiplier instead of the weekly running far ahead.
const SESSION_RESET_MS = 1.5 * 3_600_000; // 5h window, 3.5h elapsed → 0.7
const WEEKLY_RESET_MS = 0.3 * 7 * 86_400_000; // 7d window, 0.7 elapsed

function setUsage(level: number) {
  setStore("usage", "five_hour", level);
  setStore("usage", "seven_day", level);
  setStore("usage", "seven_day_sonnet", Math.round(level * 0.3));
}

function seedStore() {
  setStore("lang", lang);
  setStore("usage", {
    five_hour: 40, seven_day: 40, seven_day_sonnet: 12,
    seven_day_opus: null, // match the common plan (no Opus-specific weekly row)
    session_resets_at: nowPlus(SESSION_RESET_MS),
    weekly_resets_at: nowPlus(WEEKLY_RESET_MS),
    extra_usage_enabled: false,
  } as never);
  setStore("plan", { subscription_type: "max", rate_limit_tier: null } as never);
  setStore("lastSyncAt", nowPlus(-60_000)); // recent → status dot reads "fresh"
  setStore("lifetimeCost", 4457.2);
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  const costs = [120, 266, 90, 1300, 253, 410, 597];
  const hist: Record<string, Record<string, { tokens: number; cost: number }>> = {};
  days.forEach((d, i) => {
    hist[d] = { Opus: { tokens: costs[i] * 4e5, cost: costs[i] * 0.92 }, Fable: { tokens: costs[i] * 1e5, cost: costs[i] * 0.08 } };
  });
  setStore("costHistory", hist as never);
  setStore("detail", {
    active: { start: nowPlus(-90 * 60_000), cost_usd: 2.4, elapsed_min: 90, remaining_min: 210, total_min: 300 },
    peak_block_cost: 1300, periods: { today_cost: 597, yesterday_cost: 410, week_cost: 2287, month_cost: 2975 },
    recent: [], new_cost_since: 0, max_ts_ms: Date.now(), daily: [],
    by_family: [
      { family: "Opus", cost: 3544, tokens: 2.9e9 },
      { family: "Fable", cost: 233, tokens: 1.02e8 },
      { family: "Haiku", cost: 4.09, tokens: 1.6e7 },
    ],
    stats: { total_cost: 3781, total_messages: 17400, avg_block_cost: 22, cache_hit_pct: 94 },
  } as never);
}

function TrayChip(props: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
      <span style={{ position: "relative", display: "inline-flex", "align-items": "center", "justify-content": "center", width: "26px", height: "26px", "border-radius": "7px", background: "var(--fill-1)", "box-shadow": "inset 0 0 0 1px var(--separator)" }}>
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--fill-2)" stroke-width="2.5" />
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="24 35" transform="rotate(-90 8 8)" />
        </svg>
        <span style={{ position: "absolute", right: "-2px", top: "-2px", width: "9px", height: "9px", "border-radius": "50%", background: props.color, "box-shadow": "0 0 0 2px var(--fill-1)" }} />
      </span>
      <span class="t-caption label-secondary">{props.label}</span>
    </span>
  );
}

function GuideView() {
  const [mode, setMode] = createSignal<Mode>("normal");
  const [level, setLevel] = createSignal(40);
  const [anchors, setAnchors] = createSignal<Record<string, { x: number; y: number }>>({});
  let canvasRef: HTMLDivElement | undefined;

  const risk = () => {
    const p = projectLimit(level(), nowPlus(SESSION_RESET_MS), SESSION_WINDOW_MS, Date.now());
    return Boolean(p?.hitsBeforeReset);
  };

  const measure = () => {
    if (!canvasRef) return;
    const base = canvasRef.getBoundingClientRect();
    const out: Record<string, { x: number; y: number }> = {};
    canvasRef.querySelectorAll<HTMLElement>("[data-guide]").forEach((el) => {
      const r = el.getBoundingClientRect();
      out[el.dataset.guide as string] = { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
    });
    setAnchors(out);
  };

  // Re-measure whenever the replica changes — mode/usage may add or remove the
  // badge or shift the caption. rAF + a couple of delayed passes catch the
  // view-in animation and font settling.
  createEffect(() => {
    mode();
    level();
    requestAnimationFrame(() => requestAnimationFrame(measure));
    window.setTimeout(measure, 220);
  });

  onMount(() => {
    setStore("mode", "normal");
    const ro = new ResizeObserver(() => measure());
    if (canvasRef) ro.observe(canvasRef);
    const t1 = window.setTimeout(measure, 300);
    const t2 = window.setTimeout(measure, 800);
    window.addEventListener("resize", measure);
    onCleanup(() => {
      ro.disconnect();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", measure);
    });
  });

  const selectMode = (m: Mode) => {
    setMode(m);
    setStore("mode", m);
  };
  const onSlide = (v: number) => {
    setLevel(v);
    setUsage(v);
  };
  const visible = () =>
    CALLOUTS[mode()].filter((c) => !c.cond || c.cond === "always" || (c.cond === "risk") === risk());
  const frameLeft = () => FRAME_CX - MODE_SIZE[mode()][0] / 2;

  return (
    <div class="guide-root" style={{ display: "flex", "flex-direction": "column", height: "100vh", color: "var(--label)" }}>
      <div class="drag" data-tauri-drag-region style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "12px 18px", "border-bottom": "0.5px solid var(--separator)" }}>
        <span class="t-headline">{tx(HEAD)}</span>
        <div class="no-drag" style={{ display: "flex", gap: "2px", background: "var(--fill-2)", "border-radius": "9px", padding: "3px" }}>
          <For each={MODES}>
            {(m) => (
              <button onClick={() => selectMode(m.mode)} style={{ padding: "4px 16px", "border-radius": "7px", background: mode() === m.mode ? "var(--fill-1)" : "transparent", color: mode() === m.mode ? "var(--label)" : "var(--label-tertiary)", "font-weight": mode() === m.mode ? 600 : 400 }}>
                <span class="t-body">{tx(m.label)}</span>
              </button>
            )}
          </For>
        </div>
        <button class="no-drag ring-hover" onClick={() => void getCurrentWindow().close()} style={{ color: "var(--label-secondary)", "font-size": "15px", width: "28px", height: "28px", "border-radius": "8px" }}>✕</button>
      </div>

      <div style={{ flex: 1, display: "flex", "justify-content": "center", overflow: "auto" }}>
        <div ref={canvasRef} style={{ position: "relative", width: `${CANVAS_W}px`, height: "740px", "flex-shrink": 0 }}>
          {/* usage slider above the replica */}
          <div class="no-drag" style={{ position: "absolute", top: "34px", left: `${FRAME_CX - 150}px`, width: "300px", display: "flex", "flex-direction": "column", "align-items": "center", gap: "4px" }}>
            <span class="t-caption label-tertiary">{tx(SLIDER)}</span>
            <input type="range" min="2" max="99" value={level()} onInput={(e) => onSlide(Number(e.currentTarget.value))} style={{ width: "100%" }} />
          </div>

          <svg style={{ position: "absolute", inset: 0, width: `${CANVAS_W}px`, height: "740px", "pointer-events": "none" }}>
            <For each={visible()}>
              {(c) => {
                const a = () => anchors()[c.anchor];
                const sx = () => (c.side === "right" ? CANVAS_W - 290 : 290);
                return (
                  <Show when={a()}>
                    <line x1={sx()} y1={c.y + 16} x2={a()!.x} y2={a()!.y} stroke="var(--label-tertiary)" stroke-width="1.25" />
                    <circle cx={a()!.x} cy={a()!.y} r="3" fill={c.cond === "risk" ? "var(--warning)" : "var(--label-secondary)"} />
                  </Show>
                );
              }}
            </For>
          </svg>

          <div style={{ position: "absolute", left: `${frameLeft()}px`, top: `${FRAME_TOP}px`, width: `${MODE_SIZE[mode()][0]}px`, height: `${MODE_SIZE[mode()][1]}px`, "pointer-events": "none", "border-radius": "var(--r-window)", overflow: "hidden", "box-shadow": "0 12px 44px rgba(0,0,0,0.3)" }}>
            <WidgetChrome />
          </div>

          <For each={visible()}>
            {(c) => (
              <div style={{ position: "absolute", top: `${c.y}px`, width: "260px", left: c.side === "right" ? `${CANVAS_W - 278}px` : "18px", "text-align": c.side === "right" ? "left" : "right" }}>
                <div class="t-body" style={{ "font-weight": 600, color: c.cond === "risk" ? "var(--warning)" : "var(--label)" }}>{tx(c.title)}</div>
                <div class="t-caption label-secondary" style={{ "margin-top": "2px", "line-height": 1.4 }}>{tx(c.desc)}</div>
              </div>
            )}
          </For>

          {/* tray icon explanation with both states */}
          <div style={{ position: "absolute", left: "18px", right: "18px", bottom: "16px", display: "flex", "flex-direction": "column", "align-items": "center", gap: "6px" }}>
            <div class="t-body" style={{ "font-weight": 600 }}>{tx(TRAY_TITLE)}</div>
            <div class="t-caption label-secondary" style={{ "max-width": "620px", "text-align": "center", "line-height": 1.4 }}>{tx(TRAY_DESC)}</div>
            <div style={{ display: "flex", gap: "20px", "margin-top": "2px" }}>
              <TrayChip color="#30d158" label={tx(TRAY_OK)} />
              <TrayChip color="var(--danger)" label={tx(TRAY_ERR)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GuideApp() {
  const params = new URLSearchParams(window.location.search);
  lang = params.get("lang") === "ko" ? "ko" : "en";
  const dark = params.get("dark") === "1";
  setStore("dark", dark);
  applyDarkClass(dark);
  document.documentElement.lang = lang;
  seedStore();
  return <GuideView />;
}
