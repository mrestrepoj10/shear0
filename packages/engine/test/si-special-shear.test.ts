/**
 * §18.10.3 (design shear V_e) and §18.10.4 (shear strength) in SI mode —
 * ACI 318M-19 coefficients.
 *
 * The strength expectations are hand-computed from the **metric** expression;
 * a converted in-lb answer would be a different number (0.66 is 0.6 % below
 * 8 x 0.083, 0.83 is 0.6 % below 10 x 0.083).
 *
 * The exceptions are M_pr and M_n: they come out of the fiber solver, which is
 * canonical (ε_cu = 0.003, Whitney block) and carries **no** edition-specific
 * coefficient except β1. Those are asserted as conversions of the in-lb values,
 * to within the 0.03 % β1 divergence — that is the regression guard against the
 * double-conversion bug that was just fixed in `amplifiedShear`.
 *
 * Wall: MNL-17(21) Shear Wall Example 2 — 336 x 12 in. = 8534.4 x 304.8 mm,
 * f'c = 5000 psi = 34.4738 MPa, Grade 60 = 413.685 MPa, No. 6 @ 12 in. e.f.
 *   A_cv  = 8534.4 x 304.8       = 2,601,285.12 mm²
 *   √f'c  = √34.4738             = 5.871438 MPa^0.5
 *   h_wcs/ℓ_w = 1104/336 = 3.286 ≥ 2.0  →  α_c = 0.17
 *   ρ_t   = 2 x 0.44/144         = 0.0061111  (dimensionless — unchanged)
 *   V_u   = 470 kip              = 2090.66 kN
 */
import { describe, expect, it } from "vitest";
import { amplifiedShear, checkSpecialShear } from "../src/index";
import type { Demands, WallInput } from "../src/index";
import { flattenTrace } from "../src/trace";
import type { Traced } from "../src/trace";
import { example2, expectValidTrace, node } from "./fixtures";

/** exact NIST factor — the only legitimate cross-edition conversion here */
const KIP_FT_TO_KN_M = 1.3558179483314004;
const KIP_TO_KN = 4.4482216152605;

const example2si: WallInput = { ...example2, units: "si" };
const seismic = example2si.demands[0]!;
const seismicInLb = example2.demands[0]!;

/** Example 2 with overridden geometry/seismic/demand, in either system. */
function variant(
  base: WallInput,
  patch: { hwcs?: number; hw?: number; ns?: number; hsx?: number; Mu?: number },
): { wall: WallInput; demand: Demands } {
  const d0 = base.demands[0]!;
  const demand: Demands = { ...d0, ...(patch.Mu !== undefined ? { Mu: patch.Mu } : {}) };
  const seis = {
    ...base.seismic!,
    ...(patch.ns !== undefined ? { ns: patch.ns } : {}),
    ...(patch.hsx !== undefined ? { hsx: patch.hsx } : {}),
  };
  const wall: WallInput = {
    ...base,
    geometry: {
      ...base.geometry,
      ...(patch.hwcs !== undefined ? { hwcs: patch.hwcs } : {}),
      ...(patch.hw !== undefined ? { hw: patch.hw } : {}),
    },
    seismic: seis,
    demands: [demand, base.demands[1]!],
  };
  return { wall, demand };
}

describe("amplifiedShear — 18.10.3.1 in SI", () => {
  const si = amplifiedShear(example2si, seismic);
  const inLb = amplifiedShear(example2, seismicInLb);

  it("reports V_u, V_e and their leaves in kN", () => {
    // V_u = 470 kip x 4.4482216 = 2090.664 kN
    expect(si.Ve.unit).toBe("kN");
    expect(si.Ve.value).toBeCloseTo(inLb.Ve.value * KIP_TO_KN, 6);
    // Ω_v = 1.5 (the Table 18.10.3.1.2 floor governs; M_pr/M_u = 1.343),
    // n_s = max(8, 0.007 x 1104) = 8 > 6 → ω_v = 1.3 + 8/30 = 1.56667,
    // V_e = 1.5 x 1.56667 x 470 kip = 1104.5 kip = 4913.06 kN.
    expect(si.Ve.value).toBeCloseTo(1.5 * (1.3 + 8 / 30) * 470 * KIP_TO_KN, 6);
  });

  it("keeps Ω_v, ω_v and the 3V_u cap dimensionless and identical", () => {
    expect(si.OmegaV.value).toBeCloseTo(inLb.OmegaV.value, 12);
    expect(si.omegaV.value).toBeCloseTo(inLb.omegaV.value, 12);
    expect(si.OmegaV.unit).toBe("1");
    expect(si.omegaV.unit).toBe("1");
    expect(si.OmegaV.value).toBe(1.5);
    expect(si.omegaV.value).toBeCloseTo(1.3 + 8 / 30, 12);
    expect(si.Ve.note).toContain("3V_u cap does not govern");
  });

  it("caps V_e at 3V_u in kN, not by converting the in-lb cap", () => {
    const { wall, demand } = variant(example2si, { Mu: 15000 });
    const ve = amplifiedShear(wall, demand);
    expect(ve.OmegaV.value * ve.omegaV.value).toBeGreaterThan(3);
    expect(ve.Ve.value).toBeCloseTo(3 * 470 * KIP_TO_KN, 6);
  });

  describe("M_pr must not be double-converted (regression)", () => {
    it("reports M_pr in kN·m as exactly the in-lb kip-ft value x 1.3558179", () => {
      // M_pr comes from the fiber solver, which is canonical in both editions,
      // so this IS a legitimate conversion check. The bug this guards was a
      // second application of kipFtToKnM on top of `mprAt`'s own reporting
      // conversion, which would have shown 1.3558179² = 1.838x the truth.
      expect(si.Mpr.unit).toBe("kN-m");
      // The residual 0.03 % is β1: Table 22.2.2.4.3 is edition-specific
      // (0.85 - 0.05(34.474 - 28)/7 = 0.80376 in MPa vs 0.80 in psi), so the
      // conversion is exact only to that tolerance. A double conversion would
      // be 36 % out, three orders of magnitude beyond it.
      expect(si.Mpr.value / (inLb.Mpr.value * KIP_FT_TO_KN_M)).toBeCloseTo(1, 3);
      expect(si.Mpr.value / inLb.Mpr.value).toBeCloseTo(KIP_FT_TO_KN_M, 3);
      // and explicitly *not* the doubly-converted value
      expect(si.Mpr.value).not.toBeCloseTo(inLb.Mpr.value * KIP_FT_TO_KN_M ** 2, 0);
    });

    it("reports M_pr/M_u identically in both systems", () => {
      // Both numerator and denominator convert by the same factor, so the two
      // editions agree to within β1 alone — the sharpest double-conversion
      // detector available (a double conversion would show 1.36x).
      const siRatio = amplifiedShear(example2si, seismic);
      const check = checkSpecialShear(example2si, seismic);
      const inLbCheck = checkSpecialShear(example2, seismicInLb);
      const siRatioValue = node(check, "sw.ve.Mpr_over_Mu").value;
      const inLbRatioValue = node(inLbCheck, "sw.ve.Mpr_over_Mu").value;
      expect(siRatioValue / inLbRatioValue).toBeCloseTo(1, 3);
      expect(siRatioValue).toBeCloseTo(1.343, 3);
      expect(node(check, "sw.ve.Mpr_over_Mu").unit).toBe("1");
      expect(siRatio.OmegaV.value).toBe(inLb.OmegaV.value); // both on the 1.5 floor
    });

    it("reports M_n in kN·m as exactly the in-lb kip-ft value x 1.3558179", () => {
      const check = checkSpecialShear(example2si, seismic);
      const inLbCheck = checkSpecialShear(example2, seismicInLb);
      const MnSi = node(check, "sw.shear.Mn");
      const MnInLb = node(inLbCheck, "sw.shear.Mn");
      expect(MnSi.unit).toBe("kN-m");
      expect(MnSi.value / (MnInLb.value * KIP_FT_TO_KN_M)).toBeCloseTo(1, 3);
    });
  });

  describe("18.10.3.1.3 — n_s ≥ 0.007 h_wcs stays on the inch basis", () => {
    it("computes the same floor in both systems and says why", () => {
      // ACI 318M-19 prints 0.007 unqualified, so the engine applies it to
      // h_wcs = 1104 in. (not 28,041.6 mm): 0.007 x 1104 = 7.728 stories.
      // Read literally against mm it would demand 196 stories.
      const check = checkSpecialShear(example2si, seismic);
      const inLbCheck = checkSpecialShear(example2, seismicInLb);
      const floor = node(check, "sw.ve.ns_floor");
      expect(floor.value).toBeCloseTo(7.728, 6);
      expect(floor.value).toBeCloseTo(node(inLbCheck, "sw.ve.ns_floor").value, 12);
      expect(floor.unit).toBe("1");
      expect(floor.note).toContain("inches");
      expect(node(check, "sw.ve.ns_floor_coeff").value).toBe(0.007);
      expect(node(check, "sw.ve.ns_floor_coeff").note).toContain("inch basis");
      // the substitution shows the mm → in. step explicitly
      expect(floor.substitution).toContain("25.4");
    });

    it("lets the floor govern ω_v identically in both systems", () => {
      // supplied n_s = 2 < 7.728 → the floor governs; ω_v = 1.3 + 7.728/30
      const { wall, demand } = variant(example2si, { ns: 2 });
      expect(amplifiedShear(wall, demand).omegaV.value).toBeCloseTo(1.3 + 7.728 / 30, 6);
    });
  });
});

describe("18.10.4.1 — α_c 0.25 / 0.17", () => {
  it("uses 0.17 for the slender Example 2 wall", () => {
    const check = checkSpecialShear(example2si, seismic);
    expect(node(check, "shear.alpha_c").value).toBe(0.17);
  });

  it("uses 0.25 for a squat wall", () => {
    const { wall, demand } = variant(example2si, { hwcs: 400, hw: 400 }); // 1.19
    const check = checkSpecialShear(wall, demand);
    expect(node(check, "shear.alpha_c").value).toBe(0.25);
  });

  it("computes V_nc, V_ns and V_n in kN from the metric expression", () => {
    // V_nc = 0.17 x 1.0 x 5.871438 x 2,601,285.12 / 1000 = 2596.458 kN
    // V_ns = 0.0061111 x 413.6854 x 2,601,285.12 / 1000  = 6576.251 kN
    // V_n  = 2596.458 + 6576.251 = 9172.709 kN  (below the 0.66 cap)
    const check = checkSpecialShear(example2si, seismic);
    expect(node(check, "sw.shear.Vnc").value).toBeCloseTo(2596.458, 3);
    expect(node(check, "sw.shear.Vnc").unit).toBe("kN");
    expect(node(check, "sw.shear.Vns").value).toBeCloseTo(6576.251, 3);
    expect(node(check, "sw.shear.Vn_calc").value).toBeCloseTo(9172.709, 3);
    expect(node(check, "sw.shear.Vn").value).toBeCloseTo(9172.709, 3);
    expect(node(check, "sw.shear.fyt").value).toBeCloseTo(413.6854, 4);
    expect(node(check, "sw.shear.fyt").unit).toBe("MPa");
    expectValidTrace(check);
  });
});

describe("18.10.4.4 / 18.10.4.5 — the 0.66 and 0.83 caps", () => {
  const check = checkSpecialShear(example2si, seismic);

  it("computes 0.66√f'c·A_cv in kN", () => {
    // 0.66 x 5.871438 x 2,601,285.12 / 1000 = 10,080.368 kN
    const cap = node(check, "sw.shear.cap_8");
    expect(cap.value).toBeCloseTo(10080.368, 3);
    expect(cap.unit).toBe("kN");
    expect(cap.formula).toContain("0.66");
    expect(cap.formula).not.toContain("8\\sqrt");
  });

  it("computes 0.83√f'c·A_cw in kN", () => {
    // 0.83 x 5.871438 x 2,601,285.12 / 1000 = 12,676.826 kN
    const cap = node(check, "sw.shear.cap_10");
    expect(cap.value).toBeCloseTo(12676.826, 3);
    expect(cap.formula).toContain("0.83");
  });

  it("applies the 0.66 limit when the reinforcement would exceed it", () => {
    const heavy: WallInput = {
      ...example2si,
      horizontal: { bar: "11", spacing: 4, curtains: 2 },
    };
    const c = checkSpecialShear(heavy, heavy.demands[0]!);
    expect(node(c, "sw.shear.Vn_calc").value).toBeGreaterThan(node(c, "sw.shear.cap_8").value);
    expect(node(c, "sw.shear.Vn").value).toBeCloseTo(10080.368, 3);
    expect(node(c, "sw.shear.Vn").note).toContain("0.66√f'c limit always governs");
  });
});

describe("21.2.4.1 — the φ decision with V@M_n = 2M_n/h_sx", () => {
  it("divides M_n in kN·m (x1000 → kN·mm) by h_sx in mm", () => {
    // h_sx = 216 in. = 5486.4 mm; V@M_n = 2 M_n[kN·m] x 1000 / 5486.4 → kN,
    // which is exactly the in-lb 2M_n[kip-ft] x 12 / 216 in kip, times 4.44822.
    const check = checkSpecialShear(example2si, seismic);
    const inLbCheck = checkSpecialShear(example2, seismicInLb);
    const v = node(check, "sw.shear.V_at_Mn");
    const Mn = node(check, "sw.shear.Mn");
    expect(node(check, "sw.shear.hsx").value).toBeCloseTo(5486.4, 9);
    expect(node(check, "sw.shear.hsx").unit).toBe("mm");
    expect(v.unit).toBe("kN");
    expect(v.value).toBeCloseTo((2 * Mn.value * 1000) / 5486.4, 6);
    // the two editions agree to within β1 (see the M_pr regression above)
    expect(v.value / node(inLbCheck, "sw.shear.V_at_Mn").value / KIP_TO_KN).toBeCloseTo(1, 3);
    expect(v.note).toContain("kN·m is converted to kN·mm");
  });

  it("reaches the same φ as the in-lb edition — the decision is a ratio", () => {
    const check = checkSpecialShear(example2si, seismic);
    const inLbCheck = checkSpecialShear(example2, seismicInLb);
    expect(node(check, "sw.shear.phi").value).toBe(0.6);
    expect(node(check, "sw.shear.phi").value).toBe(node(inLbCheck, "sw.shear.phi").value);
    // V@M_n vs the 0.83√f'c·A_cw ceiling — a ratio, identical in both editions
    expect(node(check, "sw.shear.V_at_Mn_vs_cap").symbol).toContain("0.83");
  });

  it("keeps φ = 0.75 when the wall can develop M_n", () => {
    const { wall, demand } = variant(example2si, { hsx: 6000 });
    const check = checkSpecialShear(wall, demand);
    expect(node(check, "sw.shear.V_at_Mn").value).toBeLessThan(node(check, "sw.shear.Vn").value);
    expect(node(check, "sw.shear.phi").value).toBe(0.75);
  });
});

describe("unit tags", () => {
  it("tags every node in the trace with a metric unit", () => {
    const check = checkSpecialShear(example2si, seismic);
    const roots = [check.demand, check.capacity, check.utilization, ...check.trace].filter(
      (n): n is Traced<any> => n !== undefined,
    );
    for (const r of roots) {
      for (const n of flattenTrace(r)) {
        expect(["mm", "mm2", "MPa", "kN", "kN-m", "1"], n.id).toContain(n.unit);
      }
    }
  });

  it("never prints an in-lb coefficient in a metric substitution", () => {
    const md = JSON.stringify(checkSpecialShear(example2si, seismic));
    expect(md).not.toContain("text{psi}");
    expect(md).not.toContain("text{kip}");
  });
});

describe("the in-lb default is untouched", () => {
  it("keeps psi/kip units and the 8/10 caps when `units` is absent", () => {
    const check = checkSpecialShear(example2, seismicInLb);
    expect(node(check, "shear.alpha_c").value).toBe(2);
    expect(node(check, "sw.shear.cap_8").formula).toContain("8");
    expect(node(check, "sw.shear.Vn").unit).toBe("kip");
    expect(node(check, "sw.shear.fyt").value).toBe(60000);
    expect(node(check, "sw.shear.fyt").unit).toBe("psi");
    expect(node(check, "sw.shear.Mn").unit).toBe("kip-ft");
    expectValidTrace(check);
  });
});
