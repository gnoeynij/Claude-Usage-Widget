// Limit projection — "at this pace, where does the usage limit land at reset?"
//
// Base estimate is the *average* pace since the window started (current% /
// elapsed) — no sample history needed (the OAuth response gives current % +
// reset time, window length is fixed: 5h session / 7d weekly).
//
// An optional `recentPace` (EMA-smoothed %/ms over recent syncs, maintained in
// the store) is blended in as `max(average, recent)`: a current burst escalates
// the projection sooner, while idle intervals fall back to the stable average
// (the max keeps the average as a floor, so recent-pace never *under*-warns).
// Without it, behavior is exactly the average-only trend estimate.

// Window lengths are HARDCODED because the OAuth usage API gives `resets_at`
// but not the window length or start. Valid as long as each window starts
// empty `windowMs` before its reset: the 5h session is a fixed block (resets
// to 0%, countdown ticks down → resets_at is fixed not sliding), and the
// weekly limit resets on a fixed weekly cadence (0% at last reset, accrues
// over 7 days). If Anthropic ever changes these durations, update here — the
// projection would otherwise skew silently (regression-watch).
export const SESSION_WINDOW_MS = 5 * 3_600_000;
export const WEEKLY_WINDOW_MS = 7 * 24 * 3_600_000;

export type LimitProjection = {
  /** Projected utilization % at reset if the average pace holds. */
  projectedPct: number;
  /** True when the pace projects past 100% before the window resets. */
  hitsBeforeReset: boolean;
  /** ms from `now` until 100% — only meaningful when `hitsBeforeReset`. */
  msToLimit: number;
};

/** Returns null when there isn't enough signal to project yet — the caller
 *  shows nothing rather than a wild early-window extrapolation. Guard: right
 *  after a reset `elapsed` is tiny, so one burst would project to absurd
 *  numbers; wait until 20% of the window has passed and the user is past a 2%
 *  floor. `now` is injected so this stays pure/reasonable without a clock. */
export function projectLimit(
  pct: number,
  resetsAtIso: string | null | undefined,
  windowMs: number,
  now: number,
  recentPace?: number,
): LimitProjection | null {
  if (!resetsAtIso || pct < 2 || pct >= 100) return null;
  const msToReset = new Date(resetsAtIso).getTime() - now;
  if (msToReset <= 0) return null;
  const elapsed = windowMs - msToReset;
  if (elapsed < windowMs * 0.2) return null;
  const avgPace = pct / elapsed; // % per ms since the window started
  // Recent pace only escalates (max), never lowers below the average floor.
  const pace = recentPace != null && recentPace > avgPace ? recentPace : avgPace;
  // Forward from now: pct + pace × remaining. Equals avgPace × windowMs when
  // pace == avgPace, so the average-only path is unchanged.
  const projectedPct = pct + pace * msToReset;
  if (projectedPct >= 100) {
    return { projectedPct, hitsBeforeReset: true, msToLimit: (100 - pct) / pace };
  }
  return { projectedPct, hitsBeforeReset: false, msToLimit: 0 };
}
