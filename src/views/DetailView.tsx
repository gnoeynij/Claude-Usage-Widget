import { Show, For, createMemo } from "solid-js";
import { GlassCard } from "../components/GlassCard";
import { CapsuleProgress } from "../components/CapsuleProgress";
import { Donut } from "../components/Donut";
import { store, syncNow } from "../state/store";
import { t } from "../i18n";
import { formatCost, formatTokens } from "../utils/format";
import { startWindowDrag } from "../utils/drag";

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const locale = store.lang === "ko" ? "ko-KR" : "en-US";
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString(locale, { month: "short", day: "numeric" })} ${time}`;
}

// The three Claude families, fixed display order (most → least capable). Shown
// even at 0 so the card reads consistently.
const MODEL_FAMILIES = ["Opus", "Sonnet", "Haiku"];

function modelColor(family: string) {
  const lower = family.toLowerCase();
  if (lower.includes("fable")) return "#bf5af2";
  if (lower.includes("opus")) return "var(--accent)";
  if (lower.includes("sonnet")) return "#0a84ff";
  if (lower.includes("haiku")) return "#30d158";
  return "var(--label-tertiary)";
}

function EmptyHint() {
  return <div class="t-caption label-tertiary">—</div>;
}

function ActiveCard() {
  const a = () => store.detail?.active;
  const peak = () => store.detail?.peak_block_cost ?? 0;
  return (
    <GlassCard accent>
      <div class="t-section" style={{ "margin-bottom": "var(--s-3)" }}>
        {t().activeSession} · {t().fiveHourBlock}
      </div>
      <Show when={a()} fallback={<EmptyHint />}>
        {(act) => {
          // Live elapsed/remaining from the block start + tickSecond, so the
          // active-session donut counts down in real time between syncs.
          const liveElapsedMin = () => {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            store.tickSecond;
            const e = (Date.now() - new Date(act().start).getTime()) / 60_000;
            return Math.max(0, Math.min(e, act().total_min));
          };
          const liveRemainingMin = () =>
            Math.max(0, Math.round(act().total_min - liveElapsedMin()));
          const timePct = () =>
            act().total_min > 0 ? (liveElapsedMin() / act().total_min) * 100 : 0;
          const costPct = () =>
            peak() > 0 ? (act().cost_usd / peak()) * 100 : 0;
          return (
            <div
              style={{
                display: "flex",
                gap: "var(--s-4)",
                "align-items": "center",
              }}
            >
              <Donut
                value={timePct()}
                size={88}
                stroke={7}
                label={`${Math.floor(liveRemainingMin() / 60)}h ${liveRemainingMin() % 60}m`}
                onClick={() => void syncNow()}
              />
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  "flex-direction": "column",
                  gap: "var(--s-2)",
                  "min-width": 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    "align-items": "baseline",
                    "justify-content": "space-between",
                  }}
                >
                  <span class="t-body label-secondary">{t().cost}</span>
                  <span class="t-headline tabular-nums">
                    {formatCost(act().cost_usd)}
                  </span>
                </div>
                <CapsuleProgress value={costPct()} tone="accent" />
                <span class="t-caption label-tertiary">
                  {t().peakLabel(Math.round(costPct()), formatCost(peak()))}
                  <Show when={act().elapsed_min > 0}>
                    {" / ↗ "}
                    {formatCost(act().cost_usd / (act().elapsed_min / 60))}/hr
                  </Show>
                </span>
              </div>
            </div>
          );
        }}
      </Show>
    </GlassCard>
  );
}

function PeriodRow(props: { label: string; value: number; max: number }) {
  const pct = () => (props.max > 0 ? (props.value / props.max) * 100 : 0);
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "84px 1fr 72px",
        "align-items": "center",
        gap: "var(--s-3)",
        padding: "6px 0",
      }}
    >
      <span class="t-body label-secondary">{props.label}</span>
      <CapsuleProgress value={pct()} size="sm" tone="accent" />
      <span
        class="t-body tabular-nums"
        style={{ "text-align": "right" }}
      >
        {formatCost(props.value)}
      </span>
    </div>
  );
}

function PeriodsCard() {
  const p = () => store.detail?.periods;
  const peak = () => {
    const pp = p();
    if (!pp) return 0.01;
    return Math.max(
      pp.today_cost,
      pp.yesterday_cost,
      pp.week_cost,
      pp.month_cost,
      0.01,
    );
  };
  // Linear month-end projection from spend-so-far (label says "est." — assumes
  // the current daily pace holds for the rest of the month).
  const monthProjection = () => {
    const m = p()?.month_cost ?? 0;
    const now = new Date();
    const day = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return day > 0 ? (m / day) * daysInMonth : m;
  };
  return (
    <GlassCard>
      <div class="t-section" style={{ "margin-bottom": "var(--s-3)" }}>
        {t().periods}
      </div>
      <PeriodRow label={t().today} value={p()?.today_cost ?? 0} max={peak()} />
      <PeriodRow
        label={t().yesterday}
        value={p()?.yesterday_cost ?? 0}
        max={peak()}
      />
      <PeriodRow
        label={t().thisWeek}
        value={p()?.week_cost ?? 0}
        max={peak()}
      />
      <PeriodRow
        label={t().thisMonth}
        value={p()?.month_cost ?? 0}
        max={peak()}
      />
      <div
        class="t-caption label-tertiary"
        style={{ "text-align": "right", "padding-top": "var(--s-1)" }}
      >
        {t().projectedMonth} {formatCost(monthProjection())}
      </div>
    </GlassCard>
  );
}

function RecentCard() {
  const r = () => store.detail?.recent ?? [];
  // Memoize so the For loop's O(n) `i() === maxIdx()` comparison doesn't
  // re-scan the entire list on every iteration (was effectively O(n²)).
  const maxIdx = createMemo(() => {
    const list = r();
    if (list.length === 0) return -1;
    let mi = 0;
    let mc = list[0].cost_usd;
    list.forEach((b, i) => {
      if (b.cost_usd > mc) {
        mc = b.cost_usd;
        mi = i;
      }
    });
    return mi;
  });
  return (
    <GlassCard>
      <div class="t-section" style={{ "margin-bottom": "var(--s-3)" }}>
        {t().recent}
      </div>
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "var(--s-2)",
        }}
      >
        <For each={r()}>
          {(block, i) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "var(--s-2)",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  "border-radius": "50%",
                  background:
                    i() === maxIdx() ? "var(--accent)" : "var(--label-tertiary)",
                  "flex-shrink": 0,
                  transition: "background var(--dur-fast) var(--ease-smooth)",
                }}
              />
              <span class="t-body label-secondary" style={{ flex: 1 }}>
                {formatTimestamp(block.start)}
              </span>
              <span class="t-body tabular-nums">
                {formatCost(block.cost_usd)}
              </span>
            </div>
          )}
        </For>
        <Show when={r().length === 0}>
          <EmptyHint />
        </Show>
      </div>
    </GlassCard>
  );
}

function ModelsCard() {
  // Show the three Claude families in fixed order, 0 if unused, so the card
  // reads consistently (the user expects to see Sonnet/Haiku even at 0). A
  // non-standard family is appended only when it has real usage — that keeps
  // zero-usage "<synthetic>" placeholders (bucketed as "Other") off the card.
  const rows = createMemo(() => {
    const fams = store.detail?.by_family ?? [];
    const byName = new Map(fams.map((f) => [f.family, f]));
    const fixed = MODEL_FAMILIES.map(
      (name) => byName.get(name) ?? { family: name, cost: 0, tokens: 0 },
    );
    const extras = fams.filter(
      (f) => !MODEL_FAMILIES.includes(f.family) && f.cost > 0,
    );
    return [...fixed, ...extras];
  });
  const peak = createMemo(() => Math.max(...rows().map((f) => f.cost), 0.01));
  const total = createMemo(() => rows().reduce((a, f) => a + f.cost, 0));
  // One-line model mix: each family's share of total spend.
  const mix = createMemo(() =>
    rows()
      .filter((f) => f.cost > 0)
      .map((f) => `${f.family} ${Math.round((f.cost / Math.max(total(), 0.01)) * 100)}%`)
      .join(" · "),
  );
  return (
    <GlassCard>
      <div class="t-section" style={{ "margin-bottom": "var(--s-3)" }}>
        {t().models}
      </div>
      <For each={rows()}>
        {(fam) => {
          const pct = () => (fam.cost / peak()) * 100;
          const color = modelColor(fam.family);
          return (
            <div
              style={{
                display: "grid",
                "grid-template-columns": "58px 1fr 60px 40px",
                "align-items": "center",
                gap: "8px",
                padding: "6px 0",
              }}
            >
              <span
                class="t-body"
                style={{
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "6px",
                  "white-space": "nowrap",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    "border-radius": "50%",
                    background: color,
                    "flex-shrink": 0,
                  }}
                />
                {fam.family}
              </span>
              <CapsuleProgress
                value={pct()}
                size="sm"
                tone="accent"
                color={color}
              />
              <span
                class="t-body tabular-nums"
                style={{
                  "text-align": "right",
                  "font-size": "12px",
                  "white-space": "nowrap",
                }}
              >
                {formatCost(fam.cost)}
              </span>
              <span
                class="t-caption label-tertiary tabular-nums"
                style={{
                  "text-align": "right",
                  "white-space": "nowrap",
                }}
              >
                {formatTokens(fam.tokens)}
              </span>
            </div>
          );
        }}
      </For>
      <Show when={total() > 0}>
        <div
          class="t-caption label-tertiary"
          style={{ "padding-top": "var(--s-2)", "text-align": "center" }}
        >
          {mix()}
        </div>
      </Show>
    </GlassCard>
  );
}

function KPI(props: { label: string; value: string }) {
  return (
    <div>
      <div
        class="t-caption label-tertiary"
        style={{
          "letter-spacing": "0.06em",
          "text-transform": "uppercase",
        }}
      >
        {props.label}
      </div>
      <div class="t-title3 tabular-nums" style={{ "margin-top": "2px" }}>
        {props.value}
      </div>
    </div>
  );
}

function StatsCard() {
  const s = () => store.detail?.stats;
  return (
    <GlassCard>
      <div class="t-section" style={{ "margin-bottom": "var(--s-3)" }}>
        {t().stats}
      </div>
      {/* Lifetime — non-decreasing per-device total (survives log cleanup).
          The "all devices" line is added by the cross-device feature (#2). */}
      <div
        style={{
          display: "flex",
          "align-items": "baseline",
          "justify-content": "space-between",
        }}
      >
        <span class="t-body label-secondary">{t().lifetimeDevice}</span>
        <span class="t-title3 tabular-nums">{formatCost(store.lifetimeCost)}</span>
      </div>
      <Show when={store.syncFolder !== "" && store.combinedDevices > 0}>
        <div
          style={{
            display: "flex",
            "align-items": "baseline",
            "justify-content": "space-between",
            "padding-top": "var(--s-1)",
          }}
        >
          <span class="t-body label-secondary">{t().lifetimeAll}</span>
          <span class="t-title3 tabular-nums">{formatCost(store.combinedCost)}</span>
        </div>
      </Show>
      <div
        style={{
          height: "1px",
          background: "var(--separator)",
          margin: "var(--s-2) 0 var(--s-3)",
        }}
      />
      <div
        style={{
          display: "grid",
          "grid-template-columns": "1fr 1fr",
          gap: "var(--s-3) var(--s-4)",
        }}
      >
        <KPI label={t().onDisk} value={formatCost(s()?.total_cost ?? 0)} />
        <KPI
          label={t().messages}
          value={(s()?.total_messages ?? 0).toLocaleString()}
        />
        <KPI
          label={t().avgPerBlock}
          value={formatCost(s()?.avg_block_cost ?? 0)}
        />
        <KPI
          label={t().cacheHit}
          value={`${Math.round(s()?.cache_hit_pct ?? 0)}%`}
        />
      </div>
    </GlassCard>
  );
}

// Durable daily history (survives JSONL cleanup). Most-recent days first.
// Each row: date · stacked per-family cost bar · day total. The full
// daily×family data lives in store.costHistory for richer stats later.
const HISTORY_DAYS = 10;

function HistoryCard() {
  const days = createMemo(() => {
    const h = store.costHistory;
    return Object.keys(h)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, HISTORY_DAYS)
      .map((date) => {
        const fams = h[date];
        const entries = Object.entries(fams).sort((a, b) => b[1].cost - a[1].cost);
        const total = entries.reduce((s, [, e]) => s + e.cost, 0);
        return { date, total, entries };
      });
  });
  const maxTotal = () => Math.max(...days().map((d) => d.total), 0.01);
  const locale = () => (store.lang === "ko" ? "ko-KR" : "en-US");
  const fmtDate = (d: string) => {
    const dt = new Date(`${d}T00:00:00`);
    return dt.toLocaleDateString(locale(), { month: "short", day: "numeric" });
  };
  return (
    <GlassCard>
      <div class="t-section" style={{ "margin-bottom": "var(--s-3)" }}>
        {t().history}
      </div>
      <Show when={days().length > 0} fallback={<EmptyHint />}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
          <For each={days()}>
            {(d) => (
              <div
                style={{
                  display: "grid",
                  "grid-template-columns": "56px 1fr 72px",
                  "align-items": "center",
                  gap: "var(--s-3)",
                }}
                title={d.entries
                  .map(([fam, e]) => `${fam} ${formatCost(e.cost)}`)
                  .join("  ·  ")}
              >
                <span class="t-caption label-secondary">{fmtDate(d.date)}</span>
                {/* Stacked per-family bar — segment width ∝ family cost, width of
                    the whole bar ∝ day total vs the busiest day shown. */}
                <div
                  style={{
                    display: "flex",
                    height: "8px",
                    width: `${Math.max((d.total / maxTotal()) * 100, 2)}%`,
                    "border-radius": "var(--r-pill)",
                    overflow: "hidden",
                    background: "var(--fill-2)",
                  }}
                >
                  <For each={d.entries}>
                    {([fam, e]) => (
                      <div
                        style={{
                          width: `${(e.cost / d.total) * 100}%`,
                          background: modelColor(fam),
                        }}
                      />
                    )}
                  </For>
                </div>
                <span
                  class="t-caption tabular-nums"
                  style={{ "text-align": "right" }}
                >
                  {formatCost(d.total)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
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
        "container-type": "inline-size",
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
      <div class="detail-grid">
        <ActiveCard />
        <PeriodsCard />
        <RecentCard />
        <ModelsCard />
        <StatsCard />
        <HistoryCard />
      </div>
    </main>
  );
}
