/**
 * The shape every wall report shares, so the UI can render an ordinary (Ch. 11)
 * and a special (18.10) wall through one component.
 */
import type { CheckResult, CheckStatus } from "../trace";
import type { Demands } from "../wall";

export interface DemandChecks {
  demand: Demands;
  checks: CheckResult[];
}

export interface WallReport {
  /** demand-independent checks (geometry, detailing) */
  general: CheckResult[];
  perDemand: DemandChecks[];
  /** worst status across all checks; "na" results do not degrade it */
  status: CheckStatus;
}

const SEVERITY: Record<CheckStatus, number> = { na: 0, ok: 1, warning: 2, ng: 3 };

export function worstStatus(checks: CheckResult[]): CheckStatus {
  let worst: CheckStatus = "ok";
  for (const c of checks) {
    if (c.status !== "na" && SEVERITY[c.status] > SEVERITY[worst]) worst = c.status;
  }
  return worst;
}
