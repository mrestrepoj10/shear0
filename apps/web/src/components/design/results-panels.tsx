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
  /**
   * The same wall, allowed to lag one render behind while the user types — the
   * two chart scenes are the most expensive things on the page to rebuild.
   * Optional: without it the charts follow `input`/`report`, so /learn can still
   * mount this area with a one-off wall and no provider.
   */
  deferred?: { input: WallInput; report: WallReport };
}

export function ResultsPanels({ input, report, deferred }: ResultsPanelsProps) {
  const chartInput = deferred?.input ?? input;
  const chartReport = deferred?.report ?? report;

  return (
    <div className="flex flex-col gap-3">
      <InteractionChart input={chartInput} report={chartReport} />
      {/* self-hiding: renders only on a special wall (§18.10.6.2 / §18.10.6.3) */}
      <DriftPanel input={chartInput} />
      <UtilizationList report={report} />
      <TraceReport input={input} report={report} />
    </div>
  );
}
