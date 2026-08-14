import { describe, expect, it } from "vitest";
import { GRADE60, concrete } from "../src/materials";
import { validateTrace } from "../src/trace";
import { Acv, Ag, barPositions, hwOverLw, totalVerticalAs } from "../src/wall";
import type { WallInput } from "../src/wall";

/** MNL-17(21) Shear Wall Example 1: 28 ft x 12 in. wall, No. 5 @ 12 in. e.f. */
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

describe("derived geometry", () => {
  it("computes Acv", () => {
    const a = Acv(example1);
    expect(a.value).toBe(4032);
    expect(a.unit).toBe("in2");
    expect(a.ref?.section).toBe("11.5.4 / R11.5.4.2");
    expect(() => validateTrace([a])).not.toThrow();
  });

  it("computes Ag for the rectangular section", () => {
    expect(Ag(example1).value).toBe(4032);
  });

  it("shares geometry leaves between checks", () => {
    const a = Acv(example1);
    const g = Ag(example1);
    expect(a.inputs[0]).toBe(g.inputs[0]);
    expect(() => validateTrace([a, g, hwOverLw(example1)])).not.toThrow();
  });

  it("computes hw/lw", () => {
    const r = hwOverLw(example1);
    expect(r.value).toBeCloseTo(3.286, 3);
    expect(r.unit).toBe("1");
    expect(() => validateTrace([r])).not.toThrow();
  });
});

describe("barPositions", () => {
  const stations = barPositions(example1);

  it("starts with the end-zone pair 3 in. from the wall end", () => {
    expect(stations[0]?.x).toBe(3);
    expect(stations[0]?.area).toBeCloseTo(0.62, 12);
  });

  it("is symmetric about lw/2", () => {
    const n = stations.length;
    for (let i = 0; i < n; i++) {
      const lo = stations[i];
      const hi = stations[n - 1 - i];
      expect(lo).toBeDefined();
      expect(hi).toBeDefined();
      expect(lo!.x + hi!.x).toBeCloseTo(336, 9);
      expect(lo!.area).toBeCloseTo(hi!.area, 12);
    }
  });

  it("puts 2 x 0.31 in2 at every interior station", () => {
    for (const st of stations) expect(st.area).toBeCloseTo(0.62, 12);
    expect(stations.map((s) => s.x)).toContain(12);
    expect(stations.map((s) => s.x)).toContain(168);
    expect(stations.map((s) => s.x)).toContain(324);
  });

  it("reproduces the handbook reinforcement ratio (~0.0043)", () => {
    const As = totalVerticalAs(example1);
    const perStrip = (As * 12) / 336;
    // handbook: 2(0.31)/(12 x 12) = 0.0043; our layout adds the end pair, so ~4% more
    expect(perStrip).toBeGreaterThan(0.0043 * 12 * 12);
    expect(perStrip).toBeCloseTo(0.0043 * 12 * 12, 1);
    expect(As / 4032).toBeCloseTo(0.0043, 3);
  });

  it("falls back to a pure distributed layout with no end zone", () => {
    const { endZone: _endZone, ...rest } = example1;
    const stations2 = barPositions(rest);
    expect(stations2[0]?.x).toBe(12);
    expect(stations2.length).toBe(27);
    expect(stations2.every((s) => Math.abs(s.area - 0.62) < 1e-12)).toBe(true);
  });

  it("handles a multi-station end zone (Ex. 2 style boundary element)", () => {
    const ex2: WallInput = {
      ...example1,
      vertical: { bar: "8", spacing: 12, curtains: 2 },
      endZone: { bar: "8", count: 10, distanceToFirst: 3, spacing: 8 },
    };
    const st = barPositions(ex2);
    const lowEnd = st.filter((s) => s.x < 40).map((s) => s.x);
    expect(lowEnd).toEqual([3, 11, 19, 27, 35]);
    expect(st[0]?.area).toBeCloseTo(2 * 0.79, 12);
    // distributed stations inside the end zone (12, 24, 36) are dropped
    expect(st.map((s) => s.x)).not.toContain(12);
    expect(st.map((s) => s.x)).toContain(48);
  });
});
