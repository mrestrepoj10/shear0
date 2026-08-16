/**
 * In-plane shear (11.5.4) in SI mode — ACI 318M-19 coefficients.
 *
 * Every expected value below is hand-computed from the **metric** expression.
 * The metric coefficients are independently rounded (0.17 is 2.4% above
 * 2 x 0.083, 0.66 is 0.6% below 8 x 0.083), so deriving these numbers by
 * converting the in-lb answer would assert the wrong thing.
 *
 * Wall: MNL-17(21) Shear Wall Example 1 — 336 x 12 in. = 8534.4 x 304.8 mm,
 * f'c = 5000 psi = 34.4738 MPa, Grade 60 = 413.685 MPa, No. 5 @ 12 in. e.f.
 *   A_cv = 8534.4 x 304.8      = 2,601,285 mm²
 *   √f'c = √34.4738            = 5.87144 MPa^0.5
 *   h_w/ℓ_w = 1104/336 = 3.286 ≥ 2.0  →  α_c = 0.17
 *   ρ_t  = 2 x 200.0 / (304.8 x 304.8) = 0.0043056  (dimensionless — unchanged)
 */
import { describe, expect, it } from "vitest";
import { alphaC, checkInPlaneShear } from "../src/checks/shear-in-plane";
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

const base: Demands = example1si.demands[0]!;

function node(c: CheckResult, id: string): Traced<any> {
  const roots = [c.demand, c.capacity, c.utilization, ...c.trace].filter(
    (n): n is Traced<any> => n !== undefined,
  );
  for (const r of roots) {
    for (const n of flattenTrace(r)) if (n.id === id) return n;
  }
  throw new Error(`trace node "${id}" not found`);
}

function withAspect(ratio: number): WallInput {
  return {
    ...example1si,
    geometry: { ...example1si.geometry, hw: ratio * example1si.geometry.lw },
  };
}

describe("alphaC in SI (ACI 318M-19 11.5.4.3)", () => {
  it("uses 0.17 for the Example 1 wall (hw/lw = 3.29)", () => {
    const a = alphaC(example1si);
    expect(a.value).toBe(0.17);
    expect(a.ref?.section).toBe("11.5.4.3");
    expect(a.formula).toContain("0.170");
    expect(a.formula).not.toContain("= 2 ");
    expect(() => validateTrace([a])).not.toThrow();
  });

  it("uses 0.25 at hw/lw = 1.5 and below", () => {
    expect(alphaC(withAspect(1.5)).value).toBe(0.25);
    expect(alphaC(withAspect(1.0)).value).toBe(0.25);
  });

  it("uses 0.17 at hw/lw = 2.0", () => {
    expect(alphaC(withAspect(2.0)).value).toBe(0.17);
  });

  it("interpolates linearly to 0.21 at hw/lw = 1.75", () => {
    // 0.25 - 0.16(1.75 - 1.5) = 0.21
    expect(alphaC(withAspect(1.75)).value).toBeCloseTo(0.21, 12);
  });

  it("reduces alpha_c under net axial tension (ACI 318M-19 Eq. 11.5.4.4)", () => {
    // N_u = -100 kip = -444.822 kN = -444,822 N; A_g = 2,601,285 mm²
    // 0.17(1 + (-444,822)/(3.5 x 2,601,285)) = 0.17(1 - 0.048857) = 0.161694
    const tension: Demands = { ...base, Pu: -100 };
    const a = alphaC(example1si, tension);
    expect(a.value).toBeCloseTo(0.161694, 6);
    expect(a.formula).toContain("3.5");
    expect(a.formula).toContain("0.17");
  });

  it("floors alpha_c at zero under heavy tension", () => {
    const tension: Demands = { ...base, Pu: -5000 };
    expect(alphaC(example1si, tension).value).toBe(0);
  });
});

describe("checkInPlaneShear in SI", () => {
  const check = checkInPlaneShear(example1si, base);

  it("emits a trace whose leaves and derivations are all metric", () => {
    const roots = [check.demand, check.capacity, check.utilization, ...check.trace].filter(
      (n): n is Traced<any> => n !== undefined,
    );
    expect(() => validateTrace(roots)).not.toThrow();
    for (const r of roots) {
      for (const n of flattenTrace(r)) {
        expect(["mm", "mm2", "MPa", "kN", "kN-m", "1"], n.id).toContain(n.unit);
      }
    }
  });

  it("traces A_cv in mm² and f'c in MPa", () => {
    expect(node(check, "wall.Acv").value).toBeCloseTo(2601285.12, 6);
    expect(node(check, "wall.Acv").unit).toBe("mm2");
    expect(node(check, "materials.fc").value).toBeCloseTo(34.4738, 4);
    expect(node(check, "materials.fc").unit).toBe("MPa");
  });

  it("computes √f'c in MPa^0.5", () => {
    const s = node(check, "shear.sqrt_fc");
    expect(s.value).toBeCloseTo(5.87144, 5);
    expect(s.unit).toBe("MPa");
  });

  it("computes V_nc = 0.17 λ √f'c A_cv in kN", () => {
    // 0.17 x 1.0 x 5.87144 x 2,601,285 / 1000 = 2596.5 kN
    const v = node(check, "shear.vnc");
    expect(v.value).toBeCloseTo(2596.46, 2);
    expect(v.unit).toBe("kN");
  });

  it("computes V_ns = ρ_t f_yt A_cv in kN", () => {
    // 0.0043056 x 413.685 x 2,601,285 / 1000 = 4633.3 kN
    const v = node(check, "shear.vns");
    expect(v.value).toBeCloseTo(4633.27, 2);
    expect(v.unit).toBe("kN");
  });

  it("caps V_n with the 0.66√f'c·A_cv limit of ACI 318M-19 11.5.4.2", () => {
    // 0.66 x 5.87144 x 2,601,285 / 1000 = 10,080.4 kN — above V_n,calc here
    const cap = node(check, "shear.vn_max");
    expect(cap.value).toBeCloseTo(10080.37, 2);
    expect(cap.formula).toContain("0.66");
    expect(cap.formula).not.toContain("8\\sqrt");
    expect(node(check, "shear.cap_coeff").value).toBe(0.66);
  });

  it("reports V_n, φV_n and the utilization", () => {
    // V_n = 2596.46 + 4633.27 = 7229.73 kN (Eq. 11.5.4.3 governs)
    // φV_n = 0.75 x 7229.73 = 5422.29 kN
    // V_u = 235 kip = 1045.33 kN → 1045.33/5422.29 = 0.1928
    expect(node(check, "shear.Vn").value).toBeCloseTo(7229.73, 2);
    expect(check.capacity?.value).toBeCloseTo(5422.29, 2);
    expect(check.capacity?.unit).toBe("kN");
    expect(check.demand?.value).toBeCloseTo(1045.33, 2);
    expect(check.demand?.unit).toBe("kN");
    expect(check.utilization?.value).toBeCloseTo(0.19278, 5);
    expect(check.status).toBe("ok");
  });

  it("never prints an in-lb coefficient in a metric substitution", () => {
    const md = JSON.stringify(check);
    expect(md).not.toContain("text{psi}");
    expect(md).not.toContain("text{kip}");
    expect(md).not.toContain("8\\\\sqrt{f'_c}");
  });
});

describe("the in-lb default is untouched", () => {
  it("keeps psi/kip units and the in-lb coefficients when `units` is absent", () => {
    const { units: _si, ...inLb } = example1si;
    const check = checkInPlaneShear(inLb as WallInput, base);
    expect(node(check, "shear.alpha_c").value).toBe(2);
    expect(node(check, "shear.cap_coeff").value).toBe(8);
    expect(node(check, "shear.vnc").value).toBeCloseTo(570.21, 2);
    expect(check.capacity?.unit).toBe("kip");
  });
});
