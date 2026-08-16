export type Unit =
  | "kip"
  | "kip-ft"
  | "kip-in"
  | "in"
  | "ft"
  | "in2"
  | "in3"
  | "in4"
  | "ksi"
  | "psi"
  | "kN"
  | "kN-m"
  | "kN-mm"
  | "mm"
  | "m"
  | "mm2"
  | "mm3"
  | "mm4"
  | "MPa"
  | "1"
  | "pct";

// Canonical internal system: kip, in, ksi. Stresses are stored in ksi so that
// kip/in/ksi stay dimensionally consistent, but ACI in-lb coefficients are
// calibrated to psi — conversion happens at the formula site, never in storage.
//
// The same seam carries the metric edition. ACI 318M-19 is a *separate* code
// with its own independently rounded coefficients (0.17 is not 2/12.1 exactly,
// 4700 is not 57000/12.1 exactly), so SI mode is never "imperial results with
// the numbers converted": each formula site branches to the 318M expression and
// evaluates it in MPa/mm/N. Storage stays kip/in/ksi; only the formula site and
// the trace it emits change. See `UnitScheme` below.

/**
 * Which edition of ACI 318-19 the formula sites and traces speak.
 *
 * - `"in-lb"` — ACI 318-19, stresses in psi (the default; nothing changes).
 * - `"si"` — ACI 318M-19, stresses in MPa, lengths in mm, forces in kN.
 */
export type UnitSystem = "in-lb" | "si";

export const DEFAULT_UNIT_SYSTEM: UnitSystem = "in-lb";

export const ftToIn = (ft: number): number => ft * 12;
export const inToFt = (inches: number): number => inches / 12;
export const kipFtToKipIn = (kipFt: number): number => kipFt * 12;
export const kipInToKipFt = (kipIn: number): number => kipIn / 12;
export const psiToKsi = (psi: number): number => psi / 1000;
export const ksiToPsi = (ksi: number): number => ksi * 1000;

// Exact (or NIST-exact) SI factors. These convert *inputs and reported values*
// between the two systems; they never convert a result computed with one
// edition's coefficients into the other edition's answer.
export const inToMm = (inches: number): number => inches * 25.4;
export const mmToIn = (mm: number): number => mm / 25.4;
export const ftToM = (ft: number): number => ft * 0.3048;
export const mToFt = (m: number): number => m / 0.3048;
export const in2ToMm2 = (in2: number): number => in2 * 645.16;
export const mm2ToIn2 = (mm2: number): number => mm2 / 645.16;
export const in3ToMm3 = (in3: number): number => in3 * 16387.064;
export const mm3ToIn3 = (mm3: number): number => mm3 / 16387.064;
export const in4ToMm4 = (in4: number): number => in4 * 416231.4256;
export const mm4ToIn4 = (mm4: number): number => mm4 / 416231.4256;
export const ksiToMPa = (ksi: number): number => ksi * 6.894757293168361;
export const mPaToKsi = (mpa: number): number => mpa / 6.894757293168361;
export const kipToKn = (kip: number): number => kip * 4.4482216152605;
export const knToKip = (kn: number): number => kn / 4.4482216152605;
export const kipFtToKnM = (kipFt: number): number => kipFt * 1.3558179483314004;
export const knMToKipFt = (knM: number): number => knM / 1.3558179483314004;

const CONVERSIONS = new Map<string, (v: number) => number>([
  ["ft->in", ftToIn],
  ["in->ft", inToFt],
  ["kip-ft->kip-in", kipFtToKipIn],
  ["kip-in->kip-ft", kipInToKipFt],
  ["psi->ksi", psiToKsi],
  ["ksi->psi", ksiToPsi],
  ["in->mm", inToMm],
  ["mm->in", mmToIn],
  ["ft->m", ftToM],
  ["m->ft", mToFt],
  ["in2->mm2", in2ToMm2],
  ["mm2->in2", mm2ToIn2],
  ["in3->mm3", in3ToMm3],
  ["mm3->in3", mm3ToIn3],
  ["in4->mm4", in4ToMm4],
  ["mm4->in4", mm4ToIn4],
  ["ksi->MPa", ksiToMPa],
  ["MPa->ksi", mPaToKsi],
  ["psi->MPa", (v) => ksiToMPa(psiToKsi(v))],
  ["MPa->psi", (v) => ksiToPsi(mPaToKsi(v))],
  ["kip->kN", kipToKn],
  ["kN->kip", knToKip],
  ["kip-ft->kN-m", kipFtToKnM],
  ["kN-m->kip-ft", knMToKipFt],
  ["1->pct", (v) => v * 100],
  ["pct->1", (v) => v / 100],
]);

export function convert(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  const f = CONVERSIONS.get(`${from}->${to}`);
  if (!f) throw new Error(`unsupported unit conversion: ${from} -> ${to}`);
  return f(value);
}

/**
 * √f'c with f'c in psi, returned in psi^0.5 — the building block of every ACI
 * in-lb strength term. The in-lb coefficients (2, 8, 57000, ...) multiply this
 * psi value, so results land in psi/lb and must be converted back to ksi/kip
 * by the caller.
 */
export function sqrtFcPsi(fc_ksi: number): number {
  if (fc_ksi < 0) throw new Error(`f'c must be non-negative, got ${fc_ksi} ksi`);
  return Math.sqrt(ksiToPsi(fc_ksi));
}

/**
 * √f'c with f'c in MPa, returned in MPa^0.5 — the building block of every ACI
 * 318M strength term. The metric coefficients (0.17, 0.66, 4700, ...) multiply
 * this MPa value, so results land in MPa/N and must be converted back to kN by
 * the caller (÷1000 once A is in mm²).
 *
 * The argument is still f'c in the canonical ksi, because storage never leaves
 * kip/in/ksi — this helper is the formula-site conversion, exactly as
 * `sqrtFcPsi` is for the in-lb edition.
 */
export function sqrtFcMPa(fc_ksi: number): number {
  if (fc_ksi < 0) throw new Error(`f'c must be non-negative, got ${fc_ksi} ksi`);
  return Math.sqrt(ksiToMPa(fc_ksi));
}

/**
 * The per-system vocabulary a formula site needs: which `Unit` tags its traced
 * nodes carry, and how to move a canonical (kip/in/ksi) magnitude into the
 * system the equation is written in.
 *
 * A check builds its whole trace in one scheme, so every node in a graph agrees
 * on units and the substitutions read like the printed Code. Utilizations and
 * status decisions are ratios, so they are identical either way.
 */
export interface UnitScheme {
  system: UnitSystem;
  /** true in SI mode — the branch guard formula sites read */
  si: boolean;
  /** unit tag for lengths */
  length: Unit;
  /** unit tag for areas */
  area: Unit;
  /** unit tag for section moduli */
  section3: Unit;
  /** unit tag for moments of inertia */
  section4: Unit;
  /** unit tag for forces */
  force: Unit;
  /** unit tag for moments */
  moment: Unit;
  /** unit tag for stresses as the Code writes them (psi / MPa) */
  stress: Unit;
  /** in → in | mm */
  len: (in_: number) => number;
  /** in² → in² | mm² */
  ar: (in2: number) => number;
  /** in³ → in³ | mm³ */
  sec3: (in3: number) => number;
  /** in⁴ → in⁴ | mm⁴ */
  sec4: (in4: number) => number;
  /** kip → kip | kN */
  frc: (kip: number) => number;
  /** kip-ft → kip-ft | kN·m */
  mom: (kipFt: number) => number;
  /** ksi → psi | MPa — the stress unit the Code equations are written in */
  str: (ksi: number) => number;
  /** f'c (ksi) → √f'c in psi^0.5 | MPa^0.5 */
  sqrtFc: (fc_ksi: number) => number;
  /** LaTeX for the stress unit, e.g. `\text{psi}` */
  stressTex: string;
  /** LaTeX for the length unit */
  lengthTex: string;
  /** LaTeX for the area unit */
  areaTex: string;
  /** LaTeX for the force unit */
  forceTex: string;
}

const IN_LB_SCHEME: UnitScheme = {
  system: "in-lb",
  si: false,
  length: "in",
  area: "in2",
  section3: "in3",
  section4: "in4",
  force: "kip",
  moment: "kip-ft",
  stress: "psi",
  len: (v) => v,
  ar: (v) => v,
  sec3: (v) => v,
  sec4: (v) => v,
  frc: (v) => v,
  mom: (v) => v,
  str: ksiToPsi,
  sqrtFc: sqrtFcPsi,
  stressTex: "\\text{psi}",
  lengthTex: "\\text{in}",
  areaTex: "\\text{in}^2",
  forceTex: "\\text{kip}",
};

const SI_SCHEME: UnitScheme = {
  system: "si",
  si: true,
  length: "mm",
  area: "mm2",
  section3: "mm3",
  section4: "mm4",
  force: "kN",
  moment: "kN-m",
  stress: "MPa",
  len: inToMm,
  ar: in2ToMm2,
  sec3: in3ToMm3,
  sec4: in4ToMm4,
  frc: kipToKn,
  mom: kipFtToKnM,
  str: ksiToMPa,
  sqrtFc: sqrtFcMPa,
  stressTex: "\\text{MPa}",
  lengthTex: "\\text{mm}",
  areaTex: "\\text{mm}^2",
  forceTex: "\\text{kN}",
};

export function unitScheme(system: UnitSystem = DEFAULT_UNIT_SYSTEM): UnitScheme {
  return system === "si" ? SI_SCHEME : IN_LB_SCHEME;
}

export interface FmtOptions {
  dp?: number;
}

export function fmt(value: number, opts: FmtOptions = {}): string {
  if (!Number.isFinite(value)) return String(value);
  const negative = value < 0;
  const abs = Math.abs(value);
  let body: string;
  if (opts.dp === undefined && abs !== 0 && abs < 0.1) {
    body = trimZeros(abs.toPrecision(3));
  } else {
    body = abs.toFixed(opts.dp ?? autoDp(abs));
  }
  if (body.includes("e")) return negative ? `-${body}` : body;
  const [intPart = "0", fracPart] = body.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const out = fracPart === undefined ? grouped : `${grouped}.${fracPart}`;
  return negative && Number(body) !== 0 ? `-${out}` : out;
}

/** fmt for LaTeX substitutions — `{,}` keeps KaTeX from spacing the separator. */
export function fmtTex(value: number, opts: FmtOptions = {}): string {
  return fmt(value, opts).replace(/,/g, "{,}");
}

function autoDp(abs: number): number {
  if (abs >= 100 || abs === 0) return 0;
  if (abs >= 10) return 1;
  if (abs >= 1) return 2;
  return 3;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}
