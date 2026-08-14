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

/** MNL-17(21) Shear Wall Example 1 — ordinary wall, No. 5 @ 12 in. e.f. both ways. */
const example1: WallInput = {
  geometry: { lw: 336, h: 12, hw: 1104, lu: 202, k: 0.8, cover: 1.5 },
  concrete: concrete(5000),
  grade: GRADE60,
  vertical: { bar: "5", spacing: 12, curtains: 2 },
  horizontal: { bar: "5", spacing: 12, curtains: 2 },
  endZone: { bar: "5", count: 2, distanceToFirst: 3, spacing: 12 },
  demands: [{ id: "base", Pu: 1015, Mu: 18600, Vu: 235, MuOut: 60, VuOut: 16 }],
  wallType: "bearing",
  system: "ordinary",
};

/** MNL-17(21) Shear Wall Example 2 — same geometry, No. 8 vert / No. 6 horiz @ 12 in. e.f. */
const example2: WallInput = {
  ...example1,
  vertical: { bar: "8", spacing: 12, curtains: 2 },
  horizontal: { bar: "6", spacing: 12, curtains: 2 },
  demands: [{ id: "base", Pu: 1015, Mu: 37200, Vu: 470, MuOut: 120, VuOut: 32 }],
  system: "special",
};

const d1: Demands = example1.demands[0]!;
const d2: Demands = example2.demands[0]!;

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

describe("checkSimplifiedAxial (11.5.3) — MNL-17(21) Example 1", () => {
  const check = checkSimplifiedAxial(example1, d1);

  it("produces a valid trace", () => {
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it("finds e = 0.71 in. < h/6 = 2 in. so the method applies", () => {
    expect(node(check, "oop.e").value).toBeCloseTo(0.709, 3);
    expect(node(check, "oop.e_max").value).toBe(2);
    expect(check.status).toBe("ok");
  });

  it("reproduces the handbook Pn = 9120 kip within 1%", () => {
    const pn = node(check, "oop.Pn");
    expect(pn.value).toBeCloseTo(9124.3, 0);
    expect(Math.abs(pn.value / 9120 - 1)).toBeLessThan(0.01);
  });

  it("reproduces the handbook phi*Pn = 5920 kip within 1%", () => {
    const phiPn = check.capacity!;
    expect(node(check, "oop.phi_c").value).toBe(0.65);
    expect(phiPn.value).toBeCloseTo(5930.8, 0);
    expect(Math.abs(phiPn.value / 5920 - 1)).toBeLessThan(0.01);
  });

  it("passes with Pu = 1015 kip", () => {
    expect(check.demand?.value).toBe(1015);
    expect(check.utilization?.value).toBeCloseTo(1015 / 5930.8, 4);
    expect(check.status).toBe("ok");
  });
});

describe("checkSimplifiedAxial — Example 2 and applicability gate", () => {
  it("still applies at e = 1.42 in. (Ex. 2 out-of-plane moment)", () => {
    const check = checkSimplifiedAxial(example2, d2);
    expect(node(check, "oop.e").value).toBeCloseTo(1.419, 3);
    expect(check.status).toBe("ok");
    // identical geometry/materials, so the same Pn as Ex. 1 (handbook prints 9090 — rounding)
    expect(Math.abs(node(check, "oop.Pn").value / 9090 - 1)).toBeLessThan(0.01);
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it('reports "na" when e exceeds h/6', () => {
    const check = checkSimplifiedAxial(example1, { ...d1, MuOut: 300 });
    expect(node(check, "oop.e").value).toBeCloseTo(3.547, 3);
    expect(check.status).toBe("na");
    expect(check.capacity).toBeUndefined();
    expect(node(check, "oop.e").note).toContain("P–M");
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it('reports "na" when there is no net compression', () => {
    const check = checkSimplifiedAxial(example1, { ...d1, Pu: -50 });
    expect(check.status).toBe("na");
    expect(() => validateTrace(roots(check))).not.toThrow();
  });
});

describe("effectiveDepthOutOfPlane", () => {
  it("uses h - cover - db_horiz - db_vert/2 for Example 2 (9.25 in.)", () => {
    // Handbook Ex. 2 prints d = 12 - 1.5 - 0.5 - 8/16 = 9.5 in. (different stack-up);
    // our convention deducts the specified No. 6 horizontal bar.
    const d = effectiveDepthOutOfPlane(example2);
    expect(d.value).toBeCloseTo(9.25, 12);
    expect(d.unit).toBe("in");
    expect(d.note).toContain("9.5");
    expect(() => validateTrace([d])).not.toThrow();
  });

  it("uses the No. 5 bars for Example 1 (9.5625 in.)", () => {
    expect(effectiveDepthOutOfPlane(example1).value).toBeCloseTo(9.5625, 12);
  });
});

describe("checkOutOfPlaneShear (22.5.5.1(c)) — MNL-17(21) Example 2", () => {
  const check = checkOutOfPlaneShear(example2, d2);

  it("produces a valid trace", () => {
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it("takes lambda_s = 1.0 (no size-effect reduction at d = 9.25 in.)", () => {
    expect(node(check, "oop.lambda_s").value).toBe(1);
  });

  it("counts one curtain of vertical bars for rho_w", () => {
    expect(node(check, "oop.As_w").value).toBeCloseTo(28 * 0.79, 9);
    expect(node(check, "oop.rho_w").value).toBeCloseTo(0.0071173, 6);
  });

  it("applies the axial term Nu/(6Ag) without capping", () => {
    const axial = node(check, "oop.axial_term");
    expect(axial.value).toBeCloseTo(1_015_000 / (6 * 4032), 6);
    expect(axial.value).toBeLessThan(0.05 * 5000);
  });

  it("does not hit the 5*lambda*sqrt(f'c)*bw*d limit", () => {
    expect(node(check, "oop.Vc_calc").value).toBeLessThan(node(check, "oop.Vc_max").value);
  });

  it("passes VuOut = 32 kip with phi*Vc well over 100 kip", () => {
    expect(check.capacity!.value).toBeGreaterThan(100);
    expect(check.demand?.value).toBe(32);
    expect(check.status).toBe("ok");
    expect(check.utilization?.value).toBeLessThan(1);
  });

  it("omits Vs (walls have no out-of-plane stirrups)", () => {
    expect(node(check, "oop.Vc").note).toContain("V_s = 0");
    expect(node(check, "oop.phi_v").value).toBe(0.75);
  });
});

describe("checkOutOfPlaneShear — limits", () => {
  it("caps Nu/(6Ag) at 0.05 f'c per 22.5.5.1.2", () => {
    const check = checkOutOfPlaneShear(example2, { ...d2, Pu: 8000 });
    const axial = node(check, "oop.axial_term");
    expect(8_000_000 / (6 * 4032)).toBeGreaterThan(0.05 * 5000);
    expect(axial.value).toBe(0.05 * 5000);
    expect(axial.note).toContain("22.5.5.1.2");
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it("caps sqrt(f'c) at 100 psi per 22.5.3.1", () => {
    const strong: WallInput = { ...example2, concrete: concrete(12000) };
    const check = checkOutOfPlaneShear(strong, d2);
    expect(node(check, "oop.sqrt_fc").value).toBe(100);
    expect(node(check, "oop.sqrt_fc").note).toContain("22.5.3.1");
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it("applies the size effect for deep sections (lambda_s < 1)", () => {
    const thick: WallInput = { ...example2, geometry: { ...example2.geometry, h: 36 } };
    const check = checkOutOfPlaneShear(thick, d2);
    const d = node(check, "oop.d").value;
    expect(d).toBeGreaterThan(10);
    expect(node(check, "oop.lambda_s").value).toBeCloseTo(Math.sqrt(2 / (1 + d / 10)), 12);
    expect(node(check, "oop.lambda_s").value).toBeLessThan(1);
  });

  it("reports ng when VuOut exceeds phi*Vc", () => {
    const check = checkOutOfPlaneShear(example2, { ...d2, VuOut: 900 });
    expect(check.status).toBe("ng");
    expect(check.utilization?.value).toBeGreaterThan(1);
    expect(() => validateTrace(roots(check))).not.toThrow();
  });
});
