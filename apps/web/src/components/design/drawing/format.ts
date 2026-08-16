import type { UnitsView } from "@/lib/units-view";

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

/**
 * A canonical inch, dimensioned in the wall's units. A drawing is dimensioned to
 * the precision its unit is drafted in — 8534 mm, never 8534.40 — so SI drops
 * the decimals the imperial label keeps.
 */
export function lenDim(U: UnitsView, inches: number, dp = 2): string {
  return dim(U.len(inches), U.si ? 0 : dp);
}

/** Same, for an area: in² | mm². */
export function areaDim(U: UnitsView, in2: number, dp = 2): string {
  return dim(U.area(in2), U.si ? 0 : dp);
}

/** Strain magnitudes, always 4 decimals: 0.0030, 0.0185. */
export function strain(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(4);
}
