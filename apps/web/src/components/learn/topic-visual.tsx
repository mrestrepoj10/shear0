/**
 * The picture a walkthrough leads with.
 *
 * Every one of these is a `components/design/` component reused verbatim: they
 * are context-free by contract (props in, SVG out), which is what makes a
 * one-off wall from the learn registry render exactly the way the same wall
 * renders in /design. Nothing is re-drawn or re-styled here — this file only
 * decides *which* one a topic gets and gives it a caption.
 *
 * `<InteractionChart>` takes a whole `WallReport` because on /design it colors
 * one marker per load case from that case's flexure check. A walkthrough has a
 * single check, so it is wrapped in the smallest report that carries it; a
 * topic whose check is not `flexure.axial` simply gets an uncolored marker.
 */

import type { CheckResult, Demands, WallInput, WallReport } from "@kern/engine";
import { DriftPanel } from "@/components/design/drift-panel";
import { WallElevation } from "@/components/design/drawing/elevation";
import { WallPlanSection } from "@/components/design/drawing/plan-section";
import { StrainProfile } from "@/components/design/drawing/strain-profile";
import { InteractionChart } from "@/components/design/interaction-chart";
import { dim } from "@/components/design/drawing/format";
import type { LearnVisual } from "@/components/learn/topics";

function Plate({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    /* `Card`'s ring, the same one `wall-canvas.tsx`'s plate uses — one surface
       system across /design and /learn. */
    <figure className="min-w-0 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-3">
        <span className="font-mono text-xs2 tracking-tight text-foreground">{title}</span>
        {note === undefined ? null : (
          <span className="font-mono text-xs2 tracking-tight text-muted-foreground">{note}</span>
        )}
      </figcaption>
      {children}
    </figure>
  );
}

/** The smallest report that carries one check for one load case. */
function soloReport(check: CheckResult, demand: Demands | undefined): WallReport {
  return {
    general: demand === undefined ? [check] : [],
    perDemand: demand === undefined ? [] : [{ demand, checks: [check] }],
    status: check.status,
  };
}

export interface TopicVisualProps {
  visual: LearnVisual;
  input: WallInput;
  demand?: Demands;
  check: CheckResult;
}

export function TopicVisual({ visual, input, demand, check }: TopicVisualProps) {
  const { geometry } = input;

  switch (visual) {
    case "plan":
      return (
        <Plate
          title="plan section"
          note={`ℓw ${dim(geometry.lw)} × h ${dim(geometry.h)} in · true scale · bars enlarged`}
        >
          <WallPlanSection input={input} />
        </Plate>
      );
    case "elevation":
      return (
        <Plate title="elevation" note={`hw ${dim(geometry.hw)} in`}>
          <WallElevation input={input} />
        </Plate>
      );
    case "strain":
      return demand === undefined ? null : (
        <Plate title="strain profile" note={`Pu ${dim(demand.Pu)} kip`}>
          <StrainProfile input={input} Pu={demand.Pu} />
        </Plate>
      );
    case "interaction":
      return <InteractionChart input={input} report={soloReport(check, demand)} />;
    case "drift":
      return <DriftPanel input={input} />;
  }
}
