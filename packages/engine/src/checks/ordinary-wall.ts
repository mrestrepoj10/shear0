import { stampEdition } from "../trace";
import type { WallInput } from "../wall";
import { unitsOf } from "../wall";
import { checkCurtains, checkMinThickness, checkSpacing, checkTies } from "./detailing";
import { checkFlexureAxial } from "./flexure-axial";
import { checkMinReinforcement } from "./min-reinforcement";
import { checkOutOfPlaneShear, checkSimplifiedAxial } from "./out-of-plane";
import { worstStatus } from "./report";
import type { WallReport } from "./report";
import { checkInPlaneShear } from "./shear-in-plane";

export type { DemandChecks, WallReport } from "./report";
export { worstStatus } from "./report";

/** Ordinary cast-in-place wall report; structurally identical to `WallReport`. */
export type OrdinaryWallReport = WallReport;

export function checkOrdinaryWall(w: WallInput): OrdinaryWallReport {
  const general = [checkMinThickness(w), checkCurtains(w)];
  const perDemand = w.demands.map((demand) => {
    const checks = [
      checkMinReinforcement(w, demand),
      checkSpacing(w, demand),
      checkTies(w, demand),
      checkInPlaneShear(w, demand),
      checkFlexureAxial(w, demand),
    ];
    if (demand.MuOut !== undefined) checks.push(checkSimplifiedAxial(w, demand));
    if (demand.VuOut !== undefined) checks.push(checkOutOfPlaneShear(w, demand));
    return { demand, checks };
  });
  const all = [...general, ...perDemand.flatMap((d) => d.checks)];
  if (unitsOf(w) === "si") stampEdition(all, "ACI 318M-19");
  const status = worstStatus(all);
  return { general, perDemand, status };
}
