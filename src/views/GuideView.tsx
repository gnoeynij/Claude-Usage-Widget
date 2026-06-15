import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WidgetChrome } from "../App";
import { store, setStore, applyDarkClass, type Mode } from "../state/store";
import { projectLimit, SESSION_WINDOW_MS } from "../utils/project";
import trayOkPng from "../assets/tray-ok-32.png";
import trayErrPng from "../assets/tray-err-32.png";

// Standalone guide window. Renders the REAL widget (WidgetChrome) at its real
// per-mode size with a seeded store; a slider drives the usage level so the
// reader can scrub through every state (color levels, safe→risk). Callouts are
// positioned by measuring the live `data-guide` anchors, and some appear only
// in the matching state. Own webview = own store → lang/dark in memory only.

type Txt = { en: string; ko: string };
type Cond = "always" | "risk" | "safe";
type Callout = { anchor: string; side: "left" | "right"; y: number; cond?: Cond; title: Txt; desc: Txt };
type GuideMode = Mode | "settings";

let lang: "en" | "ko" = "en";
const tx = (t: Txt) => t[lang];

const HEAD: Txt = { en: "Widget guide", ko: "위젯 가이드" };
const SLIDER: Txt = { en: "Drag to change the usage level", ko: "사용량을 조절해 보세요" };
const PROJ_TITLE: Txt = { en: "How projected usage is estimated", ko: "예상 사용량은 어떻게 계산되나요?" };
const PROJ_DESC: Txt = {
  en: "The faint ghost arc/bar, the caption's projection, and the ⚠ badge all assume your current pace holds until reset:",
  ko: "도넛·막대의 옅은 고스트, 캡션의 예상치, ⚠ 배지는 모두 현재 사용 속도가 리셋까지 이어진다고 가정합니다:",
};
const PROJ_FORMULA: Txt = {
  en: "projected % = current % × (window ÷ elapsed)",
  ko: "예상 % = 현재 % × (전체 기간 ÷ 경과 시간)",
};
const PROJ_NOTE1: Txt = {
  en: "If your recent pace runs faster than that average, the faster pace is used instead — so warnings surface sooner.",
  ko: "최근 속도가 이 평균보다 빠르면 더 빠른 쪽을 적용해, 경고가 더 일찍 나타납니다.",
};
const PROJ_NOTE2: Txt = {
  en: "Skipped for a short while after each reset (~1h for the session, ~17h for the week) until there's enough data to extrapolate.",
  ko: "초기화 직후 잠깐(세션 약 1시간, 주간 약 17시간)은 데이터가 적어 예상치를 표시하지 않습니다.",
};
const TRAY_TITLE: Txt = { en: "System tray icon", ko: "시스템 트레이 아이콘" };
const TRAY_DESC: Txt = {
  en: "The widget keeps running in the tray when hidden. Right-click for Show / Quit. The icon color reflects sync status:",
  ko: "위젯을 숨겨도 트레이에 남아 동작합니다. 우클릭으로 표시/종료. 아이콘 색이 동기화 상태를 나타냅니다:",
};
const TRAY_OK: Txt = { en: "OK", ko: "정상" };
const TRAY_ERR: Txt = { en: "Error / expired", ko: "오류 · 만료" };
const GUIDE_MODES: { mode: GuideMode; label: Txt }[] = [
  { mode: "mini", label: { en: "Mini", ko: "미니" } },
  { mode: "normal", label: { en: "Normal", ko: "기본" } },
  { mode: "detail", label: { en: "Detail", ko: "상세" } },
  { mode: "settings", label: { en: "Settings", ko: "설정" } },
];

const CALLOUTS: Record<GuideMode, Callout[]> = {
  normal: [
    { anchor: "status", side: "left", y: 96,
      title: { en: "Sync status", ko: "동기화 상태" },
      desc: { en: "Dot color shows how recently your usage was synced.", ko: "마지막 동기화 시각을 점 색으로 표시합니다." } },
    { anchor: "donut", side: "left", y: 180, cond: "safe",
      title: { en: "Session usage (5h)", ko: "세션 사용량 (5시간)" },
      desc: { en: "Arc color reflects usage level. A projected arc marks expected usage at reset. Click to refresh.", ko: "아크 색이 사용량 수준을 나타냅니다. 예측 아크는 초기화 시 예상 사용량을 표시합니다. 클릭하면 즉시 새로고침." } },
    { anchor: "donut", side: "left", y: 180, cond: "risk",
      title: { en: "Usage + projection", ko: "사용량 + 예상" },
      desc: { en: "Projected arc: expected usage at reset if this pace continues. Inner arc: current use.", ko: "예측 아크: 현재 속도 유지 시 초기화 예상 사용량. 안쪽 아크: 현재 사용량." } },
    { anchor: "session-caption", side: "left", y: 300, cond: "safe",
      title: { en: "Reset & projection", ko: "초기화 · 예상" },
      desc: { en: "Time until reset, plus projected usage at that point if this pace holds.", ko: "초기화까지 남은 시간과 현재 속도 기준 예상 사용량을 표시합니다." } },
    { anchor: "session-caption", side: "left", y: 300, cond: "risk",
      title: { en: "Limit warning", ko: "한도 도달 경고" },
      desc: { en: "On pace to hit the limit — shows how long until you reach it.", ko: "이 속도면 한도에 도달합니다. 남은 시간을 표시합니다." } },
    { anchor: "weekly-caption", side: "left", y: 363, cond: "safe",
      title: { en: "Weekly reset & projection", ko: "주간 초기화 · 예상" },
      desc: { en: "Time until weekly reset, plus projected usage at that point if this pace holds.", ko: "주간 초기화까지 남은 시간과 현재 속도 기준 예상 사용량을 표시합니다." } },
    { anchor: "weekly-caption", side: "left", y: 363, cond: "risk",
      title: { en: "Weekly limit warning", ko: "주간 한도 경고" },
      desc: { en: "On pace to hit the weekly limit — shows how long until you reach it.", ko: "이 속도면 주간 한도에 도달합니다. 남은 시간을 표시합니다." } },
    { anchor: "sync", side: "right", y: 96,
      title: { en: "Refresh", ko: "새로고침" },
      desc: { en: "Manually fetch the latest usage data.", ko: "사용량을 수동으로 즉시 새로고침합니다." } },
    { anchor: "settings", side: "right", y: 156,
      title: { en: "Options", ko: "옵션" },
      desc: { en: "Language, theme, opacity, auto-sync, multi-device totals, updates, and this guide.", ko: "언어·테마·투명도·자동 동기화·기기 통합·업데이트·이 가이드." } },
    { anchor: "weekly", side: "right", y: 286,
      title: { en: "Weekly usage", ko: "주간 사용량" },
      desc: { en: "Resets every 7 days. All models · Sonnet (Opus on some plans). A projected dot marks expected usage at reset.", ko: "7일마다 초기화. 전체 모델·Sonnet (플랜에 따라 Opus). 예측 도트는 초기화 시 예상 사용량을 표시합니다." } },
    { anchor: "modes", side: "right", y: 370,
      title: { en: "Mode switch", ko: "모드 전환" },
      desc: { en: "Switch between Mini (compact overlay), Normal (session + weekly), and Detail (cost trend chart).", ko: "미니(소형 오버레이)·기본(세션+주간)·상세(비용 추세 차트) 간에 전환합니다." } },
    { anchor: "hide", side: "right", y: 432,
      title: { en: "Hide to tray", ko: "트레이로 숨기기" },
      desc: { en: "Closes the window but keeps running in the tray.", ko: "창을 닫아도 트레이에서 계속 동작합니다." } },
  ],
  mini: [
    { anchor: "donut", side: "left", y: 150, cond: "safe",
      title: { en: "Session usage", ko: "세션 사용량" },
      desc: { en: "Current use, always on top. A projected arc marks expected usage at reset. Click to refresh.", ko: "현재 사용량을 항상 위에 표시합니다. 예측 아크는 초기화 시 예상 사용량을 표시합니다. 클릭하면 새로고침." } },
    { anchor: "donut", side: "left", y: 150, cond: "risk",
      title: { en: "Usage + projection", ko: "사용량 + 예상" },
      desc: { en: "Projected arc: expected usage at reset. Inner arc: current use.", ko: "예측 아크: 초기화 시 예상 사용량. 안쪽 아크: 현재 사용량." } },
    { anchor: "expand", side: "left", y: 270,
      title: { en: "Expand", ko: "기본 모드로" },
      desc: { en: "Click the handle or double-click to expand to Normal mode.", ko: "아래 핸들 클릭 또는 더블클릭으로 기본 모드로 전환합니다." } },
    { anchor: "badge", side: "right", y: 120, cond: "risk",
      title: { en: "Warning badge", ko: "경고 배지" },
      desc: { en: "Appears only when on pace to hit a limit. Click for details.", ko: "한도 도달이 예상될 때만 표시됩니다. 클릭하면 상세 정보를 볼 수 있습니다." } },
    { anchor: "weekly", side: "right", y: 240,
      title: { en: "Weekly usage", ko: "주간 사용량" },
      desc: { en: "All models · Sonnet, as compact bars. A projected dot marks expected usage at reset.", ko: "전체 모델·Sonnet, 얇은 막대로 표시합니다. 예측 도트는 초기화 시 예상 사용량을 표시합니다." } },
  ],
  detail: [
    { anchor: "active", side: "left", y: 120,
      title: { en: "Active session", ko: "활성 세션" },
      desc: { en: "Current 5h block: spend · time left · spend per hour.", ko: "현재 5시간 블록의 비용·남은 시간·시간당 비용." } },
    { anchor: "chart", side: "left", y: 310,
      title: { en: "Daily cost trend", ko: "일별 비용 추세" },
      desc: { en: "Cost per day, colored by model. Click a bar to pick a date, or use the device toggle at top right.", ko: "모델별 일별 비용. 막대를 클릭해 날짜를 선택하거나 카드 우측 기기 토글을 사용해 보세요." } },
    { anchor: "range", side: "right", y: 195,
      title: { en: "Date range", ko: "기간 선택" },
      desc: { en: "7 · 14 · 30 day buttons are live — click one to switch and see the chart update.", ko: "7·14·30일 버튼을 클릭하면 기간이 바뀌고 차트가 즉시 업데이트됩니다." } },
    { anchor: "totals", side: "right", y: 530,
      title: { en: "Totals & lifetime", ko: "합계 · 누적" },
      desc: { en: "This week / month, lifetime spend, and combined total across devices.", ko: "이번 주·이번 달·누적 비용과 여러 기기 합산 금액을 표시합니다." } },
  ],
  settings: [
    { anchor: "set-plan", side: "right", y: 130,
      title: { en: "Plan", ko: "플랜" },
      desc: { en: "Your current subscription tier (Pro · Max).", ko: "현재 구독 플랜 (Pro · Max)을 표시합니다." } },
    { anchor: "set-guide", side: "left", y: 165,
      title: { en: "Guide", ko: "가이드" },
      desc: { en: "Reopen this guide window at any time.", ko: "이 가이드 창을 언제든지 다시 열 수 있습니다." } },
    { anchor: "set-lang", side: "left", y: 210,
      title: { en: "Language", ko: "언어" },
      desc: { en: "Switch the display language.", ko: "표시 언어를 전환합니다." } },
    { anchor: "set-sync", side: "right", y: 270,
      title: { en: "Auto-sync interval", ko: "자동 동기화" },
      desc: { en: "How often to automatically refresh usage data. Off = manual only.", ko: "사용량 자동 갱신 주기를 설정합니다. 끄면 수동 새로고침만 가능합니다." } },
    { anchor: "set-appearance", side: "left", y: 330,
      title: { en: "Appearance", ko: "테마 · 항상 위에" },
      desc: { en: "Pin above other windows. Switch between dark and light theme.", ko: "위젯을 다른 창 위에 고정하거나 다크/라이트 테마를 전환합니다." } },
    { anchor: "set-opacity", side: "right", y: 393,
      title: { en: "Background opacity", ko: "배경 투명도" },
      desc: { en: "Adjust how transparent the panel background appears.", ko: "패널 배경을 불투명에서 완전 투명까지 조절합니다." } },
    { anchor: "set-device-sync", side: "left", y: 462,
      title: { en: "Multi-device totals", ko: "기기 통합 집계" },
      desc: { en: "Point to a shared cloud folder to combine spend across your devices.", ko: "공유 클라우드 폴더를 지정해 여러 기기의 비용을 합산합니다." } },
    { anchor: "set-update", side: "left", y: 538,
      title: { en: "Updates", ko: "업데이트" },
      desc: { en: "Check for and install the latest version.", ko: "최신 버전을 확인하고 설치합니다." } },
  ],
};

const MODE_SIZE: Record<Mode, [number, number]> = {
  mini: [240, 112],
  normal: [320, 360],
  detail: [592, 619],
};
// Settings guide tab uses a taller/wider pseudo-frame so all settings
// sections (device sync, updates) fit without internal scroll.
const SETTINGS_SIZE: [number, number] = [400, 580];
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
  setStore("syncFolder", "iCloud Drive / Claude Widget" as never);
  setStore("combinedDevices", 2 as never);
  setStore("combinedCost", 5840.5 as never);
  // 30-day smooth two-wave pattern so all range buttons show distinct, varied charts.
  // Index 0 = 29 days ago, index 29 = today. Two peaks (~day 7 and ~day 21).
  const costs30 = [
    180, 270, 390, 520, 640, 730, 780,  // rising wave 1   (0–6)
    800, 760, 680, 570, 440, 310, 200,  // falling wave 1  (7–13)
    140, 170, 260, 400, 540, 660, 740,  // rising wave 2   (14–20)
    790, 750, 660, 540, 390, 260, 160,  // falling wave 2  (21–27)
    110, 170,                            // yesterday, today (28–29)
  ];
  const hist: Record<string, Record<string, { tokens: number; cost: number }>> = {};
  const chist: Record<string, Record<string, { tokens: number; cost: number }>> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const c = costs30[29 - i];
    hist[key] = {
      Opus:   { tokens: c * 2.5e5, cost: c * 0.64 },
      Fable:  { tokens: c * 1.0e5, cost: c * 0.19 },
      Sonnet: { tokens: c * 1.5e5, cost: c * 0.15 },
      Haiku:  { tokens: c * 4e4,   cost: c * 0.02 },
    };
    const cc = Math.round(c * 1.75);
    chist[key] = {
      Opus:   { tokens: cc * 2.5e5, cost: cc * 0.64 },
      Fable:  { tokens: cc * 1.0e5, cost: cc * 0.19 },
      Sonnet: { tokens: cc * 1.5e5, cost: cc * 0.15 },
      Haiku:  { tokens: cc * 4e4,   cost: cc * 0.02 },
    };
  }
  setStore("costHistory", hist as never);
  setStore("combinedHistory", chist as never);
  setStore("detail", {
    active: { start: nowPlus(-90 * 60_000), cost_usd: 2.4, elapsed_min: 90, remaining_min: 210, total_min: 300 },
    peak_block_cost: 800, periods: { today_cost: 170, yesterday_cost: 110, week_cost: 2290, month_cost: 14010 },
    recent: [], new_cost_since: 0, max_ts_ms: Date.now(), daily: [],
    by_family: [
      { family: "Opus", cost: 1840, tokens: 1.5e9 },
      { family: "Fable", cost: 730, tokens: 2.9e8 },
      { family: "Sonnet", cost: 415, tokens: 5.1e8 },
      { family: "Haiku", cost: 14, tokens: 2.1e7 },
    ],
    stats: { total_cost: 2999, total_messages: 17400, avg_block_cost: 22, cache_hit_pct: 94 },
  } as never);
}

function TrayChip(props: { src: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", "align-items": "center", gap: "7px" }}>
      <span style={{ display: "inline-flex", "align-items": "center", "justify-content": "center", width: "30px", height: "30px", "border-radius": "7px", background: "var(--fill-2)", "box-shadow": "inset 0 0 0 1px var(--separator)" }}>
        <img src={props.src} width="22" height="22" alt="" />
      </span>
      <span class="t-caption label-secondary">{props.label}</span>
    </span>
  );
}

function GuideView() {
  const [guideMode, setGuideMode] = createSignal<GuideMode>("normal");
  const widgetMode = (): Mode => guideMode() === "settings" ? "normal" : guideMode() as Mode;
  const [level, setLevel] = createSignal(40);
  const [anchors, setAnchors] = createSignal<Record<string, { x: number; y: number; left: number; right: number; top: number; bottom: number }>>({});
  let canvasRef: HTMLDivElement | undefined;
  const [canvasW, setCanvasW] = createSignal(1140);
  const frameCX = () => canvasW() / 2;

  // Compute risk EXACTLY as the widget's NormalView does (same store values),
  // so the conditional callouts flip at the same % the widget shows the warning.
  const risk = () => {
    const p = projectLimit(
      store.usage.five_hour,
      store.usage.session_resets_at,
      SESSION_WINDOW_MS,
      Date.now(),
      store.recentPaceSession,
    );
    return Boolean(p?.hitsBeforeReset);
  };

  const measure = () => {
    if (!canvasRef) return;
    setCanvasW(canvasRef.offsetWidth || 1140);
    const base = canvasRef.getBoundingClientRect();
    const out: Record<string, { x: number; y: number; left: number; right: number; top: number; bottom: number }> = {};
    canvasRef.querySelectorAll<HTMLElement>("[data-guide]").forEach((el) => {
      const r = el.getBoundingClientRect();
      out[el.dataset.guide as string] = {
        x: r.left + r.width / 2 - base.left,
        y: r.top + r.height / 2 - base.top,
        left: r.left - base.left,
        right: r.right - base.left,
        top: r.top - base.top,
        bottom: r.bottom - base.top,
      };
    });
    setAnchors(out);
  };

  // Re-measure whenever the replica changes — mode/usage may add or remove the
  // badge or shift the caption. rAF + a couple of delayed passes catch the
  // view-in animation and font settling.
  createEffect(() => {
    guideMode();
    level();
    requestAnimationFrame(() => requestAnimationFrame(measure));
    // Clear the prior pending timer so a continuous slider drag coalesces to a
    // single trailing measure instead of stacking forced-reflow passes.
    const t = window.setTimeout(measure, 220);
    onCleanup(() => window.clearTimeout(t));
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

  const selectMode = (gm: GuideMode) => {
    setGuideMode(gm);
    setStore("mode", gm === "settings" ? "normal" : gm as Mode);
    setStore("settingsOpen", gm === "settings");
  };
  const onSlide = (v: number) => {
    setLevel(v);
    setUsage(v);
  };
  const visible = () =>
    CALLOUTS[guideMode()].filter((c) => !c.cond || c.cond === "always" || (c.cond === "risk") === risk());
  const frameSize = (): [number, number] =>
    guideMode() === "settings" ? SETTINGS_SIZE : MODE_SIZE[widgetMode()];
  const frameLeft = () => frameCX() - frameSize()[0] / 2;
  const canvasH = () => FRAME_TOP + frameSize()[1] + 60;
  const sxFor = (c: Callout) => c.side === "right"
    ? Math.max(canvasW() - 290, frameLeft() + frameSize()[0] + 8)
    : Math.min(290, frameLeft() - 8);
  const calloutLeftFor = (c: Callout) => c.side === "right"
    ? sxFor(c) + 4
    : sxFor(c) - 264;

  return (
    <>
    {/* Guide-only: disable internal scroll on detail/mini view mains so the
        overflow:hidden widget frame is the only clip boundary. Normal is
        EXCLUDED — its content runs ~14px past main's flex box (donut + both
        reset/projection captions), and clipping there hides the weekly reset
        caption. The real widget leaves main overflow visible, so flex grows
        main and reflows header/footer to fit the 360px panel; the guide must
        match to render that caption.
        The mini warning badge is the one interactive element kept live (like
        detail's range/chart): its callout says "click for details", so it must
        toggle the in-Mini info overlay. It needs pointer-events:auto to re-arm
        because it sits inside mini's main.drag (set to none above). */}
    <style>{`${widgetMode() === "normal" ? "" : ".glass-panel main{overflow:hidden!important}"}.glass-panel [data-guide="hide"],.glass-panel [data-guide="sync"],.glass-panel [data-guide="donut"],.glass-panel [data-guide="expand"],.glass-panel [data-guide="modes"],.glass-panel [data-guide="settings"],.glass-panel [data-guide="status"],.glass-panel [data-guide="weekly"],.glass-panel [data-guide="session-caption"],.glass-panel [data-guide="weekly-caption"],.glass-panel .drag{pointer-events:none!important}.glass-panel [data-guide="badge"]{pointer-events:auto!important}`}</style>
    <div class="guide-root" style={{ display: "flex", "flex-direction": "column", height: "100vh", color: "var(--label)" }}>
      <div class="drag" data-tauri-drag-region style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "12px 18px", "border-bottom": "0.5px solid var(--separator)" }}>
        <span class="t-headline">{tx(HEAD)}</span>
        <div class="no-drag" style={{ display: "flex", gap: "2px", background: "var(--fill-2)", "border-radius": "9px", padding: "3px" }}>
          <For each={GUIDE_MODES}>
            {(m) => (
              <button onClick={() => selectMode(m.mode)} style={{ padding: "4px 16px", "border-radius": "7px", background: guideMode() === m.mode ? "var(--fill-1)" : "transparent", color: guideMode() === m.mode ? "var(--label)" : "var(--label-tertiary)", "font-weight": guideMode() === m.mode ? 600 : 400 }}>
                <span class="t-body">{tx(m.label)}</span>
              </button>
            )}
          </For>
        </div>
        <button class="no-drag ring-hover" onClick={() => void getCurrentWindow().close()} style={{ color: "var(--label-secondary)", "font-size": "15px", width: "28px", height: "28px", "border-radius": "8px" }}>✕</button>
      </div>

      <div style={{ flex: 1, "min-height": 0, display: "flex", "flex-direction": "column", "align-items": "stretch", "justify-content": "center", overflow: "auto" }}>
        <div ref={canvasRef} style={{ position: "relative", width: "100%", height: `${canvasH()}px` }}>
          {/* usage slider above the replica — hidden in detail/settings where it
              would be either invisible or irrelevant */}
          <Show when={guideMode() !== "detail" && guideMode() !== "settings"}>
            <div class="no-drag" style={{ position: "absolute", top: "34px", left: `${frameCX() - 150}px`, width: "300px", display: "flex", "flex-direction": "column", "align-items": "center", gap: "4px" }}>
              <span class="t-caption label-tertiary">{tx(SLIDER)}</span>
              <input type="range" min="2" max="99" value={level()} onInput={(e) => onSlide(Number(e.currentTarget.value))} style={{ width: "100%" }} />
            </div>
          </Show>

          <div style={{ position: "absolute", left: `${frameLeft()}px`, top: `${FRAME_TOP}px`, width: `${frameSize()[0]}px`, height: `${frameSize()[1]}px`, "border-radius": "var(--r-window)", overflow: "hidden", "box-shadow": "0 12px 44px rgba(0,0,0,0.3)", "pointer-events": guideMode() === "settings" ? "none" : undefined }}>
            <WidgetChrome />
          </div>

          {/* SVG rendered AFTER widget frame — bezier connector lines appear on
              top of the widget, always visible. Dashed + low opacity keeps them
              clearly "annotation" rather than "UI". */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: `${canvasH()}px`, "pointer-events": "none" }}>
            <For each={visible()}>
              {(c) => {
                const a = () => anchors()[c.anchor];
                // Dot lands at the center of the nearest edge of the element —
                // left-edge center for left callouts, right-edge center for right callouts.
                const dotX = () => a() ? (c.side === "left" ? a()!.left - 5 : a()!.right + 5) : 0;
                const dotY = () => a() ? (a()!.top + a()!.bottom) / 2 : 0;
                return (
                  <Show when={a()}>
                    <line
                      x1={sxFor(c)} y1={c.y + 16}
                      x2={dotX()} y2={dotY()}
                      stroke="var(--label-tertiary)"
                      stroke-width="0.75"
                      opacity="0.35"
                    />
                    <circle cx={dotX()} cy={dotY()} r="2.5" fill={c.cond === "risk" ? "var(--warning)" : "var(--label-secondary)"} opacity="0.7" />
                  </Show>
                );
              }}
            </For>
          </svg>

          <For each={visible()}>
            {(c) => (
              <div style={{ position: "absolute", top: `${c.y}px`, width: "260px", left: `${calloutLeftFor(c)}px`, "text-align": c.side === "right" ? "left" : "right" }}>
                <div class="t-body" style={{ "font-weight": 600, color: c.cond === "risk" ? "var(--warning)" : "var(--label)" }}>{tx(c.title)}</div>
                <div class="t-caption label-secondary" style={{ "margin-top": "2px", "line-height": 1.4, "word-break": "keep-all" }}>{tx(c.desc)}</div>
              </div>
            )}
          </For>

        </div>
      </div>

      {/* Projection explainer — only in normal/mini, where the ghost markers
          and projection captions actually appear (detail/settings have none). */}
      <Show when={guideMode() === "normal" || guideMode() === "mini"}>
        <div style={{ display: "flex", "flex-direction": "column", "align-items": "center", gap: "5px", padding: "12px 18px 0", "border-top": "0.5px solid var(--separator)", "flex-shrink": 0 }}>
          <div class="t-body" style={{ "font-weight": 600 }}>{tx(PROJ_TITLE)}</div>
          <div class="t-caption label-secondary" style={{ "max-width": "660px", "text-align": "center", "line-height": 1.4 }}>{tx(PROJ_DESC)}</div>
          <div class="t-caption" style={{ padding: "4px 12px", margin: "1px 0", background: "var(--fill-2)", "border-radius": "var(--r-sm)", color: "var(--label)" }}>{tx(PROJ_FORMULA)}</div>
          <div class="t-caption label-tertiary" style={{ "max-width": "660px", "text-align": "center", "line-height": 1.4 }}>{tx(PROJ_NOTE1)}</div>
          <div class="t-caption label-tertiary" style={{ "max-width": "660px", "text-align": "center", "line-height": 1.4 }}>{tx(PROJ_NOTE2)}</div>
        </div>
      </Show>

      {/* tray icon explanation — pinned at the bottom of the guide, always visible */}
      <div style={{ display: "flex", "flex-direction": "column", "align-items": "center", gap: "6px", padding: "10px 18px 14px", "border-top": "0.5px solid var(--separator)", "flex-shrink": 0 }}>
        <div class="t-body" style={{ "font-weight": 600 }}>{tx(TRAY_TITLE)}</div>
        <div class="t-caption label-secondary" style={{ "max-width": "620px", "text-align": "center", "line-height": 1.4 }}>{tx(TRAY_DESC)}</div>
        <div style={{ display: "flex", gap: "20px", "margin-top": "2px" }}>
          <TrayChip src={trayOkPng} label={tx(TRAY_OK)} />
          <TrayChip src={trayErrPng} label={tx(TRAY_ERR)} />
        </div>
      </div>
    </div>
    </>
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
