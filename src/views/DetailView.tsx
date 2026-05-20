import { Show, For, createMemo } from "solid-js";
import { GlassCard } from "../components/GlassCard";
import { CapsuleProgress } from "../components/CapsuleProgress";
import { Donut } from "../components/Donut";
import { store } from "../state/store";
import { t } from "../i18n";
import { formatCost } from "../utils/format";

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const locale = store.lang === "ko" ? "ko-KR" : "en-US";
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString(locale, { month: "short", day: "numeric" })} ${time}`;
}

function modelColor(family: string) {
  const lower = family.toLowerCase();
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
          const timePct = () =>
            act().total_min > 0 ? (act().elapsed_min / act().total_min) * 100 : 0;
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
                label={`${Math.floor(act().remaining_min / 60)}h ${act().remaining_min % 60}m`}
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
  const fams = () => store.detail?.by_family ?? [];
  // Memoize: `Math.max(...arr.map(...))` allocates a fresh array and spreads
  // it every time, called from the inner For. Cache until `fams()` invalidates.
  const peak = createMemo(() => Math.max(...fams().map((f) => f.cost), 0.01));
  return (
    <GlassCard>
      <div class="t-section" style={{ "margin-bottom": "var(--s-3)" }}>
        {t().models}
      </div>
      <For each={fams()}>
        {(fam) => {
          const pct = () => (peak() > 0 ? (fam.cost / peak()) * 100 : 0);
          const color = modelColor(fam.family);
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
              <span
                class="t-body"
                style={{
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "6px",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    "border-radius": "50%",
                    background: color,
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
                style={{ "text-align": "right" }}
              >
                {formatCost(fam.cost)}
              </span>
            </div>
          );
        }}
      </For>
      <Show when={fams().length === 0}>
        <EmptyHint />
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
      <div
        style={{
          display: "grid",
          "grid-template-columns": "1fr 1fr",
          gap: "var(--s-3) var(--s-4)",
        }}
      >
        <KPI label={t().cost} value={formatCost(s()?.total_cost ?? 0)} />
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

export function DetailView() {
  return (
    <main
      class="view-in"
      style={{
        flex: 1,
        "container-type": "inline-size",
        overflow: "auto",
        padding: "0 var(--s-1) var(--s-1)",
      }}
    >
      <div class="detail-grid">
        <ActiveCard />
        <PeriodsCard />
        <RecentCard />
        <ModelsCard />
        <StatsCard />
      </div>
    </main>
  );
}
