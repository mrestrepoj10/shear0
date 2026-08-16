import { beta1, fcInput } from "../materials";
import { aci, derive, input } from "../trace";
import type { Traced } from "../trace";
import { fmtTex, kipInToKipFt, ksiToMPa, ksiToPsi, mmToIn } from "../units";
import type { UnitScheme } from "../units";
import { Ag, barPositions, schemeOf } from "../wall";
import type { WallInput } from "../wall";

/**
 * Fiber (strain-compatibility) P–M interaction for the **in-plane** bending of a
 * rectangular wall section, per ACI 318-19 §22.2 design assumptions and the
 * §22.4 axial caps.
 *
 * ## Geometry and sign conventions
 * - `x` is the station coordinate along ℓ_w measured from one wall end, matching
 *   `barPositions(input)`. The **extreme compression fiber is at x = 0**, so the
 *   neutral axis depth `c` is measured from x = 0 and the extreme tension steel
 *   is the station with the largest x.
 * - Only one bending direction is analysed. `barPositions` lays the steel out
 *   symmetrically about ℓ_w/2 (end-zone bars are mirrored, distributed bars step
 *   inward from both ends), so the section is symmetric and the +M and −M
 *   surfaces coincide. Callers pass |M_u|. A future asymmetric layout (single
 *   boundary element, flanged wall) would need the mirrored sweep as well.
 * - **Axial force is compression positive**; a bar in compression carries
 *   positive strain, stress and force.
 * - Moment is taken about the geometric centroid x = ℓ_w/2 and is positive when
 *   it puts x = 0 in compression: `Mn = Σ F_i (ℓ_w/2 − x_i)` over the concrete
 *   resultant and every bar station. Internally kip-in; every exported moment is
 *   **kip-ft**.
 *
 * ## Section behaviour at a given c (22.2.2)
 * - ε_cu = 0.003 at x = 0; plane sections; concrete tension neglected.
 * - Concrete: equivalent rectangular stress block (22.2.2.4), depth
 *   `a = β1·c` clipped to ℓ_w, uniform stress 0.85 f'c, so
 *   `Cc = 0.85 f'c · h · min(a, ℓ_w)` acting at `min(a, ℓ_w)/2` from x = 0.
 * - Steel at station x: `ε_s = 0.003 (c − x)/c`, `f_s = clamp(E_s ε_s, −f_y, +f_y)`
 *   (elastic–perfectly-plastic, 20.2.2). A bar that falls **inside the stress
 *   block** (x < a) sits in concrete that the block already counted as stressed
 *   to 0.85 f'c, so its force is `A_s (f_s − 0.85 f'c)` — the standard displaced-
 *   concrete deduction. Outside the block the force is `A_s f_s`. The deduction
 *   is applied on geometry alone (x < a), not on the sign of f_s, which is the
 *   convention ACI's own interaction spreadsheet uses; it introduces a small
 *   downward step in Pn(c) each time `a` sweeps past a bar station, so the
 *   root-finders below bracket by scanning rather than assuming monotonicity.
 * - ε_t is the **net tensile strain in the extreme tension bar, tension
 *   positive**: `ε_t = 0.003 (x_t − c)/c` where x_t is the largest station.
 *   φ follows Table 21.2.2, "other" (no spirals) column.
 *
 * Note that ε_ty (Table 21.2.2, via `grade.ety` — 0.002 is permitted for Grade 60
 * by 21.2.2.1) and the stress–strain yield point f_y/E_s are deliberately
 * *different* numbers: the first is a φ threshold, the second is material
 * behaviour. Do not conflate them.
 *
 * The numeric core is plain number math over pre-resolved typed arrays — no
 * Traced allocation inside any loop. Only the handful of reported section
 * properties below (`section.*`) are wrapped as trace nodes.
 *
 * ## Two-edition seam (`WallInput.units`)
 * Unlike a Code formula site, this solver has **no edition-specific
 * coefficient**: strain compatibility, the 0.85 f'c block, ε_cu = 0.003, the
 * Table 21.2.2 φ ramp and the 0.80 P_o cap are printed identically in ACI 318-19
 * and ACI 318M-19. The one place the editions differ is β1, whose breakpoints
 * are nonhomogeneous (4000/8000 psi against 28/55 MPa), so `buildSection` passes
 * the wall's scheme to `beta1`.
 *
 * Everything else stays in the canonical kip/in/ksi system: the iteration, the
 * root finding, and every intermediate. Converting the internals would buy
 * nothing and would perturb the handbook oracles. Instead the conversion happens
 * once, at the **reporting boundary** — the exported curve/slice/limit functions
 * and the `section.*` trace nodes convert their canonical results into the
 * wall's reporting system (mm, kN, kN·m) on the way out.
 *
 * Argument convention at that boundary: an axial force argument (`Pu`) is a
 * *demand* read straight out of `Demands`, so it stays canonical **kip** in both
 * modes. A neutral axis depth argument (`sectionAt`'s `c`) is a value this
 * module itself produced, so it is symmetric with what `cAt`/`designSliceAt`
 * return — i.e. mm in SI mode — and `sectionAt(w, cAt(w, Pu))` composes
 * correctly in either edition.
 */

/** Maximum usable concrete compressive strain, 22.2.2.1. */
const EPS_CU = 0.003;

/** Transition-zone width of Table 21.2.2 (318-19 form: ε_ty → ε_ty + 0.003). */
const PHI_TRANSITION = 0.003;

const PHI_COMPRESSION = 0.65;
const PHI_TENSION = 0.9;

/** 22.4.2.1, Table 22.4.2.1 — tied (non-spiral) members, the wall case. */
const PN_MAX_FACTOR = 0.8;

/** Probable-strength steel overstrength factor, 18.10.5 / R18.10.3.1. */
const MPR_FY_FACTOR = 1.25;

/**
 * A single point on the nominal (unfactored) interaction surface, in the wall's
 * reporting system — in/kip/kip-ft by default, mm/kN/kN·m when `units: "si"`.
 */
export interface SectionPoint {
  /** neutral axis depth measured from the extreme compression fiber (x = 0), in | mm */
  c: number;
  /** nominal axial strength, kip | kN — compression positive */
  Pn: number;
  /** nominal flexural strength about ℓ_w/2, kip-ft | kN·m */
  Mn: number;
  /** net tensile strain in the extreme tension bar, tension positive */
  epsT: number;
  /** strength reduction factor, Table 21.2.2 "other" */
  phi: number;
}

/**
 * A single point on the design (φ-factored, axially capped) interaction surface,
 * in the wall's reporting system (in/kip/kip-ft | mm/kN/kN·m).
 */
export interface DesignPoint {
  /** neutral axis depth, in | mm */
  c: number;
  /** design axial strength φPn, kip | kN — capped at φ·0.80·Po (22.4.2.1) */
  phiPn: number;
  /** design flexural strength φMn, kip-ft | kN·m */
  phiMn: number;
  /** net tensile strain in the extreme tension bar, tension positive */
  epsT: number;
  /** strength reduction factor applied, Table 21.2.2 */
  phi: number;
  /** true where the 22.4.2.1 axial cap truncated φPn */
  capped: boolean;
}

export interface CurveOptions {
  /** total points on the returned curve, including both analytic endpoints */
  points?: number;
}

/** Analytic axial endpoints of the interaction surface, kip | kN. */
export interface AxialLimits {
  /** Eq. (22.4.2.2) nominal axial strength at zero eccentricity */
  Po: number;
  /** 22.4.2.1 cap on Pn for tied members, 0.80·Po */
  PnMax: number;
  /** Eq. (22.4.3.1) axial tension cap, −f_y·A_st (negative = tension) */
  PntMax: number;
}

// ---------------------------------------------------------------------------
// resolved section model (plain numbers)
// ---------------------------------------------------------------------------

interface FiberSection {
  /** bar station coordinates, in, ascending */
  xs: Float64Array;
  /** bar station areas, in2 */
  as: Float64Array;
  n: number;
  /** station of the extreme tension bar, in */
  xt: number;
  /** ksi */
  fy: number;
  /** ksi */
  Es: number;
  /** Table 21.2.2 yield strain */
  ety: number;
  /** ksi */
  fc: number;
  beta1: number;
  lw: number;
  h: number;
  /** in2 */
  Ag: number;
  /** in2 */
  Ast: number;
  /** smallest c at which Pn(c) has reached Po exactly */
  cFull: number;
}

function buildSection(w: WallInput, fyFactor: number): FiberSection {
  const stations = barPositions(w);
  if (stations.length === 0) {
    throw new Error("interaction: wall has no vertical bar stations — check the reinforcement layout");
  }
  const n = stations.length;
  const xs = new Float64Array(n);
  const as = new Float64Array(n);
  let Ast = 0;
  for (let i = 0; i < n; i++) {
    const st = stations[i]!;
    xs[i] = st.x;
    as[i] = st.area;
    Ast += st.area;
  }
  const { lw, h } = w.geometry;
  const fy = w.grade.fy * fyFactor;
  // β1 is the one edition-dependent quantity in the section model: ACI 318-19
  // Table 22.2.2.4.3 breaks at 4000/8000 psi, ACI 318M-19 Table 22.2.2.4.3 at
  // 28/55 MPa with the 0.05(f'c − 28)/7 slope. Forward the wall's scheme so the
  // metric breakpoints govern in SI mode.
  const b1 = beta1(w.concrete, schemeOf(w)).value;
  const xt = xs[n - 1]!;

  // Pn(c) stops growing once (a) the stress block covers the section and (b)
  // every bar has yielded in compression. Past that c the section is at Po, so
  // it is the exact right end of the sweep. Yielding is governed by the material
  // yield strain f_y/E_s, never by the Table 21.2.2 φ threshold.
  const eyMaterial = fy / w.grade.Es;
  const byBlock = lw / b1;
  const byYield =
    eyMaterial < EPS_CU ? (xt * EPS_CU) / (EPS_CU - eyMaterial) : Number.POSITIVE_INFINITY;
  const cFull = Math.min(50 * lw, Math.max(byBlock, byYield));

  return {
    xs,
    as,
    n,
    xt,
    fy,
    Es: w.grade.Es,
    ety: w.grade.ety,
    fc: w.concrete.fc,
    beta1: b1,
    lw,
    h,
    Ag: lw * h,
    Ast,
    cFull,
  };
}

const nominalModels = new WeakMap<WallInput, FiberSection>();
const probableModels = new WeakMap<WallInput, FiberSection>();

function nominal(w: WallInput): FiberSection {
  let m = nominalModels.get(w);
  if (m === undefined) {
    m = buildSection(w, 1);
    nominalModels.set(w, m);
  }
  return m;
}

function probable(w: WallInput): FiberSection {
  let m = probableModels.get(w);
  if (m === undefined) {
    m = buildSection(w, MPR_FY_FACTOR);
    probableModels.set(w, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// reporting boundary — canonical (kip/in/kip-ft) → the wall's system
// ---------------------------------------------------------------------------
//
// ε_t and φ are dimensionless and pass through untouched; c, Pn/φPn and
// Mn/φMn are the reported quantities that change system.

function reportPoint(U: UnitScheme, p: SectionPoint): SectionPoint {
  if (!U.si) return p;
  return { c: U.len(p.c), Pn: U.frc(p.Pn), Mn: U.mom(p.Mn), epsT: p.epsT, phi: p.phi };
}

function reportDesignPoint(U: UnitScheme, p: DesignPoint): DesignPoint {
  if (!U.si) return p;
  return { ...p, c: U.len(p.c), phiPn: U.frc(p.phiPn), phiMn: U.mom(p.phiMn) };
}

function reportLimits(U: UnitScheme, l: AxialLimits): AxialLimits {
  if (!U.si) return l;
  return { Po: U.frc(l.Po), PnMax: U.frc(l.PnMax), PntMax: U.frc(l.PntMax) };
}

/** Table 21.2.2, "other" column. ε_t tension positive. */
function phiOf(epsT: number, ety: number): number {
  if (epsT <= ety) return PHI_COMPRESSION;
  if (epsT >= ety + PHI_TRANSITION) return PHI_TENSION;
  return PHI_COMPRESSION + 0.25 * ((epsT - ety) / PHI_TRANSITION);
}

/** The hot loop. Plain numbers, no allocation beyond the returned record. */
function pointAt(S: FiberSection, c: number): SectionPoint {
  const aRaw = S.beta1 * c;
  const a = aRaw < S.lw ? aRaw : S.lw;
  const cc = 0.85 * S.fc * S.h * a;
  const half = S.lw / 2;
  let Pn = cc;
  let Mn = cc * (half - a / 2);

  const dcDeduct = 0.85 * S.fc;
  const scale = (EPS_CU * S.Es) / c;
  const fy = S.fy;
  const xs = S.xs;
  const as = S.as;
  for (let i = 0; i < S.n; i++) {
    const x = xs[i]!;
    let fs = scale * (c - x);
    if (fs > fy) fs = fy;
    else if (fs < -fy) fs = -fy;
    const f = as[i]! * (x < aRaw ? fs - dcDeduct : fs);
    Pn += f;
    Mn += f * (half - x);
  }

  const epsT = (EPS_CU * (S.xt - c)) / c;
  return { c, Pn, Mn: kipInToKipFt(Mn), epsT, phi: phiOf(epsT, S.ety) };
}

/**
 * Nominal section strength at a given neutral axis depth.
 *
 * @param c neutral axis depth from the extreme compression fiber, in the wall's
 *          reporting length unit (in | mm) — must be > 0 (c = 0 is the
 *          degenerate pure-tension limit, supplied analytically by
 *          `interactionCurve`). Symmetric with the `c` this module returns, so
 *          `sectionAt(w, cAt(w, Pu))` composes in either edition.
 */
export function sectionAt(w: WallInput, c: number): SectionPoint {
  if (!(c > 0)) throw new Error(`sectionAt: neutral axis depth must be positive, got c = ${c}`);
  const U = schemeOf(w);
  return reportPoint(U, pointAt(nominal(w), U.si ? mmToIn(c) : c));
}

// ---------------------------------------------------------------------------
// curves
// ---------------------------------------------------------------------------

function limits(S: FiberSection): AxialLimits {
  const Po = 0.85 * S.fc * (S.Ag - S.Ast) + S.fy * S.Ast;
  return { Po, PnMax: PN_MAX_FACTOR * Po, PntMax: -S.fy * S.Ast };
}

/**
 * Analytic axial endpoints, 22.4.2.2 / 22.4.2.1 / 22.4.3.1 — the expressions are
 * identical in ACI 318-19 and ACI 318M-19, so only the reported unit changes
 * (kip | kN).
 */
export function axialLimits(w: WallInput): AxialLimits {
  return reportLimits(schemeOf(w), limits(nominal(w)));
}

/** The pure-tension endpoint: c = 0, all steel yielded, no concrete. */
function tensionEnd(S: FiberSection): SectionPoint {
  return {
    c: 0,
    Pn: limits(S).PntMax,
    Mn: 0,
    // the strain profile degenerates at c = 0 — every bar is yielded in tension
    epsT: Number.POSITIVE_INFINITY,
    phi: PHI_TENSION,
  };
}

/**
 * The nominal P–M curve, from pure tension to pure compression.
 *
 * `points[0]` is the analytic pure-tension endpoint (Pnt,max, M = 0) at c = 0;
 * the remaining points sweep c **geometrically** from ℓ_w/1000 up to the c at
 * which Pn reaches Po exactly, so the last point is the analytic pure-compression
 * endpoint (Po, M = 0). Geometric spacing concentrates points at small c where
 * the tension-controlled branch turns sharply, and thins them out along the
 * nearly straight compression branch.
 */
export function interactionCurve(w: WallInput, opts: CurveOptions = {}): SectionPoint[] {
  const U = schemeOf(w);
  return canonicalCurve(nominal(w), opts).map((p) => reportPoint(U, p));
}

/** The sweep itself, always in the canonical kip/in/kip-ft system. */
function canonicalCurve(S: FiberSection, opts: CurveOptions): SectionPoint[] {
  const n = Math.max(3, Math.trunc(opts.points ?? 200));
  const out: SectionPoint[] = new Array(n);
  out[0] = tensionEnd(S);
  // Solver tolerance, not a unit conversion: the smallest c the sweep starts
  // from, a thousandth of the wall length. Unchanged in SI mode.
  const cMin = S.lw / 1000;
  const ratio = S.cFull / cMin;
  const last = n - 2;
  for (let i = 0; i <= last; i++) {
    out[i + 1] = pointAt(S, cMin * Math.pow(ratio, i / last));
  }
  return out;
}

/**
 * The design curve: φPn, φMn with φ from Table 21.2.2 applied to **both** Pn and
 * Mn, then the 22.4.2.1 axial cap `φPn ≤ φ·0.80·Po` imposed as a horizontal
 * cutoff. φ in the cap is the compression-controlled value 0.65 (11.4.2.1), so
 * the cutoff sits at 0.65·0.80·Po regardless of where on the curve it lands.
 */
export function designCurve(w: WallInput, opts: CurveOptions = {}): DesignPoint[] {
  const S = nominal(w);
  const U = schemeOf(w);
  const cap = PHI_COMPRESSION * limits(S).PnMax;
  // The cap comparison is done canonically, then the whole point is moved into
  // the reporting system, so the cutoff lands at exactly the same physical load
  // in both editions.
  return canonicalCurve(S, opts).map((p) => {
    const phiPn = p.phi * p.Pn;
    const capped = phiPn > cap;
    return reportDesignPoint(U, {
      c: p.c,
      phiPn: capped ? cap : phiPn,
      phiMn: p.phi * p.Mn,
      epsT: p.epsT,
      phi: p.phi,
      capped,
    });
  });
}

// ---------------------------------------------------------------------------
// root finding
// ---------------------------------------------------------------------------

const SCAN_POINTS = 512;
const BISECT_STEPS = 80;

/**
 * All c > 0 with `of(point(c)) = target`.
 *
 * Pn(c) is *almost* monotone increasing but steps down by 0.85 f'c·A_s each time
 * the stress block sweeps past a bar station, and φ(c)Pn(c) inherits those steps,
 * so a plain monotone bisection can miss or land on a discontinuity. Instead we
 * scan a geometric grid spanning the whole physical range, bisect every sign
 * change, and hand every root back to the caller to disambiguate.
 */
function rootsOf(S: FiberSection, target: number, of: (p: SectionPoint) => number): number[] {
  const lo = S.lw * 1e-9;
  const hi = S.cFull;
  const ratio = hi / lo;
  const roots: number[] = [];

  let cPrev = lo;
  let vPrev = of(pointAt(S, cPrev));
  for (let i = 1; i < SCAN_POINTS; i++) {
    const cNext = lo * Math.pow(ratio, i / (SCAN_POINTS - 1));
    const vNext = of(pointAt(S, cNext));
    if ((vPrev - target) * (vNext - target) <= 0 && vPrev !== vNext) {
      let a = cPrev;
      let b = cNext;
      const rising = vNext > vPrev;
      for (let k = 0; k < BISECT_STEPS; k++) {
        const mid = 0.5 * (a + b);
        const v = of(pointAt(S, mid));
        if (rising === v < target) a = mid;
        else b = mid;
      }
      roots.push(0.5 * (a + b));
    }
    cPrev = cNext;
    vPrev = vNext;
  }
  return roots;
}

const nominalPn = (p: SectionPoint): number => p.Pn;
const designPn = (p: SectionPoint): number => p.phi * p.Pn;

/**
 * Neutral axis depth at nominal moment strength for a given factored axial
 * force — i.e. the c that satisfies Pn(c) = Pu, with **no** φ applied. This is
 * the c that 18.10.6.2(a) asks for ("the largest neutral axis depth calculated
 * for the factored axial force and nominal moment strength"), hence the largest
 * root is returned when the small stress-block steps produce more than one.
 *
 * @param Pu factored axial force, **canonical kip**, compression positive
 * @returns c in the wall's reporting length unit (in | mm)
 */
export function cAt(w: WallInput, Pu: number): number {
  const S = nominal(w);
  const U = schemeOf(w);
  const roots = rootsOf(S, Pu, nominalPn);
  if (roots.length === 0) {
    const lim = reportLimits(U, limits(S));
    throw new Error(
      `cAt: Pu = ${U.frc(Pu)} ${U.force} is outside the nominal axial range [${lim.PntMax.toFixed(1)}, ${lim.Po.toFixed(1)}] ${U.force}`,
    );
  }
  return U.len(Math.max(...roots));
}

/**
 * Probable flexural strength M_pr at a given axial force: the nominal moment
 * recomputed with f_y replaced by 1.25 f_y and φ = 1.0 (18.10.5, R18.10.3.1 —
 * the Ω_v numerator of Table 18.10.3.1.2).
 *
 * The overstrength applies to the yield *stress* only; E_s is unchanged, so the
 * steel simply yields at a 25 % higher strain. Equilibrium is re-solved on the
 * overstrength section, so c(M_pr) ≠ c(M_n) at the same Pu.
 *
 * @param Pu factored axial force, **canonical kip**, compression positive
 * @returns M_pr in the wall's reporting moment unit (kip-ft | kN·m)
 */
export function mprAt(w: WallInput, Pu: number): number {
  const S = probable(w);
  const U = schemeOf(w);
  const roots = rootsOf(S, Pu, nominalPn);
  if (roots.length === 0) {
    const lim = reportLimits(U, limits(S));
    throw new Error(
      `mprAt: Pu = ${U.frc(Pu)} ${U.force} is outside the probable-strength axial range [${lim.PntMax.toFixed(1)}, ${lim.Po.toFixed(1)}] ${U.force}`,
    );
  }
  let best = Number.NEGATIVE_INFINITY;
  for (const c of roots) best = Math.max(best, pointAt(S, c).Mn);
  return U.mom(best);
}

/**
 * Design moment strength at a given axial force — the **vertical slice** through
 * the design interaction diagram, which is how a designer reads "φMn at Pu" off
 * a published P–M chart and how ACI's interaction spreadsheet reports it.
 *
 * φ varies along the curve, so the slice is taken on the φ-curve itself: find c
 * such that **φ(c)·Pn(c) = Pu**, then report φ(c)·Mn(c). (Solving Pn(c) = Pu and
 * factoring afterwards reads a *different*, lower point — it is the horizontal
 * distance to the nominal curve scaled by φ, not the design curve — and
 * undershoots the handbook by 2–5 %.)
 *
 * The 22.4.2.1 axial cap is deliberately **not** applied here: it is a separate
 * limit state, reported as its own sub-check by `checkFlexureAxial`.
 *
 * @param Pu factored axial force, **canonical kip**, compression positive
 * @returns φMn in the wall's reporting moment unit (kip-ft | kN·m); 0 when Pu
 *          lies outside the design axial range
 */
export function phiMnAt(w: WallInput, Pu: number): number {
  const S = nominal(w);
  const roots = rootsOf(S, Pu, designPn);
  if (roots.length === 0) return 0;
  let best = 0;
  for (const c of roots) {
    const p = pointAt(S, c);
    best = Math.max(best, p.phi * p.Mn);
  }
  return schemeOf(w).mom(best);
}

/**
 * The design point (c, ε_t, φ, φMn) that `phiMnAt` reports, in the wall's
 * reporting system (in/kip/kip-ft | mm/kN/kN·m).
 */
export interface DesignSlice {
  /** neutral axis depth, in | mm */
  c: number;
  /** nominal axial strength at the slice, kip | kN */
  Pn: number;
  /** nominal flexural strength at the slice, kip-ft | kN·m */
  Mn: number;
  epsT: number;
  phi: number;
  /** design flexural strength, kip-ft | kN·m */
  phiMn: number;
}

/**
 * As `phiMnAt`, but returning the whole governing point for tracing.
 *
 * @param Pu factored axial force, **canonical kip**, compression positive
 */
export function designSliceAt(w: WallInput, Pu: number): DesignSlice | undefined {
  const S = nominal(w);
  const U = schemeOf(w);
  const roots = rootsOf(S, Pu, designPn);
  let best: DesignSlice | undefined;
  for (const c of roots) {
    const p = pointAt(S, c);
    const phiMn = p.phi * p.Mn;
    if (best === undefined || phiMn > best.phiMn) {
      best = { c: p.c, Pn: p.Pn, Mn: p.Mn, epsT: p.epsT, phi: p.phi, phiMn };
    }
  }
  if (best === undefined) return undefined;
  return {
    c: U.len(best.c),
    Pn: U.frc(best.Pn),
    Mn: U.mom(best.Mn),
    epsT: best.epsT,
    phi: best.phi,
    phiMn: U.mom(best.phiMn),
  };
}

// ---------------------------------------------------------------------------
// traced section properties (`section.*`)
// ---------------------------------------------------------------------------

// Leaves and section-level derived nodes are memoized per WallInput, matching
// materials.ts / wall.ts: two checks that both report Po share one node, so trace
// ids stay unique when check graphs are merged.
const sectionNodes = new WeakMap<WallInput, Map<string, Traced>>();

function memo(w: WallInput, id: string, make: () => Traced): Traced {
  let byId = sectionNodes.get(w);
  if (byId === undefined) {
    byId = new Map();
    sectionNodes.set(w, byId);
  }
  let node = byId.get(id);
  if (node === undefined) {
    node = make();
    byId.set(id, node);
  }
  return node;
}

/** Total vertical steel from the resolved bar layout. */
export function AstInput(w: WallInput): Traced {
  return memo(w, "section.Ast", () => {
    const S = nominal(w);
    const U = schemeOf(w);
    return input(
      "section.Ast",
      "A_st",
      "total area of vertical reinforcement",
      U.ar(S.Ast),
      U.area,
      `${S.n} bar stations along ℓ_w from the resolved layout`,
    );
  });
}

/**
 * Specified yield strength of the vertical reinforcement.
 *
 * Traced in ksi in the in-lb edition — the unit the P–M equilibrium below is
 * assembled in and the unit ACI 318-19 Chapter 20 tabulates grades in — and in
 * MPa in SI, where ACI 318M-19 20.2.2.4 names the grades by their MPa value
 * (Grade 420, Grade 550).
 */
export function fyInput(w: WallInput): Traced {
  return memo(w, "section.fy", () => {
    const U = schemeOf(w);
    return input(
      "section.fy",
      "f_y",
      "specified yield strength of reinforcement",
      U.si ? ksiToMPa(w.grade.fy) : w.grade.fy,
      U.si ? "MPa" : "ksi",
    );
  });
}

/** ε_ty per 21.2.2.1 — the φ threshold, not the material yield strain f_y/E_s. */
export function etyInput(w: WallInput): Traced {
  return memo(w, "section.ety", () =>
    input(
      "section.ety",
      "ε_ty",
      "yield strain of reinforcement",
      w.grade.ety,
      "1",
      // 21.2.2.1 is dimensionless and identical in both editions; only the
      // grade it names differs (Grade 60 / Grade 420).
      w.grade.ety === 0.002
        ? "0.002 permitted for Grade 60, 21.2.2.1"
        : w.grade.ety === 0.0021 && schemeOf(w).si
          ? "0.0021 permitted for Grade 420, ACI 318M-19 21.2.2.1"
          : "ε_ty = f_y/E_s, 21.2.2.1",
    ),
  );
}

/** Station of the extreme tension bar (in | mm) — the fiber ε_t is measured there. */
export function xtInput(w: WallInput): Traced {
  return memo(w, "section.x_t", () => {
    const U = schemeOf(w);
    return input(
      "section.x_t",
      "x_t",
      "station of the extreme tension reinforcement",
      U.len(nominal(w).xt),
      U.length,
      "measured from the extreme compression fiber at x = 0",
    );
  });
}

/**
 * The f'c leaf the P–M nodes hang off — the seam between the stress unit the
 * Code is *written* in and the stress unit the equilibrium is *assembled* in.
 *
 * `materials.fcInput` traces f'c in the unit of the edition in force, because
 * that is what every strength expression consuming it is printed in: psi in
 * ACI 318-19, MPa in ACI 318M-19.
 *
 * **in-lb** — the fiber solver is assembled in kip/in/ksi, so there is a real
 * psi → ksi step between the leaf and the equilibrium. It gets its own node
 * rather than happening silently: `f'_c = f'_{c,psi}/1000`.
 *
 * **SI** — there is no such step to narrate. The solver is *still* assembled in
 * the canonical ksi (see the module header — nothing in it is edition-specific
 * beyond β1), but that is a private implementation detail, not Code content:
 * ACI 318M-19 writes f'c in MPa and every reported value on this path is in MPa,
 * mm and kN. Emitting a ksi node here would put an in-lb unit tag in the middle
 * of a metric graph and would invite a reader to treat the ksi number as
 * something the metric Code says. So in SI the MPa leaf *is* the node, and the
 * ksi the solver runs on never surfaces in the trace. This is why the function
 * is no longer named for the unit it returns.
 */
export function fcKsi(w: WallInput): Traced {
  const U = schemeOf(w);
  if (U.si) return fcInput(w.concrete, U);
  return memo(w, "section.fc_ksi", () => {
    const fc = fcInput(w.concrete, U);
    return derive({
      id: "section.fc_ksi",
      symbol: "f'_c",
      label: "specified concrete compressive strength",
      value: w.concrete.fc,
      unit: "ksi",
      // The fiber solver assembles P–M equilibrium in the canonical kip/in/ksi
      // system in both editions, so this node is the declared seam between the
      // stress unit the Code prints (psi | MPa) and the unit the solver uses.
      // It is the one node in an SI trace that carries an imperial tag, and it
      // says so explicitly rather than silently changing units mid-graph.
      formula: U.si ? "f'_c = f'_{c,\\text{MPa}}/6.894757" : "f'_c = f'_{c,\\text{psi}}/1000",
      substitution: U.si
        ? `f'_c = ${fmtTex(ksiToMPa(w.concrete.fc))}/6.894757 = ${fmtTex(w.concrete.fc, { dp: 2 })}\\ \\text{ksi}`
        : `f'_c = ${fmtTex(ksiToPsi(w.concrete.fc))}/1000 = ${fmtTex(w.concrete.fc, { dp: 2 })}\\ \\text{ksi}`,
      inputs: [fc],
      // The in-lb trace is unchanged from before SI mode existed (it is
      // snapshotted), so the seam note is emitted only where it is news.
      ...(U.si
        ? {
            note: "unit seam: the P–M equilibrium is assembled in the canonical kip/in/ksi system in both editions, so f'_c is carried into the solver in ksi; every ACI 318M coefficient consumed elsewhere is applied in MPa",
          }
        : {}),
    });
  });
}

/**
 * Eq. (22.4.2.2): Po = 0.85 f'c (A_g − A_st) + f_y A_st.
 *
 * The expression and the 0.85 are identical in ACI 318-19 and ACI 318M-19
 * 22.4.2.2 — it is homogeneous, so there is nothing to reround. Only the system
 * it is evaluated in changes: ksi × in² → kip in-lb, MPa × mm² → N (÷1000 → kN)
 * in SI, exactly the ÷1000 the in-lb psi × in² → kip assembly uses elsewhere.
 */
export function Po(w: WallInput): Traced {
  return memo(w, "section.Po", () => {
    const U = schemeOf(w);
    const fc = fcKsi(w);
    const ag = Ag(w);
    const ast = AstInput(w);
    const fy = fyInput(w);
    const value = U.frc(limits(nominal(w)).Po);
    const fcCode = U.si ? ksiToMPa(w.concrete.fc) : w.concrete.fc;
    const fyCode = U.si ? ksiToMPa(w.grade.fy) : w.grade.fy;
    const AstCode = U.ar(nominal(w).Ast);
    const assembled = U.si
      ? `${fmtTex(value * 1000)}\\ \\text{N} = ${fmtTex(value)}\\ ${U.forceTex}`
      : `${fmtTex(value)}\\ ${U.forceTex}`;
    return derive({
      id: "section.Po",
      symbol: "P_o",
      label: "nominal axial strength at zero eccentricity",
      value,
      unit: U.force,
      formula: "P_o = 0.85 f'_c (A_g - A_{st}) + f_y A_{st}",
      substitution:
        `P_o = 0.85 \\times ${fmtTex(fcCode, { dp: 2 })} \\times (${fmtTex(ag.value)} - ${fmtTex(AstCode, { dp: 2 })})` +
        ` + ${fmtTex(fyCode, { dp: 1 })} \\times ${fmtTex(AstCode, { dp: 2 })} = ${assembled}`,
      ref: aci("22.4.2.2", "22.4.2.2"),
      inputs: [fc, ag, ast, fy],
      note: U.si ? "MPa × mm² → N, reported in kN" : undefined,
    });
  });
}

/**
 * 22.4.2.1 / Table 22.4.2.1: Pn,max = 0.80 Po for tied members.
 * The 0.80 is dimensionless and identical in both editions.
 */
export function PnMax(w: WallInput): Traced {
  return memo(w, "section.Pn_max", () => {
    const U = schemeOf(w);
    const po = Po(w);
    const value = U.frc(limits(nominal(w)).PnMax);
    return derive({
      id: "section.Pn_max",
      symbol: "P_{n,max}",
      label: "maximum nominal axial compressive strength",
      value,
      unit: U.force,
      formula: "P_{n,max} = 0.80 P_o",
      substitution: `P_{n,max} = 0.80 \\times ${fmtTex(po.value)} = ${fmtTex(value)}\\ ${U.forceTex}`,
      ref: aci("22.4.2.1"),
      inputs: [po],
      note: "tied (non-spiral) member — walls",
    });
  });
}

/**
 * Eq. (22.4.3.1): Pnt,max = f_y A_st, reported negative (tension).
 * Homogeneous — identical in ACI 318-19 and ACI 318M-19 22.4.3.1.
 */
export function PntMax(w: WallInput): Traced {
  return memo(w, "section.Pnt_max", () => {
    const U = schemeOf(w);
    const fy = fyInput(w);
    const ast = AstInput(w);
    const value = U.frc(limits(nominal(w)).PntMax);
    const fyCode = U.si ? ksiToMPa(w.grade.fy) : w.grade.fy;
    const AstCode = U.ar(nominal(w).Ast);
    const assembled = U.si
      ? `${fmtTex(value * 1000)}\\ \\text{N} = ${fmtTex(value)}\\ ${U.forceTex}`
      : `${fmtTex(value)}\\ ${U.forceTex}`;
    return derive({
      id: "section.Pnt_max",
      symbol: "P_{nt,max}",
      label: "maximum nominal axial tensile strength",
      value,
      unit: U.force,
      formula: "P_{nt,max} = -f_y A_{st}",
      substitution: `P_{nt,max} = -${fmtTex(fyCode, { dp: 1 })} \\times ${fmtTex(AstCode, { dp: 2 })} = ${assembled}`,
      ref: aci("22.4.3.1", "22.4.3.1"),
      inputs: [fy, ast],
      note: U.si
        ? "compression positive, so the tension cap is negative; MPa × mm² → N, reported in kN"
        : "compression positive, so the tension cap is negative",
    });
  });
}
