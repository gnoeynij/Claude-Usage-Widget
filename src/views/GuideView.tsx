import { createSignal, For, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Donut } from "../components/Donut";
import { CapsuleProgress } from "../components/CapsuleProgress";
import { setStore, applyDarkClass, type Mode } from "../state/store";

// Standalone guide window. Loaded with `?guide&lang=&dark=` in a separate
// webview (own store instance), so it sets lang/dark in memory only — no sync,
// no persistence. The replica reuses the real Donut / CapsuleProgress so the
// gauges are identical to the widget; the surrounding chrome is light markup.

type Txt = { en: string; ko: string };
type Callout = {
  // anchor point on the replica + label box top-left, in the 760×500 canvas
  ax: number;
  ay: number;
  lx: number;
  ly: number;
  align: "left" | "right";
  accent?: string;
  title: Txt;
  desc: Txt;
};

let lang: "en" | "ko" = "en";
const tx = (t: Txt) => t[lang];

const HEAD: Txt = { en: "Widget guide", ko: "위젯 가이드" };
const HINT: Txt = {
  en: "Switch modes above to see each layout ▲",
  ko: "상단 토글로 미니·기본·상세 기능을 한눈에 ▲",
};
const MODES: { mode: Mode; label: Txt }[] = [
  { mode: "mini", label: { en: "Mini", ko: "미니" } },
  { mode: "normal", label: { en: "Normal", ko: "기본" } },
  { mode: "detail", label: { en: "Detail", ko: "상세" } },
];

const NORMAL_CALLOUTS: Callout[] = [
  { ax: 380, ay: 150, lx: 40, ly: 120, align: "right", accent: "var(--warning)",
    title: { en: "5-hour session limit", ko: "5시간 세션 한도" },
    desc: { en: "Donut = current use %. Amber at 50%, red at 80%.", ko: "도넛 = 현재 사용%. 50%↑ amber, 80%↑ red." } },
  { ax: 392, ay: 190, lx: 40, ly: 222, align: "right",
    title: { en: "Projected use · dot", ko: "예상 소모 · 도트" },
    desc: { en: "Ghost arc = where this pace lands; dot = the landing point.", ko: "고스트 호 = 이 속도면 도달 구간, 도트 = 착지점." } },
  { ax: 380, ay: 300, lx: 40, ly: 322, align: "right",
    title: { en: "Reset + projection", ko: "초기화 + 한도 예상" },
    desc: { en: "Reset countdown + “proj N%” (safe) / “⚠ to limit” (risk), one line.", ko: "초기화 카운트다운 + 예상%(안전)/⚠ 한도까지(위험), 한 줄." } },
  { ax: 452, ay: 92, lx: 540, ly: 96, align: "left",
    title: { en: "Sync ↻ / Options ⚙", ko: "동기화 ↻ / 옵션 ⚙" },
    desc: { en: "↻ manual refresh, ⚙ options panel (Guide button lives here).", ko: "↻ 수동 새로고침, ⚙ 옵션 패널(가이드 버튼 위치)." } },
  { ax: 448, ay: 300, lx: 540, ly: 232, align: "left", accent: "#0a84ff",
    title: { en: "Weekly limits", ko: "주간 한도 3종" },
    desc: { en: "All models · Sonnet · (Opus when present). 7-day cycle.", ko: "전체 모델·Sonnet·(Opus 있을 때). 7일 주기." } },
  { ax: 452, ay: 348, lx: 540, ly: 338, align: "left",
    title: { en: "Weekly reset + projection", ko: "주간 초기화 + 예상" },
    desc: { en: "Reset + projection for the all-models weekly.", ko: "전체 모델 기준 초기화·한도 예상." } },
  { ax: 420, ay: 400, lx: 540, ly: 420, align: "left",
    title: { en: "Mode switch", ko: "모드 전환" },
    desc: { en: "Mini (glance) · Normal (limits) · Detail (cost trends).", ko: "미니(글glance)·기본(한도)·상세(비용 추세)." } },
];

const MINI_CALLOUTS: Callout[] = [
  { ax: 330, ay: 250, lx: 60, ly: 180, align: "right", accent: "var(--warning)",
    title: { en: "Session, at a glance", ko: "세션 한도 (한눈에)" },
    desc: { en: "Current % donut + projection marker, always on top.", ko: "현재 사용% 도넛 + 예상 마커. 항상 위." } },
  { ax: 430, ay: 218, lx: 540, ly: 150, align: "left", accent: "var(--warning)",
    title: { en: "⚠ Risk badge", ko: "⚠ 위험 배지" },
    desc: { en: "Shows when projected to hit a limit. Click → info overlay.", ko: "한도 도달 예상 시 표시. 클릭 → 정보 오버레이." } },
  { ax: 430, ay: 252, lx: 540, ly: 250, align: "left", accent: "#0a84ff",
    title: { en: "Weekly limits", ko: "주간 한도" },
    desc: { en: "All models · Sonnet, as thin bars.", ko: "전체 모델·Sonnet, 얇은 막대." } },
  { ax: 380, ay: 300, lx: 240, ly: 360, align: "right",
    title: { en: "Expand", ko: "확장" },
    desc: { en: "Double-click or the handle → Normal mode.", ko: "더블클릭 또는 핸들 → 기본 모드." } },
];

const DETAIL_CALLOUTS: Callout[] = [
  { ax: 380, ay: 120, lx: 40, ly: 110, align: "right", accent: "#30d158",
    title: { en: "Active session", ko: "활성 세션" },
    desc: { en: "Current 5h block: cost · time left · cost/hr.", ko: "현재 5h 블록: 비용·남은시간·시간당." } },
  { ax: 380, ay: 210, lx: 40, ly: 250, align: "right", accent: "var(--accent)",
    title: { en: "Daily cost trend", ko: "일별 비용 추세" },
    desc: { en: "7/14/30 days, stacked by model, tap a bar for the breakdown.", ko: "7/14/30일, 모델별 스택, 막대 탭→상세." } },
  { ax: 448, ay: 300, lx: 540, ly: 230, align: "left",
    title: { en: "Models · recent", ko: "최근 모델별" },
    desc: { en: "Per-model cost + tokens over the selected range.", ko: "선택 범위 내 모델별 비용·토큰." } },
  { ax: 448, ay: 360, lx: 540, ly: 350, align: "left",
    title: { en: "Week/month · lifetime", ko: "주간·월간 · 누적" },
    desc: { en: "Period totals + lifetime, combined across devices.", ko: "기간 합계 + 누적, 기기 통합." } },
];

function CalloutEl(props: { c: Callout }) {
  const c = props.c;
  return (
    <div
      style={{
        position: "absolute",
        left: `${c.lx}px`,
        top: `${c.ly}px`,
        width: "210px",
        "text-align": c.align === "right" ? "right" : "left",
      }}
    >
      <div class="t-body" style={{ "font-weight": 600, color: c.accent ?? "var(--label)" }}>
        {tx(c.title)}
      </div>
      <div class="t-caption label-secondary" style={{ "margin-top": "2px", "line-height": 1.35 }}>
        {tx(c.desc)}
      </div>
    </div>
  );
}

function Leaders(props: { callouts: Callout[] }) {
  return (
    <svg style={{ position: "absolute", inset: 0, width: "760px", height: "500px", "pointer-events": "none" }} viewBox="0 0 760 500">
      <For each={props.callouts}>
        {(c) => {
          // line starts at the inner edge of the label box, nearest the replica
          const sx = c.align === "right" ? c.lx + 210 : c.lx;
          return (
            <>
              <path d={`M ${sx} ${c.ly + 10} L ${c.ax} ${c.ay}`} stroke="var(--separator)" stroke-width="1" fill="none" />
              <circle cx={c.ax} cy={c.ay} r="2.5" fill="var(--label-tertiary)" />
            </>
          );
        }}
      </For>
    </svg>
  );
}

/** Light chrome shared by the replicas. */
function ReplicaFrame(props: { width: number; children: any }) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${380 - props.width / 2}px`,
        top: "70px",
        width: `${props.width}px`,
        background: "var(--fill-1)",
        border: "0.5px solid var(--separator)",
        "border-radius": "var(--r-lg)",
        padding: "10px 12px",
        "box-shadow": "0 8px 30px rgba(0,0,0,0.25)",
      }}
    >
      {props.children}
    </div>
  );
}

function HeaderRow() {
  return (
    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "6px" }}>
      <span class="t-caption"><span style={{ color: "#30d158" }}>●</span> Claude</span>
      <span class="t-caption label-tertiary">↻ &nbsp; ⚙</span>
    </div>
  );
}

function ReplicaNormal() {
  return (
    <ReplicaFrame width={190}>
      <HeaderRow />
      <div style={{ display: "flex", "justify-content": "center", margin: "4px 0" }}>
        <Donut value={70} projected={132} size={104} stroke={8} label="session" />
      </div>
      <div class="t-caption label-tertiary" style={{ "text-align": "center", "margin-bottom": "8px" }}>
        1h 25m · <span style={{ color: "var(--warning)" }}>⚠ ~1h</span>
      </div>
      <div style={{ "margin-bottom": "7px" }}>
        <div class="t-caption" style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "3px" }}>
          <span class="label-secondary">All models</span><span>83%</span>
        </div>
        <CapsuleProgress value={83} projected={150} size="sm" />
      </div>
      <div style={{ "margin-bottom": "7px" }}>
        <div class="t-caption" style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "3px" }}>
          <span class="label-secondary">Sonnet</span><span>12%</span>
        </div>
        <CapsuleProgress value={12} size="sm" />
      </div>
      <div class="t-caption label-tertiary" style={{ "text-align": "center", "margin-bottom": "8px" }}>
        95h · <span style={{ color: "var(--warning)" }}>⚠ ~14h</span>
      </div>
      <div style={{ display: "flex", "justify-content": "center", gap: "3px" }}>
        <span class="t-caption label-tertiary" style={{ padding: "3px 9px" }}>Mini</span>
        <span class="t-caption" style={{ padding: "3px 9px", background: "var(--fill-2)", "border-radius": "6px" }}>Normal</span>
        <span class="t-caption label-tertiary" style={{ padding: "3px 9px" }}>Detail</span>
      </div>
    </ReplicaFrame>
  );
}

function ReplicaMini() {
  return (
    <ReplicaFrame width={230}>
      <div style={{ position: "relative", display: "flex", "align-items": "center", gap: "12px", padding: "2px" }}>
        <span style={{ position: "absolute", top: "-2px", right: "2px", color: "var(--warning)", "font-size": "13px" }}>⚠</span>
        <Donut value={58} projected={128} size={84} stroke={7} label="session" />
        <div style={{ flex: 1, display: "flex", "flex-direction": "column", gap: "8px" }}>
          <div>
            <div class="t-caption" style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "2px" }}>
              <span class="label-secondary">All models</span><span>81%</span>
            </div>
            <CapsuleProgress value={81} projected={140} size="sm" />
          </div>
          <div>
            <div class="t-caption" style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "2px" }}>
              <span class="label-secondary">Sonnet</span><span>12%</span>
            </div>
            <CapsuleProgress value={12} size="sm" />
          </div>
        </div>
      </div>
    </ReplicaFrame>
  );
}

function ReplicaDetail() {
  const bars = [20, 35, 12, 90, 28, 45, 60];
  return (
    <ReplicaFrame width={250}>
      <HeaderRow />
      <div style={{ display: "flex", "justify-content": "space-between", padding: "6px 10px", background: "var(--fill-2)", "border-radius": "8px", "margin-bottom": "8px" }}>
        <span class="t-caption"><span style={{ color: "#30d158" }}>●</span> Active · $2.40</span>
        <span class="t-caption label-tertiary">3h left · $0.46/hr</span>
      </div>
      <div style={{ background: "var(--fill-2)", "border-radius": "10px", padding: "8px 10px", "margin-bottom": "8px" }}>
        <div class="t-caption label-tertiary" style={{ "text-transform": "uppercase", "font-size": "9px", "margin-bottom": "6px" }}>Daily cost</div>
        <div style={{ display: "flex", "align-items": "flex-end", gap: "5px", height: "54px" }}>
          <For each={bars}>
            {(h) => <div style={{ flex: 1, height: `${h}%`, background: "var(--accent)", "border-radius": "3px 3px 0 0" }} />}
          </For>
        </div>
        <div class="t-caption label-tertiary" style={{ "font-size": "9px", "margin-top": "6px" }}>
          ● Opus &nbsp; ● Fable — <span style={{ color: "var(--label)" }}>모델별 스택</span>
        </div>
      </div>
      <div style={{ background: "var(--fill-2)", "border-radius": "10px", padding: "8px 10px", display: "flex", "justify-content": "space-between" }}>
        <div class="t-caption"><div class="label-secondary">This week</div><div style={{ "font-weight": 600 }}>$2,287</div></div>
        <div class="t-caption" style={{ "text-align": "right" }}><div class="label-secondary">Lifetime</div><div style={{ "font-weight": 600 }}>$4,457</div></div>
      </div>
    </ReplicaFrame>
  );
}

function GuideView() {
  const [mode, setMode] = createSignal<Mode>("normal");
  const callouts = () =>
    mode() === "mini" ? MINI_CALLOUTS : mode() === "detail" ? DETAIL_CALLOUTS : NORMAL_CALLOUTS;
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100vh", background: "var(--bg-window, #161618)", color: "var(--label)" }}>
      {/* header */}
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "12px 18px", "border-bottom": "0.5px solid var(--separator)" }}>
        <span class="t-headline">{tx(HEAD)}</span>
        <div style={{ display: "flex", gap: "2px", background: "var(--fill-2)", "border-radius": "9px", padding: "3px" }}>
          <For each={MODES}>
            {(m) => (
              <button
                onClick={() => setMode(m.mode)}
                class="no-drag"
                style={{
                  padding: "4px 16px",
                  "border-radius": "7px",
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
        <button class="no-drag" onClick={() => void getCurrentWindow().close()} style={{ color: "var(--label-secondary)", "font-size": "16px", width: "28px", height: "28px" }}>✕</button>
      </div>

      {/* diagram canvas (fixed 760×500 design space, centered) */}
      <div style={{ flex: 1, display: "flex", "justify-content": "center", "align-items": "flex-start", overflow: "auto" }}>
        <div style={{ position: "relative", width: "760px", height: "500px", "flex-shrink": 0 }}>
          <Leaders callouts={callouts()} />
          <Show when={mode() === "normal"}><ReplicaNormal /></Show>
          <Show when={mode() === "mini"}><ReplicaMini /></Show>
          <Show when={mode() === "detail"}><ReplicaDetail /></Show>
          <For each={callouts()}>{(c) => <CalloutEl c={c} />}</For>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: "8px", "text-align": "center" }}>
            <span class="t-caption label-tertiary">{tx(HINT)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Entry for the guide window — applies the passed lang/dark in memory only
 *  (no sync, no persistence) and renders the guide. */
export function GuideApp() {
  const params = new URLSearchParams(window.location.search);
  lang = params.get("lang") === "ko" ? "ko" : "en";
  const dark = params.get("dark") === "1";
  setStore("lang", lang);
  setStore("dark", dark);
  applyDarkClass(dark);
  document.documentElement.lang = lang;
  return <GuideView />;
}
