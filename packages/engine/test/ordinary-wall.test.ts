import { describe, expect, it } from "vitest";
import {
  checkOrdinaryWall,
  concrete,
  GRADE60,
  validateTrace,
  worstStatus,
} from "../src/index";
import type { CheckResult, WallInput } from "../src/index";

// Phase 1 gate: MNL-17(21) Shear Wall Example 1 end-to-end via the package root.
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

function byId(checks: CheckResult[], id: string): CheckResult {
  const found = checks.find((c) => c.id === id);
  expect(found, `check ${id} present (have: ${checks.map((c) => c.id).join(", ")})`).toBeDefined();
  return found!;
}

describe("checkOrdinaryWall — handbook Example 1 gate", () => {
  const report = checkOrdinaryWall(example1);
  const checks = [...report.general, ...report.perDemand[0]!.checks];

  it("runs all expected checks and passes overall", () => {
    expect(report.perDemand).toHaveLength(1);
    expect(checks).toHaveLength(9);
    expect(report.status).toBe("ok");
  });

  it("every check has a valid trace", () => {
    for (const c of checks) {
      const roots = [c.demand, c.capacity, c.utilization, ...c.trace].filter(
        (n): n is NonNullable<typeof n> => n !== undefined,
      );
      expect(() => validateTrace(roots), c.id).not.toThrow();
    }
  });

  it("matches the handbook's governing numbers", () => {
    const shear = checks.find((c) => c.id.includes("shear") && !c.id.includes("oop"))!;
    expect(shear.status).toBe("ok");
    expect(shear.utilization!.value).toBeLessThan(0.25); // Vu 235 vs φVn ≈ 1209 kip

    const flexure = checks.find((c) => c.id.includes("flexure"))!;
    expect(flexure.status).toBe("ok");
    // Mu 18,600 vs φMn ≈ 24,600 ft-kip → utilization ≈ 0.756
    expect(flexure.utilization!.value).toBeCloseTo(18600 / 24600, 1);
  });

  it("goes NG when demands exceed capacity", () => {
    const overloaded: WallInput = {
      ...example1,
      demands: [{ id: "over", Pu: 1015, Mu: 30000, Vu: 235 }],
    };
    expect(checkOrdinaryWall(overloaded).status).toBe("ng");
  });
});

describe("worstStatus", () => {
  it("ignores na and ranks ng > warning > ok", () => {
    const mk = (status: CheckResult["status"]): CheckResult =>
      ({ id: "x", title: "x", ref: { standard: "ACI 318-19", section: "1" }, status, trace: [] });
    expect(worstStatus([mk("ok"), mk("na")])).toBe("ok");
    expect(worstStatus([mk("ok"), mk("warning")])).toBe("warning");
    expect(worstStatus([mk("warning"), mk("ng"), mk("na")])).toBe("ng");
  });
});
