/**
 * ACI 318-19 §11.6 — minimum distributed reinforcement for walls.
 *
 * Two paths, selected by the in-plane shear demand:
 *   Vu <= 0.5·φ·αc·λ·√f'c·Acv  → Table 11.6.1 minimums (row by bar size and fy)
 *   Vu >  that threshold        → 11.6.2: ρt >= 0.0025 and Eq. (11.6.2) for ρl.
 *
 * Written for ordinary cast-in-place walls (Ch. 11) but deliberately free of
 * `system === "ordinary"` branching: 18.10.2.1 reuses the Table 11.6.1 values
 * for low-shear special walls, so these nodes are reusable there.
 *
 * psi/ksi seam: f'c and fy are stored in ksi and traced in psi, because every
 * in-lb coefficient below (0.5, αc = 3/2, √f'c) is calibrated to psi.
 */
import { BARS, fcInput, lambdaInput } from "../materials";
import type { BarSize } from "../materials";
import { aci, checkResult, constant, derive, input } from "../trace";
import type { CheckResult, Traced } from "../trace";
import { fmtTex, ksiToPsi, sqrtFcPsi } from "../units";
import { Acv, hInput, hwOverLw } from "../wall";
import type { Demands, DistributedLayer, WallInput } from "../wall";

/** φ for shear, ACI 318-19 Table 21.2.1. */
export const PHI_SHEAR = 0.75;

export interface ConcreteShearNodes {
  acv: Traced;
  /** hw/ℓw, the aspect ratio αc is read from */
  ratio: Traced;
  alphaC: Traced;
  /** αc·λ·√f'c·Acv — the concrete contribution to Vn, kip */
  Vc: Traced;
}

/**
 * φ node for shear. Namespaced so that two checks sharing one trace graph do
 * not mint colliding ids.
 */
export function phiShearNode(ns: string): Traced {
  return constant(
    `${ns}.phi`,
    "φ",
    "strength reduction factor for shear",
    PHI_SHEAR,
    "1",
    aci("21.2.1"),
    "Table 21.2.1 — shear",
  );
}

/**
 * αc per 11.5.4.3 and the concrete-alone shear term αc·λ·√f'c·Acv (kip).
 * Shared by the 11.6 threshold and by the 11.7 "is shear reinforcement
 * required for in-plane strength?" test.
 */
export function concreteShearNodes(w: WallInput, ns: string): ConcreteShearNodes {
  const acv = Acv(w);
  const ratio = hwOverLw(w);
  const fc = fcInput(w.concrete);
  const lambda = lambdaInput(w.concrete);
  const r = ratio.value;

  let alphaValue: number;
  let alphaFormula: string;
  let alphaSubst: string;
  let alphaNote: string;
  if (r <= 1.5) {
    alphaValue = 3;
    alphaFormula = "\\alpha_c = 3";
    alphaSubst = `\\alpha_c = 3 \\quad (h_w/\\ell_w = ${fmtTex(r, { dp: 3 })} \\le 1.5)`;
    alphaNote = "squat wall, hw/ℓw ≤ 1.5 (in-lb coefficient)";
  } else if (r >= 2) {
    alphaValue = 2;
    alphaFormula = "\\alpha_c = 2";
    alphaSubst = `\\alpha_c = 2 \\quad (h_w/\\ell_w = ${fmtTex(r, { dp: 3 })} \\ge 2.0)`;
    alphaNote = "slender wall, hw/ℓw ≥ 2.0 (in-lb coefficient)";
  } else {
    alphaValue = 3 - 2 * (r - 1.5);
    alphaFormula = "\\alpha_c = 3 - 2\\,(h_w/\\ell_w - 1.5)";
    alphaSubst = `\\alpha_c = 3 - 2\\,(${fmtTex(r, { dp: 3 })} - 1.5) = ${fmtTex(alphaValue, { dp: 3 })}`;
    alphaNote = "linear interpolation for 1.5 < hw/ℓw < 2.0 (in-lb coefficients 3 and 2)";
  }

  const alphaC = derive({
    id: `${ns}.alpha_c`,
    symbol: "α_c",
    label: "shear strength coefficient",
    value: alphaValue,
    unit: "1",
    formula: alphaFormula,
    substitution: alphaSubst,
    ref: aci("11.5.4.3"),
    inputs: [ratio],
    note: `${alphaNote}; hw/ℓw shall be taken as the larger of the entire-wall and segment ratios — the entire-wall ratio is used here`,
  });

  const fcPsi = ksiToPsi(w.concrete.fc);
  const sqrtFc = sqrtFcPsi(w.concrete.fc);
  const VcLb = alphaValue * w.concrete.lambda * sqrtFc * acv.value;
  const Vc = derive({
    id: `${ns}.Vc`,
    symbol: "α_cλ√f'_c·A_cv",
    label: "concrete contribution to in-plane shear strength",
    value: VcLb / 1000,
    unit: "kip",
    formula: "\\alpha_c\\,\\lambda\\sqrt{f'_c}\\,A_{cv}",
    substitution:
      `${fmtTex(alphaValue, { dp: 2 })} \\times ${fmtTex(w.concrete.lambda, { dp: 2 })} \\times ` +
      `\\sqrt{${fmtTex(fcPsi)}} \\times ${fmtTex(acv.value)} = ${fmtTex(VcLb)}\\ \\text{lb} = ` +
      `${fmtTex(VcLb / 1000)}\\ \\text{kip}`,
    ref: aci("11.5.4.3", "11.5.4.3"),
    inputs: [alphaC, lambda, fc, acv],
    note: "ρt·fyt term omitted — this is the concrete-alone strength used by the 11.6 threshold and the 11.7 spacing trigger",
  });

  return { acv, ratio, alphaC, Vc };
}

/** Vu as a traced leaf, namespaced per check. */
export function VuNode(d: Demands, ns: string): Traced {
  return input(
    `${ns}.Vu`,
    "V_u",
    `factored in-plane shear (${d.label ?? d.id})`,
    d.Vu,
    "kip",
  );
}

/**
 * Provided distributed reinforcement ratio ρ = n_c·A_b/(s·h).
 *
 * Namespaced per check so the same ratio can be recomputed in a different trace
 * graph (18.10.2.1 and 18.10.4.1 both need it) without minting a duplicate id.
 */
export function rhoProvidedNode(
  w: WallInput,
  ns: string,
  key: "l" | "t",
  layer: DistributedLayer,
): Traced {
  const h = hInput(w);
  const Ab = BARS[layer.bar].Ab;
  const AbNode = input(`${ns}.rho_${key}.Ab`, "A_b", `area of one No. ${layer.bar} bar`, Ab, "in2");
  const nNode = input(
    `${ns}.rho_${key}.n_c`,
    "n_c",
    "curtains of distributed reinforcement",
    layer.curtains,
    "1",
  );
  const sNode = input(`${ns}.rho_${key}.s`, "s", "bar spacing", layer.spacing, "in");
  const value = (layer.curtains * Ab) / (layer.spacing * w.geometry.h);
  return derive({
    id: `${ns}.rho_${key}`,
    symbol: key === "l" ? "ρ_ℓ,prov" : "ρ_t,prov",
    label:
      key === "l"
        ? "provided longitudinal (vertical) reinforcement ratio"
        : "provided transverse (horizontal) reinforcement ratio",
    value,
    unit: "1",
    formula: "\\rho = \\dfrac{n_c A_b}{s\\,h}",
    substitution:
      `\\rho = \\dfrac{${fmtTex(layer.curtains)} \\times ${fmtTex(Ab, { dp: 2 })}}` +
      `{${fmtTex(layer.spacing, { dp: 1 })} \\times ${fmtTex(w.geometry.h, { dp: 1 })}} = ${fmtTex(value)}`,
    ref: aci("11.6"),
    inputs: [nNode, AbNode, sNode, h],
  });
}

interface TableRow {
  rhoL: number;
  rhoT: number;
  note: string;
}

/** Table 11.6.1, deformed-bar rows (WWR and precast rows not modeled yet). */
function tableRow(barSize: BarSize, fyKsi: number): TableRow {
  const big = Number(barSize) > 5;
  if (big) {
    return {
      rhoL: 0.0015,
      rhoT: 0.0025,
      note: `Table 11.6.1 row: deformed bars larger than No. 5 (No. ${barSize}), any f_y`,
    };
  }
  if (fyKsi >= 60) {
    return {
      rhoL: 0.0012,
      rhoT: 0.002,
      note: `Table 11.6.1 row: deformed bars No. 5 or smaller (No. ${barSize}), f_y ≥ 60,000 psi`,
    };
  }
  return {
    rhoL: 0.0015,
    rhoT: 0.0025,
    note: `Table 11.6.1 row: deformed bars No. 5 or smaller (No. ${barSize}), f_y < 60,000 psi`,
  };
}

function utilization(required: number, provided: number): number {
  if (provided > 0) return required / provided;
  return required > 0 ? Number.POSITIVE_INFINITY : 0;
}

/**
 * §11.6 minimum distributed reinforcement check.
 *
 * Deviation note (Eq. 11.6.2): MNL-17 Ex. 1 caps hw/ℓw at 2.0 when evaluating
 * Eq. (11.6.2), printing an intermediate ρl,req = 0.0030. The Code text has no
 * such cap, so the raw ratio is used here; for hw/ℓw > 2.5 the second term goes
 * negative and the 0.0025 floor governs. Both readings reach the same result in
 * Ex. 1 because ρt required for strength is zero, which waives ρl entirely.
 */
export function checkMinReinforcement(w: WallInput, demand: Demands): CheckResult {
  const ns = "minreinf";
  const { acv, ratio, Vc } = concreteShearNodes(w, ns);
  const phi = phiShearNode(ns);
  const Vu = VuNode(demand, ns);
  const fyPsi = ksiToPsi(w.grade.fy);
  const fy = input(`${ns}.fy`, "f_y", "specified yield strength of reinforcement", fyPsi, "psi");

  const half = constant(
    `${ns}.threshold_coeff`,
    "0.5",
    "threshold coefficient on the concrete-alone shear strength",
    0.5,
    "1",
    aci("11.6.1"),
  );
  const thresholdValue = half.value * phi.value * Vc.value;
  const threshold = derive({
    id: `${ns}.threshold`,
    symbol: "0.5φα_cλ√f'_c·A_cv",
    label: "shear demand below which Table 11.6.1 minimums apply",
    value: thresholdValue,
    unit: "kip",
    formula: "0.5\\,\\phi\\,\\alpha_c\\lambda\\sqrt{f'_c}\\,A_{cv}",
    substitution:
      `0.5 \\times ${fmtTex(phi.value, { dp: 2 })} \\times ${fmtTex(Vc.value)} = ` +
      `${fmtTex(thresholdValue)}\\ \\text{kip}`,
    ref: aci("11.6.1"),
    inputs: [half, phi, Vc],
  });

  const exceeds = demand.Vu > thresholdValue;
  const trigger = derive<boolean>({
    id: `${ns}.trigger`,
    symbol: "V_u > 0.5φα_cλ√f'_c·A_cv",
    label: "high-shear trigger",
    value: exceeds,
    unit: "1",
    formula: "V_u > 0.5\\,\\phi\\,\\alpha_c\\lambda\\sqrt{f'_c}\\,A_{cv}",
    substitution: `${fmtTex(demand.Vu)} > ${fmtTex(thresholdValue)} \\Rightarrow \\text{${exceeds}}`,
    ref: aci("11.6.1"),
    inputs: [Vu, threshold],
    note: exceeds
      ? "11.6.2 minimums govern"
      : "Table 11.6.1 minimums govern",
  });

  const rhoLProv = rhoProvidedNode(w, ns, "l", w.vertical);
  const rhoTProv = rhoProvidedNode(w, ns, "t", w.horizontal);

  let rhoLReq: Traced;
  let rhoTReq: Traced;

  if (!exceeds) {
    const rowL = tableRow(w.vertical.bar, w.grade.fy);
    const rowT = tableRow(w.horizontal.bar, w.grade.fy);
    const dbL = input(
      `${ns}.table.db_l`,
      "d_b,ℓ",
      `vertical bar size (No. ${w.vertical.bar})`,
      BARS[w.vertical.bar].db,
      "in",
    );
    const dbT = input(
      `${ns}.table.db_t`,
      "d_b,t",
      `horizontal bar size (No. ${w.horizontal.bar})`,
      BARS[w.horizontal.bar].db,
      "in",
    );
    rhoLReq = derive({
      id: `${ns}.rho_l_req`,
      symbol: "ρ_ℓ,min",
      label: "minimum longitudinal reinforcement ratio",
      value: rowL.rhoL,
      unit: "1",
      formula: "\\rho_{\\ell,min} = \\text{Table 11.6.1}(\\text{bar size},\\ f_y)",
      substitution: `\\rho_{\\ell,min} = ${fmtTex(rowL.rhoL)}`,
      ref: aci("11.6.1", "Table 11.6.1"),
      inputs: [dbL, fy, trigger],
      note: `${rowL.note}; deformed bars, cast-in-place (WWR and precast rows not modeled)`,
    });
    rhoTReq = derive({
      id: `${ns}.rho_t_req`,
      symbol: "ρ_t,min",
      label: "minimum transverse reinforcement ratio",
      value: rowT.rhoT,
      unit: "1",
      formula: "\\rho_{t,min} = \\text{Table 11.6.1}(\\text{bar size},\\ f_y)",
      substitution: `\\rho_{t,min} = ${fmtTex(rowT.rhoT)}`,
      ref: aci("11.6.1", "Table 11.6.1"),
      inputs: [dbT, fy, trigger],
      note: `${rowT.note}; deformed bars, cast-in-place (WWR and precast rows not modeled)`,
    });
  } else {
    const base = constant(
      `${ns}.rho_base`,
      "0.0025",
      "minimum distributed reinforcement ratio of 11.6.2",
      0.0025,
      "1",
      aci("11.6.2"),
    );

    rhoTReq = derive({
      id: `${ns}.rho_t_req`,
      symbol: "ρ_t,min",
      label: "minimum transverse reinforcement ratio",
      value: base.value,
      unit: "1",
      formula: "\\rho_t \\ge 0.0025",
      substitution: `\\rho_{t,min} = ${fmtTex(base.value)}`,
      ref: aci("11.6.2"),
      inputs: [base, trigger],
      note: "11.6.2(b)",
    });

    // ρt required for strength by 11.5.4.3, rearranged from
    // Vu/φ <= (αc·λ·√f'c + ρt·fyt)·Acv. Zero whenever the concrete alone
    // carries Vu/φ — the case that waives the ρl requirement below.
    const VuLb = demand.Vu * 1000;
    const demandOverPhi = VuLb / phi.value;
    const VcLb = Vc.value * 1000;
    const rhoTStrengthValue = Math.max(0, (demandOverPhi - VcLb) / (fyPsi * acv.value));
    const rhoTStrength = derive({
      id: `${ns}.rho_t_strength`,
      symbol: "ρ_t,strength",
      label: "transverse reinforcement ratio required for shear strength",
      value: rhoTStrengthValue,
      unit: "1",
      formula:
        "\\rho_{t,strength} = \\max\\!\\left(0,\\ \\dfrac{V_u/\\phi - \\alpha_c\\lambda\\sqrt{f'_c}A_{cv}}{f_{yt}A_{cv}}\\right)",
      substitution:
        `\\max\\!\\left(0,\\ \\dfrac{${fmtTex(demandOverPhi)} - ${fmtTex(VcLb)}}` +
        `{${fmtTex(fyPsi)} \\times ${fmtTex(acv.value)}}\\right) = ${fmtTex(rhoTStrengthValue)}`,
      ref: aci("11.5.4.3", "11.5.4.3"),
      inputs: [Vu, phi, Vc, fy, acv],
      note:
        rhoTStrengthValue === 0
          ? "concrete alone carries Vu/φ, so no transverse reinforcement is required for strength"
          : "rearranged from Vn = (αc·λ·√f'c + ρt·fyt)·Acv",
    });

    // Eq. (11.6.2): 0.0025 + 0.5(2.5 - hw/ℓw)(ρt - 0.0025), raw hw/ℓw (no cap
    // in the Code text). MNL-17 Ex. 1 caps the ratio at 2.0 and prints 0.0030.
    const eqValue = 0.0025 + 0.5 * (2.5 - ratio.value) * (rhoTProv.value - 0.0025);
    const eq = derive({
      id: `${ns}.rho_l_eq`,
      symbol: "ρ_ℓ,eq",
      label: "Eq. (11.6.2) longitudinal ratio",
      value: eqValue,
      unit: "1",
      formula: "\\rho_\\ell = 0.0025 + 0.5\\,(2.5 - h_w/\\ell_w)\\,(\\rho_t - 0.0025)",
      substitution:
        `0.0025 + 0.5\\,(2.5 - ${fmtTex(ratio.value, { dp: 3 })})\\,` +
        `(${fmtTex(rhoTProv.value)} - 0.0025) = ${fmtTex(eqValue)}`,
      ref: aci("11.6.2", "11.6.2"),
      inputs: [base, ratio, rhoTProv],
      note:
        ratio.value > 2.5
          ? "hw/ℓw > 2.5 makes the second term negative, so the 0.0025 floor governs [R11.6.2]. MNL-17 Ex. 1 caps hw/ℓw at 2.0 and prints 0.0030; the Code text has no cap"
          : "MNL-17 Ex. 1 evaluates this term with hw/ℓw capped at 2.0",
    });

    const flooredValue = Math.max(0.0025, eqValue);
    const floored = derive({
      id: `${ns}.rho_l_floor`,
      symbol: "ρ_ℓ,11.6.2",
      label: "longitudinal ratio required by 11.6.2(a) before the strength waiver",
      value: flooredValue,
      unit: "1",
      formula: "\\rho_\\ell \\ge \\max(0.0025,\\ \\rho_{\\ell,eq})",
      substitution: `\\max(0.0025,\\ ${fmtTex(eqValue)}) = ${fmtTex(flooredValue)}`,
      ref: aci("11.6.2", "11.6.2"),
      inputs: [base, eq],
    });

    const reqValue = Math.min(flooredValue, rhoTStrengthValue);
    rhoLReq = derive({
      id: `${ns}.rho_l_req`,
      symbol: "ρ_ℓ,min",
      label: "minimum longitudinal reinforcement ratio",
      value: reqValue,
      unit: "1",
      formula: "\\rho_{\\ell,min} = \\min(\\rho_{\\ell,11.6.2},\\ \\rho_{t,strength})",
      substitution: `\\min(${fmtTex(flooredValue)},\\ ${fmtTex(rhoTStrengthValue)}) = ${fmtTex(reqValue)}`,
      ref: aci("11.6.2", "11.6.2"),
      inputs: [floored, rhoTStrength],
      note:
        rhoTStrengthValue === 0
          ? "11.6.2(a): ρℓ need not exceed the ρt required for strength by 11.5.4.3 — that is zero here, so the longitudinal requirement is waived (as in MNL-17 Ex. 1)"
          : "11.6.2(a): ρℓ need not exceed the ρt required for strength by 11.5.4.3",
    });
  }

  const utilL = utilization(rhoLReq.value, rhoLProv.value);
  const utilT = utilization(rhoTReq.value, rhoTProv.value);
  const checkL = derive({
    id: `${ns}.util_l`,
    symbol: "ρ_ℓ,min/ρ_ℓ,prov",
    label: "longitudinal reinforcement utilization",
    value: utilL,
    unit: "1",
    formula: "\\rho_{\\ell,min}/\\rho_{\\ell,prov}",
    substitution: `${fmtTex(rhoLReq.value)} / ${fmtTex(rhoLProv.value)} = ${fmtTex(utilL, { dp: 3 })}`,
    ref: aci("11.6"),
    inputs: [rhoLReq, rhoLProv],
    status: rhoLProv.value >= rhoLReq.value ? "ok" : "ng",
  });
  const checkT = derive({
    id: `${ns}.util_t`,
    symbol: "ρ_t,min/ρ_t,prov",
    label: "transverse reinforcement utilization",
    value: utilT,
    unit: "1",
    formula: "\\rho_{t,min}/\\rho_{t,prov}",
    substitution: `${fmtTex(rhoTReq.value)} / ${fmtTex(rhoTProv.value)} = ${fmtTex(utilT, { dp: 3 })}`,
    ref: aci("11.6"),
    inputs: [rhoTReq, rhoTProv],
    status: rhoTProv.value >= rhoTReq.value ? "ok" : "ng",
  });

  const utilValue = Math.max(utilL, utilT);
  const util = derive({
    id: `${ns}.utilization`,
    symbol: "ρ_min/ρ_prov",
    label: "governing minimum-reinforcement utilization",
    value: utilValue,
    unit: "1",
    formula: "\\max(\\rho_{\\ell,min}/\\rho_{\\ell,prov},\\ \\rho_{t,min}/\\rho_{t,prov})",
    substitution: `\\max(${fmtTex(utilL, { dp: 3 })},\\ ${fmtTex(utilT, { dp: 3 })}) = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("11.6"),
    inputs: [checkL, checkT],
  });

  return checkResult({
    id: "minreinf",
    title: "Minimum distributed reinforcement",
    ref: aci("11.6"),
    demand: Vu,
    utilization: util,
    trace: [trigger, util],
  });
}
