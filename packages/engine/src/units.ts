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
  | "1"
  | "pct";

// Canonical internal system: kip, in, ksi. Stresses are stored in ksi so that
// kip/in/ksi stay dimensionally consistent, but ACI in-lb coefficients are
// calibrated to psi — conversion happens at the formula site, never in storage.

export const ftToIn = (ft: number): number => ft * 12;
export const inToFt = (inches: number): number => inches / 12;
export const kipFtToKipIn = (kipFt: number): number => kipFt * 12;
export const kipInToKipFt = (kipIn: number): number => kipIn / 12;
export const psiToKsi = (psi: number): number => psi / 1000;
export const ksiToPsi = (ksi: number): number => ksi * 1000;

const CONVERSIONS = new Map<string, (v: number) => number>([
  ["ft->in", ftToIn],
  ["in->ft", inToFt],
  ["kip-ft->kip-in", kipFtToKipIn],
  ["kip-in->kip-ft", kipInToKipFt],
  ["psi->ksi", psiToKsi],
  ["ksi->psi", ksiToPsi],
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
