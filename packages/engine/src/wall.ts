import type { BarSize, Concrete, RebarGrade } from "./materials";
import { BARS } from "./materials";
import { aci, derive, input } from "./trace";
import type { Traced } from "./trace";
import { fmtTex, unitScheme } from "./units";
import type { UnitScheme, UnitSystem } from "./units";

export interface DistributedLayer {
  bar: BarSize;
  /** center-to-center spacing, in */
  spacing: number;
  curtains: 1 | 2;
}

export interface EndZoneBars {
  bar: BarSize;
  /** total bars in one end zone, all curtains */
  count: number;
  /** in, wall end to first bar station */
  distanceToFirst: number;
  /** in, between end-zone bar stations */
  spacing: number;
}

export interface WallGeometry {
  /** wall length, in */
  lw: number;
  /** wall thickness, in */
  h: number;
  /** wall height, in */
  hw: number;
  /** height above the critical section, in (18.10) — defaults to h_w */
  hwcs?: number;
  /** unsupported height for out-of-plane, in */
  lu: number;
  /**
   * Laterally unsupported height at the extreme compression fiber, in —
   * the h_u of 18.10.6.4(b) (b ≥ h_u/16). Defaults to `lu` when absent.
   */
  hu?: number;
  k: 0.8 | 1.0 | 2.0;
  /** clear cover, in */
  cover: number;
}

export interface Demands {
  id: string;
  label?: string;
  /** kip, compression positive */
  Pu: number;
  /** kip-ft, in-plane */
  Mu: number;
  /** kip, in-plane */
  Vu: number;
  /** kip-ft, out-of-plane */
  MuOut?: number;
  /** kip, out-of-plane */
  VuOut?: number;
}

export interface SeismicParams {
  sdc: "A" | "B" | "C" | "D" | "E" | "F";
  /** elastic top deflection, in */
  deltaE?: number;
  Cd?: number;
  /** stories above the critical section */
  ns?: number;
  /**
   * First-story height, in — the lever arm used by the 21.2.4.1 φ decision.
   *
   * 21.2.4.1 compares V_n against "the shear corresponding to development of
   * the nominal moment strength". MNL-17(21) Ex. 2 takes that shear as
   * `V@Mn = 2 M_n / h_sx` (a first-story cantilever with the moment developed
   * at both ends of the story height), and this engine follows that reading —
   * see `checkSpecialShear`. Without `hsx` the φ decision cannot be made and
   * φ = 0.75 is kept with a warning.
   */
  hsx?: number;
}

/**
 * The designer's **provided** special boundary element (18.10.6.4), at one wall
 * end. The checks verify it; nothing here is sized by the engine.
 */
export interface SbeProvided {
  /** b — SBE width (wall-thickness direction) over the SBE length, in */
  width: number;
  /** ℓ_be — SBE length measured from the extreme compression fiber, in */
  length: number;
  longBar: BarSize;
  /** longitudinal bars in one boundary element, all curtains/faces */
  longCount: number;
  /** h_x — max center-to-center spacing of laterally supported longitudinal bars, in */
  hx: number;
  tieBar: BarSize;
  /** center-to-center vertical spacing of hoop/crosstie sets, in */
  tieSpacing: number;
  /** hoop + crosstie legs crossing the core width dimension b_c */
  tieLegsAcrossWidth: number;
}

export interface WallInput {
  geometry: WallGeometry;
  concrete: Concrete;
  grade: RebarGrade;
  vertical: DistributedLayer;
  horizontal: DistributedLayer;
  endZone?: EndZoneBars;
  /** provided special boundary element (18.10.6.4), special walls only */
  sbe?: SbeProvided;
  demands: Demands[];
  seismic?: SeismicParams;
  wallType: "bearing" | "nonbearing";
  system: "ordinary" | "special";
  /**
   * How to read 21.2.4.1 against 18.10.4.6 for the seismic shear φ.
   *
   * - `"handbook-conservative"` (default) — apply 21.2.4.1 regardless, i.e.
   *   φ = 0.60 when V_n < V@M_n. MNL-17(21) Ex. 2 does exactly this even though
   *   its wall is designed by 18.10.6.2.
   * - `"exempt-18.10.4.6"` — take 18.10.4.6 at its word ("The requirements of
   *   21.2.4.1 shall not apply to walls or wall piers designed according to
   *   18.10.6.2") and keep φ = 0.75 for walls on the displacement-based path.
   */
  phiSeismicReading?: "handbook-conservative" | "exempt-18.10.4.6";
  /**
   * Which edition of the code the checks evaluate and the traces speak,
   * `"in-lb"` (ACI 318-19, psi) by default.
   *
   * This does **not** change how the input above is expressed — every field
   * stays in the canonical kip/in/ksi system. It selects the coefficient set at
   * each formula site (0.17 vs 2, 0.66 vs 8, 4700 vs 57000, ...) and the units
   * the resulting trace nodes carry, so an SI report is the ACI 318M equation
   * evaluated in MPa/mm/kN rather than an in-lb answer with converted numbers.
   */
  units?: UnitSystem;
}

/** The unit system this wall's checks evaluate in — `"in-lb"` unless set. */
export function unitsOf(w: WallInput): UnitSystem {
  return w.units ?? "in-lb";
}

/** The per-system vocabulary every formula site in this wall's checks reads. */
export function schemeOf(w: WallInput): UnitScheme {
  return unitScheme(unitsOf(w));
}

// Geometry leaves are memoized per WallInput (see materials.ts) so checks that
// share a dimension share the node rather than minting a duplicate id.
const geometryNodes = new WeakMap<WallInput, Map<string, Traced>>();

function geometryInput(w: WallInput, id: string, symbol: string, label: string, value: number): Traced {
  let byId = geometryNodes.get(w);
  if (byId === undefined) {
    byId = new Map();
    geometryNodes.set(w, byId);
  }
  let node = byId.get(id);
  if (node === undefined) {
    // Geometry is stored in inches; the leaf is traced in the reporting length
    // unit so an SI trace reads in mm all the way down to the inputs.
    const U = schemeOf(w);
    node = input(id, symbol, label, U.len(value), U.length);
    byId.set(id, node);
  }
  return node;
}

export function lwInput(w: WallInput): Traced {
  return geometryInput(w, "wall.lw", "ℓ_w", "wall length", w.geometry.lw);
}

export function hInput(w: WallInput): Traced {
  return geometryInput(w, "wall.h", "h", "wall thickness", w.geometry.h);
}

export function hwInput(w: WallInput): Traced {
  return geometryInput(w, "wall.hw", "h_w", "wall height", w.geometry.hw);
}

/** h_wcs — height of the wall above the critical section, 18.10.3.1. */
export function hwcsValue(w: WallInput): number {
  return w.geometry.hwcs ?? w.geometry.hw;
}

export function hwcsInput(w: WallInput): Traced {
  return geometryInput(
    w,
    "wall.hwcs",
    "h_wcs",
    w.geometry.hwcs === undefined
      ? "height of the wall above the critical section (taken as h_w)"
      : "height of the wall above the critical section",
    hwcsValue(w),
  );
}

/** h_u — laterally unsupported height at the extreme compression fiber, 18.10.6.4(b). */
export function huValue(w: WallInput): number {
  return w.geometry.hu ?? w.geometry.lu;
}

export function huInput(w: WallInput): Traced {
  return geometryInput(
    w,
    "wall.hu",
    "h_u",
    w.geometry.hu === undefined
      ? "laterally unsupported height at the extreme compression fiber (taken as ℓ_u)"
      : "laterally unsupported height at the extreme compression fiber",
    huValue(w),
  );
}

/** Gross area of concrete section bounded by web thickness and length, 11.5.4. */
export function Acv(w: WallInput): Traced {
  const U = schemeOf(w);
  const lw = lwInput(w);
  const h = hInput(w);
  const value = U.ar(w.geometry.h * w.geometry.lw);
  return derive({
    id: "wall.Acv",
    symbol: "A_cv",
    label: "gross area of concrete section resisting shear",
    value,
    unit: U.area,
    formula: "A_{cv} = h\\,\\ell_w",
    substitution: `A_{cv} = ${fmtTex(h.value)} \\times ${fmtTex(lw.value)} = ${fmtTex(value)}\\ ${U.areaTex}`,
    ref: aci("11.5.4 / R11.5.4.2"),
    inputs: [h, lw],
  });
}

/** Gross section area — rectangular wall only (no flanges, no boundary thickening). */
export function Ag(w: WallInput): Traced {
  const U = schemeOf(w);
  const lw = lwInput(w);
  const h = hInput(w);
  const value = U.ar(w.geometry.h * w.geometry.lw);
  return derive({
    id: "wall.Ag",
    symbol: "A_g",
    label: "gross concrete section area",
    value,
    unit: U.area,
    formula: "A_g = h\\,\\ell_w",
    substitution: `A_g = ${fmtTex(h.value)} \\times ${fmtTex(lw.value)} = ${fmtTex(value)}\\ ${U.areaTex}`,
    inputs: [h, lw],
  });
}

// Derived geometry nodes are memoized per WallInput for the same reason the
// leaves are: a check graph that reaches the same ratio down two paths must see
// one node object, or validateTrace flags the shared id as a duplicate.
const derivedGeometryNodes = new WeakMap<WallInput, Map<string, Traced>>();

function memoGeometry(w: WallInput, id: string, make: () => Traced): Traced {
  let byId = derivedGeometryNodes.get(w);
  if (byId === undefined) {
    byId = new Map();
    derivedGeometryNodes.set(w, byId);
  }
  let node = byId.get(id);
  if (node === undefined) {
    node = make();
    byId.set(id, node);
  }
  return node;
}

export function hwOverLw(w: WallInput): Traced {
  return memoGeometry(w, "wall.hw_over_lw", () => {
    const lw = lwInput(w);
    const hw = hwInput(w);
    const value = w.geometry.hw / w.geometry.lw;
    return derive({
      id: "wall.hw_over_lw",
      symbol: "h_w/ℓ_w",
      label: "wall aspect ratio",
      value,
      unit: "1",
      formula: "h_w/\\ell_w",
      substitution: `h_w/\\ell_w = ${fmtTex(hw.value)} / ${fmtTex(lw.value)} = ${fmtTex(value, { dp: 3 })}`,
      inputs: [hw, lw],
    });
  });
}

/** h_wcs/ℓ_w — the ratio the 18.10 triggers are read from (18.10.3.1, 18.10.6.1). */
export function hwcsOverLw(w: WallInput): Traced {
  return memoGeometry(w, "wall.hwcs_over_lw", () => {
    const lw = lwInput(w);
    const hwcs = hwcsInput(w);
    const value = hwcsValue(w) / w.geometry.lw;
    return derive({
      id: "wall.hwcs_over_lw",
      symbol: "h_wcs/ℓ_w",
      label: "aspect ratio above the critical section",
      value,
      unit: "1",
      formula: "h_{wcs}/\\ell_w",
      substitution: `h_{wcs}/\\ell_w = ${fmtTex(hwcs.value)} / ${fmtTex(lw.value)} = ${fmtTex(value, { dp: 3 })}`,
      ref: aci("18.10.3.1"),
      inputs: [hwcs, lw],
    });
  });
}

export interface BarStation {
  /** in, measured from one wall end along ℓ_w */
  x: number;
  /** in2, total steel at this station across all curtains */
  area: number;
}

const X_TOL = 1e-6;

/**
 * Vertical bar layout along ℓ_w, as stations (x, area) consumed by the fiber
 * section engine.
 *
 * Layout convention:
 * - x runs from one wall end (x = 0) to the other (x = ℓ_w); curtains are not
 *   distinguished — they resolve to the same in-plane station, so a station's
 *   area is Ab × curtains. (Out-of-plane offsets are irrelevant to in-plane P–M.)
 * - End-zone bars, when present, are mirrored at both ends: stations at
 *   distanceToFirst, +spacing, ... Their `count` is the total bars in one end
 *   zone across all curtains, so full stations carry `curtains` bars and a
 *   trailing partial station carries the remainder.
 * - Distributed bars are laid on a grid stepping inward from each end at the
 *   layer spacing (x = s, 2s, ... from each end, plus a single centered bar when
 *   ℓ_w/2 lands on the grid), which keeps the layout symmetric for any ℓ_w.
 *   A distributed station must clear the outermost end-zone station by at least
 *   half the distributed spacing; the ones that do not are dropped, since the
 *   end-zone bars already reinforce that strip.
 */
export function barPositions(w: WallInput): BarStation[] {
  const { lw } = w.geometry;
  const stations: BarStation[] = [];

  let endZoneReach = 0;
  if (w.endZone && w.endZone.count > 0) {
    const ez = w.endZone;
    const Ab = BARS[ez.bar].Ab;
    const perStation = w.vertical.curtains;
    const full = Math.floor(ez.count / perStation);
    const remainder = ez.count - full * perStation;
    const counts: number[] = [];
    for (let i = 0; i < full; i++) counts.push(perStation);
    if (remainder > 0) counts.push(remainder);
    for (const [i, n] of counts.entries()) {
      const x = ez.distanceToFirst + i * ez.spacing;
      if (x >= lw / 2) continue;
      endZoneReach = Math.max(endZoneReach, x);
      stations.push({ x, area: n * Ab });
      stations.push({ x: lw - x, area: n * Ab });
    }
  }

  const s = w.vertical.spacing;
  const Abd = BARS[w.vertical.bar].Ab * w.vertical.curtains;
  if (s > 0) {
    const clear = endZoneReach > 0 ? endZoneReach + s / 2 : 0;
    for (let i = 1; i * s < lw / 2 - X_TOL; i++) {
      const x = i * s;
      if (x < clear - X_TOL) continue;
      stations.push({ x, area: Abd });
      stations.push({ x: lw - x, area: Abd });
    }
    const mid = lw / 2;
    if (Math.abs(mid / s - Math.round(mid / s)) < X_TOL && mid >= clear - X_TOL) {
      stations.push({ x: mid, area: Abd });
    }
  }

  return stations.sort((a, b) => a.x - b.x);
}

/** Total vertical steel area from the resolved bar layout, in2. */
export function totalVerticalAs(w: WallInput): number {
  return barPositions(w).reduce((sum, st) => sum + st.area, 0);
}
