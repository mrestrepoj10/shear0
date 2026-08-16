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
 *
 * Two-edition seam: every absolute dimension in these sections is a *rounded
 * hard number* rather than a converted one — 4 in. against 100 mm, 10 in.
 * against 250 mm, 18 in. against 450 mm — so each site branches on
 * `schemeOf(w)` to the limit its edition actually prints and traces the whole
 * graph in that edition's length unit. The dimensionless triggers (the 1/25 and
 * 1/30 divisors of Table 11.3.1.1, the ℓw/3 and ℓw/5 limits of 11.7.2.1 /
 * 11.7.3.1, the 0.01 A_g tie trigger of 11.7.4.1) are identical in both.
 */
import { aci, checkResult, constant, derive, input } from "../trace";
import type { CheckResult, Traced } from "../trace";
import { fmtTex, kipFtToKipIn, kipFtToKnM, kipToKn } from "../units";
import { Ag, barPositions, hInput, lwInput, schemeOf } from "../wall";
import type { Demands, WallInput } from "../wall";
import { VuNode, concreteShearNodes, phiShearNode } from "./min-reinforcement";

const TOL = 1e-9;

// ℓu leaves are memoized per WallInput, matching the geometry-leaf convention in
// wall.ts, so checks that share the dimension share the node.
const luNodes = new WeakMap<WallInput, Traced>();

function luInput(w: WallInput): Traced {
  let node = luNodes.get(w);
  if (node === undefined) {
    // Stored in inches; traced in the reporting length unit so an SI graph
    // reads in mm all the way down to the leaves (see wall.ts geometryInput).
    const U = schemeOf(w);
    node = input(
      "detailing.lu",
      "ℓ_u",
      "unsupported height",
      U.len(w.geometry.lu),
      U.length,
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
  const U = schemeOf(w);
  const h = hInput(w);
  const lu = luInput(w);
  const bearing = w.wallType === "bearing";
  // Table 11.3.1.1 divisors are dimensionless and identical in both editions:
  // 1/25 for bearing walls, 1/30 for nonbearing walls.
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
  // Table 11.3.1.1 absolute floor: 4 in. (in-lb) / ACI 318M-19 Table 11.3.1.1
  // 100 mm, for both the bearing and nonbearing rows. (The exterior basement
  // and foundation wall row — 7.5 in. / 190 mm — is not modeled here; this
  // engine carries only the bearing/nonbearing wall types.)
  const floorValue = U.si ? 100 : 4;
  const floorTex = fmtTex(floorValue);
  const floor = constant(
    `${ns}.h_abs`,
    "h_abs",
    "absolute minimum wall thickness",
    floorValue,
    U.length,
    aci("11.3.1.1", "Table 11.3.1.1"),
    U.si
      ? "ACI 318M-19 Table 11.3.1.1 — the metric form of the 4 in. floor"
      : "in-lb form of the ACI 318M-19 100 mm floor",
  );

  const luValue = U.len(w.geometry.lu);
  const hValue = U.len(w.geometry.h);
  const slenderValue = luValue / divisorValue;
  const slender = derive({
    id: `${ns}.h_slender`,
    symbol: "ℓ_u/n",
    label: "slenderness-based minimum thickness",
    value: slenderValue,
    unit: U.length,
    formula: "\\dfrac{\\min(\\ell_{u,\\text{length}},\\ \\ell_{u,\\text{height}})}{n}",
    substitution: `\\dfrac{${fmtTex(luValue)}}{${fmtTex(divisorValue)}} = ${fmtTex(slenderValue, { dp: 2 })}\\ ${U.lengthTex}`,
    ref: aci("11.3.1.1", "Table 11.3.1.1"),
    inputs: [lu, divisor],
  });

  const reqValue = Math.max(floor.value, slenderValue);
  const satisfied = hValue >= reqValue - TOL;
  const required = derive({
    id: `${ns}.h_req`,
    symbol: "h_min",
    label: "minimum wall thickness",
    value: reqValue,
    unit: U.length,
    formula: `h_{min} = \\max\\!\\left(${floorTex}\\ ${U.lengthTex},\\ \\dfrac{\\min(\\ell_u)}{n}\\right)`,
    substitution: `\\max(${floorTex},\\ ${fmtTex(slenderValue, { dp: 2 })}) = ${fmtTex(reqValue, { dp: 2 })}\\ ${U.lengthTex}`,
    ref: aci("11.3.1.1", "Table 11.3.1.1"),
    inputs: [floor, slender],
    status: satisfied ? "ok" : "warning",
    note: "Table 11.3.1.1 applies only to walls designed by the simplified method of 11.5.3; thinner walls are permitted where adequate strength and stability are demonstrated by analysis",
  });

  const utilValue = hValue > 0 ? reqValue / hValue : Number.POSITIVE_INFINITY;
  const util = derive({
    id: `${ns}.utilization`,
    symbol: "h_min/h",
    label: "thickness utilization",
    value: utilValue,
    unit: "1",
    formula: "h_{min}/h",
    substitution: `${fmtTex(reqValue, { dp: 2 })} / ${fmtTex(hValue, { dp: 2 })} = ${fmtTex(utilValue, { dp: 3 })}`,
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
 * Base limit s <= min(3h, 18 in.) both ways — ACI 318M-19 11.7.2.1 / 11.7.3.1
 * print the absolute cap as 450 mm. Where shear reinforcement is required for
 * in-plane strength, the vertical bars are additionally limited to ℓw/3 and the
 * horizontal bars to ℓw/5 (dimensionless, identical in both editions).
 */
export function checkSpacing(w: WallInput, demand: Demands): CheckResult {
  const ns = "detailing.spacing";
  const U = schemeOf(w);
  const h = hInput(w);
  const lw = lwInput(w);
  const { Vc } = concreteShearNodes(w, ns);
  const phi = phiShearNode(ns);
  const Vu = VuNode(demand, ns, U);

  // Vc is already in the wall's force unit (kip | kN), so the demand is moved
  // into the same system rather than the term being converted back.
  const VuValue = Vu.value;
  const phiVcValue = phi.value * Vc.value;
  const phiVc = derive({
    id: `${ns}.phiVc`,
    symbol: "φα_cλ√f'_c·A_cv",
    label: "design shear strength of the concrete alone",
    value: phiVcValue,
    unit: U.force,
    formula: "\\phi\\,\\alpha_c\\lambda\\sqrt{f'_c}\\,A_{cv}",
    substitution: `${fmtTex(phi.value, { dp: 2 })} \\times ${fmtTex(Vc.value)} = ${fmtTex(phiVcValue)}\\ ${U.forceTex}`,
    ref: aci("11.5.4.3", "11.5.4.3"),
    inputs: [phi, Vc],
  });

  const requiredValue = VuValue > phiVcValue;
  const shearRequired = derive<boolean>({
    id: `${ns}.shear_reinf_required`,
    symbol: "shear reinf. req'd",
    label: "shear reinforcement required for in-plane strength",
    value: requiredValue,
    unit: "1",
    formula: "V_u > \\phi\\,\\alpha_c\\lambda\\sqrt{f'_c}\\,A_{cv}",
    substitution: `${fmtTex(VuValue)} > ${fmtTex(phiVcValue)} \\Rightarrow \\text{${requiredValue}}`,
    ref: aci("11.7.2.1"),
    inputs: [Vu, phiVc],
    note: '"required for in-plane strength" is taken as the concrete alone being insufficient, i.e. Vu > φ·αc·λ·√f\'c·Acv with φ = 0.75 (Table 21.2.1); only then do the ℓw/3 and ℓw/5 limits of 11.7.2.1 and 11.7.3.1 apply',
  });

  const hValue = U.len(w.geometry.h);
  const lwValue = U.len(w.geometry.lw);
  const threeHValue = 3 * hValue;
  const threeH = derive({
    id: `${ns}.three_h`,
    symbol: "3h",
    label: "three times the wall thickness",
    value: threeHValue,
    unit: U.length,
    formula: "3h",
    substitution: `3 \\times ${fmtTex(hValue, { dp: 1 })} = ${fmtTex(threeHValue, { dp: 1 })}\\ ${U.lengthTex}`,
    ref: aci("11.7.2.1"),
    inputs: [h],
  });
  // 11.7.2.1 / 11.7.3.1 absolute spacing cap: 18 in. (in-lb) /
  // ACI 318M-19 11.7.2.1 and 11.7.3.1 — 450 mm.
  const capValue = U.si ? 450 : 18;
  const capTex = fmtTex(capValue);
  const capAbs = constant(
    `${ns}.cap_18`,
    U.si ? "450 mm" : "18 in.",
    "absolute spacing limit",
    capValue,
    U.length,
    aci("11.7.2.1"),
    U.si
      ? "also 11.7.3.1 for transverse reinforcement; ACI 318M-19 prints 450 mm for the in-lb 18 in."
      : "also 11.7.3.1 for transverse reinforcement",
  );
  const baseValue = Math.min(threeHValue, capAbs.value);
  const base = derive({
    id: `${ns}.s_base`,
    symbol: "s_max,base",
    label: "base spacing limit",
    value: baseValue,
    unit: U.length,
    formula: `s \\le \\min(3h,\\ ${capTex}\\ ${U.lengthTex})`,
    substitution: `\\min(${fmtTex(threeHValue, { dp: 1 })},\\ ${capTex}) = ${fmtTex(baseValue, { dp: 1 })}\\ ${U.lengthTex}`,
    ref: aci("11.7.2.1"),
    inputs: [threeH, capAbs],
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
        unit: U.length,
        formula: `s \\le \\min(3h,\\ ${capTex}\\ ${U.lengthTex})`,
        substitution: `s_{max} = ${fmtTex(baseValue, { dp: 1 })}\\ ${U.lengthTex}`,
        ref: aci(ref),
        inputs: [base, shearRequired],
        note: `shear reinforcement is not required for in-plane strength, so the ℓw/${divisor} limit does not apply`,
      });
    }
    const fracValue = lwValue / divisor;
    const frac = derive({
      id: `${ns}.lw_over_${divisor}`,
      symbol: `ℓ_w/${divisor}`,
      label: "spacing limit where shear reinforcement is required for strength",
      value: fracValue,
      unit: U.length,
      formula: `\\ell_w/${divisor}`,
      substitution: `${fmtTex(lwValue)}/${divisor} = ${fmtTex(fracValue, { dp: 1 })}\\ ${U.lengthTex}`,
      ref: aci(ref),
      inputs: [lw],
    });
    const value = Math.min(baseValue, fracValue);
    return derive({
      id: `${ns}.s_max_${key}`,
      symbol,
      label: `maximum ${key === "vert" ? "vertical" : "horizontal"} bar spacing`,
      value,
      unit: U.length,
      formula: `s \\le \\min(3h,\\ ${capTex}\\ ${U.lengthTex},\\ \\ell_w/${divisor})`,
      substitution: `\\min(${fmtTex(baseValue, { dp: 1 })},\\ ${fmtTex(fracValue, { dp: 1 })}) = ${fmtTex(value, { dp: 1 })}\\ ${U.lengthTex}`,
      ref: aci(ref),
      inputs: [base, frac, shearRequired],
    });
  };

  const sMaxVert = limit("vert", 3, "11.7.2.1");
  const sMaxHoriz = limit("horiz", 5, "11.7.3.1");

  const sVert = input(
    `${ns}.s_vert`,
    "s_ℓ",
    "provided vertical bar spacing",
    U.len(w.vertical.spacing),
    U.length,
  );
  const sHoriz = input(
    `${ns}.s_horiz`,
    "s_t",
    "provided horizontal bar spacing",
    U.len(w.horizontal.spacing),
    U.length,
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

/**
 * 11.7.2.3 — walls thicker than 10 in. require two curtains of reinforcement.
 * ACI 318M-19 11.7.2.3 prints the same trigger as 250 mm.
 */
export function checkCurtains(w: WallInput): CheckResult {
  const ns = "detailing.curtains";
  const U = schemeOf(w);
  const h = hInput(w);
  // 11.7.2.3 two-curtain trigger: h > 10 in. (in-lb) /
  // ACI 318M-19 11.7.2.3 — h > 250 mm.
  const limitValue = U.si ? 250 : 10;
  const limitTex = fmtTex(limitValue);
  const limit = constant(
    `${ns}.h_limit`,
    "h_lim",
    "thickness above which two curtains are required",
    limitValue,
    U.length,
    aci("11.7.2.3"),
    U.si ? "ACI 318M-19 11.7.2.3 — the metric form of the 10 in. trigger" : undefined,
  );

  const hValue = U.len(w.geometry.h);
  const requiredValue = hValue > limit.value + TOL ? 2 : 1;
  const required = derive({
    id: `${ns}.n_req`,
    symbol: "n_req",
    label: "curtains of distributed reinforcement required",
    value: requiredValue,
    unit: "1",
    formula: `n_{req} = \\begin{cases} 2 & h > ${limitTex}\\ ${U.lengthTex} \\\\ 1 & \\text{otherwise} \\end{cases}`,
    substitution: `h = ${fmtTex(hValue, { dp: 1 })}\\ ${U.lengthTex} \\Rightarrow n_{req} = ${requiredValue}`,
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
 * The 0.01 trigger is a dimensionless area ratio and is printed identically in
 * ACI 318-19 and ACI 318M-19 11.7.4.1; neither edition carries a bar-size
 * clause, so there is nothing to branch on the strength side. Only the traced
 * areas, forces and the informational gross-section stress change system.
 *
 * The governing quantity is the vertical steel in one h x h strip at a wall end
 * (MNL-17 Ex. 1 step 8). The combined-stress term is carried alongside as
 * information only, reproducing the handbook's printed elastic gross-section
 * stress; the status comes from the Ast/Ag ratio alone.
 */
export function checkTies(w: WallInput, demand: Demands): CheckResult {
  const ns = "detailing.ties";
  const U = schemeOf(w);
  const h = hInput(w);
  const lw = lwInput(w);

  const stations = barPositions(w).filter((st) => st.x < w.geometry.h - 1e-6);
  const AstValue = U.ar(stations.reduce((sum, st) => sum + st.area, 0));
  const hValue = U.len(w.geometry.h);
  const lwValue = U.len(w.geometry.lw);
  const Ast = input(
    `${ns}.Ast_strip`,
    "A_st",
    "vertical steel in one end strip",
    AstValue,
    U.area,
    `${stations.length} bar station(s) within h = ${fmtTex(hValue, { dp: 1 })} ${U.length} of the wall end (end-zone bars where defined, otherwise distributed bars); a station lying exactly at x = h is taken as outside the strip, matching MNL-17 Ex. 1, which counts only the end pair`,
  );

  const AgStripValue = hValue * hValue;
  const AgStrip = derive({
    id: `${ns}.Ag_strip`,
    symbol: "A_g,strip",
    label: "gross area of one h x h end strip",
    value: AgStripValue,
    unit: U.area,
    formula: "A_{g,strip} = h^2",
    substitution: `${fmtTex(hValue, { dp: 1 })}^2 = ${fmtTex(AgStripValue)}\\ ${U.areaTex}`,
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
  const IgValue = U.sec4((w.geometry.h * w.geometry.lw ** 3) / 12);
  const Ig = derive({
    id: `${ns}.Ig`,
    symbol: "I_g",
    label: "gross moment of inertia about the strong axis",
    value: IgValue,
    unit: U.section4,
    formula: "I_g = \\dfrac{h\\,\\ell_w^3}{12}",
    substitution: `\\dfrac{${fmtTex(hValue, { dp: 1 })} \\times ${fmtTex(lwValue)}^3}{12} = ${fmtTex(IgValue)}\\ ${U.lengthTex}^4`,
    inputs: [h, lw],
  });
  const y = derive({
    id: `${ns}.y`,
    symbol: "y",
    label: "distance from the neutral axis used in the flexural stress term",
    value: lwValue,
    unit: U.length,
    formula: "y = \\ell_w",
    substitution: `y = ${fmtTex(lwValue)}\\ ${U.lengthTex}`,
    inputs: [lw],
    note: "handbook-as-printed uses y = lw (MNL-17 Ex. 1 step 8); the elastic gross-section extreme fiber is at lw/2",
  });

  // The stress is assembled in the base units of the edition in force so that it
  // lands in that edition's stress unit: lb / lb-in. against in² and in⁴ gives
  // psi, N / N·mm against mm² and mm⁴ gives MPa (N/mm² ≡ MPa). Nothing in
  // 11.7.4.1 is being evaluated here — this is the handbook's printed elastic
  // gross-section stress, carried as information only.
  const PuBase = U.si ? kipToKn(demand.Pu) * 1000 : demand.Pu * 1000;
  const MuBase = U.si ? kipFtToKnM(demand.Mu) * 1e6 : kipFtToKipIn(demand.Mu) * 1000;
  const Pu = input(
    `${ns}.Pu`,
    "P_u",
    `factored axial force (${demand.label ?? demand.id})`,
    U.frc(demand.Pu),
    U.force,
  );
  const Mu = input(
    `${ns}.Mu`,
    "M_u",
    `factored in-plane moment (${demand.label ?? demand.id})`,
    U.mom(demand.Mu),
    U.moment,
  );
  const axialTerm = PuBase / ag.value;
  const flexTerm = (MuBase * lwValue) / IgValue;
  const sigmaValue = axialTerm + flexTerm;
  const sigma = derive({
    id: `${ns}.sigma`,
    symbol: "σ",
    label: "elastic gross-section combined stress",
    value: sigmaValue,
    unit: U.stress,
    formula: "\\sigma = \\dfrac{P_u}{A_g} + \\dfrac{M_u\\,y}{I_g}",
    substitution:
      `\\dfrac{${fmtTex(PuBase)}}{${fmtTex(ag.value)}} + ` +
      `\\dfrac{${fmtTex(MuBase)} \\times ${fmtTex(lwValue)}}{${fmtTex(IgValue)}} = ` +
      `${fmtTex(axialTerm)} + ${fmtTex(flexTerm)} = ${fmtTex(sigmaValue)}\\ ${U.stressTex}`,
    ref: aci("11.7.4.1"),
    inputs: [Pu, ag, Mu, y, Ig],
    note: U.si
      ? "informational only — the MNL-17 Ex. 1 gross-section stress in the metric system; Pu (kN) and Mu (kN·m) are converted to N and N·mm in the substitution so the stress lands in MPa"
      : "informational only — reproduces the MNL-17 Ex. 1 printed value; Pu (kip) and Mu (kip-ft) are converted to lb and lb-in. in the substitution so the stress lands in psi",
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
