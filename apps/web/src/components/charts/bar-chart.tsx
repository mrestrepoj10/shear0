"use client";

/**
 * The single place in the app that knows which charting library draws bar
 * charts — the second chart boundary, alongside `xy-chart.tsx`.
 *
 * Same contract as that file: feature code (`shear-panel.tsx`) speaks the props
 * API below in plain domain terms — categories, bars, tokens, reference rules —
 * and never sees a library type. If TanStack Charts stops carrying its weight,
 * only the files in this directory change.
 *
 * Layout is horizontal on purpose: the categories are load-case labels, and
 * text reads better along a band on the y axis than rotated under an x axis.
 * Grammar used: `barX` with a band scale on y (`@tanstack/charts/scales/band`)
 * and a `group(...)` layout for the within-category sub-band, plus `ruleX` for
 * vertical reference lines. The group key is the bar's `id` via the `z`
 * channel — series identity, so "demand" always sits in the same slot of every
 * category — and paint is a per-datum `fill` accessor, so no library color
 * scale is involved.
 */

import { barX, defineChart, group, ruleX } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useMemo } from "react";
import type { ChartToken } from "@/components/charts/xy-chart";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// props API — domain terms only, no library types
// ---------------------------------------------------------------------------

export interface BarDatum<M = unknown> {
  /** series identity — bars with the same id share a slot in every category */
  id: string;
  label: string;
  value: number;
  token: ChartToken;
  /** carried through to the focus callback so callers can show extra readout */
  meta?: M;
}

export interface BarCategory<M = unknown> {
  id: string;
  /** the band's tick text; labels must be unique — they are the y-scale domain */
  label: string;
  bars: readonly BarDatum<M>[];
}

/** A vertical reference line (e.g. a capacity every bar is measured against). */
export interface BarRule {
  value: number;
  /** not drawn by the renderer — callers surface it in their legend/readout */
  label?: string;
  token: ChartToken;
  dashed?: boolean;
}

export interface BarAxis {
  label: string;
  /** tick formatter; receives the raw domain value */
  format?: (value: number) => string;
}

/** What the pointer or keyboard is currently over. */
export interface BarFocus<M = unknown> {
  categoryId: string;
  categoryLabel: string;
  barId: string;
  barLabel: string;
  value: number;
  meta?: M;
}

export interface BarChartProps<M = unknown> {
  ariaLabel: string;
  ariaDescription?: string;
  categories: readonly BarCategory<M>[];
  rules?: readonly BarRule[];
  x: BarAxis;
  height?: number;
  className?: string;
  onFocusChange?: (focus: BarFocus<M> | null) => void;
}

// ---------------------------------------------------------------------------
// theme tokens
// ---------------------------------------------------------------------------

/**
 * Duplicated from `xy-chart.tsx`, which keeps its PALETTE private — see that
 * file's header for why these are `var(--token)` strings handed straight to the
 * renderer (SSR paints the final color, the cascade handles the theme swap)
 * and why `ok` and `grid` both paint from `--foreground`. Keep the two maps
 * byte-identical.
 */
const PALETTE: Record<ChartToken, string> = {
  line: "var(--foreground)",
  muted: "var(--muted-foreground)",
  grid: "var(--foreground)",
  ok: "var(--foreground)",
  ng: "var(--status-ng)",
};

/** Same server-side coordinate space as `xy-chart.tsx` — see the note there. */
const INITIAL_WIDTH = 820;

// ---------------------------------------------------------------------------
// library-facing row model
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  categoryId: string;
  categoryLabel: string;
  barId: string;
  barLabel: string;
  value: number;
  token: ChartToken;
  meta: unknown;
}

export function BarChart<M = unknown>({
  ariaLabel,
  ariaDescription,
  categories,
  rules,
  x,
  height = 240,
  className,
  onFocusChange,
}: BarChartProps<M>) {
  const definition = useMemo(() => {
    const rows: Row[] = [];
    const seriesIds: string[] = [];
    for (const category of categories) {
      for (const bar of category.bars) {
        if (!Number.isFinite(bar.value)) continue;
        if (!seriesIds.includes(bar.id)) seriesIds.push(bar.id);
        rows.push({
          id: `${category.id}:${bar.id}`,
          categoryId: category.id,
          categoryLabel: category.label,
          barId: bar.id,
          barLabel: bar.label,
          value: bar.value,
          token: bar.token,
          meta: bar.meta,
        });
      }
    }

    const categoryScale = scaleBand<string>()
      .domain(categories.map((category) => category.label))
      .paddingInner(0.25)
      .paddingOuter(0.1);
    const groupScale = scaleBand<string>().domain(seriesIds).paddingInner(0.12);

    // Anchor the value axis at zero: a bar chart that starts elsewhere lies
    // about magnitude, and `nice` alone does not promise the baseline.
    const marks = [
      ruleX([0], { id: "baseline", stroke: PALETTE.grid, strokeOpacity: 0.3 }),
      barX(rows, {
        id: "bars",
        x: "value",
        y: "categoryLabel",
        z: "barId",
        fill: (row: Row) => PALETTE[row.token],
        layout: group({ scale: groupScale }),
        inset: 1,
        radius: 2,
        maxThickness: 28,
      }),
      ...(rules ?? [])
        .filter((rule) => Number.isFinite(rule.value))
        .map((rule, index) =>
          ruleX([rule.value], {
            id: `rule-${index}`,
            stroke: PALETTE[rule.token],
            strokeWidth: 1.25,
            ...(rule.dashed === true ? { strokeDasharray: "4 3" } : {}),
          }),
        ),
    ];

    return defineChart({
      marks,
      x: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: {
          label: x.label,
          ...(x.format === undefined ? {} : { ticks: { format: x.format } }),
        },
      },
      y: {
        scale: categoryScale,
      },
      theme: { foreground: PALETTE.line, muted: PALETTE.muted, grid: PALETTE.grid },
    });
  }, [categories, rules, x]);

  return (
    /* Axis text inherits the container font: the mono class here is what puts
       tick labels in tabular figures. */
    <div className={cn("w-full font-mono text-2xs text-muted-foreground", className)}>
      <Chart
        definition={definition}
        height={height}
        initialWidth={INITIAL_WIDTH}
        ariaLabel={ariaLabel}
        {...(ariaDescription === undefined ? {} : { ariaDescription })}
        onFocusChange={(point) => {
          if (onFocusChange === undefined) return;
          const row = point?.datum;
          // The rules contribute no interaction points, but guard anyway: only
          // a bar row carries a category.
          if (row === undefined || typeof row.categoryId !== "string") {
            onFocusChange(null);
            return;
          }
          onFocusChange({
            categoryId: row.categoryId,
            categoryLabel: row.categoryLabel,
            barId: row.barId,
            barLabel: row.barLabel,
            value: row.value,
            meta: row.meta as M,
          });
        }}
      />
    </div>
  );
}
