import { describe, expect, it } from "vitest";
import { alphaC, checkInPlaneShear } from "../src/checks/shear-in-plane";
import { GRADE60, concrete } from "../src/materials";
import { flattenTrace, traceToMarkdown, validateTrace } from "../src/trace";
import type { CheckResult, Traced } from "../src/trace";
import type { Demands, WallInput } from "../src/wall";

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

const base: Demands = example1.demands[0]!;

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

function withAspect(ratio: number): WallInput {
  return { ...example1, geometry: { ...example1.geometry, hw: ratio * example1.geometry.lw } };
}

describe("alphaC (11.5.4.3 / 11.5.4.4)", () => {
  it("uses 2 for the Example 1 wall (hw/lw = 3.29)", () => {
    const a = alphaC(example1);
    expect(a.value).toBe(2);
    expect(a.ref?.section).toBe("11.5.4.3");
    expect(a.id).toBe("shear.alpha_c");
    expect(a.note).toContain("larger of the entire-wall and segment ratios");
    expect(() => validateTrace([a])).not.toThrow();
  });

  it("uses 3 at hw/lw = 1.5", () => {
    expect(alphaC(withAspect(1.5)).value).toBe(3);
  });

  it("interpolates linearly to 2.5 at hw/lw = 1.75", () => {
    expect(alphaC(withAspect(1.75)).value).toBeCloseTo(2.5, 12);
  });

  it("uses 2 at hw/lw = 2.0", () => {
    expect(alphaC(withAspect(2.0)).value).toBe(2);
  });

  it("uses 3 for squat walls below 1.5", () => {
    expect(alphaC(withAspect(1.0)).value).toBe(3);
  });

  it("reduces alpha_c under net axial tension (Eq. 11.5.4.4)", () => {
    const tension: Demands = { ...base, Pu: -100 };
    const a = alphaC(example1, tension);
    // 2(1 + (-100,000)/(500 x 4032)) = 1.9008
    expect(a.value).toBeCloseTo(1.9008, 4);
    expect(a.value).toBeLessThan(alphaC(example1, base).value);
    expect(a.ref?.section).toBe("11.5.4.4");
    expect(() => validateTrace([a])).not.toThrow();
  });

  it("floors alpha_c at zero for large net tension", () => {
    const a = alphaC(example1, { ...base, Pu: -5000 });
    expect(a.value).toBe(0);
    expect(a.note).toContain("taken as 0");
  });

  it("ignores the tension branch when the section is in compression", () => {
    expect(alphaC(example1, base).ref?.section).toBe("11.5.4.3");
  });
});

describe("checkInPlaneShear — MNL-17(21) Example 1", () => {
  const check = checkInPlaneShear(example1, base);

  it("produces a valid trace", () => {
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it("reproduces the handbook concrete-alone term (570 kip)", () => {
    const vnc = node(check, "shear.vnc");
    expect(vnc.value).toBeCloseTo(570, 0);
    expect(Math.abs(vnc.value / 570 - 1)).toBeLessThan(0.01);
    expect(vnc.unit).toBe("kip");
  });

  it("reproduces the handbook cap phi*8*sqrt(f'c)*Acv = 1711 kip", () => {
    const vnMax = node(check, "shear.vn_max");
    const phi = node(check, "shear.phi");
    expect(Math.abs((phi.value * vnMax.value) / 1711 - 1)).toBeLessThan(0.01);
  });

  it("does not hit the 11.5.4.2 cap", () => {
    expect(node(check, "shear.vn_calc").value).toBeLessThan(node(check, "shear.vn_max").value);
    expect(node(check, "shear.Vn").note).toContain("not reached");
  });

  it("computes rho_t = 0.0043 from the horizontal layer", () => {
    expect(node(check, "shear.rho_t").value).toBeCloseTo(0.0043, 4);
  });

  it("includes the rho_t*fyt term the handbook drops (phi*Vn ~ 1209 kip)", () => {
    // Handbook Ex. 1 reports phi*Vn = 428 kip (concrete alone, rho_t term ignored).
    // Full Eq. (11.5.4.3): 0.75 x (570 + 0.0043 x 60,000 x 4032/1000) ~ 1210 kip.
    expect(check.capacity?.value).toBeCloseTo(1209, 0);
    expect(Math.abs((check.capacity?.value ?? 0) / 1210 - 1)).toBeLessThan(0.01);
  });

  it("passes: Vu = 235 kip << phi*Vn", () => {
    expect(check.demand?.value).toBe(235);
    expect(check.status).toBe("ok");
    expect(check.utilization?.value).toBeLessThan(1);
    expect(check.utilization?.value).toBeCloseTo(235 / 1208.9, 3);
  });

  it("uses phi = 0.75 from Table 21.2.1", () => {
    const phi = node(check, "shear.phi");
    expect(phi.value).toBe(0.75);
    expect(phi.ref?.section).toBe("21.2.1");
  });
});

describe("checkInPlaneShear — limits and failure", () => {
  it("caps Vn at 8*sqrt(f'c)*Acv when the reinforcement term is large", () => {
    const heavy: WallInput = {
      ...example1,
      horizontal: { bar: "11", spacing: 4, curtains: 2 },
    };
    const check = checkInPlaneShear(heavy, base);
    const vn = node(check, "shear.Vn");
    const vnMax = node(check, "shear.vn_max");
    expect(node(check, "shear.vn_calc").value).toBeGreaterThan(vnMax.value);
    expect(vn.value).toBeCloseTo(vnMax.value, 9);
    expect(vn.note).toContain("11.5.4.2");
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it("reports ng when Vu exceeds phi*Vn", () => {
    const check = checkInPlaneShear(example1, { ...base, Vu: 2000 });
    expect(check.status).toBe("ng");
    expect(check.utilization?.value).toBeGreaterThan(1);
    expect(() => validateTrace(roots(check))).not.toThrow();
  });

  it("keeps a valid trace on the net-tension path", () => {
    const check = checkInPlaneShear(example1, { ...base, Pu: -100 });
    expect(node(check, "shear.alpha_c").value).toBeCloseTo(1.9008, 4);
    expect(() => validateTrace(roots(check))).not.toThrow();
  });
});

describe("traceToMarkdown", () => {
  it("renders the Example 1 in-plane shear check", () => {
    expect(traceToMarkdown(checkInPlaneShear(example1, base))).toMatchInlineSnapshot(`
      "## In-plane shear strength

      ACI 318-19 §11.5.4 (Eq. 11.5.4.3) — **OK**

      - demand: V_u = 235 kip
      - capacity: φV_n = 1,209 kip
      - utilization: V_u/φV_n = 0.194

      - **V_n** = 1,612 kip — nominal in-plane shear strength — ACI 318-19 §11.5.4.2
        - formula: \`V_n = \\min\\left(V_{n,calc},\\ V_{n,max}\\right)\`
        - subst: \`V_n = \\min(1{,}612,\\ 2{,}281) = 1{,}612\\ \\text{kip}\`
        - note: Eq. (11.5.4.3) governs; the 11.5.4.2 limit is not reached
        - **V_n,calc** = 1,612 kip — nominal in-plane shear strength from Eq. (11.5.4.3) — ACI 318-19 §11.5.4.3 (Eq. 11.5.4.3)
          - formula: \`V_n = \\left(\\alpha_c\\,\\lambda\\sqrt{f'_c} + \\rho_t f_{yt}\\right) A_{cv}\`
          - subst: \`V_n = 570 + 1{,}042 = 1{,}612\\ \\text{kip}\`
          - **V_nc** = 570 kip — concrete contribution to in-plane shear strength — ACI 318-19 §11.5.4.3 (Eq. 11.5.4.3)
            - formula: \`V_{nc} = \\alpha_c\\,\\lambda\\sqrt{f'_c}\\,A_{cv}\`
            - subst: \`V_{nc} = 2.00 \\times 1.00 \\times 70.7 \\times 4{,}032 = 570\\ \\text{kip}\`
            - note: psi × in² → lb, reported in kip; this is the term MNL-17(21) Ex. 1 prints (570 kip)
            - **α_c** = 2.00 — coefficient defining the relative contribution of concrete to in-plane shear strength — ACI 318-19 §11.5.4.3
              - formula: \`\\alpha_c = 2 \\quad (h_w/\\ell_w \\ge 2.0)\`
              - subst: \`h_w/\\ell_w = 3.286 \\ge 2.0 \\Rightarrow \\alpha_c = 2\`
              - note: h_w/ℓ_w is the larger of the entire-wall and segment ratios (11.5.4.1); this model treats the wall as one segment, so the wall ratio governs.
              - **h_w/ℓ_w** = 3.29 — wall aspect ratio
                - formula: \`h_w/\\ell_w\`
                - subst: \`h_w/\\ell_w = 1{,}104 / 336 = 3.286\`
                - **h_w** = 1,104 in — wall height
                - **ℓ_w** = 336 in — wall length
            - **λ** = 1.00 — lightweight concrete modification factor
              - note: normalweight concrete
            - **√f'_c** = 70.7 psi — square root of the specified compressive strength
              - formula: \`\\sqrt{f'_c}\`
              - subst: \`\\sqrt{5{,}000} = 70.7\\ \\text{psi}^{0.5}\`
              - **f'_c** = 5,000 psi — specified concrete compressive strength
            - **A_cv** = 4,032 in2 — gross area of concrete section resisting shear — ACI 318-19 §11.5.4 / R11.5.4.2
              - formula: \`A_{cv} = h\\,\\ell_w\`
              - subst: \`A_{cv} = 12.0 \\times 336 = 4{,}032\\ \\text{in}^2\`
              - **h** = 12.0 in — wall thickness
              - ℓ_w = 336 in (see above)
          - **V_ns** = 1,042 kip — distributed horizontal reinforcement contribution to in-plane shear strength — ACI 318-19 §11.5.4.3 (Eq. 11.5.4.3)
            - formula: \`V_{ns} = \\rho_t\\,f_{yt}\\,A_{cv}\`
            - subst: \`V_{ns} = 0.00431 \\times 60{,}000 \\times 4{,}032 = 1{,}042\\ \\text{kip}\`
            - **ρ_t** = 0.00431 — distributed transverse (horizontal) reinforcement ratio — ACI 318-19 §11.5.4.3
              - formula: \`\\rho_t = \\frac{n_c\\,A_{b,t}}{s_t\\,h}\`
              - subst: \`\\rho_t = \\frac{2.00 \\times 0.31}{12.0 \\times 12.0} = 0.00431\`
              - **n_c** = 2.00 — curtains of horizontal reinforcement
              - **A_b,t** = 0.310 in2 — nominal area of one horizontal bar (No. 5)
              - **s_t** = 12.0 in — horizontal bar spacing
              - h = 12.0 in (see above)
            - **f_yt** = 60,000 psi — specified yield strength of transverse reinforcement
            - A_cv = 4,032 in2 (see above)
        - **V_n,max** = 2,281 kip — upper limit on nominal in-plane shear strength — ACI 318-19 §11.5.4.2
          - formula: \`V_{n,max} = 8\\sqrt{f'_c}\\,A_{cv}\`
          - subst: \`V_{n,max} = 8 \\times 70.7 \\times 4{,}032 = 2{,}281\\ \\text{kip}\`
          - **8** = 8.00 — upper limit coefficient on V_n at any horizontal section — ACI 318-19 §11.5.4.2
            - note: in-lb form of the 0.66√f'c (MPa) limit
          - √f'_c = 70.7 psi (see above)
          - A_cv = 4,032 in2 (see above)
      - **φV_n** = 1,209 kip — design in-plane shear strength — ACI 318-19 §11.5.1.1
        - formula: \`\\phi V_n\`
        - subst: \`\\phi V_n = 0.75 \\times 1{,}612 = 1{,}209\\ \\text{kip}\`
        - **φ** = 0.750 — strength reduction factor, shear — ACI 318-19 §21.2.1
          - note: Table 21.2.1 — shear (non-seismic; 21.2.4 may reduce it for special walls resisting E)
        - V_n = 1,612 kip (see above)
      - **V_u/φV_n** = 0.194 — in-plane shear utilization — ACI 318-19 §11.5.1.1
        - formula: \`\\frac{V_u}{\\phi V_n}\`
        - subst: \`\\frac{235}{1{,}209} = 0.194\`
        - **V_u** = 235 kip — factored in-plane shear force
        - φV_n = 1,209 kip (see above)"
    `);
  });
});
