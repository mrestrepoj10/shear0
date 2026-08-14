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

import { defineChart, dot, lineY } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
  x: XyAxis;
  y: XyAxis;
  height?: number;
  className?: string;
  onFocusChange?: (focus: XyFocus<M> | null) => void;
}

// ---------------------------------------------------------------------------
// theme tokens
// ---------------------------------------------------------------------------

/**
 * Paints are emitted by the renderer as SVG presentation attributes, so we hand
 * it concrete colors rather than `var(--token)` strings and re-resolve them when
 * the theme class flips. The fallbacks below are what the server renders; the
 * first client effect replaces them, so SSR and hydration see the same markup.
 */
/**
 * `ok` paints with `--foreground` on purpose: saturation in this app means a
 * check *failed*, so a passing marker is a plain dark dot. `--status-ok` stays
 * defined in `globals.css` as a reserved accent, but nothing on the page spends
 * it. See the header of `design/status.tsx`.
 */
/**
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
const TOKEN_VARS: Record<ChartToken, string> = {
  line: "--foreground",
  muted: "--muted-foreground",
  grid: "--foreground",
  ok: "--foreground",
  ng: "--status-ng",
};

const TOKEN_FALLBACK: Record<ChartToken, string> = {
  line: "currentColor",
  muted: "currentColor",
  grid: "currentColor",
  ok: "currentColor",
  ng: "currentColor",
};

const TOKENS = Object.keys(TOKEN_VARS) as ChartToken[];

function samePalette(a: Record<ChartToken, string>, b: Record<ChartToken, string>): boolean {
  return TOKENS.every((token) => a[token] === b[token]);
}

function usePalette(target: RefObject<HTMLElement | null>): Record<ChartToken, string> {
  const [palette, setPalette] = useState<Record<ChartToken, string>>(TOKEN_FALLBACK);

  useEffect(() => {
    const element = target.current;
    if (element === null) return;

    const read = () => {
      const style = getComputedStyle(element);
      const next = {} as Record<ChartToken, string>;
      for (const token of TOKENS) {
        const value = style.getPropertyValue(TOKEN_VARS[token]).trim();
        next[token] = value === "" ? TOKEN_FALLBACK[token] : value;
      }
      setPalette((prev) => (samePalette(prev, next) ? prev : next));
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, [target]);

  return palette;
}

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

export function XyChart<M = unknown>({
  ariaLabel,
  ariaDescription,
  series,
  markers,
  x,
  y,
  height = 300,
  className,
  onFocusChange,
}: XyChartProps<M>) {
  const host = useRef<HTMLDivElement>(null);
  const palette = usePalette(host);

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
      ...seriesRows.map(({ series: s, rows }) =>
        lineY(rows, {
          id: s.id,
          x: "x",
          y: "y",
          stroke: palette[s.token],
          strokeWidth: s.width ?? 1.75,
          ...(s.dashed === true ? { strokeDasharray: "4 3" } : {}),
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
            ? { r: 6, fill: "transparent", stroke: palette.ng, strokeWidth: 2 }
            : { r: 4.5, fill: palette[token], stroke: palette[token], strokeWidth: 1 }),
        }),
      ),
      ...(anchors.length === 0
        ? []
        : [dot(anchors, { id: "anchors", x: "x", y: "y", r: 0, fill: "transparent" })]),
    ];

    return defineChart({
      marks,
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
      theme: { foreground: palette.line, muted: palette.muted, grid: palette.grid },
    });
  }, [series, markers, x, y, palette]);

  return (
    /* Axis text inherits the container font: the mono class here is what puts
       tick labels in tabular figures. */
    <div
      ref={host}
      className={cn("w-full font-mono text-2xs text-muted-foreground", className)}
    >
      <Chart
        definition={definition}
        height={height}
        initialWidth={720}
        ariaLabel={ariaLabel}
        {...(ariaDescription === undefined ? {} : { ariaDescription })}
        onFocusChange={(point) => {
          if (onFocusChange === undefined) return;
          const row = point?.datum;
          if (row === undefined || row.sourceId === "anchor") {
            onFocusChange(null);
            return;
          }
          onFocusChange({
            kind: row.kind,
            id: row.sourceId,
            label: row.label,
            x: row.x,
            y: row.y,
            meta: row.meta as M,
          });
        }}
      />
    </div>
  );
}
