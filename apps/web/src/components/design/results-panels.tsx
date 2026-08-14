"use client";

/**
 * The analysis half of the results column: the P–M interaction diagram, the
 * utilization overview, and the calculation trace report.
 *
 * Contract (unchanged from the T2b/T2c mount point): the same props as
 * <WallCanvas> — the wall and its engine report, no context reads — so this
 * whole area can be reused in /learn with a one-off input.
 */

import type { WallReport, WallInput } from "@kern/engine";
import { DriftPanel } from "@/components/design/drift-panel";
import { InteractionChart } from "@/components/design/interaction-chart";
import { TraceReport } from "@/components/design/trace-report";
import { UtilizationList } from "@/components/design/utilization-list";

export interface ResultsPanelsProps {
  input: WallInput;
  report: WallReport;
}

export function ResultsPanels({ input, report }: ResultsPanelsProps) {
  return (
    <div className="flex flex-col gap-3">
      <InteractionChart input={input} report={report} />
      {/* self-hiding: renders only on a special wall (§18.10.6.2 / §18.10.6.3) */}
      <DriftPanel input={input} />
      <UtilizationList report={report} />
      <TraceReport input={input} report={report} />
    </div>
  );
}
