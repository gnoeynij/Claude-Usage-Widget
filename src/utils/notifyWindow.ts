/** The usage API recomputes `resets_at` per request, so the same 5h/7d
 *  window's timestamp jitters by (sub)seconds between polls (observed live:
 *  `09:29:59.159974` → `09:30:00.306225` across one sync). Exact string
 *  equality therefore reads every sync as a "new window", resetting the
 *  fired-notification flags and re-firing the threshold/projection toasts —
 *  the original every-sync toast annoyance, regressed from the server side.
 *
 *  Real windows are at least 5 hours apart, so a generous jitter tolerance
 *  cleanly separates "same window, drifted timestamp" from "new window". */
export const WINDOW_JITTER_TOLERANCE_MS = 10 * 60_000;

/** True when `incoming` names the same reset window as `stored`. */
export function isSameWindow(
  stored: string | null | undefined,
  incoming: string,
): boolean {
  if (stored == null) return false;
  if (stored === incoming) return true;
  const a = Date.parse(stored);
  const b = Date.parse(incoming);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) < WINDOW_JITTER_TOLERANCE_MS;
}
