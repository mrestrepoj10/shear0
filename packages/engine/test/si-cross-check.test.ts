/**
 * SI ↔ in-lb cross-check.
 *
 * Neither edition is derived from the other — every formula site branches to its
 * own printed coefficients — so this suite is the sanity net that says the two
 * branches still describe the same wall. It compares the two systems only on
 * quantities that are *dimensionless by construction* (utilizations, ratios,
 * statuses), plus a handful of capacities converted at the reporting boundary.
 *
 * ## Why the tolerance is 3%, not 0
 *
 * ACI 318M rounds each coefficient independently of ACI 318-19, and the roundings
 * do not agree. Against the exact conversion √f'c(psi) = 0.083·√f'c(MPa):
 *
 * | site | in-lb | exact metric | printed metric | error |
 * |---|---|---|---|---|
 * | 11.5.4.3 α_c (slender) | 2    | 0.16597 | 0.17 | **+2.43%** |
 * | 11.5.4.3 α_c (squat)   | 3    | 0.24896 | 0.25 | +0.42% |
 * | 11.5.4.2 / 18.10.4.4   | 8    | 0.66389 | 0.66 | −0.59% |
 * | 18.10.4.5              | 10   | 0.82987 | 0.83 | +0.02% |
 * | 22.5.5.1.1             | 5    | 0.41493 | 0.42 | +1.22% |
 * | 19.2.2.1(b) E_c        | 57000| 4729.7  | 4700 | −0.63% |
 * | 22.2.2.4.3 β_1 @ 5 ksi | 0.800| —       | 0.8038 | +0.47% |
 *
 * α_c is the widest at 2.43%, and it multiplies the concrete term of every
 * in-plane shear check, so 3% is the honest bound. A tighter tolerance here
 * would not be a better test — it would be a wrong one.
 */
import { describe, expect, it } from "vitest";
import { checkOrdinaryWall } from "../src/checks/ordinary-wall";
import { checkSpecialWall } from "../src/checks/special-wall";
import type { CheckResult } from "../src/trace";
import { flattenTrace } from "../src/trace";
import type { WallReport } from "../src/checks/report";
import type { WallInput } from "../src/wall";
import { example2 } from "./fixtures";
import { GRADE60, concrete } from "../src/materials";

/** Coefficient-rounding bound — see the module comment. */
const TOL = 0.03;

const IN_LB_UNITS = new Set(["in", "ft", "in2", "in3", "in4", "psi", "ksi", "kip", "kip-ft", "kip-in"]);
const SI_UNITS = new Set(["mm", "m", "mm2", "mm3", "mm4", "MPa", "kN", "kN-m", "kN-mm"]);

/**
 * The one node allowed to carry an imperial tag inside an SI trace.
 *
 * `section/interaction.ts` assembles P–M equilibrium in the canonical kip/in/ksi
 * system in *both* editions — the fiber solver is unit-agnostic arithmetic, not a
 * Code equation, so there is no ACI 318M coefficient to branch on. `section.fc_ksi`
 * is the declared seam that carries f'_c from the printed stress unit into the
 * solver, and it names itself as such in its formula and note. It is allowlisted
 * here rather than silently tolerated: if any *other* node grows an imperial tag
 * in SI mode, that is a bug and this suite must fail.
 */
const CANONICAL_SEAM_IDS = new Set(["section.fc_ksi"]);

const ordinary: WallInput = {
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

const si = <T extends WallInput>(w: T): T => ({ ...w, units: "si" as const });

function allChecks(r: WallReport): CheckResult[] {
  return [...r.general, ...r.perDemand.flatMap((d) => d.checks)];
}

function everyNode(check: CheckResult) {
  const roots = [check.demand, check.capacity, check.utilization, ...check.trace].filter(
    (n): n is NonNullable<typeof n> => n !== undefined,
  );
  return roots.flatMap((r) => flattenTrace(r));
}

interface Case {
  name: string;
  inLb: WallReport;
  siRep: WallReport;
}

const cases: Case[] = [
  {
    name: "ordinary wall (MNL-17 Ex. 1)",
    inLb: checkOrdinaryWall(ordinary),
    siRep: checkOrdinaryWall(si(ordinary)),
  },
  {
    name: "special structural wall (MNL-17 Ex. 2)",
    inLb: checkSpecialWall(example2),
    siRep: checkSpecialWall(si(example2)),
  },
];

describe.each(cases)("$name", ({ inLb, siRep }) => {
  it("produces the same set of checks in both systems", () => {
    expect(allChecks(siRep).map((c) => c.id)).toEqual(allChecks(inLb).map((c) => c.id));
  });

  it("reaches the same overall status", () => {
    expect(siRep.status).toBe(inLb.status);
  });

  it("reaches the same status on every individual check", () => {
    const a = allChecks(inLb);
    const b = allChecks(siRep);
    for (const [i, check] of a.entries()) {
      expect(b[i]!.status, `${check.id} status`).toBe(check.status);
    }
  });

  it("agrees on every utilization within the coefficient-rounding tolerance", () => {
    const a = allChecks(inLb);
    const b = allChecks(siRep);
    for (const [i, check] of a.entries()) {
      const u = check.utilization?.value;
      const v = b[i]!.utilization?.value;
      if (u === undefined || v === undefined) continue;
      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        expect(v, `${check.id} utilization finiteness`).toBe(u);
        continue;
      }
      if (u === 0) {
        expect(v, `${check.id} utilization`).toBe(0);
        continue;
      }
      expect(Math.abs(v / u - 1), `${check.id} utilization ${u} vs ${v}`).toBeLessThan(TOL);
    }
  });

  it("emits only SI unit tags in SI mode", () => {
    for (const check of allChecks(siRep)) {
      for (const n of everyNode(check)) {
        if (n.unit === "1" || n.unit === "pct") continue;
        if (CANONICAL_SEAM_IDS.has(n.id)) continue;
        expect(SI_UNITS.has(n.unit), `${check.id}/${n.id} carries "${n.unit}"`).toBe(true);
      }
    }
  });

  it("emits only in-lb unit tags by default", () => {
    for (const check of allChecks(inLb)) {
      for (const n of everyNode(check)) {
        if (n.unit === "1" || n.unit === "pct") continue;
        expect(IN_LB_UNITS.has(n.unit), `${check.id}/${n.id} carries "${n.unit}"`).toBe(true);
      }
    }
  });

  it("never leaks an in-lb unit into an SI substitution", () => {
    for (const check of allChecks(siRep)) {
      for (const n of everyNode(check)) {
        if (CANONICAL_SEAM_IDS.has(n.id)) continue;
        const tex = `${n.formula ?? ""} ${n.substitution ?? ""}`;
        expect(tex, `${check.id}/${n.id}`).not.toMatch(/\\text\{(psi|ksi|kip|in)\}/);
      }
    }
  });
});
