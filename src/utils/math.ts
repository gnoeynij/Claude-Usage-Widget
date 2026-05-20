/** Clamp `n` to [min, max]. NaN/Infinity coerced to 0 so downstream UI
 *  (Donut, CapsuleProgress) never gets fed garbage from upstream maths. */
export function clamp(n: number, min = 0, max = 100): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}
