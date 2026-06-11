import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WidgetChrome } from "../App";
import { setStore, applyDarkClass, type Mode } from "../state/store";

// Standalone guide window. Renders the REAL widget (WidgetChrome) with a seeded
// + animated store so the replica is identical to the widget and cycles through
// every usage state (color levels, safe/risk). Callouts are positioned by
// measuring the live `data-guide` anchors at runtime, so lines always land on
// the right element. Own webview = own store instance → lang/dark applied in
// memory only, no sync, no persistence.

type Txt = { en: string; ko: string };
type Callout = { anchor: string; side: "left" | "right"; y: number; title: Txt; desc: Txt };

let lang: "en" | "ko" = "en";
const tx = (t: Txt) => t[lang];

const HEAD: Txt = { en: "Widget guide", ko: "위젯 가이드" };
const HINT: Txt = {
  en: "The widget below cycles through usage states. Switch modes above ▲",
  ko: "아래 위젯은 사용량 상태를 순환해 보여줍니다. 상단에서 모드를 바꿔보세요 ▲",
};
const TRAY: Txt = {
  en: "Tray icon — the widget keeps running in the system tray when hidden. Right-click for Show / Quit; the icon color reflects sync status.",
  ko: "트레이 아이콘 — 위젯을 숨겨도 시스템 트레이에 남아 동작합니다. 우클릭으로 표시/종료, 아이콘 색으로 동기화 상태를 표시합니다.",
};
const MODES: { mode: Mode; label: Txt }[] = [
  { mode: "mini", label: { en: "Mini", ko: "미니" } },
  { mode: "normal", label: { en: "Normal", ko: "기본" } },
  { mode: "detail", label: { en: "Detail", ko: "상세" } },
];

const CALLOUTS: Record<Mode, Callout[]> = {
  normal: [
    { anchor: "donut", side: "left", y: 120,
      title: { en: "Session usage (5h)", ko: "세션 사용량 (5시간)" },
      desc: { en: "Current use in the rolling 5-hour window. The color shifts as you use more.", ko: "5시간마다 초기화되는 현재 사용량. 사용량이 늘면 색이 바뀝니다." } },
    { anchor: "donut", side: "left", y: 210,
      title: { en: "Projected use", ko: "예상 사용량" },
      desc: { en: "If you keep this pace, the marker shows where you'll be at reset.", ko: "지금 속도로 계속 쓰면 초기화 시점에 어디까지 도달할지 표시합니다." } },
    { anchor: "session-caption", side: "left", y: 300,
      title: { en: "Reset & projection", ko: "초기화 시간 · 예상" },
      desc: { en: "Time until reset, plus the projected value — or a warning if you're on pace to run out.", ko: "초기화까지 남은 시간과 예상치 — 한도에 도달할 추세면 경고를 표시합니다." } },
    { anchor: "sync", side: "right", y: 96,
      title: { en: "Refresh", ko: "새로고침" },
      desc: { en: "Manually re-read your usage right now.", ko: "지금 사용량을 수동으로 다시 불러옵니다." } },
    { anchor: "settings", side: "right", y: 150,
      title: { en: "Options", ko: "옵션" },
      desc: { en: "Language, theme, opacity, auto-sync interval, multi-device totals, updates, and this guide.", ko: "언어·테마·투명도·자동 동기화·기기 통합 누적·업데이트, 그리고 이 가이드." } },
    { anchor: "weekly", side: "right", y: 250,
      title: { en: "Weekly usage", ko: "주간 사용량" },
      desc: { en: "Resets every 7 days. All models · Sonnet · (Opus if your plan has one).", ko: "7일마다 초기화. 전체 모델·Sonnet·(플랜에 따라 Opus)." } },
    { anchor: "modes", side: "right", y: 360,
      title: { en: "Mode switch", ko: "모드 전환" },
      desc: { en: "Mini (compact) · Normal (limits) · Detail (cost trends).", ko: "미니(작게)·기본(한도)·상세(비용 추세)." } },
  ],
  mini: [
    { anchor: "donut", side: "left", y: 150,
      title: { en: "Session, at a glance", ko: "세션 사용량 (한눈에)" },
      desc: { en: "The compact mode stays out of the way while you work — current use + projection.", ko: "작업 중 방해 없이 떠 있는 작은 모드 — 현재 사용량과 예상." } },
    { anchor: "badge", side: "right", y: 130,
      title: { en: "Warning mark", ko: "경고 표시" },
      desc: { en: "Appears when you're on pace to hit a limit. Click it for the details.", ko: "한도에 도달할 추세일 때 나타납니다. 클릭하면 상세 정보를 보여줍니다." } },
    { anchor: "weekly", side: "right", y: 240,
      title: { en: "Weekly usage", ko: "주간 사용량" },
      desc: { en: "All models · Sonnet, as compact bars.", ko: "전체 모델·Sonnet, 얇은 막대로." } },
  ],
  detail: [
    { anchor: "active", side: "left", y: 120,
      title: { en: "Active session", ko: "활성 세션" },
      desc: { en: "Your current 5-hour block: spend, time left, and spend per hour.", ko: "현재 5시간 블록의 비용·남은 시간·시간당 비용." } },
    { anchor: "chart", side: "left", y: 250,
      title: { en: "Daily cost trend", ko: "일별 비용 추세" },
      desc: { en: "Last 7/14/30 days, split by model. Tap a day for its breakdown.", ko: "최근 7/14/30일을 모델별로. 막대를 누르면 그날 내역을 봅니다." } },
    { anchor: "totals", side: "right", y: 300,
      title: { en: "Totals & lifetime", ko: "합계 · 누적" },
      desc: { en: "This week / month, lifetime spend, combined across your devices.", ko: "이번 주·이번 달, 누적 비용, 여러 기기 합산." } },
  ],
};

const MODE_SIZE: Record<Mode, [number, number]> = {
  mini: [240, 116],
  normal: [320, 384],
  detail: [600, 560],
};

function nowPlus(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

function seedStore() {
  setStore("lang", lang);
  setStore("usage", {
    five_hour: 40,
    seven_day: 55,
    seven_day_sonnet: 18,
    seven_day_opus: 35,
    session_resets_at: nowPlus(1.5 * 3_600_000),
    weekly_resets_at: nowPlus(95 * 3_600_000),
    extra_usage_enabled: false,
  } as never);
  setStore("plan", { subscription_type: "max", rate_limit_tier: null } as never);
  setStore("lifetimeCost", 4457.2);
  // Minimal Detail payload + history so Detail mode renders.
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
    active: { cost_usd: 2.4, start: nowPlus(-30 * 60_000), total_min: 300 },
    daily: [],
    by_family: [
      { family: "Opus", cost: 3544, tokens: 2.9e9 },
      { family: "Fable", cost: 233, tokens: 1.02e8 },
      { family: "Haiku", cost: 4.09, tokens: 1.6e7 },
    ],
    stats: { total_cost: 3781, total_messages: 17400, cache_hit_pct: 94 },
    periods: { today_cost: 597, yesterday_cost: 410, week_cost: 2287, month_cost: 2975 },
  } as never);
}

// Usage keyframes the replica steps through (smoothed by the components' CSS
// transitions) so the guide shows green→amber→red and safe→risk over time.
const FRAMES_5H = [22, 50, 78, 95, 70, 40];
const FRAMES_7D = [40, 68, 88, 60, 30, 52];

function GuideView() {
  const [mode, setMode] = createSignal<Mode>("normal");
  const [anchors, setAnchors] = createSignal<Record<string, { x: number; y: number }>>({});
  let canvasRef: HTMLDivElement | undefined;

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

  // Re-measure after each mode's replica renders + on resize.
  createEffect(() => {
    mode();
    requestAnimationFrame(() => requestAnimationFrame(measure));
  });
  onMount(() => {
    setStore("mode", "normal");
    let i = 0;
    const anim = window.setInterval(() => {
      i = (i + 1) % FRAMES_5H.length;
      setStore("usage", "five_hour", FRAMES_5H[i]);
      setStore("usage", "seven_day", FRAMES_7D[i]);
      setStore("usage", "seven_day_sonnet", Math.round(FRAMES_7D[i] * 0.3));
    }, 2200);
    window.addEventListener("resize", measure);
    onCleanup(() => {
      window.clearInterval(anim);
      window.removeEventListener("resize", measure);
    });
  });

  const selectMode = (m: Mode) => {
    setMode(m);
    setStore("mode", m);
  };
  const list = () => CALLOUTS[mode()];
  // frame centered horizontally in the 860-wide canvas, near top
  const frameLeft = () => 430 - MODE_SIZE[mode()][0] / 2;
  const frameTop = 70;

  return (
    <div class="guide-root" style={{ display: "flex", "flex-direction": "column", height: "100vh", color: "var(--label)" }}>
      {/* header (drag region) */}
      <div
        class="drag"
        data-tauri-drag-region
        style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "12px 18px", "border-bottom": "0.5px solid var(--separator)" }}
      >
        <span class="t-headline">{tx(HEAD)}</span>
        <div class="no-drag" style={{ display: "flex", gap: "2px", background: "var(--fill-2)", "border-radius": "9px", padding: "3px" }}>
          <For each={MODES}>
            {(m) => (
              <button
                onClick={() => selectMode(m.mode)}
                style={{
                  padding: "4px 16px", "border-radius": "7px",
                  background: mode() === m.mode ? "var(--fill-1)" : "transparent",
                  color: mode() === m.mode ? "var(--label)" : "var(--label-tertiary)",
                  "font-weight": mode() === m.mode ? 600 : 400,
                }}
              >
                <span class="t-body">{tx(m.label)}</span>
              </button>
            )}
          </For>
        </div>
        <button class="no-drag ring-hover" onClick={() => void getCurrentWindow().close()} style={{ color: "var(--label-secondary)", "font-size": "15px", width: "28px", height: "28px", "border-radius": "8px" }}>✕</button>
      </div>

      {/* canvas */}
      <div style={{ flex: 1, display: "flex", "justify-content": "center", overflow: "auto" }}>
        <div ref={canvasRef} style={{ position: "relative", width: "860px", height: "560px", "flex-shrink": 0 }}>
          {/* leader lines (measured) */}
          <svg style={{ position: "absolute", inset: 0, width: "860px", height: "560px", "pointer-events": "none" }}>
            <For each={list()}>
              {(c) => {
                const a = () => anchors()[c.anchor];
                const sx = () => (c.side === "right" ? 600 : 260);
                return (
                  <Show when={a()}>
                    <line x1={sx()} y1={c.y + 10} x2={a()!.x} y2={a()!.y} stroke="var(--separator)" stroke-width="1" />
                    <circle cx={a()!.x} cy={a()!.y} r="2.5" fill="var(--label-tertiary)" />
                  </Show>
                );
              }}
            </For>
          </svg>

          {/* real widget replica (non-interactive) */}
          <div
            style={{
              position: "absolute", left: `${frameLeft()}px`, top: `${frameTop}px`,
              width: `${MODE_SIZE[mode()][0]}px`, height: `${MODE_SIZE[mode()][1]}px`,
              "pointer-events": "none",
              "border-radius": "var(--r-window)",
              overflow: "hidden",
              "box-shadow": "0 10px 40px rgba(0,0,0,0.28)",
            }}
          >
            <WidgetChrome />
          </div>

          {/* callout labels */}
          <For each={list()}>
            {(c) => (
              <div style={{ position: "absolute", top: `${c.y}px`, width: "240px", left: c.side === "right" ? "608px" : "12px", "text-align": c.side === "right" ? "left" : "right" }}>
                <div class="t-body" style={{ "font-weight": 600 }}>{tx(c.title)}</div>
                <div class="t-caption label-secondary" style={{ "margin-top": "2px", "line-height": 1.4 }}>{tx(c.desc)}</div>
              </div>
            )}
          </For>

          {/* tray note */}
          <div style={{ position: "absolute", left: "12px", right: "12px", bottom: "34px", display: "flex", "align-items": "flex-start", gap: "8px", "justify-content": "center" }}>
            <span style={{ "font-size": "13px", "margin-top": "1px" }}>▢</span>
            <span class="t-caption label-secondary" style={{ "max-width": "560px", "text-align": "center", "line-height": 1.4 }}>{tx(TRAY)}</span>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: "10px", "text-align": "center" }}>
            <span class="t-caption label-tertiary">{tx(HINT)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Entry for the guide window — applies lang/dark in memory, seeds the demo
 *  store, then renders the guide. */
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
