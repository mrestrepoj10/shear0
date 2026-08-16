"use client";

/**
 * Elevation — the wall seen in its plane, hw tall by ℓw wide, with the critical
 * section (the base, where the demands are taken) called out on the ground line.
 *
 * Real shear walls are far taller than they are long, so a true-scale elevation
 * of Example 1 (hw/ℓw = 3.3) would be a ribbon. Past `MAX_ASPECT` the drawing
 * takes out the middle and marks the cut with the standard long-break symbol:
 * both remaining bands stay at the plan's honest 1:1, the dimension carries the
 * real hw, and the reader can see that a piece was removed. Reinforcement is
 * suggested, not enumerated — a sparse sample of the real stations and courses,
 * because an elevation with 29 × 92 bars on it is a grey box.
 *
 * On a special wall the elevation carries the one thing the plan cannot: the
 * *height* over which the boundary element is confined — max(ℓw, Mu/4Vu) above
 * the critical section, 18.10.6.2(b)(i) — with the close tie spacing shaded
 * below it and the relaxed spacing of Table 18.10.6.5(b) called out above.
 */

import { BARS, barPositions, kipFtToKipIn, type WallInput } from "@shear0/engine";
import { DimLine } from "./dim-line";
import { Drawing, HAIRLINE, Note, paddedViewBox } from "./drawing";
import { dim } from "./format";

const WALL_W = 300;
const MAX_ASPECT = 1.8;
const BREAK_GAP = 26;
/** share of the drawn height kept at the base, where the action is */
const BASE_SHARE = 0.62;
const PAD = { top: 30, right: 90, bottom: 74, left: 58 };
const FONT = 11;
const TARGET_VERTICALS = 7;
const TARGET_COURSES = 9;

interface Band {
  /** world elevation range, in */
  w0: number;
  w1: number;
  /** canvas y range (y0 is the lower elevation, so y0 > y1) */
  y0: number;
  y1: number;
}

function sample(values: number[], target: number): number[] {
  if (values.length <= target) return values;
  const step = Math.ceil(values.length / target);
  return values.filter((_, i) => i % step === 0 || i === values.length - 1);
}

export function WallElevation({ input }: { input: WallInput }) {
  const { geometry, vertical, horizontal } = input;
  const { lw, hw } = geometry;

  if (!(lw > 0) || !(hw > 0)) {
    return (
      <p className="py-6 text-center font-mono text-xs2 text-muted-foreground">
        elevation needs ℓw and hw greater than zero
      </p>
    );
  }

  const s = WALL_W / lw;
  const full = hw * s;
  const maxH = WALL_W * MAX_ASPECT;
  const broken = full > maxH;
  const H = broken ? maxH : full;

  // Both bands keep the plan's scale; only the middle length is missing, so the
  // canvas heights add up exactly: lower·s + gap + upper·s = H.
  const bands: Band[] = ((): Band[] => {
    if (!broken) return [{ w0: 0, w1: hw, y0: H, y1: 0 }];
    const shown = (H - BREAK_GAP) / s;
    const lower = shown * BASE_SHARE;
    const upper = shown - lower;
    const lowerTop = H - lower * s;
    return [
      { w0: 0, w1: lower, y0: H, y1: lowerTop },
      { w0: hw - upper, w1: hw, y0: lowerTop - BREAK_GAP, y1: 0 },
    ];
  })();

  /** world elevation → canvas y, or null when it lands in the removed middle */
  function Y(w: number): number | null {
    for (const b of bands) {
      if (w >= b.w0 - 1e-6 && w <= b.w1 + 1e-6) return b.y0 - (w - b.w0) * s;
    }
    return null;
  }

  const stationXs = sample(
    barPositions(input).map((st) => st.x),
    TARGET_VERTICALS,
  );

  const courses: number[] = [];
  if (horizontal.spacing > 0) {
    const total = Math.floor(hw / horizontal.spacing);
    const step = Math.max(1, Math.ceil(total / TARGET_COURSES));
    for (let i = 1; i * horizontal.spacing < hw; i += step) courses.push(i * horizontal.spacing);
  }

  const breakY = broken ? bands[0].y1 : 0;
  const breakY2 = broken ? bands[1].y0 : 0;
  const groundY = H;

  // 18.10.6.2(b)(i): the SBE transverse reinforcement runs from the critical
  // section up over max(ℓw, Mu/4Vu), taken over the supplied combinations.
  const sbe = input.system === "special" ? input.sbe : undefined;
  const extent =
    sbe === undefined
      ? 0
      : Math.max(
          lw,
          ...input.demands.map((d) =>
            Math.abs(d.Vu) > 0 ? kipFtToKipIn(Math.abs(d.Mu)) / (4 * Math.abs(d.Vu)) : 0,
          ),
        );
  // Where the extent lands above the shown part of the base band, pin it to the
  // break: the zone continues past the piece that was taken out.
  const extentY = sbe === undefined ? null : (Y(Math.min(extent, hw)) ?? bands[0].y1);
  const sbeW = sbe === undefined ? 0 : Math.min(sbe.length, lw / 2) * s;
  // Table 18.10.6.5(b), Grade 60: the relaxed spacing above the confined zone.
  const relaxed = sbe === undefined ? 0 : Math.min(8 * BARS[sbe.longBar].db, 8);

  return (
    <Drawing
      viewBox={paddedViewBox({ width: WALL_W, height: H }, PAD)}
      fontSize={FONT}
      title={`elevation — wall ${dim(hw)} in tall by ${dim(lw)} in long`}
      desc={
        broken
          ? "Wall elevation with a long-break symbol: the middle of the wall is removed so the drawing fits, both bands are at true scale."
          : "Wall elevation at true scale, critical section at the base."
      }
    >
      {/* wall body, one band per surviving piece — the edge that got cut is left
          open, because the break symbol below *is* that edge */}
      {bands.map((b, i) => {
        const cutTop = broken && i === 0;
        const cutBottom = broken && i === 1;
        return (
          <g key={`band-${i}`}>
            <rect
              x={0}
              y={b.y1}
              width={WALL_W}
              height={b.y0 - b.y1}
              fill="var(--muted)"
              fillOpacity={0.6}
            />
            <g className="opacity-80">
              <line x1={0} y1={b.y0} x2={0} y2={b.y1} stroke="currentColor" {...HAIRLINE} />
              <line
                x1={WALL_W}
                y1={b.y0}
                x2={WALL_W}
                y2={b.y1}
                stroke="currentColor"
                {...HAIRLINE}
              />
              {cutTop ? null : (
                <line x1={0} y1={b.y1} x2={WALL_W} y2={b.y1} stroke="currentColor" {...HAIRLINE} />
              )}
              {cutBottom ? null : (
                <line x1={0} y1={b.y0} x2={WALL_W} y2={b.y0} stroke="currentColor" {...HAIRLINE} />
              )}
            </g>
          </g>
        );
      })}

      {/* special boundary element: the confined zone, both ends, base up */}
      {sbe === undefined || extentY === null ? null : (
        <g>
          <rect
            x={0}
            y={extentY}
            width={sbeW}
            height={groundY - extentY}
            fill="var(--foreground)"
            fillOpacity={0.12}
          />
          <rect
            x={WALL_W - sbeW}
            y={extentY}
            width={sbeW}
            height={groundY - extentY}
            fill="var(--foreground)"
            fillOpacity={0.12}
          />
          <g className="opacity-70">
            <line
              x1={0}
              y1={extentY}
              x2={WALL_W}
              y2={extentY}
              stroke="currentColor"
              strokeDasharray="5 3"
              {...HAIRLINE}
            />
            <line x1={sbeW} y1={groundY} x2={sbeW} y2={extentY} stroke="currentColor" {...HAIRLINE} />
            <line
              x1={WALL_W - sbeW}
              y1={groundY}
              x2={WALL_W - sbeW}
              y2={extentY}
              stroke="currentColor"
              {...HAIRLINE}
            />
          </g>
          <Note x={WALL_W + 8} y={extentY - 9} size={9}>
            s ≤ {dim(relaxed)} above
          </Note>
          <Note x={WALL_W + 8} y={(groundY + extentY) / 2} size={9}>
            hoops @ {dim(sbe.tieSpacing)}
          </Note>
          <Note x={sbeW + 6} y={groundY - 10} size={9}>
            SBE {dim(sbe.width)} × {dim(sbe.length)}
          </Note>
        </g>
      )}

      {/* suggested reinforcement: a sample of stations and courses */}
      <g className="opacity-25">
        {bands.map((b, bi) =>
          stationXs.map((x) => (
            <line
              key={`v-${bi}-${x}`}
              x1={x * s}
              y1={b.y0}
              x2={x * s}
              y2={b.y1}
              stroke="currentColor"
              {...HAIRLINE}
            />
          )),
        )}
        {courses.map((w) => {
          const y = Y(w);
          return y === null ? null : (
            <line key={`h-${w}`} x1={0} y1={y} x2={WALL_W} y2={y} stroke="currentColor" {...HAIRLINE} />
          );
        })}
      </g>

      {/* long-break symbol: two S-breaks with the removed length between them */}
      {broken ? (
        <g className="opacity-80">
          <path
            d={`M 0 ${breakY} L ${WALL_W * 0.38} ${breakY} L ${WALL_W * 0.5} ${breakY - 7} L ${
              WALL_W * 0.62
            } ${breakY + 7} L ${WALL_W} ${breakY}`}
            fill="none"
            stroke="currentColor"
            {...HAIRLINE}
          />
          <path
            d={`M 0 ${breakY2} L ${WALL_W * 0.38} ${breakY2} L ${WALL_W * 0.5} ${breakY2 - 7} L ${
              WALL_W * 0.62
            } ${breakY2 + 7} L ${WALL_W} ${breakY2}`}
            fill="none"
            stroke="currentColor"
            {...HAIRLINE}
          />
        </g>
      ) : null}
      {broken ? (
        <Note x={WALL_W + 8} y={(breakY + breakY2) / 2} size={9}>
          break
        </Note>
      ) : null}

      {/* ground line + critical section at the base — the one heavy line in the
          drawing, because it is where every demand is taken */}
      <line
        x1={-22}
        y1={groundY}
        x2={WALL_W + 22}
        y2={groundY}
        stroke="currentColor"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <g className="opacity-45">
        {Array.from({ length: 13 }, (_, i) => {
          const x = -18 + i * ((WALL_W + 36) / 12);
          return (
            <line
              key={`hatch-${i}`}
              x1={x}
              y1={groundY}
              x2={x - 7}
              y2={groundY + 7}
              stroke="currentColor"
              {...HAIRLINE}
            />
          );
        })}
      </g>
      <Note x={-22} y={groundY + 21} size={9}>
        critical section
      </Note>

      {/* dimensions: ℓw across the base, hw up the right side (broken to match) */}
      <DimLine x1={0} y1={groundY} x2={WALL_W} y2={groundY} offset={44} label={dim(lw)} />
      {sbe === undefined || extentY === null ? null : (
        <DimLine
          x1={0}
          y1={groundY}
          x2={0}
          y2={extentY}
          offset={-34}
          label={dim(Math.min(extent, hw))}
          className="opacity-70"
        />
      )}
      {broken ? (
        <>
          <DimLine
            x1={WALL_W}
            y1={groundY}
            x2={WALL_W}
            y2={breakY}
            offset={40}
            arrows="start"
            label={undefined}
          />
          <DimLine
            x1={WALL_W}
            y1={breakY2}
            x2={WALL_W}
            y2={0}
            offset={40}
            arrows="end"
            label={dim(hw)}
          />
        </>
      ) : (
        <DimLine x1={WALL_W} y1={groundY} x2={WALL_W} y2={0} offset={40} label={dim(hw)} />
      )}

      <Note x={0} y={groundY + 62} size={9}>
        hw/ℓw {dim(hw / lw, 2)} · vert #{vertical.bar} @ {dim(vertical.spacing)} · horiz #
        {horizontal.bar} @ {dim(horizontal.spacing)} (shown sparse)
        {sbe === undefined
          ? ""
          : ` · SBE confined to ${dim(Math.min(extent, hw))} above the base [18.10.6.2(b)]`}
      </Note>
    </Drawing>
  );
}
