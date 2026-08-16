"use client";

/**
 * The P–M interaction diagram: the nominal surface, the design surface with its
 * 22.4.2.1 flat cap, and the factored demand pairs plotted on top.
 *
 * Only the M ≥ 0 half is drawn. `barPositions` lays the steel out symmetrically
 * about ℓ_w/2, so the ±M halves of the surface are mirror images and the engine
 * checks |M_u| — the mirrored half would carry no extra information.
 */

import {
  axialLimits,
  designCurve,
  fmt,
  interactionCurve,
  type CheckStatus,
  type WallReport,
  type WallInput,
} from "@shear0/engine";
import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import {
  XyChart,
  type ChartToken,
  type XyArea,
  type XyFocus,
  type XyMarker,
  type XyRule,
  type XySeries,
} from "@/components/charts/xy-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartExportButtons } from "@/components/design/chart-export";
import { num, statusText } from "@/components/design/status";
import { useSetSelection } from "@/lib/wall-state";
import { cn } from "@/lib/utils";

const CURVE_POINTS = 120;

/**
 * Module constants, not inline literals: the chart wrapper memoizes its
 * definition against these props, and a fresh object every render would rebuild
 * the whole scene on every hover.
 */
const X_AXIS = {
  label: "M  (kip-ft)",
  format: (value: number) => fmt(value, { dp: 0 }),
  include: [0],
} as const;

const Y_AXIS = {
  label: "P  (kip)  — compression positive",
  format: (value: number) => fmt(value, { dp: 0 }),
  include: [0],
} as const;

interface CurveMeta {
  kind: "design" | "nominal";
  c: number;
  phi: number;
  epsT: number;
  capped: boolean;
}

interface MarkerMeta {
  kind: "demand";
  status: CheckStatus;
  utilization: number | undefined;
  phiMn: number | undefined;
  Vu: number;
}

type PmMeta = CurveMeta | MarkerMeta;

/**
 * The inside of the design surface as a shaded band: for each sampled M, the
 * vertical span between the lower (tension-side) and upper (compression-side)
 * branches of the curve. The curve runs top-to-bottom — compression cap first,
 * moment bulge in the middle, pure tension last — so it splits at max φMn into
 * two x-monotone branches that each interpolate cleanly.
 */
function surfaceBand(points: readonly { x: number; y: number }[]): XyArea["points"] {
  if (points.length < 3) return [];
  let apex = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const best = points[apex];
    if (p !== undefined && best !== undefined && p.x > best.x) apex = i;
  }
  const upper = points.slice(0, apex + 1);
  const lower = points.slice(apex);
  const xMax = points[apex]?.x ?? 0;
  if (xMax <= 0) return [];

  const at = (branch: readonly { x: number; y: number }[], x: number): number | undefined => {
    for (let i = 0; i < branch.length - 1; i++) {
      const a = branch[i];
      const b = branch[i + 1];
      if (a === undefined || b === undefined) continue;
      const lo = Math.min(a.x, b.x);
      const hi = Math.max(a.x, b.x);
      if (x < lo || x > hi) continue;
      const t = hi === lo ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
    return undefined;
  };

  const SAMPLES = 80;
  const band: { x: number; y1: number; y2: number }[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const x = (xMax * i) / SAMPLES;
    const a = at(upper, x);
    const b = at(lower, x);
    // Which branch is on top depends on the curve's direction of travel —
    // order by value, not by position in the array.
    if (a !== undefined && b !== undefined) {
      band.push({ x, y1: Math.min(a, b), y2: Math.max(a, b) });
    }
  }
  return band;
}

/** The interaction check for a load case, which decides the marker's color. */
function flexureCheck(report: WallReport, demandId: string) {
  const group = report.perDemand.find((g) => g.demand.id === demandId);
  return group?.checks.find((check) => check.id === "flexure.axial");
}

function tokenFor(status: CheckStatus | undefined): ChartToken {
  if (status === "ok") return "ok";
  if (status === "ng") return "ng";
  return "line";
}

/**
 * `memo` so the deferred wall the workspace passes in actually saves work: 240
 * fiber solves and a chart scene rebuild are skipped while the props still point
 * at the wall of the previous keystroke.
 */
export const InteractionChart = memo(function InteractionChart({
  input,
  report,
}: {
  input: WallInput;
  report: WallReport;
}) {
  const [focus, setFocus] = useState<XyFocus<PmMeta> | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  // No-op outside a WallProvider, so /learn can still mount this chart.
  const setSelection = useSetSelection();

  const { series, markers, cap, rules, areas } = useMemo(() => {
    const design = designCurve(input, { points: CURVE_POINTS });
    const nominal = interactionCurve(input, { points: CURVE_POINTS });
    const limits = axialLimits(input);

    const series: XySeries<PmMeta>[] = [
      {
        id: "nominal",
        label: "nominal Pn–Mn",
        token: "muted",
        dashed: true,
        width: 1.25,
        points: nominal.map((p) => ({
          x: p.Mn,
          y: p.Pn,
          meta: { kind: "nominal", c: p.c, phi: p.phi, epsT: p.epsT, capped: false } as CurveMeta,
        })),
      },
      {
        id: "design",
        label: "design φPn–φMn",
        token: "line",
        width: 2,
        points: design.map((p) => ({
          x: p.phiMn,
          y: p.phiPn,
          meta: {
            kind: "design",
            c: p.c,
            phi: p.phi,
            epsT: p.epsT,
            capped: p.capped,
          } as CurveMeta,
        })),
      },
    ];

    const markers: XyMarker<PmMeta>[] = input.demands.map((demand) => {
      const check = flexureCheck(report, demand.id);
      return {
        id: demand.id,
        label: demand.label ?? demand.id,
        x: Math.abs(demand.Mu),
        y: demand.Pu,
        token: tokenFor(check?.status),
        meta: {
          kind: "demand",
          status: check?.status ?? "na",
          utilization: check?.utilization?.value,
          phiMn: check?.capacity?.value,
          Vu: demand.Vu,
        } as MarkerMeta,
      };
    });

    const cap = 0.65 * limits.PnMax;
    const designXy = design.map((p) => ({ x: p.phiMn, y: p.phiPn }));

    // The flat top of the design curve, 22.4.2.1 with the compression-controlled
    // φ — drawn as its own dashed rule so the cap reads as a *limit*, not just
    // a kink in the curve.
    const rules: XyRule[] = [{ axis: "y", value: cap, token: "muted", dashed: true, opacity: 0.4 }];

    // The safe region, shaded: a demand point is acceptable exactly when it
    // lands inside this band. Low opacity — context, not content.
    const areas: XyArea[] = [{ id: "design-surface", points: surfaceBand(designXy), token: "line" }];

    return { series, markers, cap, rules, areas };
  }, [input, report]);

  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle
            render={<h2 />}
            className="font-mono text-xs font-medium tracking-tight text-muted-foreground"
          >
            P–M interaction
          </CardTitle>
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-xs2 text-muted-foreground">
              ACI 318-19 §22.2 / §22.4
            </span>
            <ChartExportButtons containerRef={plotRef} filename="pm-interaction" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div ref={plotRef}>
        <XyChart<PmMeta>
          ariaLabel="P–M interaction diagram"
          ariaDescription="Nominal and design axial–moment interaction surfaces with the factored demand points. The shaded region is the safe side of the design surface."
          series={series}
          markers={markers}
          rules={rules}
          areas={areas}
          height={320}
          x={X_AXIS}
          y={Y_AXIS}
          tooltip={pmTooltip}
          onFocusChange={(next) => {
            setFocus(next);
            // Publish the traced slice: while the pointer follows either curve,
            // the strain-profile drawing redraws the section at that c. Demand
            // markers and empty space clear it back to the governing slice.
            const meta = next?.meta;
            // The analytic pure-tension endpoint has c = 0 — there is no
            // neutral axis to draw, so it clears the trace instead of
            // publishing a slice the drawing would have to reject.
            setSelection(
              meta !== undefined && meta.kind !== "demand" && meta.c > 0
                ? { kind: "pm-slice", c: meta.c }
                : null,
            );
          }}
        />
        </div>

        <ChartSummary cap={cap} markers={markers} />

        <Readout focus={focus} cap={cap} markers={markers} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground">
          <Swatch dashed>nominal</Swatch>
          <Swatch>design (φ applied)</Swatch>
          {markers.some((m) => m.token === "ok") ? <Dot token="ok">demand inside</Dot> : null}
          {markers.some((m) => m.token === "ng") ? <Dot token="ng">demand outside</Dot> : null}
          <span>M ≥ 0 half — section symmetric about M = 0</span>
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * The picture, in words and numbers.
 *
 * `role="img"` on the plot is correct — it *is* one picture — but it also
 * flattens the subtree, so every point behind it is unreachable. This is the
 * same data the curve encodes, written out: the flat top, then a row per
 * demand with the capacity the engine found at that P_u and whether the point
 * landed inside the surface.
 */
function ChartSummary({
  cap,
  markers,
}: {
  cap: number;
  markers: readonly XyMarker<PmMeta>[];
}) {
  const demands = markers.filter((m) => m.meta?.kind === "demand");

  return (
    <div className="sr-only">
      <p>
        Design interaction surface with the axial compression capped at {num(cap)} kip per ACI
        318-19 §22.4.2.1.{" "}
        {demands.length === 0
          ? "No load cases are applied, so no demand points are plotted."
          : `${demands.length} factored demand point${demands.length === 1 ? "" : "s"} plotted against it.`}
      </p>
      {demands.length === 0 ? null : (
        <table>
          <caption>Factored demands against the design interaction surface</caption>
          <thead>
            <tr>
              <th scope="col">load case</th>
              <th scope="col">Pu (kip)</th>
              <th scope="col">Mu (kip-ft)</th>
              <th scope="col">φMn at that Pu (kip-ft)</th>
              <th scope="col">Mu / φMn</th>
              <th scope="col">result</th>
            </tr>
          </thead>
          <tbody>
            {demands.map((marker) => {
              const meta = marker.meta as MarkerMeta;
              return (
                <tr key={marker.id}>
                  <th scope="row">{marker.label}</th>
                  <td>{num(marker.y)}</td>
                  <td>{num(marker.x)}</td>
                  <td>{num(meta.phiMn)}</td>
                  <td>{num(meta.utilization, 3)}</td>
                  <td>
                    {meta.status === "ok"
                      ? "inside the surface"
                      : meta.status === "ng"
                        ? "outside the surface"
                        : "not evaluated"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
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
          strokeWidth={dashed === true ? 1.25 : 2}
          strokeDasharray={dashed === true ? "4 3" : undefined}
          className={dashed === true ? "text-muted-foreground" : "text-foreground"}
        />
      </svg>
      {children}
    </span>
  );
}

/** Mirrors the plotted markers: pass is a filled neutral dot, ng a hollow ring. */
function Dot({ token, children }: { token: "ok" | "ng"; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          "rounded-full",
          token === "ok"
            ? "size-2 bg-foreground"
            : "size-2.5 border-2 border-status-ng bg-transparent",
        )}
      />
      {children}
    </span>
  );
}

/**
 * The cursor-anchored version of the readout below: same numbers, at the
 * point. Plain text with newlines — the chart tooltip renders pre-line.
 */
function pmTooltip(focus: XyFocus<PmMeta>): string {
  const meta = focus.meta;
  if (meta === undefined) return focus.label;
  if (meta.kind === "demand") {
    return [
      focus.label,
      `Mu ${num(focus.x)} kip-ft · Pu ${num(focus.y)} kip`,
      `Mu/φMn ${num(meta.utilization, 3)} — ${meta.status === "ok" ? "inside" : meta.status === "ng" ? "outside" : "n/a"}`,
    ].join("\n");
  }
  const design = meta.kind === "design";
  return [
    design ? "design surface" : "nominal surface",
    `${design ? "φM" : "M"}n ${num(focus.x)} kip-ft · ${design ? "φP" : "P"}n ${num(focus.y)} kip${meta.capped ? " (cap)" : ""}`,
    `c ${num(meta.c)} in · φ ${num(meta.phi, 3)} · εt ${Number.isFinite(meta.epsT) ? num(meta.epsT, 5) : "∞"}`,
  ].join("\n");
}

/**
 * Fixed-height readout so hovering never reflows the page. With no focus it
 * states the axial cap — the one number the flat top of the curve encodes.
 */
function Readout({
  focus,
  cap,
  markers,
}: {
  focus: XyFocus<PmMeta> | null;
  cap: number;
  markers: readonly XyMarker<PmMeta>[];
}) {
  const meta = focus?.meta;

  if (focus === null || meta === undefined) {
    return (
      <p aria-live="polite" className="min-h-8 font-mono text-xs2 leading-4 text-muted-foreground">
        φP<sub>n</sub> capped at 0.65 × 0.80 P<sub>o</sub> = {num(cap)} kip (22.4.2.1) — the flat
        top.
        <br />
        {markers.length === 0 ? "no load cases" : "hover or focus the chart to read a point"}
      </p>
    );
  }

  if (meta.kind === "demand") {
    return (
      <p aria-live="polite" className="min-h-8 font-mono text-xs2 leading-4">
        <span className={statusText(meta.status)}>{focus.label}</span>{" "}
        <span className="text-muted-foreground">
          M<sub>u</sub> = {num(focus.x)} kip-ft · P<sub>u</sub> = {num(focus.y)} kip · V
          <sub>u</sub> = {num(meta.Vu)} kip
        </span>
        <br />
        <span className="text-muted-foreground">
          φM<sub>n</sub> = {num(meta.phiMn)} kip-ft · M<sub>u</sub>/φM<sub>n</sub> ={" "}
        </span>
        <span className={statusText(meta.status)}>{num(meta.utilization, 3)}</span>
      </p>
    );
  }

  const design = meta.kind === "design";
  return (
    <p aria-live="polite" className="min-h-8 font-mono text-xs2 leading-4 text-muted-foreground">
      {design ? "design" : "nominal"} — {design ? "φM" : "M"}
      <sub>n</sub> = {num(focus.x)} kip-ft · {design ? "φP" : "P"}
      <sub>n</sub> = {num(focus.y)} kip{meta.capped ? " (at the axial cap)" : ""}
      <br />c = {num(meta.c)} in · φ = {num(meta.phi, 3)} · ε<sub>t</sub> ={" "}
      {Number.isFinite(meta.epsT) ? num(meta.epsT, 5) : "∞ (pure tension)"}
    </p>
  );
}
