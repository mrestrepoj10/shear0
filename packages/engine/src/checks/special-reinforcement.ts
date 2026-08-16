/**
 * ACI 318-19 §18.10.2 / §18.10.4.3 — web reinforcement rules for **special
 * structural walls**.
 *
 * Four provisions are evaluated in one check, because they all constrain the
 * same two distributed layers:
 *
 *   - **18.10.2.1** ρ_ℓ, ρ_t ≥ 0.0025 (relaxed to the Table 11.6.1 values when
 *     V_u ≤ λ√f'c·A_cv), spacing ≤ 18 in. each way.
 *   - **18.10.2.2** two curtains where V_u > 2λ√f'c·A_cv **or** h_w/ℓ_w ≥ 2.0.
 *   - **18.10.4.3** ρ_ℓ ≥ ρ_t when h_w/ℓ_w ≤ 2.0 (N/A for slender walls).
 *   - **18.10.2.4** end-zone longitudinal ratio ≥ 6√f'c/f_y over the 0.15ℓ_w × h
 *     strip at each wall end, for walls with h_w/ℓ_w ≥ 2.0.
 *
 * The demand that drives 18.10.2.1/.2.2 is V_u — the **unamplified** analysis
 * shear, not V_e: both provisions are written against V_u.
 */
import { fcInput, lambdaInput } from "../materials";
import { aci, checkResult, constant, derive, input } from "../trace";
import type { CheckResult, Traced } from "../trace";
import { fmtTex, unitScheme } from "../units";
import type { UnitScheme } from "../units";
import { Acv, barPositions, hInput, hwOverLw, lwInput, schemeOf } from "../wall";
import type { Demands, WallInput } from "../wall";
import { rhoProvidedNode } from "./min-reinforcement";

const TOL = 1e-9;

const NS = "sw.reinf";

/**
 * √f'c in the stress unit of the edition in force (psi / MPa), namespaced per
 * check. Like `materials.fcInput`/`beta1`/`Ec` the scheme is an optional
 * argument defaulting to in-lb, so existing callers are unchanged.
 */
export function sqrtFcNode(w: WallInput, ns: string, U: UnitScheme = unitScheme()): Traced {
  const fc = fcInput(w.concrete, U);
  const value = U.sqrtFc(w.concrete.fc);
  return derive({
    id: `${ns}.sqrt_fc`,
    symbol: "√f'_c",
    label: "square root of the specified compressive strength",
    value,
    unit: U.stress,
    formula: "\\sqrt{f'_c}",
    substitution: `\\sqrt{${fmtTex(U.str(w.concrete.fc))}} = ${fmtTex(value, { dp: U.si ? 3 : 1 })}\\ ${U.stressTex}^{0.5}`,
    inputs: [fc],
  });
}

/**
 * n·λ√f'c·A_cv — the shear yardstick both 18.10.2.1 and 18.10.2.2 use, in the
 * force unit of the edition (kip / kN).
 *
 * The coefficient is nonhomogeneous and each edition prints its own:
 *   18.10.2.1 — λ√f'c·A_cv (psi, in²) / ACI 318M-19 18.10.2.1 0.083λ√f'c·A_cv
 *   18.10.2.2 — 2λ√f'c·A_cv (psi, in²) / ACI 318M-19 18.10.2.2 0.17λ√f'c·A_cv
 */
function shearYardstick(
  w: WallInput,
  ns: string,
  key: string,
  coeffs: { inLb: number; si: number },
  ref: string,
  sqrt: Traced,
  acv: Traced,
): Traced {
  const U = schemeOf(w);
  const lambda = lambdaInput(w.concrete);
  const coeff = U.si ? coeffs.si : coeffs.inLb;
  const coeffTex = String(coeff);
  const c = constant(
    `${ns}.${key}_coeff`,
    coeffTex,
    U.si ? "ACI 318M coefficient on λ√f'c·A_cv" : "in-lb coefficient on λ√f'c·A_cv",
    coeff,
    "1",
    aci(ref),
  );
  const value = (coeff * w.concrete.lambda * sqrt.value * acv.value) / 1000;
  return derive({
    id: `${ns}.${key}`,
    symbol: `${coeffTex}λ√f'_c·A_cv`,
    label: "shear threshold",
    value,
    unit: U.force,
    formula: `${coeffTex}\\,\\lambda\\sqrt{f'_c}\\,A_{cv}`,
    substitution:
      `${coeffTex} \\times ${fmtTex(w.concrete.lambda, { dp: 2 })} \\times ${fmtTex(sqrt.value, { dp: U.si ? 3 : 1 })} \\times ` +
      `${fmtTex(acv.value)} = ${fmtTex(value)}\\ ${U.forceTex}`,
    ref: aci(ref),
    inputs: [c, lambda, sqrt, acv],
    note: U.si ? "MPa × mm² → N, reported in kN" : "psi × in² → lb, reported in kip",
  });
}

/**
 * 18.10.2 web reinforcement for special structural walls, plus the 18.10.4.3
 * ρ_ℓ ≥ ρ_t rule for squat walls.
 */
export function checkSeismicWebReinforcement(w: WallInput, demand: Demands): CheckResult {
  const U = schemeOf(w);
  const acv = Acv(w);
  const ratio = hwOverLw(w);
  const sqrt = sqrtFcNode(w, NS, U);
  const VuCode = U.frc(demand.Vu);
  const Vu = input(
    `${NS}.Vu`,
    "V_u",
    `factored in-plane shear (${demand.label ?? demand.id})`,
    VuCode,
    U.force,
  );

  // --- 18.10.2.1 minimum ratios --------------------------------------------
  // λ√f'c·A_cv (psi, in²) / ACI 318M-19 18.10.2.1 0.083λ√f'c·A_cv (MPa, mm²).
  const lowShearLimit = shearYardstick(
    w,
    NS,
    "limit_1",
    { inLb: 1, si: 0.083 },
    "18.10.2.1",
    sqrt,
    acv,
  );
  const lowShearCoeffTex = U.si ? "0.083" : "";
  const lowShear = Math.abs(VuCode) <= lowShearLimit.value + TOL;
  const lowShearTrigger = derive<boolean>({
    id: `${NS}.low_shear`,
    symbol: "V_u ≤ λ√f'_c·A_cv",
    label: "low-shear relaxation of the 0.0025 minimums",
    value: lowShear,
    unit: "1",
    formula: `V_u \\le ${lowShearCoeffTex}\\lambda\\sqrt{f'_c}\\,A_{cv}`,
    substitution: `${fmtTex(Math.abs(VuCode))} \\le ${fmtTex(lowShearLimit.value)} \\Rightarrow \\text{${lowShear}}`,
    ref: aci("18.10.2.1"),
    inputs: [Vu, lowShearLimit],
    note: lowShear
      ? `18.10.2.1 permits the Table 11.6.1 minimums (0.0012/0.0020 for Grade ${U.si ? "420 bars ≤ No. 16" : "60 bars ≤ No. 5"})`
      : "the 0.0025 minimums of 18.10.2.1 govern",
  });

  // Table 11.6.1 relaxation, Grade 60 (Grade 420 metric) deformed bars:
  // ρ_ℓ 0.0012 / ρ_t 0.0020 for No. 5 (No. 16 metric) and smaller, 0.0015 /
  // 0.0025 above. The ratios themselves are identical in both editions; only
  // the f_y row split is written differently — 60,000 psi / ACI 318M-19
  // Table 11.6.1 420 MPa. Bar sizes are read per layer.
  const fyCode = U.str(w.grade.fy);
  const fySplit = U.si ? 420 : 60000;
  const relaxed = (bar: string): { l: number; t: number } =>
    Number(bar) > 5 || fyCode < fySplit ? { l: 0.0015, t: 0.0025 } : { l: 0.0012, t: 0.002 };

  const base = constant(
    `${NS}.rho_min_base`,
    "0.0025",
    "minimum distributed reinforcement ratio for special walls",
    0.0025,
    "1",
    aci("18.10.2.1"),
  );

  const reqNode = (key: "l" | "t", layer: { bar: string }): Traced => {
    const value = lowShear
      ? key === "l"
        ? relaxed(layer.bar).l
        : relaxed(layer.bar).t
      : base.value;
    return derive({
      id: `${NS}.rho_${key}_req`,
      symbol: key === "l" ? "ρ_ℓ,min" : "ρ_t,min",
      label: `minimum ${key === "l" ? "longitudinal" : "transverse"} reinforcement ratio`,
      value,
      unit: "1",
      formula: `\\rho_{min} = 0.0025 \\ \\text{unless}\\ V_u \\le ${lowShearCoeffTex}\\lambda\\sqrt{f'_c}A_{cv}`,
      substitution: `\\rho_{min} = ${fmtTex(value)}`,
      ref: aci("18.10.2.1"),
      inputs: [base, lowShearTrigger],
      note: lowShear
        ? `low-shear case — Table 11.6.1 row for No. ${layer.bar} bars applies`
        : "18.10.2.1",
    });
  };

  const rhoLReq = reqNode("l", w.vertical);
  const rhoTReq = reqNode("t", w.horizontal);
  const rhoLProv = rhoProvidedNode(w, NS, "l", w.vertical);
  const rhoTProv = rhoProvidedNode(w, NS, "t", w.horizontal);

  const ratioNode = (
    key: string,
    symbol: string,
    label: string,
    req: Traced,
    prov: Traced,
    ref: string,
  ): Traced => {
    const value = prov.value > 0 ? req.value / prov.value : Number.POSITIVE_INFINITY;
    return derive({
      id: `${NS}.util_${key}`,
      symbol,
      label,
      value,
      unit: "1",
      formula: "\\text{required}/\\text{provided}",
      substitution: `${fmtTex(req.value, { dp: 5 })} / ${fmtTex(prov.value, { dp: 5 })} = ${fmtTex(value, { dp: 3 })}`,
      ref: aci(ref),
      inputs: [req, prov],
      status: prov.value >= req.value - TOL ? "ok" : "ng",
    });
  };

  const utilL = ratioNode(
    "rho_l",
    "ρ_ℓ,min/ρ_ℓ",
    "longitudinal ratio utilization",
    rhoLReq,
    rhoLProv,
    "18.10.2.1",
  );
  const utilT = ratioNode(
    "rho_t",
    "ρ_t,min/ρ_t",
    "transverse ratio utilization",
    rhoTReq,
    rhoTProv,
    "18.10.2.1",
  );

  // --- 18.10.2.1 spacing cap ------------------------------------------------
  // 18.10.2.1 spacing cap: 18 in. / ACI 318M-19 18.10.2.1 450 mm (the metric
  // edition's own round number, not 18 in. converted, which would be 457 mm).
  const sCapValue = U.si ? 450 : 18;
  const sCapTex = U.si ? "450 mm" : "18 in.";
  const sCap = constant(
    `${NS}.s_max`,
    sCapTex,
    "maximum spacing of distributed web reinforcement",
    sCapValue,
    U.length,
    aci("18.10.2.1"),
    "each way; the Ch. 11 limits of 11.7.2.1/11.7.3.1 (3h, ℓ_w/3, ℓ_w/5) still apply and are checked separately",
  );
  const sProv = input(
    `${NS}.s_prov`,
    "s",
    "largest provided bar spacing",
    U.len(Math.max(w.vertical.spacing, w.horizontal.spacing)),
    U.length,
  );
  const utilS = derive({
    id: `${NS}.util_s`,
    symbol: `s/${sCapTex}`,
    label: "spacing utilization",
    value: sProv.value / sCap.value,
    unit: "1",
    formula: `s \\le ${U.si ? "450" : "18"}\\ ${U.lengthTex}`,
    substitution: `${fmtTex(sProv.value, { dp: 1 })} / ${fmtTex(sCap.value, { dp: 1 })} = ${fmtTex(sProv.value / sCap.value, { dp: 3 })}`,
    ref: aci("18.10.2.1"),
    inputs: [sProv, sCap],
    status: sProv.value <= sCap.value + TOL ? "ok" : "ng",
  });

  // --- 18.10.2.2 two curtains ----------------------------------------------
  // 2λ√f'c·A_cv (psi, in²) / ACI 318M-19 18.10.2.2 0.17λ√f'c·A_cv (MPa, mm²).
  const twoCurtainLimit = shearYardstick(
    w,
    NS,
    "limit_2",
    { inLb: 2, si: 0.17 },
    "18.10.2.2",
    sqrt,
    acv,
  );
  const twoCurtainCoeffTex = U.si ? "0.17" : "2";
  const byShear = Math.abs(VuCode) > twoCurtainLimit.value + TOL;
  const byAspect = ratio.value >= 2 - TOL;
  const curtainsReqValue = byShear || byAspect ? 2 : 1;
  const curtainsReq = derive({
    id: `${NS}.curtains_req`,
    symbol: "n_req",
    label: "curtains of distributed reinforcement required",
    value: curtainsReqValue,
    unit: "1",
    formula: `n_{req} = 2 \\ \\text{if}\\ V_u > ${twoCurtainCoeffTex}\\lambda\\sqrt{f'_c}A_{cv}\\ \\text{or}\\ h_w/\\ell_w \\ge 2.0`,
    substitution:
      `V_u = ${fmtTex(Math.abs(VuCode))} > ${fmtTex(twoCurtainLimit.value)} \\Rightarrow \\text{${byShear}};\\ ` +
      `h_w/\\ell_w = ${fmtTex(ratio.value, { dp: 3 })} \\ge 2.0 \\Rightarrow \\text{${byAspect}}` +
      ` \\Rightarrow n_{req} = ${curtainsReqValue}`,
    ref: aci("18.10.2.2"),
    inputs: [Vu, twoCurtainLimit, ratio],
    note: byAspect
      ? "the h_w/ℓ_w ≥ 2.0 trigger is new in 318-19"
      : byShear
        ? "shear trigger governs"
        : "neither trigger is met — a single curtain is permitted by 18.10.2.2",
  });
  const curtainsProvValue = Math.min(w.vertical.curtains, w.horizontal.curtains);
  const curtainsProv = input(
    `${NS}.curtains_prov`,
    "n_prov",
    "curtains provided (governing direction)",
    curtainsProvValue,
    "1",
  );
  const utilCurtains = derive({
    id: `${NS}.util_curtains`,
    symbol: "n_req/n_prov",
    label: "curtain utilization",
    value: curtainsProvValue > 0 ? curtainsReqValue / curtainsProvValue : Number.POSITIVE_INFINITY,
    unit: "1",
    formula: "n_{req}/n_{prov}",
    substitution: `${curtainsReqValue} / ${curtainsProvValue} = ${fmtTex(curtainsReqValue / curtainsProvValue, { dp: 2 })}`,
    ref: aci("18.10.2.2"),
    inputs: [curtainsReq, curtainsProv],
    status: curtainsProvValue >= curtainsReqValue ? "ok" : "ng",
  });

  // --- 18.10.4.3 ρ_ℓ ≥ ρ_t for squat walls ---------------------------------
  const squat = ratio.value <= 2 + TOL;
  const rhoOrder = derive({
    id: `${NS}.rho_l_ge_rho_t`,
    symbol: "ρ_t/ρ_ℓ",
    label: "18.10.4.3 longitudinal-over-transverse ratio",
    value: squat
      ? rhoLProv.value > 0
        ? rhoTProv.value / rhoLProv.value
        : Number.POSITIVE_INFINITY
      : 0,
    unit: "1",
    formula: "\\rho_\\ell \\ge \\rho_t \\quad (h_w/\\ell_w \\le 2.0)",
    substitution: squat
      ? `\\rho_t/\\rho_\\ell = ${fmtTex(rhoTProv.value, { dp: 5 })} / ${fmtTex(rhoLProv.value, { dp: 5 })} = ${fmtTex(rhoTProv.value / rhoLProv.value, { dp: 3 })}`
      : `h_w/\\ell_w = ${fmtTex(ratio.value, { dp: 3 })} > 2.0 \\Rightarrow \\text{does not apply}`,
    ref: aci("18.10.4.3"),
    inputs: [ratio, rhoLProv, rhoTProv],
    status: squat ? (rhoLProv.value >= rhoTProv.value - TOL ? "ok" : "ng") : "na",
    note: squat
      ? "18.10.4.3: walls with h_w/ℓ_w ≤ 2.0 need at least as much vertical as horizontal distributed reinforcement"
      : "18.10.4.3 applies only to walls with h_w/ℓ_w ≤ 2.0",
  });

  // --- 18.10.2.4 end-zone longitudinal reinforcement ------------------------
  const endZone = endZoneRatio(w, ratio, sqrt);

  const utilCandidates = [utilL, utilT, utilS, utilCurtains];
  if (squat) utilCandidates.push(rhoOrder);
  if (endZone.util.status !== "na") utilCandidates.push(endZone.util);
  const utilValue = Math.max(...utilCandidates.map((n) => n.value));
  const util = derive({
    id: `${NS}.utilization`,
    symbol: "governing",
    label: "governing web-reinforcement utilization",
    value: utilValue,
    unit: "1",
    formula: "\\max(\\text{required}/\\text{provided})",
    substitution: `\\max(${utilCandidates.map((n) => fmtTex(n.value, { dp: 3 })).join(",\\ ")}) = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("18.10.2"),
    inputs: utilCandidates,
  });

  return checkResult({
    id: "sw.web-reinforcement",
    title: "Special wall web reinforcement",
    ref: aci("18.10.2"),
    demand: Vu,
    utilization: util,
    trace: [lowShearTrigger, util, rhoOrder, endZone.rho, endZone.util],
  });
}

interface EndZoneNodes {
  rho: Traced;
  util: Traced;
}

/**
 * 18.10.2.4 — minimum longitudinal reinforcement at wall ends (new in 318-19).
 *
 * For walls with h_w/ℓ_w ≥ 2.0 that are continuous from base to top and have a
 * single critical section, the longitudinal ratio within 0.15ℓ_w of each end,
 * over one wall thickness, must be at least
 *   in-lb                — 6√f'c/f_y  (psi)
 *   ACI 318M-19 18.10.2.4 — 0.50√f'c/f_y  (MPa)
 * The provided ratio is summed from the resolved bar stations with x < 0.15ℓ_w.
 *
 * Continuity and the single critical section are assumed (the engine models one
 * section of one wall); items (b) and (c) of 18.10.2.4 — vertical extent and the
 * 50 % termination limit — are height-of-wall detailing and are out of scope.
 */
function endZoneRatio(w: WallInput, ratio: Traced, sqrt: Traced): EndZoneNodes {
  const U = schemeOf(w);
  const lw = lwInput(w);
  const h = hInput(w);
  const applies = ratio.value >= 2 - TOL;

  const fraction = constant(
    `${NS}.end_zone_fraction`,
    "0.15",
    "fraction of ℓ_w defining the end zone",
    0.15,
    "1",
    aci("18.10.2.4"),
  );
  // The end zone is a fraction of ℓ_w, so it is geometry: computed in inches for
  // the bar-station filter, traced in the reporting length unit.
  const lengthIn = 0.15 * w.geometry.lw;
  const lengthValue = U.len(lengthIn);
  const length = derive({
    id: `${NS}.end_zone_length`,
    symbol: "0.15ℓ_w",
    label: "end-zone length from the wall end",
    value: lengthValue,
    unit: U.length,
    formula: "0.15\\,\\ell_w",
    substitution: `0.15 \\times ${fmtTex(U.len(w.geometry.lw))} = ${fmtTex(lengthValue, { dp: 1 })}\\ ${U.lengthTex}`,
    ref: aci("18.10.2.4"),
    inputs: [fraction, lw],
  });

  const stations = barPositions(w).filter((st) => st.x < lengthIn - 1e-6);
  const AsValue = U.ar(stations.reduce((sum, st) => sum + st.area, 0));
  const As = input(
    `${NS}.end_zone_As`,
    "A_s,end",
    "longitudinal steel within the end zone",
    AsValue,
    U.area,
    `${stations.length} bar station(s) at x < ${fmtTex(lengthValue, { dp: 1 })} ${U.si ? "mm" : "in."} from the wall end`,
  );

  const areaValue = U.ar(lengthIn * w.geometry.h);
  const area = derive({
    id: `${NS}.end_zone_area`,
    symbol: "A_end",
    label: "gross area of the end zone",
    value: areaValue,
    unit: U.area,
    formula: "A_{end} = 0.15\\,\\ell_w\\,h",
    substitution: `${fmtTex(lengthValue, { dp: 1 })} \\times ${fmtTex(U.len(w.geometry.h), { dp: 1 })} = ${fmtTex(areaValue)}\\ ${U.areaTex}`,
    ref: aci("18.10.2.4"),
    inputs: [length, h],
  });

  const rho = derive({
    id: `${NS}.end_zone_rho`,
    symbol: "ρ_end",
    label: "provided end-zone longitudinal reinforcement ratio",
    value: AsValue / areaValue,
    unit: "1",
    formula: "\\rho_{end} = \\dfrac{A_{s,end}}{0.15\\,\\ell_w\\,h}",
    substitution: `\\dfrac{${fmtTex(AsValue, { dp: 2 })}}{${fmtTex(areaValue)}} = ${fmtTex(AsValue / areaValue, { dp: 5 })}`,
    ref: aci("18.10.2.4"),
    inputs: [As, area],
  });

  // 18.10.2.4 end-zone minimum: 6√f'c/f_y (psi) / ACI 318M-19 18.10.2.4
  // 0.50√f'c/f_y (MPa).
  const coeffValue = U.si ? 0.5 : 6;
  const coeffTex = U.si ? "0.50" : "6";
  const coeff = constant(
    `${NS}.end_zone_coeff`,
    coeffTex,
    `${U.si ? "ACI 318M" : "in-lb"} coefficient of the 18.10.2.4 end-zone minimum`,
    coeffValue,
    "1",
    aci("18.10.2.4"),
    U.si ? "in-lb form 6√f'c/f_y (psi)" : "SI form 0.50√f'c/f_y (MPa)",
  );
  const fyCode = U.str(w.grade.fy);
  const fy = input(
    `${NS}.fy`,
    "f_y",
    "specified yield strength of reinforcement",
    fyCode,
    U.stress,
  );
  const reqValue = (coeffValue * sqrt.value) / fyCode;
  const req = derive({
    id: `${NS}.end_zone_rho_req`,
    symbol: "ρ_end,min",
    label: "minimum end-zone longitudinal reinforcement ratio",
    value: reqValue,
    unit: "1",
    formula: `\\rho_{end,min} = \\dfrac{${coeffTex}\\sqrt{f'_c}}{f_y}`,
    substitution: `\\dfrac{${coeffTex} \\times ${fmtTex(sqrt.value, { dp: U.si ? 3 : 1 })}}{${fmtTex(fyCode)}} = ${fmtTex(reqValue, { dp: 5 })}`,
    ref: aci("18.10.2.4"),
    inputs: [coeff, sqrt, fy],
  });

  const utilValue = applies ? (rho.value > 0 ? reqValue / rho.value : Number.POSITIVE_INFINITY) : 0;
  const util = derive({
    id: `${NS}.end_zone_util`,
    symbol: "ρ_end,min/ρ_end",
    label: "end-zone reinforcement utilization",
    value: utilValue,
    unit: "1",
    formula: "\\rho_{end,min}/\\rho_{end}",
    substitution: applies
      ? `${fmtTex(reqValue, { dp: 5 })} / ${fmtTex(rho.value, { dp: 5 })} = ${fmtTex(utilValue, { dp: 3 })}`
      : `h_w/\\ell_w = ${fmtTex(ratio.value, { dp: 3 })} < 2.0 \\Rightarrow \\text{18.10.2.4 does not apply}`,
    ref: aci("18.10.2.4"),
    inputs: [req, rho, ratio],
    status: applies ? (rho.value >= reqValue - TOL ? "ok" : "ng") : "na",
    note: applies
      ? "assumes the wall is continuous from base to top with a single critical section (18.10.2.4); the vertical extent and 50 % termination limits of (b)/(c) are out of scope"
      : "18.10.2.4 applies to walls with h_w/ℓ_w ≥ 2.0",
  });

  return { rho, util };
}
