"use client";

/**
 * The single place in the app that knows which charting library draws XY plots.
 *
 * PLAN §2 pins TanStack Charts (pre-alpha) with an explicit escape hatch: if the
 * library ever stops carrying its weight, only this file changes — feature code
 * (`interaction-chart.tsx`) talks to the props API below, which is expressed in
 * plain domain terms (series of points, markers, tokens) and never leaks a
 * library type.
 *
 * Chosen entry point: `@tanstack/charts` + its `/react` adapter. The compat
 * package `@tanstack/react-charts` named in the plan is a re-export of that
 * adapter and cannot be used on its own — the grammar (`defineChart`, `lineY`,
 * `dot`, scales) lives in `@tanstack/charts` regardless — so one exact-pinned
 * dependency covers both.
 */

import { areaY, defineChart, dot, lineY, ruleX, ruleY } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// props API — domain terms only, no library types
// ---------------------------------------------------------------------------

/** Semantic paint slots. Feature code names a role; this file owns the color. */
export type ChartToken = "line" | "muted" | "ok" | "ng" | "grid";

export interface XyPoint<M = unknown> {
  x: number;
  y: number;
  /** carried through to the focus callback so callers can show extra readout */
  meta?: M;
}

export interface XySeries<M = unknown> {
  id: string;
  label: string;
  points: readonly XyPoint<M>[];
  token: ChartToken;
  dashed?: boolean;
  /**
   * Explicit dash pattern (SVG `stroke-dasharray`), overriding `dashed`'s
   * default "4 3" — for charts overlaying several same-token series that must
   * stay tellable apart (the design-options comparison).
   */
  dash?: string;
  /** stroke width in px; defaults to 1.75 */
  width?: number;
  opacity?: number;
}

export interface XyMarker<M = unknown> {
  id: string;
  label: string;
  x: number;
  y: number;
  token: ChartToken;
  meta?: M;
}

/**
 * A reference line pinned to one axis value — a code limit, a demand level, a
 * zero line. Drawn under the data, never focusable: a rule is context, not a
 * datum, so the pointer passes straight through it to the curves.
 */
export interface XyRule {
  axis: "x" | "y";
  value: number;
  token: ChartToken;
  dashed?: boolean;
  opacity?: number;
}

/**
 * A shaded band between two y-values across x — the inside of a capacity
 * surface, the headroom between demand and capacity. Fill only, no stroke, and
 * like rules it is not focusable.
 */
export interface XyArea {
  id: string;
  points: readonly { x: number; y1: number; y2: number }[];
  token: ChartToken;
  /** fill opacity; defaults to 0.08 — context, not content */
  opacity?: number;
}

export interface XyAxis {
  label: string;
  /** tick formatter; receives the raw domain value */
  format?: (value: number) => string;
  /** force the domain to include these values (e.g. 0) */
  include?: readonly number[];
  nice?: boolean;
  grid?: boolean;
}

/** What the pointer or keyboard is currently over. */
export interface XyFocus<M = unknown> {
  kind: "series" | "marker";
  /** series id or marker id */
  id: string;
  label: string;
  x: number;
  y: number;
  meta?: M;
}

export interface XyChartProps<M = unknown> {
  ariaLabel: string;
  ariaDescription?: string;
  series: readonly XySeries<M>[];
  markers?: readonly XyMarker<M>[];
  /** reference lines, drawn under the data */
  rules?: readonly XyRule[];
  /** shaded bands, drawn under everything */
  areas?: readonly XyArea[];
  x: XyAxis;
  y: XyAxis;
  height?: number;
  className?: string;
  onFocusChange?: (focus: XyFocus<M> | null) => void;
  /**
   * A cursor-anchored tooltip for the focused point. The formatter receives the
   * same `XyFocus` the focus callback does, so a panel can share one readout
   * function between its tooltip and its fixed line. Absent, no tooltip — the
   * chart behaves exactly as before.
   */
  tooltip?: (focus: XyFocus<M>) => string;
  /**
   * How the pointer picks a focus point. `nearest` (default) is per-point;
   * `nearest-x` snaps to the closest x regardless of y — right for reading a
   * single curve; `group-x` focuses every series at one x — right for
   * comparing series at a station.
   */
  focus?: "nearest" | "nearest-x" | "group-x";
}

// ---------------------------------------------------------------------------
// theme tokens
// ---------------------------------------------------------------------------

/**
 * Paints are `var(--token)` strings, handed straight to the renderer.
 *
 * This file used to resolve the tokens to literal colours in an effect and feed
 * *those* to the chart, with `currentColor` as the server-side fallback. The
 * cost was visible: SSR painted the whole plot in the host's inherited muted
 * grey, and the first client effect repainted it — curve grey→foreground,
 * marker grey→red — one frame after hydration. (Measured on /design: SSR
 * `stroke="currentColor"` computing to `lab(72.16 0 0)`, then
 * `lab(98.26% 0 0)`.)
 *
 * The resolution step was never needed. Every colour the renderer is handed is
 * written out as an SVG presentation attribute or an inline `style` fill
 * (`scene.js`: `stroke: theme.grid`, `stroke: theme.foreground`, `style: { fill:
 * theme.foreground }`, per-mark `stroke`/`fill`) — the library never parses
 * them, which is why its own default `theme.foreground` is the equally
 * unparseable `"currentColor"`. So a `var()` reference survives the whole way
 * to the DOM, exactly as it does in `drawing/plan-section.tsx`, and the server
 * emits the same string the client does: no effect, no MutationObserver, no
 * repaint, and the theme swap is handled by the cascade instead of by React.
 *
 * The one thing this ties us to is the SVG renderer — a canvas backend would
 * need literals resolved again. The `Chart` adapter here renders SVG.
 *
 * `ok` paints with `--foreground` on purpose: saturation in this app means a
 * check *failed*, so a passing marker is a plain dark dot. `--status-ok` stays
 * defined in `globals.css` as a reserved accent, but nothing on the page spends
 * it. See the header of `design/status.tsx`.
 *
 * `grid` paints from `--foreground`, not `--border`, and that is not a mistake.
 *
 * The renderer draws the grid group at a hard-coded `strokeOpacity: 0.11`
 * (`scene.js`, `createGrid`), so whatever colour it is handed arrives at 11% of
 * itself. `--border` is *already* the 11%-ish tone (oklch 0.922 light, white at
 * 10% dark), so 11% of it was ~1% contrast: gridlines that were in the DOM and
 * invisible on both charts in both themes — which is what "grid: true renders
 * nothing" actually was. Handing it the foreground makes the rendered hairline
 * land on the border tone, which is what the design asked for in the first
 * place.
 */
const PALETTE: Record<ChartToken, string> = {
  line: "var(--foreground)",
  muted: "var(--muted-foreground)",
  grid: "var(--foreground)",
  ok: "var(--foreground)",
  ng: "var(--status-ng)",
};

/**
 * The coordinate space the server draws in.
 *
 * The rendered `<svg>` is `width="100%"` over a `viewBox`, so a wrong
 * `initialWidth` does not shift the page — it stretches the whole plot
 * horizontally until the client measures the host and re-lays it out. The
 * library's 720 against a measured 820 was a 14% squash of every tick label and
 * curve for the length of hydration. 820 is the results column at the ≥1024 px
 * layout (`max-w-5xl` minus the page and card padding), which is where the
 * chart is read; narrower viewports still correct on mount, from closer.
 */
const INITIAL_WIDTH = 820;

// ---------------------------------------------------------------------------
// library-facing row model
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  x: number;
  y: number;
  kind: "series" | "marker";
  sourceId: string;
  label: string;
  meta: unknown;
}

function finite(point: { x: number; y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Row → the caller-facing focus shape; null for the invisible anchor rows. */
function rowFocus<M>(row: Row | undefined): XyFocus<M> | null {
  if (row === undefined || row.sourceId === "anchor") return null;
  return {
    kind: row.kind,
    id: row.sourceId,
    label: row.label,
    x: row.x,
    y: row.y,
    meta: row.meta as M,
  };
}

export function XyChart<M = unknown>({
  ariaLabel,
  ariaDescription,
  series,
  markers,
  rules,
  areas,
  x,
  y,
  height = 300,
  className,
  onFocusChange,
  tooltip: tooltipFormat,
  focus = "nearest",
}: XyChartProps<M>) {
  const definition = useMemo(() => {
    const seriesRows = series.map((s) => ({
      series: s,
      rows: s.points.filter(finite).map<Row>((point, index) => ({
        id: `${s.id}:${index}`,
        x: point.x,
        y: point.y,
        kind: "series" as const,
        sourceId: s.id,
        label: s.label,
        meta: point.meta,
      })),
    }));

    // One dot mark per token: `dot.fill` is a constant, so status color is
    // expressed by grouping markers rather than by a per-row channel.
    const markerTokens = new Map<ChartToken, Row[]>();
    for (const marker of markers ?? []) {
      if (!finite(marker)) continue;
      const bucket = markerTokens.get(marker.token) ?? [];
      bucket.push({
        id: `marker:${marker.id}`,
        x: marker.x,
        y: marker.y,
        kind: "marker",
        sourceId: marker.id,
        label: marker.label,
        meta: marker.meta,
      });
      markerTokens.set(marker.token, bucket);
    }

    // Anchor rows keep the domain honest (e.g. always show M = 0 and P = 0)
    // without drawing anything: a zero-radius dot is invisible but still scales.
    const anchors: Row[] = [];
    const anchorX = x.include ?? [];
    const anchorY = y.include ?? [];
    const span = Math.max(anchorX.length, anchorY.length);
    for (let i = 0; i < span; i++) {
      anchors.push({
        id: `anchor:${i}`,
        x: anchorX[i] ?? anchorX[0] ?? 0,
        y: anchorY[i] ?? anchorY[0] ?? 0,
        kind: "series",
        sourceId: "anchor",
        label: "",
        meta: undefined,
      });
    }

    const marks = [
      // Bands first, rules second, data on top. `decorative()` strips the
      // interaction geometry, so neither ever steals focus from a curve.
      ...(areas ?? []).map((band) =>
        decorative(
          areaY(
            band.points.filter((p) => finite({ x: p.x, y: p.y1 }) && Number.isFinite(p.y2)),
            {
              id: `area-${band.id}`,
              x: "x",
              y1: "y1",
              y2: "y2",
              fill: PALETTE[band.token],
              fillOpacity: band.opacity ?? 0.08,
            },
          ),
        ),
      ),
      ...(rules ?? []).map((rule, index) => {
        const options = {
          id: `rule-${index}`,
          stroke: PALETTE[rule.token],
          strokeOpacity: rule.opacity ?? 0.45,
          ...(rule.dashed === true ? { strokeDasharray: "5 4" } : {}),
        };
        return decorative(
          rule.axis === "y" ? ruleY([rule.value], options) : ruleX([rule.value], options),
        );
      }),
      ...seriesRows.map(({ series: s, rows }) =>
        lineY(rows, {
          id: s.id,
          x: "x",
          y: "y",
          stroke: PALETTE[s.token],
          strokeWidth: s.width ?? 1.75,
          ...(s.dash !== undefined
            ? { strokeDasharray: s.dash }
            : s.dashed === true
              ? { strokeDasharray: "4 3" }
              : {}),
          ...(s.opacity === undefined ? {} : { strokeOpacity: s.opacity }),
        }),
      ),
      // A failing marker differs from a passing one by shape before it differs
      // by colour — hollow, larger, heavier stroke — so the point that is
      // outside the surface stays findable when the hues collapse (ok/ng
      // measure 1.21:1 under deuteranopia) or when the plot is printed grey.
      ...[...markerTokens.entries()].map(([token, rows]) =>
        dot(rows, {
          id: `markers-${token}`,
          x: "x",
          y: "y",
          ...(token === "ng"
            ? { r: 6, fill: "transparent", stroke: PALETTE.ng, strokeWidth: 2 }
            : { r: 4.5, fill: PALETTE[token], stroke: PALETTE[token], strokeWidth: 1 }),
        }),
      ),
      ...(anchors.length === 0
        ? []
        : [dot(anchors, { id: "anchors", x: "x", y: "y", r: 0, fill: "transparent" })]),
    ];

    return defineChart({
      marks,
      focus,
      // The tooltip extension mounts only when a formatter is supplied, so
      // charts without one ship no tooltip DOM at all.
      ...(tooltipFormat === undefined
        ? {}
        : {
            tooltip: {
              use: tooltip,
              className: "xy-chart-tooltip",
              placement: ["top", "right", "left", "bottom"] as const,
              format: (point: { datum: unknown }) => {
                const focused = rowFocus<M>(point.datum as Row);
                return focused === null ? "" : tooltipFormat(focused);
              },
            },
          }),
      x: {
        scale: scaleLinear,
        nice: x.nice ?? true,
        grid: x.grid ?? true,
        axis: {
          label: x.label,
          ...(x.format === undefined ? {} : { ticks: { format: x.format } }),
        },
      },
      y: {
        scale: scaleLinear,
        nice: y.nice ?? true,
        grid: y.grid ?? true,
        axis: {
          label: y.label,
          ...(y.format === undefined ? {} : { ticks: { format: y.format } }),
        },
      },
      theme: { foreground: PALETTE.line, muted: PALETTE.muted, grid: PALETTE.grid },
    });
  }, [series, markers, rules, areas, x, y, tooltipFormat, focus]);

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
          // Decorative marks (areas, rules) can never be focused, but their
          // datum types still reach this union — the cast reflects the runtime.
          onFocusChange(rowFocus<M>(point?.datum as Row | undefined));
        }}
      />
    </div>
  );
}
