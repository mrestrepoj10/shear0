import { aci, derive, input } from "./trace";
import type { Traced } from "./trace";
import { fmtTex, mPaToKsi, psiToKsi, unitScheme } from "./units";
import type { UnitScheme } from "./units";

export interface Concrete {
  /** specified compressive strength, ksi */
  fc: number;
  /** lightweight modification factor λ, 19.2.4 */
  lambda: number;
}

export function concrete(fcPsi: number, lambda = 1.0): Concrete {
  if (fcPsi <= 0) throw new Error(`f'c must be positive, got ${fcPsi} psi`);
  return { fc: psiToKsi(fcPsi), lambda };
}

/**
 * `concrete()` for SI-native input — f'c given in MPa, stored in the canonical
 * ksi like everything else. Storage never leaves kip/in/ksi; only the formula
 * sites and traces change with `WallInput.units`.
 */
export function concreteMPa(fcMPa: number, lambda = 1.0): Concrete {
  if (fcMPa <= 0) throw new Error(`f'c must be positive, got ${fcMPa} MPa`);
  return { fc: mPaToKsi(fcMPa), lambda };
}

// Leaf nodes are memoized per source object so that two checks sharing an input
// share one node — trace ids are unique within a graph, and the DAG stays a DAG
// when check traces are merged.
const fcNodes = new WeakMap<Concrete, Map<string, Traced>>();
const lambdaNodes = new WeakMap<Concrete, Traced>();

// f'c is stored in ksi but traced in the stress unit of the edition in force:
// every ACI in-lb expression that consumes it (β1 table, 57000√f'c, √f'c shear
// terms) is written in psi, and every ACI 318M expression (β1 table, 4700√f'c,
// 0.17√f'c) is written in MPa — so the trace reads the way the Code reads. The
// leaf is memoized per (concrete, system): a single graph is built in one
// system, and the two systems must not share a node id.
export function fcInput(c: Concrete, U: UnitScheme = unitScheme()): Traced {
  let bySystem = fcNodes.get(c);
  if (bySystem === undefined) {
    bySystem = new Map();
    fcNodes.set(c, bySystem);
  }
  let node = bySystem.get(U.system);
  if (node === undefined) {
    node = input(
      "materials.fc",
      "f'_c",
      "specified concrete compressive strength",
      U.str(c.fc),
      U.stress,
    );
    bySystem.set(U.system, node);
  }
  return node;
}

export function lambdaInput(c: Concrete): Traced {
  let node = lambdaNodes.get(c);
  if (node === undefined) {
    node = input(
      "materials.lambda",
      "λ",
      "lightweight concrete modification factor",
      c.lambda,
      "1",
      c.lambda === 1 ? "normalweight concrete" : undefined,
    );
    lambdaNodes.set(c, node);
  }
  return node;
}

/**
 * β1 per ACI 318-19 Table 22.2.2.4.3.
 *
 * The table is nonhomogeneous, so the two editions carry independently rounded
 * breakpoints and slopes:
 *   in-lb  — 0.85 (f'c ≤ 4000 psi); 0.85 − 0.05(f'c − 4000)/1000; 0.65 (≥ 8000)
 *   ACI 318M-19 Table 22.2.2.4.3 — 0.85 (f'c ≤ 28 MPa); 0.85 − 0.05(f'c − 28)/7;
 *   0.65 (f'c ≥ 55 MPa)
 */
export function beta1(c: Concrete, U: UnitScheme = unitScheme()): Traced {
  const fc = fcInput(c, U);
  const fcCode = U.str(c.fc);
  // Table breakpoints and slope divisor, per edition.
  const lo = U.si ? 28 : 4000;
  const hi = U.si ? 55 : 8000;
  const div = U.si ? 7 : 1000;
  const unit = U.si ? "MPa" : "psi";
  let value: number;
  let formula: string;
  let substitution: string;
  let note: string;
  if (fcCode <= lo) {
    value = 0.85;
    formula = "\\beta_1 = 0.85";
    substitution = "\\beta_1 = 0.85";
    note = `f'_c ≤ ${lo} ${unit}`;
  } else if (fcCode < hi) {
    value = 0.85 - (0.05 * (fcCode - lo)) / div;
    formula = `\\beta_1 = 0.85 - \\frac{0.05\\,(f'_c - ${lo})}{${div}}`;
    substitution = `\\beta_1 = 0.85 - \\frac{0.05\\,(${fmtTex(fcCode)} - ${lo})}{${div}} = ${fmtTex(value, { dp: 3 })}`;
    note = `${lo} < f'_c < ${hi} ${unit}`;
  } else {
    value = 0.65;
    formula = "\\beta_1 = 0.65";
    substitution = "\\beta_1 = 0.65";
    note = `f'_c ≥ ${hi} ${unit}`;
  }
  return derive({
    id: "materials.beta1",
    symbol: "β_1",
    label: "equivalent rectangular stress block depth factor",
    value,
    unit: "1",
    formula,
    substitution,
    ref: aci("22.2.2.4.3"),
    inputs: [fc],
    note,
  });
}

/**
 * Ec for normalweight concrete, 19.2.2.1(b), in the stress unit of the edition
 * in force.
 *
 *   in-lb — E_c = 57000√f'c  (f'c, E_c in psi)
 *   SI    — E_c = 4700√f'c   (f'c, E_c in MPa), ACI 318M-19 19.2.2.1(b)
 *
 * 4700 is the metric edition's own rounding, not 57000 converted (that would be
 * 4730), so SI mode evaluates the printed metric expression.
 */
export function Ec(c: Concrete, U: UnitScheme = unitScheme()): Traced {
  const fc = fcInput(c, U);
  const coeff = U.si ? 4700 : 57000;
  const value = coeff * U.sqrtFc(c.fc);
  return derive({
    id: "materials.Ec",
    symbol: "E_c",
    label: "concrete modulus of elasticity",
    value,
    unit: U.stress,
    formula: `E_c = ${coeff}\\sqrt{f'_c}`,
    substitution: `E_c = ${coeff}\\sqrt{${fmtTex(U.str(c.fc))}} = ${fmtTex(value)}\\ ${U.stressTex}`,
    ref: aci("19.2.2.1.b"),
    inputs: [fc],
    note: "normalweight concrete",
  });
}

export interface RebarGrade {
  /** specified yield strength, ksi */
  fy: number;
  /** modulus of elasticity, ksi (20.2.2.2) */
  Es: number;
  /** yield strain ε_ty, 21.2.2.1 */
  ety: number;
}

const ES = 29000;

export const GRADE60: RebarGrade = { fy: 60, Es: ES, ety: 0.002 };
export const GRADE80: RebarGrade = { fy: 80, Es: ES, ety: 80 / ES };

// Metric grades of ACI 318M-19. Like every other stored quantity these are held
// in ksi; only the trace renders them in MPa. E_s is the metric edition's own
// 200,000 MPa (20.2.2.2), which is 29,008 ksi — not 29,000 ksi converted — so
// the metric grades carry it exactly.
const ES_METRIC = mPaToKsi(200000);

/** ACI 318M-19 Grade 420 (f_y = 420 MPa), ε_ty = 0.0021 per 21.2.2.1. */
export const GRADE420: RebarGrade = {
  fy: mPaToKsi(420),
  Es: ES_METRIC,
  ety: 0.0021,
};

/** ACI 318M-19 Grade 550 (f_y = 550 MPa), ε_ty = f_y/E_s per 21.2.2.1. */
export const GRADE550: RebarGrade = {
  fy: mPaToKsi(550),
  Es: ES_METRIC,
  ety: 550 / 200000,
};

export type BarSize = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11";

export interface Bar {
  /** nominal diameter, in */
  db: number;
  /** nominal area, in2 */
  Ab: number;
}

export const BARS: Record<BarSize, Bar> = {
  "3": { db: 0.375, Ab: 0.11 },
  "4": { db: 0.5, Ab: 0.2 },
  "5": { db: 0.625, Ab: 0.31 },
  "6": { db: 0.75, Ab: 0.44 },
  "7": { db: 0.875, Ab: 0.6 },
  "8": { db: 1.0, Ab: 0.79 },
  "9": { db: 1.128, Ab: 1.0 },
  "10": { db: 1.27, Ab: 1.27 },
  "11": { db: 1.41, Ab: 1.56 },
};

export function bar(size: BarSize): Bar {
  return BARS[size];
}
