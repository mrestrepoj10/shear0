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
  ksiToPsi,
  sbeRequirement,
  sqrtFcPsi,
  type Demands,
  type WallInput,
} from "@kern/engine";
import { memo, useMemo, useState, type ReactNode } from "react";
import {
  XyChart,
  type ChartToken,
  type XyFocus,
  type XyMarker,
  type XySeries,
} from "@/components/charts/xy-chart";
import { num, statusText } from "@/components/design/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const SWEEP_POINTS = 160;
/** 18.10.6.2(b)(iii): δc/hwcs need not be taken below this. */
const DRIFT_CAPACITY_FLOOR = 0.015;

const X_AXIS = {
  label: "b  (in)  — boundary element width",
  format: (value: number) => fmt(value, { dp: 0 }),
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

function build(input: WallInput): DriftView | StressView | null {
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
    const fcPsi = ksiToPsi(input.concrete.fc);
    return {
      path: "stress",
      label,
      sigma: req.sigma?.value ?? Number.NaN,
      limit: 0.2 * fcPsi,
      discontinue: 0.15 * fcPsi,
      required: req.required,
    };
  }

  const demand15 = req.driftDemand15?.value ?? 0;
  const args = {
    lw: input.geometry.lw,
    c: req.c,
    Ve: governing.Ve,
    sqrtFc: sqrtFcPsi(input.concrete.fc),
    Acv: Acv(input).value,
  };
  const rawAt = (b: number) => driftCapacityRatio({ ...args, b });
  const capacityAt = (b: number) => Math.max(rawAt(b), DRIFT_CAPACITY_FLOOR);

  const bProvided = input.sbe?.width;
  const sqrtReq = Math.sqrt(0.025 * req.c * input.geometry.lw);
  const bMin = Math.max(4, Math.min(input.geometry.h, bProvided ?? input.geometry.h));
  const bMax = Math.max(bProvided ?? 0, sqrtReq, input.geometry.h, bMin + 4) * 1.5;

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
        label: `b provided = ${fmt(view.bProvided, { dp: 1 })} in`,
        x: view.bProvided,
        y,
        token: (y >= view.demand15 ? "ok" : "ng") satisfies ChartToken,
        meta: { kind: "provided" },
      });
    }

    return { series, markers };
  }, [view]);

  if (view === null) return null;

  if (view.path === "stress") {
    const status = view.required ? "ng" : "ok";
    return (
      <Panel subtitle="ACI 318-19 §18.10.6.3 — stress-based path">
        <p className="sr-only">
          Stress-based boundary element check for load case {view.label}: the extreme-fiber
          compressive stress is {num(view.sigma)} psi against a limit of {num(view.limit)} psi
          (0.2f&apos;c), so special boundary elements are{" "}
          {view.required ? "required" : "not required"}.
        </p>
        <p className="font-mono text-[11px] leading-5 text-muted-foreground">
          hwcs/ℓw &lt; 2.0, so the boundary element is judged by the extreme-fiber stress and Eq.
          (18.10.6.2b) does not apply — there is no width to trade against drift.
        </p>
        <div className="flex flex-col gap-1 font-mono text-[11px]">
          <Readout label="σ" value={`${num(view.sigma)} psi`} scope={view.label} />
          <Readout label="0.2f'c" value={`${num(view.limit)} psi`} />
          <Readout label="0.15f'c — may discontinue below" value={`${num(view.discontinue)} psi`} />
        </div>
        <p className={cn("font-mono text-[11px]", statusText(status))}>
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

  return (
    <Panel subtitle="ACI 318-19 §18.10.6.2(b) — width against drift">
      {/* The chart is one picture behind `role="img"`; these are the two
          numbers it exists to compare, plus the answer they give. */}
      <p className="sr-only">
        Drift capacity swept over the boundary element width for load case {view.label}.{" "}
        {capacity === undefined
          ? "No boundary element is provided, so there is no capacity to compare."
          : `At the provided width of ${num(provided, 1)} inches the capacity ratio δc/hwcs is ${capacity.toFixed(5)}${
              view.floored ? " (the 0.015 floor)" : ""
            }, against a required 1.5δu/hwcs of ${view.demand15.toFixed(5)} — ${
              passes ? "the provided width passes" : "the provided width fails"
            }.`}{" "}
        {view.bRequired === null
          ? `No swept width up to ${num(view.bMax, 1)} inches satisfies option (iii).`
          : `Option (iii) is satisfied from ${num(view.bRequired, 1)} inches of width.`}
      </p>

      {chart === null ? null : (
        <XyChart<DriftMeta>
          ariaLabel="drift capacity against boundary element width"
          ariaDescription="Drift capacity from Eq. (18.10.6.2b) swept over the boundary element width, with the amplified design drift demand as a horizontal line and the provided width marked."
          series={chart.series}
          markers={chart.markers}
          height={260}
          x={X_AXIS}
          y={Y_AXIS}
          onFocusChange={setFocus}
        />
      )}

      <p aria-live="polite" className="min-h-8 font-mono text-[11px] leading-4 text-muted-foreground">
        {focus === null ? (
          <>
            c = {num(view.c, 2)} in · V<sub>e</sub> = {num(view.Ve)} kip · {view.label}
            <br />
            hover the curve to read a width, or take the crossing
          </>
        ) : (
          <>
            b = {num(focus.x, 1)} in · {focus.label} = {focus.y.toFixed(5)}
            <br />
            {focus.meta?.kind === "computed"
              ? "the raw equation — the code lets you take 0.015 whatever it says"
              : "against a demand of " + view.demand15.toFixed(5)}
          </>
        )}
      </p>

      <div className="flex flex-col gap-1 border-t border-border pt-2 font-mono text-[11px]">
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
              ? `> ${num(view.bMax, 1)} in — no swept width works`
              : `${num(view.bRequired, 1)} in`
          }
        />
        <Readout label="option (ii) √(0.025cℓw)" value={`${num(view.sqrtReq, 1)} in`} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <Swatch>δc/hwcs used</Swatch>
        <Swatch dashed>computed · 1.5δu/hwcs demand</Swatch>
        {provided === undefined ? null : (
          <span className="flex items-center gap-1.5">
            <span
              className={cn("size-2 rounded-full", passes ? "bg-status-ok" : "bg-status-ng")}
            />
            b provided
          </span>
        )}
      </div>
    </Panel>
  );
});

function Panel({ subtitle, children }: { subtitle: string; children: ReactNode }) {
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
          <span className="truncate font-mono text-[11px] text-muted-foreground">{subtitle}</span>
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
        {scope === undefined ? null : <span className="ml-1.5 text-[10px]">{scope}</span>}
      </span>
      <span className={cn("shrink-0 tabular-nums", tone === undefined ? "" : statusText(tone))}>
        {value}
      </span>
    </div>
  );
}

function Swatch({ dashed, children }: { dashed?: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden="true">
        <line
          x1="0"
          y1="3"
          x2="18"
          y2="3"
          stroke="currentColor"
          strokeWidth={dashed === true ? 1.5 : 2}
          strokeDasharray={dashed === true ? "4 3" : undefined}
          className={dashed === true ? "text-muted-foreground" : "text-foreground"}
        />
      </svg>
      {children}
    </span>
  );
}
