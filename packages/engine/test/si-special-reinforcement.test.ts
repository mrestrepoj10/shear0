/**
 * §18.10.2 web reinforcement for special structural walls in SI mode —
 * ACI 318M-19 coefficients.
 *
 * Every expected number below is hand-computed from the **metric** expression.
 * The metric coefficients are independently rounded (0.083 is 0.43 % above
 * 1/12.1, 0.17 is 2.4 % above 2/12.1, 0.50 is 0.36 % above 6/12.1, and 450 mm
 * is not 18 in. = 457.2 mm), so deriving an expectation by converting the in-lb
 * answer would assert the wrong thing — and would hide exactly the divergences
 * these tests exist to pin.
 *
 * Wall: MNL-17(21) Shear Wall Example 2 — 336 x 12 in. = 8534.4 x 304.8 mm,
 * f'c = 5000 psi = 34.4738 MPa, Grade 60 = 413.685 MPa.
 *   A_cv = 8534.4 x 304.8   = 2,601,285.12 mm²
 *   √f'c = √34.4738         = 5.871438 MPa^0.5
 *   f_y  = 60 ksi           = 413.6854 MPa
 *   h_w/ℓ_w = 1104/336      = 3.286  (dimensionless — unchanged)
 */
import { describe, expect, it } from "vitest";
import { checkSeismicWebReinforcement, sqrtFcNode } from "../src/index";
import type { WallInput } from "../src/index";
import { GRADE420, concrete } from "../src/materials";
import { flattenTrace } from "../src/trace";
import type { Traced } from "../src/trace";
import { unitScheme } from "../src/units";
import { example2, expectValidTrace, node } from "./fixtures";

const example2si: WallInput = { ...example2, units: "si" };
const seismic = example2si.demands[0]!;

describe("sqrtFcNode", () => {
  it("returns √f'c in psi^0.5 by default", () => {
    // √5000 = 70.7107 psi^0.5
    const n = sqrtFcNode(example2, "t");
    expect(n.value).toBeCloseTo(70.71068, 5);
    expect(n.unit).toBe("psi");
  });

  it("returns √f'c in MPa^0.5 when handed the SI scheme", () => {
    // f'c = 5 ksi = 34.4738 MPa; √34.4738 = 5.871438 MPa^0.5
    const n = sqrtFcNode(example2si, "t", unitScheme("si"));
    expect(n.value).toBeCloseTo(5.871438, 6);
    expect(n.unit).toBe("MPa");
    expect(n.substitution).toContain("\\sqrt{34.5}");
    expect(n.substitution).toContain("\\text{MPa}");
  });
});

describe("18.10.2.1 — the low-shear yardstick 0.083λ√f'c·A_cv", () => {
  it("computes the threshold in kN from the metric coefficient", () => {
    // 0.083 x 1.0 x 5.871438 x 2,601,285.12 / 1000 = 1267.68 kN
    // (the in-lb form is 1 x 70.7107 x 4032 / 1000 = 285.11 kip = 1268.23 kN —
    //  0.04 % apart, because 0.083 x 12.1 = 1.0043)
    const low: WallInput = {
      ...example2si,
      demands: [{ id: "low", Pu: 1015, Mu: 10000, Vu: 100 }],
    };
    const check = checkSeismicWebReinforcement(low, low.demands[0]!);
    const limit = node(check, "sw.reinf.limit_1");
    expect(limit.value).toBeCloseTo(1267.683, 3);
    expect(limit.unit).toBe("kN");
    expect(node(check, "sw.reinf.limit_1_coeff").value).toBe(0.083);
    expect(limit.formula).toContain("0.083");
    // V_u = 100 kip = 444.82 kN ≤ 1267.68 kN → the relaxation applies
    expect(node(check, "sw.reinf.low_shear").value).toBe(true);
    expectValidTrace(check);
  });

  it("does not relax at the Example 2 shear", () => {
    // V_u = 470 kip = 2090.66 kN > 1267.68 kN
    const check = checkSeismicWebReinforcement(example2si, seismic);
    expect(node(check, "sw.reinf.Vu").value).toBeCloseTo(2090.664, 3);
    expect(node(check, "sw.reinf.low_shear").value).toBe(false);
    expect(node(check, "sw.reinf.rho_l_req").value).toBe(0.0025);
    expect(node(check, "sw.reinf.rho_t_req").value).toBe(0.0025);
  });
});

describe("18.10.2.2 — the two-curtain yardstick 0.17λ√f'c·A_cv", () => {
  const squat = { ...example2si.geometry, hw: 500, hwcs: 500 }; // 500/336 = 1.49

  it("computes the threshold in kN from the metric coefficient", () => {
    // 0.17 x 1.0 x 5.871438 x 2,601,285.12 / 1000 = 2596.46 kN
    const check = checkSeismicWebReinforcement(example2si, seismic);
    const limit = node(check, "sw.reinf.limit_2");
    expect(limit.value).toBeCloseTo(2596.458, 3);
    expect(limit.unit).toBe("kN");
    expect(node(check, "sw.reinf.limit_2_coeff").value).toBe(0.17);
    expect(limit.formula).toContain("0.17");
    // the aspect trigger governs here, not the shear one
    expect(node(check, "sw.reinf.curtains_req").note).toContain("h_w/ℓ_w ≥ 2.0");
  });

  it("fires on the shear trigger alone for a squat wall", () => {
    // V_u = 700 kip = 3113.75 kN > 2596.46 kN
    const wall: WallInput = {
      ...example2si,
      geometry: squat,
      demands: [{ id: "high-shear", Pu: 1015, Mu: 20000, Vu: 700 }],
    };
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.curtains_req").value).toBe(2);
    expect(node(check, "sw.reinf.curtains_req").note).toContain("shear trigger governs");
  });

  it("does not fire where the in-lb edition would — 0.17 is 2.4 % above 2/12.1", () => {
    // V_u = 575 kip = 2557.73 kN.
    //   SI    : 2557.73 ≤ 0.17λ√f'c·A_cv = 2596.46 kN → single curtain permitted
    //   in-lb : 575 > 2λ√f'c·A_cv = 2 x 70.7107 x 4032/1000 = 570.21 kip → 2 req'd
    // This is a genuine, honest divergence between the two editions.
    const wall: WallInput = {
      ...example2si,
      geometry: squat,
      vertical: { bar: "8", spacing: 12, curtains: 1 },
      horizontal: { bar: "6", spacing: 12, curtains: 1 },
      demands: [{ id: "borderline", Pu: 1015, Mu: 20000, Vu: 575 }],
    };
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.Vu").value).toBeCloseTo(2557.727, 3);
    expect(node(check, "sw.reinf.curtains_req").value).toBe(1);

    const { units: _si, ...inLb } = wall;
    const inLbCheck = checkSeismicWebReinforcement(inLb as WallInput, wall.demands[0]!);
    expect(node(inLbCheck, "sw.reinf.limit_2").value).toBeCloseTo(570.211, 3);
    expect(node(inLbCheck, "sw.reinf.curtains_req").value).toBe(2);
  });
});

describe("18.10.2.4 — the end-zone minimum 0.50√f'c/f_y", () => {
  it("computes ρ_end,min from the metric coefficient", () => {
    // 0.50 x 5.871438 / 413.6854 = 0.0070965
    // (in-lb: 6 x 70.7107 / 60,000 = 0.0070711 — 0.36 % lower, since
    //  0.50 x 12.1/√12.1... the two roundings simply do not agree)
    const check = checkSeismicWebReinforcement(example2si, seismic);
    const req = node(check, "sw.reinf.end_zone_rho_req");
    expect(req.value).toBeCloseTo(0.0070965, 7);
    expect(node(check, "sw.reinf.end_zone_coeff").value).toBe(0.5);
    expect(req.formula).toContain("0.50");
    expect(node(check, "sw.reinf.fy").value).toBeCloseTo(413.6854, 4);
    expect(node(check, "sw.reinf.fy").unit).toBe("MPa");

    const { units: _si, ...inLb } = example2si;
    const inLbCheck = checkSeismicWebReinforcement(inLb as WallInput, seismic);
    expect(node(inLbCheck, "sw.reinf.end_zone_rho_req").value).toBeCloseTo(0.0070711, 7);
  });

  it("traces the end zone geometry in mm and mm²", () => {
    // 0.15 x 8534.4 = 1280.16 mm; A_end = 1280.16 x 304.8 = 390,192.8 mm²
    const check = checkSeismicWebReinforcement(example2si, seismic);
    expect(node(check, "sw.reinf.end_zone_length").value).toBeCloseTo(1280.16, 6);
    expect(node(check, "sw.reinf.end_zone_length").unit).toBe("mm");
    expect(node(check, "sw.reinf.end_zone_area").value).toBeCloseTo(390192.768, 3);
    expect(node(check, "sw.reinf.end_zone_area").unit).toBe("mm2");
    // ρ_end is a ratio, so it is identical in both editions
    const { units: _si, ...inLb } = example2si;
    const inLbCheck = checkSeismicWebReinforcement(inLb as WallInput, seismic);
    expect(node(check, "sw.reinf.end_zone_rho").value).toBeCloseTo(
      node(inLbCheck, "sw.reinf.end_zone_rho").value,
      12,
    );
  });

  it("is N/A for walls with h_w/ℓ_w < 2", () => {
    const wall: WallInput = {
      ...example2si,
      geometry: { ...example2si.geometry, hw: 500, hwcs: 500 },
    };
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.end_zone_util").status).toBe("na");
  });
});

describe("18.10.2.1 — the 450 mm spacing cap", () => {
  it("caps at 450 mm, not at 18 in. converted", () => {
    // provided s = 12 in. = 304.8 mm → 304.8/450 = 0.677
    const check = checkSeismicWebReinforcement(example2si, seismic);
    const cap = node(check, "sw.reinf.s_max");
    expect(cap.value).toBe(450);
    expect(cap.unit).toBe("mm");
    expect(node(check, "sw.reinf.s_prov").value).toBeCloseTo(304.8, 9);
    expect(node(check, "sw.reinf.util_s").value).toBeCloseTo(0.677333, 6);
    expect(node(check, "sw.reinf.util_s").status).toBe("ok");
  });

  it("rejects an 18 in. spacing that the in-lb edition accepts exactly", () => {
    // 18 in. = 457.2 mm > 450 mm. ACI 318M's 450 is a hard round number, not a
    // conversion, so the metric edition is the stricter of the two here.
    const wall: WallInput = {
      ...example2si,
      horizontal: { bar: "6", spacing: 18, curtains: 2 },
    };
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.s_prov").value).toBeCloseTo(457.2, 9);
    expect(node(check, "sw.reinf.util_s").status).toBe("ng");

    const { units: _si, ...inLb } = wall;
    const inLbCheck = checkSeismicWebReinforcement(inLb as WallInput, wall.demands[0]!);
    expect(node(inLbCheck, "sw.reinf.s_max").value).toBe(18);
    expect(node(inLbCheck, "sw.reinf.util_s").status).toBe("ok");
  });
});

describe("Table 11.6.1 — the f_y row split at 420 MPa", () => {
  const low = (w: WallInput): WallInput => ({
    ...w,
    vertical: { bar: "5", spacing: 12, curtains: 2 },
    horizontal: { bar: "5", spacing: 12, curtains: 2 },
    demands: [{ id: "low", Pu: 1015, Mu: 10000, Vu: 100 }],
  });

  it("puts Grade 420 on the 0.0012/0.0020 row for No. 5 and smaller bars", () => {
    // f_y = 420 MPa is not *below* the 420 MPa split, so the small-bar row holds
    const wall = low({ ...example2si, grade: GRADE420, concrete: concrete(5000) });
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.low_shear").value).toBe(true);
    expect(node(check, "sw.reinf.rho_l_req").value).toBe(0.0012);
    expect(node(check, "sw.reinf.rho_t_req").value).toBe(0.002);
  });

  it("puts Grade 60 (413.7 MPa) on the below-420 row in SI, unlike in-lb", () => {
    // Grade 60 is 413.685 MPa < 420 MPa, so the metric table's lower-f_y row
    // (0.0015/0.0025) applies; read in psi, 60,000 is exactly the split and the
    // in-lb edition stays on the 0.0012/0.0020 row.
    const wall = low(example2si);
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.rho_l_req").value).toBe(0.0015);
    expect(node(check, "sw.reinf.rho_t_req").value).toBe(0.0025);

    const { units: _si, ...inLb } = wall;
    const inLbCheck = checkSeismicWebReinforcement(inLb as WallInput, wall.demands[0]!);
    expect(node(inLbCheck, "sw.reinf.rho_l_req").value).toBe(0.0012);
    expect(node(inLbCheck, "sw.reinf.rho_t_req").value).toBe(0.002);
  });

  it("names Grade 420 bars in the relaxation note", () => {
    const wall = low(example2si);
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.low_shear").note).toContain("420");
    expect(node(check, "sw.reinf.low_shear").note).toContain("No. 16");
  });
});

describe("unit tags", () => {
  it("tags every node in the trace with a metric unit", () => {
    const check = checkSeismicWebReinforcement(example2si, seismic);
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
    const check = checkSeismicWebReinforcement(example2si, seismic);
    const md = JSON.stringify(check);
    expect(md).not.toContain("text{psi}");
    expect(md).not.toContain("text{kip}");
  });
});

describe("the in-lb default is untouched", () => {
  it("keeps psi/kip units and the in-lb coefficients when `units` is absent", () => {
    const check = checkSeismicWebReinforcement(example2, seismic);
    expect(node(check, "sw.reinf.limit_1_coeff").value).toBe(1);
    expect(node(check, "sw.reinf.limit_2_coeff").value).toBe(2);
    expect(node(check, "sw.reinf.end_zone_coeff").value).toBe(6);
    expect(node(check, "sw.reinf.s_max").value).toBe(18);
    expect(node(check, "sw.reinf.limit_2").value).toBeCloseTo(570.211, 3);
    expect(node(check, "sw.reinf.limit_2").unit).toBe("kip");
    expect(node(check, "sw.reinf.fy").value).toBe(60000);
    expect(node(check, "sw.reinf.fy").unit).toBe("psi");
    expectValidTrace(check);
  });
});
