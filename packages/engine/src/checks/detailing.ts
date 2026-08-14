/**
 * ACI 318-19 Chapter 11 wall detailing checks:
 *   - Table 11.3.1.1 minimum thickness
 *   - 11.7.2.1 / 11.7.3.1 maximum bar spacing
 *   - 11.7.2.3 two-curtain trigger
 *   - 11.7.4.1 lateral ties for compression reinforcement
 *
 * Written for ordinary cast-in-place walls but with no `system === "ordinary"`
 * branching beyond what the cited sections themselves say, since Ch. 11
 * detailing is reused (and in places superseded) for special walls.
 */
import { aci, checkResult, constant, derive, input } from "../trace";
import type { CheckResult, Traced } from "../trace";
import { fmtTex, kipFtToKipIn } from "../units";
import { Ag, barPositions, hInput, lwInput } from "../wall";
import type { Demands, WallInput } from "../wall";
import { VuNode, concreteShearNodes, phiShearNode } from "./min-reinforcement";

const TOL = 1e-9;

// ℓu leaves are memoized per WallInput, matching the geometry-leaf convention in
// wall.ts, so checks that share the dimension share the node.
const luNodes = new WeakMap<WallInput, Traced>();

function luInput(w: WallInput): Traced {
  let node = luNodes.get(w);
  if (node === undefined) {
    node = input(
      "detailing.lu",
      "ℓ_u",
      "unsupported height",
      w.geometry.lu,
      "in",
      "unsupported length is not modeled separately; Table 11.3.1.1 takes the lesser of unsupported length and unsupported height, so ℓ_u governs both",
    );
    luNodes.set(w, node);
  }
  return node;
}

/**
 * Table 11.3.1.1 — minimum wall thickness.
 *
 * The table rows are footnoted as applying only to walls designed by the
 * simplified method of 11.5.3; thinner walls are permitted where adequate
 * strength and stability are demonstrated by analysis. A violation is therefore
 * reported as a warning rather than "ng".
 */
export function checkMinThickness(w: WallInput): CheckResult {
  const ns = "detailing.thickness";
  const h = hInput(w);
  const lu = luInput(w);
  const bearing = w.wallType === "bearing";
  const divisorValue = bearing ? 25 : 30;

  const divisor = constant(
    `${ns}.divisor`,
    "n",
    `unsupported-dimension divisor (${w.wallType} wall)`,
    divisorValue,
    "1",
    aci("11.3.1.1", "Table 11.3.1.1"),
    bearing ? "bearing wall row: 1/25" : "nonbearing wall row: 1/30",
  );
  const floor = constant(
    `${ns}.h_abs`,
    "h_abs",
    "absolute minimum wall thickness",
    4,
    "in",
    aci("11.3.1.1", "Table 11.3.1.1"),
  );

  const slenderValue = w.geometry.lu / divisorValue;
  const slender = derive({
    id: `${ns}.h_slender`,
    symbol: "ℓ_u/n",
    label: "slenderness-based minimum thickness",
    value: slenderValue,
    unit: "in",
    formula: "\\dfrac{\\min(\\ell_{u,\\text{length}},\\ \\ell_{u,\\text{height}})}{n}",
    substitution: `\\dfrac{${fmtTex(w.geometry.lu)}}{${fmtTex(divisorValue)}} = ${fmtTex(slenderValue, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("11.3.1.1", "Table 11.3.1.1"),
    inputs: [lu, divisor],
  });

  const reqValue = Math.max(floor.value, slenderValue);
  const satisfied = w.geometry.h >= reqValue - TOL;
  const required = derive({
    id: `${ns}.h_req`,
    symbol: "h_min",
    label: "minimum wall thickness",
    value: reqValue,
    unit: "in",
    formula: "h_{min} = \\max\\!\\left(4\\ \\text{in.},\\ \\dfrac{\\min(\\ell_u)}{n}\\right)",
    substitution: `\\max(4,\\ ${fmtTex(slenderValue, { dp: 2 })}) = ${fmtTex(reqValue, { dp: 2 })}\\ \\text{in.}`,
    ref: aci("11.3.1.1", "Table 11.3.1.1"),
    inputs: [floor, slender],
    status: satisfied ? "ok" : "warning",
    note: "Table 11.3.1.1 applies only to walls designed by the simplified method of 11.5.3; thinner walls are permitted where adequate strength and stability are demonstrated by analysis",
  });

  const utilValue = w.geometry.h > 0 ? reqValue / w.geometry.h : Number.POSITIVE_INFINITY;
  const util = derive({
    id: `${ns}.utilization`,
    symbol: "h_min/h",
    label: "thickness utilization",
    value: utilValue,
    unit: "1",
    formula: "h_{min}/h",
    substitution: `${fmtTex(reqValue, { dp: 2 })} / ${fmtTex(w.geometry.h, { dp: 2 })} = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("11.3.1.1", "Table 11.3.1.1"),
    inputs: [required, h],
  });

  return checkResult({
    id: "detailing.thickness",
    title: "Minimum wall thickness",
    ref: aci("11.3.1.1", "Table 11.3.1.1"),
    demand: required,
    capacity: h,
    utilization: util,
    trace: [util],
    status: satisfied ? "ok" : "warning",
  });
}

/**
 * 11.7.2.1 / 11.7.3.1 — maximum spacing of distributed reinforcement.
 *
 * Base limit s <= min(3h, 18 in.) both ways. Where shear reinforcement is
 * required for in-plane strength, the vertical bars are additionally limited to
 * ℓw/3 and the horizontal bars to ℓw/5.
 */
export function checkSpacing(w: WallInput, demand: Demands): CheckResult {
  const ns = "detailing.spacing";
  const h = hInput(w);
  const lw = lwInput(w);
  const { Vc } = concreteShearNodes(w, ns);
  const phi = phiShearNode(ns);
  const Vu = VuNode(demand, ns);

  const phiVcValue = phi.value * Vc.value;
  const phiVc = derive({
    id: `${ns}.phiVc`,
    symbol: "φα_cλ√f'_c·A_cv",
    label: "design shear strength of the concrete alone",
    value: phiVcValue,
    unit: "kip",
    formula: "\\phi\\,\\alpha_c\\lambda\\sqrt{f'_c}\\,A_{cv}",
    substitution: `${fmtTex(phi.value, { dp: 2 })} \\times ${fmtTex(Vc.value)} = ${fmtTex(phiVcValue)}\\ \\text{kip}`,
    ref: aci("11.5.4.3", "11.5.4.3"),
    inputs: [phi, Vc],
  });

  const requiredValue = demand.Vu > phiVcValue;
  const shearRequired = derive<boolean>({
    id: `${ns}.shear_reinf_required`,
    symbol: "shear reinf. req'd",
    label: "shear reinforcement required for in-plane strength",
    value: requiredValue,
    unit: "1",
    formula: "V_u > \\phi\\,\\alpha_c\\lambda\\sqrt{f'_c}\\,A_{cv}",
    substitution: `${fmtTex(demand.Vu)} > ${fmtTex(phiVcValue)} \\Rightarrow \\text{${requiredValue}}`,
    ref: aci("11.7.2.1"),
    inputs: [Vu, phiVc],
    note: '"required for in-plane strength" is taken as the concrete alone being insufficient, i.e. Vu > φ·αc·λ·√f\'c·Acv with φ = 0.75 (Table 21.2.1); only then do the ℓw/3 and ℓw/5 limits of 11.7.2.1 and 11.7.3.1 apply',
  });

  const threeHValue = 3 * w.geometry.h;
  const threeH = derive({
    id: `${ns}.three_h`,
    symbol: "3h",
    label: "three times the wall thickness",
    value: threeHValue,
    unit: "in",
    formula: "3h",
    substitution: `3 \\times ${fmtTex(w.geometry.h, { dp: 1 })} = ${fmtTex(threeHValue, { dp: 1 })}\\ \\text{in.}`,
    ref: aci("11.7.2.1"),
    inputs: [h],
  });
  const cap18 = constant(
    `${ns}.cap_18`,
    "18 in.",
    "absolute spacing limit",
    18,
    "in",
    aci("11.7.2.1"),
    "also 11.7.3.1 for transverse reinforcement",
  );
  const baseValue = Math.min(threeHValue, cap18.value);
  const base = derive({
    id: `${ns}.s_base`,
    symbol: "s_max,base",
    label: "base spacing limit",
    value: baseValue,
    unit: "in",
    formula: "s \\le \\min(3h,\\ 18\\ \\text{in.})",
    substitution: `\\min(${fmtTex(threeHValue, { dp: 1 })},\\ 18) = ${fmtTex(baseValue, { dp: 1 })}\\ \\text{in.}`,
    ref: aci("11.7.2.1"),
    inputs: [threeH, cap18],
  });

  const limit = (
    key: "vert" | "horiz",
    divisor: 3 | 5,
    ref: string,
  ): Traced => {
    const symbol = key === "vert" ? "s_max,ℓ" : "s_max,t";
    if (!requiredValue) {
      return derive({
        id: `${ns}.s_max_${key}`,
        symbol,
        label: `maximum ${key === "vert" ? "vertical" : "horizontal"} bar spacing`,
        value: baseValue,
        unit: "in",
        formula: "s \\le \\min(3h,\\ 18\\ \\text{in.})",
        substitution: `s_{max} = ${fmtTex(baseValue, { dp: 1 })}\\ \\text{in.}`,
        ref: aci(ref),
        inputs: [base, shearRequired],
        note: `shear reinforcement is not required for in-plane strength, so the ℓw/${divisor} limit does not apply`,
      });
    }
    const fracValue = w.geometry.lw / divisor;
    const frac = derive({
      id: `${ns}.lw_over_${divisor}`,
      symbol: `ℓ_w/${divisor}`,
      label: "spacing limit where shear reinforcement is required for strength",
      value: fracValue,
      unit: "in",
      formula: `\\ell_w/${divisor}`,
      substitution: `${fmtTex(w.geometry.lw)}/${divisor} = ${fmtTex(fracValue, { dp: 1 })}\\ \\text{in.}`,
      ref: aci(ref),
      inputs: [lw],
    });
    const value = Math.min(baseValue, fracValue);
    return derive({
      id: `${ns}.s_max_${key}`,
      symbol,
      label: `maximum ${key === "vert" ? "vertical" : "horizontal"} bar spacing`,
      value,
      unit: "in",
      formula: `s \\le \\min(3h,\\ 18\\ \\text{in.},\\ \\ell_w/${divisor})`,
      substitution: `\\min(${fmtTex(baseValue, { dp: 1 })},\\ ${fmtTex(fracValue, { dp: 1 })}) = ${fmtTex(value, { dp: 1 })}\\ \\text{in.}`,
      ref: aci(ref),
      inputs: [base, frac, shearRequired],
    });
  };

  const sMaxVert = limit("vert", 3, "11.7.2.1");
  const sMaxHoriz = limit("horiz", 5, "11.7.3.1");

  const sVert = input(`${ns}.s_vert`, "s_ℓ", "provided vertical bar spacing", w.vertical.spacing, "in");
  const sHoriz = input(
    `${ns}.s_horiz`,
    "s_t",
    "provided horizontal bar spacing",
    w.horizontal.spacing,
    "in",
  );

  const ratio = (
    key: "vert" | "horiz",
    provided: Traced,
    max: Traced,
    ref: string,
  ): Traced => {
    const value = max.value > 0 ? provided.value / max.value : Number.POSITIVE_INFINITY;
    return derive({
      id: `${ns}.util_${key}`,
      symbol: key === "vert" ? "s_ℓ/s_max,ℓ" : "s_t/s_max,t",
      label: `${key === "vert" ? "vertical" : "horizontal"} spacing utilization`,
      value,
      unit: "1",
      formula: "s/s_{max}",
      substitution: `${fmtTex(provided.value, { dp: 1 })} / ${fmtTex(max.value, { dp: 1 })} = ${fmtTex(value, { dp: 3 })}`,
      ref: aci(ref),
      inputs: [provided, max],
      status: provided.value <= max.value + TOL ? "ok" : "ng",
    });
  };

  const utilVert = ratio("vert", sVert, sMaxVert, "11.7.2.1");
  const utilHoriz = ratio("horiz", sHoriz, sMaxHoriz, "11.7.3.1");
  const utilValue = Math.max(utilVert.value, utilHoriz.value);
  const util = derive({
    id: `${ns}.utilization`,
    symbol: "s/s_max",
    label: "governing spacing utilization",
    value: utilValue,
    unit: "1",
    formula: "\\max(s_\\ell/s_{max,\\ell},\\ s_t/s_{max,t})",
    substitution: `\\max(${fmtTex(utilVert.value, { dp: 3 })},\\ ${fmtTex(utilHoriz.value, { dp: 3 })}) = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("11.7.2.1"),
    inputs: [utilVert, utilHoriz],
  });

  return checkResult({
    id: "detailing.spacing",
    title: "Maximum reinforcement spacing",
    ref: aci("11.7.2.1"),
    utilization: util,
    trace: [util],
  });
}

/** 11.7.2.3 — walls thicker than 10 in. require two curtains of reinforcement. */
export function checkCurtains(w: WallInput): CheckResult {
  const ns = "detailing.curtains";
  const h = hInput(w);
  const limit = constant(
    `${ns}.h_limit`,
    "h_lim",
    "thickness above which two curtains are required",
    10,
    "in",
    aci("11.7.2.3"),
  );

  const requiredValue = w.geometry.h > limit.value + TOL ? 2 : 1;
  const required = derive({
    id: `${ns}.n_req`,
    symbol: "n_req",
    label: "curtains of distributed reinforcement required",
    value: requiredValue,
    unit: "1",
    formula: "n_{req} = \\begin{cases} 2 & h > 10\\ \\text{in.} \\\\ 1 & \\text{otherwise} \\end{cases}",
    substitution: `h = ${fmtTex(w.geometry.h, { dp: 1 })}\\ \\text{in.} \\Rightarrow n_{req} = ${requiredValue}`,
    ref: aci("11.7.2.3"),
    inputs: [h, limit],
    note: "exceptions: single-story basement walls and cantilever retaining walls",
  });

  const nVert = input(
    `${ns}.n_vert`,
    "n_ℓ",
    "curtains of vertical reinforcement provided",
    w.vertical.curtains,
    "1",
  );
  const nHoriz = input(
    `${ns}.n_horiz`,
    "n_t",
    "curtains of horizontal reinforcement provided",
    w.horizontal.curtains,
    "1",
  );
  const providedValue = Math.min(w.vertical.curtains, w.horizontal.curtains);
  const provided = derive({
    id: `${ns}.n_prov`,
    symbol: "n_prov",
    label: "curtains provided (governing direction)",
    value: providedValue,
    unit: "1",
    formula: "n_{prov} = \\min(n_\\ell,\\ n_t)",
    substitution: `\\min(${w.vertical.curtains},\\ ${w.horizontal.curtains}) = ${providedValue}`,
    ref: aci("11.7.2.3"),
    inputs: [nVert, nHoriz],
  });

  const utilValue = providedValue > 0 ? requiredValue / providedValue : Number.POSITIVE_INFINITY;
  const util = derive({
    id: `${ns}.utilization`,
    symbol: "n_req/n_prov",
    label: "curtain utilization",
    value: utilValue,
    unit: "1",
    formula: "n_{req}/n_{prov}",
    substitution: `${requiredValue} / ${providedValue} = ${fmtTex(utilValue, { dp: 2 })}`,
    ref: aci("11.7.2.3"),
    inputs: [required, provided],
    status: providedValue >= requiredValue ? "ok" : "ng",
  });

  return checkResult({
    id: "detailing.curtains",
    title: "Curtains of distributed reinforcement",
    ref: aci("11.7.2.3"),
    demand: required,
    capacity: provided,
    utilization: util,
    trace: [util],
  });
}

/**
 * 11.7.4.1 — longitudinal reinforcement used as compression reinforcement must
 * be laterally tied where Ast exceeds 0.01·Ag.
 *
 * The governing quantity is the vertical steel in one h x h strip at a wall end
 * (MNL-17 Ex. 1 step 8). The combined-stress term is carried alongside as
 * information only, reproducing the handbook's printed elastic gross-section
 * stress; the status comes from the Ast/Ag ratio alone.
 */
export function checkTies(w: WallInput, demand: Demands): CheckResult {
  const ns = "detailing.ties";
  const h = hInput(w);
  const lw = lwInput(w);

  const stations = barPositions(w).filter((st) => st.x < w.geometry.h - 1e-6);
  const AstValue = stations.reduce((sum, st) => sum + st.area, 0);
  const Ast = input(
    `${ns}.Ast_strip`,
    "A_st",
    "vertical steel in one end strip",
    AstValue,
    "in2",
    `${stations.length} bar station(s) within h = ${w.geometry.h} in. of the wall end (end-zone bars where defined, otherwise distributed bars); a station lying exactly at x = h is taken as outside the strip, matching MNL-17 Ex. 1, which counts only the end pair`,
  );

  const AgStripValue = w.geometry.h * w.geometry.h;
  const AgStrip = derive({
    id: `${ns}.Ag_strip`,
    symbol: "A_g,strip",
    label: "gross area of one h x h end strip",
    value: AgStripValue,
    unit: "in2",
    formula: "A_{g,strip} = h^2",
    substitution: `${fmtTex(w.geometry.h, { dp: 1 })}^2 = ${fmtTex(AgStripValue)}\\ \\text{in}^2`,
    ref: aci("11.7.4.1"),
    inputs: [h],
  });

  const ratioValue = AstValue / AgStripValue;
  const ratio = derive({
    id: `${ns}.ratio`,
    symbol: "A_st/A_g",
    label: "end-strip longitudinal reinforcement ratio",
    value: ratioValue,
    unit: "1",
    formula: "A_{st}/A_{g,strip}",
    substitution: `${fmtTex(AstValue, { dp: 2 })} / ${fmtTex(AgStripValue)} = ${fmtTex(ratioValue)}`,
    ref: aci("11.7.4.1"),
    inputs: [Ast, AgStrip],
  });

  const limit = constant(
    `${ns}.limit`,
    "0.01",
    "tie trigger on the longitudinal reinforcement ratio",
    0.01,
    "1",
    aci("11.7.4.1"),
  );
  const tiesRequired = ratioValue > limit.value + TOL;
  const trigger = derive<boolean>({
    id: `${ns}.required`,
    symbol: "ties req'd",
    label: "lateral ties required",
    value: tiesRequired,
    unit: "1",
    formula: "A_{st} > 0.01\\,A_g",
    substitution: `${fmtTex(ratioValue)} > 0.01 \\Rightarrow \\text{${tiesRequired}}`,
    ref: aci("11.7.4.1"),
    inputs: [ratio, limit],
    status: tiesRequired ? "warning" : "ok",
    note: tiesRequired
      ? "longitudinal bars acting as compression reinforcement must be laterally tied per 11.7.4.1 / 10.7.6.1"
      : "ties not required",
  });

  // Informational: elastic gross-section combined stress, as printed in MNL-17
  // Ex. 1 step 8. Kept out of the status because 11.7.4.1 keys off Ast/Ag.
  const ag = Ag(w);
  const IgValue = (w.geometry.h * w.geometry.lw ** 3) / 12;
  const Ig = derive({
    id: `${ns}.Ig`,
    symbol: "I_g",
    label: "gross moment of inertia about the strong axis",
    value: IgValue,
    unit: "in4",
    formula: "I_g = \\dfrac{h\\,\\ell_w^3}{12}",
    substitution: `\\dfrac{${fmtTex(w.geometry.h, { dp: 1 })} \\times ${fmtTex(w.geometry.lw)}^3}{12} = ${fmtTex(IgValue)}\\ \\text{in}^4`,
    inputs: [h, lw],
  });
  const y = derive({
    id: `${ns}.y`,
    symbol: "y",
    label: "distance from the neutral axis used in the flexural stress term",
    value: w.geometry.lw,
    unit: "in",
    formula: "y = \\ell_w",
    substitution: `y = ${fmtTex(w.geometry.lw)}\\ \\text{in.}`,
    inputs: [lw],
    note: "handbook-as-printed uses y = lw (MNL-17 Ex. 1 step 8); the elastic gross-section extreme fiber is at lw/2",
  });

  const PuLb = demand.Pu * 1000;
  const MuLbIn = kipFtToKipIn(demand.Mu) * 1000;
  const Pu = input(
    `${ns}.Pu`,
    "P_u",
    `factored axial force (${demand.label ?? demand.id})`,
    demand.Pu,
    "kip",
  );
  const Mu = input(
    `${ns}.Mu`,
    "M_u",
    `factored in-plane moment (${demand.label ?? demand.id})`,
    demand.Mu,
    "kip-ft",
  );
  const axialTerm = PuLb / ag.value;
  const flexTerm = (MuLbIn * w.geometry.lw) / IgValue;
  const sigmaValue = axialTerm + flexTerm;
  const sigma = derive({
    id: `${ns}.sigma`,
    symbol: "σ",
    label: "elastic gross-section combined stress",
    value: sigmaValue,
    unit: "psi",
    formula: "\\sigma = \\dfrac{P_u}{A_g} + \\dfrac{M_u\\,y}{I_g}",
    substitution:
      `\\dfrac{${fmtTex(PuLb)}}{${fmtTex(ag.value)}} + ` +
      `\\dfrac{${fmtTex(MuLbIn)} \\times ${fmtTex(w.geometry.lw)}}{${fmtTex(IgValue)}} = ` +
      `${fmtTex(axialTerm)} + ${fmtTex(flexTerm)} = ${fmtTex(sigmaValue)}\\ \\text{psi}`,
    ref: aci("11.7.4.1"),
    inputs: [Pu, ag, Mu, y, Ig],
    note: "informational only — reproduces the MNL-17 Ex. 1 printed value; Pu (kip) and Mu (kip-ft) are converted to lb and lb-in. in the substitution so the stress lands in psi",
  });

  const utilValue = ratioValue / limit.value;
  const util = derive({
    id: `${ns}.utilization`,
    symbol: "A_st/(0.01A_g)",
    label: "tie-trigger utilization",
    value: utilValue,
    unit: "1",
    formula: "\\dfrac{A_{st}/A_{g,strip}}{0.01}",
    substitution: `${fmtTex(ratioValue)} / 0.01 = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("11.7.4.1"),
    inputs: [trigger],
  });

  return checkResult({
    id: "detailing.ties",
    title: "Lateral ties for compression reinforcement",
    ref: aci("11.7.4.1"),
    utilization: util,
    trace: [util, sigma],
    status: tiesRequired ? "warning" : "ok",
  });
}
