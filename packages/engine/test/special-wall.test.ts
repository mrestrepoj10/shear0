import { describe, expect, it } from "vitest";
import {
  amplifiedShear,
  checkSbeDetailing,
  checkSbeRequired,
  checkSeismicWebReinforcement,
  checkSpecialShear,
  checkSpecialWall,
  driftCapacityRatio,
  phiMnAt,
  sbeRequirement,
} from "../src/index";
import type { WallInput } from "../src/index";
import { delta, example2, expectValidTrace, node } from "./fixtures";

/**
 * Phase 3 gate: MNL-17(21) Shear Wall Example 2 — SDC D special structural wall
 * with a special boundary element (`docs/research/mnl-17-shear-wall-examples.md`).
 *
 * Tolerance policy (PLAN.md §3): hand-calc steps ±0.5–1 %, values that the
 * handbook took from ACI's interaction-diagram spreadsheet (φMn, Mpr, c) ±2–4 %
 * for our fiber engine. Each assertion below names the handbook value it is
 * compared against, and every deliberate divergence is called out.
 */
const seismicDemand = example2.demands[0]!;

describe("Example 2 — amplified design shear (18.10.3)", () => {
  const ve = amplifiedShear(example2, seismicDemand);

  it("floors n_s at 0.007 h_wcs and lands on the n_s > 6 branch of ω_v", () => {
    // 0.007(1104) = 7.73 < 8 stories → n_s = 8 governs
    expect(0.007 * 1104).toBeCloseTo(7.728, 3);
    // ω_v = 1.3 + 8/30 = 1.5667 (handbook prints 1.57, i.e. +0.2 %)
    expect(ve.omegaV.value).toBeCloseTo(1.5667, 4);
    expect(Math.abs(delta(ve.omegaV.value, 1.57))).toBeLessThan(0.5);
  });

  it("takes Ω_v = 1.5 because M_pr/M_u falls below the floor", () => {
    // M_pr from our fiber section at P_u = 1015 kip: 49,939 vs handbook 51,900
    // ft-kip (spreadsheet-derived) → −3.8 %. Either value is below 1.5, so Ω_v
    // is identical.
    const ratio = ve.Mpr.value / 37200;
    expect(ratio).toBeCloseTo(1.342, 2);
    expect(Math.abs(delta(ratio, 1.395))).toBeLessThan(4);
    expect(ratio).toBeLessThan(1.5);
    expect(ve.OmegaV.value).toBe(1.5);
  });

  it("gives V_e = 1105 kip with the 3V_u cap not governing", () => {
    // handbook 1107 kip → −0.23 %
    expect(ve.Ve.value).toBeCloseTo(1104.5, 0);
    expect(Math.abs(delta(ve.Ve.value, 1107))).toBeLessThan(1.5);
    expect(3 * 470).toBe(1410);
    expect(ve.Ve.value).toBeLessThan(1410);
  });
});

describe("Example 2 — in-plane shear strength (18.10.4, 21.2.4.1)", () => {
  const check = checkSpecialShear(example2, seismicDemand);

  it("has a valid trace and passes", () => {
    expectValidTrace(check);
    expect(check.status).toBe("ok");
  });

  it("reproduces V_n and both 18.10.4.4 caps", () => {
    expect(node(check, "sw.shear.Vn").value).toBeCloseTo(2048.6, 0); // handbook 2045, +0.18 %
    expect(node(check, "sw.shear.cap_8").value).toBeCloseTo(2280.8, 0); // handbook 2281
    expect(node(check, "sw.shear.cap_10").value).toBeCloseTo(2851.1, 0); // handbook 2851
    // single segment: A_cw = A_cv, so the 8√f'c limit is the effective cap and
    // V_n (2049) sits below it — no cap applied.
    expect(node(check, "sw.shear.Vn").value).toBe(node(check, "sw.shear.Vn_calc").value);
  });

  it("drops φ to 0.60 via 21.2.4.1", () => {
    expect(node(check, "sw.shear.phi").value).toBe(0.6);

    // V@Mn = 2 M_n(P_u = 1200)/h_sx with the **nominal** M_n, per 21.2.4.1.
    const vAtMn = node(check, "sw.shear.V_at_Mn").value;
    expect(vAtMn).toBeCloseTo(5034, -1);

    // DIVERGENCE, and its explanation: the handbook prints 4650 kip from
    // "Mn-level Mu = 41,860 ft-kip". 41,860 is not the nominal moment — it is
    // the **design** moment φM_n read off the interaction diagram at P_u = 1200,
    // which our engine reproduces to 0.05 %. Feeding that same φM_n through the
    // handbook's own 2M/h_sx gives their 4650 exactly. We keep the Code's
    // "nominal moment strength" wording, which is the more conservative reading
    // (larger V@M_n → more likely φ = 0.60), hence +8.3 % on this intermediate.
    expect(phiMnAt(example2, 1200)).toBeCloseTo(41860, -2);
    expect(Math.abs(delta(phiMnAt(example2, 1200), 41860))).toBeLessThan(0.5);
    expect((2 * 12 * phiMnAt(example2, 1200)) / 216).toBeCloseTo(4650, -1);
    expect(delta(vAtMn, 4650)).toBeGreaterThan(0); // conservative

    // The handbook's phrasing of the same conclusion: V@Mn exceeds even the
    // absolute 10√f'c·A_cw ceiling, so M_n can never be developed in shear.
    expect(vAtMn).toBeGreaterThan(2851);
    expect(node(check, "sw.shear.V_at_Mn_vs_cap").value).toBeGreaterThan(1);
  });

  it("passes φV_n ≥ V_e", () => {
    expect(node(check, "sw.shear.phiVn").value).toBeCloseTo(1229.2, 0); // handbook 1227, +0.18 %
    expect(check.utilization!.value).toBeCloseTo(1104.5 / 1229.2, 3);
    expect(check.utilization!.value).toBeLessThan(1);
    expect(check.demand!.id).toBe("sw.ve.Ve"); // the demand is V_e, not V_u
  });

  it("keeps φ = 0.75 under the 18.10.4.6 reading", () => {
    const exempt = checkSpecialShear(
      { ...example2, phiSeismicReading: "exempt-18.10.4.6" },
      seismicDemand,
    );
    expect(node(exempt, "sw.shear.phi").value).toBe(0.75);
    expect(node(exempt, "sw.shear.phiVn").value).toBeCloseTo(1536.5, 0);
  });
});

describe("Example 2 — web reinforcement (18.10.2)", () => {
  const check = checkSeismicWebReinforcement(example2, seismicDemand);

  it("has a valid trace and passes", () => {
    expectValidTrace(check);
    expect(check.status).toBe("ok");
  });

  it("reports the provided ratios and the 0.0025 minimums", () => {
    expect(node(check, "sw.reinf.rho_l").value).toBeCloseTo(0.011, 4); // handbook 0.0110
    expect(node(check, "sw.reinf.rho_t").value).toBeCloseTo(0.00611, 5); // handbook 0.0061
    expect(node(check, "sw.reinf.rho_l_req").value).toBe(0.0025);
    expect(node(check, "sw.reinf.rho_t_req").value).toBe(0.0025);
    // V_u = 470 > λ√f'c·A_cv = 285 kip, so the Ch. 11 relaxation does not apply
    expect(node(check, "sw.reinf.limit_1").value).toBeCloseTo(285.1, 1);
    expect(node(check, "sw.reinf.low_shear").value).toBe(false);
  });

  it("requires two curtains through the h_w/ℓ_w trigger", () => {
    // V_u = 470 < 2λ√f'c·A_cv = 570 kip, so the shear trigger is not what fires
    expect(node(check, "sw.reinf.limit_2").value).toBeCloseTo(570.2, 1);
    expect(node(check, "sw.reinf.curtains_req").value).toBe(2);
    expect(node(check, "sw.reinf.util_curtains").status).toBe("ok");
  });

  it("marks 18.10.4.3 not applicable for this slender wall", () => {
    expect(node(check, "sw.reinf.rho_l_ge_rho_t").status).toBe("na");
  });

  it("satisfies the 18.10.2.4 end-zone ratio", () => {
    // 6√5000/60000 = 0.00707; provided: 5 stations × 1.58 in² over 50.4 × 12 in²
    expect(node(check, "sw.reinf.end_zone_length").value).toBeCloseTo(50.4, 3);
    expect(node(check, "sw.reinf.end_zone_rho_req").value).toBeCloseTo(0.007071, 6);
    expect(node(check, "sw.reinf.end_zone_As").value).toBeCloseTo(7.9, 3);
    expect(node(check, "sw.reinf.end_zone_rho").value).toBeCloseTo(0.01306, 5);
    expect(node(check, "sw.reinf.end_zone_util").status).toBe("ok");
  });

  it("keeps spacing under the 18 in. cap", () => {
    expect(node(check, "sw.reinf.util_s").value).toBeCloseTo(12 / 18, 4);
    expect(node(check, "sw.reinf.util_s").status).toBe("ok");
  });
});

describe("Example 2 — boundary element requirement (18.10.6.2)", () => {
  const req = sbeRequirement(example2, seismicDemand);
  const check = checkSbeRequired(example2, seismicDemand);

  it("has a valid trace", () => {
    expectValidTrace(check);
  });

  it("selects the displacement-based method", () => {
    expect(req.method).toBe("displacement");
    expect(node(check, "wall.hwcs_over_lw").value).toBeCloseTo(3.286, 3);
  });

  it("computes δ_u, the drift ratio and the trigger", () => {
    expect(node(check, "sbe.req.delta_u").value).toBe(12); // C_d δ_e = 5(2.4)
    expect(node(check, "sbe.req.drift").value).toBeCloseTo(0.01087, 5); // 12/1104
    expect(node(check, "sbe.req.drift_15").value).toBeCloseTo(0.016304, 6); // handbook 0.0163
    // c = 68.68 in. from our fiber engine vs 67.9 in. from ACI's spreadsheet (+1.2 %)
    expect(req.c).toBeCloseTo(68.68, 1);
    expect(Math.abs(delta(req.c, 67.9))).toBeLessThan(4);
    // ℓ_w/(600c) = 0.008154 (handbook 0.00825 with their c → −1.2 %)
    expect(node(check, "sbe.req.limit").value).toBeCloseTo(0.008154, 6);
    expect(Math.abs(delta(node(check, "sbe.req.limit").value, 0.00825))).toBeLessThan(4);
    expect(req.required).toBe(true);
  });
});

describe("Example 2 — boundary element detailing (18.10.6.4)", () => {
  const ve = amplifiedShear(example2, seismicDemand);
  const check = checkSbeDetailing(example2, seismicDemand, ve.Ve);

  it("has a valid trace", () => {
    expectValidTrace(check);
  });

  it("fails the 18.10.6.4(a) length by 1.1 in. — a c-sensitivity, not a code disagreement", () => {
    // Required ℓ_be = max(c − 0.1ℓ_w, c/2). With OUR c = 68.68 in. that is
    // 35.08 in. > the 34 in. the handbook designed. The handbook's own c
    // (67.9 in., from ACI's interaction spreadsheet) gives 34.3 in., which
    // rounds to their 34 in. answer. Our c is 1.2 % larger and the requirement
    // is essentially c itself, so the 34 in. element lands 3 % short.
    // Reported honestly rather than tolerance-fudged into an "ok".
    expect(node(check, "sbe.length_req").value).toBeCloseTo(35.08, 2);
    expect(node(check, "sbe.util_length").status).toBe("ng");
    expect(node(check, "sbe.util_length").value).toBeCloseTo(35.08 / 34, 3);

    const handbookC = 67.9;
    expect(Math.max(handbookC - 0.1 * 336, handbookC / 2)).toBeCloseTo(34.3, 1);
    expect(Math.round(Math.max(handbookC - 0.1 * 336, handbookC / 2))).toBe(34);
  });

  it("fails width option (ii) but passes the drift-capacity option (iii)", () => {
    // (ii) √(0.025 c ℓ_w) = 24.0 in. > b = 16 in. (handbook 23.9 in.)
    expect(node(check, "sbe.b_sqrt_req").value).toBeCloseTo(24.02, 1);
    expect(Math.abs(delta(node(check, "sbe.b_sqrt_req").value, 23.9))).toBeLessThan(1);

    // (iii) δ_c/h_wcs at b = 16 in. with OUR c and V_e: 0.01713 (handbook 0.0173
    // from c = 67.9 in., V_e = 1107 kip → −1.0 %), still ≥ 1.5δ_u/h_wcs = 0.01630
    const driftCap = node(check, "sbe.drift_capacity").value;
    expect(driftCap).toBeCloseTo(0.017128, 5);
    expect(Math.abs(delta(driftCap, 0.0173))).toBeLessThan(2);
    expect(driftCap).toBeGreaterThan(0.016304);
    // the 0.015 floor does not govern here
    expect(node(check, "sbe.drift_capacity_raw").value).toBe(driftCap);

    expect(node(check, "sbe.util_width").status).toBe("ok");
  });

  it("passes the remaining geometric limits", () => {
    expect(node(check, "sbe.b_hu16_req").value).toBe(13.5); // h_u/16 = 216/16 ≤ 16 in.
    expect(node(check, "sbe.util_b_hu16").status).toBe("ok");

    expect(node(check, "sbe.c_over_lw").value).toBeCloseTo(0.204, 3);
    expect(node(check, "sbe.b_12_util").status).toBe("na"); // c/ℓ_w < 3/8

    expect(node(check, "sbe.hx_max").value).toBeCloseTo(10.667, 3); // min(14, ⅔·16)
    expect(node(check, "sbe.util_hx").status).toBe("ok"); // h_x = 10 in.

    // vertical extent max(ℓ_w, M_u/4V_u) = max(336, 237.4) — informational.
    expect(node(check, "sbe.extent_req").value).toBe(336);
  });

  it("computes the 18.7.5.3 tie spacing chain", () => {
    // s_o = 4 + (14 − 10)/3 = 5.33 in. (the handbook prints 5.0 from an earlier
    // h_x = 11 in. layout, before it added intermediate bars to reach h_x = 10)
    expect(node(check, "sbe.so").value).toBeCloseTo(5.333, 3);
    // s ≤ min(16/3, 6(1.0), 5.33) = 5.33 in.; provided 4 in.
    expect(node(check, "sbe.least_dim_3").value).toBeCloseTo(5.333, 3);
    expect(node(check, "sbe.six_db").value).toBe(6);
    expect(node(check, "sbe.s_req").value).toBeCloseTo(5.333, 3);
    expect(node(check, "sbe.util_s").status).toBe("ok");
  });

  it("reproduces the Table 18.10.6.4(g) confinement amount", () => {
    expect(node(check, "sbe.Ag_be").value).toBe(544); // 16 × 34
    expect(node(check, "sbe.Ach").value).toBe(403); // 13 × 31
    expect(node(check, "sbe.Ash_ratio_req").value).toBeCloseTo(0.00875, 5);
    expect(node(check, "sbe.Ash_ratio_req").value).toBeCloseTo(
      0.3 * (544 / 403 - 1) * (5 / 60),
      10,
    );
    // 0.00875(4)(13)/0.2 = 2.27 → 3 No. 4 legs, which is what is provided
    expect(node(check, "sbe.legs_req").value).toBeCloseTo(2.27, 2);
    expect(Math.ceil(node(check, "sbe.legs_req").value)).toBe(3);
    expect(node(check, "sbe.util_ash").status).toBe("ok");
  });

  it("is NG overall, driven solely by the length sub-check", () => {
    expect(check.status).toBe("ng");
    const ngNodes = ["sbe.util_length"];
    for (const id of [
      "sbe.util_width",
      "sbe.util_b_hu16",
      "sbe.util_hx",
      "sbe.util_s",
      "sbe.util_ash",
    ]) {
      expect(node(check, id).status, id).toBe("ok");
    }
    for (const id of ngNodes) expect(node(check, id).status, id).toBe("ng");
  });
});

describe("Example 2 — full report", () => {
  const report = checkSpecialWall(example2);
  const all = [...report.general, ...report.perDemand.flatMap((d) => d.checks)];

  it("runs the expected checks per demand", () => {
    expect(report.general.map((c) => c.id)).toEqual(["detailing.thickness"]);
    expect(report.perDemand).toHaveLength(2);
    expect(report.perDemand[0]!.checks.map((c) => c.id)).toEqual([
      "sw.web-reinforcement",
      "detailing.spacing",
      "sw.in-plane-shear",
      "flexure.axial",
      "sbe.required",
      "sbe.detailing",
      "oop.simplified-axial",
      "oop.shear",
    ]);
    // the second combination carries no out-of-plane demands
    expect(report.perDemand[1]!.checks).toHaveLength(6);
  });

  it("validates every trace in the report", () => {
    for (const c of all) expectValidTrace(c);
  });

  it("passes every check except the SBE length", () => {
    // Honest outcome: the handbook's own 34 in. boundary element is 1.1 in.
    // short of what OUR neutral axis depth demands, so the report is NG.
    expect(report.status).toBe("ng");
    for (const c of all) {
      if (c.id === "sbe.detailing") expect(c.status).toBe("ng");
      else expect(c.status, c.id).toBe("ok");
    }
  });

  it("passes flexure at both axial levels", () => {
    for (const dc of report.perDemand) {
      const flexure = dc.checks.find((c) => c.id === "flexure.axial")!;
      expect(flexure.status).toBe("ok");
      // handbook φMn = 40,200 ft-kip at P_u = 1015 kip
      if (dc.demand.id === "seismic") expect(flexure.capacity!.value).toBeCloseTo(40200, -2);
    }
  });

  it("goes fully OK once the boundary element is lengthened to the required 35.5 in.", () => {
    const fixed: WallInput = {
      ...example2,
      sbe: { ...example2.sbe!, length: 35.5 },
    };
    expect(checkSpecialWall(fixed).status).toBe("ok");
  });
});

describe("Eq. (18.10.6.2b) against the handbook's printed arithmetic", () => {
  // Handbook inputs: c = 67.9 in., V_e = 1107 kip, ℓ_w = 336 in., A_cv = 4032 in²
  const args = { lw: 336, c: 67.9, Ve: 1107, sqrtFc: Math.sqrt(5000), Acv: 4032 };

  it("gives 0.0035 at b = 12 in.", () => {
    expect(driftCapacityRatio({ ...args, b: 12 })).toBeCloseTo(0.0035, 4);
  });

  it("gives 0.0173 at b = 16 in.", () => {
    expect(driftCapacityRatio({ ...args, b: 16 })).toBeCloseTo(0.0173, 4);
  });
});
