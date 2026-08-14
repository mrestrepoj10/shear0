"use client";

/**
 * The shared drawing scaffold for every domain graphic on /design.
 *
 * The drawings are *engineering* drawings, not charts: one uniform scale maps
 * inches to canvas units (`fitScale`), and everything else — hairlines, text,
 * arrowheads — is sized in canvas units so a drawing reads the same whatever
 * container it lands in. Strokes are always `currentColor` at hairline width
 * with `vector-effect: non-scaling-stroke`, so a line is exactly 1 device pixel
 * at any zoom; tone comes from opacity classes, fills from CSS variables. That
 * is the whole theming story — no palette, no hex, works in both themes.
 */

import {
  createContext,
  useContext,
  useId,
  type ReactNode,
  type Ref,
  type SVGProps,
} from "react";
import { cn } from "@/lib/utils";

interface DrawingContextValue {
  /** document-unique prefix for <defs> ids (markers, clip paths) */
  uid: string;
  /** base text size in canvas units */
  fontSize: number;
}

const DrawingContext = createContext<DrawingContextValue>({
  uid: "kern-drawing",
  fontSize: 11,
});

export function useDrawing(): DrawingContextValue {
  return useContext(DrawingContext);
}

/** Spread onto any stroked element: one device pixel, always. */
export const HAIRLINE = {
  strokeWidth: 1,
  vectorEffect: "non-scaling-stroke",
} satisfies Pick<SVGProps<SVGElement>, "strokeWidth" | "vectorEffect">;

export interface Extent {
  width: number;
  height: number;
}

/**
 * Largest uniform scale (canvas units per inch) that fits `world` inside `box`.
 * Uniform on both axes — a drawing that stretches one axis is a lie.
 */
export function fitScale(world: Extent, box: Extent): number {
  const sx = world.width > 0 ? box.width / world.width : 0;
  const sy = world.height > 0 ? box.height / world.height : 0;
  if (sx <= 0) return sy > 0 ? sy : 1;
  if (sy <= 0) return sx;
  return Math.min(sx, sy);
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** viewBox around a content box of `size`, in canvas units. */
export function paddedViewBox(size: Extent, pad: Padding): string {
  return [
    -pad.left,
    -pad.top,
    size.width + pad.left + pad.right,
    size.height + pad.top + pad.bottom,
  ].join(" ");
}

export interface DrawingProps {
  /** "x y w h" in canvas units — usually from `paddedViewBox` */
  viewBox: string;
  /** accessible name; also the <title> */
  title: string;
  desc?: string;
  fontSize?: number;
  /**
   * "img" for a static drawing. A drawing with focusable children must not be
   * an image — screen readers flatten an img subtree — so it becomes a "group".
   */
  role?: "img" | "group";
  className?: string;
  /**
   * The <svg> itself — a drawing with hit targets needs its rendered width to
   * convert canvas units to CSS pixels.
   */
  ref?: Ref<SVGSVGElement>;
  children: ReactNode;
}

export function Drawing({
  viewBox,
  title,
  desc,
  fontSize = 11,
  role = "img",
  className,
  ref,
  children,
}: DrawingProps) {
  // useId is SSR-stable; strip the framing characters so the id is safe in url(#…).
  const uid = `d${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const arrow = fontSize * 0.62;

  return (
    <DrawingContext value={{ uid, fontSize }}>
      <svg
        ref={ref}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role={role}
        aria-label={title}
        className={cn("block h-auto w-full text-foreground", className)}
      >
        <title>{title}</title>
        {desc === undefined ? null : <desc>{desc}</desc>}
        <defs>
          <marker
            id={`${uid}-arrow`}
            markerUnits="userSpaceOnUse"
            markerWidth={arrow}
            markerHeight={arrow}
            refX={arrow}
            refY={arrow / 2}
            orient="auto-start-reverse"
          >
            <path d={`M 0 0 L ${arrow} ${arrow / 2} L 0 ${arrow} Z`} fill="var(--muted-foreground)" />
          </marker>
        </defs>
        {children}
      </svg>
    </DrawingContext>
  );
}

export interface NoteProps {
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
  baseline?: "middle" | "hanging" | "auto";
  size?: number;
  /** muted is the default drafting tone; strong is for values that carry meaning */
  tone?: "muted" | "strong";
  /** knock the page background out behind the glyphs so labels survive over lines */
  halo?: boolean;
  transform?: string;
  className?: string;
  children: ReactNode;
}

/** Every piece of text in a drawing: mono, small, muted, optionally haloed. */
export function Note({
  x,
  y,
  anchor = "start",
  baseline = "middle",
  size,
  tone = "muted",
  halo = true,
  transform,
  className,
  children,
}: NoteProps) {
  const { fontSize } = useDrawing();
  const px = size ?? fontSize;
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      dominantBaseline={baseline}
      fontSize={px}
      transform={transform}
      fill={tone === "strong" ? "var(--foreground)" : "var(--muted-foreground)"}
      stroke={halo ? "var(--background)" : undefined}
      strokeWidth={halo ? px * 0.28 : undefined}
      strokeLinejoin={halo ? "round" : undefined}
      paintOrder={halo ? "stroke" : undefined}
      className={cn("font-mono", className)}
    >
      {children}
    </text>
  );
}

/** ε with a subscript, e.g. εcu — SVG has no <sub>. */
export function Eps({ sub }: { sub: string }) {
  const { fontSize } = useDrawing();
  return (
    <>
      ε
      <tspan fontSize={fontSize * 0.74} dy={fontSize * 0.2}>
        {sub}
      </tspan>
      <tspan dy={-fontSize * 0.2}>{" "}</tspan>
    </>
  );
}
