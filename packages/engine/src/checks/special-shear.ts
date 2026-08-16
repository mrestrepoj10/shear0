/**
 * ACI 318-19 §18.10.3 (design shear force) and §18.10.4 (shear strength) for
 * special structural walls, with the §21.2.4.1 seismic φ decision.
 *
 * The two halves are deliberately separate exports: `amplifiedShear` produces
 * V_e (and its Ω_v/ω_v/M_pr ingredients) because the boundary-element
 * drift-capacity equation of 18.10.6.2(b) needs the same V_e, and
 * `checkSpecialShear` consumes it as the demand.
 */
import { aci, checkResult, constant, derive, input } from "../trace";
import type { CheckResult, Traced } from "../trace";
import { AstInput, cAt, fcKsi, fyInput, mprAt, sectionAt } from "../section/interaction";
import { lambdaInput } from "../materials";
import { fmtTex, kipFtToKipIn } from "../units";
import type { UnitScheme } from "../units";
import { Acv, hInput, hwcsInput, hwcsOverLw, hwcsValue, lwInput, schemeOf } from "../wall";
import type { Demands, WallInput } from "../wall";
import { rhoProvidedNode } from "./min-reinforcement";
import { alphaC } from "./shear-in-plane";
import { sqrtFcNode } from "./special-reinforcement";

const TOL = 1e-9;

const NS_VE = "sw.ve";
const NS = "sw.shear";

export interface AmplifiedShear {
  /** V_e = Ω_v ω_v V_u ≤ 3V_u, in the force unit of the edition (kip / kN) */
  Ve: Traced;
  /** ω_v, dynamic amplification, Eq. (18.10.3.1.3) */
  omegaV: Traced;
  /** Ω_v, overstrength, Table 18.10.3.1.2 */
  OmegaV: Traced;
  /** M_pr at this combination's P_u, in the moment unit of the edition (kip-ft / kN·m) */
  Mpr: Traced;
}

// V_e is consumed by two checks (18.10.4 strength and the 18.10.6.2(b) drift
// capacity). Memoizing per (wall, demand) keeps one node object per id, so the
// two trace graphs share nodes instead of colliding on duplicate ids.
const amplified = new WeakMap<WallInput, WeakMap<Demands, AmplifiedShear>>();

/**
 * V_e = Ω_v ω_v V_u ≤ 3V_u — ACI 318-19 §18.10.3.1.
 *
 * **Per-load-combination.** Table 18.10.3.1.2 defines Ω_v with M_pr/M_u "for
 * the load combination that maximizes it"; this engine evaluates Ω_v with the
 * M_pr and M_u of the combination handed to it, and the caller compares
 * combinations. For a single-combination design (MNL-17 Ex. 2) the two readings
 * coincide.
 */
export function amplifiedShear(w: WallInput, demand: Demands): AmplifiedShear {
  let byDemand = amplified.get(w);
  if (byDemand === undefined) {
    byDemand = new WeakMap();
    amplified.set(w, byDemand);
  }
  const hit = byDemand.get(demand);
  if (hit !== undefined) return hit;
  const built = buildAmplifiedShear(w, demand);
  byDemand.set(demand, built);
  return built;
}

function buildAmplifiedShear(w: WallInput, demand: Demands): AmplifiedShear {
  // 18.10.3.1 is dimensionless throughout (Ω_v, ω_v and the 3V_u cap are the
  // same in both editions), but V_e and its force/moment leaves are reported in
  // the units of the edition in force — kip/kip-ft or kN/kN·m.
  const U = schemeOf(w);
  const ratio = hwcsOverLw(w);
  const hwcs = hwcsInput(w);
  const VuCode = U.frc(Math.abs(demand.Vu));
  const Vu = input(
    `${NS_VE}.Vu`,
    "V_u",
    `factored in-plane shear (${demand.label ?? demand.id})`,
    VuCode,
    U.force,
  );
  const Mu = input(
    `${NS_VE}.Mu`,
    "M_u",
    `factored in-plane moment (${demand.label ?? demand.id})`,
    U.mom(Math.abs(demand.Mu)),
    U.moment,
  );
  const Pu = input(
    `${NS_VE}.Pu`,
    "P_u",
    `factored axial force (${demand.label ?? demand.id})`,
    U.frc(demand.Pu),
    U.force,
  );

  // --- M_pr and Ω_v (Table 18.10.3.1.2) ------------------------------------
  // `mprAt` already reports in the wall's moment unit (kip-ft | kN·m) — the
  // conversion happens at the interaction module's reporting boundary, so it
  // must not be applied a second time here.
  const MprValue = mprAt(w, demand.Pu);
  const Mpr = derive({
    id: `${NS_VE}.Mpr`,
    symbol: "M_pr",
    label: "probable flexural strength",
    value: MprValue,
    unit: U.moment,
    formula: "M_{pr} = M_n(1.25 f_y,\\ \\phi = 1.0)\\ \\text{at}\\ P_u",
    substitution: `M_{pr} = ${fmtTex(MprValue)}\\ ${U.si ? "\\text{kN·m}" : "\\text{kip-ft}"}\\text{ at } P_u = ${fmtTex(U.frc(demand.Pu))}\\ ${U.forceTex}`,
    ref: aci("18.10.3.1.2"),
    inputs: [Pu, fcKsi(w), lwInput(w), hInput(w), fyInput(w), AstInput(w)],
    note: "fiber section re-solved with f_y replaced by 1.25 f_y (R18.10.3.1)",
  });

  const squat = ratio.value <= 1.5 + TOL;
  const floorOmega = constant(
    `${NS_VE}.Omega_floor`,
    "1.5",
    "lower bound on Ω_v",
    1.5,
    "1",
    aci("18.10.3.1.2", "Table 18.10.3.1.2"),
    "may be reduced by a detailed analysis of probable strength, but never below 1.0",
  );
  // A ratio of two moments — identical in both editions, but assembled from the
  // already-converted leaves so the substitution reads consistently.
  const mprRatioValue = Mu.value > 0 ? MprValue / Mu.value : Infinity;
  const mprRatio = derive({
    id: `${NS_VE}.Mpr_over_Mu`,
    symbol: "M_pr/M_u",
    label: "overstrength ratio",
    value: mprRatioValue,
    unit: "1",
    formula: "M_{pr}/M_u",
    substitution: `${fmtTex(MprValue)} / ${fmtTex(Mu.value)} = ${fmtTex(mprRatioValue, { dp: 3 })}`,
    ref: aci("18.10.3.1.2", "Table 18.10.3.1.2"),
    inputs: [Mpr, Mu],
  });

  const OmegaValue = squat ? 1 : Math.max(mprRatioValue, floorOmega.value);
  const OmegaV = derive({
    id: `${NS_VE}.Omega_v`,
    symbol: "Ω_v",
    label: "overstrength factor",
    value: OmegaValue,
    unit: "1",
    formula:
      "\\Omega_v = \\begin{cases} 1.0 & h_{wcs}/\\ell_w \\le 1.5 \\\\ \\max(M_{pr}/M_u,\\ 1.5) & h_{wcs}/\\ell_w > 1.5 \\end{cases}",
    substitution: squat
      ? `h_{wcs}/\\ell_w = ${fmtTex(ratio.value, { dp: 3 })} \\le 1.5 \\Rightarrow \\Omega_v = 1.0`
      : `\\max(${fmtTex(mprRatioValue, { dp: 3 })},\\ 1.5) = ${fmtTex(OmegaValue, { dp: 3 })}`,
    ref: aci("18.10.3.1.2", "Table 18.10.3.1.2"),
    inputs: squat ? [ratio, floorOmega] : [mprRatio, floorOmega, ratio],
    note: squat
      ? "squat wall — no overstrength amplification"
      : mprRatioValue < floorOmega.value
        ? "the 1.5 floor governs"
        : "M_pr/M_u governs",
  });

  // --- ω_v (Eq. 18.10.3.1.3) ------------------------------------------------
  // n_s ≥ 0.007 h_wcs. Both editions print the coefficient as **0.007** — it is
  // absent from the ACI 318M-19 Appendix C list of nonhomogeneous equations, and
  // 18.10.3.1.3 on the metric page carries no requalification of h_wcs. But the
  // expression is dimensional (a story count per unit height), so 0.007 is only
  // meaningful on the inch basis it was calibrated for: read literally against
  // h_wcs in mm it would demand ~25x the stories. Rather than invent a metric
  // constant the Code does not print, SI mode applies the printed 0.007 to
  // h_wcs converted to inches, and the trace says so.
  const nsFloorCoeff = constant(
    `${NS_VE}.ns_floor_coeff`,
    "0.007",
    "coefficient of the n_s floor (h_wcs in inches)",
    0.007,
    "1",
    aci("18.10.3.1.3"),
    U.si
      ? "ACI 318M-19 18.10.3.1.3 prints the same 0.007 with no metric requalification of h_wcs; it is applied here on the inch basis it was calibrated for"
      : "in-lb edition: n_s ≥ 0.007 h_wcs with h_wcs in inches",
  );
  const hwcsIn = hwcsValue(w);
  const nsFloorValue = 0.007 * hwcsIn;
  const nsFloor = derive({
    id: `${NS_VE}.ns_floor`,
    symbol: "0.007h_wcs",
    label: "lower bound on the number of stories",
    value: nsFloorValue,
    unit: "1",
    formula: "n_s \\ge 0.007\\,h_{wcs}",
    substitution: U.si
      ? `0.007 \\times \\dfrac{${fmtTex(hwcs.value)}}{25.4} = 0.007 \\times ${fmtTex(hwcsIn)} = ${fmtTex(nsFloorValue, { dp: 2 })}`
      : `0.007 \\times ${fmtTex(hwcsIn)} = ${fmtTex(nsFloorValue, { dp: 2 })}`,
    ref: aci("18.10.3.1.3"),
    inputs: [nsFloorCoeff, hwcs],
    note: U.si
      ? "accounts for buildings with large story heights [R18.10.3.1.3]; h_wcs is taken in inches because ACI 318M-19 prints the 0.007 coefficient unchanged and unqualified — see the coefficient note"
      : "accounts for buildings with large story heights [R18.10.3.1.3]",
  });

  const nsGiven = input(
    `${NS_VE}.ns_given`,
    "n_s,input",
    "stories above the critical section",
    w.seismic?.ns ?? 0,
    "1",
    w.seismic?.ns === undefined ? "not supplied — only the 0.007h_wcs floor is available" : undefined,
  );
  const nsValue = Math.max(nsGiven.value, nsFloorValue);
  const floorGoverns = nsFloorValue > nsGiven.value;
  const nsNode = derive({
    id: `${NS_VE}.ns`,
    symbol: "n_s",
    label: "number of stories used in ω_v",
    value: nsValue,
    unit: "1",
    formula: "n_s = \\max(n_{s,input},\\ 0.007\\,h_{wcs})",
    substitution: `\\max(${fmtTex(nsGiven.value, { dp: 2 })},\\ ${fmtTex(nsFloorValue, { dp: 2 })}) = ${fmtTex(nsValue, { dp: 2 })}`,
    ref: aci("18.10.3.1.3"),
    inputs: [nsGiven, nsFloor],
    note: floorGoverns
      ? "the 0.007h_wcs floor governs"
      : "the supplied story count governs the 0.007h_wcs floor",
  });

  const slender = ratio.value >= 2 - TOL;
  let omegaValue: number;
  let omegaSubst: string;
  let omegaNote: string;
  if (!slender) {
    omegaValue = 1;
    omegaSubst = `h_{wcs}/\\ell_w = ${fmtTex(ratio.value, { dp: 3 })} < 2.0 \\Rightarrow \\omega_v = 1.0`;
    omegaNote = "no dynamic amplification for walls with h_wcs/ℓ_w < 2.0";
  } else if (nsValue <= 6) {
    omegaValue = 0.9 + nsValue / 10;
    omegaSubst = `\\omega_v = 0.9 + ${fmtTex(nsValue, { dp: 2 })}/10 = ${fmtTex(omegaValue, { dp: 3 })}`;
    omegaNote = "n_s ≤ 6 branch";
  } else {
    const raw = 1.3 + nsValue / 30;
    omegaValue = Math.min(raw, 1.8);
    omegaSubst =
      `\\omega_v = \\min\\left(1.3 + ${fmtTex(nsValue, { dp: 2 })}/30,\\ 1.8\\right) = ` +
      `\\min(${fmtTex(raw, { dp: 3 })},\\ 1.8) = ${fmtTex(omegaValue, { dp: 3 })}`;
    omegaNote = raw > 1.8 ? "n_s > 6 branch; the 1.8 cap governs" : "n_s > 6 branch";
  }
  const omegaV = derive({
    id: `${NS_VE}.omega_v`,
    symbol: "ω_v",
    label: "dynamic amplification factor",
    value: omegaValue,
    unit: "1",
    formula:
      "\\omega_v = \\begin{cases} 1.0 & h_{wcs}/\\ell_w < 2.0 \\\\ 0.9 + n_s/10 & n_s \\le 6 \\\\ \\min(1.3 + n_s/30,\\ 1.8) & n_s > 6 \\end{cases}",
    substitution: omegaSubst,
    ref: aci("18.10.3.1.3", "18.10.3.1.3"),
    inputs: slender ? [nsNode, ratio] : [ratio],
    note: omegaNote,
  });

  // --- V_e ------------------------------------------------------------------
  const rawValue = OmegaValue * omegaValue * VuCode;
  const raw = derive({
    id: `${NS_VE}.Ve_raw`,
    symbol: "Ω_vω_vV_u",
    label: "amplified shear before the 3V_u cap",
    value: rawValue,
    unit: U.force,
    formula: "\\Omega_v\\,\\omega_v\\,V_u",
    substitution: `${fmtTex(OmegaValue, { dp: 3 })} \\times ${fmtTex(omegaValue, { dp: 3 })} \\times ${fmtTex(VuCode)} = ${fmtTex(rawValue)}\\ ${U.forceTex}`,
    ref: aci("18.10.3.1", "18.10.3.1"),
    inputs: [OmegaV, omegaV, Vu],
  });

  const capCoeff = constant(
    `${NS_VE}.cap_coeff`,
    "3",
    "cap coefficient on V_u",
    3,
    "1",
    aci("18.10.3.1", "18.10.3.1"),
    "Ω_v·ω_v need not exceed 3.0",
  );
  // The 3V_u cap is dimensionless — identical in ACI 318M-19 18.10.3.1.
  const capValue = 3 * VuCode;
  const cap = derive({
    id: `${NS_VE}.cap`,
    symbol: "3V_u",
    label: "upper limit on the design shear",
    value: capValue,
    unit: U.force,
    formula: "3\\,V_u",
    substitution: `3 \\times ${fmtTex(VuCode)} = ${fmtTex(capValue)}\\ ${U.forceTex}`,
    ref: aci("18.10.3.1", "18.10.3.1"),
    inputs: [capCoeff, Vu],
  });

  const capped = rawValue > capValue;
  const VeValue = capped ? capValue : rawValue;
  const Ve = derive({
    id: `${NS_VE}.Ve`,
    symbol: "V_e",
    label: "design shear force for special structural walls",
    value: VeValue,
    unit: U.force,
    formula: "V_e = \\min\\left(\\Omega_v\\,\\omega_v\\,V_u,\\ 3V_u\\right)",
    substitution: `\\min(${fmtTex(rawValue)},\\ ${fmtTex(capValue)}) = ${fmtTex(VeValue)}\\ ${U.forceTex}`,
    ref: aci("18.10.3.1", "18.10.3.1"),
    inputs: [raw, cap],
    note: capped ? "the 3V_u cap governs" : "the 3V_u cap does not govern",
  });

  return { Ve, omegaV, OmegaV, Mpr };
}

/**
 * In-plane shear strength of a special structural wall — §18.10.4.
 *
 * V_n = (α_c λ√f'c + ρ_t f_yt) A_cv (Eq. 18.10.4.1, identical in form to
 * Eq. 11.5.4.3), limited by 8√f'c·A_cv for all segments sharing a lateral force
 * (18.10.4.4) and by 10√f'c·A_cw for an individual vertical segment (18.10.4.5).
 * This engine models one segment, so A_cw = A_cv and the 8√f'c limit always
 * governs — both are traced so the reader can see why.
 *
 * The limits are nonhomogeneous; ACI 318M-19 prints 0.66√f'c·A_cv (18.10.4.4)
 * and 0.83√f'c·A_cw (18.10.4.5), in MPa and mm².
 *
 * The demand is **V_e**, not V_u (18.10.3.1).
 */
export function checkSpecialShear(w: WallInput, demand: Demands): CheckResult {
  const U = schemeOf(w);
  const acv = Acv(w);
  const sqrt = sqrtFcNode(w, NS, U);
  const lambda = lambdaInput(w.concrete);
  const ac = alphaC(w, demand);
  const rhoT = rhoProvidedNode(w, NS, "t", w.horizontal);
  const ve = amplifiedShear(w, demand);
  const sqrtDp = U.si ? 3 : 1;

  // Eq. (18.10.4.1) is the same expression in both editions; α_c carries the
  // 3.0/2.0 → 0.25/0.17 split of 18.10.4.1 (see `alphaC`, 11.5.4.3).
  const VncValue = (ac.value * w.concrete.lambda * sqrt.value * acv.value) / 1000;
  const Vnc = derive({
    id: `${NS}.Vnc`,
    symbol: "V_nc",
    label: "concrete contribution to in-plane shear strength",
    value: VncValue,
    unit: U.force,
    formula: "V_{nc} = \\alpha_c\\,\\lambda\\sqrt{f'_c}\\,A_{cv}",
    substitution: `${fmtTex(ac.value, { dp: U.si ? 4 : 2 })} \\times ${fmtTex(w.concrete.lambda, { dp: 2 })} \\times ${fmtTex(sqrt.value, { dp: sqrtDp })} \\times ${fmtTex(acv.value)} = ${fmtTex(VncValue)}\\ ${U.forceTex}`,
    ref: aci("18.10.4.1", "18.10.4.1"),
    inputs: [ac, lambda, sqrt, acv],
    note: U.si ? "MPa × mm² → N, reported in kN" : "psi × in² → lb, reported in kip",
  });

  const fytCode = U.str(w.grade.fy);
  const fyt = input(
    `${NS}.fyt`,
    "f_yt",
    "specified yield strength of transverse reinforcement",
    fytCode,
    U.stress,
  );
  const VnsValue = (rhoT.value * fytCode * acv.value) / 1000;
  const Vns = derive({
    id: `${NS}.Vns`,
    symbol: "V_ns",
    label: "horizontal reinforcement contribution to in-plane shear strength",
    value: VnsValue,
    unit: U.force,
    formula: "V_{ns} = \\rho_t\\,f_{yt}\\,A_{cv}",
    substitution: `${fmtTex(rhoT.value, { dp: 5 })} \\times ${fmtTex(fytCode)} \\times ${fmtTex(acv.value)} = ${fmtTex(VnsValue)}\\ ${U.forceTex}`,
    ref: aci("18.10.4.1", "18.10.4.1"),
    inputs: [rhoT, fyt, acv],
  });

  const VnCalcValue = VncValue + VnsValue;
  const VnCalc = derive({
    id: `${NS}.Vn_calc`,
    symbol: "V_n,calc",
    label: "nominal in-plane shear strength from Eq. (18.10.4.1)",
    value: VnCalcValue,
    unit: U.force,
    formula: "V_n = \\left(\\alpha_c\\,\\lambda\\sqrt{f'_c} + \\rho_t f_{yt}\\right) A_{cv}",
    substitution: `${fmtTex(VncValue)} + ${fmtTex(VnsValue)} = ${fmtTex(VnCalcValue)}\\ ${U.forceTex}`,
    ref: aci("18.10.4.1", "18.10.4.1"),
    inputs: [Vnc, Vns],
  });

  // 18.10.4.4 — 8√f'c·A_cv (psi, in²) / ACI 318M-19 18.10.4.4 0.66√f'c·A_cv
  // (MPa, mm²); 18.10.4.5 — 10√f'c·A_cw / ACI 318M-19 18.10.4.5 0.83√f'c·A_cw.
  const cap8Coeff = U.si ? 0.66 : 8;
  const cap8CoeffTex = U.si ? "0.66" : "8";
  const cap8 = capNode(w, U, sqrt, acv, cap8Coeff, cap8CoeffTex, "cap_8", "18.10.4.4", "A_cv", acv.value);
  const cap10 = capNode(
    w,
    U,
    sqrt,
    acv,
    U.si ? 0.83 : 10,
    U.si ? "0.83" : "10",
    "cap_10",
    "18.10.4.4",
    "A_cw",
    acv.value,
  );

  const VnValue = Math.min(VnCalcValue, cap8.value);
  const Vn = derive({
    id: `${NS}.Vn`,
    symbol: "V_n",
    label: "nominal in-plane shear strength",
    value: VnValue,
    unit: U.force,
    formula: `V_n = \\min\\left(V_{n,calc},\\ ${cap8CoeffTex}\\sqrt{f'_c}A_{cv}\\right)`,
    substitution: `\\min(${fmtTex(VnCalcValue)},\\ ${fmtTex(cap8.value)}) = ${fmtTex(VnValue)}\\ ${U.forceTex}`,
    ref: aci("18.10.4.4"),
    inputs: [VnCalc, cap8, cap10],
    note:
      `18.10.4.4 sets two limits: ${cap8CoeffTex}√f'c·A_cv on all vertical wall segments resisting a common lateral force and ${U.si ? "0.83" : "10"}√f'c·A_cw on any one segment. ` +
      `This engine models a single segment, so A_cw = A_cv and the ${cap8CoeffTex}√f'c limit always governs` +
      (VnCalcValue > cap8.value ? "; it is reached here, so added horizontal reinforcement cannot raise V_n" : ""),
  });

  const phi = seismicPhiShear(w, U, VnValue, Vn, cap10);
  const phiVnValue = phi.node.value * VnValue;
  const phiVn = derive({
    id: `${NS}.phiVn`,
    symbol: "φV_n",
    label: "design in-plane shear strength",
    value: phiVnValue,
    unit: U.force,
    formula: "\\phi V_n",
    substitution: `${fmtTex(phi.node.value, { dp: 2 })} \\times ${fmtTex(VnValue)} = ${fmtTex(phiVnValue)}\\ ${U.forceTex}`,
    ref: aci("18.10.4"),
    inputs: [phi.node, Vn],
  });

  const utilValue = phiVnValue > 0 ? ve.Ve.value / phiVnValue : Number.POSITIVE_INFINITY;
  const util = derive({
    id: `${NS}.utilization`,
    symbol: "V_e/φV_n",
    label: "in-plane shear utilization",
    value: utilValue,
    unit: "1",
    formula: "\\frac{V_e}{\\phi V_n} \\le 1.0",
    substitution: `\\frac{${fmtTex(ve.Ve.value)}}{${fmtTex(phiVnValue)}} = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("18.10.4"),
    inputs: [ve.Ve, phiVn],
    note: "the demand is the amplified design shear V_e of 18.10.3.1, not V_u",
  });

  return checkResult({
    id: "sw.in-plane-shear",
    title: "Special wall in-plane shear strength",
    ref: aci("18.10.4", "18.10.4.1"),
    demand: ve.Ve,
    capacity: phiVn,
    utilization: util,
    trace: [ve.Ve, Vn, ...phi.trace, phiVn, util],
  });
}

/**
 * The 18.10.4.4 / 18.10.4.5 upper limits on V_n, in the force unit of the
 * edition. The coefficients are nonhomogeneous:
 *   18.10.4.4 — 8√f'c·A_cv  (psi, in²) / ACI 318M-19 0.66√f'c·A_cv  (MPa, mm²)
 *   18.10.4.5 — 10√f'c·A_cw (psi, in²) / ACI 318M-19 0.83√f'c·A_cw (MPa, mm²)
 */
function capNode(
  w: WallInput,
  U: UnitScheme,
  sqrt: Traced,
  acv: Traced,
  coeff: number,
  coeffTex: string,
  key: string,
  ref: string,
  areaSymbol: string,
  areaValue: number,
): Traced {
  const c = constant(
    `${NS}.${key}_coeff`,
    coeffTex,
    `upper-limit coefficient on V_n (${areaSymbol})`,
    coeff,
    "1",
    aci(ref),
    areaSymbol === "A_cv"
      ? "all vertical wall segments resisting a common lateral force"
      : "any one vertical wall segment; A_cw is the area of that segment",
  );
  const value = (coeff * sqrt.value * areaValue) / 1000;
  return derive({
    id: `${NS}.${key}`,
    symbol: `${coeffTex}√f'_c·${areaSymbol}`,
    label: "upper limit on nominal in-plane shear strength",
    value,
    unit: U.force,
    formula: `${coeffTex}\\sqrt{f'_c}\\,${areaSymbol === "A_cv" ? "A_{cv}" : "A_{cw}"}`,
    substitution: `${coeffTex} \\times ${fmtTex(sqrt.value, { dp: U.si ? 3 : 1 })} \\times ${fmtTex(areaValue)} = ${fmtTex(value)}\\ ${U.forceTex}`,
    ref: aci(ref),
    inputs: [c, sqrt, acv],
    note: areaSymbol === "A_cw" ? "single-segment wall: A_cw = A_cv" : undefined,
  });
}

interface PhiSelection {
  node: Traced;
  trace: Traced[];
}

/**
 * φ for shear per §21.2.4.1, with the §18.10.4.6 exemption exposed as a setting.
 *
 * 21.2.4.1 drops φ to 0.60 for any member resisting E whose nominal shear
 * strength is less than the shear corresponding to development of its nominal
 * moment strength. Two modelling decisions are made here and traced:
 *
 * 1. **The shear at M_n** is taken as `V@Mn = 2 M_n / h_sx` — MNL-17(21) Ex. 2's
 *    reading, a first-story cantilever developing M_n over the story height. It
 *    requires `seismic.hsx`; without it the decision cannot be made and φ = 0.75
 *    is kept with a warning.
 * 2. **M_n is maximized over the axial forces of the E combinations**, so the
 *    largest P_u among the supplied demands is used.
 *
 * The handbook additionally observes that V@Mn exceeds the 10√f'c·A_cw cap of
 * 18.10.4.4, i.e. the wall cannot develop M_n at any amount of horizontal
 * reinforcement. That comparison is traced alongside the governing V_n < V@Mn
 * test.
 */
function seismicPhiShear(
  w: WallInput,
  U: UnitScheme,
  VnValue: number,
  Vn: Traced,
  cap10: Traced,
): PhiSelection {
  const phiNode = (value: 0.6 | 0.75, subst: string, inputs: Traced[], note: string, status?: "warning"): Traced =>
    derive({
      id: `${NS}.phi`,
      symbol: "φ",
      label: "strength reduction factor for shear",
      value,
      unit: "1",
      formula: "\\phi = 0.60 \\ \\text{if}\\ V_n < V@M_n,\\ \\text{else}\\ 0.75",
      substitution: subst,
      ref: aci("21.2.4.1"),
      inputs,
      ...(status !== undefined ? { status } : {}),
      note,
    });

  const reading = w.phiSeismicReading ?? "handbook-conservative";
  const ratio = hwcsOverLw(w);
  const displacementPath = ratio.value >= 2 - TOL;

  if (reading === "exempt-18.10.4.6" && displacementPath) {
    const node = phiNode(
      0.75,
      `h_{wcs}/\\ell_w = ${fmtTex(ratio.value, { dp: 3 })} \\ge 2.0 \\Rightarrow \\text{18.10.6.2 applies} \\Rightarrow \\phi = 0.75`,
      [ratio],
      "18.10.4.6: the requirements of 21.2.4.1 shall not apply to walls designed according to 18.10.6.2 (setting: exempt-18.10.4.6)",
    );
    return { node, trace: [node] };
  }

  const hsx = w.seismic?.hsx;
  if (hsx === undefined || !(hsx > 0)) {
    const node = phiNode(
      0.75,
      `h_{sx}\\ \\text{not supplied} \\Rightarrow V@M_n\\ \\text{unknown} \\Rightarrow \\phi = 0.75`,
      [Vn],
      "21.2.4.1 could not be evaluated: the first-story height h_sx is required to compute the shear at M_n. φ = 0.75 (Table 21.2.1) is used; supply seismic.hsx to apply 21.2.4.1",
      "warning",
    );
    return { node, trace: [node] };
  }

  const PuMax = w.demands.length > 0 ? Math.max(...w.demands.map((d) => d.Pu)) : 0;
  let MnValue: number;
  try {
    // `cAt` and `SectionPoint` both speak the wall's reporting system already,
    // so they compose directly and must not be converted again; the whole φ
    // decision below is then done in that system (kip-ft/in or kN·m/mm).
    MnValue = sectionAt(w, cAt(w, PuMax)).Mn;
  } catch {
    const node = phiNode(
      0.75,
      `M_n\\ \\text{is undefined at}\\ P_u = ${fmtTex(U.frc(PuMax))}\\ ${U.forceTex} \\Rightarrow \\phi = 0.75`,
      [Vn],
      "21.2.4.1 could not be evaluated: P_u,max lies outside the nominal axial range of the section",
      "warning",
    );
    return { node, trace: [node] };
  }

  const PuMaxNode = input(
    `${NS}.Pu_max`,
    "P_u,max",
    "largest factored axial force among the E load combinations",
    U.frc(PuMax),
    U.force,
    "21.2.4.1: M_n is maximized over the factored axial forces of the E combinations",
  );
  const Mn = derive({
    id: `${NS}.Mn`,
    symbol: "M_n",
    label: "nominal flexural strength at P_u,max",
    value: MnValue,
    unit: U.moment,
    formula: "M_n\\ \\text{at}\\ P_n(c) = P_{u,max}",
    substitution: `M_n = ${fmtTex(MnValue)}\\ ${U.si ? "\\text{kN·m}" : "\\text{kip-ft}"}\\text{ at } P_u = ${fmtTex(U.frc(PuMax))}\\ ${U.forceTex}`,
    ref: aci("21.2.4.1"),
    inputs: [PuMaxNode, fcKsi(w), lwInput(w), hInput(w), fyInput(w), AstInput(w)],
  });

  const hsxNode = input(`${NS}.hsx`, "h_sx", "first-story height", U.len(hsx), U.length);
  // 21.2.4.1 is dimensionless, but 2M_n/h_sx divides a moment by a length, so
  // the arithmetic is done in the local system: kip-ft → kip-in. against h_sx in
  // inches, or kN·m → kN·mm (×1000) against h_sx in mm, either way landing on
  // the system's force unit.
  const MnLocal = U.si ? MnValue * 1000 : kipFtToKipIn(MnValue);
  const vAtMnValue = (2 * MnLocal) / hsxNode.value;
  const vAtMn = derive({
    id: `${NS}.V_at_Mn`,
    symbol: "V@M_n",
    label: "shear corresponding to development of the nominal moment strength",
    value: vAtMnValue,
    unit: U.force,
    formula: "V@M_n = \\dfrac{2 M_n}{h_{sx}}",
    substitution: `\\dfrac{2 \\times ${fmtTex(MnLocal)}}{${fmtTex(hsxNode.value)}} = ${fmtTex(vAtMnValue)}\\ ${U.forceTex}`,
    ref: aci("21.2.4.1"),
    inputs: [Mn, hsxNode],
    note:
      `MNL-17(21) Ex. 2 convention: the first-story wall develops M_n over the story height h_sx, so the story shear is 2M_n/h_sx (M_n in ${U.si ? "kN·m is converted to kN·mm" : "kip-ft is converted to kip-in."}). ` +
      "The handbook's printed 4650 kip is reproduced exactly by putting the *design* moment φM_n read off the interaction diagram in place of M_n; 21.2.4.1 says nominal, which is what is used here and is the more conservative of the two",
  });

  // The handbook's phrasing of the same test: V@M_n exceeds even the absolute
  // 18.10.4.4 ceiling, so no amount of horizontal reinforcement lets the wall
  // reach M_n in shear. Informational — the governing test is V_n < V@M_n.
  const overCap = vAtMnValue > cap10.value;
  // 10√f'c·A_cw (psi, in²) / ACI 318M-19 18.10.4.5 0.83√f'c·A_cw (MPa, mm²).
  const cap10CoeffTex = U.si ? "0.83" : "10";
  const capCompare = derive({
    id: `${NS}.V_at_Mn_vs_cap`,
    symbol: `V@M_n / ${cap10CoeffTex}√f'_c·A_cw`,
    label: "shear at M_n against the absolute 18.10.4.4 ceiling",
    value: cap10.value > 0 ? vAtMnValue / cap10.value : Number.POSITIVE_INFINITY,
    unit: "1",
    formula: `V@M_n\\ \\text{vs}\\ ${cap10CoeffTex}\\sqrt{f'_c}A_{cw}`,
    substitution: `${fmtTex(vAtMnValue)} ${overCap ? ">" : "\\le"} ${fmtTex(cap10.value)} = ${fmtTex(cap10.value > 0 ? vAtMnValue / cap10.value : Infinity, { dp: 3 })}`,
    ref: aci("18.10.4.4"),
    inputs: [vAtMn, cap10],
    note: overCap
      ? "the shear at M_n exceeds the 18.10.4.4 ceiling, so the wall cannot develop M_n at any amount of horizontal reinforcement (MNL-17(21) Ex. 2 states the φ = 0.60 conclusion this way)"
      : "the shear at M_n is within the 18.10.4.4 ceiling",
  });

  const cannotDevelop = VnValue < vAtMnValue;
  const node = phiNode(
    cannotDevelop ? 0.6 : 0.75,
    `V_n = ${fmtTex(VnValue)} ${cannotDevelop ? "<" : "\\ge"} V@M_n = ${fmtTex(vAtMnValue)} \\Rightarrow \\phi = ${cannotDevelop ? "0.60" : "0.75"}`,
    [Vn, vAtMn],
    cannotDevelop
      ? "21.2.4.1: the nominal shear strength is less than the shear corresponding to development of M_n, so φ = 0.60. Note that 18.10.4.6 exempts walls designed by 18.10.6.2 from 21.2.4.1; MNL-17(21) Ex. 2 nevertheless applies φ = 0.60 and this engine follows that reading by default (set phiSeismicReading: \"exempt-18.10.4.6\" for the other one)"
      : "21.2.4.1: the wall can develop M_n, so the Table 21.2.1 value φ = 0.75 stands",
  );

  return { node, trace: [vAtMn, capCompare, node] };
}
