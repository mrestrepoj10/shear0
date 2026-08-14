/**
 * Special structural wall (ACI 318-19 §18.10) end-to-end report.
 *
 * Mirrors `checkOrdinaryWall`, with the Chapter 11 provisions that 18.10 does
 * **not** supersede kept in place:
 *
 * | provision | special-wall treatment |
 * |---|---|
 * | 11.3.1.1 minimum thickness | applies unchanged |
 * | 11.7.2.3 two curtains | **replaced** by 18.10.2.2 (inside the web-reinforcement check) |
 * | 11.6 minimum ratios | **replaced** by 18.10.2.1 |
 * | 11.7.2.1 / 11.7.3.1 spacing | applies (3h, ℓ_w/3, ℓ_w/5); 18.10.2.1 adds its own 18 in. cap |
 * | 11.5.4 in-plane shear | **replaced** by 18.10.3 (V_e) + 18.10.4 (V_n, φ) |
 * | 11.5.1/11.5.2 P–M | applies (18.10.5 points back to 22.4) |
 * | 11.5.3 / 11.5.5 out-of-plane | applies unchanged |
 * | — | 18.10.6 boundary elements, added |
 *
 * The 11.7.4.1 tie check is dropped: boundary confinement is governed by
 * 18.10.6.4/18.10.6.5, which this report evaluates properly.
 */
import type { WallInput } from "../wall";
import { checkSbeDetailing, checkSbeRequired } from "./boundary-element";
import { checkMinThickness, checkSpacing } from "./detailing";
import { checkFlexureAxial } from "./flexure-axial";
import { checkOutOfPlaneShear, checkSimplifiedAxial } from "./out-of-plane";
import { worstStatus } from "./report";
import type { WallReport } from "./report";
import { checkSeismicWebReinforcement } from "./special-reinforcement";
import { amplifiedShear, checkSpecialShear } from "./special-shear";

/** Special structural wall report; structurally identical to `WallReport`. */
export type SpecialWallReport = WallReport;

export function checkSpecialWall(w: WallInput): SpecialWallReport {
  const general = [checkMinThickness(w)];
  const perDemand = w.demands.map((demand) => {
    const checks = [
      checkSeismicWebReinforcement(w, demand),
      checkSpacing(w, demand),
      checkSpecialShear(w, demand),
      checkFlexureAxial(w, demand),
      checkSbeRequired(w, demand),
      checkSbeDetailing(w, demand, amplifiedShear(w, demand).Ve),
    ];
    if (demand.MuOut !== undefined) checks.push(checkSimplifiedAxial(w, demand));
    if (demand.VuOut !== undefined) checks.push(checkOutOfPlaneShear(w, demand));
    return { demand, checks };
  });
  const status = worstStatus([...general, ...perDemand.flatMap((d) => d.checks)]);
  return { general, perDemand, status };
}
