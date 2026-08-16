/**
 * The unit system, as the *interface* sees it.
 *
 * The engine already owns the honest half: `WallInput.units` selects which
 * edition of the code every formula site evaluates (ACI 318-19 in psi vs ACI
 * 318M-19 in MPa), and `schemeOf(w)` hands each check the vocabulary its traced
 * nodes carry. Storage never leaves the canonical kip/in/ksi system, in either
 * mode — so an SI report is the metric equation evaluated in MPa/mm/kN, not an
 * imperial answer with the numbers converted afterwards.
 *
 * This module is the other half: what the *fields, labels and drawings* say.
 * It wraps `UnitScheme` with
 *
 *   - the display spelling of each unit (`in²`, `mm²`, `kN·m` — the trace's
 *     `Unit` tags are machine tags, `kN-m` is not how a moment is written), and
 *   - the inverse of each conversion, so a number typed in mm can go back to
 *     the canonical inches.
 *
 * Every factor comes from the engine's own `convert()`. Nothing here knows what
 * 25.4 is, and there is exactly one place in the codebase that does.
 *
 * Plain module, no `"use client"`: the calc-sheet builders run on the server.
 */

import {
  convert,
  unitScheme,
  unitsOf,
  type Unit,
  type UnitScheme,
  type UnitSystem,
  type WallInput,
} from "@shear0/engine";

export type { UnitSystem };

/** How a unit tag is written for a reader, as opposed to tagged on a node. */
const SPELLING: Partial<Record<Unit, string>> = {
  in2: "in²",
  mm2: "mm²",
  "kN-m": "kN·m",
};

function spell(unit: Unit): string {
  return SPELLING[unit] ?? unit;
}

/**
 * Decimal places a converted value is *shown* with, per quantity.
 *
 * Imperial is `undefined` throughout — the stored number is the number the user
 * typed, and rounding it for display would put "12" on screen as "12.00". In SI
 * every field is a conversion of a canonical inch, so it is rounded to the
 * precision the unit is dimensioned in (whole mm, 0.1 kN) rather than shown as
 * 8534.400000000001.
 */
interface Precision {
  length?: number;
  area?: number;
  force?: number;
  moment?: number;
  stress?: number;
}

const IN_LB_DP: Precision = {};
const SI_DP: Precision = { length: 0, area: 0, force: 1, moment: 1, stress: 1 };

/**
 * Rounds for display only. The canonical value is left exactly as stored, so
 * flipping the toggle back and forth is lossless — a field shows 8534 mm while
 * the wall is still 336 in, and only *typing* 8534 makes it 8534 mm for real.
 */
function round(value: number, dp: number | undefined): number {
  if (dp === undefined || !Number.isFinite(value)) return value;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

export interface UnitsView {
  system: UnitSystem;
  /** true in SI mode — the same guard the engine's formula sites read */
  si: boolean;
  /** the engine vocabulary this view wraps */
  scheme: UnitScheme;

  // --- how each unit is written ------------------------------------------
  lengthUnit: string;
  areaUnit: string;
  forceUnit: string;
  momentUnit: string;
  stressUnit: string;

  // --- canonical (kip/in/ksi) → display, rounded for the field ------------
  /** in → in | mm */
  len: (in_: number) => number;
  /** in² → in² | mm² */
  area: (in2: number) => number;
  /** kip → kip | kN */
  force: (kip: number) => number;
  /** kip-ft → kip-ft | kN·m */
  moment: (kipFt: number) => number;
  /** ksi → psi | MPa */
  stress: (ksi: number) => number;

  // --- display → canonical, for a number the user typed -------------------
  /** in | mm → in */
  toIn: (v: number) => number;
  /** in² | mm² → in² */
  toIn2: (v: number) => number;
  /** kip | kN → kip */
  toKip: (v: number) => number;
  /** kip-ft | kN·m → kip-ft */
  toKipFt: (v: number) => number;
  /** psi | MPa → ksi */
  toKsi: (v: number) => number;

  /** A sensible `step` for a length field: 1 in vs 25 mm, 0.25 in vs 5 mm. */
  lengthStep: (inches: number) => number;
}

function make(system: UnitSystem): UnitsView {
  const U = unitScheme(system);
  const dp = U.si ? SI_DP : IN_LB_DP;
  return {
    system,
    si: U.si,
    scheme: U,
    lengthUnit: spell(U.length),
    areaUnit: spell(U.area),
    forceUnit: spell(U.force),
    momentUnit: spell(U.moment),
    stressUnit: spell(U.stress),
    len: (v) => round(U.len(v), dp.length),
    area: (v) => round(U.ar(v), dp.area),
    force: (v) => round(U.frc(v), dp.force),
    moment: (v) => round(U.mom(v), dp.moment),
    stress: (v) => round(U.str(v), dp.stress),
    toIn: (v) => convert(v, U.length, "in"),
    toIn2: (v) => convert(v, U.area, "in2"),
    toKip: (v) => convert(v, U.force, "kip"),
    toKipFt: (v) => convert(v, U.moment, "kip-ft"),
    toKsi: (v) => convert(v, U.stress, "ksi"),
    lengthStep: (inches) => (U.si ? round(U.len(inches), 0) : inches),
  };
}

const IN_LB_VIEW = make("in-lb");
const SI_VIEW = make("si");

export function unitsView(system: UnitSystem = "in-lb"): UnitsView {
  return system === "si" ? SI_VIEW : IN_LB_VIEW;
}

/** The view for a wall — `"in-lb"` unless the wall says otherwise. */
export function viewOf(w: WallInput): UnitsView {
  return unitsView(unitsOf(w));
}

/** How the toggle names each system: short on the control, whole in its label. */
export const UNIT_SYSTEM_SHORT: Record<UnitSystem, string> = {
  "in-lb": "in-lb",
  si: "SI",
};

export const UNIT_SYSTEM_LABELS: Record<UnitSystem, string> = {
  "in-lb": "imperial — ACI 318-19, in-lb",
  si: "metric — ACI 318M-19, SI",
};

export const UNIT_SYSTEM_ORDER: UnitSystem[] = ["in-lb", "si"];
