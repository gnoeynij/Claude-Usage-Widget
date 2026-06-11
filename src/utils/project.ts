// Limit projection — "at this pace, where does the usage limit land at reset?"
//
// Uses the *average* pace since the window started (current% / elapsed), which
// needs no sample history: the OAuth response already gives the current % and
// the reset time, and the window length is fixed (5h session / 7d weekly).
//
// This is a TREND estimate, not an imminent-hit detector. Average pace lags a
// late burst (it can under-warn while you're spiking right now) — the existing
// 85%/95% threshold notifications cover the "close right now" case, so the two
// signals are complementary.

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
): LimitProjection | null {
  if (!resetsAtIso || pct < 2 || pct >= 100) return null;
  const msToReset = new Date(resetsAtIso).getTime() - now;
  if (msToReset <= 0) return null;
  const elapsed = windowMs - msToReset;
  if (elapsed < windowMs * 0.2) return null;
  const pace = pct / elapsed; // % per ms
  const projectedPct = pace * windowMs;
  if (projectedPct >= 100) {
    return { projectedPct, hitsBeforeReset: true, msToLimit: (100 - pct) / pace };
  }
  return { projectedPct, hitsBeforeReset: false, msToLimit: 0 };
}
