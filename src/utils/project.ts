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

/** Weekly recentPace cap: a burst can project at most this multiple of the
 *  week-to-date average pace, so a short spike can't extrapolate to an absurd
 *  ETA over the ~7-day window (e.g. a few-minute burst reading as "limit in 7h"
 *  at 38% usage). The cap rides on the average — a genuinely sustained ramp-up
 *  still escalates as the average itself climbs. Session is left uncapped: its
 *  short window self-limits and bursts there are more likely real. */
export const WEEKLY_RECENT_PACE_CAP = 2;

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
 *  numbers; wait until `minElapsedRatio` of the window has passed and the user
 *  is past a 2% floor. Default 0.2 fits the short 5h session; the weekly window
 *  passes 0.1 — its 7d span banks enough absolute data (~17h) far sooner, so a
 *  flat 0.2 (~1.4d) would over-suppress early-week warnings. `now` is injected
 *  so this stays pure/reasonable without a clock. */
export function projectLimit(
  pct: number,
  resetsAtIso: string | null | undefined,
  windowMs: number,
  now: number,
  recentPace?: number,
  minElapsedRatio = 0.2,
  maxRecentMult = Infinity,
): LimitProjection | null {
  if (!resetsAtIso || pct < 2 || pct >= 100) return null;
  const msToReset = new Date(resetsAtIso).getTime() - now;
  if (msToReset <= 0) return null;
  const elapsed = windowMs - msToReset;
  if (elapsed < windowMs * minElapsedRatio) return null;
  const avgPace = pct / elapsed; // % per ms since the window started
  // Recent pace only escalates (max), never below the average floor — and is
  // capped at maxRecentMult× the average so a short burst can't extrapolate
  // absurdly over a long window. The cap rides on the average, so a genuine
  // sustained ramp-up still escalates as the average climbs. Default = uncapped.
  const pace =
    recentPace != null && recentPace > avgPace
      ? Math.min(recentPace, maxRecentMult * avgPace)
      : avgPace;
  // Forward from now: pct + pace × remaining. Equals avgPace × windowMs when
  // pace == avgPace, so the average-only path is unchanged.
  const projectedPct = pct + pace * msToReset;
  if (projectedPct >= 100) {
    return { projectedPct, hitsBeforeReset: true, msToLimit: (100 - pct) / pace };
  }
  return { projectedPct, hitsBeforeReset: false, msToLimit: 0 };
}

// ── Recent-pace estimate (pure core; the store owns the side effects) ────────
// `recentPace` feeds projectLimit's max(average, recent) blend so a current
// burst escalates the projection sooner. It is grown by `blendPace` on each
// sync and relaxed by `decayPace` on a wall-clock tick — so the projection
// eases off on its own between syncs (no extra API calls). Because projectLimit
// floors the pace at the average, decaying recent toward 0 can never *under*-warn.

export type PaceSample = { pct: number; ts: number };
export type BlendOpts = { alpha: number; minIntervalMs: number };

/** EMA update for the recent %/ms pace. Returns the new pace + the sample to
 *  store. `prevPace` is read from (and written back to) the store so a tick
 *  decay between syncs carries through to the next blend. Guards:
 *   - no prior sample → seed it, pace unchanged (no rate from one point)
 *   - usage dropped (`pct < sample.pct`) → window reset between syncs → pace 0
 *   - interval shorter than `minIntervalMs` → keep the old sample (anti-spike:
 *     a tiny Δt would blow up `raw = Δpct/Δt`; wait for a meaningful interval) */
export function blendPace(
  prevPace: number,
  sample: PaceSample | null,
  pct: number,
  now: number,
  { alpha, minIntervalMs }: BlendOpts,
): { pace: number; sample: PaceSample } {
  if (!sample) return { pace: prevPace, sample: { pct, ts: now } };
  if (pct < sample.pct) return { pace: 0, sample: { pct, ts: now } };
  if (now - sample.ts < minIntervalMs) return { pace: prevPace, sample };
  const raw = (pct - sample.pct) / (now - sample.ts);
  return { pace: alpha * raw + (1 - alpha) * prevPace, sample: { pct, ts: now } };
}

/** Wall-clock relaxation: halve the pace every `halfLifeMs`. No-op for a
 *  non-positive pace or interval. */
export function decayPace(pace: number, dtMs: number, halfLifeMs: number): number {
  if (pace <= 0 || dtMs <= 0) return pace;
  return pace * Math.pow(0.5, dtMs / halfLifeMs);
}
