/**
 * §18.10.6 special boundary elements in SI mode — ACI 318M-19.
 *
 * §18.10.6 is mostly *homogeneous*: the 0.2/0.15 stress fractions, the 600 of
 * 18.10.6.2(a), the 0.025 of 18.10.6.2(b)(ii), the 4 / (1/50) / (1/100) / 0.015
 * of 18.10.6.2(b)(iii) and the 0.3 / 0.09 of Table 18.10.6.4(g) are all printed
 * unchanged in the metric edition. What changes is (1) the unit the equation is
 * evaluated in, (2) the 8 → **0.66** coefficient inside the drift-capacity shear
 * term, and (3) the soft-converted absolute lengths: 12 in. → **300 mm**,
 * 14 in. → **350 mm**, 4–6 in. → **100–150 mm**, 6 in. and 8 in. → 150 mm and 200 mm,
 * and the 400/f_y tie trigger, which becomes 2.8/f_y with f_y in MPa.
 *
 * Every number below is computed from the metric expression directly.
 *
 * Wall: MNL-17(21) Shear Wall Example 2 — 336 x 12 in. = 8534.4 x 304.8 mm,
 * SBE 16 x 34 in. = 406.4 x 863.6 mm, cover 1.5 in. = 38.1 mm.
 *   A_g = A_cv = 2,601,285.12 mm²
 *   I_g = 304.8 x 8534.4³/12 = 1.5788930e13 mm⁴
 *   √f'c = 5.871438 MPa^0.5, f'c = 34.4738 MPa, f_y = 413.6854 MPa
 */
import { describe, expect, it } from "vitest";
import {
  amplifiedShear,
  checkSbeDetailing,
  checkSbeRequired,
  driftCapacityRatio,
  sbeRequirement,
  sigmaExtreme,
} from "../src/index";
import type { WallInput } from "../src/index";
import { flattenTrace } from "../src/trace";
import type { Traced } from "../src/trace";
import { example2, expectValidTrace, node } from "./fixtures";

const example2si: WallInput = { ...example2, units: "si" };
const seismic = example2si.demands[0]!;

const SQRT_FC = 5.871438193989766; // √34.4738 MPa^0.5
const ACV = 2601285.12; // mm²

/** Same wall, but squat enough that 18.10.6.1 sends it down the stress path. */
function squat(patch: Partial<WallInput> = {}): WallInput {
  return {
    ...example2si,
    geometry: { ...example2si.geometry, hw: 600, hwcs: 600 }, // 600/336 = 1.79 < 2
    ...patch,
  };
}

describe("18.10.6.3 — σ in MPa, with the 0.2/0.15 fractions unchanged", () => {
  it("computes the extreme-fiber stress in N/mm²", () => {
    // P_u = 1015 kip = 4514.94 kN = 4,514,945 N over A_g = 2,601,285.12 mm²
    //     = 1.73566 MPa
    // M_u = 37,200 kip-ft = 50,436.4 kN·m = 5.04364e10 N·mm; y = 4267.2 mm
    //     M_u y / I_g = 5.04364e10 x 4267.2 / 1.5788930e13 = 13.63122 MPa
    // σ = 1.73566 + 13.63122 = 15.36688 MPa
    const wall = squat();
    const demand = wall.demands[0]!;
    const sigma = sigmaExtreme(wall, demand);
    expect(sigma.value).toBeCloseTo(15.36688, 5);
    expect(sigma.unit).toBe("MPa");
    // and it is the in-lb 2229 psi to within round-off: 15.36688 MPa = 2228.8 psi
    expect(sigmaExtreme(example2, example2.demands[0]!).value / sigma.value).toBeCloseTo(
      145.0377,
      2,
    );
  });

  it("traces I_g in mm⁴ and y in mm", () => {
    const wall = squat();
    checkSbeRequired(wall, wall.demands[0]!);
    const check = checkSbeRequired(wall, wall.demands[0]!);
    expect(node(check, "sbe.req.Ig").value).toBeCloseTo(1.5788929976e13, -4);
    expect(node(check, "sbe.req.Ig").unit).toBe("mm4");
    expect(node(check, "sbe.req.y").value).toBeCloseTo(4267.2, 6);
    expect(node(check, "sbe.req.y").unit).toBe("mm");
  });

  it("keeps 0.2f'c and 0.15f'c as the same fractions, expressed in MPa", () => {
    // 0.2 x 34.4738 = 6.89476 MPa; 0.15 x 34.4738 = 5.17107 MPa
    const wall = squat();
    const demand = wall.demands[0]!;
    const check = checkSbeRequired(wall, demand);
    expect(node(check, "sbe.req.sigma_coeff").value).toBe(0.2);
    expect(node(check, "sbe.req.sigma_disc_coeff").value).toBe(0.15);
    expect(node(check, "sbe.req.sigma_limit").value).toBeCloseTo(6.894757, 6);
    expect(node(check, "sbe.req.sigma_limit").unit).toBe("MPa");
    expect(node(check, "sbe.req.sigma_discontinue").value).toBeCloseTo(5.171068, 6);
    expect(sbeRequirement(wall, demand).required).toBe(true);
    expectValidTrace(check);
  });

  it("does not require one at or below 0.2f'c", () => {
    // P_u = 300 kip → 0.51299 MPa; M_u = 5000 kip-ft → 1.83217 MPa
    // σ = 2.34516 MPa < 6.89476 MPa
    const light = squat({ demands: [{ id: "light", Pu: 300, Mu: 5000, Vu: 100 }] });
    const demand = light.demands[0]!;
    expect(sigmaExtreme(light, demand).value).toBeCloseTo(2.345156, 6);
    expect(sbeRequirement(light, demand).required).toBe(false);
  });
});

describe("18.10.6.2(a) — 1.5δ_u/h_wcs ≥ ℓ_w/(600c), evaluated in mm", () => {
  it("keeps the 600 and evaluates the ratio in mm", () => {
    const check = checkSbeRequired(example2si, seismic);
    const inLbCheck = checkSbeRequired(example2, example2.demands[0]!);
    expect(node(check, "sbe.req.limit_coeff").value).toBe(600);
    // c is traced in mm. It is *not* an exact conversion of the inch answer:
    // the neutral axis comes from the fiber solver, whose only edition-specific
    // ingredient is β1 (0.80376 in MPa vs 0.80 in psi), so the two land 0.34 %
    // apart. 1738.60 mm vs 1744.53 mm — an honest divergence, not a unit bug.
    expect(node(check, "sbe.req.c").unit).toBe("mm");
    expect(node(check, "sbe.req.c").value / (node(inLbCheck, "sbe.req.c").value * 25.4))
      .toBeCloseTo(1, 2);
    expect(node(check, "sbe.req.c").value).toBeCloseTo(1738.6, 1);
    // ℓ_w/(600c) is dimensionless: 8534.4/(600 x 1738.60) = 0.0081810
    const limit = node(check, "sbe.req.limit");
    expect(limit.unit).toBe("1");
    expect(limit.value).toBeCloseTo(8534.4 / (600 * node(check, "sbe.req.c").value), 12);
    expect(limit.value).toBeCloseTo(0.0081813, 7);
    // the drift demand itself is a pure ratio — bit-identical in both systems
    expect(node(check, "sbe.req.drift_15").value).toBeCloseTo(
      node(inLbCheck, "sbe.req.drift_15").value,
      12,
    );
    expect(sbeRequirement(example2si, seismic).required).toBe(true);
  });

  it("applies the 0.005 drift floor identically", () => {
    const stiff: WallInput = {
      ...example2si,
      seismic: { ...example2si.seismic!, deltaE: 0.5 }, // 5 x 0.5/1104 = 0.002264
    };
    const check = checkSbeRequired(stiff, stiff.demands[0]!);
    expect(node(check, "sbe.req.drift_raw").value).toBeCloseTo(0.002264, 6);
    expect(node(check, "sbe.req.drift").value).toBe(0.005);
    expect(sbeRequirement(stiff, stiff.demands[0]!).required).toBe(false);
  });
});

describe("18.10.6.2(b)(ii) — b ≥ √(0.025·c·ℓ_w), evaluated in mm", () => {
  it("keeps the 0.025 coefficient and evaluates the root in mm", () => {
    const check = checkSbeDetailing(example2si, seismic, amplifiedShear(example2si, seismic).Ve);
    const inLbCheck = checkSbeDetailing(
      example2,
      example2.demands[0]!,
      amplifiedShear(example2, example2.demands[0]!).Ve,
    );
    expect(node(check, "sbe.b_sqrt_coeff").value).toBe(0.025);
    const req = node(check, "sbe.b_sqrt_req");
    expect(req.unit).toBe("mm");
    // √(0.025 c ℓ_w) with both lengths in mm equals the inch answer x 25.4 —
    // the root of a product of two lengths scales linearly, so the provision is
    // genuinely unchanged rather than re-coefficiented.
    // (to within the 0.34 % β1 divergence in c — see 18.10.6.2(a) above)
    expect(req.value / (node(inLbCheck, "sbe.b_sqrt_req").value * 25.4)).toBeCloseTo(1, 2);
    expect(req.value).toBeCloseTo(
      Math.sqrt(0.025 * node(check, "sbe.req.c").value * 8534.4),
      6,
    );
    expectValidTrace(check);
  });
});

describe("18.10.6.2(b)(iii) — driftCapacityRatio with 0.66√f'c·A_cv", () => {
  // ℓ_w = 8534.4 mm, b = 406.4 mm, c = 1000 mm, V_e = 3000 kN
  //   0.66√f'c·A_cv = 0.66 x 5.871438 x 2,601,285.12 / 1000 = 10,080.368 kN
  //   geometry term = (1/50)(8534.4/406.4)(1000/406.4)      = 1.033465
  //   shear term    = 3000/10,080.368                       = 0.297608
  //   δ_c/h_wcs = (1/100)[4 − 1.033465 − 0.297608]          = 0.0266893
  const args = { lw: 8534.4, b: 406.4, c: 1000, Ve: 3000, sqrtFc: SQRT_FC, Acv: ACV };

  it("uses 0.66 in the shear denominator when si is set", () => {
    expect(driftCapacityRatio({ ...args, si: true })).toBeCloseTo(0.0266893, 7);
  });

  it("defaults to the in-lb 8 when si is absent", () => {
    // with the same magnitudes the 8 makes the normalizing term 12x larger, so
    // the shear penalty nearly vanishes — proof the coefficient really branches
    expect(driftCapacityRatio(args)).toBeCloseTo(0.0294198, 7);
    expect(driftCapacityRatio({ ...args, si: false })).toBeCloseTo(0.0294198, 7);
  });

  it("keeps the 4, 1/50 and 1/100 of Eq. (18.10.6.2b) unchanged", () => {
    // zero shear and a vanishing geometry term leave the bare 4/100
    expect(driftCapacityRatio({ ...args, Ve: 0, b: 1e9, si: true })).toBeCloseTo(0.04, 12);
    // doubling b quarters the geometry term: (1/100)[4 − 1.033465/4] = 0.0374166
    expect(
      driftCapacityRatio({ ...args, b: 812.8, Ve: 0, si: true }),
    ).toBeCloseTo(0.0374163, 7);
  });

  it("traces the 0.66√f'c·A_cv term in kN and floors the capacity at 0.015", () => {
    const thin: WallInput = { ...example2si, sbe: { ...example2si.sbe!, width: 12 } };
    const check = checkSbeDetailing(thin, seismic, amplifiedShear(thin, seismic).Ve);
    const cap = node(check, "sbe.drift_shear_cap");
    expect(cap.value).toBeCloseTo(10080.368, 3);
    expect(cap.unit).toBe("kN");
    expect(cap.formula).toContain("0.66");
    expect(node(check, "sbe.drift_capacity_floor").value).toBe(0.015);
    expect(node(check, "sbe.drift_capacity_raw").value).toBeCloseTo(0.0034, 3);
    expect(node(check, "sbe.drift_capacity").value).toBe(0.015);
    expect(node(check, "sbe.drift_capacity").note).toContain("0.015 floor governs");
    expect(node(check, "sbe.util_width").status).toBe("ng");
  });
});

describe("18.10.6.4(c) — the 300 mm width floor", () => {
  it("uses 300 mm, not 12 in. = 304.8 mm", () => {
    // A short, heavily loaded wall pushes c/ℓ_w above 3/8. b = 10 in. = 254 mm,
    // so 300/254 = 1.181 → NG. Note that a 12 in. wall (304.8 mm) passes the
    // metric floor and only exactly meets the in-lb one.
    const short: WallInput = {
      ...example2si,
      geometry: { ...example2si.geometry, lw: 120, hw: 1104, hwcs: 1104 },
      endZone: { bar: "8", count: 4, distanceToFirst: 3, spacing: 9 },
      demands: [{ id: "seismic", Pu: 2000, Mu: 8000, Vu: 200 }],
      sbe: { ...example2si.sbe!, width: 10, length: 40 },
    };
    const demand = short.demands[0]!;
    const check = checkSbeDetailing(short, demand, amplifiedShear(short, demand).Ve);
    expect(node(check, "sbe.c_over_lw").value).toBeGreaterThan(3 / 8);
    const floor = node(check, "sbe.b_12_util");
    expect(floor.symbol).toBe("300 mm/b");
    expect(floor.value).toBeCloseTo(300 / 254, 6);
    expect(floor.status).toBe("ng");
    expectValidTrace(check);
  });

  it("passes a 12 in. (304.8 mm) width against the 300 mm floor", () => {
    const short: WallInput = {
      ...example2si,
      geometry: { ...example2si.geometry, lw: 120, hw: 1104, hwcs: 1104 },
      endZone: { bar: "8", count: 4, distanceToFirst: 3, spacing: 9 },
      demands: [{ id: "seismic", Pu: 2000, Mu: 8000, Vu: 200 }],
      sbe: { ...example2si.sbe!, width: 12, length: 40 },
    };
    const demand = short.demands[0]!;
    const check = checkSbeDetailing(short, demand, amplifiedShear(short, demand).Ve);
    expect(node(check, "sbe.b_12_util").value).toBeCloseTo(300 / 304.8, 6);
    expect(node(check, "sbe.b_12_util").status).toBe("ok");
  });
});

describe("18.10.6.4(f) / 18.7.5.3 — the 350 mm h_x cap and s_o = 100 + (350−h_x)/3", () => {
  it("caps h_x at 350 mm and at (2/3)b in mm", () => {
    // b = 16 in. = 406.4 mm → (2/3)b = 270.93 mm < 350 mm, so (2/3)b governs
    const check = checkSbeDetailing(example2si, seismic, amplifiedShear(example2si, seismic).Ve);
    expect(node(check, "sbe.hx_cap").value).toBe(350);
    expect(node(check, "sbe.hx_cap").unit).toBe("mm");
    expect(node(check, "sbe.hx_two_thirds_b").value).toBeCloseTo(270.9333, 4);
    expect(node(check, "sbe.hx_max").value).toBeCloseTo(270.9333, 4);
    expect(node(check, "sbe.hx").value).toBeCloseTo(254, 9); // 10 in.
  });

  it("computes s_o from the metric form", () => {
    // h_x = 10 in. = 254 mm → s_o = 100 + (350 − 254)/3 = 132.0 mm.
    // The in-lb answer 4 + (14 − 10)/3 = 5.333 in. converts to 135.5 mm, so the
    // two editions genuinely disagree here — 132 is the metric answer.
    const check = checkSbeDetailing(example2si, seismic, amplifiedShear(example2si, seismic).Ve);
    const so = node(check, "sbe.so");
    expect(so.value).toBeCloseTo(132, 9);
    expect(so.unit).toBe("mm");
    expect(so.formula).toContain("100");
    expect(so.formula).toContain("350");
    expect(so.note).toContain("100–150 mm");
  });

  it("clamps s_o to the 100–150 mm range", () => {
    // h_x = 2 in. = 50.8 mm → 100 + (350 − 50.8)/3 = 199.7 mm → clamped to 150
    const wide: WallInput = {
      ...example2si,
      sbe: { ...example2si.sbe!, hx: 2, width: 30, length: 40 },
    };
    const check = checkSbeDetailing(wide, seismic, amplifiedShear(wide, seismic).Ve);
    expect(node(check, "sbe.so").value).toBe(150);
    expect(node(check, "sbe.so").note).toContain("150 mm upper bound");
  });

  it("keeps 6d_b a multiple of the metric bar diameter", () => {
    // No. 8 → d_b = 1.0 in. = 25.4 mm → 6d_b = 152.4 mm
    const check = checkSbeDetailing(example2si, seismic, amplifiedShear(example2si, seismic).Ve);
    expect(node(check, "sbe.six_db").value).toBeCloseTo(152.4, 9);
    // s_max = min(b_min/3 = 406.4/3 = 135.47, 6d_b = 152.4, s_o = 132) = 132 mm
    expect(node(check, "sbe.s_req").value).toBeCloseTo(132, 9);
  });
});

describe("Table 18.10.6.4(g) — A_sh with 0.3 and 0.09 unchanged", () => {
  const check = checkSbeDetailing(example2si, seismic, amplifiedShear(example2si, seismic).Ve);

  it("assembles the core in mm and mm² and f'c/f_yt in MPa", () => {
    // b = 406.4, ℓ_be = 863.6, c_c = 38.1 mm
    // b_c1 = 406.4 − 76.2 = 330.2 mm; b_c2 = 863.6 − 76.2 = 787.4 mm
    // A_g,be = 350,967.04 mm²; A_ch = 259,999.48 mm²
    expect(node(check, "sbe.bc1").value).toBeCloseTo(330.2, 6);
    expect(node(check, "sbe.bc2").value).toBeCloseTo(787.4, 6);
    expect(node(check, "sbe.Ag_be").value).toBeCloseTo(350967.04, 2);
    expect(node(check, "sbe.Ach").value).toBeCloseTo(259999.48, 2);
    expect(node(check, "sbe.Ach").unit).toBe("mm2");
    expect(node(check, "sbe.fyt").value).toBeCloseTo(413.6854, 4);
    expect(node(check, "sbe.fyt").unit).toBe("MPa");
  });

  it("keeps the 0.3 and 0.09 coefficients, so the ratio matches in-lb exactly", () => {
    // 0.3(350,967.04/259,999.48 − 1)(34.4738/413.6854) = 0.0087469
    // 0.09(34.4738/413.6854)                           = 0.0075000
    // f'c/f_yt is the same pure number in both editions (5000/60,000 = 1/12),
    // so the required ratio is bit-identical to the in-lb one.
    const inLbCheck = checkSbeDetailing(
      example2,
      example2.demands[0]!,
      amplifiedShear(example2, example2.demands[0]!).Ve,
    );
    const req = node(check, "sbe.Ash_ratio_req");
    expect(req.value).toBeCloseTo(0.0087469, 7);
    expect(req.unit).toBe("1");
    expect(req.formula).toContain("0.3");
    expect(req.formula).toContain("0.09");
    expect(req.value).toBeCloseTo(node(inLbCheck, "sbe.Ash_ratio_req").value, 12);
    // and so is the required leg count — the whole of (g) is dimensionless
    expect(node(check, "sbe.legs_req").value).toBeCloseTo(
      node(inLbCheck, "sbe.legs_req").value,
      9,
    );
  });

  it("goes NG when too few tie legs are provided", () => {
    const light: WallInput = {
      ...example2si,
      sbe: { ...example2si.sbe!, tieLegsAcrossWidth: 2 },
    };
    const c = checkSbeDetailing(light, seismic, amplifiedShear(light, seismic).Ve);
    expect(node(c, "sbe.util_ash").status).toBe("ng");
  });
});

describe("18.10.6.5(b) — the 2.8/f_y tie trigger and Table 18.10.6.5(b) spacing", () => {
  const stiff: WallInput = {
    ...example2si,
    seismic: { ...example2si.seismic!, deltaE: 0.5 },
  };
  const demand = stiff.demands[0]!;

  it("uses 2.8/f_y with f_y in MPa, not 400/f_y converted", () => {
    // 2.8/413.6854 = 0.0067684, against the in-lb 400/60,000 = 0.0066667 —
    // 1.5 % apart, so the metric trigger is the harder one to reach.
    expect(sbeRequirement(stiff, demand).required).toBe(false);
    const check = checkSbeDetailing(stiff, demand, amplifiedShear(stiff, demand).Ve);
    expect(node(check, "sbe.alt.coeff").value).toBe(2.8);
    const limit = node(check, "sbe.alt.rho_limit");
    expect(limit.value).toBeCloseTo(0.0067684, 7);
    expect(limit.symbol).toBe("2.8/f_y");
    expect(node(check, "sbe.alt.trigger").value).toBe(true);
    expectValidTrace(check);
  });

  it("uses min(6d_b, 150 mm) for the Grade 420 row", () => {
    // No. 8 vertical bar → 6d_b = 152.4 mm > 150 mm, so the 150 mm absolute
    // limit governs. The in-lb row gives min(6.0 in., 6 in.) = 6 in. = 152.4 mm,
    // so the metric table is 1.6 % tighter here.
    const check = checkSbeDetailing(stiff, demand, amplifiedShear(stiff, demand).Ve);
    const sReq = node(check, "sbe.alt.s_req");
    expect(sReq.value).toBe(150);
    expect(sReq.unit).toBe("mm");
    expect(sReq.note).toContain("Grade 420");
    expect(sReq.note).toContain("200"); // elsewhere min(8d_b, 200 mm)
    expect(node(check, "sbe.alt.db").value).toBeCloseTo(25.4, 9);
    // provided 4 in. = 101.6 mm ≤ 150 mm
    expect(node(check, "sbe.alt.s_prov").value).toBeCloseTo(101.6, 9);
    expect(check.status).toBe("ok");
  });

  it("is N/A when the boundary ratio stays below 2.8/f_y", () => {
    const lean: WallInput = {
      ...stiff,
      vertical: { bar: "4", spacing: 18, curtains: 2 },
      endZone: { bar: "4", count: 2, distanceToFirst: 3, spacing: 9 },
    };
    const d = lean.demands[0]!;
    const check = checkSbeDetailing(lean, d, amplifiedShear(lean, d).Ve);
    expect(node(check, "sbe.alt.trigger").value).toBe(false);
    expect(check.status).toBe("na");
  });
});

describe("unit tags", () => {
  it("tags every node of both SBE checks with a metric unit", () => {
    const checks = [
      checkSbeRequired(example2si, seismic),
      checkSbeDetailing(example2si, seismic, amplifiedShear(example2si, seismic).Ve),
    ];
    for (const check of checks) {
      const roots = [check.demand, check.capacity, check.utilization, ...check.trace].filter(
        (n): n is Traced<any> => n !== undefined,
      );
      for (const r of roots) {
        for (const n of flattenTrace(r)) {
          expect(["mm", "mm2", "mm4", "MPa", "kN", "kN-m", "1"], n.id).toContain(n.unit);
        }
      }
    }
  });

  it("never prints an in-lb unit in a metric substitution", () => {
    const md = JSON.stringify(
      checkSbeDetailing(example2si, seismic, amplifiedShear(example2si, seismic).Ve),
    );
    expect(md).not.toContain("text{psi}");
    expect(md).not.toContain("text{kip}");
  });
});

describe("the in-lb default is untouched", () => {
  it("keeps the 12/14/4-6/6-8 in. limits and 400/f_y when `units` is absent", () => {
    const d = example2.demands[0]!;
    const check = checkSbeDetailing(example2, d, amplifiedShear(example2, d).Ve);
    expect(node(check, "sbe.hx_cap").value).toBe(14);
    expect(node(check, "sbe.hx_cap").unit).toBe("in");
    expect(node(check, "sbe.so").value).toBeCloseTo(4 + (14 - 10) / 3, 9);
    expect(node(check, "sbe.six_db").value).toBeCloseTo(6, 9);
    expect(node(check, "sbe.drift_shear_cap").formula).toContain("8\\sqrt");
    expect(node(check, "sbe.drift_shear_cap").unit).toBe("kip");
    expectValidTrace(check);

    const stiff: WallInput = { ...example2, seismic: { ...example2.seismic!, deltaE: 0.5 } };
    const sd = stiff.demands[0]!;
    const alt = checkSbeDetailing(stiff, sd, amplifiedShear(stiff, sd).Ve);
    expect(node(alt, "sbe.alt.coeff").value).toBe(400);
    expect(node(alt, "sbe.alt.rho_limit").value).toBeCloseTo(400 / 60000, 9);
    expect(node(alt, "sbe.alt.s_req").value).toBe(6);
  });

  it("keeps σ in psi and the 12 in. floor when `units` is absent", () => {
    const wall: WallInput = { ...example2, geometry: { ...example2.geometry, hw: 600, hwcs: 600 } };
    const d = wall.demands[0]!;
    expect(sigmaExtreme(wall, d).unit).toBe("psi");
    expect(sigmaExtreme(wall, d).value).toBeCloseTo(2229, 0);
    const check = checkSbeRequired(wall, d);
    expect(node(check, "sbe.req.sigma_limit").value).toBe(1000);
  });
});
