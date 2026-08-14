import { describe, expect, it } from "vitest";
import { GRADE60, concrete } from "../src/materials";
import {
  AstInput,
  PnMax,
  PntMax,
  Po,
  axialLimits,
  cAt,
  designCurve,
  designSliceAt,
  interactionCurve,
  mprAt,
  phiMnAt,
  sectionAt,
} from "../src/section/interaction";
import { validateTrace } from "../src/trace";
import { barPositions, totalVerticalAs } from "../src/wall";
import type { WallInput } from "../src/wall";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** MNL-17(21) Shear Wall Example 1: 28 ft x 12 in., No. 5 @ 12 in. e.f. */
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

/** MNL-17(21) Shear Wall Example 2: same section, vertical No. 8 @ 12 in. e.f. */
const example2: WallInput = {
  ...example1,
  vertical: { bar: "8", spacing: 12, curtains: 2 },
  horizontal: { bar: "6", spacing: 12, curtains: 2 },
  endZone: { bar: "8", count: 2, distanceToFirst: 3, spacing: 12 },
  demands: [{ id: "base", Pu: 1015, Mu: 37200, Vu: 470, MuOut: 120, VuOut: 32 }],
  system: "special",
};

/**
 * Minimal hand-checkable section: lw = 24 in., h = 12 in., f'c = 4000 psi
 * (beta1 = 0.85), Grade 60, exactly two bar stations of As = 2.0 in.^2 at
 * x = 3 in. and x = 21 in.
 *
 * Built from `endZone` alone: No. 9 (Ab = 1.0) x 2 curtains = 2.0 in.^2 per
 * station, count = 2 so exactly one station per end, mirrored to x = 21. The
 * distributed layer is given a spacing larger than lw so `barPositions`
 * generates nothing from it (the inward-stepping loop never runs and lw/2 does
 * not land on the grid).
 */
const synthetic: WallInput = {
  geometry: { lw: 24, h: 12, hw: 240, lu: 100, k: 1.0, cover: 1.5 },
  concrete: concrete(4000),
  grade: GRADE60,
  vertical: { bar: "9", spacing: 25, curtains: 2 },
  horizontal: { bar: "4", spacing: 12, curtains: 2 },
  endZone: { bar: "9", count: 2, distanceToFirst: 3, spacing: 12 },
  demands: [{ id: "t", Pu: 0, Mu: 0, Vu: 0 }],
  wallType: "bearing",
  system: "ordinary",
};

const pctDelta = (computed: number, reference: number): number =>
  ((computed - reference) / reference) * 100;

// ===========================================================================
// TIER 1 — closed-form anchors (+/- 0.1%)
// ===========================================================================

describe("tier 1: closed-form axial endpoints", () => {
  it("reproduces Po by hand for the Example 1 wall (Eq. 22.4.2.2)", () => {
    // Ast = 29 stations x 2 x 0.31 = 17.98 in.^2; Ag = 12 x 336 = 4032 in.^2
    // Po = 0.85(5)(4032 - 17.98) + 60(17.98) = 17,059.585 + 1078.8 = 18,138.385 kip
    const Ast = totalVerticalAs(example1);
    expect(Ast).toBeCloseTo(17.98, 10);
    const hand = 0.85 * 5 * (4032 - 17.98) + 60 * 17.98;
    expect(hand).toBeCloseTo(18138.385, 6);
    expect(Math.abs(pctDelta(axialLimits(example1).Po, hand))).toBeLessThan(0.1);
  });

  it("reproduces Pnt,max by hand for the Example 1 wall (Eq. 22.4.3.1)", () => {
    // Pnt,max = -fy*Ast = -60(17.98) = -1078.8 kip (compression positive)
    const hand = -60 * 17.98;
    expect(hand).toBeCloseTo(-1078.8, 10);
    expect(Math.abs(pctDelta(axialLimits(example1).PntMax, hand))).toBeLessThan(0.1);
  });

  it("applies the 0.80 tied cap to Po (22.4.2.1)", () => {
    const lim = axialLimits(example1);
    expect(lim.PnMax).toBeCloseTo(0.8 * lim.Po, 10);
  });

  it("reproduces Po and Pnt,max for the synthetic section", () => {
    // Ag = 24 x 12 = 288, Ast = 4.0
    // Po = 0.85(4)(288 - 4) + 60(4) = 965.6 + 240 = 1205.6 kip
    const lim = axialLimits(synthetic);
    expect(lim.Po).toBeCloseTo(1205.6, 8);
    expect(lim.PntMax).toBeCloseTo(-240, 10);
  });
});

describe("tier 1: the synthetic two-bar section", () => {
  it("resolves to exactly two stations of 2.0 in.^2 at x = 3 and x = 21", () => {
    expect(barPositions(synthetic)).toEqual([
      { x: 3, area: 2 },
      { x: 21, area: 2 },
    ]);
  });

  /**
   * Pure bending (Pn = 0), by hand.
   *
   * Assume the tension bar at x = 21 yields and the compression bar at x = 3
   * falls OUTSIDE the stress block (verified below: a = 2.70 in. < 3 in.), so it
   * takes no displaced-concrete deduction and stays elastic:
   *
   *   Cc = 0.85 f'c h a = 0.85(4)(12)(0.85 c) = 34.68 c
   *   F1 = As Es eps_s1 = 2(29000)(0.003)(c - 3)/c = 174 (c - 3)/c
   *   F2 = As(-fy) = 2(-60) = -120
   *
   *   Pn = 0:  34.68 c + 174 (c - 3)/c - 120 = 0
   *        =>  34.68 c^2 + 54 c - 522 = 0
   *        =>  c = (-54 + sqrt(54^2 + 4(34.68)(522))) / (2 x 34.68) = 3.178477 in.
   *
   * Then a = 0.85 c = 2.70170 in. (< 3, assumption holds), f_s1 = 4.885 ksi
   * (< 60, elastic assumption holds), eps_s2 = -0.01682 (yielded, holds).
   *
   *   Mn = Cc(lw/2 - a/2) + F1(lw/2 - 3) + F2(lw/2 - 21)   about lw/2 = 12 in.
   *      = 110.229(10.64915) + 9.770(9) + (-120)(-9)
   *      = 2341.78 kip-in = 195.15 kip-ft
   */
  it("matches the hand-solved pure-bending point", () => {
    const A = 34.68;
    const B = 54;
    const C = -522;
    const cHand = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
    expect(cHand).toBeCloseTo(3.178477, 6);

    const a = 0.85 * cHand;
    expect(a).toBeLessThan(3); // compression bar sits outside the stress block
    const Cc = 0.85 * 4 * 12 * a;
    const F1 = (174 * (cHand - 3)) / cHand;
    expect(F1 / 2).toBeLessThan(60); // compression bar is elastic
    const F2 = -120;
    expect(Cc + F1 + F2).toBeCloseTo(0, 9);

    const MnHand = (Cc * (12 - a / 2) + F1 * (12 - 3) + F2 * (12 - 21)) / 12;
    expect(MnHand).toBeCloseTo(195.1487, 3);

    const c = cAt(synthetic, 0);
    expect(Math.abs(pctDelta(c, cHand))).toBeLessThan(0.1);
    const p = sectionAt(synthetic, c);
    expect(Math.abs(p.Pn)).toBeLessThan(1e-6);
    expect(Math.abs(pctDelta(p.Mn, MnHand))).toBeLessThan(0.1);
    expect(p.phi).toBe(0.9); // eps_t = 0.0168 >> ety + 0.003
  });

  /**
   * Balanced point, by hand: eps_t = eps_ty = 0.002 at the extreme tension bar
   * (d = 21 in.), so 0.003 (21 - c)/c = 0.002 => c = 0.003(21)/0.005 = 12.6 in.
   *
   *   a  = 0.85(12.6) = 10.71 in.  (> 3, so the compression bar IS in the block)
   *   Cc = 0.85(4)(12)(10.71) = 436.968 kip
   *   f_s1 = 87(12.6 - 3)/12.6 = 66.29 ksi -> capped at fy = 60
   *   F1 = 2(60 - 0.85 x 4) = 2(56.6) = 113.2 kip
   *   f_s2 = Es eps_s2 = 29000(-0.002) = -58 ksi   <-- NOT -60: eps_ty = 0.002 is
   *        the Table 21.2.2 phi threshold permitted for Grade 60, while the
   *        material yields at fy/Es = 0.002069. At eps = 0.002 the bar is still
   *        (just) elastic.
   *   F2 = -116 kip
   *
   *   Pn = 436.968 + 113.2 - 116 = 434.168 kip
   *   Mn = 436.968(12 - 5.355) + 113.2(9) + (-116)(-9)
   *      = 2903.652 + 1018.8 + 1044 = 4966.452 kip-in = 413.871 kip-ft
   *   phi = 0.65 (eps_t = eps_ty exactly -> compression-controlled row)
   */
  it("matches the hand-solved balanced point", () => {
    const c = (0.003 * 21) / 0.005;
    expect(c).toBeCloseTo(12.6, 12);

    const a = 0.85 * c;
    const Cc = 0.85 * 4 * 12 * a;
    const F1 = 2 * (60 - 0.85 * 4);
    const F2 = 2 * 29000 * -0.002;
    const PnHand = Cc + F1 + F2;
    const MnHand = (Cc * (12 - a / 2) + F1 * (12 - 3) + F2 * (12 - 21)) / 12;
    expect(PnHand).toBeCloseTo(434.168, 6);
    expect(MnHand).toBeCloseTo(413.87103, 5);

    const p = sectionAt(synthetic, c);
    expect(p.epsT).toBeCloseTo(0.002, 12);
    expect(Math.abs(pctDelta(p.Pn, PnHand))).toBeLessThan(0.1);
    expect(Math.abs(pctDelta(p.Mn, MnHand))).toBeLessThan(0.1);
    expect(p.phi).toBe(0.65);
  });
});

// ===========================================================================
// TIER 2 — structural properties of the curve
// ===========================================================================

describe("tier 2: interaction curve properties", () => {
  const curve = interactionCurve(example1, { points: 400 });

  it("returns exactly the requested number of points", () => {
    expect(curve.length).toBe(400);
    expect(interactionCurve(example1).length).toBe(200);
  });

  it("starts at the analytic pure-tension endpoint and ends at Po", () => {
    const lim = axialLimits(example1);
    const first = curve[0]!;
    const last = curve[curve.length - 1]!;
    expect(first.c).toBe(0);
    expect(first.Pn).toBeCloseTo(lim.PntMax, 10);
    expect(first.Mn).toBe(0);
    expect(last.Pn).toBeCloseTo(lim.Po, 8);
    expect(Math.abs(last.Mn)).toBeLessThan(1e-6);
  });

  it("keeps Mn >= 0 everywhere and drives it to zero at both axial extremes", () => {
    for (const p of curve) expect(p.Mn).toBeGreaterThanOrEqual(0);
    const peak = Math.max(...curve.map((p) => p.Mn));
    expect(peak).toBeGreaterThan(20000);
    // both ends are small compared with the peak
    expect(curve[0]!.Mn).toBeLessThan(peak * 1e-6);
    expect(curve[curve.length - 1]!.Mn).toBeLessThan(peak * 1e-6);
  });

  it("keeps phi inside [0.65, 0.90] and spans the whole range", () => {
    for (const p of curve) {
      expect(p.phi).toBeGreaterThanOrEqual(0.65);
      expect(p.phi).toBeLessThanOrEqual(0.9);
    }
    expect(curve.some((p) => p.phi === 0.9)).toBe(true);
    expect(curve.some((p) => p.phi === 0.65)).toBe(true);
    expect(curve.some((p) => p.phi > 0.65 && p.phi < 0.9)).toBe(true);
  });

  it("makes eps_t strictly decreasing in c", () => {
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.c).toBeGreaterThan(curve[i - 1]!.c);
      expect(curve[i]!.epsT).toBeLessThan(curve[i - 1]!.epsT);
    }
  });

  it("brackets the axial range without exceeding either analytic endpoint", () => {
    const lim = axialLimits(example1);
    for (const p of curve) {
      expect(p.Pn).toBeGreaterThanOrEqual(lim.PntMax - 1e-9);
      expect(p.Pn).toBeLessThanOrEqual(lim.Po + 1e-9);
    }
  });

  it("rejects a non-positive neutral axis depth", () => {
    expect(() => sectionAt(example1, 0)).toThrow(/positive/);
    expect(() => sectionAt(example1, -5)).toThrow(/positive/);
  });
});

describe("tier 2: design curve", () => {
  it("applies phi to both Pn and Mn and caps phiPn at 0.65 x 0.80 Po", () => {
    const lim = axialLimits(example1);
    const cap = 0.65 * lim.PnMax;
    const nominalPts = interactionCurve(example1, { points: 300 });
    const design = designCurve(example1, { points: 300 });
    expect(design.length).toBe(nominalPts.length);
    for (let i = 0; i < design.length; i++) {
      const n = nominalPts[i]!;
      const d = design[i]!;
      expect(d.phiPn).toBeLessThanOrEqual(cap + 1e-9);
      expect(d.phiMn).toBeCloseTo(n.phi * n.Mn, 9);
      expect(d.capped).toBe(n.phi * n.Pn > cap);
      if (!d.capped) expect(d.phiPn).toBeCloseTo(n.phi * n.Pn, 9);
    }
    expect(design.some((d) => d.capped)).toBe(true);
  });
});

describe("tier 2: root finders", () => {
  it("cAt inverts sectionAt to within 0.1%", () => {
    for (const Pu of [-900, -500, 0, 500, 1015, 1200, 3000, 6000, 9000, 12000]) {
      const c = cAt(example1, Pu);
      const p = sectionAt(example1, c);
      if (Pu === 0) expect(Math.abs(p.Pn)).toBeLessThan(1e-6);
      else expect(Math.abs(pctDelta(p.Pn, Pu))).toBeLessThan(0.1);
    }
  });

  it("cAt increases with Pu", () => {
    let prev = 0;
    for (const Pu of [-500, 0, 500, 1015, 1200, 3000, 6000]) {
      const c = cAt(example1, Pu);
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
  });

  it("cAt throws outside the nominal axial range", () => {
    expect(() => cAt(example1, 25000)).toThrow(/outside the nominal axial range/);
    expect(() => cAt(example1, -5000)).toThrow(/outside the nominal axial range/);
  });

  it("phiMnAt lands on the design curve at the requested Pu", () => {
    for (const Pu of [0, 500, 1015, 1200, 3000]) {
      const slice = designSliceAt(example1, Pu);
      expect(slice).toBeDefined();
      expect(slice!.phi * slice!.Pn).toBeCloseTo(Pu, 6);
      expect(phiMnAt(example1, Pu)).toBeCloseTo(slice!.phiMn, 9);
      expect(slice!.phiMn).toBeCloseTo(slice!.phi * slice!.Mn, 9);
    }
  });

  it("phiMnAt returns 0 when Pu is off the end of the design curve", () => {
    expect(phiMnAt(example1, 25000)).toBe(0);
    expect(phiMnAt(example1, -5000)).toBe(0);
  });

  it("mprAt exceeds Mn at the same axial force (1.25 fy, phi = 1.0)", () => {
    for (const Pu of [0, 1015, 1200, 3000]) {
      const Mn = sectionAt(example1, cAt(example1, Pu)).Mn;
      const Mpr = mprAt(example1, Pu);
      expect(Mpr).toBeGreaterThan(Mn);
      // overstrength is bounded: 1.25 fy cannot more than ~1.3x the moment
      expect(Mpr / Mn).toBeLessThan(1.3);
    }
  });
});

describe("tier 2: traced section properties", () => {
  it("builds a valid trace for Po, Pn,max and Pnt,max", () => {
    const nodes = [Po(example1), PnMax(example1), PntMax(example1)];
    expect(() => validateTrace(nodes)).not.toThrow();
    expect(nodes[0]!.ref?.section).toBe("22.4.2.2");
    expect(nodes[1]!.ref?.section).toBe("22.4.2.1");
    expect(nodes[2]!.ref?.section).toBe("22.4.3.1");
    expect(nodes[0]!.value).toBeCloseTo(18138.385, 3);
    expect(nodes[1]!.value).toBeCloseTo(0.8 * 18138.385, 3);
    expect(nodes[2]!.value).toBeCloseTo(-1078.8, 6);
  });

  it("memoizes section leaves so merged traces stay a DAG", () => {
    expect(AstInput(example1)).toBe(AstInput(example1));
    expect(Po(example1)).toBe(Po(example1));
    expect(PnMax(example1).inputs[0]).toBe(Po(example1));
    expect(() => validateTrace([PnMax(example1), PntMax(example1)])).not.toThrow();
  });
});

// ===========================================================================
// TIER 3 — MNL-17(21) handbook oracle
// ===========================================================================

describe("tier 3: MNL-17(21) handbook oracle", () => {
  it("Example 1 step 4: phiMn at Pu = 1015 kip ~ 24,600 ft-kip", () => {
    const phiMn = phiMnAt(example1, 1015);
    const delta = pctDelta(phiMn, 24600);
    expect(Math.abs(delta)).toBeLessThan(2.5);
    expect(phiMn).toBeGreaterThan(18600); // handbook conclusion: OK
  });

  it("Example 2 step 4b: phiMn at Pu = 1015 kip ~ 40,200 ft-kip", () => {
    const phiMn = phiMnAt(example2, 1015);
    expect(Math.abs(pctDelta(phiMn, 40200))).toBeLessThan(2.5);
    expect(phiMn).toBeGreaterThan(37200); // handbook conclusion: OK
  });

  it("Example 2 step 6: Mpr at Pu ~ 1200 kip ~ 51,900 ft-kip", () => {
    expect(Math.abs(pctDelta(mprAt(example2, 1200), 51900))).toBeLessThan(3);
  });

  it("Example 2 step 7: c at Pu ~ 1200 kip ~ 67.9 in.", () => {
    expect(Math.abs(pctDelta(cAt(example2, 1200), 67.9))).toBeLessThan(4);
  });

  it("reports every oracle delta", () => {
    const deltas = {
      "ex1 phiMn @ Pu=1015": pctDelta(phiMnAt(example1, 1015), 24600),
      "ex2 phiMn @ Pu=1015": pctDelta(phiMnAt(example2, 1015), 40200),
      "ex2 Mpr @ Pu=1200": pctDelta(mprAt(example2, 1200), 51900),
      "ex2 c @ Pu=1200": pctDelta(cAt(example2, 1200), 67.9),
    };
    for (const [, d] of Object.entries(deltas)) expect(Number.isFinite(d)).toBe(true);
    // surfaced in the test output for the record
    // eslint-disable-next-line no-console
    console.log("handbook oracle deltas (%):", deltas);
  });
});

// ===========================================================================
// performance sanity
// ===========================================================================

describe("performance", () => {
  it("builds a 200-point curve for the Example 1 wall well under 50 ms", () => {
    interactionCurve(example1, { points: 8 }); // warm the memoized section model
    const t0 = performance.now();
    const curve = interactionCurve(example1, { points: 200 });
    const elapsed = performance.now() - t0;
    expect(curve.length).toBe(200);
    expect(elapsed).toBeLessThan(50);
  });
});
