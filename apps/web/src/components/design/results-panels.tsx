"use client";

/**
 * The analysis half of the results column: the P–M interaction diagram, the
 * utilization overview, and the calculation trace report.
 *
 * Contract (unchanged from the T2b/T2c mount point): the same props as
 * <WallCanvas> — the wall and its engine report, no context reads — so this
 * whole area can be reused in /learn with a one-off input.
 *
 * **Why the two chart panels are dynamic.** They are the only things on the
 * route that pull in the charting library, and it is by far the heaviest thing
 * the app ships: measured 148.6 KB gz / 491 KB raw in one chunk, 38% of
 * /design's whole JS payload, for two pictures that start below the fold. The
 * imports below are plain `dynamic()` — deliberately *not* `ssr: false` — so
 * the P–M diagram is still drawn into the server HTML (readable, and shareable
 * to a crawler, before any script runs) and nothing on the page shifts on
 * mount. What changes is that the library leaves the route's initial script
 * set: the inputs panel, the drawings and the trace hydrate on their own
 * chunks while the chart chunk is still arriving, instead of behind it.
 *
 * `dynamic()` wraps, it does not replace: both panels are still `memo`'d
 * internally, so the deferred wall the workspace feeds them keeps skipping the
 * expensive rebuilds exactly as before.
 */

import type { WallReport, WallInput } from "@kern/engine";
import dynamic from "next/dynamic";
import { TraceReport } from "@/components/design/trace-report";
import { UtilizationList } from "@/components/design/utilization-list";

const InteractionChart = dynamic(() =>
  import("@/components/design/interaction-chart").then((m) => m.InteractionChart),
);

const DriftPanel = dynamic(() =>
  import("@/components/design/drift-panel").then((m) => m.DriftPanel),
);

const DesignMap = dynamic(() =>
  import("@/components/design/design-map").then((m) => m.DesignMap),
);

const DesignOptions = dynamic(() =>
  import("@/components/design/design-options").then((m) => m.DesignOptions),
);

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
      {/* Self-hiding: the panel renders only on a special-system wall
          (§18.10.6.2 / §18.10.6.3), and returns null on every other one. That
          test is a plain field read, so it belongs *outside* the dynamic
          boundary — an ordinary wall then never mounts the panel, never
          requests its chunk, and never runs the 160-point capacity sweep. The
          condition is the panel's own first line, so the rendered result is
          unchanged. */}
      {chartInput.system === "special" ? <DriftPanel input={chartInput} /> : null}
      <DesignMap input={chartInput} report={chartReport} />
      <DesignOptions input={input} report={report} />
      <UtilizationList report={report} />
      <TraceReport input={input} report={report} />
    </div>
  );
}
