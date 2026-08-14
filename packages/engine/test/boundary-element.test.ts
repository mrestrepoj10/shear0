import { describe, expect, it } from "vitest";
import {
  amplifiedShear,
  checkSbeDetailing,
  checkSbeRequired,
  sbeRequirement,
  sigmaExtreme,
} from "../src/index";
import type { WallInput } from "../src/index";
import { example2, expectValidTrace, node } from "./fixtures";

const seismic = example2.demands[0]!;

/** Same wall, but squat enough that 18.10.6.1 sends it down the stress path. */
function squat(patch: Partial<WallInput> = {}): WallInput {
  return {
    ...example2,
    geometry: { ...example2.geometry, hw: 600, hwcs: 600 }, // 600/336 = 1.79 < 2
    ...patch,
  };
}

describe("18.10.6.1 — method selection", () => {
  it("uses the displacement-based method for h_wcs/ℓ_w ≥ 2", () => {
    expect(sbeRequirement(example2, seismic).method).toBe("displacement");
  });

  it("uses the stress-based method below 2", () => {
    const wall = squat();
    const req = sbeRequirement(wall, wall.demands[0]!);
    expect(req.method).toBe("stress");
    expectValidTrace(checkSbeRequired(wall, wall.demands[0]!));
  });
});

describe("18.10.6.3 — stress-based trigger", () => {
  it("requires a boundary element above 0.2f'c", () => {
    const wall = squat();
    const demand = wall.demands[0]!;
    // σ = 1,015,000/4032 + 446,400,000(168)/37,933,056 = 252 + 1977 = 2229 psi
    expect(sigmaExtreme(wall, demand).value).toBeCloseTo(2229, 0);
    const check = checkSbeRequired(wall, demand);
    expect(node(check, "sbe.req.sigma_limit").value).toBe(1000);
    expect(node(check, "sbe.req.sigma_discontinue").value).toBe(750);
    expect(sbeRequirement(wall, demand).required).toBe(true);
  });

  it("does not require one at or below 0.2f'c", () => {
    const light: WallInput = squat({
      demands: [{ id: "light", Pu: 300, Mu: 5000, Vu: 100 }],
    });
    const demand = light.demands[0]!;
    // 300,000/4032 + 60,000,000(168)/37,933,056 = 74 + 266 = 340 psi < 1000
    expect(sigmaExtreme(light, demand).value).toBeCloseTo(340, 0);
    expect(sbeRequirement(light, demand).required).toBe(false);
  });

  it("has no 18.10.6.2(b) width option on the stress path", () => {
    const wall = squat();
    const demand = wall.demands[0]!;
    const check = checkSbeDetailing(wall, demand, amplifiedShear(wall, demand).Ve);
    expect(node(check, "sbe.util_width").status).toBe("na");
    expectValidTrace(check);
  });
});

describe("18.10.6.2(a) — displacement-based trigger", () => {
  it("applies the 0.005 drift floor", () => {
    const stiff: WallInput = {
      ...example2,
      seismic: { ...example2.seismic!, deltaE: 0.5 }, // δ_u/h_wcs = 2.5/1104 = 0.0023
    };
    const req = sbeRequirement(stiff, stiff.demands[0]!);
    const check = checkSbeRequired(stiff, stiff.demands[0]!);
    expect(node(check, "sbe.req.drift_raw").value).toBeCloseTo(0.002264, 6);
    expect(node(check, "sbe.req.drift").value).toBe(0.005);
    expect(node(check, "sbe.req.drift").note).toContain("0.005 floor governs");
    // 1.5(0.005) = 0.0075 < ℓ_w/(600c) = 0.00815 → not required
    expect(req.required).toBe(false);
  });

  it("evaluates at the floor with a warning when C_d/δ_e are missing", () => {
    const noDisp: WallInput = { ...example2, seismic: { sdc: "D", ns: 8, hsx: 216 } };
    const check = checkSbeRequired(noDisp, noDisp.demands[0]!);
    expect(node(check, "sbe.req.drift_raw").status).toBe("warning");
    expect(node(check, "sbe.req.drift").value).toBe(0.005);
    expect(check.status).toBe("warning");
    expectValidTrace(check);
  });
});

describe("18.10.6.4 — detailing edge cases", () => {
  it("is NG when a boundary element is required but none is provided", () => {
    const bare: WallInput = { ...example2 };
    delete (bare as { sbe?: unknown }).sbe;
    const check = checkSbeDetailing(bare, seismic, amplifiedShear(bare, seismic).Ve);
    expect(check.status).toBe("ng");
    expect(node(check, "sbe.provided").note).toBe("SBE required but none provided");
    expectValidTrace(check);
  });

  it("fails both width options for a 12 in. boundary element and floors δ_c/h_wcs at 0.015", () => {
    const thin: WallInput = { ...example2, sbe: { ...example2.sbe!, width: 12 } };
    const check = checkSbeDetailing(thin, seismic, amplifiedShear(thin, seismic).Ve);
    // raw value ≈ 0.0034 (handbook 0.0035 at their c) → floored to 0.015
    expect(node(check, "sbe.drift_capacity_raw").value).toBeCloseTo(0.0034, 3);
    expect(node(check, "sbe.drift_capacity").value).toBe(0.015);
    expect(node(check, "sbe.drift_capacity").note).toContain("0.015 floor governs");
    // 0.015 < 1.5δ_u/h_wcs = 0.0163, and 12 in. < √(0.025cℓ_w) = 24 in.
    expect(node(check, "sbe.util_width").status).toBe("ng");
  });

  it("applies the 12 in. width floor once c/ℓ_w ≥ 3/8", () => {
    // A short, heavily loaded wall pushes c/ℓ_w up: ℓ_w = 120 in., P_u = 2000 kip
    const short: WallInput = {
      ...example2,
      geometry: { ...example2.geometry, lw: 120, hw: 1104, hwcs: 1104 },
      endZone: { bar: "8", count: 4, distanceToFirst: 3, spacing: 9 },
      demands: [{ id: "seismic", Pu: 2000, Mu: 8000, Vu: 200 }],
      sbe: { ...example2.sbe!, width: 10, length: 40 },
    };
    const demand = short.demands[0]!;
    const check = checkSbeDetailing(short, demand, amplifiedShear(short, demand).Ve);
    expect(node(check, "sbe.c_over_lw").value).toBeGreaterThan(3 / 8);
    expect(node(check, "sbe.b_12_util").status).toBe("ng"); // b = 10 in. < 12 in.
    expectValidTrace(check);
  });

  it("clamps s_o to the 4–6 in. range", () => {
    const wide: WallInput = {
      ...example2,
      sbe: { ...example2.sbe!, hx: 2, width: 30, length: 40 },
    };
    const check = checkSbeDetailing(wide, seismic, amplifiedShear(wide, seismic).Ve);
    // 4 + (14 − 2)/3 = 8 → clamped to 6
    expect(node(check, "sbe.so").value).toBe(6);
    expect(node(check, "sbe.so").note).toContain("6 in. upper bound");
  });

  it("goes NG when too few tie legs are provided", () => {
    const light: WallInput = {
      ...example2,
      sbe: { ...example2.sbe!, tieLegsAcrossWidth: 2 },
    };
    const check = checkSbeDetailing(light, seismic, amplifiedShear(light, seismic).Ve);
    expect(node(check, "sbe.util_ash").status).toBe("ng"); // 2.27 legs required
  });
});

describe("18.10.6.5(b) — where no special boundary element is required", () => {
  const stiff: WallInput = {
    ...example2,
    seismic: { ...example2.seismic!, deltaE: 0.5 },
  };

  it("triggers boundary ties on ρ > 400/f_y and checks the provided spacing", () => {
    const demand = stiff.demands[0]!;
    expect(sbeRequirement(stiff, demand).required).toBe(false);
    const check = checkSbeDetailing(stiff, demand, amplifiedShear(stiff, demand).Ve);
    expect(node(check, "sbe.alt.rho_limit").value).toBeCloseTo(400 / 60000, 6);
    expect(node(check, "sbe.alt.trigger").value).toBe(true);
    // Grade 60, within max(ℓ_w, M_u/4V_u): s ≤ min(6d_b, 6 in.) = 6 in.
    expect(node(check, "sbe.alt.s_req").value).toBe(6);
    expect(check.status).toBe("ok"); // provided 4 in.
    expectValidTrace(check);
  });

  it("warns when ties are triggered but no boundary element is modelled", () => {
    const bare: WallInput = { ...stiff };
    delete (bare as { sbe?: unknown }).sbe;
    const demand = bare.demands[0]!;
    const check = checkSbeDetailing(bare, demand, amplifiedShear(bare, demand).Ve);
    expect(check.status).toBe("warning");
    expectValidTrace(check);
  });

  it("is N/A when the boundary reinforcement ratio stays below the trigger", () => {
    const lean: WallInput = {
      ...stiff,
      vertical: { bar: "4", spacing: 18, curtains: 2 },
      endZone: { bar: "4", count: 2, distanceToFirst: 3, spacing: 9 },
    };
    const demand = lean.demands[0]!;
    const check = checkSbeDetailing(lean, demand, amplifiedShear(lean, demand).Ve);
    expect(node(check, "sbe.alt.trigger").value).toBe(false);
    expect(check.status).toBe("na");
    expectValidTrace(check);
  });
});
