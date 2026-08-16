import { BARS, fcInput, lambdaInput } from "../materials";
import { aci, checkResult, constant, derive, input } from "../trace";
import type { CheckResult, Traced } from "../trace";
import { fmtTex, kipToKn } from "../units";
import { Acv, Ag, hInput, hwOverLw, schemeOf } from "../wall";
import type { Demands, WallInput } from "../wall";

/** φ for shear, ACI 318-19 Table 21.2.1. */
function phiShear(): Traced {
  return constant(
    "shear.phi",
    "φ",
    "strength reduction factor, shear",
    0.75,
    "1",
    aci("21.2.1"),
    "Table 21.2.1 — shear (non-seismic; 21.2.4 may reduce it for special walls resisting E)",
  );
}

/**
 * α_c per 11.5.4.3, or per Eq. (11.5.4.4) when the demand puts the section in
 * net axial tension.
 *
 * The coefficients are nonhomogeneous and each edition rounds its own:
 *   in-lb (11.5.4.3)       — 3 for squat walls (h_w/ℓ_w ≤ 1.5), 2 for slender
 *   ACI 318M-19 11.5.4.3   — 0.25 for squat walls, 0.17 for slender
 * with linear interpolation between h_w/ℓ_w = 1.5 and 2.0 in both.
 *
 * 11.5.4.1 requires h_w/ℓ_w to be taken as the **larger of** the ratio for the
 * entire wall and the ratio for the segment considered. This engine models a
 * single wall segment, so `hwOverLw(w)` is both ratios and the max is trivially
 * that value; a future multi-segment model must feed the entire-wall ratio in.
 */
export function alphaC(w: WallInput, demand?: Demands): Traced {
  if (demand !== undefined && demand.Pu < 0) return alphaCTension(w, demand);

  const ratio = hwOverLw(w);
  const r = w.geometry.hw / w.geometry.lw;
  const rTex = fmtTex(r, { dp: 3 });

  // 11.5.4.3 squat/slender coefficients — ACI 318M-19 11.5.4.3 in SI.
  const U = schemeOf(w);
  const squat = U.si ? 0.25 : 3;
  const slender = U.si ? 0.17 : 2;
  const slope = (squat - slender) / 0.5;
  const dp = U.si ? 3 : 0;
  const squatTex = fmtTex(squat, { dp });
  const slenderTex = fmtTex(slender, { dp });
  const slopeTex = fmtTex(slope, { dp: U.si ? 2 : 0 });

  let value: number;
  let formula: string;
  let substitution: string;
  if (r <= 1.5) {
    value = squat;
    formula = `\\alpha_c = ${squatTex} \\quad (h_w/\\ell_w \\le 1.5)`;
    substitution = `h_w/\\ell_w = ${rTex} \\le 1.5 \\Rightarrow \\alpha_c = ${squatTex}`;
  } else if (r >= 2) {
    value = slender;
    formula = `\\alpha_c = ${slenderTex} \\quad (h_w/\\ell_w \\ge 2.0)`;
    substitution = `h_w/\\ell_w = ${rTex} \\ge 2.0 \\Rightarrow \\alpha_c = ${slenderTex}`;
  } else {
    value = squat - slope * (r - 1.5);
    formula = `\\alpha_c = ${squatTex} - ${slopeTex}\\,(h_w/\\ell_w - 1.5) \\quad (1.5 < h_w/\\ell_w < 2.0)`;
    substitution = `\\alpha_c = ${squatTex} - ${slopeTex}\\,(${rTex} - 1.5) = ${fmtTex(value, { dp: U.si ? 4 : 3 })}`;
  }

  return derive({
    id: "shear.alpha_c",
    symbol: "α_c",
    label: "coefficient defining the relative contribution of concrete to in-plane shear strength",
    value,
    unit: "1",
    formula,
    substitution,
    ref: aci("11.5.4.3"),
    inputs: [ratio],
    note: "h_w/ℓ_w is the larger of the entire-wall and segment ratios (11.5.4.1); this model treats the wall as one segment, so the wall ratio governs.",
  });
}

/**
 * Eq. (11.5.4.4) for a section in net axial tension, N_u negative:
 *   in-lb              — α_c = 2(1 + N_u/(500 A_g)) ≥ 0, N_u in lb, A_g in in²
 *   ACI 318M-19 11.5.4.4 — α_c = 0.17(1 + N_u/(3.5 A_g)) ≥ 0, N_u in N, A_g in mm²
 */
function alphaCTension(w: WallInput, demand: Demands): Traced {
  const U = schemeOf(w);
  const ag = Ag(w);
  const nu = input(
    "shear.Nu",
    "N_u",
    "factored axial force normal to the section (negative in tension)",
    U.frc(demand.Pu),
    U.force,
  );
  const coeff = U.si ? 0.17 : 2;
  const denom = U.si ? 3.5 : 500;
  const coeffTex = U.si ? "0.17" : "2";
  const denomTex = U.si ? "3.5" : "500";
  // N_u in the base force unit of the edition (lb / N) against A_g in in² / mm².
  const nuBase = U.si ? kipToKn(demand.Pu) * 1000 : demand.Pu * 1000;
  const raw = coeff * (1 + nuBase / (denom * ag.value));
  const value = Math.max(0, raw);
  return derive({
    id: "shear.alpha_c",
    symbol: "α_c",
    label: "coefficient defining the relative contribution of concrete to in-plane shear strength",
    value,
    unit: "1",
    formula: `\\alpha_c = ${coeffTex}\\left(1 + \\frac{N_u}{${denomTex}\\,A_g}\\right) \\ge 0`,
    substitution: `\\alpha_c = ${coeffTex}\\left(1 + \\frac{${fmtTex(nuBase)}}{${denomTex} \\times ${fmtTex(ag.value)}}\\right) = ${fmtTex(value, { dp: U.si ? 4 : 3 })}`,
    ref: aci("11.5.4.4", "11.5.4.4"),
    inputs: [nu, ag],
    note: `net axial tension (P_u = ${fmtTex(U.frc(demand.Pu))} ${U.force}); N_u taken in ${U.si ? "N and A_g in mm² for the metric form" : "lb and A_g in in² for the in-lb form"}${raw < 0 ? "; the computed value is negative and is taken as 0" : ""}`,
  });
}

/** ρ_t = A_st/(s·h) from the distributed horizontal (transverse) layer. */
function rhoT(w: WallInput): Traced {
  const U = schemeOf(w);
  const h = hInput(w);
  const layer = w.horizontal;
  const Ab = U.ar(BARS[layer.bar].Ab);
  const ab = input(
    "shear.Ab_t",
    "A_b,t",
    `nominal area of one horizontal bar (No. ${layer.bar})`,
    Ab,
    U.area,
  );
  const curtains = input(
    "shear.curtains_t",
    "n_c",
    "curtains of horizontal reinforcement",
    layer.curtains,
    "1",
  );
  const s = input("shear.s_t", "s_t", "horizontal bar spacing", U.len(layer.spacing), U.length);
  // ρ_t is a ratio, so it is identical in both systems; it is assembled from the
  // traced (converted) leaves so the substitution reads consistently.
  const value = (Ab * layer.curtains) / (s.value * h.value);
  return derive({
    id: "shear.rho_t",
    symbol: "ρ_t",
    label: "distributed transverse (horizontal) reinforcement ratio",
    value,
    unit: "1",
    formula: "\\rho_t = \\frac{n_c\\,A_{b,t}}{s_t\\,h}",
    substitution: `\\rho_t = \\frac{${fmtTex(layer.curtains)} \\times ${fmtTex(Ab, { dp: 2 })}}{${fmtTex(s.value)} \\times ${fmtTex(h.value)}} = ${fmtTex(value, { dp: 5 })}`,
    ref: aci("11.5.4.3"),
    inputs: [curtains, ab, s, h],
  });
}

/**
 * In-plane shear, ACI 318-19 11.5.4.
 *
 * Vn = (α_c λ √f'c + ρ_t f_yt) A_cv   (Eq. 11.5.4.3), capped by 11.5.4.2:
 *   in-lb                — V_n ≤ 8√f'c·A_cv  (psi, in²)
 *   ACI 318M-19 11.5.4.2 — V_n ≤ 0.66√f'c·A_cv  (MPa, mm²)
 *
 * DIVERGENCE FROM MNL-17(21) Example 1: the handbook conservatively drops the
 * ρ_t f_yt term and reports Vn = 570 kip / φVn = 428 kip (concrete alone). We
 * compute the full Eq. (11.5.4.3) value, so φVn ≈ 1209 kip for the same wall.
 * The concrete-alone term is traced separately as `shear.vnc` (≈ 570 kip), which
 * is both what designers read off the page and what reproduces the handbook.
 */
export function checkInPlaneShear(w: WallInput, demand: Demands): CheckResult {
  const U = schemeOf(w);
  const acv = Acv(w);
  const fc = fcInput(w.concrete, U);
  const lambda = lambdaInput(w.concrete);
  const ac = alphaC(w, demand);
  const rho = rhoT(w);

  const fcCode = U.str(w.concrete.fc);
  const sqrtFc = U.sqrtFc(w.concrete.fc);
  const sqrtDp = U.si ? 3 : 1;
  const sqrt = derive({
    id: "shear.sqrt_fc",
    symbol: "√f'_c",
    label: "square root of the specified compressive strength",
    value: sqrtFc,
    unit: U.stress,
    formula: "\\sqrt{f'_c}",
    substitution: `\\sqrt{${fmtTex(fcCode)}} = ${fmtTex(sqrtFc, { dp: sqrtDp })}\\ ${U.stressTex}^{0.5}`,
    inputs: [fc],
  });

  const vncValue = (ac.value * w.concrete.lambda * sqrtFc * acv.value) / 1000;
  const vnc = derive({
    id: "shear.vnc",
    symbol: "V_nc",
    label: "concrete contribution to in-plane shear strength",
    value: vncValue,
    unit: U.force,
    formula: "V_{nc} = \\alpha_c\\,\\lambda\\sqrt{f'_c}\\,A_{cv}",
    substitution: `V_{nc} = ${fmtTex(ac.value, { dp: U.si ? 4 : 2 })} \\times ${fmtTex(w.concrete.lambda, { dp: 2 })} \\times ${fmtTex(sqrtFc, { dp: sqrtDp })} \\times ${fmtTex(acv.value)} = ${fmtTex(vncValue)}\\ ${U.forceTex}`,
    ref: aci("11.5.4.3", "11.5.4.3"),
    inputs: [ac, lambda, sqrt, acv],
    note: U.si
      ? "MPa × mm² → N, reported in kN"
      : "psi × in² → lb, reported in kip; this is the term MNL-17(21) Ex. 1 prints (570 kip)",
  });

  const fytCode = U.str(w.grade.fy);
  const fyt = input(
    "shear.fyt",
    "f_yt",
    "specified yield strength of transverse reinforcement",
    fytCode,
    U.stress,
  );
  const vnsValue = (rho.value * fytCode * acv.value) / 1000;
  const vns = derive({
    id: "shear.vns",
    symbol: "V_ns",
    label: "distributed horizontal reinforcement contribution to in-plane shear strength",
    value: vnsValue,
    unit: U.force,
    formula: "V_{ns} = \\rho_t\\,f_{yt}\\,A_{cv}",
    substitution: `V_{ns} = ${fmtTex(rho.value, { dp: 5 })} \\times ${fmtTex(fytCode)} \\times ${fmtTex(acv.value)} = ${fmtTex(vnsValue)}\\ ${U.forceTex}`,
    ref: aci("11.5.4.3", "11.5.4.3"),
    inputs: [rho, fyt, acv],
  });

  const vnCalcValue = vncValue + vnsValue;
  const vnCalc = derive({
    id: "shear.vn_calc",
    symbol: "V_n,calc",
    label: "nominal in-plane shear strength from Eq. (11.5.4.3)",
    value: vnCalcValue,
    unit: U.force,
    formula: "V_n = \\left(\\alpha_c\\,\\lambda\\sqrt{f'_c} + \\rho_t f_{yt}\\right) A_{cv}",
    substitution: `V_n = ${fmtTex(vncValue)} + ${fmtTex(vnsValue)} = ${fmtTex(vnCalcValue)}\\ ${U.forceTex}`,
    ref: aci("11.5.4.3", "11.5.4.3"),
    inputs: [vnc, vns],
  });

  // 11.5.4.2 upper limit: 8√f'c·A_cv (psi, in²) / ACI 318M-19 11.5.4.2
  // 0.66√f'c·A_cv (MPa, mm²).
  const capCoeffValue = U.si ? 0.66 : 8;
  const capCoeffTex = U.si ? "0.66" : "8";
  const capCoeff = constant(
    "shear.cap_coeff",
    capCoeffTex,
    "upper limit coefficient on V_n at any horizontal section",
    capCoeffValue,
    "1",
    aci("11.5.4.2"),
    U.si
      ? "ACI 318M-19 11.5.4.2 — the metric form of the 8√f'c (psi) limit"
      : "in-lb form of the 0.66√f'c (MPa) limit",
  );
  const vnMaxValue = (capCoeffValue * sqrtFc * acv.value) / 1000;
  const vnMax = derive({
    id: "shear.vn_max",
    symbol: "V_n,max",
    label: "upper limit on nominal in-plane shear strength",
    value: vnMaxValue,
    unit: U.force,
    formula: `V_{n,max} = ${capCoeffTex}\\sqrt{f'_c}\\,A_{cv}`,
    substitution: `V_{n,max} = ${capCoeffTex} \\times ${fmtTex(sqrtFc, { dp: sqrtDp })} \\times ${fmtTex(acv.value)} = ${fmtTex(vnMaxValue)}\\ ${U.forceTex}`,
    ref: aci("11.5.4.2"),
    inputs: [capCoeff, sqrt, acv],
  });

  const capped = vnCalcValue > vnMaxValue;
  const vnValue = capped ? vnMaxValue : vnCalcValue;
  const vn = derive({
    id: "shear.Vn",
    symbol: "V_n",
    label: "nominal in-plane shear strength",
    value: vnValue,
    unit: U.force,
    formula: "V_n = \\min\\left(V_{n,calc},\\ V_{n,max}\\right)",
    substitution: `V_n = \\min(${fmtTex(vnCalcValue)},\\ ${fmtTex(vnMaxValue)}) = ${fmtTex(vnValue)}\\ ${U.forceTex}`,
    ref: aci("11.5.4.2"),
    inputs: [vnCalc, vnMax],
    note: capped
      ? `Eq. (11.5.4.3) exceeds the ${capCoeffTex}√f'c·A_cv limit of 11.5.4.2 — capacity taken as the cap; added horizontal reinforcement cannot raise V_n`
      : "Eq. (11.5.4.3) governs; the 11.5.4.2 limit is not reached",
  });

  const phi = phiShear();
  const phiVnValue = phi.value * vnValue;
  const phiVn = derive({
    id: "shear.phiVn",
    symbol: "φV_n",
    label: "design in-plane shear strength",
    value: phiVnValue,
    unit: U.force,
    formula: "\\phi V_n",
    substitution: `\\phi V_n = ${fmtTex(phi.value, { dp: 2 })} \\times ${fmtTex(vnValue)} = ${fmtTex(phiVnValue)}\\ ${U.forceTex}`,
    ref: aci("11.5.1.1"),
    inputs: [phi, vn],
  });

  const vu = input("shear.Vu", "V_u", "factored in-plane shear force", U.frc(demand.Vu), U.force);
  const utilValue = phiVnValue === 0 ? Infinity : Math.abs(vu.value) / phiVnValue;
  const util = derive({
    id: "shear.utilization",
    symbol: "V_u/φV_n",
    label: "in-plane shear utilization",
    value: utilValue,
    unit: "1",
    formula: "\\frac{V_u}{\\phi V_n}",
    substitution: `\\frac{${fmtTex(Math.abs(vu.value))}}{${fmtTex(phiVnValue)}} = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("11.5.1.1"),
    inputs: [vu, phiVn],
  });

  return checkResult({
    id: "shear.in-plane",
    title: "In-plane shear strength",
    ref: aci("11.5.4", "11.5.4.3"),
    demand: vu,
    capacity: phiVn,
    utilization: util,
    trace: [vn, phiVn, util],
  });
}
