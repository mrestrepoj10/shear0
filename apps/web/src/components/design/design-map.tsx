"use client";

/**
 * The feasibility map — "where can I move?"
 *
 * A grid over the two knobs a designer iterates most: vertical bar size (rows)
 * × vertical spacing (columns). Every cell is a *full engine run* on a wall
 * identical to the current one except for that layer — the whole check set in
 * ~1 ms makes ~70 candidate designs cheap enough to evaluate on every input
 * change. A cell's tone is its governing utilization (darker = closer to 1),
 * failure is the status hue, and the current design wears a ring. Clicking a
 * cell *applies* it: the map is not a picture of the design space, it is a
 * control surface over it.
 *
 * Cells are HTML buttons, not chart marks, on purpose: every cell is an
 * action, so it should be a real focusable, clickable element with its own
 * accessible name — a grid of `<button>`s gives keyboard navigation, focus
 * rings and screen-reader rows for free, where an SVG heatmap would have to
 * rebuild all three.
 *
 * Follow-ups noted while building this (deliberately out of scope here):
 * - Pareto scatter: steel weight vs governing utilization over this same
 *   candidate grid, Pareto front highlighted — "the cheapest wall that
 *   passes". Wants a traced steel-weight node in the engine first.
 * - Ghost curve: hovering a cell overlays that candidate's P–M curve on the
 *   interaction chart, reusing the pm-slice selection machinery.
 */

import {
  checkOrdinaryWall,
  checkSpecialWall,
  fmt,
  type BarSize,
  type CheckResult,
  type WallInput,
  type WallReport,
} from "@shear0/engine";
import { memo, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { num } from "@/components/design/status";
import { hasNoLoads, normalizedStatus } from "@/components/design/results-summary";
import { BAR_SIZES } from "@/lib/presets";
import { useWallDispatch } from "@/lib/wall-state";
import { cn } from "@/lib/utils";
import type { CheckStatus } from "@shear0/engine";

/** The practical iteration range; the full BAR_SIZES list would double the rows for sizes nobody puts in a wall web. */
const MAP_BARS: BarSize[] = ["4", "5", "6", "7", "8"];
const SPACINGS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

interface Cell {
  bar: BarSize;
  spacing: number;
  /** worst finite utilization across every check, or null when the engine cannot run */
  utilization: number | null;
  /** the candidate's overall verdict, normalized the way the verdict strip is */
  status: CheckStatus;
  /** title of the check with the highest utilization (or the first failure) */
  governing: string;
}

/**
 * The grid always contains the wall being designed: the inputs accept #3–#11
 * at any spacing, so a #9 wall or a 5-inch spacing gets its row/column added
 * dynamically rather than losing its ring off the edge of the map.
 */
function axes(bar: BarSize, spacing: number): { bars: BarSize[]; spacings: number[] } {
  const bars = MAP_BARS.includes(bar)
    ? MAP_BARS
    : BAR_SIZES.filter((size) => size === bar || MAP_BARS.includes(size));
  const spacings = SPACINGS.includes(spacing)
    ? SPACINGS
    : [...SPACINGS, spacing].sort((a, b) => a - b);
  return { bars, spacings };
}

/**
 * Checks whose "utilization" is a discrete count ratio (2 curtains / 2
 * required = 1.00 for every candidate). Left in the pass/fail verdict but out
 * of the tone scale — a constant 1.00 would flatten the whole map to one
 * shade and hide the gradient the map exists to show.
 */
const DISCRETE_CHECKS = new Set(["detailing.curtains"]);

function worstOf(report: WallReport): { utilization: number | null; governing: string } {
  let worst: { u: number; check: CheckResult } | null = null;
  const consider = (check: CheckResult) => {
    if (DISCRETE_CHECKS.has(check.id) && check.status !== "ng") return;
    const u = check.utilization?.value;
    if (typeof u !== "number" || !Number.isFinite(u)) return;
    if (worst === null || u > worst.u) worst = { u, check };
  };
  for (const check of report.general) consider(check);
  for (const group of report.perDemand) for (const check of group.checks) consider(check);
  // A failing pass/fail check (no ratio) must still govern the cell's label.
  if (report.status === "ng") {
    const failed = [
      ...report.general,
      ...report.perDemand.flatMap((g) => g.checks),
    ].find((c) => c.status === "ng");
    if (failed) {
      const w = worst as { u: number; check: CheckResult } | null;
      return { utilization: w?.u ?? null, governing: failed.title };
    }
  }
  const w = worst as { u: number; check: CheckResult } | null;
  return w === null
    ? { utilization: null, governing: "—" }
    : { utilization: w.u, governing: w.check.title };
}

export const DesignMap = memo(function DesignMap({
  input,
  report,
}: {
  input: WallInput;
  report: WallReport;
}) {
  const dispatch = useWallDispatch();
  const [hover, setHover] = useState<Cell | null>(null);

  const { bars, spacings, cells, unloaded } = useMemo(() => {
    const run = input.system === "special" ? checkSpecialWall : checkOrdinaryWall;
    const { bars, spacings } = axes(input.vertical.bar, input.vertical.spacing);
    // Feasibility is a strength question; with every demand at zero there is
    // nothing to ask, exactly as the verdict strip reads it.
    const unloaded = hasNoLoads(report);
    const cells = bars.map((bar) =>
      spacings.map((spacing): Cell => {
        // The current design's own cell reads from the live report, so the
        // map can never disagree with the verdict strip beside it.
        const isCurrent = bar === input.vertical.bar && spacing === input.vertical.spacing;
        try {
          const candidate: WallInput = isCurrent
            ? input
            : { ...input, vertical: { ...input.vertical, bar, spacing } };
          const result = isCurrent ? report : run(candidate);
          const { utilization, governing } = worstOf(result);
          return { bar, spacing, utilization, status: normalizedStatus(result), governing };
        } catch {
          return {
            bar,
            spacing,
            utilization: null,
            status: "ng",
            governing: "engine could not run",
          };
        }
      }),
    );
    return { bars, spacings, cells, unloaded };
  }, [input, report]);

  const current = { bar: input.vertical.bar, spacing: input.vertical.spacing };
  const flat = cells.flat();
  const feasible = flat.filter((cell) => cell.status === "ok").length;
  const warned = flat.filter((cell) => cell.status === "warning").length;
  const gridTemplate = `2.5rem repeat(${spacings.length}, minmax(0, 1fr))`;

  // Tone ramps over the *observed* utilization range, not 0–1: the candidates
  // often all sit inside a narrow band (0.6–1.0 say), and an absolute ramp
  // renders that as one indistinguishable shade. The readout carries the
  // absolute number; the map's job is the gradient.
  const passing = flat.filter((c) => c.status !== "ng" && c.utilization !== null);
  const uMin = Math.min(...passing.map((c) => c.utilization ?? 0));
  const uMax = Math.max(...passing.map((c) => c.utilization ?? 0));
  const ramp = (u: number | null): number => {
    if (u === null) return 0.5;
    if (!(uMax > uMin)) return 0.5;
    return Math.max(0, Math.min(1, (u - uMin) / (uMax - uMin)));
  };

  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle
            render={<h2 />}
            className="font-mono text-xs font-medium tracking-tight text-muted-foreground"
          >
            design map — vertical steel
          </CardTitle>
          <span className="truncate font-mono text-xs2 text-muted-foreground">
            bar × spacing · full check set per cell
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div
          role="grid"
          aria-label="Feasibility of vertical bar size and spacing combinations. Each cell reports its governing utilization; activating a cell applies that reinforcement."
          className="flex flex-col gap-1"
        >
          {/* column header: spacings */}
          <div role="row" className="grid gap-1" style={{ gridTemplateColumns: gridTemplate }}>
            <span role="columnheader" className="font-mono text-2xs text-muted-foreground" />
            {spacings.map((s) => (
              <span
                key={s}
                role="columnheader"
                className="text-center font-mono text-2xs tabular-nums text-muted-foreground"
              >
                {s}
              </span>
            ))}
          </div>
          {cells.map((row, r) => {
            const bar = bars[r];
            if (bar === undefined) return null;
            return (
              <div
                key={bar}
                role="row"
                className="grid gap-1"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <span
                  role="rowheader"
                  className="self-center font-mono text-2xs text-muted-foreground"
                >
                  #{bar}
                </span>
                {row.map((cell) => {
                  const isCurrent = cell.bar === current.bar && cell.spacing === current.spacing;
                  const u = cell.utilization;
                  // Tone is utilization made visible: light means headroom,
                  // dark means close to the limit, hue means failure, and an
                  // unloaded wall has nothing to say — same vocabulary as the
                  // status badges (warning differs by a ring, never hue).
                  const tone =
                    cell.status === "ng"
                      ? { backgroundColor: "color-mix(in oklab, var(--status-ng) 24%, transparent)" }
                      : cell.status === "na"
                        ? { backgroundColor: "color-mix(in oklab, var(--foreground) 5%, transparent)" }
                        : { backgroundColor: `color-mix(in oklab, var(--foreground) ${Math.round(7 + 48 * ramp(u))}%, transparent)` };
                  const spoken =
                    cell.status === "ng"
                      ? `fails ${cell.governing}`
                      : cell.status === "na"
                        ? "not evaluated — no loads applied"
                        : `${cell.status === "warning" ? "passes with warnings" : "passes"}, utilization ${num(u ?? undefined, 2)}`;
                  return (
                    <button
                      key={cell.spacing}
                      type="button"
                      role="gridcell"
                      aria-label={`#${cell.bar} at ${cell.spacing} inches — ${spoken}${isCurrent ? " (current design)" : ""}`}
                      data-status={cell.status}
                      className={cn(
                        "h-5 rounded-[3px] transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                        cell.status === "warning" && "ring-1 ring-inset ring-foreground/40",
                        isCurrent && "ring-2 ring-foreground ring-offset-1 ring-offset-card",
                      )}
                      style={tone}
                      onMouseEnter={() => setHover(cell)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(cell)}
                      onBlur={() => setHover(null)}
                      onClick={() =>
                        dispatch({
                          type: "setLayer",
                          layer: "vertical",
                          patch: { bar: cell.bar, spacing: cell.spacing },
                        })
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </div>

        <p aria-live="polite" className="min-h-8 font-mono text-xs2 leading-4 text-muted-foreground">
          {hover === null ? (
            unloaded ? (
              <>
                every demand is zero — feasibility is not evaluated
                <br />
                add a load case and the map fills in
              </>
            ) : (
              <>
                {feasible} of {flat.length} combinations pass every check
                {warned > 0 ? ` · ${warned} with warnings` : ""}
                <br />
                hover a cell to read it — click to apply
              </>
            )
          ) : (
            <>
              #{hover.bar} @ {fmt(hover.spacing)} in —{" "}
              {hover.status === "ng" ? (
                <span className="text-status-ng">fails</span>
              ) : hover.status === "na" ? (
                <>n/a</>
              ) : (
                <>
                  utilization {num(hover.utilization ?? undefined, 2)}
                  {hover.status === "warning" ? " (with warnings)" : ""}
                </>
              )}
              <br />
              governing: {hover.governing}
            </>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground">
          <span>light → dark: governing utilization</span>
          <span className="text-status-ng">tinted — fails a check</span>
          <span>inner ring — warnings</span>
          <span>ring — current design</span>
        </div>
      </CardContent>
    </Card>
  );
});
