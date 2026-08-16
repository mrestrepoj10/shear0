import {
  AstInput,
  PnMax,
  Po,
  designSliceAt,
  etyInput,
  fcKsi,
  fyInput,
  xtInput,
} from "../section/interaction";
import { aci, checkResult, derive, input } from "../trace";
import type { CheckResult, Traced } from "../trace";
import { fmtTex } from "../units";
import type { Unit } from "../units";
import { hInput, lwInput, schemeOf } from "../wall";
import type { Demands, WallInput } from "../wall";

/**
 * In-plane combined flexure and axial force — ACI 318-19 §11.5.1.1 (φMn ≥ Mu and
 * φPn ≥ Pu at every section, P–M interaction considered), §11.5.2.1 (bearing-wall
 * Pn/Mn per §22.4) and §11.4.2.1 (Pu ≤ φPn,max with the compression-controlled φ).
 *
 * ## Reading the interaction diagram
 * Capacity is the **vertical slice**: φMn evaluated where the design curve
 * carries the factored axial force, i.e. at the c satisfying φ(c)Pn(c) = Pu, and
 * `utilization = |Mu| / φMn`. A **radial** reading (scaling the demand vector
 * (Mu, Pu) out to the curve) is an equally defensible measure of how close the
 * demand pair is to the surface, and is arguably more honest when Pu itself is
 * uncertain — but the vertical slice is what MNL-17 reports ("φMn = 24,600
 * ft-kip at Pu = 1015 kip") and what a designer reads off a published chart, so
 * that is what this check reports. See `phiMnAt` for the convention detail.
 *
 * The 22.4.2.1 axial cap is a separate limit state and is reported as its own
 * traced sub-check rather than being folded into the moment utilization; an
 * over-cap Pu drives the whole check NG regardless of the moment ratio.
 *
 * Mu is taken as |Mu|: `barPositions` produces a layout symmetric about ℓ_w/2, so
 * the ±M halves of the interaction surface are mirror images.
 *
 * ## Two editions
 * Nothing in this check carries an edition-specific coefficient: the 0.80 of
 * 22.4.2.1, φ = 0.65 of 11.4.2.1, the Table 21.2.2 φ ramp
 * (0.65 + 0.25(ε_t − ε_ty)/0.003) and ε_cu = 0.003 are printed identically in
 * ACI 318-19 and ACI 318M-19, and both utilization ratios are dimensionless.
 * What changes in SI mode is the system the demand leaves and the P–M
 * capacities are *reported* in — kN and kN·m against kip and kip-ft, with c and
 * x_t in mm. `section/interaction.ts` converts at its own reporting boundary, so
 * the slice arriving here is already in the wall's system; the demand leaves are
 * moved with `schemeOf(w)` to match.
 */

const PHI_COMPRESSION = 0.65;

// Demand leaves are memoized per Demands object so that the flexure, shear and
// boundary-element checks reading the same load combination share one node.
const demandNodes = new WeakMap<Demands, Map<string, Traced>>();

function demandInput(d: Demands, id: string, symbol: string, label: string, value: number, unit: Unit): Traced {
  let byId = demandNodes.get(d);
  if (byId === undefined) {
    byId = new Map();
    demandNodes.set(d, byId);
  }
  // Keyed by unit as well as id: a single graph is built in one system, but the
  // same Demands object may be reported by walls in either edition.
  const key = `${id}:${unit}`;
  let node = byId.get(key);
  if (node === undefined) {
    node = input(id, symbol, label, value, unit, d.label ?? d.id);
    byId.set(key, node);
  }
  return node;
}

export function checkFlexureAxial(w: WallInput, demand: Demands): CheckResult {
  const U = schemeOf(w);
  // Demands are stored canonically; `Pu` stays kip because that is what the
  // fiber solver takes, while `PuCode`/`MuCode` are the reported magnitudes.
  const Pu = demand.Pu;
  const Mu = Math.abs(demand.Mu);
  const PuCode = U.frc(Pu);
  const MuCode = U.mom(Mu);

  const PuNode = demandInput(demand, "flexure.Pu", "P_u", "factored axial force", PuCode, U.force);
  const MuNode = demandInput(demand, "flexure.Mu", "M_u", "factored in-plane moment", MuCode, U.moment);

  // --- 22.4.2.1 axial cap ---------------------------------------------------
  // 0.80 (22.4.2.1) and φ = 0.65 (Table 21.2.2, compression-controlled) are
  // dimensionless and printed identically in ACI 318M-19 22.4.2.1 / 21.2.2;
  // only the reported force unit changes.
  const pnMax = PnMax(w);
  const phiPnMaxValue = PHI_COMPRESSION * pnMax.value;
  const phiPnMax = derive({
    id: "flexure.phi_Pn_max",
    symbol: "φP_{n,max}",
    label: "design axial strength cap",
    value: phiPnMaxValue,
    unit: U.force,
    formula: "φP_{n,max} = 0.65 \\times 0.80 P_o",
    substitution: `φP_{n,max} = 0.65 \\times ${fmtTex(pnMax.value)} = ${fmtTex(phiPnMaxValue)}\\ ${U.forceTex}`,
    ref: aci("22.4.2.1"),
    inputs: [pnMax],
    note: "φ = 0.65, compression-controlled (11.4.2.1, Table 21.2.2)",
  });

  const axialRatio = phiPnMaxValue > 0 ? PuCode / phiPnMaxValue : 0;
  const axialOk = PuCode <= phiPnMaxValue;
  const axialUtilization = derive({
    id: "flexure.axial_utilization",
    symbol: "P_u/φP_{n,max}",
    label: "axial cap utilization",
    value: axialRatio,
    unit: "1",
    formula: "P_u/φP_{n,max} \\le 1.0",
    substitution: `${fmtTex(PuCode)} / ${fmtTex(phiPnMaxValue)} = ${fmtTex(axialRatio, { dp: 3 })}`,
    ref: aci("11.4.2.1"),
    inputs: [PuNode, phiPnMax],
    status: axialOk ? "ok" : "ng",
  });

  // --- vertical slice through the design curve at Pu ------------------------
  const slice = designSliceAt(w, Pu);
  const po = Po(w);

  if (slice === undefined) {
    // Pu is off the end of the design curve: there is no c with φ(c)Pn(c) = Pu,
    // so the section carries no moment at this axial force.
    const none = derive({
      id: "flexure.phiMn",
      symbol: "φM_n",
      label: "design flexural strength",
      value: 0,
      unit: U.moment,
      formula: "φM_n = φ(c)\\,M_n(c),\\ \\ φ(c)P_n(c) = P_u",
      substitution: `no c satisfies φ(c)P_n(c) = ${fmtTex(PuCode)}\\ ${U.forceTex} — P_u is outside the design axial range`,
      ref: aci("11.5.2.1 / 22.4"),
      inputs: [PuNode, po],
      status: "ng",
    });
    return checkResult({
      id: "flexure.axial",
      title: "In-plane flexure and axial force (P–M interaction)",
      ref: aci("11.5.1.1 / 11.5.2.1 / 22.4"),
      demand: MuNode,
      capacity: none,
      trace: [phiPnMax, axialUtilization, none],
      status: "ng",
    });
  }

  const cNode = derive({
    id: "flexure.c",
    symbol: "c",
    label: "neutral axis depth at the design axial force",
    value: slice.c,
    unit: U.length,
    // ε_cu = 0.003 and a = β1·c are 22.2.2.1 / 22.2.2.4.1, identical in both
    // editions; β1 itself branches inside materials.beta1 (ACI 318M-19
    // Table 22.2.2.4.3). `slice` arrives already in the wall's system.
    formula: "\\text{solve } φ(c)\\,P_n(c) = P_u \\quad (ε_{cu} = 0.003,\\ a = β_1 c)",
    substitution:
      `φ(c)P_n(c) = ${fmtTex(slice.phi, { dp: 3 })} \\times ${fmtTex(slice.Pn)} = ${fmtTex(slice.phi * slice.Pn)}` +
      ` = P_u = ${fmtTex(PuCode)}\\ ${U.forceTex} \\Rightarrow c = ${fmtTex(slice.c, { dp: 2 })}\\ ${U.lengthTex}`,
    ref: aci("22.2.2"),
    inputs: [PuNode, fcKsi(w), lwInput(w), hInput(w), fyInput(w), AstInput(w)],
    note: "fiber section: rectangular stress block plus every vertical bar station",
  });

  const xt = xtInput(w);
  const epsT = derive({
    id: "flexure.eps_t",
    symbol: "ε_t",
    label: "net tensile strain in the extreme tension reinforcement",
    value: slice.epsT,
    unit: "1",
    formula: "ε_t = 0.003\\,(x_t - c)/c",
    substitution: `ε_t = 0.003\\,(${fmtTex(xt.value, { dp: 1 })} - ${fmtTex(slice.c, { dp: 2 })})/${fmtTex(slice.c, { dp: 2 })} = ${fmtTex(slice.epsT, { dp: 5 })}`,
    ref: aci("22.2.1.2"),
    inputs: [xt, cNode],
    note: "tension positive",
  });

  const ety = etyInput(w);
  const phiNode = derive({
    id: "flexure.phi",
    symbol: "φ",
    label: "strength reduction factor",
    value: slice.phi,
    unit: "1",
    formula: "φ = 0.65 + 0.25\\,(ε_t - ε_{ty})/0.003,\\ \\ 0.65 \\le φ \\le 0.90",
    substitution: phiSubstitution(slice.epsT, w.grade.ety, slice.phi),
    ref: aci("21.2.2"),
    inputs: [epsT, ety],
    note: phiNote(slice.epsT, w.grade.ety),
  });

  const MnNode = derive({
    id: "flexure.Mn",
    symbol: "M_n",
    label: "nominal flexural strength",
    value: slice.Mn,
    unit: U.moment,
    formula: "M_n = C_c(ℓ_w/2 - a/2) + \\sum A_{s,i}\\,σ_i\\,(ℓ_w/2 - x_i)",
    substitution: `M_n = ${fmtTex(slice.Mn)}\\ \\text{${U.moment} at } c = ${fmtTex(slice.c, { dp: 2 })}\\ ${U.lengthTex},\\ P_n = ${fmtTex(slice.Pn)}\\ ${U.forceTex}`,
    ref: aci("22.3.1.1"),
    inputs: [cNode, fcKsi(w), hInput(w), lwInput(w), fyInput(w), AstInput(w)],
    note: "moments taken about the section centroid ℓ_w/2",
  });

  const phiMn = derive({
    id: "flexure.phiMn",
    symbol: "φM_n",
    label: "design flexural strength",
    value: slice.phiMn,
    unit: U.moment,
    formula: "φM_n = φ\\,M_n",
    substitution: `φM_n = ${fmtTex(slice.phi, { dp: 3 })} \\times ${fmtTex(slice.Mn)} = ${fmtTex(slice.phiMn)}\\ \\text{${U.moment}}`,
    ref: aci("11.5.1.1"),
    inputs: [phiNode, MnNode],
  });

  // Dimensionless — identical in both editions, but built from the already
  // converted leaves so the substitution reads consistently.
  const ratio = slice.phiMn > 0 ? MuCode / slice.phiMn : Number.POSITIVE_INFINITY;
  const utilization = derive({
    id: "flexure.utilization",
    symbol: "M_u/φM_n",
    label: "flexural utilization at P_u",
    value: ratio,
    unit: "1",
    formula: "M_u/φM_n \\le 1.0",
    substitution: `${fmtTex(MuCode)} / ${fmtTex(slice.phiMn)} = ${fmtTex(ratio, { dp: 3 })}`,
    ref: aci("11.5.1.1"),
    inputs: [MuNode, phiMn],
    status: ratio <= 1 ? "ok" : "ng",
    note: "vertical slice through the design interaction diagram at P_u",
  });

  return checkResult({
    id: "flexure.axial",
    title: "In-plane flexure and axial force (P–M interaction)",
    ref: aci("11.5.1.1 / 11.5.2.1 / 22.4"),
    demand: MuNode,
    capacity: phiMn,
    utilization,
    trace: [phiPnMax, axialUtilization, utilization],
  });
}

function phiSubstitution(epsT: number, ety: number, phi: number): string {
  if (epsT <= ety) return `ε_t = ${fmtTex(epsT, { dp: 5 })} \\le ε_{ty} = ${fmtTex(ety, { dp: 5 })} \\Rightarrow φ = 0.65`;
  if (epsT >= ety + 0.003)
    return `ε_t = ${fmtTex(epsT, { dp: 5 })} \\ge ε_{ty} + 0.003 = ${fmtTex(ety + 0.003, { dp: 5 })} \\Rightarrow φ = 0.90`;
  return `φ = 0.65 + 0.25\\,(${fmtTex(epsT, { dp: 5 })} - ${fmtTex(ety, { dp: 5 })})/0.003 = ${fmtTex(phi, { dp: 3 })}`;
}

function phiNote(epsT: number, ety: number): string {
  if (epsT <= ety) return "compression-controlled, Table 21.2.2";
  if (epsT >= ety + 0.003) return "tension-controlled, Table 21.2.2";
  return "transition zone, Table 21.2.2";
}
