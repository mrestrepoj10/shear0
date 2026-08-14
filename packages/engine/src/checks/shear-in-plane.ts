import { BARS, fcInput, lambdaInput } from "../materials";
import { aci, checkResult, constant, derive, input } from "../trace";
import type { CheckResult, Traced } from "../trace";
import { fmtTex, ksiToPsi, sqrtFcPsi } from "../units";
import { Acv, Ag, hInput, hwOverLw } from "../wall";
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
 * α_c per 11.5.4.3 (in-lb coefficients: 3 for squat walls, 2 for slender), or
 * per Eq. (11.5.4.4) when the demand puts the section in net axial tension.
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

  let value: number;
  let formula: string;
  let substitution: string;
  if (r <= 1.5) {
    value = 3;
    formula = "\\alpha_c = 3 \\quad (h_w/\\ell_w \\le 1.5)";
    substitution = `h_w/\\ell_w = ${rTex} \\le 1.5 \\Rightarrow \\alpha_c = 3`;
  } else if (r >= 2) {
    value = 2;
    formula = "\\alpha_c = 2 \\quad (h_w/\\ell_w \\ge 2.0)";
    substitution = `h_w/\\ell_w = ${rTex} \\ge 2.0 \\Rightarrow \\alpha_c = 2`;
  } else {
    value = 3 - 2 * (r - 1.5);
    formula = "\\alpha_c = 3 - 2\\,(h_w/\\ell_w - 1.5) \\quad (1.5 < h_w/\\ell_w < 2.0)";
    substitution = `\\alpha_c = 3 - 2\\,(${rTex} - 1.5) = ${fmtTex(value, { dp: 3 })}`;
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

/** Eq. (11.5.4.4): α_c = 2(1 + N_u/(500 A_g)) ≥ 0, N_u negative in tension. */
function alphaCTension(w: WallInput, demand: Demands): Traced {
  const ag = Ag(w);
  const nu = input(
    "shear.Nu",
    "N_u",
    "factored axial force normal to the section (negative in tension)",
    demand.Pu,
    "kip",
  );
  const nuLb = demand.Pu * 1000;
  const raw = 2 * (1 + nuLb / (500 * ag.value));
  const value = Math.max(0, raw);
  return derive({
    id: "shear.alpha_c",
    symbol: "α_c",
    label: "coefficient defining the relative contribution of concrete to in-plane shear strength",
    value,
    unit: "1",
    formula: "\\alpha_c = 2\\left(1 + \\frac{N_u}{500\\,A_g}\\right) \\ge 0",
    substitution: `\\alpha_c = 2\\left(1 + \\frac{${fmtTex(nuLb)}}{500 \\times ${fmtTex(ag.value)}}\\right) = ${fmtTex(value, { dp: 3 })}`,
    ref: aci("11.5.4.4", "11.5.4.4"),
    inputs: [nu, ag],
    note: `net axial tension (P_u = ${fmtTex(demand.Pu)} kip); N_u taken in lb and A_g in in² for the in-lb form${raw < 0 ? "; the computed value is negative and is taken as 0" : ""}`,
  });
}

/** ρ_t = A_st/(s·h) from the distributed horizontal (transverse) layer. */
function rhoT(w: WallInput): Traced {
  const h = hInput(w);
  const layer = w.horizontal;
  const Ab = BARS[layer.bar].Ab;
  const ab = input(
    "shear.Ab_t",
    "A_b,t",
    `nominal area of one horizontal bar (No. ${layer.bar})`,
    Ab,
    "in2",
  );
  const curtains = input(
    "shear.curtains_t",
    "n_c",
    "curtains of horizontal reinforcement",
    layer.curtains,
    "1",
  );
  const s = input("shear.s_t", "s_t", "horizontal bar spacing", layer.spacing, "in");
  const value = (Ab * layer.curtains) / (layer.spacing * w.geometry.h);
  return derive({
    id: "shear.rho_t",
    symbol: "ρ_t",
    label: "distributed transverse (horizontal) reinforcement ratio",
    value,
    unit: "1",
    formula: "\\rho_t = \\frac{n_c\\,A_{b,t}}{s_t\\,h}",
    substitution: `\\rho_t = \\frac{${fmtTex(layer.curtains)} \\times ${fmtTex(Ab, { dp: 2 })}}{${fmtTex(layer.spacing)} \\times ${fmtTex(w.geometry.h)}} = ${fmtTex(value, { dp: 5 })}`,
    ref: aci("11.5.4.3"),
    inputs: [curtains, ab, s, h],
  });
}

/**
 * In-plane shear, ACI 318-19 11.5.4.
 *
 * Vn = (α_c λ √f'c + ρ_t f_yt) A_cv   (Eq. 11.5.4.3), capped by 8√f'c·A_cv (11.5.4.2).
 *
 * DIVERGENCE FROM MNL-17(21) Example 1: the handbook conservatively drops the
 * ρ_t f_yt term and reports Vn = 570 kip / φVn = 428 kip (concrete alone). We
 * compute the full Eq. (11.5.4.3) value, so φVn ≈ 1209 kip for the same wall.
 * The concrete-alone term is traced separately as `shear.vnc` (≈ 570 kip), which
 * is both what designers read off the page and what reproduces the handbook.
 */
export function checkInPlaneShear(w: WallInput, demand: Demands): CheckResult {
  const acv = Acv(w);
  const fc = fcInput(w.concrete);
  const lambda = lambdaInput(w.concrete);
  const ac = alphaC(w, demand);
  const rho = rhoT(w);

  const fcPsi = ksiToPsi(w.concrete.fc);
  const sqrtFc = sqrtFcPsi(w.concrete.fc);
  const sqrt = derive({
    id: "shear.sqrt_fc",
    symbol: "√f'_c",
    label: "square root of the specified compressive strength",
    value: sqrtFc,
    unit: "psi",
    formula: "\\sqrt{f'_c}",
    substitution: `\\sqrt{${fmtTex(fcPsi)}} = ${fmtTex(sqrtFc, { dp: 1 })}\\ \\text{psi}^{0.5}`,
    inputs: [fc],
  });

  const vncValue = (ac.value * w.concrete.lambda * sqrtFc * acv.value) / 1000;
  const vnc = derive({
    id: "shear.vnc",
    symbol: "V_nc",
    label: "concrete contribution to in-plane shear strength",
    value: vncValue,
    unit: "kip",
    formula: "V_{nc} = \\alpha_c\\,\\lambda\\sqrt{f'_c}\\,A_{cv}",
    substitution: `V_{nc} = ${fmtTex(ac.value, { dp: 2 })} \\times ${fmtTex(w.concrete.lambda, { dp: 2 })} \\times ${fmtTex(sqrtFc, { dp: 1 })} \\times ${fmtTex(acv.value)} = ${fmtTex(vncValue)}\\ \\text{kip}`,
    ref: aci("11.5.4.3", "11.5.4.3"),
    inputs: [ac, lambda, sqrt, acv],
    note: "psi × in² → lb, reported in kip; this is the term MNL-17(21) Ex. 1 prints (570 kip)",
  });

  const fytPsi = ksiToPsi(w.grade.fy);
  const fyt = input(
    "shear.fyt",
    "f_yt",
    "specified yield strength of transverse reinforcement",
    fytPsi,
    "psi",
  );
  const vnsValue = (rho.value * fytPsi * acv.value) / 1000;
  const vns = derive({
    id: "shear.vns",
    symbol: "V_ns",
    label: "distributed horizontal reinforcement contribution to in-plane shear strength",
    value: vnsValue,
    unit: "kip",
    formula: "V_{ns} = \\rho_t\\,f_{yt}\\,A_{cv}",
    substitution: `V_{ns} = ${fmtTex(rho.value, { dp: 5 })} \\times ${fmtTex(fytPsi)} \\times ${fmtTex(acv.value)} = ${fmtTex(vnsValue)}\\ \\text{kip}`,
    ref: aci("11.5.4.3", "11.5.4.3"),
    inputs: [rho, fyt, acv],
  });

  const vnCalcValue = vncValue + vnsValue;
  const vnCalc = derive({
    id: "shear.vn_calc",
    symbol: "V_n,calc",
    label: "nominal in-plane shear strength from Eq. (11.5.4.3)",
    value: vnCalcValue,
    unit: "kip",
    formula: "V_n = \\left(\\alpha_c\\,\\lambda\\sqrt{f'_c} + \\rho_t f_{yt}\\right) A_{cv}",
    substitution: `V_n = ${fmtTex(vncValue)} + ${fmtTex(vnsValue)} = ${fmtTex(vnCalcValue)}\\ \\text{kip}`,
    ref: aci("11.5.4.3", "11.5.4.3"),
    inputs: [vnc, vns],
  });

  const capCoeff = constant(
    "shear.cap_coeff",
    "8",
    "upper limit coefficient on V_n at any horizontal section",
    8,
    "1",
    aci("11.5.4.2"),
    "in-lb form of the 0.66√f'c (MPa) limit",
  );
  const vnMaxValue = (8 * sqrtFc * acv.value) / 1000;
  const vnMax = derive({
    id: "shear.vn_max",
    symbol: "V_n,max",
    label: "upper limit on nominal in-plane shear strength",
    value: vnMaxValue,
    unit: "kip",
    formula: "V_{n,max} = 8\\sqrt{f'_c}\\,A_{cv}",
    substitution: `V_{n,max} = 8 \\times ${fmtTex(sqrtFc, { dp: 1 })} \\times ${fmtTex(acv.value)} = ${fmtTex(vnMaxValue)}\\ \\text{kip}`,
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
    unit: "kip",
    formula: "V_n = \\min\\left(V_{n,calc},\\ V_{n,max}\\right)",
    substitution: `V_n = \\min(${fmtTex(vnCalcValue)},\\ ${fmtTex(vnMaxValue)}) = ${fmtTex(vnValue)}\\ \\text{kip}`,
    ref: aci("11.5.4.2"),
    inputs: [vnCalc, vnMax],
    note: capped
      ? "Eq. (11.5.4.3) exceeds the 8√f'c·A_cv limit of 11.5.4.2 — capacity taken as the cap; added horizontal reinforcement cannot raise V_n"
      : "Eq. (11.5.4.3) governs; the 11.5.4.2 limit is not reached",
  });

  const phi = phiShear();
  const phiVnValue = phi.value * vnValue;
  const phiVn = derive({
    id: "shear.phiVn",
    symbol: "φV_n",
    label: "design in-plane shear strength",
    value: phiVnValue,
    unit: "kip",
    formula: "\\phi V_n",
    substitution: `\\phi V_n = ${fmtTex(phi.value, { dp: 2 })} \\times ${fmtTex(vnValue)} = ${fmtTex(phiVnValue)}\\ \\text{kip}`,
    ref: aci("11.5.1.1"),
    inputs: [phi, vn],
  });

  const vu = input("shear.Vu", "V_u", "factored in-plane shear force", demand.Vu, "kip");
  const utilValue = phiVnValue === 0 ? Infinity : Math.abs(demand.Vu) / phiVnValue;
  const util = derive({
    id: "shear.utilization",
    symbol: "V_u/φV_n",
    label: "in-plane shear utilization",
    value: utilValue,
    unit: "1",
    formula: "\\frac{V_u}{\\phi V_n}",
    substitution: `\\frac{${fmtTex(Math.abs(demand.Vu))}}{${fmtTex(phiVnValue)}} = ${fmtTex(utilValue, { dp: 3 })}`,
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
