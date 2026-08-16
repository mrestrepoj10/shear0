/**
 * Out-of-plane axial (11.5.3) and one-way shear (11.5.5.1 / 22.5.5.1) in SI
 * mode — ACI 318M-19 coefficients.
 *
 * Every expected value below is hand-computed from the **metric** expression.
 * Some coefficients of these two checks are homogeneous and print verbatim in
 * both editions (0.55 and 32 of Eq. 11.5.3.1; the 6 and the 0.05 f'c of
 * 22.5.5.1.2), while the √f'c terms are independently rounded in the metric
 * edition (8 → 0.66, 5 → 0.42, 100 psi → 8.3 MPa, d/10 → 0.004 d). Deriving any
 * of these numbers by converting the in-lb answer would assert the wrong thing.
 *
 * Wall: MNL-17(21) Shear Wall Examples 1 and 2 — 336 x 12 in. = 8534.4 x 304.8 mm,
 * h_w = 1104 in. = 28,041.6 mm, ℓ_c = 202 in. = 5130.8 mm, cover 1.5 in. = 38.1 mm,
 * f'c = 5000 psi = 34.4738 MPa, Grade 60 = 413.685 MPa.
 *   A_g = A_cv = 8534.4 x 304.8 = 2,601,285.12 mm²
 *   √f'c = √34.4738            = 5.87144 MPa^0.5
 *   Ex. 1 d = 304.8 - 38.1 - 15.875 - 15.875/2 = 242.8875 mm  (No. 5 / No. 5)
 *   Ex. 2 d = 304.8 - 38.1 - 19.05  - 25.4/2   = 234.95   mm  (No. 8 vert / No. 6 horiz)
 */
import { describe, expect, it } from "vitest";
import {
  checkOutOfPlaneShear,
  checkSimplifiedAxial,
  effectiveDepthOutOfPlane,
} from "../src/checks/out-of-plane";
import { GRADE60, concrete } from "../src/materials";
import { flattenTrace, validateTrace } from "../src/trace";
import type { CheckResult, Traced } from "../src/trace";
import type { Demands, WallInput } from "../src/wall";

const example1si: WallInput = {
  geometry: { lw: 336, h: 12, hw: 1104, lu: 202, k: 0.8, cover: 1.5 },
  concrete: concrete(5000),
  grade: GRADE60,
  vertical: { bar: "5", spacing: 12, curtains: 2 },
  horizontal: { bar: "5", spacing: 12, curtains: 2 },
  endZone: { bar: "5", count: 2, distanceToFirst: 3, spacing: 12 },
  demands: [{ id: "base", Pu: 1015, Mu: 18600, Vu: 235, MuOut: 60, VuOut: 16 }],
  wallType: "bearing",
  system: "ordinary",
  units: "si",
};

const example2si: WallInput = {
  ...example1si,
  vertical: { bar: "8", spacing: 12, curtains: 2 },
  horizontal: { bar: "6", spacing: 12, curtains: 2 },
  demands: [{ id: "base", Pu: 1015, Mu: 37200, Vu: 470, MuOut: 120, VuOut: 32 }],
  system: "special",
};

const d1: Demands = example1si.demands[0]!;
const d2: Demands = example2si.demands[0]!;

function roots(c: CheckResult): Traced<any>[] {
  return [c.demand, c.capacity, c.utilization, ...c.trace].filter(
    (n): n is Traced<any> => n !== undefined,
  );
}

function node(c: CheckResult, id: string): Traced<any> {
  for (const r of roots(c)) {
    for (const n of flattenTrace(r)) if (n.id === id) return n;
  }
  throw new Error(`trace node "${id}" not found`);
}

describe("effectiveDepthOutOfPlane in SI", () => {
  it("reports d in mm for Example 2", () => {
    // d = 304.8 - 38.1 - 19.05 - 25.4/2 = 234.95 mm
    const d = effectiveDepthOutOfPlane(example2si);
    expect(d.value).toBeCloseTo(234.95, 10);
    expect(d.unit).toBe("mm");
    expect(() => validateTrace([d])).not.toThrow();
  });

  it("reports d in mm for Example 1 (No. 5 bars)", () => {
    // d = 304.8 - 38.1 - 15.875 - 15.875/2 = 242.8875 mm
    expect(effectiveDepthOutOfPlane(example1si).value).toBeCloseTo(242.8875, 10);
  });

  it("traces its leaves in mm", () => {
    const d = effectiveDepthOutOfPlane(example2si);
    for (const n of flattenTrace(d)) expect(n.unit, n.id).toBe("mm");
  });
});

describe("checkSimplifiedAxial in SI (ACI 318M-19 11.5.3)", () => {
  const check = checkSimplifiedAxial(example1si, d1);

  it("produces a valid trace whose nodes are all metric", () => {
    expect(() => validateTrace(roots(check))).not.toThrow();
    for (const r of roots(check)) {
      for (const n of flattenTrace(r)) {
        expect(["mm", "mm2", "MPa", "kN", "kN-m", "1"], n.id).toContain(n.unit);
      }
    }
  });

  it("computes e = M_u/P_u in mm and e_max = h/6 in mm", () => {
    // P_u = 1015 kip = 4514.945 kN; M_u,oop = 60 kip-ft = 81.3491 kN·m
    // e = 81.3491 x 1000 / 4514.945 = 18.018 mm
    // e_max = 304.8/6 = 50.8 mm
    const e = node(check, "oop.e");
    expect(e.value).toBeCloseTo(18.018, 3);
    expect(e.unit).toBe("mm");
    expect(e.substitution).toContain("1{,}000");
    const eMax = node(check, "oop.e_max");
    expect(eMax.value).toBeCloseTo(50.8, 10);
    expect(eMax.unit).toBe("mm");
    expect(check.status).toBe("ok");
  });

  it("keeps the 32 of Eq. 11.5.3.1 unchanged in SI", () => {
    // kℓ_c/32h = 0.8 x 5130.8 / (32 x 304.8) = 4104.64/9753.6 = 0.4208333
    const s = node(check, "oop.slenderness");
    expect(s.value).toBeCloseTo(0.4208333, 7);
    expect(s.unit).toBe("1");
    expect(s.formula).toContain("32");
    expect(s.substitution).toContain("32 \\times");
  });

  it("computes P_n = 0.55 f'c A_g [1 - (kℓ_c/32h)²] in kN", () => {
    // 0.55 x 34.4738 x 2,601,285.12 x (1 - 0.4208333²) / 1000
    //   = 0.55 x 34.4738 x 2,601,285.12 x 0.822899 / 1000 = 40,586.9 kN
    const pn = node(check, "oop.Pn");
    expect(pn.value).toBeCloseTo(40586.94, 2);
    expect(pn.unit).toBe("kN");
    expect(pn.formula).toContain("0.55");
    expect(pn.note).toContain("MPa");
  });

  it("reports φP_n = 0.65 P_n in kN and the utilization", () => {
    // φP_n = 0.65 x 40,586.94 = 26,381.51 kN
    // P_u/φP_n = 4514.945 / 26,381.51 = 0.17114
    expect(node(check, "oop.phi_c").value).toBe(0.65);
    expect(check.capacity?.value).toBeCloseTo(26381.51, 2);
    expect(check.capacity?.unit).toBe("kN");
    expect(check.demand?.value).toBeCloseTo(4514.945, 3);
    expect(check.demand?.unit).toBe("kN");
    expect(check.utilization?.value).toBeCloseTo(0.171140, 6);
  });

  it("still applies at the Example 2 eccentricity", () => {
    // e = 120 kip-ft = 162.698 kN·m over 4514.945 kN → 36.035 mm ≤ 50.8 mm
    const c2 = checkSimplifiedAxial(example2si, d2);
    expect(node(c2, "oop.e").value).toBeCloseTo(36.035, 3);
    expect(c2.status).toBe("ok");
    expect(() => validateTrace(roots(c2))).not.toThrow();
  });

  it('reports "na" when e exceeds h/6 = 50.8 mm', () => {
    // M_u,oop = 300 kip-ft = 406.745 kN·m → e = 90.089 mm > 50.8 mm
    const c = checkSimplifiedAxial(example1si, { ...d1, MuOut: 300 });
    expect(node(c, "oop.e").value).toBeCloseTo(90.089, 3);
    expect(c.status).toBe("na");
    expect(c.capacity).toBeUndefined();
    expect(node(c, "oop.e").note).toContain("P–M");
    expect(() => validateTrace(roots(c))).not.toThrow();
  });

  it("never prints an in-lb unit in a metric substitution", () => {
    const json = JSON.stringify(check);
    expect(json).not.toContain("text{psi}");
    expect(json).not.toContain("text{kip}");
  });
});

describe("checkOutOfPlaneShear in SI (ACI 318M-19 22.5.5.1) — Example 2", () => {
  const check = checkOutOfPlaneShear(example2si, d2);

  it("produces a valid trace whose nodes are all metric", () => {
    expect(() => validateTrace(roots(check))).not.toThrow();
    for (const r of roots(check)) {
      for (const n of flattenTrace(r)) {
        expect(["mm", "mm2", "MPa", "kN", "kN-m", "1"], n.id).toContain(n.unit);
      }
    }
  });

  it("computes √f'c in MPa and reports the 8.3 MPa limit of 22.5.3.1 as non-governing", () => {
    // √34.4738 = 5.87144 MPa^0.5 < 8.3 MPa^0.5
    const s = node(check, "oop.sqrt_fc");
    expect(s.value).toBeCloseTo(5.87144, 5);
    expect(s.unit).toBe("MPa");
    expect(s.formula).toContain("8.3");
    expect(s.formula).not.toContain("100");
    expect(s.note).toContain("does not govern");
  });

  it("caps √f'c at 8.3 MPa (not 100 psi) for high-strength concrete", () => {
    // f'c = 12,000 psi = 82.737 MPa; √f'c = 9.0960 > 8.3 → capped at 8.3 MPa^0.5
    const strong: WallInput = { ...example2si, concrete: concrete(12000) };
    const c = checkOutOfPlaneShear(strong, d2);
    expect(node(c, "oop.sqrt_fc").value).toBe(8.3);
    expect(node(c, "oop.sqrt_fc").note).toContain("22.5.3.1");
    expect(node(c, "oop.sqrt_fc").note).toContain("MPa");
    expect(() => validateTrace(roots(c))).not.toThrow();
  });

  it("uses λ_s = √(2/(1 + 0.004 d)) with d in mm", () => {
    // d = 234.95 mm ≤ 250 mm → √(2/(1 + 0.004 x 234.95)) = √(2/1.9398) = 1.0154 → 1.0
    const ls = node(check, "oop.lambda_s");
    expect(ls.value).toBe(1);
    expect(ls.formula).toContain("0.004");
    expect(ls.formula).not.toContain("d/10");
    expect(ls.note).toContain("250 mm");
  });

  it("applies the size effect for a deep section, with the metric 0.004", () => {
    // h = 36 in. = 914.4 mm → d = 914.4 - 38.1 - 19.05 - 12.7 = 844.55 mm
    // λ_s = √(2/(1 + 0.004 x 844.55)) = √(2/4.3782) = 0.67588
    const thick: WallInput = { ...example2si, geometry: { ...example2si.geometry, h: 36 } };
    const c = checkOutOfPlaneShear(thick, d2);
    expect(node(c, "oop.d").value).toBeCloseTo(844.55, 10);
    expect(node(c, "oop.lambda_s").value).toBeCloseTo(0.675876, 6);
    expect(node(c, "oop.lambda_s").substitution).toContain("0.004");
    expect(() => validateTrace(roots(c))).not.toThrow();
  });

  it("computes A_s,w in mm² and the dimensionless ρ_w", () => {
    // A_b = 0.79 in² = 509.676 mm²; s = 304.8 mm
    // A_s,w = (8534.4/304.8) x 509.676 = 28 x 509.676 = 14,270.94 mm²
    // ρ_w = 14,270.94 / (8534.4 x 234.95) = 0.0071171
    const as = node(check, "oop.As_w");
    expect(as.value).toBeCloseTo(14270.9392, 4);
    expect(as.unit).toBe("mm2");
    const rho = node(check, "oop.rho_w");
    expect(rho.value).toBeCloseTo(0.0071171, 7);
    expect(rho.unit).toBe("1");
  });

  it("evaluates N_u/(6A_g) in MPa with the coefficients unchanged", () => {
    // N_u = 1015 kip = 4514.945 kN = 4,514,945 N; A_g = 2,601,285.12 mm²
    // 4,514,945 / (6 x 2,601,285.12) = 0.28928 MPa < 0.05 x 34.4738 = 1.72369 MPa
    const axial = node(check, "oop.axial_term");
    expect(axial.value).toBeCloseTo(0.289277, 6);
    expect(axial.unit).toBe("MPa");
    expect(axial.formula).toContain("6");
    expect(axial.formula).toContain("0.05");
    expect(axial.note).toContain("N_u taken in N");
  });

  it("caps N_u/(6A_g) at 0.05 f'c = 1.72369 MPa", () => {
    // N_u = 8000 kip = 35,585.77 kN → 35,585,773 / (6 x 2,601,285.12) = 2.28001 MPa
    const c = checkOutOfPlaneShear(example2si, { ...d2, Pu: 8000 });
    const axial = node(c, "oop.axial_term");
    expect(axial.value).toBeCloseTo(1.723689, 6);
    expect(axial.note).toContain("22.5.5.1.2");
    expect(axial.note).toContain("MPa");
    expect(() => validateTrace(roots(c))).not.toThrow();
  });

  it("uses the metric Table 22.5.5.1(c) coefficient 0.66 (not 8)", () => {
    const coeff = node(check, "oop.vc_coeff");
    expect(coeff.value).toBe(0.66);
    expect(coeff.note).toContain("318M");
    // V_c = (0.66 x 1.0 x 1.0 x 0.0071171^(1/3) x 5.87144 + 0.28928) x 8534.4 x 234.95 / 1000
    //     = (0.66 x 0.192354 x 5.87144 + 0.28928) x 2,005,158 / 1000
    //     = (0.745401 + 0.289277) x 2,005,158 / 1000 = 2074.69 kN
    const vc = node(check, "oop.Vc_calc");
    expect(vc.value).toBeCloseTo(2074.69, 2);
    expect(vc.unit).toBe("kN");
    expect(vc.formula).toContain("0.66");
    expect(vc.formula).not.toContain("8\\,\\lambda_s");
  });

  it("uses the metric 22.5.5.1.1 cap coefficient 0.42 (not 5)", () => {
    // V_c,max = 0.42 x 1.0 x 5.87144 x 8534.4 x 234.95 / 1000 = 4944.73 kN
    const vcMax = node(check, "oop.Vc_max");
    expect(vcMax.value).toBeCloseTo(4944.73, 2);
    expect(vcMax.unit).toBe("kN");
    expect(vcMax.formula).toContain("0.42");
    expect(node(check, "oop.Vc_calc").value).toBeLessThan(vcMax.value);
  });

  it("reports V_c, φV_c and the utilization in kN", () => {
    // V_c = min(2074.69, 4944.73) = 2074.69 kN; φV_c = 0.75 x 2074.69 = 1556.02 kN
    // V_u,oop = 32 kip = 142.343 kN → 142.343/1556.02 = 0.09148
    expect(node(check, "oop.Vc").value).toBeCloseTo(2074.69, 2);
    expect(node(check, "oop.Vc").note).toContain("V_s = 0");
    expect(check.capacity?.value).toBeCloseTo(1556.02, 2);
    expect(check.capacity?.unit).toBe("kN");
    expect(check.demand?.value).toBeCloseTo(142.343, 3);
    expect(check.demand?.unit).toBe("kN");
    expect(check.utilization?.value).toBeCloseTo(0.091479, 6);
    expect(check.status).toBe("ok");
  });

  it("reports ng when V_u,oop exceeds φV_c", () => {
    // 900 kip = 4003.4 kN > 1556.02 kN
    const c = checkOutOfPlaneShear(example2si, { ...d2, VuOut: 900 });
    expect(c.status).toBe("ng");
    expect(c.utilization?.value).toBeGreaterThan(1);
    expect(() => validateTrace(roots(c))).not.toThrow();
  });

  it("never prints an in-lb unit in a metric substitution", () => {
    const json = JSON.stringify(check);
    expect(json).not.toContain("text{psi}");
    expect(json).not.toContain("text{kip}");
    expect(json).not.toContain("text{in}");
  });
});

describe("the in-lb default is untouched", () => {
  const { units: _si, ...inLb1 } = example1si;
  const { units: _si2, ...inLb2 } = example2si;

  it("keeps the in-lb simplified-axial result when `units` is absent", () => {
    const check = checkSimplifiedAxial(inLb1 as WallInput, d1);
    expect(node(check, "oop.e").value).toBeCloseTo(0.709, 3);
    expect(node(check, "oop.e_max").value).toBe(2);
    expect(node(check, "oop.Pn").value).toBeCloseTo(9124.3, 0);
    expect(check.capacity?.unit).toBe("kip");
  });

  it("keeps the in-lb 8 / 5 / 100 psi coefficients when `units` is absent", () => {
    const check = checkOutOfPlaneShear(inLb2 as WallInput, d2);
    expect(node(check, "oop.vc_coeff").value).toBe(8);
    expect(node(check, "oop.sqrt_fc").value).toBeCloseTo(Math.sqrt(5000), 6);
    expect(node(check, "oop.sqrt_fc").formula).toContain("100");
    expect(node(check, "oop.lambda_s").formula).toContain("d/10");
    expect(node(check, "oop.Vc_max").formula).toContain("5\\,\\lambda");
    expect(node(check, "oop.d").value).toBeCloseTo(9.25, 12);
    expect(check.capacity?.unit).toBe("kip");
  });
});
