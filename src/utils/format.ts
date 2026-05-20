/** USD cost with thousands separator and 2 decimals. Locale-fixed (en-US)
 *  because Claude pricing is published in USD and locale-dependent comma vs
 *  period would be ambiguous (e.g. "1.038,16" in fr-FR reads wrong here). */
export function formatCost(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
