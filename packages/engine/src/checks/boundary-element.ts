/**
 * ACI 318-19 §18.10.6 — special boundary elements (SBE).
 *
 * Three pieces:
 *   - `sbeRequirement` / `checkSbeRequired` — 18.10.6.1 method selection and the
 *     18.10.6.2(a) displacement-based or 18.10.6.3 stress-based trigger.
 *   - `checkSbeDetailing` — 18.10.6.4(a)–(g) verification of the **provided**
 *     boundary element, or the 18.10.6.5(b) tie rules when no SBE is required.
 *   - `sigmaExtreme` — the linear-elastic gross-section extreme-fiber stress
 *     shared by the stress-based trigger.
 *
 * The engine never sizes a boundary element; the designer supplies `w.sbe` and
 * these checks verify it.
 */
import { BARS, fcInput } from "../materials";
import { cAt } from "../section/interaction";
import { aci, checkResult, constant, derive, input } from "../trace";
import type { CheckResult, Traced } from "../trace";
import { fmtTex, kipFtToKipIn, kipFtToKnM, kipToKn } from "../units";
import type { UnitScheme } from "../units";
import {
  Acv,
  Ag,
  barPositions,
  hInput,
  huInput,
  hwcsInput,
  hwcsOverLw,
  hwcsValue,
  lwInput,
  schemeOf,
} from "../wall";
import type { Demands, WallInput } from "../wall";

const TOL = 1e-9;

const NS_REQ = "sbe.req";
const NS = "sbe";

/** 18.10.6.2(a) floor on the design drift ratio. */
const DRIFT_FLOOR = 0.005;

/** 18.10.6.2(b)(iii): the computed drift capacity need not be taken below this. */
const DRIFT_CAPACITY_FLOOR = 0.015;

/**
 * Trailing length unit for substitutions: `in.` (the abbreviation ACI writes for
 * inches) or `mm`. Both are derived from `U.lengthTex` so the two editions never
 * drift apart.
 */
function lenTexOf(U: UnitScheme): string {
  return U.si ? U.lengthTex : `${U.lengthTex}.`;
}

/** The same abbreviation as `lenTexOf`, for plain-prose `note:` strings. */
function lenWordOf(U: UnitScheme): string {
  return U.si ? "mm" : "in.";
}

/**
 * √f'c in the edition's own stress unit — psi^0.5 for ACI 318-19, MPa^0.5 for
 * ACI 318M-19. Local to this check so its whole trace graph is built in one
 * system (see `UnitScheme`).
 */
function sqrtFcLocal(w: WallInput, U: UnitScheme): Traced {
  const fc = fcInput(w.concrete, U);
  const value = U.sqrtFc(w.concrete.fc);
  return derive({
    id: `${NS}.sqrt_fc`,
    symbol: "√f'_c",
    label: "square root of the specified compressive strength",
    value,
    unit: U.stress,
    formula: "\\sqrt{f'_c}",
    substitution: `\\sqrt{${fmtTex(U.str(w.concrete.fc))}} = ${fmtTex(value, { dp: U.si ? 3 : 1 })}\\ ${U.stressTex}^{0.5}`,
    inputs: [fc],
  });
}

export interface SbeRequirement {
  /** which of 18.10.6.2 / 18.10.6.3 governs, per 18.10.6.1 */
  method: "displacement" | "stress";
  required: boolean;
  /**
   * largest neutral axis depth at M_n over the supplied demands, in the wall's
   * reporting length unit (in | mm — `cAt` already returns it converted)
   */
  c: number;
  cNode: Traced;
  /** δ_u/h_wcs after the 0.005 floor — displacement path only */
  driftDemand?: Traced;
  /** 1.5 δ_u/h_wcs — displacement path only */
  driftDemand15?: Traced;
  /** extreme-fiber stress — stress path only */
  sigma?: Traced;
  trigger: Traced<boolean>;
  trace: Traced<any>[];
}

// Both checks below need the same trigger nodes; memoize so the two trace
// graphs share node objects instead of colliding on duplicate ids.
const requirements = new WeakMap<WallInput, WeakMap<Demands, SbeRequirement>>();

export function sbeRequirement(w: WallInput, demand: Demands): SbeRequirement {
  let byDemand = requirements.get(w);
  if (byDemand === undefined) {
    byDemand = new WeakMap();
    requirements.set(w, byDemand);
  }
  const hit = byDemand.get(demand);
  if (hit !== undefined) return hit;
  const built = buildRequirement(w, demand);
  byDemand.set(demand, built);
  return built;
}

/**
 * Largest neutral axis depth at nominal moment strength over the supplied
 * demands — 18.10.6.2(a) asks for "the largest neutral axis depth calculated for
 * the factored axial force and nominal moment strength consistent with δ_u",
 * which in practice means the E combination with the largest compression.
 */
function neutralAxis(w: WallInput): Traced {
  const U = schemeOf(w);
  let best = Number.NEGATIVE_INFINITY;
  let governing = "";
  for (const d of w.demands) {
    let c: number;
    try {
      c = cAt(w, d.Pu);
    } catch {
      continue;
    }
    if (c > best) {
      best = c;
      governing = d.label ?? d.id;
    }
  }
  if (!Number.isFinite(best)) {
    throw new Error(
      "boundary-element: no supplied demand has an axial force within the section's nominal axial range",
    );
  }
  const PuGoverning = w.demands.find((d) => (d.label ?? d.id) === governing)?.Pu ?? 0;
  const Pu = input(
    `${NS_REQ}.Pu_c`,
    "P_u",
    "factored axial force governing the neutral axis depth",
    U.frc(PuGoverning),
    U.force,
    `largest c over the supplied demands — governed by "${governing}"`,
  );
  return derive({
    id: `${NS_REQ}.c`,
    symbol: "c",
    label: "neutral axis depth at nominal moment strength",
    // `cAt` already returns c in the wall's reporting length unit (in | mm).
    value: best,
    unit: U.length,
    formula: "\\text{solve } P_n(c) = P_u \\quad (\\varepsilon_{cu} = 0.003,\\ a = \\beta_1 c)",
    substitution: `P_n(c) = ${fmtTex(U.frc(PuGoverning))}\\ ${U.forceTex} \\Rightarrow c = ${fmtTex(best, { dp: U.si ? 1 : 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.2", "18.10.6.2a"),
    inputs: [Pu],
    note: `largest neutral axis depth over the supplied load combinations (governing combination: ${governing}); no φ is applied — this is the nominal-strength c`,
  });
}

/** σ = P_u/A_g + M_u (ℓ_w/2)/I_g — linear-elastic gross section, 18.10.6.3. */
export function sigmaExtreme(w: WallInput, demand: Demands): Traced {
  const U = schemeOf(w);
  const ag = Ag(w);
  const h = hInput(w);
  const lw = lwInput(w);
  // The section properties are assembled in the local system (in⁴ / mm⁴), never
  // by converting an in-lb stress — ACI 318M-19 18.10.6.3 is evaluated in MPa.
  const IgValue = (h.value * lw.value ** 3) / 12;
  const Ig = derive({
    id: `${NS_REQ}.Ig`,
    symbol: "I_g",
    label: "gross moment of inertia about the strong axis",
    value: IgValue,
    unit: U.section4,
    formula: "I_g = \\dfrac{h\\,\\ell_w^3}{12}",
    substitution: `\\dfrac{${fmtTex(h.value, { dp: 1 })} \\times ${fmtTex(lw.value)}^3}{12} = ${fmtTex(IgValue)}\\ ${U.lengthTex}^4`,
    inputs: [h, lw],
  });
  const yValue = lw.value / 2;
  const y = derive({
    id: `${NS_REQ}.y`,
    symbol: "y",
    label: "distance from the centroid to the extreme compression fiber",
    value: yValue,
    unit: U.length,
    formula: "y = \\ell_w/2",
    substitution: `y = ${fmtTex(lw.value)}/2 = ${fmtTex(yValue, { dp: 1 })}\\ ${lenTexOf(U)}`,
    inputs: [lw],
    note: "gross rectangular section: the extreme fiber is ℓ_w/2 from the centroid",
  });

  const Pu = input(
    `${NS_REQ}.Pu_sigma`,
    "P_u",
    `factored axial force (${demand.label ?? demand.id})`,
    U.frc(demand.Pu),
    U.force,
  );
  const Mu = input(
    `${NS_REQ}.Mu_sigma`,
    "M_u",
    `factored in-plane moment (${demand.label ?? demand.id})`,
    U.mom(Math.abs(demand.Mu)),
    U.moment,
  );

  // The stress is formed in the base units of the edition:
  //   in-lb — P_u in lb over A_g in in², M_u in lb-in. over I_g in in⁴ → psi
  //   ACI 318M-19 18.10.6.3 — P_u in N over A_g in mm², M_u in N·mm over I_g in
  //   mm⁴ → MPa (1 kN·m = 10⁶ N·mm).
  const PuBase = U.si ? kipToKn(demand.Pu) * 1000 : demand.Pu * 1000;
  const MuBase = U.si
    ? kipFtToKnM(Math.abs(demand.Mu)) * 1e6
    : kipFtToKipIn(Math.abs(demand.Mu)) * 1000;
  const axial = PuBase / ag.value;
  const flex = (MuBase * yValue) / IgValue;
  return derive({
    id: `${NS_REQ}.sigma`,
    symbol: "σ",
    label: "extreme-fiber compressive stress on the gross section",
    value: axial + flex,
    unit: U.stress,
    formula: "\\sigma = \\dfrac{P_u}{A_g} + \\dfrac{M_u\\,y}{I_g}",
    substitution:
      `\\dfrac{${fmtTex(PuBase)}}{${fmtTex(ag.value)}} + \\dfrac{${fmtTex(MuBase)} \\times ${fmtTex(yValue, { dp: 1 })}}{${fmtTex(IgValue)}} = ` +
      `${fmtTex(axial)} + ${fmtTex(flex)} = ${fmtTex(axial + flex)}\\ ${U.stressTex}`,
    ref: aci("18.10.6.3"),
    inputs: [Pu, ag, Mu, y, Ig],
    note: U.si
      ? "linear-elastic gross-section model including E (ACI 318M-19 18.10.6.3); P_u in kN and M_u in kN·m are converted to N and N·mm so the stress lands in MPa"
      : "linear-elastic gross-section model including E (18.10.6.3); P_u in kip and M_u in kip-ft are converted to lb and lb-in. so the stress lands in psi",
  });
}

function buildRequirement(w: WallInput, demand: Demands): SbeRequirement {
  const ratio = hwcsOverLw(w);
  const cNode = neutralAxis(w);
  const displacement = ratio.value >= 2 - TOL;

  const method = derive<string>({
    id: `${NS_REQ}.method`,
    symbol: "method",
    label: "boundary element evaluation method",
    value: displacement ? "18.10.6.2 (displacement-based)" : "18.10.6.3 (stress-based)",
    unit: "1",
    formula: "h_{wcs}/\\ell_w \\ge 2.0 \\Rightarrow \\text{18.10.6.2, else 18.10.6.3}",
    substitution: `h_{wcs}/\\ell_w = ${fmtTex(ratio.value, { dp: 3 })} \\Rightarrow ${displacement ? "\\text{18.10.6.2}" : "\\text{18.10.6.3}"}`,
    ref: aci("18.10.6.1"),
    inputs: [ratio],
    note: "18.10.6.2 also requires the wall to be continuous from base to top with a single critical section — assumed by this engine, which models one section of one continuous wall",
  });

  return displacement
    ? displacementPath(w, method, cNode)
    : stressPath(w, demand, method, cNode);
}

function displacementPath(w: WallInput, method: Traced<string>, cNode: Traced): SbeRequirement {
  const U = schemeOf(w);
  const lw = lwInput(w);
  const hwcs = hwcsInput(w);
  const Cd = w.seismic?.Cd;
  const deltaE = w.seismic?.deltaE;
  const haveDisplacement = Cd !== undefined && deltaE !== undefined;

  const floor = constant(
    `${NS_REQ}.drift_floor`,
    "0.005",
    "lower bound on the design drift ratio",
    DRIFT_FLOOR,
    "1",
    aci("18.10.6.2", "18.10.6.2a"),
  );

  let driftRaw: Traced;
  let deltaU: Traced | undefined;
  if (haveDisplacement) {
    const CdNode = input(`${NS_REQ}.Cd`, "C_d", "deflection amplification factor (ASCE 7)", Cd, "1");
    const deltaENode = input(
      `${NS_REQ}.delta_e`,
      "δ_e",
      "elastic deflection at the top of the wall",
      U.len(deltaE),
      U.length,
    );
    const deltaUValue = Cd * U.len(deltaE);
    deltaU = derive({
      id: `${NS_REQ}.delta_u`,
      symbol: "δ_u",
      label: "design displacement",
      value: deltaUValue,
      unit: U.length,
      formula: "\\delta_u = C_d\\,\\delta_e",
      substitution: `${fmtTex(Cd, { dp: 2 })} \\times ${fmtTex(U.len(deltaE), { dp: 2 })} = ${fmtTex(deltaUValue, { dp: 2 })}\\ ${lenTexOf(U)}`,
      ref: aci("18.10.6.2"),
      inputs: [CdNode, deltaENode],
      note: "δ_u is the design displacement of ASCE 7, C_d δ_e",
    });
    driftRaw = derive({
      id: `${NS_REQ}.drift_raw`,
      symbol: "δ_u/h_wcs",
      label: "computed design drift ratio",
      // δ_u/h_wcs is a ratio, identical in both editions; it is assembled from
      // the already-converted leaves so the substitution reads consistently.
      value: deltaUValue / hwcs.value,
      unit: "1",
      formula: "\\delta_u/h_{wcs}",
      substitution: `${fmtTex(deltaUValue, { dp: 2 })} / ${fmtTex(hwcs.value)} = ${fmtTex(deltaUValue / hwcs.value, { dp: 5 })}`,
      ref: aci("18.10.6.2", "18.10.6.2a"),
      inputs: [deltaU, hwcs],
    });
  } else {
    driftRaw = derive({
      id: `${NS_REQ}.drift_raw`,
      symbol: "δ_u/h_wcs",
      label: "computed design drift ratio",
      value: 0,
      unit: "1",
      formula: "\\delta_u/h_{wcs} = C_d\\,\\delta_e/h_{wcs}",
      substitution: "C_d\\ \\text{and}\\ \\delta_e\\ \\text{were not supplied}",
      ref: aci("18.10.6.2", "18.10.6.2a"),
      inputs: [hwcs],
      status: "warning",
      note: "the design displacement is unknown, so the trigger is evaluated at the 0.005 floor of 18.10.6.2(a) only — a fired trigger is conclusive, a clear one is not",
    });
  }

  const floorGoverns = driftRaw.value < DRIFT_FLOOR;
  const driftValue = Math.max(driftRaw.value, DRIFT_FLOOR);
  const drift = derive({
    id: `${NS_REQ}.drift`,
    symbol: "δ_u/h_wcs",
    label: "design drift ratio used in the trigger",
    value: driftValue,
    unit: "1",
    formula: "\\delta_u/h_{wcs} \\ge 0.005",
    substitution: `\\max(${fmtTex(driftRaw.value, { dp: 5 })},\\ 0.005) = ${fmtTex(driftValue, { dp: 5 })}`,
    ref: aci("18.10.6.2", "18.10.6.2a"),
    inputs: [driftRaw, floor],
    note: floorGoverns ? "the 0.005 floor governs" : "the computed drift ratio governs the 0.005 floor",
  });

  const lhs = derive({
    id: `${NS_REQ}.drift_15`,
    symbol: "1.5δ_u/h_wcs",
    label: "amplified design drift ratio",
    value: 1.5 * driftValue,
    unit: "1",
    formula: "1.5\\,\\delta_u/h_{wcs}",
    substitution: `1.5 \\times ${fmtTex(driftValue, { dp: 5 })} = ${fmtTex(1.5 * driftValue, { dp: 5 })}`,
    ref: aci("18.10.6.2", "18.10.6.2a"),
    inputs: [drift],
  });

  const coeff = constant(
    `${NS_REQ}.limit_coeff`,
    "600",
    "coefficient of the 18.10.6.2(a) limit",
    600,
    "1",
    aci("18.10.6.2", "18.10.6.2a"),
  );
  // 18.10.6.2(a) is dimensionless and identical in ACI 318M-19 18.10.6.2(a);
  // ℓ_w and c are both taken in the local system so the ratio is unchanged.
  const rhsValue = lw.value / (600 * cNode.value);
  const rhs = derive({
    id: `${NS_REQ}.limit`,
    symbol: "ℓ_w/(600c)",
    label: "drift ratio at which a special boundary element becomes required",
    value: rhsValue,
    unit: "1",
    formula: "\\dfrac{\\ell_w}{600\\,c}",
    substitution: `\\dfrac{${fmtTex(lw.value)}}{600 \\times ${fmtTex(cNode.value, { dp: U.si ? 1 : 2 })}} = ${fmtTex(rhsValue, { dp: 5 })}`,
    ref: aci("18.10.6.2", "18.10.6.2a"),
    inputs: [lw, coeff, cNode],
  });

  const required = 1.5 * driftValue >= rhsValue - TOL;
  const trigger = derive<boolean>({
    id: `${NS_REQ}.required`,
    symbol: "SBE req'd",
    label: "special boundary element required",
    value: required,
    unit: "1",
    formula: "1.5\\,\\delta_u/h_{wcs} \\ge \\dfrac{\\ell_w}{600\\,c}",
    substitution: `${fmtTex(1.5 * driftValue, { dp: 5 })} ${required ? "\\ge" : "<"} ${fmtTex(rhsValue, { dp: 5 })} \\Rightarrow \\text{${required}}`,
    ref: aci("18.10.6.2", "18.10.6.2a"),
    inputs: [lhs, rhs, method],
    note: required
      ? "18.10.6.2(a): special boundary elements are required at both ends of the wall over the extent of 18.10.6.2(b)(i)"
      : "18.10.6.2(a): no special boundary element required — 18.10.6.5 applies instead",
  });

  return {
    method: "displacement",
    required,
    c: cNode.value,
    cNode,
    driftDemand: drift,
    driftDemand15: lhs,
    trigger,
    trace: [method, drift, lhs, rhs, trigger],
  };
}

function stressPath(
  w: WallInput,
  demand: Demands,
  method: Traced<string>,
  cNode: Traced,
): SbeRequirement {
  const U = schemeOf(w);
  const sigma = sigmaExtreme(w, demand);
  // The 0.2f'c trigger and 0.15f'c release of 18.10.6.3 are ratios of stresses
  // and are unchanged in ACI 318M-19 18.10.6.3 — only the stress unit the nodes
  // carry differs (psi / MPa).
  const fcCode = U.str(w.concrete.fc);

  const limitCoeff = constant(
    `${NS_REQ}.sigma_coeff`,
    "0.2",
    "fraction of f'c triggering a special boundary element",
    0.2,
    "1",
    aci("18.10.6.3"),
  );
  const limit = derive({
    id: `${NS_REQ}.sigma_limit`,
    symbol: "0.2f'_c",
    label: "stress at which a special boundary element is required",
    value: 0.2 * fcCode,
    unit: U.stress,
    formula: "0.2\\,f'_c",
    substitution: `0.2 \\times ${fmtTex(fcCode)} = ${fmtTex(0.2 * fcCode)}\\ ${U.stressTex}`,
    ref: aci("18.10.6.3"),
    inputs: [limitCoeff, fcInput(w.concrete, U)],
  });

  const discCoeff = constant(
    `${NS_REQ}.sigma_disc_coeff`,
    "0.15",
    "fraction of f'c below which boundary elements may be discontinued",
    0.15,
    "1",
    aci("18.10.6.3"),
  );
  const discontinue = derive({
    id: `${NS_REQ}.sigma_discontinue`,
    symbol: "0.15f'_c",
    label: "stress below which a special boundary element may be discontinued",
    value: 0.15 * fcCode,
    unit: U.stress,
    formula: "0.15\\,f'_c",
    substitution: `0.15 \\times ${fmtTex(fcCode)} = ${fmtTex(0.15 * fcCode)}\\ ${U.stressTex}`,
    ref: aci("18.10.6.3"),
    inputs: [discCoeff, limit],
    note: "informational: boundary elements may be discontinued where the stress falls below 0.15f'c (18.10.6.3)",
  });

  const required = sigma.value > limit.value + TOL;
  const trigger = derive<boolean>({
    id: `${NS_REQ}.required`,
    symbol: "SBE req'd",
    label: "special boundary element required",
    value: required,
    unit: "1",
    formula: "\\sigma > 0.2\\,f'_c",
    substitution: `${fmtTex(sigma.value)} ${required ? ">" : "\\le"} ${fmtTex(limit.value)} \\Rightarrow \\text{${required}}`,
    ref: aci("18.10.6.3"),
    inputs: [sigma, limit, method],
    note: required
      ? "18.10.6.3: the extreme-fiber compressive stress exceeds 0.2f'c"
      : "18.10.6.3: the extreme-fiber compressive stress is at or below 0.2f'c — 18.10.6.5 applies instead",
  });

  return {
    method: "stress",
    required,
    c: cNode.value,
    cNode,
    sigma,
    trigger,
    trace: [method, sigma, limit, discontinue, trigger],
  };
}

/**
 * 18.10.6.1 method selection plus the governing SBE trigger.
 *
 * This check reports **whether** a special boundary element is required; the
 * verification of the provided element is `checkSbeDetailing`.
 */
export function checkSbeRequired(w: WallInput, demand: Demands): CheckResult {
  const req = sbeRequirement(w, demand);
  const demandNode = req.method === "displacement" ? req.driftDemand15 : req.sigma;
  return checkResult({
    id: "sbe.required",
    title: "Special boundary element — requirement",
    ref: aci(req.method === "displacement" ? "18.10.6.2" : "18.10.6.3"),
    ...(demandNode !== undefined ? { demand: demandNode } : {}),
    trace: req.trace,
  });
}

// ---------------------------------------------------------------------------
// detailing
// ---------------------------------------------------------------------------

interface SubCheck {
  node: Traced;
  /** utilization contribution, or undefined for informational nodes */
  util?: number;
}

/**
 * 18.10.6.4 verification of the provided special boundary element, or the
 * 18.10.6.5(b) boundary-tie rules where no SBE is required.
 *
 * @param ve the amplified design shear V_e (18.10.3.1) — the drift-capacity
 *           equation of 18.10.6.2(b)(iii) is written in terms of V_e.
 */
export function checkSbeDetailing(w: WallInput, demand: Demands, ve: Traced): CheckResult {
  const req = sbeRequirement(w, demand);

  if (!req.required) return notRequired(w, demand, req);

  if (w.sbe === undefined) {
    const missing = derive<boolean>({
      id: `${NS}.provided`,
      symbol: "SBE provided",
      label: "special boundary element provided",
      value: false,
      unit: "1",
      formula: "\\text{SBE required} \\Rightarrow \\text{SBE must be provided}",
      substitution: "\\text{no boundary element is defined on the wall input}",
      ref: aci("18.10.6.4"),
      inputs: [req.trigger],
      status: "ng",
      note: "SBE required but none provided",
    });
    return checkResult({
      id: "sbe.detailing",
      title: "Special boundary element — detailing",
      ref: aci("18.10.6.4"),
      trace: [missing],
      status: "ng",
    });
  }

  const U = schemeOf(w);
  const lenWord = lenWordOf(U);
  const sbe = w.sbe;
  const lw = lwInput(w);
  const c = req.cNode;
  const subs: SubCheck[] = [];

  // Every length in this graph is carried in the local system (in / mm), so the
  // soft-converted limits of ACI 318M-19 18.10.6.4 can be compared directly.
  const bValue = U.len(sbe.width);
  const lbeValue = U.len(sbe.length);
  const b = input(`${NS}.b`, "b", "provided SBE width", bValue, U.length);
  const lbe = input(`${NS}.l_be`, "ℓ_be", "provided SBE length", lbeValue, U.length);

  // --- (a) horizontal length ------------------------------------------------
  const cMinus = derive({
    id: `${NS}.c_minus_01lw`,
    symbol: "c − 0.1ℓ_w",
    label: "first length requirement",
    value: c.value - 0.1 * lw.value,
    unit: U.length,
    formula: "c - 0.1\\,\\ell_w",
    substitution: `${fmtTex(c.value, { dp: 2 })} - 0.1 \\times ${fmtTex(lw.value)} = ${fmtTex(c.value - 0.1 * lw.value, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "18.10.6.4a"),
    inputs: [c, lw],
  });
  const cHalf = derive({
    id: `${NS}.c_over_2`,
    symbol: "c/2",
    label: "second length requirement",
    value: c.value / 2,
    unit: U.length,
    formula: "c/2",
    substitution: `${fmtTex(c.value, { dp: 2 })}/2 = ${fmtTex(c.value / 2, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "18.10.6.4a"),
    inputs: [c],
  });
  const lengthReqValue = Math.max(cMinus.value, cHalf.value);
  const lengthReq = derive({
    id: `${NS}.length_req`,
    symbol: "ℓ_be,min",
    label: "required SBE length from the extreme compression fiber",
    value: lengthReqValue,
    unit: U.length,
    formula: "\\ell_{be} \\ge \\max\\left(c - 0.1\\ell_w,\\ c/2\\right)",
    substitution: `\\max(${fmtTex(cMinus.value, { dp: 2 })},\\ ${fmtTex(cHalf.value, { dp: 2 })}) = ${fmtTex(lengthReqValue, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "18.10.6.4a"),
    inputs: [cMinus, cHalf],
  });
  subs.push(
    ratioNode(
      "length",
      "ℓ_be,min/ℓ_be",
      "SBE length utilization",
      lengthReq,
      lbe,
      "18.10.6.4",
      "the required length is measured from the extreme compression fiber and is driven by c, so it is sensitive to the interaction-diagram solution",
    ),
  );

  // --- (b) width: 18.10.6.2(b)(ii) √-path or (iii) drift-capacity path -------
  const width = widthPaths(w, bValue, req, ve, b, c);
  subs.push({ node: width.node, util: width.util });

  // --- 18.10.6.4(b) b ≥ h_u/16 ---------------------------------------------
  // b ≥ h_u/16 is a ratio of lengths and is identical in ACI 318M-19 18.10.6.4(b).
  const hu = huInput(w);
  const huReq = derive({
    id: `${NS}.b_hu16_req`,
    symbol: "h_u/16",
    label: "minimum SBE width from the unsupported height",
    value: hu.value / 16,
    unit: U.length,
    formula: "b \\ge h_u/16",
    substitution: `${fmtTex(hu.value)}/16 = ${fmtTex(hu.value / 16, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "18.10.6.4b"),
    inputs: [hu],
  });
  subs.push(ratioNode("b_hu16", "(h_u/16)/b", "SBE width utilization (h_u/16)", huReq, b, "18.10.6.4"));

  // --- 18.10.6.4(c) 12 in. / 300 mm floor for c/ℓ_w ≥ 3/8 ------------------
  const cOverLw = derive({
    id: `${NS}.c_over_lw`,
    symbol: "c/ℓ_w",
    label: "neutral axis depth ratio",
    value: c.value / lw.value,
    unit: "1",
    formula: "c/\\ell_w",
    substitution: `${fmtTex(c.value, { dp: 2 })} / ${fmtTex(lw.value)} = ${fmtTex(c.value / lw.value, { dp: 3 })}`,
    ref: aci("18.10.6.4", "18.10.6.4c"),
    inputs: [c, lw],
  });
  const applies12 = c.value / lw.value >= 3 / 8 - TOL;
  // 18.10.6.4(c) b ≥ 12 in.; ACI 318M-19 18.10.6.4(c) soft-converts it to 300 mm.
  const bFloor = U.si ? 300 : 12;
  const bFloorTex = `${fmtTex(bFloor)}\\ ${lenTexOf(U)}`;
  const floor12 = derive({
    id: `${NS}.b_12_util`,
    symbol: U.si ? "300 mm/b" : "12 in./b",
    label: U.si ? "SBE width utilization (300 mm floor)" : "SBE width utilization (12 in. floor)",
    value: applies12 ? bFloor / bValue : 0,
    unit: "1",
    formula: `b \\ge ${bFloorTex} \\quad (c/\\ell_w \\ge 3/8)`,
    substitution: applies12
      ? `${fmtTex(bFloor)} / ${fmtTex(bValue, { dp: 1 })} = ${fmtTex(bFloor / bValue, { dp: 3 })}`
      : `c/\\ell_w = ${fmtTex(c.value / lw.value, { dp: 3 })} < 3/8 \\Rightarrow \\text{does not apply}`,
    ref: aci("18.10.6.4", "18.10.6.4c"),
    inputs: [cOverLw, b],
    status: applies12 ? (bValue >= bFloor - TOL ? "ok" : "ng") : "na",
    note: applies12
      ? "18.10.6.4(c): h_w/ℓ_w ≥ 2.0, continuous wall with a single critical section, c/ℓ_w ≥ 3/8"
      : "18.10.6.4(c) applies only where c/ℓ_w ≥ 3/8",
  });
  subs.push({ node: floor12, ...(applies12 ? { util: floor12.value } : {}) });

  // --- 18.10.6.2(b)(i) vertical extent (informational) ---------------------
  subs.push({ node: verticalExtent(w, demand) });

  // --- (f) h_x -------------------------------------------------------------
  // 18.10.6.4(f) caps h_x at 14 in.; ACI 318M-19 18.10.6.4(f) soft-converts the
  // cap to 350 mm. The (2/3)b companion limit is a ratio and is unchanged.
  const hxValue = U.len(sbe.hx);
  const hxCapValue = U.si ? 350 : 14;
  const hxCapTex = `${fmtTex(hxCapValue)}\\ ${lenTexOf(U)}`;
  const hx = input(
    `${NS}.hx`,
    "h_x",
    "provided spacing of laterally supported bars",
    hxValue,
    U.length,
  );
  const hx14 = constant(
    `${NS}.hx_cap`,
    U.si ? "350 mm" : "14 in.",
    "absolute limit on h_x",
    hxCapValue,
    U.length,
    aci("18.10.6.4", "18.10.6.4f"),
  );
  const hxTwoThirds = derive({
    id: `${NS}.hx_two_thirds_b`,
    symbol: "(2/3)b",
    label: "width-based limit on h_x",
    value: (2 / 3) * bValue,
    unit: U.length,
    formula: "\\tfrac{2}{3}\\,b",
    substitution: `\\tfrac{2}{3} \\times ${fmtTex(bValue, { dp: 1 })} = ${fmtTex((2 / 3) * bValue, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "18.10.6.4f"),
    inputs: [b],
  });
  const hxMax = derive({
    id: `${NS}.hx_max`,
    symbol: "h_x,max",
    label: "maximum spacing of laterally supported longitudinal bars",
    value: Math.min(hxCapValue, (2 / 3) * bValue),
    unit: U.length,
    formula: `h_x \\le \\min\\left(${hxCapTex},\\ \\tfrac{2}{3}b\\right)`,
    substitution: `\\min(${fmtTex(hxCapValue)},\\ ${fmtTex((2 / 3) * bValue, { dp: 2 })}) = ${fmtTex(Math.min(hxCapValue, (2 / 3) * bValue), { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "18.10.6.4f"),
    inputs: [hx14, hxTwoThirds],
  });
  subs.push(ratioNode("hx", "h_x/h_x,max", "h_x utilization", hx, hxMax, "18.10.6.4", undefined, true));

  // --- (e)/(g) tie spacing --------------------------------------------------
  // 18.7.5.3: s_o = 4 + (14 − h_x)/3 with 4 in. ≤ s_o ≤ 6 in.; ACI 318M-19
  // 18.7.5.3 soft-converts every term — s_o = 100 + (350 − h_x)/3 with
  // 100 mm ≤ s_o ≤ 150 mm.
  const soBase = U.si ? 100 : 4;
  const soLo = soBase;
  const soHi = U.si ? 150 : 6;
  const soNum = hxCapValue;
  const soBaseTex = fmtTex(soBase);
  const soLoTex = `${fmtTex(soLo)}\\ ${lenTexOf(U)}`;
  const soHiTex = `${fmtTex(soHi)}\\ ${lenTexOf(U)}`;
  const soRaw = soBase + (soNum - hxValue) / 3;
  const soValue = Math.min(soHi, Math.max(soLo, soRaw));
  const so = derive({
    id: `${NS}.so`,
    symbol: "s_o",
    label: "spacing term of 18.7.5.3",
    value: soValue,
    unit: U.length,
    formula: `s_o = ${soBaseTex} + \\dfrac{${fmtTex(soNum)} - h_x}{3},\\quad ${soLoTex} \\le s_o \\le ${soHiTex}`,
    substitution: `${soBaseTex} + \\dfrac{${fmtTex(soNum)} - ${fmtTex(hxValue, { dp: 1 })}}{3} = ${fmtTex(soRaw, { dp: 2 })} \\Rightarrow s_o = ${fmtTex(soValue, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.7.5.3", "18.7.5.3"),
    inputs: [hx],
    // The bounds are whole numbers in both editions (4/6 in., 100/150 mm), so
    // they render without decimals — the in-lb note must stay "6 in.", not "6.00 in.".
    note:
      soRaw > soHi
        ? `clamped to the ${fmtTex(soHi, { dp: 0 })} ${lenWord} upper bound`
        : soRaw < soLo
          ? `clamped to the ${fmtTex(soLo, { dp: 0 })} ${lenWord} lower bound`
          : `within the ${fmtTex(soLo, { dp: 0 })}–${fmtTex(soHi, { dp: 0 })} ${lenWord} range`,
  });

  const leastDim = Math.min(bValue, lbeValue);
  const thirdDim = derive({
    id: `${NS}.least_dim_3`,
    symbol: "b_min/3",
    label: "one-third of the least SBE dimension",
    value: leastDim / 3,
    unit: U.length,
    formula: "\\min(b,\\ \\ell_{be})/3",
    substitution: `\\min(${fmtTex(bValue, { dp: 1 })},\\ ${fmtTex(lbeValue, { dp: 1 })})/3 = ${fmtTex(leastDim / 3, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "18.10.6.4e"),
    inputs: [b, lbe],
    note: "18.10.6.4(e) replaces the 18.7.5.3(a) column limit with one-third of the least boundary element dimension",
  });
  // 18.7.5.3(b) 6d_b is a multiple of a bar diameter — identical in ACI 318M-19
  // 18.7.5.3(b); only the diameter's unit changes.
  const dbLong = U.len(BARS[sbe.longBar].db);
  const sixDb = derive({
    id: `${NS}.six_db`,
    symbol: "6d_b",
    label: "six longitudinal bar diameters",
    value: 6 * dbLong,
    unit: U.length,
    formula: "6\\,d_b",
    substitution: `6 \\times ${fmtTex(dbLong, { dp: 3 })} = ${fmtTex(6 * dbLong, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.7.5.3", "18.7.5.3b"),
    inputs: [
      input(
        `${NS}.db_long`,
        "d_b",
        `diameter of the SBE longitudinal bar (No. ${sbe.longBar})`,
        dbLong,
        U.length,
      ),
    ],
  });
  const sReqValue = Math.min(thirdDim.value, sixDb.value, soValue);
  const sReq = derive({
    id: `${NS}.s_req`,
    symbol: "s_max",
    label: "maximum vertical spacing of SBE transverse reinforcement",
    value: sReqValue,
    unit: U.length,
    formula: "s \\le \\min\\left(b_{min}/3,\\ 6d_b,\\ s_o\\right)",
    substitution: `\\min(${fmtTex(thirdDim.value, { dp: 2 })},\\ ${fmtTex(sixDb.value, { dp: 2 })},\\ ${fmtTex(soValue, { dp: 2 })}) = ${fmtTex(sReqValue, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "18.10.6.4e"),
    inputs: [thirdDim, sixDb, so],
  });
  const sProv = input(`${NS}.s_prov`, "s", "provided tie spacing", U.len(sbe.tieSpacing), U.length);
  subs.push(ratioNode("s", "s/s_max", "tie spacing utilization", sProv, sReq, "18.10.6.4", undefined, true));

  // --- (g) confinement amount ----------------------------------------------
  subs.push(ashCheck(w, sbe, b, lbe, sProv));

  // --- aggregate ------------------------------------------------------------
  const contributing = subs.filter((s) => s.util !== undefined);
  const utilValue = Math.max(...contributing.map((s) => s.util!));
  const util = derive({
    id: `${NS}.utilization`,
    symbol: "governing",
    label: "governing SBE detailing utilization",
    value: utilValue,
    unit: "1",
    formula: "\\max(\\text{required}/\\text{provided})",
    substitution: `\\max(${contributing.map((s) => fmtTex(s.util!, { dp: 3 })).join(",\\ ")}) = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("18.10.6.4"),
    inputs: contributing.map((s) => s.node),
  });

  return checkResult({
    id: "sbe.detailing",
    title: "Special boundary element — detailing",
    ref: aci("18.10.6.4"),
    utilization: util,
    trace: [req.trigger, ...subs.map((s) => s.node), util],
  });
}

/**
 * Generic "required vs provided" node.
 *
 * @param inverted when true the first argument is the *provided* quantity and
 *                 the second the limit (spacing-style checks).
 */
function ratioNode(
  key: string,
  symbol: string,
  label: string,
  a: Traced,
  bNode: Traced,
  ref: string,
  note?: string,
  inverted = false,
): SubCheck {
  const req = a.value;
  const prov = bNode.value;
  const value = prov > 0 ? req / prov : Number.POSITIVE_INFINITY;
  const ok = inverted ? a.value <= bNode.value + TOL : bNode.value >= a.value - TOL;
  const node = derive({
    id: `${NS}.util_${key}`,
    symbol,
    label,
    value,
    unit: "1",
    formula: inverted ? "\\text{provided}/\\text{limit}" : "\\text{required}/\\text{provided}",
    substitution: `${fmtTex(req, { dp: 3 })} / ${fmtTex(prov, { dp: 3 })} = ${fmtTex(value, { dp: 3 })}`,
    ref: aci(ref),
    inputs: [a, bNode],
    status: ok ? "ok" : "ng",
    ...(note !== undefined ? { note } : {}),
  });
  return { node, util: value };
}

interface WidthResult {
  node: Traced;
  util: number;
}

/**
 * 18.10.6.2(b): the SBE width satisfies **either** (ii) b ≥ √(0.025 c ℓ_w) or
 * (iii) the drift-capacity check
 *
 *   δ_c/h_wcs = (1/100)[4 − (1/50)(ℓ_w/b)(c/b) − V_e/(8√f'c A_cv)] ≥ 1.5 δ_u/h_wcs
 *
 * with δ_c/h_wcs not taken less than 0.015. Both paths are always traced; the
 * check passes if either passes. On the stress-based path (18.10.6.3) neither
 * option exists — 18.10.6.2(b) is written for the displacement-based path — so
 * the sub-check reports "na" and only 18.10.6.4(b)/(c) constrain b.
 */
function widthPaths(
  w: WallInput,
  bValue: number,
  req: SbeRequirement,
  ve: Traced,
  b: Traced,
  c: Traced,
): WidthResult {
  const U = schemeOf(w);
  const lw = lwInput(w);

  const coeff = constant(
    `${NS}.b_sqrt_coeff`,
    "0.025",
    "coefficient of the 18.10.6.2(b)(ii) width requirement",
    0.025,
    "1",
    aci("18.10.6.2", "18.10.6.2b"),
  );
  // 18.10.6.2(b)(ii) b ≥ √(0.025 c ℓ_w) is written identically in ACI 318M-19
  // 18.10.6.2(b)(ii). The root mixes two lengths, so it is a length only when c
  // and ℓ_w are taken in the same unit as b — it is evaluated in mm in SI, never
  // by converting an inch result.
  const sqrtReqValue = Math.sqrt(0.025 * c.value * lw.value);
  const sqrtReq = derive({
    id: `${NS}.b_sqrt_req`,
    symbol: "√(0.025cℓ_w)",
    label: "SBE width required by 18.10.6.2(b)(ii)",
    value: sqrtReqValue,
    unit: U.length,
    formula: "b \\ge \\sqrt{0.025\\,c\\,\\ell_w}",
    substitution: `\\sqrt{0.025 \\times ${fmtTex(c.value, { dp: 2 })} \\times ${fmtTex(lw.value)}} = ${fmtTex(sqrtReqValue, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [coeff, c, lw],
  });
  const sqrtOk = bValue >= sqrtReqValue - TOL;
  const sqrtPath = derive({
    id: `${NS}.width_path_ii`,
    symbol: "b/√(0.025cℓ_w)",
    label: "width option (ii)",
    value: sqrtReqValue > 0 ? bValue / sqrtReqValue : Number.POSITIVE_INFINITY,
    unit: "1",
    formula: "b \\ge \\sqrt{0.025\\,c\\,\\ell_w}",
    substitution: `${fmtTex(bValue, { dp: 1 })} / ${fmtTex(sqrtReqValue, { dp: 2 })} = ${fmtTex(bValue / sqrtReqValue, { dp: 3 })}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [b, sqrtReq],
    note: sqrtOk ? "option (ii) is satisfied" : "option (ii) is not satisfied — option (iii) may still be used",
  });

  if (req.method === "stress" || req.driftDemand15 === undefined) {
    const node = derive({
      id: `${NS}.util_width`,
      symbol: "width option",
      label: "SBE width option (18.10.6.2(b))",
      value: 0,
      unit: "1",
      formula: "\\text{18.10.6.2(b) applies to the displacement-based path only}",
      substitution: "\\text{stress-based path (18.10.6.3)} \\Rightarrow \\text{no (ii)/(iii) width option}",
      ref: aci("18.10.6.2", "18.10.6.2b"),
      inputs: [sqrtPath, req.trigger],
      status: "na",
      note: "the √(0.025cℓ_w) and drift-capacity options of 18.10.6.2(b) belong to the displacement-based path; on the stress-based path only 18.10.6.4(b) and (c) constrain b",
    });
    return { node, util: 0 };
  }

  const drift = driftCapacityNode(w, bValue, ve, b, c);
  const demand15 = req.driftDemand15;
  const driftOk = drift.value >= demand15.value - TOL;

  const driftPath = derive({
    id: `${NS}.width_path_iii`,
    symbol: "1.5δ_u/h_wcs ÷ δ_c/h_wcs",
    label: "width option (iii), drift capacity",
    value: drift.value > 0 ? demand15.value / drift.value : Number.POSITIVE_INFINITY,
    unit: "1",
    formula: "\\delta_c/h_{wcs} \\ge 1.5\\,\\delta_u/h_{wcs}",
    substitution: `${fmtTex(demand15.value, { dp: 5 })} / ${fmtTex(drift.value, { dp: 5 })} = ${fmtTex(demand15.value / drift.value, { dp: 3 })}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [demand15, drift],
    note: driftOk ? "option (iii) is satisfied" : "option (iii) is not satisfied",
  });

  const ok = sqrtOk || driftOk;
  const utilValue = Math.min(sqrtPath.value > 0 ? 1 / sqrtPath.value : Infinity, driftPath.value);
  const node = derive({
    id: `${NS}.util_width`,
    symbol: "width option",
    label: "SBE width, governing 18.10.6.2(b) option",
    value: utilValue,
    unit: "1",
    formula: "\\text{(ii)}\\ b \\ge \\sqrt{0.025c\\ell_w}\\quad\\text{or}\\quad\\text{(iii)}\\ \\delta_c/h_{wcs} \\ge 1.5\\delta_u/h_{wcs}",
    substitution: `\\min\\left(${fmtTex(sqrtReqValue / bValue, { dp: 3 })},\\ ${fmtTex(driftPath.value, { dp: 3 })}\\right) = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [sqrtPath, driftPath],
    status: ok ? "ok" : "ng",
    note: sqrtOk
      ? "option (ii) governs"
      : driftOk
        ? "option (ii) fails but the drift-capacity option (iii) is satisfied — the width is acceptable"
        : "neither width option is satisfied",
  });
  return { node, util: utilValue };
}

export interface DriftCapacityArgs {
  /** wall length, in | mm */
  lw: number;
  /** width of the flexural compression zone, in | mm */
  b: number;
  /** neutral axis depth, in | mm */
  c: number;
  /** amplified design shear V_e, kip | kN */
  Ve: number;
  /** √f'c, psi^0.5 | MPa^0.5 */
  sqrtFc: number;
  /** gross shear area, in² | mm² */
  Acv: number;
  /**
   * true when every argument is in the metric system, selecting the ACI 318M-19
   * 18.10.6.2(b) form of the shear normalizing term. Defaults to false so the
   * in-lb call sites (and the web drift panel) are unaffected.
   */
  si?: boolean;
}

/**
 * The coefficient on √f'c·A_cv in the shear term of Eq. (18.10.6.2b):
 *   in-lb                    — 8√f'c·A_cv (psi, in² → lb, /1000 → kip)
 *   ACI 318M-19 18.10.6.2(b) — 0.66√f'c·A_cv (MPa, mm² → N, /1000 → kN)
 */
function driftShearCoeff(si: boolean): number {
  return si ? 0.66 : 8;
}

/**
 * Eq. (18.10.6.2b) as pure arithmetic — the **computed** drift capacity, before
 * the 0.015 floor:
 *
 *   δ_c/h_wcs = (1/100)[4 − (1/50)(ℓ_w/b)(c/b) − V_e/(8√f'c A_cv)]
 *
 * with the 8 replaced by 0.66 in ACI 318M-19 18.10.6.2(b). V_e is in kip (kN)
 * and the normalizing term is evaluated in kip (kN), so the ratio is
 * dimensionless either way.
 */
export function driftCapacityRatio(args: DriftCapacityArgs): number {
  const shearCap = (driftShearCoeff(args.si === true) * args.sqrtFc * args.Acv) / 1000;
  return (1 / 100) * (4 - (1 / 50) * (args.lw / args.b) * (args.c / args.b) - args.Ve / shearCap);
}

/** Eq. (18.10.6.2b), with the 0.015 floor on the computed capacity. */
function driftCapacityNode(w: WallInput, bValue: number, ve: Traced, b: Traced, c: Traced): Traced {
  const U = schemeOf(w);
  const lw = lwInput(w);
  const acv = Acv(w);
  const sqrt = sqrtFcLocal(w, U);
  // 18.10.6.2(b): V_e/(8√f'c·A_cv) in psi/in²; ACI 318M-19 18.10.6.2(b) prints
  // the same equation with 0.66√f'c·A_cv in MPa/mm².
  const shearCoeff = driftShearCoeff(U.si);
  const shearCoeffTex = U.si ? "0.66" : "8";
  const shearCapValue = (shearCoeff * sqrt.value * acv.value) / 1000;
  const shearCap = derive({
    id: `${NS}.drift_shear_cap`,
    symbol: `${shearCoeffTex}√f'_c·A_cv`,
    label: "shear normalizing term of Eq. (18.10.6.2b)",
    value: shearCapValue,
    unit: U.force,
    formula: `${shearCoeffTex}\\sqrt{f'_c}\\,A_{cv}`,
    substitution: `${shearCoeffTex} \\times ${fmtTex(sqrt.value, { dp: U.si ? 3 : 1 })} \\times ${fmtTex(acv.value)} = ${fmtTex(shearCapValue)}\\ ${U.forceTex}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [sqrt, acv],
    note: U.si ? "MPa × mm² → N, reported in kN" : "psi × in² → lb, reported in kip",
  });

  const geomTerm = (1 / 50) * (lw.value / bValue) * (c.value / bValue);
  const shearTerm = ve.value / shearCapValue;
  const rawValue = driftCapacityRatio({
    lw: lw.value,
    b: bValue,
    c: c.value,
    Ve: ve.value,
    sqrtFc: sqrt.value,
    Acv: acv.value,
    si: U.si,
  });
  const raw = derive({
    id: `${NS}.drift_capacity_raw`,
    symbol: "δ_c/h_wcs (computed)",
    label: "computed drift capacity",
    value: rawValue,
    unit: "1",
    formula: `\\dfrac{\\delta_c}{h_{wcs}} = \\dfrac{1}{100}\\left[4 - \\dfrac{1}{50}\\dfrac{\\ell_w}{b}\\dfrac{c}{b} - \\dfrac{V_e}{${shearCoeffTex}\\sqrt{f'_c}A_{cv}}\\right]`,
    substitution:
      `\\dfrac{1}{100}\\left[4 - \\dfrac{1}{50}\\dfrac{${fmtTex(lw.value)}}{${fmtTex(bValue, { dp: 1 })}}\\dfrac{${fmtTex(c.value, { dp: 2 })}}{${fmtTex(bValue, { dp: 1 })}} - ` +
      `\\dfrac{${fmtTex(ve.value)}}{${fmtTex(shearCapValue)}}\\right] = \\dfrac{1}{100}\\left[4 - ${fmtTex(geomTerm, { dp: 3 })} - ${fmtTex(shearTerm, { dp: 3 })}\\right] = ${fmtTex(rawValue, { dp: 5 })}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [lw, b, c, ve, shearCap],
  });

  const floor = constant(
    `${NS}.drift_capacity_floor`,
    "0.015",
    "lower bound on the computed drift capacity",
    DRIFT_CAPACITY_FLOOR,
    "1",
    aci("18.10.6.2", "18.10.6.2b"),
    "δ_c/h_wcs need not be taken less than 0.015",
  );
  const value = Math.max(rawValue, DRIFT_CAPACITY_FLOOR);
  return derive({
    id: `${NS}.drift_capacity`,
    symbol: "δ_c/h_wcs",
    label: "drift capacity of the wall",
    value,
    unit: "1",
    formula: "\\delta_c/h_{wcs} \\ge 0.015",
    substitution: `\\max(${fmtTex(rawValue, { dp: 5 })},\\ 0.015) = ${fmtTex(value, { dp: 5 })}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [raw, floor],
    note: rawValue < DRIFT_CAPACITY_FLOOR ? "the 0.015 floor governs" : "the computed value governs",
  });
}

/** 18.10.6.2(b)(i) / 18.10.6.4(a): vertical extent above and below the section. */
function verticalExtent(w: WallInput, demand: Demands): Traced {
  const U = schemeOf(w);
  const lw = lwInput(w);
  const Mu = Math.abs(demand.Mu);
  const Vu = Math.abs(demand.Vu);
  // M_u/(4V_u) is a length: kip-in./kip → in., and kN·mm/kN → mm in ACI 318M-19
  // 18.10.6.2(b)(i), so the moment is expressed per millimetre in SI.
  const MuLen = U.si ? kipFtToKnM(Mu) * 1000 : kipFtToKipIn(Mu);
  const VuLocal = U.frc(Vu);
  const MuOver4Vu = Vu > 0 ? MuLen / (4 * VuLocal) : Number.POSITIVE_INFINITY;
  const MuNode = input(
    `${NS}.extent_Mu`,
    "M_u",
    `factored in-plane moment (${demand.label ?? demand.id})`,
    U.mom(Mu),
    U.moment,
  );
  const VuNode = input(
    `${NS}.extent_Vu`,
    "V_u",
    `factored in-plane shear (${demand.label ?? demand.id})`,
    VuLocal,
    U.force,
  );
  const term = derive({
    id: `${NS}.extent_mu_4vu`,
    symbol: "M_u/(4V_u)",
    label: "moment-to-shear extent term",
    value: MuOver4Vu,
    unit: U.length,
    formula: "\\dfrac{M_u}{4V_u}",
    substitution: `\\dfrac{${fmtTex(MuLen)}}{4 \\times ${fmtTex(VuLocal)}} = ${fmtTex(MuOver4Vu, { dp: 1 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [MuNode, VuNode],
    note: U.si ? "M_u in kN·m is converted to kN·mm" : "M_u in kip-ft is converted to kip-in.",
  });
  const value = Math.max(lw.value, MuOver4Vu);
  return derive({
    id: `${NS}.extent_req`,
    symbol: "extent",
    label: "required vertical extent of SBE transverse reinforcement",
    value,
    unit: U.length,
    formula: "\\text{extent} \\ge \\max\\left(\\ell_w,\\ \\dfrac{M_u}{4V_u}\\right)",
    substitution: `\\max(${fmtTex(lw.value)},\\ ${fmtTex(MuOver4Vu, { dp: 1 })}) = ${fmtTex(value, { dp: 1 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [lw, term],
    note: "informational: this engine checks one section, not a height range — the SBE transverse reinforcement must extend this far above (and below, into the support per 18.10.6.4(j)) the critical section",
  });
}

/**
 * Table 18.10.6.4(g) — confinement amount for rectilinear hoops:
 *
 *   A_sh/(s·b_c) ≥ max(0.3(A_g/A_ch − 1)f'c/f_yt, 0.09 f'c/f_yt)
 *
 * with A_g = b·ℓ_be for the boundary element and A_ch the core measured to the
 * outside of the hoops (each dimension less two covers). The provided A_sh is
 * `tieLegsAcrossWidth` legs of the tie bar, compared against the core dimension
 * b_c perpendicular to those legs — the width-direction core b_c1, exactly as
 * MNL-17(21) Ex. 2 computes it. The orthogonal direction (legs distributed along
 * ℓ_be, crossing b_c2) is **not** modelled: the input carries one leg count.
 */
function ashCheck(
  w: WallInput,
  sbe: NonNullable<WallInput["sbe"]>,
  b: Traced,
  lbe: Traced,
  sProv: Traced,
): SubCheck {
  // Table 18.10.6.4(g) is a set of dimensionless ratios and is printed
  // identically in ACI 318M-19 Table 18.10.6.4(g); only the units its A_g/A_ch,
  // b_c and f'c/f_yt leaves carry change (mm², mm, MPa).
  const U = schemeOf(w);
  const bValue = U.len(sbe.width);
  const lbeValue = U.len(sbe.length);
  const coverValue = U.len(w.geometry.cover);
  const AgBeValue = bValue * lbeValue;
  const AgBe = derive({
    id: `${NS}.Ag_be`,
    symbol: "A_g,be",
    label: "gross area of the boundary element",
    value: AgBeValue,
    unit: U.area,
    formula: "A_{g,be} = b\\,\\ell_{be}",
    substitution: `${fmtTex(bValue, { dp: 1 })} \\times ${fmtTex(lbeValue, { dp: 1 })} = ${fmtTex(AgBeValue)}\\ ${U.areaTex}`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [b, lbe],
  });

  const cover = input(`${NS}.cover`, "c_c", "clear cover to the hoops", coverValue, U.length);
  const bc1Value = bValue - 2 * coverValue;
  const bc1 = derive({
    id: `${NS}.bc1`,
    symbol: "b_c1",
    label: "core dimension across the SBE width, to the outside of the hoops",
    value: bc1Value,
    unit: U.length,
    formula: "b_{c1} = b - 2c_c",
    substitution: `${fmtTex(bValue, { dp: 1 })} - 2 \\times ${fmtTex(coverValue, { dp: 2 })} = ${fmtTex(bc1Value, { dp: 1 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [b, cover],
  });
  const bc2Value = lbeValue - 2 * coverValue;
  const bc2 = derive({
    id: `${NS}.bc2`,
    symbol: "b_c2",
    label: "core dimension along the SBE length, to the outside of the hoops",
    value: bc2Value,
    unit: U.length,
    formula: "b_{c2} = \\ell_{be} - 2c_c",
    substitution: `${fmtTex(lbeValue, { dp: 1 })} - 2 \\times ${fmtTex(coverValue, { dp: 2 })} = ${fmtTex(bc2Value, { dp: 1 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [lbe, cover],
  });
  const AchValue = bc1Value * bc2Value;
  const Ach = derive({
    id: `${NS}.Ach`,
    symbol: "A_ch",
    label: "core area measured to the outside of the hoops",
    value: AchValue,
    unit: U.area,
    formula: "A_{ch} = b_{c1}\\,b_{c2}",
    substitution: `${fmtTex(bc1Value, { dp: 1 })} \\times ${fmtTex(bc2Value, { dp: 1 })} = ${fmtTex(AchValue)}\\ ${U.areaTex}`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [bc1, bc2],
  });

  const fcCode = U.str(w.concrete.fc);
  const fytCode = U.str(w.grade.fy);
  const fyt = input(
    `${NS}.fyt`,
    "f_yt",
    "yield strength of the transverse reinforcement",
    fytCode,
    U.stress,
  );
  const termA = 0.3 * (AgBeValue / AchValue - 1) * (fcCode / fytCode);
  const termB = 0.09 * (fcCode / fytCode);
  const ratioReqValue = Math.max(termA, termB);
  const ratioReq = derive({
    id: `${NS}.Ash_ratio_req`,
    symbol: "A_sh/(s·b_c) req'd",
    label: "required confinement ratio",
    value: ratioReqValue,
    unit: "1",
    formula:
      "\\dfrac{A_{sh}}{s\\,b_c} \\ge \\max\\left[0.3\\left(\\dfrac{A_g}{A_{ch}} - 1\\right)\\dfrac{f'_c}{f_{yt}},\\ 0.09\\dfrac{f'_c}{f_{yt}}\\right]",
    substitution:
      `\\max\\left[0.3\\left(\\dfrac{${fmtTex(AgBeValue)}}{${fmtTex(AchValue)}} - 1\\right)\\dfrac{${fmtTex(fcCode)}}{${fmtTex(fytCode)}},\\ ` +
      `0.09 \\times \\dfrac{${fmtTex(fcCode)}}{${fmtTex(fytCode)}}\\right] = \\max(${fmtTex(termA, { dp: 5 })},\\ ${fmtTex(termB, { dp: 5 })}) = ${fmtTex(ratioReqValue, { dp: 5 })}`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [AgBe, Ach, fyt],
    note: termA >= termB ? "the A_g/A_ch term governs" : "the 0.09f'c/f_yt floor governs",
  });

  const Ab = U.ar(BARS[sbe.tieBar].Ab);
  const AbNode = input(
    `${NS}.Ab_tie`,
    "A_b,tie",
    `area of one tie leg (No. ${sbe.tieBar})`,
    Ab,
    U.area,
  );
  // A_sh = n·A_b over s·b_c — a dimensionless ratio, so the leg count is the
  // same number in either system once the leaves agree.
  const sValue = U.len(sbe.tieSpacing);
  const legsReqValue = (ratioReqValue * sValue * bc1Value) / Ab;
  const legsReq = derive({
    id: `${NS}.legs_req`,
    symbol: "n_legs,req",
    label: "tie legs required across the core width",
    value: legsReqValue,
    unit: "1",
    formula: "n_{legs} \\ge \\dfrac{(A_{sh}/s b_c)_{req}\\,s\\,b_{c1}}{A_{b,tie}}",
    substitution: `\\dfrac{${fmtTex(ratioReqValue, { dp: 5 })} \\times ${fmtTex(sValue, { dp: 1 })} \\times ${fmtTex(bc1Value, { dp: 1 })}}{${fmtTex(Ab, { dp: 2 })}} = ${fmtTex(legsReqValue, { dp: 2 })}`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [ratioReq, sProv, bc1, AbNode],
    note: "legs are counted perpendicular to b_c1, the core dimension across the SBE width — the direction MNL-17(21) Ex. 2 sizes; the orthogonal direction is not modelled by this input",
  });
  const legsProv = input(
    `${NS}.legs_prov`,
    "n_legs,prov",
    "tie legs provided across the core width",
    sbe.tieLegsAcrossWidth,
    "1",
  );

  return ratioNode(
    "ash",
    "n_legs,req/n_legs,prov",
    "confinement utilization",
    legsReq,
    legsProv,
    "18.10.6.4",
    `A_sh provided = ${fmtTex(sbe.tieLegsAcrossWidth)} × ${fmtTex(Ab, { dp: 2 })} = ${fmtTex(sbe.tieLegsAcrossWidth * Ab, { dp: 2 })} ${U.si ? "mm²" : "in²"}; the required leg count is rounded up in practice`,
  );
}

/**
 * 18.10.6.5(b) — where a special boundary element is **not** required, boundary
 * longitudinal reinforcement with ρ > 400/f_y (psi) — 2.8/f_y in ACI 318M-19
 * 18.10.6.5(b), f_y in MPa — must be laterally supported, with vertical spacing
 * per Table 18.10.6.5(b).
 *
 * Only the Grade 60 rows are implemented (Grade 420 in the metric table); the
 * engine's `GRADE80`/`GRADE550` are accepted but the table's higher-grade rows
 * are flagged rather than silently mis-applied.
 */
function notRequired(w: WallInput, demand: Demands, req: SbeRequirement): CheckResult {
  const U = schemeOf(w);
  const lenWord = lenWordOf(U);
  const lw = lwInput(w);
  const h = hInput(w);

  // Boundary region per 18.10.6.4(a), i.e. the same length the ties would cover.
  // `req.c` is already in the reporting length unit (in | mm).
  const cLocal = req.c;
  const lengthValue = Math.max(cLocal - 0.1 * lw.value, cLocal / 2);
  const region = derive({
    id: `${NS}.alt.region`,
    symbol: "ℓ_be",
    label: "boundary region over which 18.10.6.5(b) applies",
    value: lengthValue,
    unit: U.length,
    formula: "\\max\\left(c - 0.1\\ell_w,\\ c/2\\right)",
    substitution: `\\max(${fmtTex(cLocal - 0.1 * lw.value, { dp: 2 })},\\ ${fmtTex(cLocal / 2, { dp: 2 })}) = ${fmtTex(lengthValue, { dp: 2 })}\\ ${lenTexOf(U)}`,
    ref: aci("18.10.6.4", "18.10.6.4a"),
    inputs: [req.cNode, lw],
  });

  // `barPositions` is canonical geometry (inches), so the station filter uses
  // the canonical region length; only the traced values are converted.
  // U.len(1) is the scale of the reporting unit (1 in-lb, 25.4 in SI).
  const regionIn = lengthValue / U.len(1);
  const stations = barPositions(w).filter((st) => st.x < regionIn - 1e-6);
  const AsValue = U.ar(stations.reduce((sum, st) => sum + st.area, 0));
  const As = input(
    `${NS}.alt.As`,
    "A_s,be",
    "boundary longitudinal steel",
    AsValue,
    U.area,
    `${stations.length} bar station(s) within ${fmtTex(lengthValue, { dp: 2 })} ${lenWord} of the wall end`,
  );
  // ρ_be is a ratio and identical in both editions; it is assembled from the
  // converted leaves so the substitution reads consistently.
  const rhoValue = AsValue / (lengthValue * h.value);
  const rho = derive({
    id: `${NS}.alt.rho`,
    symbol: "ρ_be",
    label: "boundary longitudinal reinforcement ratio",
    value: rhoValue,
    unit: "1",
    formula: "\\rho_{be} = \\dfrac{A_{s,be}}{\\ell_{be}\\,h}",
    substitution: `\\dfrac{${fmtTex(AsValue, { dp: 2 })}}{${fmtTex(lengthValue, { dp: 2 })} \\times ${fmtTex(h.value, { dp: 1 })}} = ${fmtTex(rhoValue, { dp: 5 })}`,
    ref: aci("18.10.6.5", "18.10.6.5b"),
    inputs: [As, region, h],
  });

  // 18.10.6.5(b) tie trigger ρ > 400/f_y (psi); ACI 318M-19 18.10.6.5(b) prints
  // it as ρ > 2.8/f_y with f_y in MPa.
  const fyCode = U.str(w.grade.fy);
  const triggerNum = U.si ? 2.8 : 400;
  const triggerNumTex = U.si ? "2.8" : "400";
  const coeff = constant(
    `${NS}.alt.coeff`,
    triggerNumTex,
    `numerator of the 18.10.6.5(b) tie trigger (${U.si ? "MPa" : "psi"})`,
    triggerNum,
    "1",
    aci("18.10.6.5", "18.10.6.5b"),
    U.si ? "in-lb form 400/f_y (psi)" : "SI form 2.8/f_y (MPa)",
  );
  const limit = derive({
    id: `${NS}.alt.rho_limit`,
    symbol: `${triggerNumTex}/f_y`,
    label: "boundary tie trigger",
    value: triggerNum / fyCode,
    unit: "1",
    formula: `\\rho_{be} > ${triggerNumTex}/f_y`,
    substitution: `${triggerNumTex}/${fmtTex(fyCode)} = ${fmtTex(triggerNum / fyCode, { dp: 5 })}`,
    ref: aci("18.10.6.5", "18.10.6.5b"),
    inputs: [coeff],
  });

  const triggered = rho.value > limit.value + TOL;
  const trigger = derive<boolean>({
    id: `${NS}.alt.trigger`,
    symbol: "boundary ties req'd",
    label: "boundary transverse reinforcement required",
    value: triggered,
    unit: "1",
    formula: `\\rho_{be} > ${triggerNumTex}/f_y`,
    substitution: `${fmtTex(rho.value, { dp: 5 })} ${triggered ? ">" : "\\le"} ${fmtTex(limit.value, { dp: 5 })} \\Rightarrow \\text{${triggered}}`,
    ref: aci("18.10.6.5", "18.10.6.5b"),
    inputs: [rho, limit],
    note: triggered
      ? "18.10.6.5(b): provide transverse reinforcement per 18.7.5.2(a)–(e) over the 18.10.6.4(a) length"
      : "18.10.6.5(b) tie trigger not reached",
  });

  const nodes: Traced<any>[] = [req.trigger, region, rho, limit, trigger];
  let status: "na" | "ok" | "ng" | "warning" = triggered ? "warning" : "na";
  let util: Traced | undefined;

  if (triggered) {
    // Table 18.10.6.5(b), lowest-grade row: within max(ℓ_w, M_u/4V_u) of the
    // critical section s ≤ min(6d_b, 6 in.), elsewhere min(8d_b, 8 in.). The
    // metric table (ACI 318M-19 Table 18.10.6.5(b)) keys the row off
    // f_y = 420 MPa and soft-converts the absolute limits to 150 mm and 200 mm.
    const gradeCapCode = U.si ? 420 : 60000;
    const gradeLabel = U.si ? "Grade 420" : "Grade 60";
    const higherGrades = U.si ? "Grade 550/690" : "Grade 80/100";
    // The row split is on f_y itself, so it is compared in the edition's own
    // stress unit — 60,000 psi in-lb, 420 MPa in ACI 318M-19.
    const lowGrade = U.str(w.grade.fy) <= gradeCapCode * (1 + 1e-9);
    const db = U.len(BARS[w.vertical.bar].db);
    const dbNode = input(
      `${NS}.alt.db`,
      "d_b",
      `smallest primary flexural bar diameter (No. ${w.vertical.bar})`,
      db,
      U.length,
    );
    const criticalMu = U.si
      ? kipFtToKnM(Math.abs(demand.Mu)) * 1000
      : kipFtToKipIn(Math.abs(demand.Mu));
    const critical = Math.max(
      lw.value,
      Math.abs(demand.Vu) > 0 ? criticalMu / (4 * U.frc(Math.abs(demand.Vu))) : 0,
    );
    const sNear = U.si ? 150 : 6;
    const sFar = U.si ? 200 : 8;
    const sNearTex = `${fmtTex(sNear)}\\ ${lenTexOf(U)}`;
    const sReqValue = Math.min(6 * db, sNear);
    const sReq = derive({
      id: `${NS}.alt.s_req`,
      symbol: "s_max",
      label: "maximum vertical spacing of boundary transverse reinforcement",
      value: sReqValue,
      unit: U.length,
      formula: `s \\le \\min(6d_b,\\ ${sNearTex})`,
      substitution: `\\min(6 \\times ${fmtTex(db, { dp: 3 })},\\ ${fmtTex(sNear)}) = ${fmtTex(sReqValue, { dp: 2 })}\\ ${lenTexOf(U)}`,
      ref: aci("18.10.6.5", "Table 18.10.6.5(b)"),
      inputs: [dbNode],
      note: lowGrade
        ? `${gradeLabel} row, within max(ℓ_w, M_u/4V_u) = ${fmtTex(critical, { dp: 1 })} ${lenWord} of the critical section; elsewhere min(8d_b, ${fmtTex(sFar)} ${lenWord}) = ${fmtTex(Math.min(8 * db, sFar), { dp: 2 })} ${lenWord}`
        : `Table 18.10.6.5(b) rows for ${higherGrades} are not implemented — the ${gradeLabel} row is shown and must be reviewed`,
      ...(lowGrade ? {} : { status: "warning" as const }),
    });
    nodes.push(sReq);

    if (w.sbe !== undefined) {
      const sProv = input(
        `${NS}.alt.s_prov`,
        "s",
        "provided boundary tie spacing",
        U.len(w.sbe.tieSpacing),
        U.length,
      );
      const sub = ratioNode(
        "alt_s",
        "s/s_max",
        "boundary tie spacing utilization",
        sProv,
        sReq,
        "18.10.6.5",
        undefined,
        true,
      );
      nodes.push(sub.node);
      util = sub.node;
      status = sub.node.status === "ng" ? "ng" : "ok";
    }
  }

  return checkResult({
    id: "sbe.detailing",
    title:
      triggered && w.sbe === undefined
        ? "Boundary reinforcement — 18.10.6.5(b) ties required"
        : "Boundary reinforcement — no special boundary element required",
    ref: aci("18.10.6.5", "18.10.6.5b"),
    ...(util !== undefined ? { utilization: util } : {}),
    trace: nodes,
    status,
  });
}
