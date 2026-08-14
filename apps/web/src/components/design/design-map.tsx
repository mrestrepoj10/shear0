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
} from "@kern/engine";
import { memo, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { num } from "@/components/design/status";
import { useWallDispatch } from "@/lib/wall-state";
import { cn } from "@/lib/utils";

/** The practical iteration range; the full BAR_SIZES list would double the rows for sizes nobody puts in a wall web. */
const MAP_BARS: BarSize[] = ["4", "5", "6", "7", "8"];
const SPACINGS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

interface Cell {
  bar: BarSize;
  spacing: number;
  /** worst finite utilization across every check, or null when the engine cannot run */
  utilization: number | null;
  ok: boolean;
  /** title of the check with the highest utilization (or the first failure) */
  governing: string;
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

  const cells = useMemo(() => {
    const run = input.system === "special" ? checkSpecialWall : checkOrdinaryWall;
    return MAP_BARS.map((bar) =>
      SPACINGS.map((spacing): Cell => {
        // The current design's own cell reads from the live report, so the
        // map can never disagree with the verdict strip beside it.
        const isCurrent = bar === input.vertical.bar && spacing === input.vertical.spacing;
        try {
          const candidate: WallInput = isCurrent
            ? input
            : { ...input, vertical: { ...input.vertical, bar, spacing } };
          const result = isCurrent ? report : run(candidate);
          const { utilization, governing } = worstOf(result);
          return { bar, spacing, utilization, ok: result.status !== "ng", governing };
        } catch {
          return { bar, spacing, utilization: null, ok: false, governing: "engine could not run" };
        }
      }),
    );
  }, [input, report]);

  const current = { bar: input.vertical.bar, spacing: input.vertical.spacing };
  const feasible = cells.flat().filter((cell) => cell.ok).length;

  // Tone ramps over the *observed* utilization range, not 0–1: the candidates
  // often all sit inside a narrow band (0.6–1.0 say), and an absolute ramp
  // renders that as one indistinguishable shade. The readout carries the
  // absolute number; the map's job is the gradient.
  const passing = cells.flat().filter((c) => c.ok && c.utilization !== null);
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
          <div role="row" className="grid grid-cols-[2.5rem_repeat(13,minmax(0,1fr))] gap-1">
            <span role="columnheader" className="font-mono text-2xs text-muted-foreground" />
            {SPACINGS.map((s) => (
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
            const bar = MAP_BARS[r];
            if (bar === undefined) return null;
            return (
              <div
                key={bar}
                role="row"
                className="grid grid-cols-[2.5rem_repeat(13,minmax(0,1fr))] gap-1"
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
                  // dark means close to the limit, hue means failure.
                  const tone = cell.ok
                    ? { backgroundColor: `color-mix(in oklab, var(--foreground) ${Math.round(7 + 48 * ramp(u))}%, transparent)` }
                    : { backgroundColor: "color-mix(in oklab, var(--status-ng) 24%, transparent)" };
                  return (
                    <button
                      key={cell.spacing}
                      type="button"
                      role="gridcell"
                      aria-label={`#${cell.bar} at ${cell.spacing} inches — ${
                        cell.ok ? `passes, utilization ${num(u ?? undefined, 2)}` : `fails ${cell.governing}`
                      }${isCurrent ? " (current design)" : ""}`}
                      data-status={cell.ok ? "ok" : "ng"}
                      className={cn(
                        "h-5 rounded-[3px] transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
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
            <>
              {feasible} of {MAP_BARS.length * SPACINGS.length} combinations pass every check
              <br />
              hover a cell to read it — click to apply
            </>
          ) : (
            <>
              #{hover.bar} @ {fmt(hover.spacing)} in —{" "}
              {hover.ok ? (
                <>utilization {num(hover.utilization ?? undefined, 2)}</>
              ) : (
                <span className="text-status-ng">fails</span>
              )}
              <br />
              governing: {hover.governing}
            </>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground">
          <span>light → dark: governing utilization</span>
          <span className="text-status-ng">tinted — fails a check</span>
          <span>ring — current design</span>
        </div>
      </CardContent>
    </Card>
  );
});
