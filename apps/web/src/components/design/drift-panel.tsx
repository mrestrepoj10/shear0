"use client";

/**
 * Drift capacity — Eq. (18.10.6.2b), as a function of the one variable the
 * designer actually controls.
 *
 * The width option (iii) is the only place in §18.10 where a boundary element is
 * sized by a *formula in b*, and the shape of that formula is not obvious: the
 * geometric term goes as 1/b², so the first two inches buy far more capacity
 * than the next two, and past a point the shear term alone decides the answer.
 * MNL-17(21) Ex. 2 discovers this by trying b = 12 in. (0.0035, nowhere near),
 * then b = 16 in. (0.0173, clear) — two points on this curve. Sweeping it makes
 * the whole trade visible at once: where the demand line 1.5δu/hwcs crosses is
 * the width the code asks for.
 *
 * Nothing here re-derives the code: `driftCapacityRatio` is the engine's own
 * Eq. (18.10.6.2b), fed the c and Ve that `sbeRequirement` and `amplifiedShear`
 * produced for the governing combination. On the stress-based path (18.10.6.3)
 * the equation does not exist, so the panel shows that comparison instead.
 */

import {
  Acv,
  amplifiedShear,
  driftCapacityRatio,
  fmt,
  sbeRequirement,
  type Demands,
  type WallInput,
} from "@shear0/engine";
import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import { ChartExportButtons } from "@/components/design/chart-export";
import {
  XyChart,
  type ChartToken,
  type XyFocus,
  type XyMarker,
  type XySeries,
} from "@/components/charts/xy-chart";
import { num, statusText } from "@/components/design/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { viewOf, type UnitsView } from "@/lib/units-view";
import { cn } from "@/lib/utils";

const SWEEP_POINTS = 160;
/** 18.10.6.2(b)(iii): δc/hwcs need not be taken below this. */
const DRIFT_CAPACITY_FLOOR = 0.015;

/** Frozen per system for the same reason the P–M chart's axes are. */
const X_AXES = {
  "in-lb": {
    label: "b  (in)  — boundary element width",
    format: (value: number) => fmt(value, { dp: 0 }),
  },
  si: {
    label: "b  (mm)  — boundary element width",
    format: (value: number) => fmt(value, { dp: 0 }),
  },
} as const;

const Y_AXIS = {
  label: "δc/hwcs",
  format: (value: number) => value.toFixed(4),
  include: [0],
} as const;

interface DriftMeta {
  kind: "capacity" | "computed" | "demand" | "provided";
}

interface DriftView {
  path: "displacement";
  U: UnitsView;
  label: string;
  c: number;
  Ve: number;
  demand15: number;
  sqrtReq: number;
  bProvided: number | undefined;
  capacityAt: (b: number) => number;
  rawAt: (b: number) => number;
  bMin: number;
  bMax: number;
  /** narrowest swept width that satisfies option (iii), or null if none does */
  bRequired: number | null;
  floored: boolean;
}

interface StressView {
  path: "stress";
  U: UnitsView;
  label: string;
  sigma: number;
  limit: number;
  discontinue: number;
  required: boolean;
}

/** The combination with the largest Ve — the one Eq. (18.10.6.2b) is hardest on. */
function governingDemand(input: WallInput): { demand: Demands; Ve: number } | null {
  let best: { demand: Demands; Ve: number } | null = null;
  for (const demand of input.demands) {
    try {
      const ve = amplifiedShear(input, demand).Ve.value;
      if (best === null || ve > best.Ve) best = { demand, Ve: ve };
    } catch {
      // no neutral axis at this P_u — the flexure check says so properly
    }
  }
  return best;
}

/**
 * Everything below the engine boundary comes back in the wall's *reporting*
 * system already — `sbeRequirement().c` in mm, `amplifiedShear().Ve` in kN,
 * `Acv` in mm² — while `input.geometry` and `input.sbe` are canonical inches.
 * Eq. (18.10.6.2b) is only dimensionless if every argument agrees, so the
 * geometry is moved into the reporting system on the way in and `si` selects
 * the metric form of the shear term. The width the panel sweeps and marks is
 * therefore a *display* width throughout.
 */
function build(input: WallInput): DriftView | StressView | null {
  const U = viewOf(input);
  const governing = governingDemand(input);
  if (governing === null) return null;

  let req;
  try {
    req = sbeRequirement(input, governing.demand);
  } catch {
    return null;
  }
  const label = governing.demand.label ?? governing.demand.id;

  if (req.method === "stress") {
    // 0.2f'c and 0.15f'c are dimensionless coefficients on f'c, so the limits
    // are read in whichever stress unit the edition prints — psi or MPa.
    const fc = U.stress(input.concrete.fc);
    return {
      path: "stress",
      U,
      label,
      sigma: req.sigma?.value ?? Number.NaN,
      limit: 0.2 * fc,
      discontinue: 0.15 * fc,
      required: req.required,
    };
  }

  const demand15 = req.driftDemand15?.value ?? 0;
  const lw = U.len(input.geometry.lw);
  const h = U.len(input.geometry.h);
  const args = {
    lw,
    c: req.c,
    Ve: governing.Ve,
    sqrtFc: U.scheme.sqrtFc(input.concrete.fc),
    Acv: Acv(input).value,
    si: U.si,
  };
  const rawAt = (b: number) => driftCapacityRatio({ ...args, b });
  const capacityAt = (b: number) => Math.max(rawAt(b), DRIFT_CAPACITY_FLOOR);

  const bProvided = input.sbe === undefined ? undefined : U.len(input.sbe.width);
  const sqrtReq = Math.sqrt(0.025 * req.c * lw);
  // The 4 in. pad on each end of the sweep is a plotting margin, not a code
  // minimum — it stays 4 in. of wall in either edition.
  const pad = U.len(4);
  const bMin = Math.max(pad, Math.min(h, bProvided ?? h));
  const bMax = Math.max(bProvided ?? 0, sqrtReq, h, bMin + pad) * 1.5;

  let bRequired: number | null = null;
  for (let i = 0; i <= SWEEP_POINTS; i++) {
    const b = bMin + ((bMax - bMin) * i) / SWEEP_POINTS;
    if (capacityAt(b) >= demand15) {
      bRequired = b;
      break;
    }
  }

  return {
    path: "displacement",
    U,
    label,
    c: req.c,
    Ve: governing.Ve,
    demand15,
    sqrtReq,
    bProvided,
    capacityAt,
    rawAt,
    bMin,
    bMax,
    bRequired,
    floored: bProvided !== undefined && rawAt(bProvided) < DRIFT_CAPACITY_FLOOR,
  };
}

/** `memo` for the same reason as <InteractionChart>: the caller feeds it a
 * deferred wall, and the 60-point capacity sweep is only worth running once the
 * number being typed has settled. */
export const DriftPanel = memo(function DriftPanel({ input }: { input: WallInput }) {
  const view = useMemo(() => (input.system === "special" ? build(input) : null), [input]);
  const [focus, setFocus] = useState<XyFocus<DriftMeta> | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);

  const chart = useMemo(() => {
    if (view === null || view.path !== "displacement") return null;
    const capacity: { x: number; y: number; meta: DriftMeta }[] = [];
    const computed: { x: number; y: number; meta: DriftMeta }[] = [];
    for (let i = 0; i <= SWEEP_POINTS; i++) {
      const b = view.bMin + ((view.bMax - view.bMin) * i) / SWEEP_POINTS;
      capacity.push({ x: b, y: view.capacityAt(b), meta: { kind: "capacity" } });
      computed.push({ x: b, y: view.rawAt(b), meta: { kind: "computed" } });
    }

    const series: XySeries<DriftMeta>[] = [
      {
        id: "computed",
        label: "computed, before the 0.015 floor",
        token: "muted",
        dashed: true,
        width: 1.25,
        opacity: 0.6,
        points: computed,
      },
      {
        id: "capacity",
        label: "δc/hwcs",
        token: "line",
        width: 2,
        points: capacity,
      },
      {
        id: "demand",
        label: "1.5δu/hwcs",
        token: "muted",
        dashed: true,
        width: 1.75,
        points: [
          { x: view.bMin, y: view.demand15, meta: { kind: "demand" } },
          { x: view.bMax, y: view.demand15, meta: { kind: "demand" } },
        ],
      },
    ];

    const markers: XyMarker<DriftMeta>[] = [];
    if (view.bProvided !== undefined) {
      const y = view.capacityAt(view.bProvided);
      markers.push({
        id: "provided",
        label: `b provided = ${fmt(view.bProvided, { dp: 1 })} ${view.U.lengthUnit}`,
        x: view.bProvided,
        y,
        token: (y >= view.demand15 ? "ok" : "ng") satisfies ChartToken,
        meta: { kind: "provided" },
      });
    }

    return { series, markers };
  }, [view]);

  if (view === null) return null;

  const code = view.U.si ? "ACI 318M-19" : "ACI 318-19";

  if (view.path === "stress") {
    return (
      <Panel subtitle={`${code} §18.10.6.3 — stress-based path`}>
        <p className="sr-only">
          Stress-based boundary element check for load case {view.label}: the extreme-fiber
          compressive stress is {num(view.sigma)} {view.U.stressUnit} against a limit of{" "}
          {num(view.limit)} {view.U.stressUnit} (0.2f&apos;c), so special boundary elements are{" "}
          {view.required ? "required" : "not required"}.
        </p>
        <p className="font-mono text-xs2 leading-5 text-muted-foreground">
          hwcs/ℓw &lt; 2.0, so the boundary element is judged by the extreme-fiber stress and Eq.
          (18.10.6.2b) does not apply — there is no width to trade against drift.
        </p>
        <div className="flex flex-col gap-1 font-mono text-xs2">
          <Readout label="σ" value={`${num(view.sigma)} ${view.U.stressUnit}`} scope={view.label} />
          <Readout label="0.2f'c" value={`${num(view.limit)} ${view.U.stressUnit}`} />
          <Readout
            label="0.15f'c — may discontinue below"
            value={`${num(view.discontinue)} ${view.U.stressUnit}`}
          />
        </div>
        {/* Neither branch is a failure: §18.10.6.3 either sends the wall to
            special boundary elements or to 18.10.6.5, and both are valid
            outcomes. Colouring "required" as ng said the wall was in trouble. */}
        <p className="font-mono text-xs2 text-muted-foreground">
          {view.required
            ? "σ > 0.2f'c — special boundary elements required"
            : "σ ≤ 0.2f'c — 18.10.6.5 applies instead"}
        </p>
      </Panel>
    );
  }

  const provided = view.bProvided;
  const capacity = provided === undefined ? undefined : view.capacityAt(provided);
  const passes = capacity !== undefined && capacity >= view.demand15;
  /** spelled out for the screen-reader summary, abbreviated in the readouts */
  const units = view.U.si ? "millimetres" : "inches";

  return (
    <Panel
      subtitle={`${code} §18.10.6.2(b) — width against drift`}
      actions={<ChartExportButtons containerRef={plotRef} filename="drift-capacity" />}
    >
      {/* The chart is one picture behind `role="img"`; these are the two
          numbers it exists to compare, plus the answer they give. */}
      <p className="sr-only">
        Drift capacity swept over the boundary element width for load case {view.label}.{" "}
        {capacity === undefined
          ? "No boundary element is provided, so there is no capacity to compare."
          : `At the provided width of ${num(provided, 1)} ${units} the capacity ratio δc/hwcs is ${capacity.toFixed(5)}${
              view.floored ? " (the 0.015 floor)" : ""
            }, against a required 1.5δu/hwcs of ${view.demand15.toFixed(5)} — ${
              passes ? "the provided width passes" : "the provided width fails"
            }.`}{" "}
        {view.bRequired === null
          ? `No swept width up to ${num(view.bMax, 1)} ${units} satisfies option (iii).`
          : `Option (iii) is satisfied from ${num(view.bRequired, 1)} ${units} of width.`}
      </p>

      {chart === null ? null : (
        <div ref={plotRef}>
        <XyChart<DriftMeta>
          ariaLabel="drift capacity against boundary element width"
          ariaDescription="Drift capacity from Eq. (18.10.6.2b) swept over the boundary element width, with the amplified design drift demand as a horizontal line and the provided width marked."
          series={chart.series}
          markers={chart.markers}
          height={260}
          x={X_AXES[view.U.system]}
          y={Y_AXIS}
          onFocusChange={setFocus}
        />
        </div>
      )}

      <p aria-live="polite" className="min-h-8 font-mono text-xs2 leading-4 text-muted-foreground">
        {focus === null ? (
          <>
            c = {num(view.c, 2)} {view.U.lengthUnit} · V<sub>e</sub> = {num(view.Ve)}{" "}
            {view.U.forceUnit} · {view.label}
            <br />
            hover the curve to read a width, or take the crossing
          </>
        ) : (
          <>
            b = {num(focus.x, 1)} {view.U.lengthUnit} · {focus.label} = {focus.y.toFixed(5)}
            <br />
            {focus.meta?.kind === "computed"
              ? "the raw equation — the code lets you take 0.015 whatever it says"
              : "against a demand of " + view.demand15.toFixed(5)}
          </>
        )}
      </p>

      <div className="flex flex-col gap-1 border-t border-border pt-2 font-mono text-xs2">
        <Readout
          label="δc/hwcs at the provided b"
          value={
            capacity === undefined
              ? "no boundary element"
              : `${capacity.toFixed(5)}${view.floored ? " (0.015 floor)" : ""}`
          }
          tone={capacity === undefined ? undefined : passes ? "ok" : "ng"}
        />
        <Readout label="1.5δu/hwcs required" value={view.demand15.toFixed(5)} />
        <Readout
          label="b to satisfy option (iii)"
          value={
            view.bRequired === null
              ? `> ${num(view.bMax, 1)} ${view.U.lengthUnit} — no swept width works`
              : `${num(view.bRequired, 1)} ${view.U.lengthUnit}`
          }
        />
        <Readout
          label="option (ii) √(0.025cℓw)"
          value={`${num(view.sqrtReq, 1)} ${view.U.lengthUnit}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground">
        {/* Three series, three swatches. One dashed swatch used to stand for
            two different dashed lines — the raw equation and the drift demand
            — so the legend could not tell you which line you were reading.
            Each swatch now draws at the width and opacity its series does. */}
        <Swatch width={2}>δc/hwcs used</Swatch>
        <Swatch dashed width={1.25} opacity={0.6}>
          computed, before the floor
        </Swatch>
        <Swatch dashed width={1.75}>
          1.5δu/hwcs demand
        </Swatch>
        {provided === undefined ? null : (
          <span className="flex items-center gap-1.5">
            {/* Same vocabulary as the marker on the plot: filled neutral when
                the provided width works, a hollow ng ring when it does not. */}
            <span
              className={cn(
                "rounded-full",
                passes
                  ? "size-2 bg-foreground"
                  : "size-2.5 border-2 border-status-ng bg-transparent",
              )}
            />
            b provided
          </span>
        )}
      </div>
    </Panel>
  );
});

function Panel({
  subtitle,
  actions,
  children,
}: {
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle
            render={<h2 />}
            className="font-mono text-xs font-medium tracking-tight text-muted-foreground"
          >
            drift capacity
          </CardTitle>
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-xs2 text-muted-foreground">{subtitle}</span>
            {actions}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
  );
}

function Readout({
  label,
  value,
  scope,
  tone,
}: {
  label: string;
  value: string;
  scope?: string;
  tone?: "ok" | "ng";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="truncate text-muted-foreground">
        {label}
        {scope === undefined ? null : <span className="ml-1.5 text-2xs">{scope}</span>}
      </span>
      <span className={cn("shrink-0 tabular-nums", tone === undefined ? "" : statusText(tone))}>
        {value}
      </span>
    </div>
  );
}

/** A legend key drawn with the exact stroke of the series it stands for. */
function Swatch({
  dashed,
  width,
  opacity,
  children,
}: {
  dashed?: boolean;
  width: number;
  opacity?: number;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden="true" className="shrink-0">
        <line
          x1="0"
          y1="3"
          x2="18"
          y2="3"
          stroke="currentColor"
          strokeWidth={width}
          strokeOpacity={opacity}
          strokeDasharray={dashed === true ? "4 3" : undefined}
          className={dashed === true ? "text-muted-foreground" : "text-foreground"}
        />
      </svg>
      {children}
    </span>
  );
}
