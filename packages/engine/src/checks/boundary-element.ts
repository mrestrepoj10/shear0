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
import { fmtTex, kipFtToKipIn, ksiToPsi } from "../units";
import {
  Acv,
  Ag,
  barPositions,
  hInput,
  huInput,
  huValue,
  hwcsInput,
  hwcsOverLw,
  hwcsValue,
  lwInput,
} from "../wall";
import type { Demands, WallInput } from "../wall";
import { sqrtFcNode } from "./special-reinforcement";

const TOL = 1e-9;

const NS_REQ = "sbe.req";
const NS = "sbe";

/** 18.10.6.2(a) floor on the design drift ratio. */
const DRIFT_FLOOR = 0.005;

/** 18.10.6.2(b)(iii): the computed drift capacity need not be taken below this. */
const DRIFT_CAPACITY_FLOOR = 0.015;

export interface SbeRequirement {
  /** which of 18.10.6.2 / 18.10.6.3 governs, per 18.10.6.1 */
  method: "displacement" | "stress";
  required: boolean;
  /** largest neutral axis depth at M_n over the supplied demands, in */
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
    PuGoverning,
    "kip",
    `largest c over the supplied demands — governed by "${governing}"`,
  );
  return derive({
    id: `${NS_REQ}.c`,
    symbol: "c",
    label: "neutral axis depth at nominal moment strength",
    value: best,
    unit: "in",
    formula: "\\text{solve } P_n(c) = P_u \\quad (\\varepsilon_{cu} = 0.003,\\ a = \\beta_1 c)",
    substitution: `P_n(c) = ${fmtTex(PuGoverning)}\\ \\text{kip} \\Rightarrow c = ${fmtTex(best, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.10.6.2", "18.10.6.2a"),
    inputs: [Pu],
    note: `largest neutral axis depth over the supplied load combinations (governing combination: ${governing}); no φ is applied — this is the nominal-strength c`,
  });
}

/** σ = P_u/A_g + M_u (ℓ_w/2)/I_g — linear-elastic gross section, 18.10.6.3. */
export function sigmaExtreme(w: WallInput, demand: Demands): Traced {
  const ag = Ag(w);
  const h = hInput(w);
  const lw = lwInput(w);
  const IgValue = (w.geometry.h * w.geometry.lw ** 3) / 12;
  const Ig = derive({
    id: `${NS_REQ}.Ig`,
    symbol: "I_g",
    label: "gross moment of inertia about the strong axis",
    value: IgValue,
    unit: "in4",
    formula: "I_g = \\dfrac{h\\,\\ell_w^3}{12}",
    substitution: `\\dfrac{${fmtTex(w.geometry.h, { dp: 1 })} \\times ${fmtTex(w.geometry.lw)}^3}{12} = ${fmtTex(IgValue)}\\ \\text{in}^4`,
    inputs: [h, lw],
  });
  const yValue = w.geometry.lw / 2;
  const y = derive({
    id: `${NS_REQ}.y`,
    symbol: "y",
    label: "distance from the centroid to the extreme compression fiber",
    value: yValue,
    unit: "in",
    formula: "y = \\ell_w/2",
    substitution: `y = ${fmtTex(w.geometry.lw)}/2 = ${fmtTex(yValue, { dp: 1 })}\\ \\text{in.}`,
    inputs: [lw],
    note: "gross rectangular section: the extreme fiber is ℓ_w/2 from the centroid",
  });

  const Pu = input(
    `${NS_REQ}.Pu_sigma`,
    "P_u",
    `factored axial force (${demand.label ?? demand.id})`,
    demand.Pu,
    "kip",
  );
  const Mu = input(
    `${NS_REQ}.Mu_sigma`,
    "M_u",
    `factored in-plane moment (${demand.label ?? demand.id})`,
    Math.abs(demand.Mu),
    "kip-ft",
  );

  const PuLb = demand.Pu * 1000;
  const MuLbIn = kipFtToKipIn(Math.abs(demand.Mu)) * 1000;
  const axial = PuLb / ag.value;
  const flex = (MuLbIn * yValue) / IgValue;
  return derive({
    id: `${NS_REQ}.sigma`,
    symbol: "σ",
    label: "extreme-fiber compressive stress on the gross section",
    value: axial + flex,
    unit: "psi",
    formula: "\\sigma = \\dfrac{P_u}{A_g} + \\dfrac{M_u\\,y}{I_g}",
    substitution:
      `\\dfrac{${fmtTex(PuLb)}}{${fmtTex(ag.value)}} + \\dfrac{${fmtTex(MuLbIn)} \\times ${fmtTex(yValue, { dp: 1 })}}{${fmtTex(IgValue)}} = ` +
      `${fmtTex(axial)} + ${fmtTex(flex)} = ${fmtTex(axial + flex)}\\ \\text{psi}`,
    ref: aci("18.10.6.3"),
    inputs: [Pu, ag, Mu, y, Ig],
    note: "linear-elastic gross-section model including E (18.10.6.3); P_u in kip and M_u in kip-ft are converted to lb and lb-in. so the stress lands in psi",
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
      deltaE,
      "in",
    );
    const deltaUValue = Cd * deltaE;
    deltaU = derive({
      id: `${NS_REQ}.delta_u`,
      symbol: "δ_u",
      label: "design displacement",
      value: deltaUValue,
      unit: "in",
      formula: "\\delta_u = C_d\\,\\delta_e",
      substitution: `${fmtTex(Cd, { dp: 2 })} \\times ${fmtTex(deltaE, { dp: 2 })} = ${fmtTex(deltaUValue, { dp: 2 })}\\ \\text{in.}`,
      ref: aci("18.10.6.2"),
      inputs: [CdNode, deltaENode],
      note: "δ_u is the design displacement of ASCE 7, C_d δ_e",
    });
    driftRaw = derive({
      id: `${NS_REQ}.drift_raw`,
      symbol: "δ_u/h_wcs",
      label: "computed design drift ratio",
      value: deltaUValue / hwcsValue(w),
      unit: "1",
      formula: "\\delta_u/h_{wcs}",
      substitution: `${fmtTex(deltaUValue, { dp: 2 })} / ${fmtTex(hwcsValue(w))} = ${fmtTex(deltaUValue / hwcsValue(w), { dp: 5 })}`,
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
  const rhsValue = w.geometry.lw / (600 * cNode.value);
  const rhs = derive({
    id: `${NS_REQ}.limit`,
    symbol: "ℓ_w/(600c)",
    label: "drift ratio at which a special boundary element becomes required",
    value: rhsValue,
    unit: "1",
    formula: "\\dfrac{\\ell_w}{600\\,c}",
    substitution: `\\dfrac{${fmtTex(w.geometry.lw)}}{600 \\times ${fmtTex(cNode.value, { dp: 2 })}} = ${fmtTex(rhsValue, { dp: 5 })}`,
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
  const sigma = sigmaExtreme(w, demand);
  const fcPsi = ksiToPsi(w.concrete.fc);

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
    value: 0.2 * fcPsi,
    unit: "psi",
    formula: "0.2\\,f'_c",
    substitution: `0.2 \\times ${fmtTex(fcPsi)} = ${fmtTex(0.2 * fcPsi)}\\ \\text{psi}`,
    ref: aci("18.10.6.3"),
    inputs: [limitCoeff, fcInput(w.concrete)],
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
    value: 0.15 * fcPsi,
    unit: "psi",
    formula: "0.15\\,f'_c",
    substitution: `0.15 \\times ${fmtTex(fcPsi)} = ${fmtTex(0.15 * fcPsi)}\\ \\text{psi}`,
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

  const sbe = w.sbe;
  const lw = lwInput(w);
  const c = req.cNode;
  const subs: SubCheck[] = [];

  const b = input(`${NS}.b`, "b", "provided SBE width", sbe.width, "in");
  const lbe = input(`${NS}.l_be`, "ℓ_be", "provided SBE length", sbe.length, "in");

  // --- (a) horizontal length ------------------------------------------------
  const cMinus = derive({
    id: `${NS}.c_minus_01lw`,
    symbol: "c − 0.1ℓ_w",
    label: "first length requirement",
    value: c.value - 0.1 * w.geometry.lw,
    unit: "in",
    formula: "c - 0.1\\,\\ell_w",
    substitution: `${fmtTex(c.value, { dp: 2 })} - 0.1 \\times ${fmtTex(w.geometry.lw)} = ${fmtTex(c.value - 0.1 * w.geometry.lw, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.10.6.4", "18.10.6.4a"),
    inputs: [c, lw],
  });
  const cHalf = derive({
    id: `${NS}.c_over_2`,
    symbol: "c/2",
    label: "second length requirement",
    value: c.value / 2,
    unit: "in",
    formula: "c/2",
    substitution: `${fmtTex(c.value, { dp: 2 })}/2 = ${fmtTex(c.value / 2, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.10.6.4", "18.10.6.4a"),
    inputs: [c],
  });
  const lengthReqValue = Math.max(cMinus.value, cHalf.value);
  const lengthReq = derive({
    id: `${NS}.length_req`,
    symbol: "ℓ_be,min",
    label: "required SBE length from the extreme compression fiber",
    value: lengthReqValue,
    unit: "in",
    formula: "\\ell_{be} \\ge \\max\\left(c - 0.1\\ell_w,\\ c/2\\right)",
    substitution: `\\max(${fmtTex(cMinus.value, { dp: 2 })},\\ ${fmtTex(cHalf.value, { dp: 2 })}) = ${fmtTex(lengthReqValue, { dp: 2 })}\\ \\text{in.}`,
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
  const width = widthPaths(w, sbe.width, req, ve, b, c);
  subs.push({ node: width.node, util: width.util });

  // --- 18.10.6.4(b) b ≥ h_u/16 ---------------------------------------------
  const hu = huInput(w);
  const huReq = derive({
    id: `${NS}.b_hu16_req`,
    symbol: "h_u/16",
    label: "minimum SBE width from the unsupported height",
    value: huValue(w) / 16,
    unit: "in",
    formula: "b \\ge h_u/16",
    substitution: `${fmtTex(huValue(w))}/16 = ${fmtTex(huValue(w) / 16, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.10.6.4", "18.10.6.4b"),
    inputs: [hu],
  });
  subs.push(ratioNode("b_hu16", "(h_u/16)/b", "SBE width utilization (h_u/16)", huReq, b, "18.10.6.4"));

  // --- 18.10.6.4(c) 12 in. floor for c/ℓ_w ≥ 3/8 ---------------------------
  const cOverLw = derive({
    id: `${NS}.c_over_lw`,
    symbol: "c/ℓ_w",
    label: "neutral axis depth ratio",
    value: c.value / w.geometry.lw,
    unit: "1",
    formula: "c/\\ell_w",
    substitution: `${fmtTex(c.value, { dp: 2 })} / ${fmtTex(w.geometry.lw)} = ${fmtTex(c.value / w.geometry.lw, { dp: 3 })}`,
    ref: aci("18.10.6.4", "18.10.6.4c"),
    inputs: [c, lw],
  });
  const applies12 = c.value / w.geometry.lw >= 3 / 8 - TOL;
  const floor12 = derive({
    id: `${NS}.b_12_util`,
    symbol: "12 in./b",
    label: "SBE width utilization (12 in. floor)",
    value: applies12 ? 12 / sbe.width : 0,
    unit: "1",
    formula: "b \\ge 12\\ \\text{in.} \\quad (c/\\ell_w \\ge 3/8)",
    substitution: applies12
      ? `12 / ${fmtTex(sbe.width, { dp: 1 })} = ${fmtTex(12 / sbe.width, { dp: 3 })}`
      : `c/\\ell_w = ${fmtTex(c.value / w.geometry.lw, { dp: 3 })} < 3/8 \\Rightarrow \\text{does not apply}`,
    ref: aci("18.10.6.4", "18.10.6.4c"),
    inputs: [cOverLw, b],
    status: applies12 ? (sbe.width >= 12 - TOL ? "ok" : "ng") : "na",
    note: applies12
      ? "18.10.6.4(c): h_w/ℓ_w ≥ 2.0, continuous wall with a single critical section, c/ℓ_w ≥ 3/8"
      : "18.10.6.4(c) applies only where c/ℓ_w ≥ 3/8",
  });
  subs.push({ node: floor12, ...(applies12 ? { util: floor12.value } : {}) });

  // --- 18.10.6.2(b)(i) vertical extent (informational) ---------------------
  subs.push({ node: verticalExtent(w, demand) });

  // --- (f) h_x -------------------------------------------------------------
  const hx = input(`${NS}.hx`, "h_x", "provided spacing of laterally supported bars", sbe.hx, "in");
  const hx14 = constant(
    `${NS}.hx_cap`,
    "14 in.",
    "absolute limit on h_x",
    14,
    "in",
    aci("18.10.6.4", "18.10.6.4f"),
  );
  const hxTwoThirds = derive({
    id: `${NS}.hx_two_thirds_b`,
    symbol: "(2/3)b",
    label: "width-based limit on h_x",
    value: (2 / 3) * sbe.width,
    unit: "in",
    formula: "\\tfrac{2}{3}\\,b",
    substitution: `\\tfrac{2}{3} \\times ${fmtTex(sbe.width, { dp: 1 })} = ${fmtTex((2 / 3) * sbe.width, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.10.6.4", "18.10.6.4f"),
    inputs: [b],
  });
  const hxMax = derive({
    id: `${NS}.hx_max`,
    symbol: "h_x,max",
    label: "maximum spacing of laterally supported longitudinal bars",
    value: Math.min(14, (2 / 3) * sbe.width),
    unit: "in",
    formula: "h_x \\le \\min\\left(14\\ \\text{in.},\\ \\tfrac{2}{3}b\\right)",
    substitution: `\\min(14,\\ ${fmtTex((2 / 3) * sbe.width, { dp: 2 })}) = ${fmtTex(Math.min(14, (2 / 3) * sbe.width), { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.10.6.4", "18.10.6.4f"),
    inputs: [hx14, hxTwoThirds],
  });
  subs.push(ratioNode("hx", "h_x/h_x,max", "h_x utilization", hx, hxMax, "18.10.6.4", undefined, true));

  // --- (e)/(g) tie spacing --------------------------------------------------
  const soRaw = 4 + (14 - sbe.hx) / 3;
  const soValue = Math.min(6, Math.max(4, soRaw));
  const so = derive({
    id: `${NS}.so`,
    symbol: "s_o",
    label: "spacing term of 18.7.5.3",
    value: soValue,
    unit: "in",
    formula: "s_o = 4 + \\dfrac{14 - h_x}{3},\\quad 4\\ \\text{in.} \\le s_o \\le 6\\ \\text{in.}",
    substitution: `4 + \\dfrac{14 - ${fmtTex(sbe.hx, { dp: 1 })}}{3} = ${fmtTex(soRaw, { dp: 2 })} \\Rightarrow s_o = ${fmtTex(soValue, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.7.5.3", "18.7.5.3"),
    inputs: [hx],
    note:
      soRaw > 6
        ? "clamped to the 6 in. upper bound"
        : soRaw < 4
          ? "clamped to the 4 in. lower bound"
          : "within the 4–6 in. range",
  });

  const leastDim = Math.min(sbe.width, sbe.length);
  const thirdDim = derive({
    id: `${NS}.least_dim_3`,
    symbol: "b_min/3",
    label: "one-third of the least SBE dimension",
    value: leastDim / 3,
    unit: "in",
    formula: "\\min(b,\\ \\ell_{be})/3",
    substitution: `\\min(${fmtTex(sbe.width, { dp: 1 })},\\ ${fmtTex(sbe.length, { dp: 1 })})/3 = ${fmtTex(leastDim / 3, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.10.6.4", "18.10.6.4e"),
    inputs: [b, lbe],
    note: "18.10.6.4(e) replaces the 18.7.5.3(a) column limit with one-third of the least boundary element dimension",
  });
  const dbLong = BARS[sbe.longBar].db;
  const sixDb = derive({
    id: `${NS}.six_db`,
    symbol: "6d_b",
    label: "six longitudinal bar diameters",
    value: 6 * dbLong,
    unit: "in",
    formula: "6\\,d_b",
    substitution: `6 \\times ${fmtTex(dbLong, { dp: 3 })} = ${fmtTex(6 * dbLong, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.7.5.3", "18.7.5.3b"),
    inputs: [
      input(`${NS}.db_long`, "d_b", `diameter of the SBE longitudinal bar (No. ${sbe.longBar})`, dbLong, "in"),
    ],
  });
  const sReqValue = Math.min(thirdDim.value, sixDb.value, soValue);
  const sReq = derive({
    id: `${NS}.s_req`,
    symbol: "s_max",
    label: "maximum vertical spacing of SBE transverse reinforcement",
    value: sReqValue,
    unit: "in",
    formula: "s \\le \\min\\left(b_{min}/3,\\ 6d_b,\\ s_o\\right)",
    substitution: `\\min(${fmtTex(thirdDim.value, { dp: 2 })},\\ ${fmtTex(sixDb.value, { dp: 2 })},\\ ${fmtTex(soValue, { dp: 2 })}) = ${fmtTex(sReqValue, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.10.6.4", "18.10.6.4e"),
    inputs: [thirdDim, sixDb, so],
  });
  const sProv = input(`${NS}.s_prov`, "s", "provided tie spacing", sbe.tieSpacing, "in");
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
  const lw = lwInput(w);

  const coeff = constant(
    `${NS}.b_sqrt_coeff`,
    "0.025",
    "coefficient of the 18.10.6.2(b)(ii) width requirement",
    0.025,
    "1",
    aci("18.10.6.2", "18.10.6.2b"),
  );
  const sqrtReqValue = Math.sqrt(0.025 * c.value * w.geometry.lw);
  const sqrtReq = derive({
    id: `${NS}.b_sqrt_req`,
    symbol: "√(0.025cℓ_w)",
    label: "SBE width required by 18.10.6.2(b)(ii)",
    value: sqrtReqValue,
    unit: "in",
    formula: "b \\ge \\sqrt{0.025\\,c\\,\\ell_w}",
    substitution: `\\sqrt{0.025 \\times ${fmtTex(c.value, { dp: 2 })} \\times ${fmtTex(w.geometry.lw)}} = ${fmtTex(sqrtReqValue, { dp: 2 })}\\ \\text{in.}`,
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
  /** wall length, in */
  lw: number;
  /** width of the flexural compression zone, in */
  b: number;
  /** neutral axis depth, in */
  c: number;
  /** amplified design shear V_e, kip */
  Ve: number;
  /** √f'c, psi^0.5 */
  sqrtFc: number;
  /** gross shear area, in² */
  Acv: number;
}

/**
 * Eq. (18.10.6.2b) as pure arithmetic — the **computed** drift capacity, before
 * the 0.015 floor:
 *
 *   δ_c/h_wcs = (1/100)[4 − (1/50)(ℓ_w/b)(c/b) − V_e/(8√f'c A_cv)]
 *
 * V_e is in kip and the normalizing term is evaluated in kip, so the ratio is
 * dimensionless either way.
 */
export function driftCapacityRatio(args: DriftCapacityArgs): number {
  const shearCap = (8 * args.sqrtFc * args.Acv) / 1000;
  return (1 / 100) * (4 - (1 / 50) * (args.lw / args.b) * (args.c / args.b) - args.Ve / shearCap);
}

/** Eq. (18.10.6.2b), with the 0.015 floor on the computed capacity. */
function driftCapacityNode(w: WallInput, bValue: number, ve: Traced, b: Traced, c: Traced): Traced {
  const lw = lwInput(w);
  const acv = Acv(w);
  const sqrt = sqrtFcNode(w, NS);
  const shearCapValue = (8 * sqrt.value * acv.value) / 1000;
  const shearCap = derive({
    id: `${NS}.drift_shear_cap`,
    symbol: "8√f'_c·A_cv",
    label: "shear normalizing term of Eq. (18.10.6.2b)",
    value: shearCapValue,
    unit: "kip",
    formula: "8\\sqrt{f'_c}\\,A_{cv}",
    substitution: `8 \\times ${fmtTex(sqrt.value, { dp: 1 })} \\times ${fmtTex(acv.value)} = ${fmtTex(shearCapValue)}\\ \\text{kip}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [sqrt, acv],
  });

  const geomTerm = (1 / 50) * (w.geometry.lw / bValue) * (c.value / bValue);
  const shearTerm = ve.value / shearCapValue;
  const rawValue = driftCapacityRatio({
    lw: w.geometry.lw,
    b: bValue,
    c: c.value,
    Ve: ve.value,
    sqrtFc: sqrt.value,
    Acv: acv.value,
  });
  const raw = derive({
    id: `${NS}.drift_capacity_raw`,
    symbol: "δ_c/h_wcs (computed)",
    label: "computed drift capacity",
    value: rawValue,
    unit: "1",
    formula:
      "\\dfrac{\\delta_c}{h_{wcs}} = \\dfrac{1}{100}\\left[4 - \\dfrac{1}{50}\\dfrac{\\ell_w}{b}\\dfrac{c}{b} - \\dfrac{V_e}{8\\sqrt{f'_c}A_{cv}}\\right]",
    substitution:
      `\\dfrac{1}{100}\\left[4 - \\dfrac{1}{50}\\dfrac{${fmtTex(w.geometry.lw)}}{${fmtTex(bValue, { dp: 1 })}}\\dfrac{${fmtTex(c.value, { dp: 2 })}}{${fmtTex(bValue, { dp: 1 })}} - ` +
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
  const lw = lwInput(w);
  const Mu = Math.abs(demand.Mu);
  const Vu = Math.abs(demand.Vu);
  const MuOver4Vu = Vu > 0 ? kipFtToKipIn(Mu) / (4 * Vu) : Number.POSITIVE_INFINITY;
  const MuNode = input(
    `${NS}.extent_Mu`,
    "M_u",
    `factored in-plane moment (${demand.label ?? demand.id})`,
    Mu,
    "kip-ft",
  );
  const VuNode = input(
    `${NS}.extent_Vu`,
    "V_u",
    `factored in-plane shear (${demand.label ?? demand.id})`,
    Vu,
    "kip",
  );
  const term = derive({
    id: `${NS}.extent_mu_4vu`,
    symbol: "M_u/(4V_u)",
    label: "moment-to-shear extent term",
    value: MuOver4Vu,
    unit: "in",
    formula: "\\dfrac{M_u}{4V_u}",
    substitution: `\\dfrac{${fmtTex(kipFtToKipIn(Mu))}}{4 \\times ${fmtTex(Vu)}} = ${fmtTex(MuOver4Vu, { dp: 1 })}\\ \\text{in.}`,
    ref: aci("18.10.6.2", "18.10.6.2b"),
    inputs: [MuNode, VuNode],
    note: "M_u in kip-ft is converted to kip-in.",
  });
  const value = Math.max(w.geometry.lw, MuOver4Vu);
  return derive({
    id: `${NS}.extent_req`,
    symbol: "extent",
    label: "required vertical extent of SBE transverse reinforcement",
    value,
    unit: "in",
    formula: "\\text{extent} \\ge \\max\\left(\\ell_w,\\ \\dfrac{M_u}{4V_u}\\right)",
    substitution: `\\max(${fmtTex(w.geometry.lw)},\\ ${fmtTex(MuOver4Vu, { dp: 1 })}) = ${fmtTex(value, { dp: 1 })}\\ \\text{in.}`,
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
  const AgBeValue = sbe.width * sbe.length;
  const AgBe = derive({
    id: `${NS}.Ag_be`,
    symbol: "A_g,be",
    label: "gross area of the boundary element",
    value: AgBeValue,
    unit: "in2",
    formula: "A_{g,be} = b\\,\\ell_{be}",
    substitution: `${fmtTex(sbe.width, { dp: 1 })} \\times ${fmtTex(sbe.length, { dp: 1 })} = ${fmtTex(AgBeValue)}\\ \\text{in}^2`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [b, lbe],
  });

  const cover = input(`${NS}.cover`, "c_c", "clear cover to the hoops", w.geometry.cover, "in");
  const bc1Value = sbe.width - 2 * w.geometry.cover;
  const bc1 = derive({
    id: `${NS}.bc1`,
    symbol: "b_c1",
    label: "core dimension across the SBE width, to the outside of the hoops",
    value: bc1Value,
    unit: "in",
    formula: "b_{c1} = b - 2c_c",
    substitution: `${fmtTex(sbe.width, { dp: 1 })} - 2 \\times ${fmtTex(w.geometry.cover, { dp: 2 })} = ${fmtTex(bc1Value, { dp: 1 })}\\ \\text{in.}`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [b, cover],
  });
  const bc2Value = sbe.length - 2 * w.geometry.cover;
  const bc2 = derive({
    id: `${NS}.bc2`,
    symbol: "b_c2",
    label: "core dimension along the SBE length, to the outside of the hoops",
    value: bc2Value,
    unit: "in",
    formula: "b_{c2} = \\ell_{be} - 2c_c",
    substitution: `${fmtTex(sbe.length, { dp: 1 })} - 2 \\times ${fmtTex(w.geometry.cover, { dp: 2 })} = ${fmtTex(bc2Value, { dp: 1 })}\\ \\text{in.}`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [lbe, cover],
  });
  const AchValue = bc1Value * bc2Value;
  const Ach = derive({
    id: `${NS}.Ach`,
    symbol: "A_ch",
    label: "core area measured to the outside of the hoops",
    value: AchValue,
    unit: "in2",
    formula: "A_{ch} = b_{c1}\\,b_{c2}",
    substitution: `${fmtTex(bc1Value, { dp: 1 })} \\times ${fmtTex(bc2Value, { dp: 1 })} = ${fmtTex(AchValue)}\\ \\text{in}^2`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [bc1, bc2],
  });

  const fcPsi = ksiToPsi(w.concrete.fc);
  const fytPsi = ksiToPsi(w.grade.fy);
  const fyt = input(`${NS}.fyt`, "f_yt", "yield strength of the transverse reinforcement", fytPsi, "psi");
  const termA = 0.3 * (AgBeValue / AchValue - 1) * (fcPsi / fytPsi);
  const termB = 0.09 * (fcPsi / fytPsi);
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
      `\\max\\left[0.3\\left(\\dfrac{${fmtTex(AgBeValue)}}{${fmtTex(AchValue)}} - 1\\right)\\dfrac{${fmtTex(fcPsi)}}{${fmtTex(fytPsi)}},\\ ` +
      `0.09 \\times \\dfrac{${fmtTex(fcPsi)}}{${fmtTex(fytPsi)}}\\right] = \\max(${fmtTex(termA, { dp: 5 })},\\ ${fmtTex(termB, { dp: 5 })}) = ${fmtTex(ratioReqValue, { dp: 5 })}`,
    ref: aci("18.10.6.4", "Table 18.10.6.4(g)"),
    inputs: [AgBe, Ach, fyt],
    note: termA >= termB ? "the A_g/A_ch term governs" : "the 0.09f'c/f_yt floor governs",
  });

  const Ab = BARS[sbe.tieBar].Ab;
  const AbNode = input(
    `${NS}.Ab_tie`,
    "A_b,tie",
    `area of one tie leg (No. ${sbe.tieBar})`,
    Ab,
    "in2",
  );
  const legsReqValue = (ratioReqValue * sbe.tieSpacing * bc1Value) / Ab;
  const legsReq = derive({
    id: `${NS}.legs_req`,
    symbol: "n_legs,req",
    label: "tie legs required across the core width",
    value: legsReqValue,
    unit: "1",
    formula: "n_{legs} \\ge \\dfrac{(A_{sh}/s b_c)_{req}\\,s\\,b_{c1}}{A_{b,tie}}",
    substitution: `\\dfrac{${fmtTex(ratioReqValue, { dp: 5 })} \\times ${fmtTex(sbe.tieSpacing, { dp: 1 })} \\times ${fmtTex(bc1Value, { dp: 1 })}}{${fmtTex(Ab, { dp: 2 })}} = ${fmtTex(legsReqValue, { dp: 2 })}`,
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
    `A_sh provided = ${fmtTex(sbe.tieLegsAcrossWidth)} × ${fmtTex(Ab, { dp: 2 })} = ${fmtTex(sbe.tieLegsAcrossWidth * Ab, { dp: 2 })} in²; the required leg count is rounded up in practice`,
  );
}

/**
 * 18.10.6.5(b) — where a special boundary element is **not** required, boundary
 * longitudinal reinforcement with ρ > 400/f_y (psi) must be laterally supported,
 * with vertical spacing per Table 18.10.6.5(b).
 *
 * Only the Grade 60 rows are implemented (the engine's `GRADE80` is accepted but
 * the table's 80/100 ksi rows are flagged rather than silently mis-applied).
 */
function notRequired(w: WallInput, demand: Demands, req: SbeRequirement): CheckResult {
  const lw = lwInput(w);
  const h = hInput(w);

  // Boundary region per 18.10.6.4(a), i.e. the same length the ties would cover.
  const lengthValue = Math.max(req.c - 0.1 * w.geometry.lw, req.c / 2);
  const region = derive({
    id: `${NS}.alt.region`,
    symbol: "ℓ_be",
    label: "boundary region over which 18.10.6.5(b) applies",
    value: lengthValue,
    unit: "in",
    formula: "\\max\\left(c - 0.1\\ell_w,\\ c/2\\right)",
    substitution: `\\max(${fmtTex(req.c - 0.1 * w.geometry.lw, { dp: 2 })},\\ ${fmtTex(req.c / 2, { dp: 2 })}) = ${fmtTex(lengthValue, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("18.10.6.4", "18.10.6.4a"),
    inputs: [req.cNode, lw],
  });

  const stations = barPositions(w).filter((st) => st.x < lengthValue - 1e-6);
  const AsValue = stations.reduce((sum, st) => sum + st.area, 0);
  const As = input(
    `${NS}.alt.As`,
    "A_s,be",
    "boundary longitudinal steel",
    AsValue,
    "in2",
    `${stations.length} bar station(s) within ${fmtTex(lengthValue, { dp: 2 })} in. of the wall end`,
  );
  const rho = derive({
    id: `${NS}.alt.rho`,
    symbol: "ρ_be",
    label: "boundary longitudinal reinforcement ratio",
    value: AsValue / (lengthValue * w.geometry.h),
    unit: "1",
    formula: "\\rho_{be} = \\dfrac{A_{s,be}}{\\ell_{be}\\,h}",
    substitution: `\\dfrac{${fmtTex(AsValue, { dp: 2 })}}{${fmtTex(lengthValue, { dp: 2 })} \\times ${fmtTex(w.geometry.h, { dp: 1 })}} = ${fmtTex(AsValue / (lengthValue * w.geometry.h), { dp: 5 })}`,
    ref: aci("18.10.6.5", "18.10.6.5b"),
    inputs: [As, region, h],
  });

  const fyPsi = ksiToPsi(w.grade.fy);
  const coeff = constant(
    `${NS}.alt.coeff`,
    "400",
    "numerator of the 18.10.6.5(b) tie trigger (psi)",
    400,
    "1",
    aci("18.10.6.5", "18.10.6.5b"),
    "SI form 2.8/f_y (MPa)",
  );
  const limit = derive({
    id: `${NS}.alt.rho_limit`,
    symbol: "400/f_y",
    label: "boundary tie trigger",
    value: 400 / fyPsi,
    unit: "1",
    formula: "\\rho_{be} > 400/f_y",
    substitution: `400/${fmtTex(fyPsi)} = ${fmtTex(400 / fyPsi, { dp: 5 })}`,
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
    formula: "\\rho_{be} > 400/f_y",
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
    const grade60 = w.grade.fy <= 60 + TOL;
    const db = BARS[w.vertical.bar].db;
    const dbNode = input(
      `${NS}.alt.db`,
      "d_b",
      `smallest primary flexural bar diameter (No. ${w.vertical.bar})`,
      db,
      "in",
    );
    const critical = Math.max(
      w.geometry.lw,
      Math.abs(demand.Vu) > 0 ? kipFtToKipIn(Math.abs(demand.Mu)) / (4 * Math.abs(demand.Vu)) : 0,
    );
    const sReqValue = Math.min(6 * db, 6);
    const sReq = derive({
      id: `${NS}.alt.s_req`,
      symbol: "s_max",
      label: "maximum vertical spacing of boundary transverse reinforcement",
      value: sReqValue,
      unit: "in",
      formula: "s \\le \\min(6d_b,\\ 6\\ \\text{in.})",
      substitution: `\\min(6 \\times ${fmtTex(db, { dp: 3 })},\\ 6) = ${fmtTex(sReqValue, { dp: 2 })}\\ \\text{in.}`,
      ref: aci("18.10.6.5", "Table 18.10.6.5(b)"),
      inputs: [dbNode],
      note: grade60
        ? `Grade 60 row, within max(ℓ_w, M_u/4V_u) = ${fmtTex(critical, { dp: 1 })} in. of the critical section; elsewhere min(8d_b, 8 in.) = ${fmtTex(Math.min(8 * db, 8), { dp: 2 })} in.`
        : "Table 18.10.6.5(b) rows for Grade 80/100 are not implemented — the Grade 60 row is shown and must be reviewed",
      ...(grade60 ? {} : { status: "warning" as const }),
    });
    nodes.push(sReq);

    if (w.sbe !== undefined) {
      const sProv = input(
        `${NS}.alt.s_prov`,
        "s",
        "provided boundary tie spacing",
        w.sbe.tieSpacing,
        "in",
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
