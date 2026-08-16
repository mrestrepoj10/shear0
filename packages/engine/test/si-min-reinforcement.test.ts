/**
 * Minimum distributed reinforcement (§11.6) in SI mode — ACI 318M-19.
 *
 * Every expected value below is hand-computed from the **metric** expression.
 * α_c is independently rounded in the metric edition (0.25 / 0.17 against the
 * in-lb 3 / 2 — 0.25 is 0.5% above 3 x 0.083, 0.17 is 2.4% above 2 x 0.083), so
 * the metric threshold is *not* the in-lb threshold converted: 973.67 kN here
 * against 214 kip = 951.8 kN in-lb. The Table 11.6.1 ρ values and Eq. (11.6.2)
 * are dimensionless and identical; only the row labels change (f_y ≥ 420 MPa,
 * No. 16 metric).
 *
 * Wall: MNL-17(21) Shear Wall Example 1 — 336 x 12 in. = 8534.4 x 304.8 mm,
 * h_w = 1104 in., f'c = 5000 psi = 34.4738 MPa, Grade 60 = 413.685 MPa,
 * No. 5 @ 12 in. e.f. both ways.
 *   A_cv = 8534.4 x 304.8 = 2,601,285.12 mm²
 *   √f'c = √34.4738       = 5.87144 MPa^0.5
 *   h_w/ℓ_w = 1104/336    = 3.286 ≥ 2.0  →  α_c = 0.17
 *   V_c   = 0.17 x 1.0 x 5.87144 x 2,601,285.12 / 1000 = 2596.46 kN
 *   0.5φV_c = 0.5 x 0.75 x 2596.46                      =  973.67 kN
 *   ρ_prov = 2 x 0.31 in² / (12 in. x 12 in.)
 *          = 2 x 200.0 mm² / (304.8 x 304.8 mm) = 0.00430556 (dimensionless)
 */
import { describe, expect, it } from "vitest";
import {
  checkMinReinforcement,
  concreteShearNodes,
  rhoProvidedNode,
} from "../src/checks/min-reinforcement";
import { GRADE420, GRADE60, concrete } from "../src/materials";
import type { RebarGrade } from "../src/materials";
import { flattenTrace, validateTrace } from "../src/trace";
import type { CheckResult, Traced } from "../src/trace";
import type { Demands, WallInput } from "../src/wall";

const example1si: WallInput = {
  geometry: { lw: 336, h: 12, hw: 92 * 12, lu: 202, k: 0.8, cover: 1.5 },
  concrete: concrete(5000),
  grade: GRADE60,
  vertical: { bar: "5", spacing: 12, curtains: 2 },
  horizontal: { bar: "5", spacing: 12, curtains: 2 },
  endZone: { bar: "5", count: 4, distanceToFirst: 3, spacing: 9 },
  demands: [{ id: "base", Pu: 1015, Mu: 18600, Vu: 235, MuOut: 60, VuOut: 16 }],
  wallType: "bearing",
  system: "ordinary",
  units: "si",
};

const ex1Demand: Demands = example1si.demands[0]!;

const GRADE40: RebarGrade = { fy: 40, Es: 29000, ety: 40 / 29000 };

function allNodes(check: CheckResult): Traced<any>[] {
  return [check.demand, check.capacity, check.utilization, ...check.trace].filter(
    (n): n is Traced<any> => n !== undefined,
  );
}

function node(check: CheckResult, id: string): Traced<any> {
  for (const root of allNodes(check)) {
    const hit = flattenTrace(root).find((n) => n.id === id);
    if (hit !== undefined) return hit;
  }
  throw new Error(`no trace node "${id}" in check "${check.id}"`);
}

describe("concreteShearNodes in SI (ACI 318M-19 11.5.4.3)", () => {
  it("uses α_c = 0.17 for the Example 1 wall and V_c in kN", () => {
    // 0.17 x 1.0 x 5.87144 x 2,601,285.12 = 2,596,458 N = 2596.46 kN
    const { acv, ratio, alphaC, Vc } = concreteShearNodes(example1si, "t");
    expect(acv.value).toBeCloseTo(2601285.12, 6);
    expect(acv.unit).toBe("mm2");
    expect(ratio.value).toBeCloseTo(3.286, 3);
    expect(alphaC.value).toBe(0.17);
    expect(alphaC.note).toContain("metric");
    expect(Vc.value).toBeCloseTo(2596.4584, 4);
    expect(Vc.unit).toBe("kN");
    expect(Vc.substitution).toContain("\\text{N}");
    expect(() => validateTrace([Vc])).not.toThrow();
  });

  it("uses α_c = 0.25 for a squat wall (h_w/ℓ_w ≤ 1.5)", () => {
    const squat: WallInput = {
      ...example1si,
      geometry: { ...example1si.geometry, lw: 120, hw: 120 },
    };
    const { alphaC, Vc } = concreteShearNodes(squat, "t");
    expect(alphaC.value).toBe(0.25);
    // A_cv = 120 x 12 in² = 1440 x 645.16 = 929,030.4 mm²
    // 0.25 x 5.87144 x 929,030.4 / 1000 = 1363.69 kN
    expect(Vc.value).toBeCloseTo(1363.6861, 4);
  });

  it("interpolates linearly between 0.25 and 0.17", () => {
    // slope = (0.25 - 0.17)/0.5 = 0.16; at h_w/ℓ_w = 1.75: 0.25 - 0.16(0.25) = 0.21
    const mid: WallInput = {
      ...example1si,
      geometry: { ...example1si.geometry, hw: 336 * 1.75 },
    };
    const { alphaC } = concreteShearNodes(mid, "t");
    expect(alphaC.value).toBeCloseTo(0.21, 12);
    expect(alphaC.formula).toContain("0.250");
    expect(alphaC.formula).toContain("0.16");
    expect(alphaC.note).toContain("metric coefficients");
  });
});

describe("rhoProvidedNode in SI", () => {
  it("assembles ρ from mm² and mm leaves but stays dimensionless", () => {
    // A_b = 0.31 in² = 200.0 mm²; s = h = 304.8 mm
    // ρ = 2 x 200.0 / (304.8 x 304.8) = 0.00430556
    const rho = rhoProvidedNode(example1si, "t", "t", example1si.horizontal);
    expect(rho.value).toBeCloseTo(0.00430556, 8);
    expect(rho.unit).toBe("1");
    const leaves = flattenTrace(rho);
    expect(leaves.find((n) => n.id === "t.rho_t.Ab")?.value).toBeCloseTo(199.9996, 4);
    expect(leaves.find((n) => n.id === "t.rho_t.Ab")?.unit).toBe("mm2");
    expect(leaves.find((n) => n.id === "t.rho_t.s")?.value).toBeCloseTo(304.8, 10);
    expect(leaves.find((n) => n.id === "t.rho_t.s")?.unit).toBe("mm");
  });
});

describe("checkMinReinforcement in SI — high-shear (11.6.2) branch", () => {
  const check = checkMinReinforcement(example1si, ex1Demand);

  it("produces a valid trace whose nodes are all metric", () => {
    expect(() => validateTrace(allNodes(check))).not.toThrow();
    for (const r of allNodes(check)) {
      for (const n of flattenTrace(r)) {
        expect(["mm", "mm2", "MPa", "kN", "1"], n.id).toContain(n.unit);
      }
    }
  });

  it("computes the 11.6.1 threshold as 0.5·φ·V_c = 973.67 kN", () => {
    // 0.5 x 0.75 x 2596.4584 = 973.6719 kN
    const Vc = node(check, "minreinf.Vc");
    const threshold = node(check, "minreinf.threshold");
    expect(node(check, "minreinf.threshold_coeff").value).toBe(0.5);
    expect(threshold.value).toBeCloseTo(0.5 * 0.75 * Vc.value, 10);
    expect(threshold.value).toBeCloseTo(973.6719, 4);
    expect(threshold.unit).toBe("kN");
  });

  it("documents why 0.5 is used and not the 0.04 ACI 318M-19 literally prints", () => {
    const note = node(check, "minreinf.threshold").note ?? "";
    expect(note).toContain("0.04");
    expect(note).toContain("0.5");
    expect(note).toMatch(/12/);
    expect(note).toContain("11.5.4.3");
    expect(note).toContain("0.25");
    expect(note).toContain("0.17");
    // the coefficient constant carries the same explanation
    expect(node(check, "minreinf.threshold_coeff").note).toContain("0.04");
  });

  it("takes the 11.6.2 path because V_u = 1045.33 kN > 973.67 kN", () => {
    // V_u = 235 kip = 1045.332 kN
    expect(node(check, "minreinf.Vu").value).toBeCloseTo(1045.332, 3);
    expect(node(check, "minreinf.Vu").unit).toBe("kN");
    expect(node(check, "minreinf.trigger").value).toBe(true);
    expect(node(check, "minreinf.rho_t_req").ref?.section).toBe("11.6.2");
  });

  it("traces f_y in MPa", () => {
    // 60 ksi = 413.685 MPa
    expect(node(check, "minreinf.fy").value).toBeCloseTo(413.6854, 4);
    expect(node(check, "minreinf.fy").unit).toBe("MPa");
  });

  it("evaluates the dimensionless Eq. (11.6.2) with the same numbers as in-lb", () => {
    // 0.0025 + 0.5(2.5 - 3.286)(0.00430556 - 0.0025) = 0.0017907
    const eq = node(check, "minreinf.rho_l_eq");
    expect(eq.value).toBeCloseTo(0.0017907, 7);
    expect(eq.unit).toBe("1");
    expect(eq.formula).toContain("0.0025 + 0.5");
    expect(node(check, "minreinf.rho_l_floor").value).toBe(0.0025);
  });

  it("waives ρ_ℓ because no ρ_t is required for strength", () => {
    // V_u/φ = 1,045,332 / 0.75 = 1,393,776 N < V_c = 2,596,458 N → ρ_t,strength = 0
    expect(node(check, "minreinf.rho_t_strength").value).toBe(0);
    expect(node(check, "minreinf.rho_l_req").value).toBe(0);
    expect(node(check, "minreinf.rho_l_req").note).toMatch(/waived/);
  });

  it("requires ρ_t ≥ 0.0025 and passes", () => {
    // 0.0025 / 0.00430556 = 0.58065
    expect(node(check, "minreinf.rho_t_req").value).toBe(0.0025);
    expect(node(check, "minreinf.rho_t").value).toBeCloseTo(0.00430556, 8);
    expect(check.utilization?.value).toBeCloseTo(0.580645, 6);
    expect(check.status).toBe("ok");
  });

  it("never prints an in-lb unit in a metric substitution", () => {
    const json = JSON.stringify(check);
    expect(json).not.toContain("text{psi}");
    expect(json).not.toContain("text{kip}");
    expect(json).not.toContain("text{lb}");
  });
});

describe("checkMinReinforcement in SI — low-shear (Table 11.6.1) branch", () => {
  // V_u = 100 kip = 444.82 kN < 973.67 kN
  const lowShear: Demands = { id: "low", Pu: 1015, Mu: 18600, Vu: 100 };
  const check = checkMinReinforcement(example1si, lowShear);

  it("takes the Table 11.6.1 path", () => {
    expect(node(check, "minreinf.Vu").value).toBeCloseTo(444.8222, 4);
    expect(node(check, "minreinf.trigger").value).toBe(false);
    expect(node(check, "minreinf.rho_l_req").ref?.eq).toBe("Table 11.6.1");
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });

  it("puts Grade 60 below the 420 MPa split — stricter row than in-lb", () => {
    // Grade 60 = 413.685 MPa < 420 MPa: the metric split is not an exact
    // conversion of 60,000 psi, so the same bars land in the 0.0015/0.0025 row.
    expect(node(check, "minreinf.rho_l_req").value).toBe(0.0015);
    expect(node(check, "minreinf.rho_t_req").value).toBe(0.0025);
    expect(node(check, "minreinf.rho_l_req").note).toMatch(/f_y < 420 MPa/);
    expect(node(check, "minreinf.rho_l_req").note).toContain("No. 16 metric");
    expect(node(check, "minreinf.rho_l_req").note).not.toContain("60,000 psi");
    expect(check.status).toBe("ok");
  });

  it("keeps the ρ values of Table 11.6.1 unchanged for Grade 420", () => {
    const c = checkMinReinforcement({ ...example1si, grade: GRADE420 }, lowShear);
    expect(node(c, "minreinf.rho_l_req").value).toBe(0.0012);
    expect(node(c, "minreinf.rho_t_req").value).toBe(0.002);
    expect(node(c, "minreinf.rho_l_req").note).toMatch(/f_y ≥ 420 MPa/);
  });

  it("selects the 0.0015/0.0025 row for bars larger than No. 16 metric", () => {
    const w: WallInput = {
      ...example1si,
      vertical: { bar: "6", spacing: 12, curtains: 2 },
      horizontal: { bar: "6", spacing: 12, curtains: 2 },
      endZone: { bar: "6", count: 4, distanceToFirst: 3, spacing: 9 },
    };
    const c = checkMinReinforcement(w, lowShear);
    expect(node(c, "minreinf.rho_l_req").value).toBe(0.0015);
    expect(node(c, "minreinf.rho_t_req").value).toBe(0.0025);
    expect(node(c, "minreinf.rho_l_req").note).toMatch(/larger than No\. 16 metric/);
  });

  it("selects the 0.0015/0.0025 row below 420 MPa", () => {
    // Grade 40 = 275.79 MPa < 420 MPa
    const c = checkMinReinforcement({ ...example1si, grade: GRADE40 }, lowShear);
    expect(node(c, "minreinf.rho_l_req").value).toBe(0.0015);
    expect(node(c, "minreinf.rho_t_req").value).toBe(0.0025);
    expect(node(c, "minreinf.rho_l_req").note).toMatch(/f_y < 420 MPa/);
    expect(node(c, "minreinf.fy").value).toBeCloseTo(275.7903, 4);
  });

  it("flags reinforcement below the Table 11.6.1 minimum as ng", () => {
    // No. 3 @ 18 in., one curtain: 70.968 mm² / (457.2 x 304.8) = 0.00050926 < 0.0012
    const w: WallInput = {
      ...example1si,
      vertical: { bar: "3", spacing: 18, curtains: 1 },
      horizontal: { bar: "3", spacing: 18, curtains: 1 },
    };
    const c = checkMinReinforcement(w, lowShear);
    expect(node(c, "minreinf.rho_l").value).toBeCloseTo(0.00050926, 8);
    expect(c.status).toBe("ng");
    expect(() => validateTrace(allNodes(c))).not.toThrow();
  });
});

describe("checkMinReinforcement in SI — threshold boundary", () => {
  // The threshold expressed back in the stored kip unit:
  // 973.6719 kN / 4.4482216152605 = 218.8902 kip
  const thresholdKip = (0.5 * 0.75 * 2596.4584171942925) / 4.4482216152605;

  it("takes the Table 11.6.1 path exactly at the threshold", () => {
    expect(thresholdKip).toBeCloseTo(218.8902, 4);
    const c = checkMinReinforcement(example1si, {
      id: "at-threshold",
      Pu: 1015,
      Mu: 18600,
      Vu: thresholdKip,
    });
    expect(node(c, "minreinf.trigger").value).toBe(false);
    // Grade 60 = 413.685 MPa < 420 MPa → strict row in SI
    expect(node(c, "minreinf.rho_l_req").value).toBe(0.0015);
  });

  it("takes the 11.6.2 path just above the threshold", () => {
    const c = checkMinReinforcement(example1si, {
      id: "above",
      Pu: 1015,
      Mu: 18600,
      Vu: thresholdKip + 0.001,
    });
    expect(node(c, "minreinf.trigger").value).toBe(true);
  });
});

describe("checkMinReinforcement in SI — squat wall, positive Eq. (11.6.2) term", () => {
  // h_w/ℓ_w = 1.0 → α_c = 0.25; A_cv = 120 x 12 in² = 929,030.4 mm²
  // V_c = 0.25 x 5.87144 x 929,030.4 / 1000 = 1363.69 kN; 0.5φV_c = 511.38 kN
  // V_u = 400 kip = 1779.29 kN > 511.38 kN → 11.6.2 governs
  const squat: WallInput = {
    ...example1si,
    geometry: { lw: 120, h: 12, hw: 120, lu: 202, k: 0.8, cover: 1.5 },
  };
  const check = checkMinReinforcement(squat, { id: "squat", Pu: 500, Mu: 2000, Vu: 400 });

  it("uses the metric α_c = 0.25 and takes the 11.6.2 path", () => {
    expect(node(check, "minreinf.alpha_c").value).toBe(0.25);
    expect(node(check, "minreinf.Vc").value).toBeCloseTo(1363.6861, 4);
    expect(node(check, "minreinf.threshold").value).toBeCloseTo(511.3823, 4);
    expect(node(check, "minreinf.trigger").value).toBe(true);
  });

  it("evaluates Eq. (11.6.2) above the floor and applies the metric strength cap", () => {
    // ρ_ℓ,eq = 0.0025 + 0.5(2.5 - 1.0)(0.00430556 - 0.0025) = 0.00385417
    expect(node(check, "minreinf.rho_l_eq").value).toBeCloseTo(0.00385417, 8);
    // ρ_t,strength = (1,779,289/0.75 - 1,363,686) / (413.685 x 929,030.4) = 0.00262459
    expect(node(check, "minreinf.rho_t_strength").value).toBeCloseTo(0.00262459, 8);
    expect(node(check, "minreinf.rho_l_req").value).toBeCloseTo(0.00262459, 8);
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });
});

describe("the in-lb default is untouched", () => {
  it("keeps the in-lb α_c = 2 and a 214 kip threshold when `units` is absent", () => {
    const { units: _si, ...inLb } = example1si;
    const check = checkMinReinforcement(inLb as WallInput, ex1Demand);
    expect(node(check, "minreinf.alpha_c").value).toBe(2);
    expect(node(check, "minreinf.threshold").value).toBeCloseTo(213.83, 2);
    expect(node(check, "minreinf.threshold").unit).toBe("kip");
    expect(node(check, "minreinf.threshold").note).toBeUndefined();
    expect(node(check, "minreinf.fy").value).toBe(60000);
    expect(node(check, "minreinf.rho_t").value).toBeCloseTo(0.62 / 144, 12);
    expect(check.status).toBe("ok");
  });
});
