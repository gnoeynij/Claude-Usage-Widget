import { createMemo } from "solid-js";
import { store } from "../state/store";
import { t } from "../i18n";
import {
  projectLimit,
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

/** The single weekly-caption message, resolved by priority in weeklyMsg().
 *  label null = All models (the primary weekly, rendered unlabeled). */
export type WeeklyMsg =
  | { kind: "risk"; label: string | null; ms: number }
  | { kind: "reached"; label: string }
  | { kind: "safe"; label: string | null; pct: number }
  | null;

/** The weekly message as localized text (⚠ included for risk/reached). Both
 *  skins share the wording — they differ only in wrapping/color. Returns the
 *  bare text + whether it's a warning (amber). null → nothing to show. */
export function weeklyMsgText(m: WeeklyMsg): { text: string; warn: boolean } | null {
  if (!m) return null;
  const lbl = m.label ? `${m.label} ` : "";
  if (m.kind === "safe") return { text: `${lbl}${t().projSafe(m.pct)}`, warn: false };
  if (m.kind === "reached") return { text: t().projReached(m.label), warn: true };
  return { text: `⚠ ${lbl}${t().riskLine(durText(m.ms))}`, warn: true };
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
  // Priority message for the weekly caption's single slot: All models projected
  // over 100% owns it (the primary weekly); otherwise the scoped (Fable) cap —
  // its ETA, "…at limit" once maxed (projectLimit is null at 100%, handled
  // here), or its projected %. Falls back to All models' safe % when no scoped
  // cap is active. Structured data — glass/instrument render it their own way.
  const weeklyMsg = (): WeeklyMsg => {
    const seven = store.usage.seven_day;
    const am = weeklyProj();
    if (am?.hitsBeforeReset) return { kind: "risk", label: null, ms: am.msToLimit };
    const scoped = store.usage.scoped_limits?.[0];
    if (scoped) {
      if (scoped.percent >= 100) return { kind: "reached", label: scoped.label };
      const sp = scopedProj(scoped);
      if (sp?.hitsBeforeReset) return { kind: "risk", label: scoped.label, ms: sp.msToLimit };
      if (sp && sp.projectedPct > scoped.percent + 0.5)
        return { kind: "safe", label: scoped.label, pct: Math.floor(sp.projectedPct) };
    }
    if (am && am.projectedPct > seven + 0.5)
      return { kind: "safe", label: null, pct: Math.floor(am.projectedPct) };
    return null;
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
    weeklyMsg,
    weeklyTooltip,
  };
}
