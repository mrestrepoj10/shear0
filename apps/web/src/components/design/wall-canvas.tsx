"use client";

/**
 * The drawing surface of /design: three true-scale engineering drawings of the
 * current wall — plan section (the hero), elevation, and the strain profile of
 * the governing flexure slice.
 *
 * Contract: a pure presentational component over the current wall and its
 * engine report. It owns the drawing surface only; it must not read the wall
 * context directly, so the same component can be reused in /learn with a
 * one-off input. (The plan section *publishes* a hover/focus selection through
 * `wall-state`, but that context defaults to a no-op, so the drawings still
 * render standalone.) Keep the props interface and the export name.
 */

import { fmt, type WallReport, type WallInput } from "@kern/engine";
import { memo } from "react";
import { WallElevation } from "@/components/design/drawing/elevation";
import { dim } from "@/components/design/drawing/format";
import { WallPlanSection } from "@/components/design/drawing/plan-section";
import { StrainProfile } from "@/components/design/drawing/strain-profile";
import { statusText } from "@/components/design/status";
import { cn } from "@/lib/utils";

export interface WallCanvasProps {
  input: WallInput;
  report: WallReport;
}

/** The load case the strain profile should draw: worst P–M utilization. */
function governingDemand(report: WallReport) {
  let best: { label: string; Pu: number; utilization: number } | null = null;
  for (const group of report.perDemand) {
    const check = group.checks.find((c) => c.id === "flexure.axial");
    const utilization = check?.utilization?.value;
    const ranked = utilization !== undefined && Number.isFinite(utilization) ? utilization : -1;
    if (best === null || ranked > best.utilization) {
      best = {
        label: group.demand.label ?? group.demand.id,
        Pu: group.demand.Pu,
        utilization: ranked,
      };
    }
  }
  return best;
}

function Plate({
  title,
  note,
  children,
  className,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("min-w-0 rounded-xl border border-border p-4", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-3">
        <span className="font-mono text-[11px] tracking-tight text-foreground">{title}</span>
        {note === undefined ? null : (
          <span className="font-mono text-[11px] tracking-tight text-muted-foreground">{note}</span>
        )}
      </figcaption>
      {children}
    </figure>
  );
}

/**
 * `memo` is what makes the caller's deferred wall worth anything: while a
 * keystroke is being processed the props still point at the previous wall, so
 * the three drawings skip the urgent render entirely and rebuild once, at
 * transition priority. Same props in, same drawing out — nothing here reads
 * context that could change underneath it.
 */
export const WallCanvas = memo(function WallCanvas({ input, report }: WallCanvasProps) {
  const { geometry } = input;
  const governing = governingDemand(report);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Plate
        title="plan section"
        note={`ℓw ${dim(geometry.lw)} × h ${dim(geometry.h)} in · true scale · bars enlarged`}
      >
        <WallPlanSection input={input} />
        <p className="pt-2 font-mono text-[11px] text-muted-foreground">
          hover or tab a station for its bars —{" "}
          <span className={cn(statusText(report.status))}>{report.status}</span> overall
        </p>
      </Plate>

      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Plate title="elevation" note={`hw ${dim(geometry.hw)} in`}>
          <WallElevation input={input} />
        </Plate>

        <Plate
          title="strain profile"
          note={
            governing === null
              ? "no load case"
              : `${governing.label} · Pu ${fmt(governing.Pu, { dp: 0 })} kip`
          }
        >
          {governing === null ? (
            <p className="py-6 text-center font-mono text-[11px] text-muted-foreground">
              add a load case to see the governing slice
            </p>
          ) : (
            <StrainProfile input={input} Pu={governing.Pu} />
          )}
        </Plate>
      </div>
    </div>
  );
});
