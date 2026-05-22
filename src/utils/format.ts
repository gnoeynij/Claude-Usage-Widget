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
