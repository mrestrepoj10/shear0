"use client";

/**
 * The dimension-line primitive: two measured points, a perpendicular offset,
 * arrowheads, extension lines, and a label riding the line at its midpoint.
 *
 * Coordinates are canvas units (already scaled by the caller) so the primitive
 * knows nothing about inches. Positive `offset` moves the line along the
 * right-hand normal of p1→p2 — for a left-to-right dimension that is *down*, for
 * a top-to-bottom one it is *left*; pass a negative offset for the other side.
 */

import { HAIRLINE, Note, useDrawing } from "./drawing";

export type Arrows = "both" | "start" | "end" | "none";

export interface DimLineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** perpendicular distance from the measured points to the dimension line */
  offset?: number;
  label?: string;
  arrows?: Arrows;
  /** extension (witness) lines from the measured points out to the line */
  extensions?: boolean;
  /** put the label on the far side of the dimension line */
  labelBelow?: boolean;
  className?: string;
}

export function DimLine({
  x1,
  y1,
  x2,
  y2,
  offset = 0,
  label,
  arrows = "both",
  extensions = true,
  labelBelow = false,
  className = "opacity-55",
}: DimLineProps) {
  const { uid, fontSize } = useDrawing();
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!(len > 0.01)) return null;

  const ux = dx / len;
  const uy = dy / len;
  // right-hand normal
  const nx = -uy;
  const ny = ux;

  const ax1 = x1 + nx * offset;
  const ay1 = y1 + ny * offset;
  const ax2 = x2 + nx * offset;
  const ay2 = y2 + ny * offset;

  const sign = offset === 0 ? 1 : Math.sign(offset);
  const gap = fontSize * 0.3;
  const past = fontSize * 0.4;

  const marker = `url(#${uid}-arrow)`;
  const start = arrows === "both" || arrows === "start" ? marker : undefined;
  const end = arrows === "both" || arrows === "end" ? marker : undefined;

  // Keep the label upright whatever the line direction, and place it clear of
  // the line in the rotated frame.
  let angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  let flip = false;
  if (angle > 90 || angle < -90) {
    angle += 180;
    flip = true;
  }
  const mx = (ax1 + ax2) / 2;
  const my = (ay1 + ay2) / 2;
  const side = (labelBelow ? 1 : -1) * (flip ? -1 : 1);
  const labelDy = side * fontSize * 0.5;

  return (
    <>
      <g className={className}>
        {extensions ? (
          <>
            <line
              x1={x1 + nx * gap * sign}
              y1={y1 + ny * gap * sign}
              x2={x1 + nx * (offset + past * sign)}
              y2={y1 + ny * (offset + past * sign)}
              stroke="currentColor"
              {...HAIRLINE}
            />
            <line
              x1={x2 + nx * gap * sign}
              y1={y2 + ny * gap * sign}
              x2={x2 + nx * (offset + past * sign)}
              y2={y2 + ny * (offset + past * sign)}
              stroke="currentColor"
              {...HAIRLINE}
            />
          </>
        ) : null}

        <line
          x1={ax1}
          y1={ay1}
          x2={ax2}
          y2={ay2}
          stroke="currentColor"
          markerStart={start}
          markerEnd={end}
          {...HAIRLINE}
        />
      </g>

      {label === undefined ? null : (
        <g transform={`translate(${mx} ${my}) rotate(${angle})`}>
          <Note x={0} y={labelDy} anchor="middle" tone="strong">
            {label}
          </Note>
        </g>
      )}
    </>
  );
}
