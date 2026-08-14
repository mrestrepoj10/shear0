import { describe, expect, it } from "vitest";
import { checkCurtains, checkMinThickness, checkSpacing, checkTies } from "../src/checks/detailing";
import { GRADE60, concrete } from "../src/materials";
import { flattenTrace, validateTrace } from "../src/trace";
import type { CheckResult, Traced } from "../src/trace";
import type { Demands, WallInput } from "../src/wall";

/**
 * MNL-17(21) Shear Wall Example 1 (printed pp. 444-450): 28 ft x 12 in.
 * ordinary cast-in-place wall, No. 5 @ 12 in. e.f. both ways, two curtains.
 * endZone count 4 across 2 curtains => stations at 3 in. and 3 + 9 = 12 in.,
 * reproducing the handbook layout (3 in., 12 in., then 12 in. o.c.).
 */
const example1: WallInput = {
  geometry: { lw: 336, h: 12, hw: 92 * 12, lu: 202, k: 0.8, cover: 1.5 },
  concrete: concrete(5000),
  grade: GRADE60,
  vertical: { bar: "5", spacing: 12, curtains: 2 },
  horizontal: { bar: "5", spacing: 12, curtains: 2 },
  endZone: { bar: "5", count: 4, distanceToFirst: 3, spacing: 9 },
  demands: [{ id: "base", Pu: 1015, Mu: 18600, Vu: 235, MuOut: 60, VuOut: 16 }],
  wallType: "bearing",
  system: "ordinary",
};

const ex1Demand: Demands = example1.demands[0]!;

function node(check: CheckResult, id: string): Traced<any> {
  for (const root of allNodes(check)) {
    const hit = flattenTrace(root).find((n) => n.id === id);
    if (hit !== undefined) return hit;
  }
  throw new Error(`no trace node "${id}" in check "${check.id}"`);
}

function allNodes(check: CheckResult): Traced<any>[] {
  return [check.demand, check.capacity, check.utilization, ...check.trace].filter(
    (n): n is Traced<any> => n !== undefined,
  );
}

describe("checkMinThickness — Table 11.3.1.1", () => {
  it("passes for Example 1 using the clear unsupported height", () => {
    const check = checkMinThickness(example1);
    // Fixture delta: the handbook divides the 18 ft story height (216 in.) and
    // prints 8.64 in.; geometry.lu is the 202 in. clear span, giving 8.08 in.
    expect(node(check, "detailing.thickness.h_req").value).toBeCloseTo(202 / 25, 10);
    expect(check.status).toBe("ok");
    expect(check.utilization?.value).toBeCloseTo(202 / 25 / 12, 10);
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });

  it("reproduces the handbook 8.64 in. when lu is the 18 ft story height", () => {
    const w: WallInput = { ...example1, geometry: { ...example1.geometry, lu: 18 * 12 } };
    const check = checkMinThickness(w);
    expect(node(check, "detailing.thickness.h_req").value).toBeCloseTo(8.64, 10);
    expect(check.status).toBe("ok");
  });

  it("uses the 1/30 row for nonbearing walls", () => {
    const w: WallInput = { ...example1, wallType: "nonbearing" };
    const check = checkMinThickness(w);
    expect(node(check, "detailing.thickness.divisor").value).toBe(30);
    expect(node(check, "detailing.thickness.h_req").value).toBeCloseTo(202 / 30, 10);
  });

  it("applies the 4 in. floor for short walls", () => {
    const w: WallInput = { ...example1, geometry: { ...example1.geometry, lu: 50 } };
    const check = checkMinThickness(w);
    expect(node(check, "detailing.thickness.h_slender").value).toBe(2);
    expect(node(check, "detailing.thickness.h_req").value).toBe(4);
  });

  it("warns (not ng) when the table minimum is not met, citing the 11.5.3 footnote", () => {
    const w: WallInput = { ...example1, geometry: { ...example1.geometry, h: 6, lu: 300 } };
    const check = checkMinThickness(w);
    const req = node(check, "detailing.thickness.h_req");
    expect(req.value).toBe(12);
    expect(req.status).toBe("warning");
    expect(req.note).toMatch(/11\.5\.3/);
    expect(check.status).toBe("warning");
    expect(check.utilization?.value).toBeGreaterThan(1);
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });
});

describe("checkSpacing — 11.7.2.1 / 11.7.3.1", () => {
  const check = checkSpacing(example1, ex1Demand);

  it("finds shear reinforcement not required for in-plane strength", () => {
    // handbook step 5: phi*Vn = 428 kip (concrete alone) > Vu = 235 kip
    const phiVc = node(check, "detailing.spacing.phiVc");
    expect(phiVc.value).toBeCloseTo(428, 0);
    expect(Math.abs(phiVc.value - 428) / 428).toBeLessThan(0.01);
    expect(node(check, "detailing.spacing.shear_reinf_required").value).toBe(false);
    expect(node(check, "detailing.spacing.shear_reinf_required").note).toMatch(/0\.75/);
  });

  it("lets the 18 in. cap govern and passes at s = 12 in.", () => {
    expect(node(check, "detailing.spacing.three_h").value).toBe(36);
    expect(node(check, "detailing.spacing.s_max_vert").value).toBe(18);
    expect(node(check, "detailing.spacing.s_max_horiz").value).toBe(18);
    expect(check.utilization?.value).toBeCloseTo(12 / 18, 10);
    expect(check.status).toBe("ok");
  });

  it("produces a valid trace", () => {
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });

  it("applies lw/3 and lw/5 once shear reinforcement is required", () => {
    // lw = 48, h = 12, hw/lw = 2 -> alpha_c = 2; phi*Vc = 61 kip < Vu = 100 kip
    const squat: WallInput = {
      ...example1,
      geometry: { lw: 48, h: 12, hw: 96, lu: 202, k: 0.8, cover: 1.5 },
    };
    const c = checkSpacing(squat, { id: "squat", Pu: 200, Mu: 400, Vu: 100 });
    expect(node(c, "detailing.spacing.shear_reinf_required").value).toBe(true);
    expect(node(c, "detailing.spacing.lw_over_3").value).toBe(16);
    expect(node(c, "detailing.spacing.lw_over_5").value).toBeCloseTo(9.6, 10);
    expect(node(c, "detailing.spacing.s_max_vert").value).toBe(16);
    expect(node(c, "detailing.spacing.s_max_horiz").value).toBeCloseTo(9.6, 10);
    expect(node(c, "detailing.spacing.util_vert").status).toBe("ok");
    expect(node(c, "detailing.spacing.util_horiz").status).toBe("ng");
    expect(c.status).toBe("ng");
    expect(() => validateTrace(allNodes(c))).not.toThrow();
  });

  it("lets 3h govern for thin walls", () => {
    const thin: WallInput = {
      ...example1,
      geometry: { ...example1.geometry, h: 5 },
      vertical: { bar: "5", spacing: 15, curtains: 1 },
      horizontal: { bar: "5", spacing: 15, curtains: 1 },
    };
    const c = checkSpacing(thin, ex1Demand);
    expect(node(c, "detailing.spacing.s_base").value).toBe(15);
    expect(c.status).toBe("ok");
  });
});

describe("checkCurtains — 11.7.2.3", () => {
  it("requires two curtains at h = 12 in. and finds two provided", () => {
    const check = checkCurtains(example1);
    expect(node(check, "detailing.curtains.n_req").value).toBe(2);
    expect(node(check, "detailing.curtains.n_prov").value).toBe(2);
    expect(check.status).toBe("ok");
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });

  it("allows a single curtain at h = 10 in. exactly", () => {
    const w: WallInput = {
      ...example1,
      geometry: { ...example1.geometry, h: 10 },
      vertical: { bar: "5", spacing: 12, curtains: 1 },
      horizontal: { bar: "5", spacing: 12, curtains: 1 },
    };
    const check = checkCurtains(w);
    expect(node(check, "detailing.curtains.n_req").value).toBe(1);
    expect(check.status).toBe("ok");
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });

  it("flags a single curtain in a 12 in. wall", () => {
    const w: WallInput = {
      ...example1,
      vertical: { bar: "5", spacing: 12, curtains: 1 },
      horizontal: { bar: "5", spacing: 12, curtains: 2 },
    };
    const check = checkCurtains(w);
    expect(node(check, "detailing.curtains.n_prov").value).toBe(1);
    expect(check.status).toBe("ng");
  });
});

describe("checkTies — 11.7.4.1", () => {
  const check = checkTies(example1, ex1Demand);

  it("computes the end-strip ratio as 0.62/144", () => {
    expect(node(check, "detailing.ties.Ast_strip").value).toBeCloseTo(0.62, 12);
    expect(node(check, "detailing.ties.Ag_strip").value).toBe(144);
    expect(node(check, "detailing.ties.ratio").value).toBeCloseTo(0.62 / 144, 12);
    expect(node(check, "detailing.ties.ratio").value).toBeCloseTo(0.0043, 4);
  });

  it("finds ties not required", () => {
    expect(node(check, "detailing.ties.required").value).toBe(false);
    expect(check.status).toBe("ok");
    expect(check.utilization?.value).toBeCloseTo(0.43056, 4);
  });

  it("reproduces the handbook combined stress of 2229 psi", () => {
    const sigma = node(check, "detailing.ties.sigma");
    expect(sigma.unit).toBe("psi");
    expect(sigma.value).toBeCloseTo(2229, 0);
    expect(Math.abs(sigma.value - 2229) / 2229).toBeLessThan(0.01);
    expect(node(check, "detailing.ties.Ig").value).toBe(37933056);
    expect(node(check, "detailing.ties.y").value).toBe(336);
    expect(node(check, "detailing.ties.y").note).toMatch(/handbook-as-printed uses y = lw/);
  });

  it("produces a valid trace", () => {
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });

  it("falls back to distributed bars in the strip when there is no end zone", () => {
    const { endZone: _endZone, ...rest } = example1;
    const w: WallInput = {
      ...rest,
      vertical: { bar: "5", spacing: 6, curtains: 2 },
    };
    const c = checkTies(w, ex1Demand);
    // stations at 6 in. (0.62 in2); the station at x = h = 12 in. is outside the strip
    expect(node(c, "detailing.ties.Ast_strip").value).toBeCloseTo(0.62, 12);
    expect(() => validateTrace(allNodes(c))).not.toThrow();
  });

  it("warns when the end strip exceeds 0.01 Ag", () => {
    const w: WallInput = {
      ...example1,
      vertical: { bar: "9", spacing: 12, curtains: 2 },
      endZone: { bar: "9", count: 4, distanceToFirst: 3, spacing: 9 },
    };
    const c = checkTies(w, ex1Demand);
    // 2 x 1.00 in2 in a 12 x 12 strip = 0.0139 > 0.01
    expect(node(c, "detailing.ties.ratio").value).toBeCloseTo(2 / 144, 12);
    expect(node(c, "detailing.ties.required").value).toBe(true);
    expect(c.status).toBe("warning");
    expect(() => validateTrace(allNodes(c))).not.toThrow();
  });
});
