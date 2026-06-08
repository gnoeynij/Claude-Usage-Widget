/** USD cost with thousands separator and 2 decimals. Locale-fixed (en-US)
 *  because Claude pricing is published in USD and locale-dependent comma vs
 *  period would be ambiguous (e.g. "1.038,16" in fr-FR reads wrong here). */
export function formatCost(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Token count → short K/M/B. ModelsCard 우측 작은 column 에 들어가니 4-5
 *  char 안쪽으로 짧게. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1_000) return n.toFixed(0);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/** Live countdown parts to an ISO reset time. Returns null once the time has
 *  passed or the input is empty. Caller reads a tick signal for reactivity. */
export function formatCountdown(
  iso?: string | null,
): { h: number; m: number; s: number; totalMs: number } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  return {
    h: Math.floor(ms / 3_600_000),
    m: Math.floor((ms % 3_600_000) / 60_000),
    s: Math.floor((ms % 60_000) / 1000),
    totalMs: ms,
  };
}
