/**
 * Drawing labels are not table numbers: a dimension reads "336", never "336.00"
 * and never "1,104" — drafting practice drops the separator and any trailing
 * zero. (`fmt` from the engine is the right thing everywhere text is prose.)
 */
export function dim(value: number, dp = 2): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(dp);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/** Strain magnitudes, always 4 decimals: 0.0030, 0.0185. */
export function strain(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(4);
}
