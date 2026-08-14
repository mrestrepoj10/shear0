import { aci, derive, input } from "./trace";
import type { Traced } from "./trace";
import { fmtTex, ksiToPsi, psiToKsi, sqrtFcPsi } from "./units";

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

// Leaf nodes are memoized per source object so that two checks sharing an input
// share one node — trace ids are unique within a graph, and the DAG stays a DAG
// when check traces are merged.
const fcNodes = new WeakMap<Concrete, Traced>();
const lambdaNodes = new WeakMap<Concrete, Traced>();

// f'c is stored in ksi but traced in psi: every ACI in-lb expression that
// consumes it (β1 table, 57000√f'c, √f'c shear terms) is written in psi, so the
// trace reads the way the Code reads.
export function fcInput(c: Concrete): Traced {
  let node = fcNodes.get(c);
  if (node === undefined) {
    node = input("materials.fc", "f'_c", "specified concrete compressive strength", ksiToPsi(c.fc), "psi");
    fcNodes.set(c, node);
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

/** β1 per ACI 318-19 Table 22.2.2.4.3 (in-lb). */
export function beta1(c: Concrete): Traced {
  const fc = fcInput(c);
  const fcPsi = ksiToPsi(c.fc);
  let value: number;
  let formula: string;
  let substitution: string;
  let note: string;
  if (fcPsi <= 4000) {
    value = 0.85;
    formula = "\\beta_1 = 0.85";
    substitution = "\\beta_1 = 0.85";
    note = "f'_c ≤ 4000 psi";
  } else if (fcPsi < 8000) {
    value = 0.85 - (0.05 * (fcPsi - 4000)) / 1000;
    formula = "\\beta_1 = 0.85 - \\frac{0.05\\,(f'_c - 4000)}{1000}";
    substitution = `\\beta_1 = 0.85 - \\frac{0.05\\,(${fmtTex(fcPsi)} - 4000)}{1000} = ${fmtTex(value, { dp: 3 })}`;
    note = "4000 < f'_c < 8000 psi";
  } else {
    value = 0.65;
    formula = "\\beta_1 = 0.65";
    substitution = "\\beta_1 = 0.65";
    note = "f'_c ≥ 8000 psi";
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

/** Ec for normalweight concrete, 19.2.2.1(b). Returned in psi. */
export function Ec(c: Concrete): Traced {
  const fc = fcInput(c);
  const value = 57000 * sqrtFcPsi(c.fc);
  return derive({
    id: "materials.Ec",
    symbol: "E_c",
    label: "concrete modulus of elasticity",
    value,
    unit: "psi",
    formula: "E_c = 57000\\sqrt{f'_c}",
    substitution: `E_c = 57000\\sqrt{${fmtTex(ksiToPsi(c.fc))}} = ${fmtTex(value)}\\ \\text{psi}`,
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
