/**
 * Wall detailing (11.3, 11.7) in SI mode — ACI 318M-19 limits.
 *
 * The detailing limits are *soft-converted* absolutes rather than √f'c
 * coefficients: 4 in. becomes 100 mm, 18 in. becomes 450 mm, 10 in. becomes
 * 250 mm. None of these is the exact conversion (18 in. is 457.2 mm), so the SI
 * limits are genuinely a little different — 450 mm is 1.6% tighter than 18 in.
 * Every expectation below is therefore computed from the metric limit directly.
 *
 * Wall: MNL-17(21) Shear Wall Example 1 in metric —
 *   h    = 12 in.  = 304.8 mm
 *   ℓ_w  = 336 in. = 8534.4 mm
 *   ℓ_u  = 202 in. = 5130.8 mm
 *   s    = 12 in.  = 304.8 mm, No. 5 @ 12 in. e.f., two curtains
 */
import { describe, expect, it } from "vitest";
import { checkCurtains, checkMinThickness, checkSpacing, checkTies } from "../src/checks/detailing";
import { GRADE60, concrete } from "../src/materials";
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

const demand: Demands = example1si.demands[0]!;

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

const inLb = (w: WallInput): WallInput => {
  const { units: _drop, ...rest } = w;
  return rest as WallInput;
};

describe("checkMinThickness in SI — ACI 318M-19 Table 11.3.1.1", () => {
  const check = checkMinThickness(example1si);

  it("uses the 100 mm absolute floor, not 4 in.", () => {
    const floor = node(check, "detailing.thickness.h_abs");
    expect(floor.value).toBe(100);
    expect(floor.unit).toBe("mm");
  });

  it("keeps the 1/25 bearing-wall divisor and reports h_min in mm", () => {
    // ℓ_u/25 = 5130.8/25 = 205.232 mm; h_min = max(100, 205.232) = 205.232 mm
    expect(node(check, "detailing.thickness.h_slender").value).toBeCloseTo(205.232, 3);
    const req = node(check, "detailing.thickness.h_req");
    expect(req.value).toBeCloseTo(205.232, 3);
    expect(req.unit).toBe("mm");
  });

  it("reaches the same utilization as the in-lb edition (both limits are ℓ_u/25)", () => {
    // 205.232/304.8 = 0.67333 — identical to 8.08/12, because the governing
    // limit is the dimensionless 1/25 ratio in both editions.
    expect(check.utilization?.value).toBeCloseTo(0.673333, 6);
    expect(checkMinThickness(inLb(example1si)).utilization?.value).toBeCloseTo(0.673333, 6);
    expect(check.status).toBe("ok");
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });

  it("lets the 100 mm floor govern for a thin, short-span wall", () => {
    // ℓ_u = 40 in. = 1016 mm → 1016/25 = 40.64 mm < 100 mm, so the floor governs
    const w: WallInput = { ...example1si, geometry: { ...example1si.geometry, lu: 40 } };
    expect(node(checkMinThickness(w), "detailing.thickness.h_req").value).toBe(100);
  });

  it("uses the 1/30 row for nonbearing walls", () => {
    const w: WallInput = { ...example1si, wallType: "nonbearing" };
    // 5130.8/30 = 171.027 mm
    expect(node(checkMinThickness(w), "detailing.thickness.h_slender").value).toBeCloseTo(
      171.0267,
      3,
    );
  });
});

describe("checkSpacing in SI — ACI 318M-19 11.7.2.1 / 11.7.3.1", () => {
  const check = checkSpacing(example1si, demand);

  it("uses the 450 mm absolute cap, not 18 in.", () => {
    const cap = node(check, "detailing.spacing.cap_18");
    expect(cap.value).toBe(450);
    expect(cap.unit).toBe("mm");
    expect(cap.symbol).toContain("450");
  });

  it("takes s_max as the lesser of 3h and 450 mm", () => {
    // 3h = 3 x 304.8 = 914.4 mm; min(914.4, 450) = 450 mm
    expect(node(check, "detailing.spacing.three_h").value).toBeCloseTo(914.4, 6);
    expect(node(check, "detailing.spacing.s_base").value).toBe(450);
  });

  it("is 1.6% stricter than the in-lb edition, because 450 mm < 18 in.", () => {
    // SI:    304.8/450   = 0.677333
    // in-lb: 12/18       = 0.666667   (18 in. = 457.2 mm)
    expect(check.utilization?.value).toBeCloseTo(0.677333, 6);
    expect(checkSpacing(inLb(example1si), demand).utilization?.value).toBeCloseTo(0.666667, 6);
    expect(check.status).toBe("ok");
  });

  it("traces the shear-strength trigger in kN", () => {
    const vu = node(check, "detailing.spacing.Vu");
    // 235 kip = 1045.33 kN
    expect(vu.value).toBeCloseTo(1045.332, 3);
    expect(vu.unit).toBe("kN");
    expect(node(check, "detailing.spacing.phiVc").unit).toBe("kN");
  });

  it("emits no imperial unit tag anywhere in the graph", () => {
    for (const root of allNodes(check)) {
      for (const n of flattenTrace(root)) {
        expect(["mm", "mm2", "MPa", "kN", "kN-m", "1"], n.id).toContain(n.unit);
      }
    }
  });
});

describe("checkCurtains in SI — ACI 318M-19 11.7.2.3", () => {
  it("uses the 250 mm trigger, not 10 in.", () => {
    const check = checkCurtains(example1si);
    const limit = node(check, "detailing.curtains.h_limit");
    expect(limit.value).toBe(250);
    expect(limit.unit).toBe("mm");
    // h = 304.8 mm > 250 mm → two curtains required
    expect(node(check, "detailing.curtains.n_req").value).toBe(2);
    expect(check.status).toBe("ok");
  });

  it("requires only one curtain at h = 250 mm or less", () => {
    // 9 in. = 228.6 mm ≤ 250 mm
    const w: WallInput = { ...example1si, geometry: { ...example1si.geometry, h: 9 } };
    expect(node(checkCurtains(w), "detailing.curtains.n_req").value).toBe(1);
  });

  it("disagrees with the in-lb edition in the 250 mm–10 in. band", () => {
    // 10 in. = 254 mm. A 9.9 in. wall is 251.46 mm: above the metric 250 mm
    // trigger but not above the in-lb 10 in. one.
    const w: WallInput = { ...example1si, geometry: { ...example1si.geometry, h: 9.9 } };
    expect(node(checkCurtains(w), "detailing.curtains.n_req").value).toBe(2);
    expect(node(checkCurtains(inLb(w)), "detailing.curtains.n_req").value).toBe(1);
  });
});

describe("checkTies in SI — 11.7.4.1", () => {
  const check = checkTies(example1si, demand);

  it("keeps the 0.01 A_g trigger — identical in both editions", () => {
    // 11.7.4.1 is dimensionless and ACI 318M-19 prints the same 0.01.
    expect(node(check, "detailing.ties.ratio").unit).toBe("1");
    expect(node(check, "detailing.ties.Ag_strip").unit).toBe("mm2");
    expect(checkTies(inLb(example1si), demand).utilization?.value).toBeCloseTo(
      check.utilization?.value ?? Number.NaN,
      9,
    );
  });

  it("reports the informational gross-section stress in MPa", () => {
    // σ = P_u/A_g + M_u·y/I_g, assembled in N and N·mm. Note the engine follows
    // MNL-17 Ex. 1 step 8 as printed and takes **y = ℓ_w**, not ℓ_w/2 (the node
    // says so in its own note), so the flexural term is twice the true extreme-
    // fibre stress:
    //   P_u = 1015 kip = 4,514,945 N;  A_g = 2,601,285 mm²   → 1.7357 MPa
    //   M_u = 18,600 kip-ft = 2.52182e10 N·mm
    //   I_g = 304.8 x 8534.4³/12 = 1.578893e13 mm⁴; y = ℓ_w = 8534.4 mm
    //                                                        → 13.6312 MPa
    //   σ = 1.7357 + 13.6312 = 15.3669 MPa
    const sigma = node(check, "detailing.ties.sigma");
    expect(sigma.value).toBeCloseTo(15.3669, 4);
    expect(sigma.unit).toBe("MPa");
    expect(node(check, "detailing.ties.Ig").unit).toBe("mm4");
    const y = node(check, "detailing.ties.y");
    expect(y.unit).toBe("mm");
    expect(y.value).toBeCloseTo(8534.4, 6);
    expect(y.note).toContain("y = lw");
  });

  it("matches the in-lb stress once converted — the expression is homogeneous", () => {
    // 2228.7 psi x 6.894757/1000 = 15.3669 MPa. Unlike the √f'c terms, nothing
    // here is rounded per edition, so the two agree to full precision.
    const psi = node(checkTies(inLb(example1si), demand), "detailing.ties.sigma").value;
    expect(psi).toBeCloseTo(2228.78, 1);
    expect((psi * 6.894757293168361) / 1000).toBeCloseTo(15.3669, 4);
  });
});
