/**
 * SI (ACI 318M-19) unit plumbing — conversions, the `UnitScheme` vocabulary,
 * and the two material formula sites whose coefficients are edition-specific.
 *
 * Expected values here are computed from the **metric** expressions, never by
 * converting an in-lb result: ACI 318M rounds its own coefficients (4700, not
 * 57000/12.1 = 4730; the β1 breakpoints are 28/55 MPa, not 4000/8000 psi
 * converted), so the two editions genuinely disagree by a fraction of a percent
 * and a converted expectation would hide exactly the bug these tests exist for.
 */
import { describe, expect, it } from "vitest";
import {
  beta1,
  concrete,
  concreteMPa,
  Ec,
  fcInput,
  GRADE420,
  GRADE550,
} from "../src/materials";
import { validateTrace } from "../src/trace";
import {
  convert,
  in2ToMm2,
  inToMm,
  kipFtToKnM,
  kipToKn,
  ksiToMPa,
  mm2ToIn2,
  mmToIn,
  mPaToKsi,
  sqrtFcMPa,
  unitScheme,
} from "../src/units";

describe("SI conversions", () => {
  it("converts lengths and areas", () => {
    expect(inToMm(12)).toBeCloseTo(304.8, 9);
    expect(inToMm(336)).toBeCloseTo(8534.4, 9);
    expect(mmToIn(inToMm(9.25))).toBeCloseTo(9.25, 12);
    // 4032 in² x 645.16 = 2,601,285.12 mm²
    expect(in2ToMm2(4032)).toBeCloseTo(2601285.12, 6);
    expect(mm2ToIn2(in2ToMm2(4032))).toBeCloseTo(4032, 9);
  });

  it("converts stresses", () => {
    // 5 ksi x 6.894757 = 34.4738 MPa
    expect(ksiToMPa(5)).toBeCloseTo(34.4738, 4);
    // Grade 60 is 413.7 MPa — close to, but not, the Grade 420 of ACI 318M
    expect(ksiToMPa(60)).toBeCloseTo(413.685, 3);
    expect(mPaToKsi(ksiToMPa(5))).toBeCloseTo(5, 12);
  });

  it("converts forces and moments", () => {
    expect(kipToKn(235)).toBeCloseTo(1045.332, 3);
    expect(kipFtToKnM(18600)).toBeCloseTo(25218.21, 2);
  });

  it("converts via the general helper", () => {
    expect(convert(12, "in", "mm")).toBeCloseTo(304.8, 9);
    expect(convert(4032, "in2", "mm2")).toBeCloseTo(2601285.12, 6);
    expect(convert(5, "ksi", "MPa")).toBeCloseTo(34.4738, 4);
    expect(convert(5000, "psi", "MPa")).toBeCloseTo(34.4738, 4);
    expect(convert(235, "kip", "kN")).toBeCloseTo(1045.332, 3);
    expect(convert(1, "kN-m", "kip-ft")).toBeCloseTo(0.737562, 6);
    expect(convert(28, "ft", "m")).toBeCloseTo(8.5344, 9);
  });
});

describe("sqrtFcMPa", () => {
  it("returns sqrt of f'c in MPa", () => {
    // f'c = 5 ksi = 34.4738 MPa; sqrt = 5.8714 MPa^0.5
    expect(sqrtFcMPa(5)).toBeCloseTo(5.87144, 5);
    // f'c = 28 MPa exactly
    expect(sqrtFcMPa(mPaToKsi(28))).toBeCloseTo(Math.sqrt(28), 12);
  });

  it("rejects negative f'c", () => {
    expect(() => sqrtFcMPa(-1)).toThrow();
  });
});

describe("unitScheme", () => {
  it("defaults to in-lb and leaves every magnitude untouched", () => {
    const U = unitScheme();
    expect(U.system).toBe("in-lb");
    expect(U.si).toBe(false);
    expect(U.len(12)).toBe(12);
    expect(U.ar(4032)).toBe(4032);
    expect(U.frc(235)).toBe(235);
    expect(U.str(5)).toBe(5000);
    expect([U.length, U.area, U.force, U.moment, U.stress]).toEqual([
      "in",
      "in2",
      "kip",
      "kip-ft",
      "psi",
    ]);
  });

  it("moves magnitudes into MPa/mm/kN in SI", () => {
    const U = unitScheme("si");
    expect(U.si).toBe(true);
    expect(U.len(12)).toBeCloseTo(304.8, 9);
    expect(U.ar(4032)).toBeCloseTo(2601285.12, 6);
    expect(U.frc(235)).toBeCloseTo(1045.332, 3);
    expect(U.mom(18600)).toBeCloseTo(25218.21, 2);
    expect(U.str(5)).toBeCloseTo(34.4738, 4);
    expect(U.sqrtFc(5)).toBeCloseTo(5.87144, 5);
    expect([U.length, U.area, U.force, U.moment, U.stress]).toEqual([
      "mm",
      "mm2",
      "kN",
      "kN-m",
      "MPa",
    ]);
  });
});

describe("concreteMPa", () => {
  it("stores an SI-native f'c in the canonical ksi", () => {
    const c = concreteMPa(28);
    expect(c.fc).toBeCloseTo(mPaToKsi(28), 12);
    expect(unitScheme("si").str(c.fc)).toBeCloseTo(28, 9);
  });

  it("rejects a non-positive f'c", () => {
    expect(() => concreteMPa(0)).toThrow(/must be positive/);
  });
});

describe("metric rebar grades (ACI 318M-19)", () => {
  it("carries f_y in the canonical ksi and E_s = 200,000 MPa", () => {
    expect(ksiToMPa(GRADE420.fy)).toBeCloseTo(420, 9);
    expect(ksiToMPa(GRADE420.Es)).toBeCloseTo(200000, 6);
    expect(GRADE420.ety).toBe(0.0021);
    expect(ksiToMPa(GRADE550.fy)).toBeCloseTo(550, 9);
    expect(GRADE550.ety).toBeCloseTo(0.00275, 9);
  });
});

describe("fcInput", () => {
  const c = concrete(5000);

  it("traces f'c in psi by default", () => {
    const n = fcInput(c);
    expect(n.value).toBe(5000);
    expect(n.unit).toBe("psi");
  });

  it("traces f'c in MPa in SI", () => {
    const n = fcInput(c, unitScheme("si"));
    expect(n.value).toBeCloseTo(34.4738, 4);
    expect(n.unit).toBe("MPa");
  });

  it("mints one node per system, not one shared node", () => {
    expect(fcInput(c)).toBe(fcInput(c));
    expect(fcInput(c, unitScheme("si"))).toBe(fcInput(c, unitScheme("si")));
    expect(fcInput(c)).not.toBe(fcInput(c, unitScheme("si")));
  });
});

describe("beta1 — Table 22.2.2.4.3", () => {
  it("uses the psi breakpoints in in-lb", () => {
    // f'c = 5000 psi: 0.85 - 0.05(5000 - 4000)/1000 = 0.80
    const b = beta1(concrete(5000));
    expect(b.value).toBeCloseTo(0.8, 12);
    expect(b.formula).toContain("4000");
    expect(b.note).toContain("psi");
  });

  it("uses the MPa breakpoints in SI", () => {
    // f'c = 5 ksi = 34.4738 MPa: 0.85 - 0.05(34.4738 - 28)/7 = 0.80376
    // Not 0.80 — the metric table's breakpoint (28 MPa) and divisor (7) are
    // independently rounded, so the two editions differ by ~0.5% here.
    const b = beta1(concrete(5000), unitScheme("si"));
    expect(b.value).toBeCloseTo(0.803759, 6);
    expect(b.formula).toContain("28");
    expect(b.formula).toContain("7");
    expect(b.note).toContain("MPa");
  });

  it("caps at 0.85 below 28 MPa and 0.65 at or above 55 MPa in SI", () => {
    expect(beta1(concreteMPa(21), unitScheme("si")).value).toBe(0.85);
    expect(beta1(concreteMPa(28), unitScheme("si")).value).toBe(0.85);
    // 0.85 - 0.05(41 - 28)/7 = 0.7571
    expect(beta1(concreteMPa(41), unitScheme("si")).value).toBeCloseTo(0.757143, 6);
    expect(beta1(concreteMPa(55), unitScheme("si")).value).toBe(0.65);
    expect(beta1(concreteMPa(70), unitScheme("si")).value).toBe(0.65);
  });
});

describe("Ec — 19.2.2.1(b)", () => {
  it("uses 57000√f'c (psi) in in-lb", () => {
    // 57000 x sqrt(5000) = 4,030,509 psi
    const e = Ec(concrete(5000));
    expect(e.value).toBeCloseTo(4030508.65, 2);
    expect(e.unit).toBe("psi");
    expect(e.formula).toContain("57000");
  });

  it("uses 4700√f'c (MPa) in SI", () => {
    // f'c = 34.4738 MPa; 4700 x sqrt(34.4738) = 4700 x 5.87144 = 27,595.8 MPa.
    // Converting the in-lb answer instead would give 27,789 MPa — 0.7% high,
    // because 4700 is the metric edition's own rounding of 4730.
    const e = Ec(concrete(5000), unitScheme("si"));
    expect(e.value).toBeCloseTo(27595.76, 2);
    expect(e.unit).toBe("MPa");
    expect(e.formula).toContain("4700");
    expect(e.formula).not.toContain("57000");
    expect(() => validateTrace([e])).not.toThrow();
  });

  it("differs from the converted in-lb modulus by the metric rounding", () => {
    const inLb = ksiToMPa(Ec(concrete(5000)).value / 1000);
    const si = Ec(concrete(5000), unitScheme("si")).value;
    expect(si / inLb).toBeGreaterThan(0.99);
    expect(si / inLb).toBeLessThan(1.0);
  });
});
