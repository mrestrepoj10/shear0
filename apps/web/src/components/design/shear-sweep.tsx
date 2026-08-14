"use client";

/**
 * Shear capacity as a function of horizontal bar spacing — the drift panel's
 * idea applied to the reinforcement the designer is actually iterating on.
 *
 * MNL-17 sizes horizontal steel by guessing a spacing, running the φVn check,
 * and guessing again. This panel runs the guess loop for the whole practical
 * range at once: sweep s, re-run the engine's own in-plane shear check at each
 * step, and draw φVn(s) against the governing Vu (Ve for special walls). Where
 * the curve crosses the demand line is the widest spacing the wall can carry;
 * the shaded band above the demand line is the headroom. Nothing here
 * re-derives the code — every point *is* `checkInPlaneShear`/`checkSpecialShear`
 * on a wall whose spacing is the swept value.
 */

import {
  checkInPlaneShear,
  checkSpecialShear,
  fmt,
  type CheckResult,
  type Demands,
  type WallInput,
  type WallReport,
} from "@kern/engine";
import { memo, useMemo, useRef, useState } from "react";
import {
  XyChart,
  type XyArea,
  type XyFocus,
  type XyMarker,
  type XyRule,
  type XySeries,
} from "@/components/charts/xy-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartExportButtons } from "@/components/design/chart-export";
import { num, statusText } from "@/components/design/status";
import { cn } from "@/lib/utils";

const SWEEP_POINTS = 36;
const S_MIN = 3;
/** §11.7.3.1 / §18.10.2.1 cap horizontal spacing at 18 in — sweep to the code ceiling. */
const S_MAX = 18;

const X_AXIS = {
  label: "s  (in)  — horizontal bar spacing",
  format: (value: number) => fmt(value, { dp: 0 }),
} as const;

const Y_AXIS = {
  label: "V  (kip)",
  format: (value: number) => fmt(value, { dp: 0 }),
  include: [0],
} as const;

interface SweepMeta {
  kind: "capacity" | "provided";
  s: number;
  phiVn: number;
}

/** The load case with the highest in-plane shear utilization. */
function governingShear(
  report: WallReport,
): { demand: Demands; check: CheckResult } | null {
  let best: { demand: Demands; check: CheckResult; u: number } | null = null;
  for (const group of report.perDemand) {
    const check = group.checks.find(
      (c) => c.id === "shear.in-plane" || c.id === "sw.in-plane-shear",
    );
    if (check === undefined) continue;
    const u = check.utilization?.value;
    const ranked = typeof u === "number" && Number.isFinite(u) ? u : -1;
    if (best === null || ranked > best.u) best = { demand: group.demand, check, u: ranked };
  }
  return best;
}

export const ShearSweep = memo(function ShearSweep({
  input,
  report,
}: {
  input: WallInput;
  report: WallReport;
}) {
  const [focus, setFocus] = useState<XyFocus<SweepMeta> | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);

  const view = useMemo(() => {
    const governing = governingShear(report);
    if (governing === null) return null;
    const special = input.system === "special";
    const check = special ? checkSpecialShear : checkInPlaneShear;
    // The check's demand node keeps the signed V_u for the trace; utilization
    // compares |V_u|, and so does this chart — a negative shear input must not
    // drop the demand rule below zero and declare every spacing adequate.
    const VuRaw = governing.check.demand?.value;
    if (typeof VuRaw !== "number" || !Number.isFinite(VuRaw)) return null;
    const Vu = Math.abs(VuRaw);

    // The engine memoizes per WallInput object, so each swept spacing gets its
    // own input clone and the sweep never pollutes the live wall's caches.
    const capacityAt = (s: number): number | undefined => {
      try {
        const swept: WallInput = { ...input, horizontal: { ...input.horizontal, spacing: s } };
        const result = check(swept, governing.demand);
        const phiVn = result.capacity?.value;
        return typeof phiVn === "number" && Number.isFinite(phiVn) ? phiVn : undefined;
      } catch {
        return undefined;
      }
    };

    const curve: { s: number; phiVn: number }[] = [];
    for (let i = 0; i <= SWEEP_POINTS; i++) {
      const s = S_MIN + ((S_MAX - S_MIN) * i) / SWEEP_POINTS;
      const phiVn = capacityAt(s);
      if (phiVn !== undefined) curve.push({ s, phiVn });
    }
    if (curve.length < 2) return null;

    // Widest swept spacing that still carries Vu (the curve is monotone
    // decreasing in s, so scan from the wide end).
    let sMax: number | null = null;
    for (let i = curve.length - 1; i >= 0; i--) {
      const point = curve[i];
      if (point !== undefined && point.phiVn >= Vu) {
        sMax = point.s;
        break;
      }
    }

    const provided = input.horizontal.spacing;
    const providedPhiVn = governing.check.capacity?.value;

    const series: XySeries<SweepMeta>[] = [
      {
        id: "phiVn",
        label: "φVn(s)",
        token: "line",
        width: 2,
        points: curve.map((p) => ({
          x: p.s,
          y: p.phiVn,
          meta: { kind: "capacity", s: p.s, phiVn: p.phiVn } as SweepMeta,
        })),
      },
    ];

    const markers: XyMarker<SweepMeta>[] =
      typeof providedPhiVn === "number" &&
      Number.isFinite(providedPhiVn) &&
      provided >= S_MIN &&
      provided <= S_MAX
        ? [
            {
              id: "provided",
              label: "s provided",
              x: provided,
              y: providedPhiVn,
              token: governing.check.status === "ng" ? "ng" : "ok",
              meta: { kind: "provided", s: provided, phiVn: providedPhiVn },
            },
          ]
        : [];

    const rules: XyRule[] = [{ axis: "y", value: Vu, token: "ng", dashed: true, opacity: 0.55 }];

    // Headroom above the demand line, shaded — the passing region.
    const areas: XyArea[] = [
      {
        id: "headroom",
        points: curve
          .filter((p) => p.phiVn > Vu)
          .map((p) => ({ x: p.s, y1: Vu, y2: p.phiVn })),
        token: "line",
        opacity: 0.06,
      },
    ];

    return {
      special,
      caseLabel: governing.demand.label ?? governing.demand.id,
      Vu,
      sMax,
      provided,
      series,
      markers,
      rules,
      areas,
      status: governing.check.status,
    };
  }, [input, report]);

  if (view === null) return null;

  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle
            render={<h2 />}
            className="font-mono text-xs font-medium tracking-tight text-muted-foreground"
          >
            shear vs. bar spacing
          </CardTitle>
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-xs2 text-muted-foreground">
              {view.special ? "ACI 318-19 §18.10.4" : "ACI 318-19 §11.5.4"}
            </span>
            <ChartExportButtons containerRef={plotRef} filename="shear-spacing-sweep" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div ref={plotRef}>
          <XyChart<SweepMeta>
            ariaLabel="Shear capacity against horizontal bar spacing"
            ariaDescription={`Design shear strength swept over horizontal bar spacing from ${S_MIN} to ${S_MAX} inches, with the governing demand as a horizontal line and the provided spacing marked. The shaded region is the headroom above the demand.`}
            series={view.series}
            markers={view.markers}
            rules={view.rules}
            areas={view.areas}
            height={240}
            x={X_AXIS}
            y={Y_AXIS}
            focus="nearest-x"
            tooltip={(point) =>
              point.meta?.kind === "provided"
                ? `s provided ${num(point.x, 1)} in\nφVn ${num(point.y)} kip`
                : `s ${num(point.x, 1)} in · φVn ${num(point.y)} kip`
            }
            onFocusChange={setFocus}
          />
        </div>

        <p aria-live="polite" className="min-h-8 font-mono text-xs2 leading-4 text-muted-foreground">
          {focus === null ? (
            <>
              {view.special ? "Ve" : "Vu"} = {num(view.Vu)} kip ({view.caseLabel}) —{" "}
              {view.sMax === null
                ? `no spacing in the ${fmt(S_MIN)}–${fmt(S_MAX)} in sweep carries it`
                : `carried up to s = ${num(view.sMax, 1)} in`}
              <br />
              <span className={cn(statusText(view.status))}>
                s = {num(view.provided, 1)} in provided
              </span>
            </>
          ) : (
            <>
              s = {num(focus.x, 1)} in · φV<sub>n</sub> = {num(focus.y)} kip
              <br />
              margin over {view.special ? "Ve" : "Vu"}: {num(focus.y - view.Vu)} kip
            </>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground">
          <span>φVn swept · governing case only</span>
          <span className="text-status-ng">
            dashed — {view.special ? "Ve (amplified)" : "Vu"}
          </span>
          <span>shaded — headroom</span>
        </div>
      </CardContent>
    </Card>
  );
});
