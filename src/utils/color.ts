/** Threshold-based status color for gauge-style indicators (donut, capsule).
 *  Mirrors Apple's "stoplight" pattern: green well below limit, amber as
 *  the user approaches, red once they're over 80%. */
export function thresholdColor(v: number): string {
  if (v >= 80) return "var(--danger)";
  if (v >= 50) return "var(--warning)";
  return "var(--success)";
}
