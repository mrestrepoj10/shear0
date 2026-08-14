import { describe, expect, it } from "vitest";
import { checkMinReinforcement } from "../src/checks/min-reinforcement";
import { GRADE60, concrete } from "../src/materials";
import type { RebarGrade } from "../src/materials";
import { flattenTrace, traceToMarkdown, validateTrace } from "../src/trace";
import type { CheckResult, Traced } from "../src/trace";
import type { WallInput } from "../src/wall";

/**
 * MNL-17(21) Shear Wall Example 1 (printed pp. 444-450): 28 ft x 12 in.
 * ordinary cast-in-place wall, No. 5 @ 12 in. e.f. both ways, two curtains,
 * end-zone bar stations at 3 in. and 12 in. from each wall end.
 */
const example1: WallInput = {
  geometry: { lw: 336, h: 12, hw: 92 * 12, lu: 202, k: 0.8, cover: 1.5 },
  concrete: concrete(5000),
  grade: GRADE60,
  vertical: { bar: "5", spacing: 12, curtains: 2 },
  horizontal: { bar: "5", spacing: 12, curtains: 2 },
  // count 4 across 2 curtains => stations at 3 in. and 3 + 9 = 12 in.
  endZone: { bar: "5", count: 4, distanceToFirst: 3, spacing: 9 },
  demands: [{ id: "base", Pu: 1015, Mu: 18600, Vu: 235, MuOut: 60, VuOut: 16 }],
  wallType: "bearing",
  system: "ordinary",
};

const ex1Demand = example1.demands[0]!;

function node(check: CheckResult, id: string): Traced<any> {
  const roots = [check.demand, check.capacity, check.utilization, ...check.trace].filter(
    (n): n is Traced<any> => n !== undefined,
  );
  for (const root of roots) {
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

const GRADE40: RebarGrade = { fy: 40, Es: 29000, ety: 40 / 29000 };

describe("checkMinReinforcement — MNL-17 Example 1", () => {
  const check = checkMinReinforcement(example1, ex1Demand);

  it("produces a valid trace", () => {
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });

  it("computes alpha_c = 2 for hw/lw = 3.29", () => {
    expect(node(check, "wall.hw_over_lw").value).toBeCloseTo(3.286, 3);
    expect(node(check, "minreinf.alpha_c").value).toBe(2);
  });

  it("computes the 11.6.1 threshold as 214 kip and takes the 11.6.2 path", () => {
    const threshold = node(check, "minreinf.threshold");
    // handbook: 0.5(0.75)(2)sqrt(5000)(4032) = 214 kip
    expect(threshold.value).toBeCloseTo(214, 0);
    expect(Math.abs(threshold.value - 214) / 214).toBeLessThan(0.01);
    expect(node(check, "minreinf.trigger").value).toBe(true);
    expect(node(check, "minreinf.rho_t_req").ref?.section).toBe("11.6.2");
  });

  it("computes provided ratios of 0.62/144", () => {
    expect(node(check, "minreinf.rho_l").value).toBeCloseTo(0.62 / 144, 12);
    expect(node(check, "minreinf.rho_t").value).toBeCloseTo(0.62 / 144, 12);
    expect(node(check, "minreinf.rho_t").value).toBeCloseTo(0.0043, 4);
  });

  it("reproduces the handbook Eq. (11.6.2) intermediate when hw/lw is capped at 2.0", () => {
    const rhoT = node(check, "minreinf.rho_t").value;
    const handbook = 0.0025 + 0.5 * (2.5 - 2.0) * (rhoT - 0.0025);
    expect(handbook).toBeCloseTo(0.0030, 4);
  });

  it("uses the raw hw/lw in Eq. (11.6.2), giving a negative second term", () => {
    const eq = node(check, "minreinf.rho_l_eq");
    // 0.0025 + 0.5(2.5 - 3.286)(0.00431 - 0.0025) = 0.00179
    expect(eq.value).toBeLessThan(0.0025);
    expect(eq.value).toBeCloseTo(0.001791, 6);
    expect(node(check, "minreinf.rho_l_floor").value).toBe(0.0025);
    expect(eq.note).toMatch(/no cap/);
  });

  it("waives the longitudinal requirement because no rho_t is required for strength", () => {
    expect(node(check, "minreinf.rho_t_strength").value).toBe(0);
    expect(node(check, "minreinf.rho_l_req").value).toBe(0);
    expect(node(check, "minreinf.rho_l_req").note).toMatch(/waived/);
  });

  it("requires rho_t >= 0.0025 and passes", () => {
    expect(node(check, "minreinf.rho_t_req").value).toBe(0.0025);
    expect(check.utilization?.value).toBeCloseTo(0.0025 / (0.62 / 144), 6);
    expect(check.status).toBe("ok");
  });

  it("renders a readable trace", () => {
    expect(traceToMarkdown(check)).toMatchInlineSnapshot(`
      "## Minimum distributed reinforcement

      ACI 318-19 §11.6 — **OK**

      - demand: V_u = 235 kip
      - utilization: ρ_min/ρ_prov = 0.581

      - **V_u > 0.5φα_cλ√f'_c·A_cv** = true — high-shear trigger — ACI 318-19 §11.6.1
        - formula: \`V_u > 0.5\\,\\phi\\,\\alpha_c\\lambda\\sqrt{f'_c}\\,A_{cv}\`
        - subst: \`235 > 214 \\Rightarrow \\text{true}\`
        - note: 11.6.2 minimums govern
        - **V_u** = 235 kip — factored in-plane shear (base)
        - **0.5φα_cλ√f'_c·A_cv** = 214 kip — shear demand below which Table 11.6.1 minimums apply — ACI 318-19 §11.6.1
          - formula: \`0.5\\,\\phi\\,\\alpha_c\\lambda\\sqrt{f'_c}\\,A_{cv}\`
          - subst: \`0.5 \\times 0.75 \\times 570 = 214\\ \\text{kip}\`
          - **0.5** = 0.500 — threshold coefficient on the concrete-alone shear strength — ACI 318-19 §11.6.1
          - **φ** = 0.750 — strength reduction factor for shear — ACI 318-19 §21.2.1
            - note: Table 21.2.1 — shear
          - **α_cλ√f'_c·A_cv** = 570 kip — concrete contribution to in-plane shear strength — ACI 318-19 §11.5.4.3 (Eq. 11.5.4.3)
            - formula: \`\\alpha_c\\,\\lambda\\sqrt{f'_c}\\,A_{cv}\`
            - subst: \`2.00 \\times 1.00 \\times \\sqrt{5{,}000} \\times 4{,}032 = 570{,}211\\ \\text{lb} = 570\\ \\text{kip}\`
            - note: ρt·fyt term omitted — this is the concrete-alone strength used by the 11.6 threshold and the 11.7 spacing trigger
            - **α_c** = 2.00 — shear strength coefficient — ACI 318-19 §11.5.4.3
              - formula: \`\\alpha_c = 2\`
              - subst: \`\\alpha_c = 2 \\quad (h_w/\\ell_w = 3.286 \\ge 2.0)\`
              - note: slender wall, hw/ℓw ≥ 2.0 (in-lb coefficient); hw/ℓw shall be taken as the larger of the entire-wall and segment ratios — the entire-wall ratio is used here
              - **h_w/ℓ_w** = 3.29 — wall aspect ratio
                - formula: \`h_w/\\ell_w\`
                - subst: \`h_w/\\ell_w = 1{,}104 / 336 = 3.286\`
                - **h_w** = 1,104 in — wall height
                - **ℓ_w** = 336 in — wall length
            - **λ** = 1.00 — lightweight concrete modification factor
              - note: normalweight concrete
            - **f'_c** = 5,000 psi — specified concrete compressive strength
            - **A_cv** = 4,032 in2 — gross area of concrete section resisting shear — ACI 318-19 §11.5.4 / R11.5.4.2
              - formula: \`A_{cv} = h\\,\\ell_w\`
              - subst: \`A_{cv} = 12.0 \\times 336 = 4{,}032\\ \\text{in}^2\`
              - **h** = 12.0 in — wall thickness
              - ℓ_w = 336 in (see above)
      - **ρ_min/ρ_prov** = 0.581 — governing minimum-reinforcement utilization — ACI 318-19 §11.6
        - formula: \`\\max(\\rho_{\\ell,min}/\\rho_{\\ell,prov},\\ \\rho_{t,min}/\\rho_{t,prov})\`
        - subst: \`\\max(0.000,\\ 0.581) = 0.581\`
        - **ρ_ℓ,min/ρ_ℓ,prov** = 0 — longitudinal reinforcement utilization — ACI 318-19 §11.6 — OK
          - formula: \`\\rho_{\\ell,min}/\\rho_{\\ell,prov}\`
          - subst: \`0 / 0.00431 = 0.000\`
          - **ρ_ℓ,min** = 0 — minimum longitudinal reinforcement ratio — ACI 318-19 §11.6.2 (Eq. 11.6.2)
            - formula: \`\\rho_{\\ell,min} = \\min(\\rho_{\\ell,11.6.2},\\ \\rho_{t,strength})\`
            - subst: \`\\min(0.0025,\\ 0) = 0\`
            - note: 11.6.2(a): ρℓ need not exceed the ρt required for strength by 11.5.4.3 — that is zero here, so the longitudinal requirement is waived (as in MNL-17 Ex. 1)
            - **ρ_ℓ,11.6.2** = 0.0025 — longitudinal ratio required by 11.6.2(a) before the strength waiver — ACI 318-19 §11.6.2 (Eq. 11.6.2)
              - formula: \`\\rho_\\ell \\ge \\max(0.0025,\\ \\rho_{\\ell,eq})\`
              - subst: \`\\max(0.0025,\\ 0.00179) = 0.0025\`
              - **0.0025** = 0.0025 — minimum distributed reinforcement ratio of 11.6.2 — ACI 318-19 §11.6.2
              - **ρ_ℓ,eq** = 0.00179 — Eq. (11.6.2) longitudinal ratio — ACI 318-19 §11.6.2 (Eq. 11.6.2)
                - formula: \`\\rho_\\ell = 0.0025 + 0.5\\,(2.5 - h_w/\\ell_w)\\,(\\rho_t - 0.0025)\`
                - subst: \`0.0025 + 0.5\\,(2.5 - 3.286)\\,(0.00431 - 0.0025) = 0.00179\`
                - note: hw/ℓw > 2.5 makes the second term negative, so the 0.0025 floor governs [R11.6.2]. MNL-17 Ex. 1 caps hw/ℓw at 2.0 and prints 0.0030; the Code text has no cap
                - 0.0025 = 0.0025 (see above)
                - h_w/ℓ_w = 3.29 (see above)
                - **ρ_t,prov** = 0.00431 — provided transverse (horizontal) reinforcement ratio — ACI 318-19 §11.6
                  - formula: \`\\rho = \\dfrac{n_c A_b}{s\\,h}\`
                  - subst: \`\\rho = \\dfrac{2.00 \\times 0.31}{12.0 \\times 12.0} = 0.00431\`
                  - **n_c** = 2.00 — curtains of distributed reinforcement
                  - **A_b** = 0.310 in2 — area of one No. 5 bar
                  - **s** = 12.0 in — bar spacing
                  - h = 12.0 in (see above)
            - **ρ_t,strength** = 0 — transverse reinforcement ratio required for shear strength — ACI 318-19 §11.5.4.3 (Eq. 11.5.4.3)
              - formula: \`\\rho_{t,strength} = \\max\\!\\left(0,\\ \\dfrac{V_u/\\phi - \\alpha_c\\lambda\\sqrt{f'_c}A_{cv}}{f_{yt}A_{cv}}\\right)\`
              - subst: \`\\max\\!\\left(0,\\ \\dfrac{313{,}333 - 570{,}211}{60{,}000 \\times 4{,}032}\\right) = 0\`
              - note: concrete alone carries Vu/φ, so no transverse reinforcement is required for strength
              - V_u = 235 kip (see above)
              - φ = 0.750 (see above)
              - α_cλ√f'_c·A_cv = 570 kip (see above)
              - **f_y** = 60,000 psi — specified yield strength of reinforcement
              - A_cv = 4,032 in2 (see above)
          - **ρ_ℓ,prov** = 0.00431 — provided longitudinal (vertical) reinforcement ratio — ACI 318-19 §11.6
            - formula: \`\\rho = \\dfrac{n_c A_b}{s\\,h}\`
            - subst: \`\\rho = \\dfrac{2.00 \\times 0.31}{12.0 \\times 12.0} = 0.00431\`
            - **n_c** = 2.00 — curtains of distributed reinforcement
            - **A_b** = 0.310 in2 — area of one No. 5 bar
            - **s** = 12.0 in — bar spacing
            - h = 12.0 in (see above)
        - **ρ_t,min/ρ_t,prov** = 0.581 — transverse reinforcement utilization — ACI 318-19 §11.6 — OK
          - formula: \`\\rho_{t,min}/\\rho_{t,prov}\`
          - subst: \`0.0025 / 0.00431 = 0.581\`
          - **ρ_t,min** = 0.0025 — minimum transverse reinforcement ratio — ACI 318-19 §11.6.2
            - formula: \`\\rho_t \\ge 0.0025\`
            - subst: \`\\rho_{t,min} = 0.0025\`
            - note: 11.6.2(b)
            - 0.0025 = 0.0025 (see above)
            - V_u > 0.5φα_cλ√f'_c·A_cv = true (see above)
          - ρ_t,prov = 0.00431 (see above)"
    `);
  });
});

describe("checkMinReinforcement — threshold boundary", () => {
  const threshold = (0.5 * 0.75 * 2 * Math.sqrt(5000) * 4032) / 1000;

  it("takes the Table 11.6.1 path when Vu is exactly at the threshold", () => {
    const check = checkMinReinforcement(example1, { id: "at-threshold", Pu: 1015, Mu: 18600, Vu: threshold });
    expect(node(check, "minreinf.trigger").value).toBe(false);
    expect(node(check, "minreinf.rho_l_req").value).toBe(0.0012);
    expect(node(check, "minreinf.rho_t_req").value).toBe(0.002);
    expect(node(check, "minreinf.rho_l_req").ref?.eq).toBe("Table 11.6.1");
    expect(check.status).toBe("ok");
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });

  it("takes the 11.6.2 path just above the threshold", () => {
    const check = checkMinReinforcement(example1, {
      id: "above",
      Pu: 1015,
      Mu: 18600,
      Vu: threshold + 0.001,
    });
    expect(node(check, "minreinf.trigger").value).toBe(true);
  });
});

describe("checkMinReinforcement — Table 11.6.1 rows", () => {
  const lowShear = { id: "low", Pu: 1015, Mu: 18600, Vu: 100 };

  it("selects the 0.0015/0.0025 row for bars larger than No. 5", () => {
    const w: WallInput = {
      ...example1,
      vertical: { bar: "6", spacing: 12, curtains: 2 },
      horizontal: { bar: "6", spacing: 12, curtains: 2 },
      endZone: { bar: "6", count: 4, distanceToFirst: 3, spacing: 9 },
    };
    const check = checkMinReinforcement(w, lowShear);
    expect(node(check, "minreinf.rho_l_req").value).toBe(0.0015);
    expect(node(check, "minreinf.rho_t_req").value).toBe(0.0025);
    expect(node(check, "minreinf.rho_l_req").note).toMatch(/larger than No\. 5/);
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });

  it("selects the 0.0015/0.0025 row for No. 5 bars below Grade 60", () => {
    const check = checkMinReinforcement({ ...example1, grade: GRADE40 }, lowShear);
    expect(node(check, "minreinf.rho_l_req").value).toBe(0.0015);
    expect(node(check, "minreinf.rho_t_req").value).toBe(0.0025);
    expect(node(check, "minreinf.rho_l_req").note).toMatch(/f_y < 60,000 psi/);
  });

  it("flags reinforcement below the Table 11.6.1 minimum as ng", () => {
    const w: WallInput = {
      ...example1,
      vertical: { bar: "3", spacing: 18, curtains: 1 },
      horizontal: { bar: "3", spacing: 18, curtains: 1 },
    };
    const check = checkMinReinforcement(w, lowShear);
    // rho = 0.11/(18 x 12) = 0.00051 < 0.0012
    expect(node(check, "minreinf.rho_l").value).toBeCloseTo(0.11 / 216, 12);
    expect(check.status).toBe("ng");
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });
});

describe("checkMinReinforcement — squat wall (11.6.2 with a positive second term)", () => {
  // hw/lw = 1.0 -> alpha_c = 3; small Acv keeps the threshold low so 11.6.2 governs.
  const squat: WallInput = {
    ...example1,
    geometry: { lw: 120, h: 12, hw: 120, lu: 202, k: 0.8, cover: 1.5 },
    endZone: { bar: "5", count: 4, distanceToFirst: 3, spacing: 9 },
  };
  const check = checkMinReinforcement(squat, { id: "squat", Pu: 500, Mu: 2000, Vu: 400 });

  it("interpolates nothing at hw/lw = 1.0 (alpha_c = 3)", () => {
    expect(node(check, "minreinf.alpha_c").value).toBe(3);
  });

  it("evaluates Eq. (11.6.2) above the floor and applies the strength cap", () => {
    const rhoT = node(check, "minreinf.rho_t").value;
    const eq = 0.0025 + 0.5 * (2.5 - 1.0) * (rhoT - 0.0025);
    expect(node(check, "minreinf.rho_l_eq").value).toBeCloseTo(eq, 12);
    expect(node(check, "minreinf.rho_l_eq").value).toBeGreaterThan(0.0025);
    const strength = node(check, "minreinf.rho_t_strength").value;
    expect(strength).toBeGreaterThan(0);
    expect(node(check, "minreinf.rho_l_req").value).toBeCloseTo(
      Math.min(node(check, "minreinf.rho_l_floor").value, strength),
      12,
    );
    expect(() => validateTrace(allNodes(check))).not.toThrow();
  });
});

describe("checkMinReinforcement — alpha_c interpolation", () => {
  it("interpolates for 1.5 < hw/lw < 2.0", () => {
    const w: WallInput = {
      ...example1,
      geometry: { lw: 336, h: 12, hw: 336 * 1.75, lu: 202, k: 0.8, cover: 1.5 },
    };
    const check = checkMinReinforcement(w, ex1Demand);
    expect(node(check, "minreinf.alpha_c").value).toBeCloseTo(2.5, 12);
  });
});
