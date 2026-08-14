import { describe, expect, it } from "vitest";
import { checkSeismicWebReinforcement } from "../src/index";
import type { WallInput } from "../src/index";
import { example2, expectValidTrace, node } from "./fixtures";

describe("18.10.2.1 — minimum distributed reinforcement", () => {
  it("relaxes to the Table 11.6.1 values below λ√f'c·A_cv", () => {
    // λ√f'c·A_cv = 285 kip; No. 5 bars, Grade 60 → ρ_ℓ 0.0012 / ρ_t 0.0020
    const low: WallInput = {
      ...example2,
      vertical: { bar: "5", spacing: 18, curtains: 2 },
      horizontal: { bar: "5", spacing: 18, curtains: 2 },
      demands: [{ id: "low", Pu: 1015, Mu: 10000, Vu: 100 }],
    };
    const check = checkSeismicWebReinforcement(low, low.demands[0]!);
    expect(node(check, "sw.reinf.low_shear").value).toBe(true);
    expect(node(check, "sw.reinf.rho_l_req").value).toBe(0.0012);
    expect(node(check, "sw.reinf.rho_t_req").value).toBe(0.002);
    expectValidTrace(check);
  });

  it("goes NG when a ratio falls below 0.0025", () => {
    const lean: WallInput = {
      ...example2,
      horizontal: { bar: "4", spacing: 18, curtains: 1 },
    };
    const check = checkSeismicWebReinforcement(lean, lean.demands[0]!);
    expect(node(check, "sw.reinf.rho_t").value).toBeCloseTo(0.000926, 6);
    expect(node(check, "sw.reinf.util_rho_t").status).toBe("ng");
    expect(check.status).toBe("ng");
  });

  it("goes NG when spacing exceeds 18 in.", () => {
    const wide: WallInput = {
      ...example2,
      horizontal: { bar: "8", spacing: 24, curtains: 2 },
    };
    const check = checkSeismicWebReinforcement(wide, wide.demands[0]!);
    expect(node(check, "sw.reinf.util_s").status).toBe("ng");
  });
});

describe("18.10.2.2 — two curtains", () => {
  it("fires on the shear trigger alone for a squat wall", () => {
    // h_w/ℓ_w = 1.49 < 2, so only V_u > 2λ√f'c·A_cv = 570 kip can require them
    const wall: WallInput = {
      ...example2,
      geometry: { ...example2.geometry, hw: 500, hwcs: 500 },
      demands: [{ id: "high-shear", Pu: 1015, Mu: 20000, Vu: 700 }],
    };
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.curtains_req").value).toBe(2);
    expect(node(check, "sw.reinf.curtains_req").note).toContain("shear trigger governs");
  });

  it("permits a single curtain when neither trigger fires", () => {
    const wall: WallInput = {
      ...example2,
      geometry: { ...example2.geometry, hw: 500, hwcs: 500 },
      vertical: { bar: "8", spacing: 12, curtains: 1 },
      horizontal: { bar: "6", spacing: 12, curtains: 1 },
      demands: [{ id: "mild", Pu: 1015, Mu: 20000, Vu: 400 }],
    };
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.curtains_req").value).toBe(1);
    expect(node(check, "sw.reinf.util_curtains").status).toBe("ok");
  });
});

describe("18.10.4.3 — ρ_ℓ ≥ ρ_t for h_w/ℓ_w ≤ 2", () => {
  const squatGeometry = { ...example2.geometry, hw: 500, hwcs: 500 };

  it("passes when the vertical ratio dominates", () => {
    const wall: WallInput = { ...example2, geometry: squatGeometry };
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.rho_l_ge_rho_t").status).toBe("ok");
  });

  it("goes NG when the horizontal ratio dominates", () => {
    const wall: WallInput = {
      ...example2,
      geometry: squatGeometry,
      vertical: { bar: "5", spacing: 12, curtains: 2 },
      horizontal: { bar: "8", spacing: 12, curtains: 2 },
    };
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.rho_l_ge_rho_t").status).toBe("ng");
    expect(check.status).toBe("ng");
  });
});

describe("18.10.2.4 — end-zone longitudinal reinforcement", () => {
  it("is N/A for walls with h_w/ℓ_w < 2", () => {
    const wall: WallInput = {
      ...example2,
      geometry: { ...example2.geometry, hw: 500, hwcs: 500 },
    };
    const check = checkSeismicWebReinforcement(wall, wall.demands[0]!);
    expect(node(check, "sw.reinf.end_zone_util").status).toBe("na");
  });

  it("goes NG when the end zone is too lightly reinforced", () => {
    const lean: WallInput = {
      ...example2,
      vertical: { bar: "4", spacing: 18, curtains: 2 },
      endZone: { bar: "4", count: 2, distanceToFirst: 3, spacing: 9 },
    };
    const check = checkSeismicWebReinforcement(lean, lean.demands[0]!);
    expect(node(check, "sw.reinf.end_zone_rho").value).toBeLessThan(0.007071);
    expect(node(check, "sw.reinf.end_zone_util").status).toBe("ng");
    expectValidTrace(check);
  });
});
