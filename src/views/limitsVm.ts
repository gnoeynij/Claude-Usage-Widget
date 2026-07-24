import { createMemo } from "solid-js";
import { store } from "../state/store";
import { t } from "../i18n";
import {
  projectLimit,
  riskTone,
  SESSION_WINDOW_MS,
  WEEKLY_WINDOW_MS,
  type LimitProjection,
} from "../utils/project";
import { projText } from "../utils/format";

// Shared projection/risk wiring for the Normal views — the glass and
// instrument skins consume the SAME logic (theme forks structure only;
// double-maintaining pace/risk rules is how the two would drift apart).

/** Risk ETA as localized text ("⚠ ~2d 16h to limit"). */
export function riskText(ms: number) {
  return ms >= 24 * 3_600_000
    ? t().projRiskDays(Math.floor(ms / 86_400_000), Math.floor((ms % 86_400_000) / 3_600_000))
    : t().projRisk(Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000));
}

/** Bare duration ("~2d 16h") — the riskLine phrase is added once per line. */
export function durText(ms: number) {
  return ms >= 24 * 3_600_000
    ? t().durDH(Math.floor(ms / 86_400_000), Math.floor((ms % 86_400_000) / 3_600_000))
    : t().durHM(Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000));
}

/** Hours-only variant for 2+ items — the full minutes form overflows the
 *  320px panel in Korean and wraps. Minutes only matter inside the final hour. */
export function durTextCompact(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  return h > 0 ? t().durH(h) : t().durHM(0, Math.floor(ms / 60_000));
}

/** Localized "resets in …" for the weekly caption (days+hours ≥24h). */
export function formatResetsIn(iso?: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  if (ms >= 86_400_000) {
    const days = Math.floor(ms / 86_400_000);
    const hrs = Math.floor((ms % 86_400_000) / 3_600_000);
    return t().resetsInDays(days, hrs);
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return t().resetsIn(h, m);
}

/** Per-component projection accessors. Call inside a component body; the
 *  thunks read store.tick* so consumers stay live (same cadence as before:
 *  session/weekly re-evaluate per minute, plus instantly on sync). */
export function createLimitsVm() {
  const sessionProj = createMemo(() => {
    // Per-minute (not tickSecond): the projection is an estimate, so a
    // per-second recompute only adds flicker (64↔65%). It still updates
    // immediately on sync via store.usage.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    store.tickMinute;
    return projectLimit(
      store.usage.five_hour,
      store.usage.session_resets_at,
      SESSION_WINDOW_MS,
      Date.now(),
      store.recentPaceSession,
    );
  });
  const weeklyProj = createMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    store.tickMinute;
    return projectLimit(
      store.usage.seven_day,
      store.usage.weekly_resets_at,
      WEEKLY_WINDOW_MS,
      Date.now(),
      // Weekly uses the week-to-date average only. A burst during work hours
      // shouldn't extrapolate to "rest of the week at this rate" — over a 7d
      // window the wall-clock average already absorbs the user's duty cycle.
      undefined,
      0.1, // weekly's 7d window banks enough data sooner — see projectLimit
    );
  });
  // Scoped caps ride the weekly cadence (their resets_at matches the weekly
  // reset) — average-only, same rationale as weeklyProj. Plain function, not
  // a memo: called inside JSX so tickMinute keeps it live per row.
  const scopedProj = (row: { percent: number; resets_at?: string | null }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    store.tickMinute;
    return projectLimit(row.percent, row.resets_at, WEEKLY_WINDOW_MS, Date.now(), undefined, 0.1);
  };
  // Imminent (<24h) weekly limits for the warning line/chip, in ROW order so
  // the list mirrors the bars above it. Distant risks stay text-free — their
  // signal is the projection dot (glass) / tooltip; text shows up only when a
  // limit is a today-problem.
  const imminentRisks = () => {
    const risks: Array<{ label: string; msToLimit: number }> = [];
    const w = weeklyProj();
    if (riskTone(w) === "imminent")
      risks.push({ label: t().allModels, msToLimit: w!.msToLimit });
    for (const r of store.usage.scoped_limits ?? []) {
      const p = scopedProj(r);
      if (riskTone(p) === "imminent") risks.push({ label: r.label, msToLimit: p!.msToLimit });
    }
    return risks;
  };
  /** One "Label ~dur / Label ~dur" line body for t().riskLine — minutes drop
   *  when 2+ items share the line. */
  const imminentLine = () =>
    t().riskLine(
      imminentRisks()
        .map((r, _i, all) =>
          `${r.label} ${(all.length > 1 ? durTextCompact : durText)(r.msToLimit)}`,
        )
        .join(" / "),
    );
  // Calm projected-% for the All-models weekly caption. Distant risk (heading
  // over 100% but ≥24h out) has no loud text — its signal is this "proj 118%"
  // readout (amber `over`). Imminent (<24h) is escalated to the chip instead,
  // so it's suppressed here. null = nothing worth showing (flat pace).
  const weeklyCaptionProj = (): { over: boolean; pct: number } | null => {
    const p = weeklyProj();
    if (!p || riskTone(p) === "imminent") return null;
    const value = store.usage.seven_day;
    if (!p.hitsBeforeReset && p.projectedPct <= value + 0.5) return null;
    return { over: p.hitsBeforeReset, pct: Math.floor(p.projectedPct) };
  };
  // Hover tooltip: every tracked weekly limit with its own projection — the
  // visible text carries only the soonest facts, the full list lives here.
  const weeklyTooltip = () => {
    const rows: Array<{ label: string; pct: number; proj: LimitProjection | null }> = [
      { label: t().allModels, pct: store.usage.seven_day, proj: weeklyProj() },
      ...(store.usage.scoped_limits ?? []).map((r) => ({
        label: r.label,
        pct: r.percent,
        proj: scopedProj(r),
      })),
    ];
    return rows
      .map((r) => {
        const pj = projText(r.proj);
        return `${r.label} ${Math.round(r.pct || 0)}%${pj ? ` · ${pj}` : ""}`;
      })
      .join("\n");
  };
  return {
    sessionProj,
    weeklyProj,
    scopedProj,
    imminentRisks,
    imminentLine,
    weeklyCaptionProj,
    weeklyTooltip,
  };
}
