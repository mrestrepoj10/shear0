import { describe, expect, it } from "vitest";
import { amplifiedShear, checkSpecialShear } from "../src/index";
import type { Demands, WallInput } from "../src/index";
import { example2, expectValidTrace, node } from "./fixtures";

/** Example 2 with overridden geometry/seismic/demand, for branch coverage. */
function variant(patch: {
  hwcs?: number;
  hw?: number;
  ns?: number;
  hsx?: number | undefined;
  Mu?: number;
  Vu?: number;
}): { wall: WallInput; demand: Demands } {
  const base = example2.demands[0]!;
  const demand: Demands = {
    ...base,
    ...(patch.Mu !== undefined ? { Mu: patch.Mu } : {}),
    ...(patch.Vu !== undefined ? { Vu: patch.Vu } : {}),
  };
  const seismic = { ...example2.seismic!, ...(patch.ns !== undefined ? { ns: patch.ns } : {}) };
  if ("hsx" in patch && patch.hsx === undefined) delete (seismic as { hsx?: number }).hsx;
  else if (patch.hsx !== undefined) seismic.hsx = patch.hsx;
  const wall: WallInput = {
    ...example2,
    geometry: {
      ...example2.geometry,
      ...(patch.hwcs !== undefined ? { hwcs: patch.hwcs } : {}),
      ...(patch.hw !== undefined ? { hw: patch.hw } : {}),
    },
    seismic,
    demands: [demand, example2.demands[1]!],
  };
  return { wall, demand };
}

describe("Ω_v — Table 18.10.3.1.2", () => {
  it("is 1.0 for h_wcs/ℓ_w ≤ 1.5", () => {
    const { wall, demand } = variant({ hwcs: 500, hw: 500 }); // 500/336 = 1.49
    const ve = amplifiedShear(wall, demand);
    expect(ve.OmegaV.value).toBe(1);
    expect(ve.Ve.value).toBeCloseTo(470, 0); // Ω_v ω_v = 1 × 1
  });

  it("uses M_pr/M_u once it exceeds the 1.5 floor", () => {
    const { wall, demand } = variant({ Mu: 30000 });
    const ve = amplifiedShear(wall, demand);
    expect(ve.OmegaV.value).toBeCloseTo(ve.Mpr.value / 30000, 6);
    expect(ve.OmegaV.value).toBeGreaterThan(1.5);
  });
});

describe("ω_v — Eq. (18.10.3.1.3)", () => {
  it("is 1.0 for h_wcs/ℓ_w < 2.0", () => {
    const { wall, demand } = variant({ hwcs: 600, hw: 600 }); // 1.79
    expect(amplifiedShear(wall, demand).omegaV.value).toBe(1);
  });

  it("takes the 0.9 + n_s/10 branch for n_s ≤ 6", () => {
    // h_wcs = 700 in. → floor 0.007(700) = 4.9 < 6, so the supplied n_s governs
    const { wall, demand } = variant({ hwcs: 700, hw: 700, ns: 6 });
    const ve = amplifiedShear(wall, demand);
    expect(ve.omegaV.value).toBeCloseTo(1.5, 6);
  });

  it("floors n_s at 0.007 h_wcs when the supplied story count is smaller", () => {
    const { wall, demand } = variant({ ns: 2 }); // floor = 0.007(1104) = 7.728
    const ve = amplifiedShear(wall, demand);
    expect(ve.omegaV.value).toBeCloseTo(1.3 + 7.728 / 30, 6);
  });

  it("caps ω_v at 1.8", () => {
    const { wall, demand } = variant({ ns: 40 });
    expect(amplifiedShear(wall, demand).omegaV.value).toBe(1.8);
  });
});

describe("V_e cap — 18.10.3.1", () => {
  it("limits V_e to 3V_u when Ω_v ω_v exceeds 3", () => {
    const { wall, demand } = variant({ Mu: 15000 });
    const ve = amplifiedShear(wall, demand);
    expect(ve.OmegaV.value * ve.omegaV.value).toBeGreaterThan(3);
    expect(ve.Ve.value).toBeCloseTo(3 * 470, 6);
    expect(ve.Ve.note).toContain("3V_u cap governs");
  });
});

describe("φ for seismic shear — 21.2.4.1 / 18.10.4.6", () => {
  it("warns and keeps φ = 0.75 when h_sx is missing", () => {
    const { wall, demand } = variant({ hsx: undefined });
    const check = checkSpecialShear(wall, demand);
    expect(node(check, "sw.shear.phi").value).toBe(0.75);
    expect(node(check, "sw.shear.phi").status).toBe("warning");
    expect(check.status).toBe("warning");
    expect(node(check, "sw.shear.phi").note).toContain("h_sx");
    expectValidTrace(check);
  });

  it("still applies 21.2.4.1 under the exempt setting when the wall is not on the 18.10.6.2 path", () => {
    // h_wcs/ℓ_w = 1.79 < 2 → stress-based path → 18.10.4.6 does not exempt it
    const { wall, demand } = variant({ hwcs: 600, hw: 600 });
    const check = checkSpecialShear(
      { ...wall, phiSeismicReading: "exempt-18.10.4.6" },
      demand,
    );
    expect(node(check, "sw.shear.phi").value).toBe(0.6);
  });

  it("keeps φ = 0.75 when the wall can develop M_n", () => {
    // A very tall first story makes V@M_n = 2M_n/h_sx small
    const { wall, demand } = variant({ hsx: 6000 });
    const check = checkSpecialShear(wall, demand);
    expect(node(check, "sw.shear.V_at_Mn").value).toBeLessThan(node(check, "sw.shear.Vn").value);
    expect(node(check, "sw.shear.phi").value).toBe(0.75);
  });
});

describe("V_n caps — 18.10.4.4", () => {
  it("applies the 8√f'c·A_cv limit when the reinforcement would exceed it", () => {
    const heavy: WallInput = {
      ...example2,
      horizontal: { bar: "11", spacing: 4, curtains: 2 },
    };
    const check = checkSpecialShear(heavy, heavy.demands[0]!);
    const vn = node(check, "sw.shear.Vn");
    expect(node(check, "sw.shear.Vn_calc").value).toBeGreaterThan(node(check, "sw.shear.cap_8").value);
    expect(vn.value).toBeCloseTo(node(check, "sw.shear.cap_8").value, 6);
    expect(vn.note).toContain("8√f'c limit always governs");
  });
});
