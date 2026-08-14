import { expect } from "vitest";
import { concrete, GRADE60, validateTrace } from "../src/index";
import type { CheckResult, Traced, WallInput } from "../src/index";

/**
 * MNL-17(21) Shear Wall Example 2 — SDC D special structural wall with a special
 * boundary element (`docs/research/mnl-17-shear-wall-examples.md`).
 */
export const example2: WallInput = {
  geometry: { lw: 336, h: 12, hw: 1104, hwcs: 1104, lu: 202, hu: 216, k: 0.8, cover: 1.5 },
  concrete: concrete(5000),
  grade: GRADE60,
  vertical: { bar: "8", spacing: 12, curtains: 2 },
  horizontal: { bar: "6", spacing: 12, curtains: 2 },
  endZone: { bar: "8", count: 4, distanceToFirst: 3, spacing: 9 },
  sbe: {
    width: 16,
    length: 34,
    longBar: "8",
    longCount: 10,
    hx: 10,
    tieBar: "4",
    tieSpacing: 4,
    tieLegsAcrossWidth: 3,
  },
  demands: [
    { id: "seismic", Pu: 1015, Mu: 37200, Vu: 470, MuOut: 120, VuOut: 32 },
    { id: "max-axial", Pu: 1200, Mu: 37200, Vu: 470 },
  ],
  seismic: { sdc: "D", deltaE: 2.4, Cd: 5, ns: 8, hsx: 216 },
  wallType: "bearing",
  system: "special",
};

/** Depth-first search of a check's whole trace graph for a node id. */
export function node(check: CheckResult, id: string): Traced<any> {
  const seen = new Set<Traced<any>>();
  const stack: Traced<any>[] = [
    check.demand,
    check.capacity,
    check.utilization,
    ...check.trace,
  ].filter((n): n is Traced<any> => n !== undefined);
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    if (n.id === id) return n;
    stack.push(...n.inputs);
  }
  throw new Error(`trace node "${id}" not found in check "${check.id}"`);
}

export function expectValidTrace(check: CheckResult): void {
  const roots = [check.demand, check.capacity, check.utilization, ...check.trace].filter(
    (n): n is Traced<any> => n !== undefined,
  );
  expect(() => validateTrace(roots), check.id).not.toThrow();
}

/** relative delta in %, for handbook comparisons */
export const delta = (ours: number, handbook: number): number =>
  (100 * (ours - handbook)) / handbook;
