import { BARS, fcInput, lambdaInput } from "../materials";
import { aci, checkResult, constant, derive, input } from "../trace";
import type { CheckResult, Traced } from "../trace";
import { fmtTex } from "../units";
import { Ag, hInput, lwInput, schemeOf } from "../wall";
import type { Demands, WallInput } from "../wall";

/**
 * Effective depth for out-of-plane bending/shear.
 *
 * d = h − cover − d_b,horiz − d_b,vert/2 (handbook convention: the horizontal
 * distributed bars sit outboard of the vertical bars in a wall curtain, so the
 * vertical bar centroid is one horizontal-bar diameter inside the cover).
 *
 * NOTE vs MNL-17(21) Ex. 2: the handbook prints d = 12 − 1.5 − 0.5 − 8/16 = 9.5 in.,
 * i.e. it deducts a No. 4 (0.5 in.) outer bar rather than the No. 6 horizontal
 * bar actually specified. With the specified No. 6 horizontal and No. 8 vertical
 * bars our convention gives d = 12 − 1.5 − 0.75 − 0.5 = 9.25 in.
 */
export function effectiveDepthOutOfPlane(w: WallInput): Traced {
  // Pure geometry — no Code coefficient — so SI mode only moves the lengths and
  // bar diameters into mm; d is the same physical depth either way.
  const U = schemeOf(w);
  const h = hInput(w);
  const cover = input("oop.cover", "c_c", "clear cover", U.len(w.geometry.cover), U.length);
  const dbT = U.len(BARS[w.horizontal.bar].db);
  const dbL = U.len(BARS[w.vertical.bar].db);
  const dbTn = input(
    "oop.db_t",
    "d_b,t",
    `nominal diameter of the horizontal bar (No. ${w.horizontal.bar})`,
    dbT,
    U.length,
  );
  const dbLn = input(
    "oop.db_l",
    "d_b,l",
    `nominal diameter of the vertical bar (No. ${w.vertical.bar})`,
    dbL,
    U.length,
  );
  const value = h.value - cover.value - dbT - dbL / 2;
  return derive({
    id: "oop.d",
    symbol: "d",
    label: "effective depth for out-of-plane action",
    value,
    unit: U.length,
    formula: "d = h - c_c - d_{b,t} - \\frac{d_{b,l}}{2}",
    substitution: `d = ${fmtTex(h.value)} - ${fmtTex(cover.value, { dp: 2 })} - ${fmtTex(dbT, { dp: 3 })} - \\frac{${fmtTex(dbL, { dp: 3 })}}{2} = ${fmtTex(value, { dp: 2 })}\\ ${U.lengthTex}`,
    ref: aci("20.5.1"),
    inputs: [h, cover, dbTn, dbLn],
    note: "horizontal bars assumed outboard of the vertical bars in each curtain; MNL-17(21) Ex. 2 prints 9.5 in. from a slightly different stack-up",
  });
}

/**
 * Simplified design method for out-of-plane axial load, ACI 318-19 11.5.3.
 *
 * Pn = 0.55 f'c A_g [1 − (k ℓ_c/(32 h))²]   (Eq. 11.5.3.1)
 *
 * The expression is homogeneous — ACI 318M-19 11.5.3.1 prints the identical
 * 0.55 and the identical 32 (verified against the metric page), because kℓ_c/32h
 * is a ratio of lengths and 0.55 f'c A_g is a stress times an area. In SI mode
 * only the operands move: MPa × mm² = N, so the same ÷1000 lands on kN.
 *
 * Applicable only to solid rectangular sections whose factored load resultant
 * falls within the middle third of the thickness (e ≤ h/6). Outside that band
 * the check reports "na" and the caller must run the full P–M interaction (11.5.2 / 22.4).
 */
export function checkSimplifiedAxial(w: WallInput, demand: Demands): CheckResult {
  const U = schemeOf(w);
  const h = hInput(w);
  const pu = input("oop.Pu", "P_u", "factored axial force", U.frc(demand.Pu), U.force);
  const muOut = demand.MuOut ?? 0;
  const mu = input(
    "oop.MuOut",
    "M_u,oop",
    "factored out-of-plane moment",
    U.mom(muOut),
    U.moment,
  );

  const eMaxValue = h.value / 6;
  const eMax = derive({
    id: "oop.e_max",
    symbol: "e_max",
    label: "eccentricity limit for the simplified method (middle third of h)",
    value: eMaxValue,
    unit: U.length,
    formula: "e_{max} = h/6",
    substitution: `e_{max} = ${fmtTex(h.value)}/6 = ${fmtTex(eMaxValue, { dp: 2 })}\\ ${U.lengthTex}`,
    ref: aci("11.5.3.1"),
    inputs: [h],
  });

  // e = M_u/P_u must be evaluated inside one system: kip-ft/kip → in needs ×12,
  // kN·m/kN → mm needs ×1000. The eccentricity limit h/6 it is compared against
  // is in the same length unit, so the applicability test is edition-independent.
  const momentToForceLength = U.si ? 1000 : 12;
  const momentToForceLengthTex = U.si ? "1{,}000" : "12";
  const eValue = pu.value > 0 ? (mu.value * momentToForceLength) / pu.value : Number.POSITIVE_INFINITY;
  const applicable = Number.isFinite(eValue) && eValue <= eMaxValue;
  const e = derive({
    id: "oop.e",
    symbol: "e",
    label: "eccentricity of the factored axial resultant",
    value: eValue,
    unit: U.length,
    formula: "e = \\frac{M_{u,oop}}{P_u}",
    substitution: Number.isFinite(eValue)
      ? `e = \\frac{${fmtTex(mu.value)} \\times ${momentToForceLengthTex}}{${fmtTex(pu.value)}} = ${fmtTex(eValue, { dp: 3 })}\\ ${U.lengthTex}`
      : `e \\to \\infty \\quad (P_u = ${fmtTex(pu.value)}\\ ${U.forceTex})`,
    ref: aci("11.5.3.1"),
    inputs: [mu, pu],
    ...(applicable
      ? {
          note: `e ≤ h/6 = ${fmtTex(eMaxValue, { dp: 2 })} ${U.length} — the simplified method applies`,
        }
      : {
          status: "na" as const,
          note: "resultant falls outside the middle third of h (or the section is not in net compression) — 11.5.3 does not apply; use the full P–M interaction of 11.5.2 / 22.4",
        }),
  });

  if (!applicable) {
    return checkResult({
      id: "oop.simplified-axial",
      title: "Out-of-plane axial — simplified method applicability",
      ref: aci("11.5.3", "11.5.3.1"),
      demand: pu,
      trace: [e, eMax],
      status: "na",
    });
  }

  const fc = fcInput(w.concrete, U);
  const ag = Ag(w);
  const kNode = constant(
    "oop.k",
    "k",
    "effective length factor",
    w.geometry.k,
    "1",
    aci("11.5.3.2"),
    "Table 11.5.3.2: 0.8 braced with rotation restraint, 1.0 braced unrestrained, 2.0 unbraced",
  );
  const lc = input("oop.lc", "ℓ_c", "unsupported height", U.len(w.geometry.lu), U.length);

  // The 32 of Eq. (11.5.3.1) is UNCHANGED in ACI 318M-19 11.5.3.1 — kℓ_c/32h is
  // a ratio of lengths, so it is dimensionless and identical in both editions.
  const slenderValue = (kNode.value * lc.value) / (32 * h.value);
  const slender = derive({
    id: "oop.slenderness",
    symbol: "kℓ_c/32h",
    label: "slenderness term of the simplified method",
    value: slenderValue,
    unit: "1",
    formula: "\\frac{k\\,\\ell_c}{32\\,h}",
    substitution: `\\frac{${fmtTex(kNode.value, { dp: 2 })} \\times ${fmtTex(lc.value)}}{32 \\times ${fmtTex(h.value)}} = ${fmtTex(slenderValue, { dp: 4 })}`,
    ref: aci("11.5.3.1", "11.5.3.1"),
    inputs: [kNode, lc, h],
  });

  // 0.55 f'c A_g is homogeneous, so ACI 318M-19 11.5.3.1 keeps the same 0.55:
  // psi × in² = lb and MPa × mm² = N, and the same ÷1000 reports kip | kN.
  const fcCode = U.str(w.concrete.fc);
  const pnValue = (0.55 * fcCode * ag.value * (1 - slenderValue ** 2)) / 1000;
  const pn = derive({
    id: "oop.Pn",
    symbol: "P_n",
    label: "nominal axial strength by the simplified method",
    value: pnValue,
    unit: U.force,
    formula: "P_n = 0.55\\,f'_c\\,A_g\\left[1 - \\left(\\frac{k\\,\\ell_c}{32\\,h}\\right)^2\\right]",
    substitution: `P_n = 0.55 \\times ${fmtTex(fcCode)} \\times ${fmtTex(ag.value)} \\times \\left[1 - ${fmtTex(slenderValue, { dp: 4 })}^2\\right] = ${fmtTex(pnValue)}\\ ${U.forceTex}`,
    ref: aci("11.5.3.1", "11.5.3.1"),
    inputs: [fc, ag, slender],
    note: U.si
      ? "f'_c in MPa × A_g in mm² → N, reported in kN"
      : "f'_c in psi × A_g in in² → lb, reported in kip",
  });

  const phi = constant(
    "oop.phi_c",
    "φ",
    "strength reduction factor, compression-controlled",
    0.65,
    "1",
    aci("21.2.2"),
    "Table 21.2.2 (other, no spirals) — the simplified method presumes a compression-controlled section",
  );
  const phiPnValue = phi.value * pnValue;
  const phiPn = derive({
    id: "oop.phiPn",
    symbol: "φP_n",
    label: "design axial strength",
    value: phiPnValue,
    unit: U.force,
    formula: "\\phi P_n",
    substitution: `\\phi P_n = ${fmtTex(phi.value, { dp: 2 })} \\times ${fmtTex(pnValue)} = ${fmtTex(phiPnValue)}\\ ${U.forceTex}`,
    ref: aci("11.5.1.1"),
    inputs: [phi, pn],
  });

  const utilValue = phiPnValue === 0 ? Infinity : pu.value / phiPnValue;
  const util = derive({
    id: "oop.axial_utilization",
    symbol: "P_u/φP_n",
    label: "axial utilization",
    value: utilValue,
    unit: "1",
    formula: "\\frac{P_u}{\\phi P_n}",
    substitution: `\\frac{${fmtTex(pu.value)}}{${fmtTex(phiPnValue)}} = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("11.5.1.1"),
    inputs: [pu, phiPn],
  });

  return checkResult({
    id: "oop.simplified-axial",
    title: "Out-of-plane axial — simplified design method",
    ref: aci("11.5.3", "11.5.3.1"),
    demand: pu,
    capacity: phiPn,
    utilization: util,
    trace: [e, eMax, phiPn, util],
  });
}

/**
 * Out-of-plane (one-way) shear, ACI 318-19 11.5.5.1 → 22.5.
 *
 * A wall has no out-of-plane stirrups, so A_v < A_v,min always and Table 22.5.5.1
 * row (c) governs:
 *
 *   Vc = (8 λ_s λ ρ_w^{1/3} √f'c + N_u/(6 A_g)) b_w d
 *
 * with b_w = ℓ_w (a unit strip is not used; the full wall length spans out of
 * plane), ρ_w from the vertical distributed bars of the tension-face curtain,
 * λ_s = √(2/(1 + d/10)) ≤ 1.0 (22.5.5.1.3), N_u/(6 A_g) ≤ 0.05 f'c (22.5.5.1.2),
 * Vc ≤ 5 λ √f'c b_w d (22.5.5.1.1) and √f'c ≤ 100 psi (22.5.3.1).
 *
 * ACI 318M-19 rounds its own coefficients for the nonhomogeneous √f'c terms:
 * Table 22.5.5.1(c) 8 → 0.66, 22.5.5.1.1 5 → 0.42, 22.5.3.1 100 psi → 8.3 MPa,
 * and 22.5.5.1.3 λ_s = √(2/(1 + 0.004 d)) with d in mm. The N_u/(6 A_g) term and
 * its 0.05 f'c cap are homogeneous and print verbatim in both editions — only
 * their operands move (N and mm² instead of lb and in²).
 *
 * Vs is deliberately omitted: walls carry no out-of-plane shear reinforcement,
 * so Vn = Vc (22.5.1.1 with Vs = 0).
 */
export function checkOutOfPlaneShear(w: WallInput, demand: Demands): CheckResult {
  const U = schemeOf(w);
  const d = effectiveDepthOutOfPlane(w);
  const lw = lwInput(w);
  const ag = Ag(w);
  const fc = fcInput(w.concrete, U);
  const lambda = lambdaInput(w.concrete);

  // 22.5.3.1: √f'c ≤ 100 psi / ACI 318M-19 22.5.3.1: √f'c ≤ 8.3 MPa.
  const fcCode = U.str(w.concrete.fc);
  const sqrtCap = U.si ? 8.3 : 100;
  const sqrtCapTex = U.si ? "8.3" : "100";
  const sqrtDp = U.si ? 3 : 1;
  const sqrtRaw = U.sqrtFc(w.concrete.fc);
  const sqrtCapped = Math.min(sqrtRaw, sqrtCap);
  const sqrt = derive({
    id: "oop.sqrt_fc",
    symbol: "√f'_c",
    label: "square root of the specified compressive strength, limited by 22.5.3.1",
    value: sqrtCapped,
    unit: U.stress,
    formula: `\\sqrt{f'_c} \\le ${sqrtCapTex}\\ ${U.stressTex}`,
    substitution: `\\min\\left(\\sqrt{${fmtTex(fcCode)}},\\ ${sqrtCapTex}\\right) = ${fmtTex(sqrtCapped, { dp: sqrtDp })}\\ ${U.stressTex}^{0.5}`,
    ref: aci("22.5.3.1"),
    inputs: [fc],
    ...(sqrtRaw > sqrtCap
      ? { note: `√f'c limited to ${sqrtCapTex} ${U.stress} by 22.5.3.1` }
      : { note: `the ${sqrtCapTex} ${U.stress} limit of 22.5.3.1 does not govern` }),
  });

  // λ_s, Eq. (22.5.5.1.3) — size effect. d in inches with the /10 of 22.5.5.1.3;
  // ACI 318M-19 22.5.5.1.3 prints √(2/(1 + 0.004 d)) with d in mm.
  const sizeDenomTex = U.si ? "1 + 0.004\\,d" : "1 + d/10";
  const sizeTerm = U.si ? 0.004 * d.value : d.value / 10;
  const sizeSubstTex = U.si
    ? `1 + 0.004 \\times ${fmtTex(d.value, { dp: 1 })}`
    : `1 + ${fmtTex(d.value, { dp: 2 })}/10`;
  const lambdaSRaw = Math.sqrt(2 / (1 + sizeTerm));
  const lambdaSValue = Math.min(1, lambdaSRaw);
  const lambdaS = derive({
    id: "oop.lambda_s",
    symbol: "λ_s",
    label: "size effect modification factor",
    value: lambdaSValue,
    unit: "1",
    formula: `\\lambda_s = \\sqrt{\\frac{2}{${sizeDenomTex}}} \\le 1.0`,
    substitution: `\\lambda_s = \\min\\left(\\sqrt{\\frac{2}{${sizeSubstTex}}},\\ 1.0\\right) = ${fmtTex(lambdaSValue, { dp: 3 })}`,
    ref: aci("22.5.5.1.3", "22.5.5.1.3"),
    inputs: [d],
    ...(lambdaSRaw >= 1
      ? { note: U.si ? "d ≤ 250 mm — no size-effect reduction" : "d ≤ 10 in. — no size-effect reduction" }
      : {}),
  });

  // ρ_w from one curtain of vertical bars spread over ℓ_w (the tension face).
  const Ab = U.ar(BARS[w.vertical.bar].Ab);
  const s = U.len(w.vertical.spacing);
  const ab = input(
    "oop.Ab_l",
    "A_b,l",
    `nominal area of one vertical bar (No. ${w.vertical.bar})`,
    Ab,
    U.area,
  );
  const sNode = input("oop.s_l", "s_l", "vertical bar spacing", s, U.length);
  const asValue = (lw.value / s) * Ab;
  const asW = derive({
    id: "oop.As_w",
    symbol: "A_s,w",
    label: "vertical steel in the tension-face curtain over ℓ_w",
    value: asValue,
    unit: U.area,
    formula: "A_{s,w} = \\frac{\\ell_w}{s_l}\\,A_{b,l}",
    substitution: `A_{s,w} = \\frac{${fmtTex(lw.value)}}{${fmtTex(s)}} \\times ${fmtTex(Ab, { dp: 2 })} = ${fmtTex(asValue, { dp: 2 })}\\ ${U.areaTex}`,
    ref: aci("R22.5.5.1"),
    inputs: [lw, sNode, ab],
    note: "one curtain only — the far curtain is on the compression face and is not counted",
  });

  // ρ_w is dimensionless and identical in both editions; it is assembled from
  // the already-converted leaves so the substitution reads consistently.
  const rhoValue = asValue / (lw.value * d.value);
  const rho = derive({
    id: "oop.rho_w",
    symbol: "ρ_w",
    label: "tension-side longitudinal reinforcement ratio",
    value: rhoValue,
    unit: "1",
    formula: "\\rho_w = \\frac{A_{s,w}}{b_w\\,d}",
    substitution: `\\rho_w = \\frac{${fmtTex(asValue, { dp: 2 })}}{${fmtTex(lw.value)} \\times ${fmtTex(d.value, { dp: 2 })}} = ${fmtTex(rhoValue, { dp: 5 })}`,
    ref: aci("22.5.5.1"),
    inputs: [asW, lw, d],
  });

  // N_u/(6 A_g), limited to 0.05 f'c by 22.5.5.1.2 (positive in compression).
  // Both the 6 and the 0.05 are homogeneous and print verbatim in ACI 318M-19
  // 22.5.5.1.2; only the operands change — N over mm² instead of lb over in².
  const nu = input(
    "oop.Nu",
    "N_u",
    "factored axial force normal to the section",
    U.frc(demand.Pu),
    U.force,
  );
  const nuBase = U.frc(demand.Pu) * 1000;
  const axialRaw = nuBase / (6 * ag.value);
  const axialLimit = 0.05 * fcCode;
  const axialValue = Math.min(axialRaw, axialLimit);
  const axialCapped = axialRaw > axialLimit;
  const axial = derive({
    id: "oop.axial_term",
    symbol: "N_u/6A_g",
    label: "axial contribution to one-way shear strength",
    value: axialValue,
    unit: U.stress,
    formula: "\\frac{N_u}{6\\,A_g} \\le 0.05\\,f'_c",
    substitution: `\\min\\left(\\frac{${fmtTex(nuBase)}}{6 \\times ${fmtTex(ag.value)}},\\ 0.05 \\times ${fmtTex(fcCode)}\\right) = ${fmtTex(axialValue, { dp: 1 })}\\ ${U.stressTex}`,
    ref: aci("22.5.5.1.2"),
    inputs: [nu, ag, fc],
    note: axialCapped
      ? `N_u/(6A_g) = ${fmtTex(axialRaw, { dp: 1 })} ${U.stress} exceeds 0.05f'_c = ${fmtTex(axialLimit, { dp: 1 })} ${U.stress} — limited by 22.5.5.1.2`
      : U.si
        ? "N_u taken in N and A_g in mm²; positive in compression, negative in tension"
        : "N_u taken in lb and A_g in in²; positive in compression, negative in tension",
  });

  // Table 22.5.5.1(c) coefficient: 8 (psi, in²) / ACI 318M-19 Table 22.5.5.1(c)
  // 0.66 (MPa, mm²).
  const vcCoeffValue = U.si ? 0.66 : 8;
  const vcCoeffTex = U.si ? "0.66" : "8";
  const coeff = constant(
    "oop.vc_coeff",
    vcCoeffTex,
    "coefficient of Table 22.5.5.1(c) (A_v < A_v,min)",
    vcCoeffValue,
    "1",
    aci("22.5.5.1"),
    U.si
      ? "ACI 318M-19 Table 22.5.5.1(c) — the metric form of the 8 (psi) coefficient; row (c) governs because a wall has no out-of-plane stirrups"
      : "in-lb form of the 0.66 (MPa) coefficient; row (c) governs because a wall has no out-of-plane stirrups",
  );

  const vcStressRaw =
    vcCoeffValue * lambdaSValue * w.concrete.lambda * Math.cbrt(rhoValue) * sqrtCapped + axialValue;
  const vcStress = Math.max(0, vcStressRaw);
  const vcCalcValue = (vcStress * lw.value * d.value) / 1000;
  const vcCalc = derive({
    id: "oop.Vc_calc",
    symbol: "V_c,calc",
    label: "one-way shear strength from Table 22.5.5.1(c)",
    value: vcCalcValue,
    unit: U.force,
    formula: `V_c = \\left(${vcCoeffTex}\\,\\lambda_s\\,\\lambda\\,\\rho_w^{1/3}\\sqrt{f'_c} + \\frac{N_u}{6A_g}\\right) b_w\\,d, \\quad b_w = \\ell_w`,
    substitution: `V_c = \\left(${vcCoeffTex} \\times ${fmtTex(lambdaSValue, { dp: 3 })} \\times ${fmtTex(w.concrete.lambda, { dp: 2 })} \\times ${fmtTex(Math.cbrt(rhoValue), { dp: 4 })} \\times ${fmtTex(sqrtCapped, { dp: sqrtDp })} + ${fmtTex(axialValue, { dp: 1 })}\\right) \\times ${fmtTex(lw.value)} \\times ${fmtTex(d.value, { dp: 2 })} = ${fmtTex(vcCalcValue)}\\ ${U.forceTex}`,
    ref: aci("22.5.5.1"),
    inputs: [coeff, lambdaS, lambda, rho, sqrt, axial, lw, d],
    note: "V_c ≥ 0 per Table 22.5.5.1",
  });

  // 22.5.5.1.1 cap: 5λ√f'c·b_w·d (psi, in²) / ACI 318M-19 22.5.5.1.1
  // 0.42λ√f'c·b_w·d (MPa, mm²).
  const vcMaxCoeffValue = U.si ? 0.42 : 5;
  const vcMaxCoeffTex = U.si ? "0.42" : "5";
  const vcMaxValue = (vcMaxCoeffValue * w.concrete.lambda * sqrtCapped * lw.value * d.value) / 1000;
  const vcMax = derive({
    id: "oop.Vc_max",
    symbol: "V_c,max",
    label: "upper limit on one-way shear strength",
    value: vcMaxValue,
    unit: U.force,
    formula: `V_{c,max} = ${vcMaxCoeffTex}\\,\\lambda\\sqrt{f'_c}\\,b_w\\,d`,
    substitution: `V_{c,max} = ${vcMaxCoeffTex} \\times ${fmtTex(w.concrete.lambda, { dp: 2 })} \\times ${fmtTex(sqrtCapped, { dp: sqrtDp })} \\times ${fmtTex(lw.value)} \\times ${fmtTex(d.value, { dp: 2 })} = ${fmtTex(vcMaxValue)}\\ ${U.forceTex}`,
    ref: aci("22.5.5.1.1"),
    inputs: [lambda, sqrt, lw, d],
  });

  const capped = vcCalcValue > vcMaxValue;
  const vcValue = capped ? vcMaxValue : vcCalcValue;
  const vc = derive({
    id: "oop.Vc",
    symbol: "V_c",
    label: "nominal out-of-plane shear strength (V_n = V_c, no shear reinforcement)",
    value: vcValue,
    unit: U.force,
    formula: "V_n = V_c = \\min\\left(V_{c,calc},\\ V_{c,max}\\right)",
    substitution: `V_c = \\min(${fmtTex(vcCalcValue)},\\ ${fmtTex(vcMaxValue)}) = ${fmtTex(vcValue)}\\ ${U.forceTex}`,
    ref: aci("22.5.1.1", "22.5.1.1"),
    inputs: [vcCalc, vcMax],
    note: capped
      ? "limited by 22.5.5.1.1; V_s = 0 — walls carry no out-of-plane shear reinforcement"
      : "V_s = 0 — walls carry no out-of-plane shear reinforcement, so V_n = V_c (22.5.1.1)",
  });

  const phi = constant(
    "oop.phi_v",
    "φ",
    "strength reduction factor, shear",
    0.75,
    "1",
    aci("21.2.1"),
    "Table 21.2.1 — shear",
  );
  const phiVcValue = phi.value * vcValue;
  const phiVc = derive({
    id: "oop.phiVc",
    symbol: "φV_c",
    label: "design out-of-plane shear strength",
    value: phiVcValue,
    unit: U.force,
    formula: "\\phi V_n = \\phi V_c",
    substitution: `\\phi V_c = ${fmtTex(phi.value, { dp: 2 })} \\times ${fmtTex(vcValue)} = ${fmtTex(phiVcValue)}\\ ${U.forceTex}`,
    ref: aci("11.5.1.1"),
    inputs: [phi, vc],
  });

  const vuOut = demand.VuOut ?? 0;
  const vu = input(
    "oop.VuOut",
    "V_u,oop",
    "factored out-of-plane shear force",
    U.frc(vuOut),
    U.force,
  );
  const utilValue = phiVcValue === 0 ? Infinity : Math.abs(vu.value) / phiVcValue;
  const util = derive({
    id: "oop.shear_utilization",
    symbol: "V_u,oop/φV_c",
    label: "out-of-plane shear utilization",
    value: utilValue,
    unit: "1",
    formula: "\\frac{V_{u,oop}}{\\phi V_c}",
    substitution: `\\frac{${fmtTex(Math.abs(vu.value))}}{${fmtTex(phiVcValue)}} = ${fmtTex(utilValue, { dp: 3 })}`,
    ref: aci("11.5.1.1"),
    inputs: [vu, phiVc],
  });

  return checkResult({
    id: "oop.shear",
    title: "Out-of-plane (one-way) shear strength",
    ref: aci("11.5.5.1 / 22.5.5.1"),
    demand: vu,
    capacity: phiVc,
    utilization: util,
    trace: [vc, phiVc, util],
  });
}
