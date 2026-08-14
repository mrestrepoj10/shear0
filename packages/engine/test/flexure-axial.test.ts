import { describe, expect, it } from "vitest";
import { checkFlexureAxial } from "../src/checks/flexure-axial";
import { GRADE60, concrete } from "../src/materials";
import { axialLimits, phiMnAt } from "../src/section/interaction";
import { flattenTrace, traceToMarkdown, validateTrace } from "../src/trace";
import type { CheckResult, Traced } from "../src/trace";
import type { Demands, WallInput } from "../src/wall";

const ex1Demand: Demands = {
  id: "base",
  label: "1.2D + 1.0W + 1.0L",
  Pu: 1015,
  Mu: 18600,
  Vu: 235,
  MuOut: 60,
  VuOut: 16,
};

/** MNL-17(21) Shear Wall Example 1. */
const example1: WallInput = {
  geometry: { lw: 336, h: 12, hw: 1104, lu: 202, k: 0.8, cover: 1.5 },
  concrete: concrete(5000),
  grade: GRADE60,
  vertical: { bar: "5", spacing: 12, curtains: 2 },
  horizontal: { bar: "5", spacing: 12, curtains: 2 },
  endZone: { bar: "5", count: 2, distanceToFirst: 3, spacing: 12 },
  demands: [ex1Demand],
  wallType: "bearing",
  system: "ordinary",
};

const ex2Demand: Demands = { id: "base", Pu: 1015, Mu: 37200, Vu: 470, MuOut: 120, VuOut: 32 };

/** MNL-17(21) Shear Wall Example 2 — same section, vertical No. 8 @ 12 in. e.f. */
const example2: WallInput = {
  ...example1,
  vertical: { bar: "8", spacing: 12, curtains: 2 },
  horizontal: { bar: "6", spacing: 12, curtains: 2 },
  endZone: { bar: "8", count: 2, distanceToFirst: 3, spacing: 12 },
  demands: [ex2Demand],
  system: "special",
};

const roots = (check: CheckResult): Traced<unknown>[] =>
  [check.demand, check.capacity, check.utilization, ...check.trace].filter(
    (n): n is Traced<unknown> => n !== undefined,
  );

const nodeById = (check: CheckResult, id: string): Traced<unknown> | undefined => {
  for (const root of roots(check)) {
    const hit = flattenTrace(root).find((n) => n.id === id);
    if (hit) return hit;
  }
  return undefined;
};

describe("checkFlexureAxial — Example 1", () => {
  const check = checkFlexureAxial(example1, ex1Demand);

  it("passes with the handbook capacity", () => {
    expect(check.status).toBe("ok");
    expect(check.capacity?.unit).toBe("kip-ft");
    expect(Math.abs((check.capacity!.value - 24600) / 24600) * 100).toBeLessThan(2.5);
    expect(check.demand?.value).toBe(18600);
  });

  it("reports the vertical-slice utilization", () => {
    const phiMn = phiMnAt(example1, 1015);
    expect(check.utilization?.value).toBeCloseTo(18600 / phiMn, 9);
    expect(check.utilization?.value).toBeLessThan(1);
    expect(check.utilization?.status).toBe("ok");
  });

  it("carries the required traced quantities", () => {
    for (const id of [
      "section.Po",
      "section.Pn_max",
      "flexure.phi_Pn_max",
      "flexure.c",
      "flexure.eps_t",
      "flexure.phi",
      "flexure.Mn",
      "flexure.phiMn",
      "flexure.axial_utilization",
      "flexure.utilization",
    ]) {
      expect(nodeById(check, id), `missing trace node ${id}`).toBeDefined();
    }
  });

  it("puts the governing point in the tension-controlled zone", () => {
    const epsT = nodeById(check, "flexure.eps_t")!.value as number;
    const phi = nodeById(check, "flexure.phi")!.value as number;
    const c = nodeById(check, "flexure.c")!.value as number;
    expect(epsT).toBeGreaterThan(GRADE60.ety + 0.003);
    expect(phi).toBe(0.9);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(336);
    // eps_t = 0.003 (x_t - c)/c with x_t = 333 in.
    expect(epsT).toBeCloseTo((0.003 * (333 - c)) / c, 12);
  });

  it("checks the 22.4.2.1 axial cap as its own sub-check", () => {
    const cap = nodeById(check, "flexure.phi_Pn_max")!;
    expect(cap.value).toBeCloseTo(0.65 * axialLimits(example1).PnMax, 9);
    const util = nodeById(check, "flexure.axial_utilization")!;
    expect(util.value).toBeCloseTo(1015 / (cap.value as number), 12);
    expect(util.status).toBe("ok");
  });

  it("produces a valid trace", () => {
    expect(() => validateTrace(roots(check))).not.toThrow();
  });
});

describe("checkFlexureAxial — Example 2", () => {
  const check = checkFlexureAxial(example2, ex2Demand);

  it("passes with the handbook capacity", () => {
    expect(check.status).toBe("ok");
    expect(Math.abs((check.capacity!.value - 40200) / 40200) * 100).toBeLessThan(2.5);
    expect(check.utilization!.value).toBeCloseTo(37200 / check.capacity!.value, 9);
  });

  it("produces a valid trace", () => {
    expect(() => validateTrace(roots(check))).not.toThrow();
  });
});

describe("checkFlexureAxial — failure modes", () => {
  it("fails when Mu exceeds phiMn", () => {
    const heavy: Demands = { ...ex1Demand, Mu: 40000 };
    const check = checkFlexureAxial(example1, heavy);
    expect(check.status).toBe("ng");
    expect(check.utilization!.value).toBeGreaterThan(1);
    expect(check.utilization!.status).toBe("ng");
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it("fails on the axial cap even when the moment ratio is fine", () => {
    // phiPn,max = 0.65 x 0.80 x Po = 9432 kip for this wall
    const cap = 0.65 * axialLimits(example1).PnMax;
    const squashed: Demands = { ...ex1Demand, Pu: cap * 1.05, Mu: 100 };
    const check = checkFlexureAxial(example1, squashed);
    expect(nodeById(check, "flexure.axial_utilization")!.status).toBe("ng");
    expect(check.status).toBe("ng");
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it("reports no moment capacity when Pu is off the design curve", () => {
    const absurd: Demands = { ...ex1Demand, Pu: 30000, Mu: 1000 };
    const check = checkFlexureAxial(example1, absurd);
    expect(check.status).toBe("ng");
    expect(check.capacity!.value).toBe(0);
    expect(check.utilization).toBeUndefined();
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it("uses |Mu| — the symmetric section has a mirror-image -M surface", () => {
    const reversed: Demands = { ...ex1Demand, Mu: -18600 };
    const a = checkFlexureAxial(example1, ex1Demand);
    const b = checkFlexureAxial(example1, reversed);
    expect(b.utilization!.value).toBeCloseTo(a.utilization!.value, 12);
  });

  it("handles net axial tension", () => {
    const uplift: Demands = { ...ex1Demand, Pu: -400, Mu: 8000 };
    const check = checkFlexureAxial(example1, uplift);
    expect(check.capacity!.value).toBeGreaterThan(0);
    expect(nodeById(check, "flexure.phi")!.value).toBe(0.9);
    expect(() => validateTrace(roots(check))).not.toThrow();
  });
});

describe("traceToMarkdown", () => {
  it("renders the Example 1 check", () => {
    expect(traceToMarkdown(checkFlexureAxial(example1, ex1Demand))).toMatchInlineSnapshot(`
      "## In-plane flexure and axial force (P–M interaction)

      ACI 318-19 §11.5.1.1 / 11.5.2.1 / 22.4 — **OK**

      - demand: M_u = 18,600 kip-ft
      - capacity: φM_n = 24,593 kip-ft
      - utilization: M_u/φM_n = 0.756

      - **φP_{n,max}** = 9,432 kip — design axial strength cap — ACI 318-19 §22.4.2.1
        - formula: \`φP_{n,max} = 0.65 \\times 0.80 P_o\`
        - subst: \`φP_{n,max} = 0.65 \\times 14{,}511 = 9{,}432\\ \\text{kip}\`
        - note: φ = 0.65, compression-controlled (11.4.2.1, Table 21.2.2)
        - **P_{n,max}** = 14,511 kip — maximum nominal axial compressive strength — ACI 318-19 §22.4.2.1
          - formula: \`P_{n,max} = 0.80 P_o\`
          - subst: \`P_{n,max} = 0.80 \\times 18{,}138 = 14{,}511\\ \\text{kip}\`
          - note: tied (non-spiral) member — walls
          - **P_o** = 18,138 kip — nominal axial strength at zero eccentricity — ACI 318-19 §22.4.2.2 (Eq. 22.4.2.2)
            - formula: \`P_o = 0.85 f'_c (A_g - A_{st}) + f_y A_{st}\`
            - subst: \`P_o = 0.85 \\times 5.00 \\times (4{,}032 - 17.98) + 60.0 \\times 17.98 = 18{,}138\\ \\text{kip}\`
            - **f'_c** = 5.00 ksi — specified concrete compressive strength
              - formula: \`f'_c = f'_{c,\\text{psi}}/1000\`
              - subst: \`f'_c = 5{,}000/1000 = 5.00\\ \\text{ksi}\`
              - **f'_c** = 5,000 psi — specified concrete compressive strength
            - **A_g** = 4,032 in2 — gross concrete section area
              - formula: \`A_g = h\\,\\ell_w\`
              - subst: \`A_g = 12.0 \\times 336 = 4{,}032\\ \\text{in}^2\`
              - **h** = 12.0 in — wall thickness
              - **ℓ_w** = 336 in — wall length
            - **A_st** = 18.0 in2 — total area of vertical reinforcement
              - note: 29 bar stations along ℓ_w from the resolved layout
            - **f_y** = 60.0 ksi — specified yield strength of reinforcement
      - **P_u/φP_{n,max}** = 0.108 — axial cap utilization — ACI 318-19 §11.4.2.1 — OK
        - formula: \`P_u/φP_{n,max} \\le 1.0\`
        - subst: \`1{,}015 / 9{,}432 = 0.108\`
        - **P_u** = 1,015 kip — factored axial force
          - note: 1.2D + 1.0W + 1.0L
        - φP_{n,max} = 9,432 kip (see above)
      - **M_u/φM_n** = 0.756 — flexural utilization at P_u — ACI 318-19 §11.5.1.1 — OK
        - formula: \`M_u/φM_n \\le 1.0\`
        - subst: \`18{,}600 / 24{,}593 = 0.756\`
        - note: vertical slice through the design interaction diagram at P_u
        - **M_u** = 18,600 kip-ft — factored in-plane moment
          - note: 1.2D + 1.0W + 1.0L
        - **φM_n** = 24,593 kip-ft — design flexural strength — ACI 318-19 §11.5.1.1
          - formula: \`φM_n = φ\\,M_n\`
          - subst: \`φM_n = 0.900 \\times 27{,}325 = 24{,}593\\ \\text{kip-ft}\`
          - **φ** = 0.900 — strength reduction factor — ACI 318-19 §21.2.2
            - formula: \`φ = 0.65 + 0.25\\,(ε_t - ε_{ty})/0.003,\\ \\ 0.65 \\le φ \\le 0.90\`
            - subst: \`ε_t = 0.01855 \\ge ε_{ty} + 0.003 = 0.00500 \\Rightarrow φ = 0.90\`
            - note: tension-controlled, Table 21.2.2
            - **ε_t** = 0.0185 — net tensile strain in the extreme tension reinforcement — ACI 318-19 §22.2.1.2
              - formula: \`ε_t = 0.003\\,(x_t - c)/c\`
              - subst: \`ε_t = 0.003\\,(333.0 - 46.37)/46.37 = 0.01855\`
              - note: tension positive
              - **x_t** = 333 in — station of the extreme tension reinforcement
                - note: measured from the extreme compression fiber at x = 0
              - **c** = 46.4 in — neutral axis depth at the design axial force — ACI 318-19 §22.2.2
                - formula: \`\\text{solve } φ(c)\\,P_n(c) = P_u \\quad (ε_{cu} = 0.003,\\ a = β_1 c)\`
                - subst: \`φ(c)P_n(c) = 0.900 \\times 1{,}128 = 1{,}015 = P_u = 1{,}015\\ \\text{kip} \\Rightarrow c = 46.37\\ \\text{in}\`
                - note: fiber section: rectangular stress block plus every vertical bar station
                - P_u = 1,015 kip (see above)
                - f'_c = 5.00 ksi (see above)
                - ℓ_w = 336 in (see above)
                - h = 12.0 in (see above)
                - f_y = 60.0 ksi (see above)
                - A_st = 18.0 in2 (see above)
            - **ε_ty** = 0.002 — yield strain of reinforcement
              - note: 0.002 permitted for Grade 60, 21.2.2.1
          - **M_n** = 27,325 kip-ft — nominal flexural strength — ACI 318-19 §22.3.1.1
            - formula: \`M_n = C_c(ℓ_w/2 - a/2) + \\sum A_{s,i}\\,σ_i\\,(ℓ_w/2 - x_i)\`
            - subst: \`M_n = 27{,}325\\ \\text{kip-ft at } c = 46.37\\ \\text{in},\\ P_n = 1{,}128\\ \\text{kip}\`
            - note: moments taken about the section centroid ℓ_w/2
            - c = 46.4 in (see above)
            - f'_c = 5.00 ksi (see above)
            - h = 12.0 in (see above)
            - ℓ_w = 336 in (see above)
            - f_y = 60.0 ksi (see above)
            - A_st = 18.0 in2 (see above)"
    `);
  });
});
