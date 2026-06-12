import { Show, For, createMemo, createSignal } from "solid-js";
import { GlassCard } from "../components/GlassCard";
import { store } from "../state/store";
import { t } from "../i18n";
import { formatCost, formatTokens } from "../utils/format";
import { startWindowDrag } from "../utils/drag";

// Detail = "how have I been spending" (trend/history). "Right now" lives in
// Normal — here the active session is demoted to a one-line strip and the
// daily cost chart is the hero. Recent-blocks and the all-time Models card
// were consciously dropped in the v2.4 redesign (see BACKLOG "모델별 전체-기간
// 합계 복원" for the restore path).

function modelColor(family: string) {
  const lower = family.toLowerCase();
  if (lower.includes("fable")) return "#bf5af2";
  if (lower.includes("opus")) return "var(--accent)";
  if (lower.includes("sonnet")) return "#0a84ff";
  if (lower.includes("haiku")) return "#30d158";
  return "var(--label-tertiary)";
}

/** Compact money for bar labels / captions — "$1.3k", "$266", "$0.4". */
function compactCost(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 10) return `$${Math.round(v)}`;
  return `$${v.toFixed(1)}`;
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function EmptyHint() {
  return <div class="t-caption label-tertiary">—</div>;
}

/** Thin one-line strip: the 5h block is "now" info, demoted from hero card. */
function ActiveStrip() {
  const a = () => store.detail?.active;
  return (
    <Show when={a()}>
      {(act) => {
        const liveElapsedMin = () => {
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          store.tickSecond;
          const e = (Date.now() - new Date(act().start).getTime()) / 60_000;
          return Math.max(0, Math.min(e, act().total_min));
        };
        const remaining = () =>
          Math.max(0, Math.round(act().total_min - liveElapsedMin()));
        const rate = () => {
          const h = liveElapsedMin() / 60;
          return h > 0.05 ? act().cost_usd / h : 0;
        };
        return (
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              padding: "7px 12px",
              background: "var(--fill-1)",
              "border-radius": "var(--r-md)",
            }}
          >
            <span class="t-caption label-secondary">
              <span
                style={{
                  display: "inline-block",
                  width: "7px",
                  height: "7px",
                  "border-radius": "50%",
                  background: "#30d158",
                  "margin-right": "7px",
                }}
              />
              {t().activeNow} ·{" "}
              <span class="tabular-nums" style={{ color: "var(--label)", "font-weight": 600 }}>
                {formatCost(act().cost_usd)}
              </span>
            </span>
            <span class="t-caption label-tertiary tabular-nums">
              {t().leftShort(Math.floor(remaining() / 60), remaining() % 60)}
              <Show when={rate() > 0}> · {t().ratePerHr(compactCost(rate()))}</Show>
            </span>
          </div>
        );
      }}
    </Show>
  );
}

type DayPoint = {
  date: string;
  total: number;
  fams: { family: string; cost: number }[];
};

/** Hero card: daily cost trend from the durable costHistory. 7d shows a $
 *  label on every bar; 14/30d label only peak + selected (bars get too thin),
 *  with the readout carrying exact values for any tapped day. */
function DailyCostCard() {
  const [range, setRange] = createSignal<7 | 14 | 30>(7);
  const [selected, setSelected] = createSignal<string | null>(null);
  // Chart source: this device's durable history, or the fleet-wide sum from
  // the cloud folder. The toggle only shows when a second device exists;
  // combinedHistory is recomputed on every device sync.
  const [source, setSource] = createSignal<"device" | "all">("device");
  const canToggle = () => store.syncFolder !== "" && store.combinedDevices > 1;
  const hist = () =>
    source() === "all" && canToggle() ? store.combinedHistory : store.costHistory;
  const locale = () => (store.lang === "ko" ? "ko-KR" : "en-US");

  const todayStr = () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    store.tickMinute; // re-evaluate across midnight
    return localDateStr(new Date());
  };

  const windowDays = createMemo<DayPoint[]>(() => {
    const h = hist();
    const n = range();
    const out: DayPoint[] = [];
    const base = new Date(`${todayStr()}T00:00:00`);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const date = localDateStr(d);
      const fams = Object.entries(h[date] ?? {})
        .map(([family, e]) => ({ family, cost: e.cost }))
        .sort((a, b) => b.cost - a.cost);
      out.push({ date, total: fams.reduce((s, f) => s + f.cost, 0), fams });
    }
    return out;
  });

  const hasAnyData = () => windowDays().some((d) => d.total > 0)
    || Object.keys(hist()).length > 0;
  const maxTotal = () => Math.max(...windowDays().map((d) => d.total), 0.01);
  const peakIdx = createMemo(() => {
    let mi = 0;
    windowDays().forEach((d, i) => {
      if (d.total > windowDays()[mi].total) mi = i;
    });
    return mi;
  });

  const selDate = () => selected() ?? todayStr();
  const selPoint = () =>
    windowDays().find((d) => d.date === selDate()) ?? {
      date: selDate(),
      total: 0,
      fams: [],
    };

  // Trend: this window's daily average vs the previous same-length window.
  const prevAvg = createMemo(() => {
    const h = hist();
    const n = range();
    const base = new Date(`${todayStr()}T00:00:00`);
    let sum = 0;
    for (let i = n; i < n * 2; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const fams = h[localDateStr(d)];
      if (fams) sum += Object.values(fams).reduce((s, e) => s + e.cost, 0);
    }
    return sum / n;
  });
  const curAvg = () => windowDays().reduce((s, d) => s + d.total, 0) / range();
  const trendPct = () =>
    prevAvg() > 0.01 ? Math.round(((curAvg() - prevAvg()) / prevAvg()) * 100) : null;

  // Per-family totals over the selected window — durable (from costHistory),
  // so this is "models over the last N days", not the on-disk by_family. Pairs
  // with the chart's range toggle and carries cost + tokens.
  const rangeFams = createMemo(() => {
    const acc = new Map<string, { cost: number; tokens: number }>();
    for (const d of windowDays()) {
      for (const [family, e] of Object.entries(hist()[d.date] ?? {})) {
        const a = acc.get(family) ?? { cost: 0, tokens: 0 };
        a.cost += e.cost;
        a.tokens += e.tokens;
        acc.set(family, a);
      }
    }
    return [...acc.entries()]
      .filter(([, v]) => v.cost > 0 || v.tokens > 0)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([family, v]) => ({ family, ...v }));
  });

  const fmtDate = (date: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(locale(), opts);

  const pickRange = (n: 7 | 14 | 30) => {
    setRange(n);
    if (selected() && !windowDays().some((d) => d.date === selected())) {
      setSelected(null);
    }
  };

  const showBarLabel = (i: number, d: DayPoint) =>
    d.total > 0 &&
    (range() === 7 || i === peakIdx() || d.date === selDate());

  return (
    <GlassCard accent>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "margin-bottom": "var(--s-3)",
        }}
      >
        <span class="t-section">{t().history}</span>
        <div style={{ display: "flex", "align-items": "center", gap: "var(--s-2)" }}>
          <Show when={canToggle()}>
            <div
              style={{
                display: "flex",
                gap: "2px",
                "border-right": "1px solid var(--separator)",
                "padding-right": "var(--s-2)",
              }}
            >
              <For each={[["device", t().deviceThis], ["all", t().deviceAll]] as const}>
                {([key, label]) => (
                  <button
                    onClick={() => setSource(key)}
                    class="t-caption"
                    style={{
                      padding: "3px 9px",
                      border: "none",
                      "border-radius": "var(--r-sm)",
                      background: source() === key ? "var(--fill-2)" : "transparent",
                      color:
                        source() === key
                          ? "var(--label)"
                          : "var(--label-tertiary)",
                      "font-weight": source() === key ? 600 : 400,
                      cursor: "pointer",
                      "white-space": "nowrap",
                    }}
                  >
                    {label}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <div data-guide="range" style={{ display: "flex", gap: "2px" }}>
            <For each={[7, 14, 30] as const}>
              {(n) => (
                <button
                  onClick={() => pickRange(n)}
                  class="t-caption tabular-nums"
                  style={{
                    padding: "3px 9px",
                    border: "none",
                    "border-radius": "var(--r-sm)",
                    background: range() === n ? "var(--accent)" : "transparent",
                    color: range() === n ? "#2a1000" : "var(--label-tertiary)",
                    "font-weight": range() === n ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {n}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>

      <Show when={hasAnyData()} fallback={
        <div>
          <EmptyHint />
          <div class="t-caption label-tertiary" style={{ "margin-top": "var(--s-1)" }}>
            {t().historyEmpty}
          </div>
        </div>
      }>
        {/* Selected-day readout — the exact-value anchor for every range. */}
        <div
          style={{
            display: "flex",
            "align-items": "baseline",
            "justify-content": "space-between",
            "flex-wrap": "wrap",
            gap: "var(--s-1) var(--s-3)",
            "margin-bottom": "var(--s-3)",
          }}
        >
          <div>
            <span class="t-caption label-tertiary">
              {fmtDate(selDate(), { month: "short", day: "numeric" })}
              <Show when={selDate() === todayStr()}> ({t().todayMark})</Show>
            </span>{" "}
            <span class="t-title3 tabular-nums">{formatCost(selPoint().total)}</span>
          </div>
          <div class="t-caption label-secondary tabular-nums">
            <For each={selPoint().fams.slice(0, 3)}>
              {(f, i) => (
                <span>
                  <Show when={i() > 0}>{"  "}</Show>
                  <span style={{ color: modelColor(f.family) }}>●</span>{" "}
                  {f.family} {compactCost(f.cost)}
                </span>
              )}
            </For>
          </div>
        </div>

        {/* Chart: gridline + max label give scale; bars are tappable. */}
        <div style={{ position: "relative", height: "128px" }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              "border-top": "1px dashed var(--separator)",
            }}
          />
          <span
            class="t-caption label-tertiary tabular-nums"
            style={{
              position: "absolute",
              top: "-8px",
              right: 0,
              "font-size": "10px",
              background: "transparent",
            }}
          >
            {compactCost(maxTotal())}
          </span>
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              "border-top": "1px dashed var(--separator)",
              opacity: 0.5,
            }}
          />
          <div
            style={{
              display: "flex",
              "align-items": "flex-end",
              gap: range() === 7 ? "10px" : range() === 14 ? "5px" : "3px",
              height: "100%",
              "padding-top": "16px",
              "box-sizing": "border-box",
            }}
          >
            <For each={windowDays()}>
              {(d, i) => (
                <div
                  onClick={() => setSelected(d.date)}
                  style={{
                    flex: 1,
                    display: "flex",
                    "flex-direction": "column",
                    "justify-content": "flex-end",
                    height: `${Math.max((d.total / maxTotal()) * 100, 2)}%`,
                    "min-width": 0,
                    cursor: "pointer",
                    outline:
                      d.date === selDate()
                        ? "1.5px solid var(--label-tertiary)"
                        : "none",
                    "outline-offset": "2px",
                    "border-radius": "3px",
                  }}
                  title={`${d.date} · ${formatCost(d.total)}`}
                >
                  <Show when={showBarLabel(i(), d)}>
                    <div
                      class="tabular-nums"
                      style={{
                        "font-size": "10px",
                        "text-align": "center",
                        "margin-bottom": "2px",
                        "white-space": "nowrap",
                        color:
                          i() === peakIdx() || d.date === selDate()
                            ? "var(--label)"
                            : "var(--label-tertiary)",
                        "font-weight":
                          i() === peakIdx() || d.date === selDate() ? 600 : 400,
                      }}
                    >
                      {compactCost(d.total)}
                    </div>
                  </Show>
                  <div
                    style={{
                      display: "flex",
                      "flex-direction": "column",
                      "justify-content": "flex-end",
                      height: "100%",
                      "border-radius": "3px 3px 0 0",
                      overflow: "hidden",
                    }}
                  >
                    <Show
                      when={d.total > 0}
                      fallback={
                        <div style={{ background: "var(--fill-2)", height: "2px" }} />
                      }
                    >
                      <For each={d.fams}>
                        {(f) => (
                          <div
                            style={{
                              background: modelColor(f.family),
                              height: `${(f.cost / d.total) * 100}%`,
                              "min-height": f.cost > 0 ? "1px" : "0",
                              }}
                            />
                          )}
                        </For>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* X axis: per-bar weekdays at 7d; 3 date ticks at 14/30d. */}
        <Show
          when={range() === 7}
          fallback={
            <div
              class="t-caption label-tertiary"
              style={{
                display: "flex",
                "justify-content": "space-between",
                "margin-top": "5px",
                "font-size": "10px",
              }}
            >
              <span>{fmtDate(windowDays()[0]?.date ?? todayStr(), { month: "short", day: "numeric" })}</span>
              <span>
                {fmtDate(
                  windowDays()[Math.floor(range() / 2)]?.date ?? todayStr(),
                  { month: "short", day: "numeric" },
                )}
              </span>
              <span style={{ color: "var(--label-secondary)" }}>
                {fmtDate(windowDays()[windowDays().length - 1]?.date ?? todayStr(), {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          }
        >
          <div style={{ display: "flex", gap: "10px", "margin-top": "5px" }}>
            <For each={windowDays()}>
              {(d) => (
                <span
                  class="t-caption"
                  style={{
                    flex: 1,
                    "text-align": "center",
                    "font-size": "10px",
                    color:
                      d.date === todayStr()
                        ? "var(--label-secondary)"
                        : "var(--label-tertiary)",
                  }}
                >
                  {fmtDate(d.date, { weekday: "short" })}
                </span>
              )}
            </For>
          </div>
        </Show>

        {/* Summary row: avg / trend / peak for the window. */}
        <div
          class="t-caption label-secondary"
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            gap: "var(--s-1) 12px",
            "margin-top": "var(--s-3)",
            "padding-top": "var(--s-2)",
            "border-top": "1px solid var(--separator)",
          }}
        >
          <span>
            <span class="label-tertiary">{t().avgShort}</span>{" "}
            <span class="tabular-nums" style={{ color: "var(--label)", "font-weight": 600 }}>
              {compactCost(curAvg())}
            </span>
            <span class="label-tertiary">{t().perDay}</span>
          </span>
          <Show when={trendPct() !== null}>
            <span
              class="tabular-nums"
              style={{ color: (trendPct() ?? 0) > 0 ? "#ff453a" : "#30d158" }}
            >
              {(trendPct() ?? 0) > 0 ? "↗" : "↘"} {Math.abs(trendPct() ?? 0)}%{" "}
              <span class="label-tertiary">{t().vsPrev}</span>
            </span>
          </Show>
          <span class="label-tertiary">
            {t().peakShort}{" "}
            {fmtDate(windowDays()[peakIdx()]?.date ?? todayStr(), {
              month: "short",
              day: "numeric",
            })}{" "}
            <span class="tabular-nums">{compactCost(maxTotal())}</span>
          </span>
        </div>

        {/* Per-model breakdown for the selected window (durable costHistory,
            not on-disk). Doubles as the chart legend. */}
        <Show when={rangeFams().length > 0}>
          <div
            class="t-caption label-tertiary"
            style={{
              "text-transform": "uppercase",
              "letter-spacing": "0.05em",
              "font-size": "10px",
              "margin-top": "var(--s-3)",
              "margin-bottom": "var(--s-2)",
            }}
          >
            {t().modelsRange(range())}
          </div>
          <div
            style={{
              display: "grid",
              "grid-template-columns": "1fr 1fr",
              gap: "8px var(--s-5)",
            }}
          >
            <For each={rangeFams()}>
              {(f) => (
                <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": 0 }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      "border-radius": "2px",
                      background: modelColor(f.family),
                      "flex-shrink": 0,
                    }}
                  />
                  <span class="t-body" style={{ flex: 1, "min-width": 0 }}>
                    {f.family}
                  </span>
                  <span class="t-body tabular-nums" style={{ "font-weight": 600 }}>
                    {formatCost(f.cost)}
                  </span>
                  <span
                    class="t-caption label-tertiary tabular-nums"
                    style={{ width: "44px", "text-align": "right" }}
                  >
                    {formatTokens(f.tokens)}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </GlassCard>
  );
}

/** Totals card. Top row split 50/50: left = calendar week/month spend, right =
 *  lifetime (this device / all devices) — both durable aggregate $. Cache hit
 *  footer. Per-model usage lives in the chart card (range-based, durable), so
 *  this card carries no on-disk model breakdown. */
function TotalsCard() {
  const p = () => store.detail?.periods;
  const cacheHit = () => store.detail?.stats?.cache_hit_pct ?? 0;
  const row = (label: string, value: string) => (
    <div
      style={{ display: "flex", "align-items": "baseline", "justify-content": "space-between", gap: "var(--s-2)" }}
    >
      <span class="t-caption label-secondary" style={{ "min-width": 0 }}>{label}</span>
      <span class="t-body tabular-nums" style={{ "font-weight": 600 }}>{value}</span>
    </div>
  );
  return (
    <GlassCard>
      <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "var(--s-1) var(--s-4)" }}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "6px", "min-width": 0 }}>
          {row(t().thisWeek, formatCost(p()?.week_cost ?? 0))}
          {row(t().thisMonth, formatCost(p()?.month_cost ?? 0))}
        </div>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "6px",
            "min-width": 0,
            "border-left": "1px solid var(--separator)",
            "padding-left": "var(--s-4)",
          }}
        >
          {row(t().lifetimeDevice, formatCost(store.lifetimeCost))}
          <Show when={store.syncFolder !== "" && store.combinedDevices > 0}>
            {row(t().lifetimeAll, formatCost(store.combinedCost))}
          </Show>
        </div>
      </div>

      <div
        class="t-caption label-tertiary"
        style={{
          "text-align": "right",
          "margin-top": "var(--s-3)",
          "padding-top": "var(--s-2)",
          "border-top": "1px solid var(--separator)",
        }}
      >
        {t().cacheHit}{" "}
        <span class="tabular-nums" style={{ color: "var(--label-secondary)", "font-weight": 600 }}>
          {Math.round(cacheHit())}%
        </span>
      </div>
    </GlassCard>
  );
}

export function DetailView() {
  return (
    <main
      class="view-in"
      style={{
        position: "relative",
        flex: 1,
        overflow: "auto",
        padding: "0 var(--s-1) var(--s-1)",
      }}
    >
      {/* 상단 drag region — 시각적 표시 없음, 위젯 이동용. height 28px.
          main 이 overflow:auto 라 스크롤 시 함께 위로 사라짐 — 스크롤 상태
          에선 헤더 22px drag 로 대체. Windows 는 CSS `drag` 클래스 처리,
          macOS 는 data-tauri-drag-region + onMouseDown 폴백 (utils/drag.ts). */}
      <div
        class="drag"
        data-tauri-drag-region
        onMouseDown={startWindowDrag}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "28px",
          "z-index": 1,
        }}
      />
      <div style={{ display: "flex", "flex-direction": "column", gap: "var(--s-3)" }}>
        <div data-guide="active"><ActiveStrip /></div>
        <div data-guide="chart"><DailyCostCard /></div>
        <div data-guide="totals"><TotalsCard /></div>
      </div>
    </main>
  );
}
