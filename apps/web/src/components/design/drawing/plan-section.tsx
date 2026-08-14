"use client";

/**
 * Plan section — the hero drawing: a horizontal cut through the wall, ℓw × h to
 * one uniform scale.
 *
 * What is true to scale: the wall outline, the curtain positions (cover + db/2
 * off each face), every vertical bar station from `barPositions`, and — on a
 * special wall — the boundary elements, b × ℓbe, thickening the ends symmetric
 * about the web centerline. What is not: the bar dots themselves, which are
 * floored at a legibility radius — a #5 at 1:100 is a third of a pixel, and
 * drafters have always drawn bars oversized for exactly this reason. The
 * horizontal reinforcement shows up the way it really does in a plan cut: as the
 * two long lines the vertical bars sit on.
 *
 * Each web station is a hover/focus target: it enlarges, gets a readout, and
 * publishes a `bar-station` selection so the inputs panel can light up the row
 * that produced it. The SBE longitudinal bars are *not* stations: the engine's
 * P–M layout knows only the wall's own bars (`barPositions`), and drawing the
 * boundary cage as if it fed the interaction diagram would be a lie. They are
 * drawn hollow, and the note says so.
 */

import {
  BARS,
  barPositions,
  type BarSize,
  type BarStation,
  type SbeProvided,
  type WallInput,
} from "@kern/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSetSelection } from "@/lib/wall-state";
import { DimLine } from "./dim-line";
import { Drawing, HAIRLINE, Note, fitScale, paddedViewBox } from "./drawing";
import { dim } from "./format";

const CANVAS_W = 1000;
const MAX_WALL_H = 150;
const PAD = { top: 96, right: 154, bottom: 86, left: 84 };
const BAR_MIN_R = 3.6;
const FONT = 11;
/**
 * Smallest hit target, in CSS pixels, at any viewport — with half a pixel of
 * slack so sub-pixel layout rounding can never land the rendered rect under 24.
 */
const MIN_HIT_PX = 24.5;

/**
 * The strip each end-zone group owns, mirroring the rule `barPositions` uses to
 * drop distributed bars near the ends (outermost end-zone station + half the
 * distributed spacing). Geometry only — no engine state is duplicated.
 */
function endZoneReach(w: WallInput): number {
  const ez = w.endZone;
  if (ez === undefined || ez.count <= 0) return 0;
  const perStation = w.vertical.curtains;
  const full = Math.floor(ez.count / perStation);
  const groups = full + (ez.count - full * perStation > 0 ? 1 : 0);
  let reach = 0;
  for (let i = 0; i < groups; i++) {
    const x = ez.distanceToFirst + i * ez.spacing;
    if (x >= w.geometry.lw / 2) continue;
    reach = Math.max(reach, x);
  }
  return reach;
}

/** which input row put a station at this x */
export type StationSource = "endZone" | "vertical";

interface Station extends BarStation {
  source: StationSource;
  /** bars at this station across all curtains */
  count: number;
  bar: BarSize;
}

function sourceAt(w: WallInput, x: number, reach: number): StationSource {
  const nearEnd = x <= reach + 1e-6 || x >= w.geometry.lw - reach - 1e-6;
  return nearEnd && w.endZone?.bar !== undefined ? "endZone" : "vertical";
}

/**
 * Which reinforcement row produced the bar at this x — the one thing a consumer
 * of a `bar-station` selection needs to know, exported so nothing has to
 * re-derive it. The station positions themselves are always the engine's
 * (`barPositions`); only the end-zone *reach* is geometry, and it lives in
 * exactly one place, above.
 */
export function stationSourceAt(w: WallInput, x: number): StationSource {
  return sourceAt(w, x, endZoneReach(w));
}

function resolveStations(w: WallInput): Station[] {
  const reach = endZoneReach(w);
  const ezBar = w.endZone?.bar;
  return barPositions(w).map((st) => {
    const source = sourceAt(w, st.x, reach);
    const bar = source === "endZone" && ezBar !== undefined ? ezBar : w.vertical.bar;
    return { ...st, source, bar, count: Math.max(1, Math.round(st.area / BARS[bar].Ab)) };
  });
}

interface Point {
  x: number;
  y: number;
}

interface SbeLayout {
  /** hoop rectangle (bar centerline), world inches */
  hoop: { x0: number; y0: number; x1: number; y1: number };
  /** longitudinal bar centers, world inches */
  bars: Point[];
  /** crosstie stations across b, world x */
  crossties: number[];
  /** two adjacent long-face bars the h_x dimension is hung between */
  hxSpan: [number, number] | null;
}

/**
 * Longitudinal bars laid round the hoop perimeter: four corners, then the
 * remainder shared between the long and short faces in proportion to their
 * length. For MNL-17 Ex. 2 — 10 bars in a 16 × 34 element — that lands on four
 * per long face and one mid short face, which is exactly the detail the
 * handbook draws.
 */
function perimeterBars(n: number, hoop: SbeLayout["hoop"]): { bars: Point[]; perLongFace: number } {
  const { x0, y0, x1, y1 } = hoop;
  const Lx = Math.abs(x1 - x0);
  const Ly = Math.abs(y1 - y0);
  const corners: Point[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  if (n <= 4) return { bars: corners.slice(0, Math.max(0, n)), perLongFace: 0 };

  const rest = n - 4;
  const half = Math.floor(rest / 2);
  const weight = Lx + Ly > 0 ? Lx / (Lx + Ly) : 0.5;
  const alongLong = Math.min(half, Math.round(half * weight));
  const alongShort = half - alongLong;
  // an odd bar out goes to the near face, where the drawing reads it
  const topFace = alongLong + (rest - 2 * half);

  const bars: Point[] = [...corners];
  const face = (count: number, at: (t: number) => Point) => {
    for (let i = 0; i < count; i++) bars.push(at((i + 1) / (count + 1)));
  };
  face(topFace, (t) => ({ x: x0 + (x1 - x0) * t, y: y0 }));
  face(alongLong, (t) => ({ x: x0 + (x1 - x0) * t, y: y1 }));
  face(alongShort, (t) => ({ x: x0, y: y0 + (y1 - y0) * t }));
  face(alongShort, (t) => ({ x: x1, y: y0 + (y1 - y0) * t }));

  return { bars, perLongFace: topFace };
}

function sbeLayout(sbe: SbeProvided, cover: number, worldH: number): SbeLayout {
  const bTop = (worldH - sbe.width) / 2;
  const inset = Math.min(cover + BARS[sbe.tieBar].db / 2, sbe.width / 2, sbe.length / 2);
  const hoop = {
    x0: inset,
    y0: bTop + inset,
    x1: Math.max(inset, sbe.length - inset),
    y1: bTop + Math.max(inset, sbe.width - inset),
  };
  const { bars, perLongFace } = perimeterBars(sbe.longCount, hoop);
  const ties = Math.max(0, sbe.tieLegsAcrossWidth - 2);
  const crossties: number[] = [];
  for (let i = 0; i < ties; i++) {
    crossties.push(hoop.x0 + ((hoop.x1 - hoop.x0) * (i + 1)) / (ties + 1));
  }
  const step = (hoop.x1 - hoop.x0) / (perLongFace + 1);
  const hxSpan: [number, number] | null =
    perLongFace > 0 ? [hoop.x0, hoop.x0 + step] : null;
  return { hoop, bars, crossties, hxSpan };
}

export function WallPlanSection({ input }: { input: WallInput }) {
  const setSelection = useSetSelection();
  // Hover and keyboard focus are two different things: hovering away from a
  // station the keyboard is still sitting on must not take its highlight with
  // it. Focus wins where both are set.
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  /** rendered width of the <svg> in CSS px — 0 until it has been measured */
  const [renderedWidth, setRenderedWidth] = useState(0);
  const nodes = useRef<Array<SVGGElement | null>>([]);

  /**
   * The hit rects are sized in canvas units, so the only way to promise 24 CSS
   * pixels at 375 px as well as at 1440 is to know what one canvas unit is
   * currently worth. React 19 cleans up ref callbacks that return a function,
   * so this survives the early return below as well as any remount.
   */
  const measure = useCallback((node: SVGSVGElement | null) => {
    if (node === null) return;
    const read = () => setRenderedWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(read);
    observer.observe(node);
    read();
    return () => observer.disconnect();
  }, []);

  const { geometry, vertical, horizontal, endZone } = input;
  const { lw, h, cover } = geometry;
  const stations = resolveStations(input);

  // Shrinking the station count (a coarser spacing, a dropped end zone) must
  // never leave the cursor past the end — that is how the drawing used to go
  // permanently untabbable after `End`. Clamped at render, refs truncated with
  // it, so exactly one station is always tabbable.
  const count = stations.length;
  const cursorAt = count === 0 ? 0 : Math.min(Math.max(cursor, 0), count - 1);
  const activeIndex = focused ?? hovered;
  const active = activeIndex !== null && activeIndex < count ? activeIndex : null;

  // The published selection follows whatever is active — by x, so the effect
  // does not re-fire on every fresh `stations` array.
  const activeX = active === null ? null : (stations[active]?.x ?? null);
  useEffect(() => {
    setSelection(activeX === null ? null : { kind: "bar-station", x: activeX });
  }, [activeX, setSelection]);

  // Refs are keyed by position, so a shorter list has to shorten the array too
  // — after the ref callbacks have run, not during render.
  useEffect(() => {
    nodes.current.length = count;
  }, [count]);

  if (!(lw > 0) || !(h > 0)) {
    return (
      <p className="py-6 text-center font-mono text-xs2 text-muted-foreground">
        plan section needs ℓw and h greater than zero
      </p>
    );
  }

  // A boundary element thickens the ends, so the drawn section is as deep as the
  // widest of the two and the web sits centered in it.
  const sbe = input.system === "special" ? input.sbe : undefined;
  const sbeLen = sbe === undefined ? 0 : Math.min(sbe.length, lw / 2);
  const worldH = Math.max(h, sbe?.width ?? 0);

  const s = fitScale({ width: lw, height: worldH }, { width: CANVAS_W, height: MAX_WALL_H });
  const W = lw * s;
  const H = h * s;
  const HT = worldH * s;
  const X = (x: number) => x * s;
  const webTop = ((worldH - h) / 2) * s;
  const webBot = webTop + H;

  const db = BARS[vertical.bar].db;
  const curtainInset = Math.min(cover + db / 2, h / 2);
  const curtains =
    vertical.curtains === 1
      ? [webTop + H / 2]
      : [webTop + X(curtainInset), webBot - X(curtainInset)];
  const barR = Math.max(X(db / 2), BAR_MIN_R);

  const reach = endZoneReach(input);
  // The SBE outline supersedes the end-zone shading where both would appear.
  const ezWidth = sbe === undefined && reach > 0 ? X(reach + vertical.spacing / 2) : 0;

  const layout = sbe === undefined ? null : sbeLayout(sbe, cover, worldH);
  const sbeR = sbe === undefined ? 0 : Math.max(X(BARS[sbe.longBar].db / 2), BAR_MIN_R * 0.85);

  function moveTo(index: number) {
    const clamped = Math.max(0, Math.min(count - 1, index));
    setCursor(clamped);
    setFocused(clamped);
    nodes.current[clamped]?.focus();
  }

  /**
   * One canvas unit, in CSS pixels, at the size this drawing is actually being
   * rendered — the SVG is `w-full` with a uniform viewBox, so the whole
   * viewBox width maps onto the measured width. 0 until the first measurement.
   */
  const viewBoxWidth = W + PAD.left + PAD.right;
  const renderScale = renderedWidth > 0 ? renderedWidth / viewBoxWidth : 0;
  /** the canvas width that buys MIN_HIT_PX on screen */
  const minHit = renderScale > 0 ? MIN_HIT_PX / renderScale : 0;

  // Hit target width: half the gap to the nearer neighbour, within reason —
  // then floored so that a station is never smaller than a fingertip. At
  // 375 px with 29 stations the floor is what does the work.
  function hitWidth(i: number): number {
    const prev = stations[i - 1];
    const next = stations[i + 1];
    const here = stations[i].x;
    const gaps = [prev ? here - prev.x : Infinity, next ? next.x - here : Infinity];
    const gap = Math.min(...gaps);
    const natural = Math.max(9, Math.min(26, Number.isFinite(gap) ? X(gap) * 0.9 : 26));
    return Math.max(natural, minHit);
  }

  const typicalAt = Math.max(1, Math.floor(stations.length / 2));
  const typicalFrom = stations[typicalAt - 1];
  const typicalTo = stations[typicalAt];

  /** Both ends: the left drawing, and its mirror about ℓw/2. */
  const ends: { sign: 1 | -1; ox: number }[] = [
    { sign: 1, ox: 0 },
    { sign: -1, ox: W },
  ];

  return (
    <Drawing
      ref={measure}
      viewBox={paddedViewBox({ width: W, height: HT }, PAD)}
      fontSize={FONT}
      role="group"
      title={`plan section — wall ${dim(lw)} in long by ${dim(h)} in thick, ${stations.length} vertical bar stations${
        sbe === undefined ? "" : `, boundary elements ${dim(sbe.width)} × ${dim(sbe.length)} in`
      }`}
      desc={`Horizontal cut through the wall. ${vertical.curtains} curtain${
        vertical.curtains === 1 ? "" : "s"
      } of #${vertical.bar} vertical bars at ${dim(vertical.spacing)} in, cover ${dim(cover)} in.${
        sbe === undefined
          ? ""
          : ` Special boundary element at each end: ${dim(sbe.width)} in wide by ${dim(
              sbe.length,
            )} in long with ${sbe.longCount} #${sbe.longBar} longitudinal bars and #${sbe.tieBar} hoops at ${dim(
              sbe.tieSpacing,
            )} in.`
      }`}
    >
      {/* end-zone strips */}
      {ezWidth > 0 ? (
        <g>
          <rect
            x={0}
            y={webTop}
            width={ezWidth}
            height={H}
            fill="var(--foreground)"
            fillOpacity={0.1}
          />
          <rect
            x={W - ezWidth}
            y={webTop}
            width={ezWidth}
            height={H}
            fill="var(--foreground)"
            fillOpacity={0.1}
          />
          <g className="opacity-45">
            <line
              x1={ezWidth}
              y1={webTop}
              x2={ezWidth}
              y2={webBot}
              stroke="currentColor"
              strokeDasharray="4 3"
              {...HAIRLINE}
            />
            <line
              x1={W - ezWidth}
              y1={webTop}
              x2={W - ezWidth}
              y2={webBot}
              stroke="currentColor"
              strokeDasharray="4 3"
              {...HAIRLINE}
            />
          </g>
          <Note x={ezWidth / 2} y={webBot + 15} anchor="middle" size={9}>
            end zone
          </Note>
          <Note x={W - ezWidth / 2} y={webBot + 15} anchor="middle" size={9}>
            end zone
          </Note>
        </g>
      ) : null}

      {/* wall web */}
      <rect x={0} y={webTop} width={W} height={H} fill="var(--muted)" fillOpacity={0.6} />
      <rect
        x={0}
        y={webTop}
        width={W}
        height={H}
        fill="none"
        stroke="currentColor"
        className="opacity-80"
        {...HAIRLINE}
      />

      {/* boundary elements: the thickened ends, drawn over the web they interrupt */}
      {sbe === undefined || layout === null
        ? null
        : ends.map(({ sign, ox }) => {
            const bTop = ((worldH - sbe.width) / 2) * s;
            const bH = sbe.width * s;
            const x0 = sign === 1 ? 0 : W - X(sbeLen);
            /** world x measured from this end → canvas x (mirrored at the far end) */
            const MX = (x: number) => ox + sign * X(x);
            return (
              <g key={`sbe-${sign}`}>
                <rect
                  x={x0}
                  y={bTop}
                  width={X(sbeLen)}
                  height={bH}
                  fill="var(--muted)"
                  fillOpacity={0.9}
                />
                <rect
                  x={x0}
                  y={bTop}
                  width={X(sbeLen)}
                  height={bH}
                  fill="var(--foreground)"
                  fillOpacity={0.08}
                />
                <rect
                  x={x0}
                  y={bTop}
                  width={X(sbeLen)}
                  height={bH}
                  fill="none"
                  stroke="currentColor"
                  className="opacity-80"
                  {...HAIRLINE}
                />

                {/* hoop */}
                <rect
                  x={Math.min(MX(layout.hoop.x0), MX(layout.hoop.x1))}
                  y={X(layout.hoop.y0)}
                  width={X(layout.hoop.x1 - layout.hoop.x0)}
                  height={X(layout.hoop.y1 - layout.hoop.y0)}
                  fill="none"
                  stroke="currentColor"
                  className="opacity-70"
                  {...HAIRLINE}
                />

                {/* crossties across bc1 */}
                <g className="opacity-70">
                  {layout.crossties.map((cx) => (
                    <line
                      key={`tie-${sign}-${cx}`}
                      x1={MX(cx)}
                      y1={X(layout.hoop.y0)}
                      x2={MX(cx)}
                      y2={X(layout.hoop.y1)}
                      stroke="currentColor"
                      {...HAIRLINE}
                    />
                  ))}
                </g>

                {/* longitudinal bars — hollow: detailing, not the P–M layout */}
                <g>
                  {layout.bars.map((bar, i) => (
                    <circle
                      key={`sbe-bar-${sign}-${i}`}
                      cx={MX(bar.x)}
                      cy={X(bar.y)}
                      r={sbeR}
                      fill="var(--background)"
                      stroke="currentColor"
                      strokeWidth={1.4}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              </g>
            );
          })}

      {/* horizontal bars, seen along their length — one line per curtain */}
      <g className="opacity-35">
        {curtains.map((y, i) => (
          <line
            key={`curtain-${i}`}
            x1={X(cover)}
            y1={y}
            x2={W - X(cover)}
            y2={y}
            stroke="currentColor"
            {...HAIRLINE}
          />
        ))}
      </g>

      {/* every station spans the curtains */}
      <g className="opacity-25">
        {curtains.length > 1
          ? stations.map((st) => (
              <line
                key={`tie-${st.x}`}
                x1={X(st.x)}
                y1={curtains[0]}
                x2={X(st.x)}
                y2={curtains[curtains.length - 1]}
                stroke="currentColor"
                {...HAIRLINE}
              />
            ))
          : null}
      </g>

      {/* bars */}
      <g>
        {stations.map((st, i) =>
          curtains.map((y, c) => (
            /* `r` is a CSS-animatable geometry property, so the station grows
               instead of jumping ×1.75 between two frames. The class carries
               the transition (see `globals.css`), which is also how the global
               reduced-motion block reaches it. */
            <circle
              key={`bar-${st.x}-${c}`}
              className="station-bar"
              cx={X(st.x)}
              cy={y}
              r={active === i ? barR * 1.75 : barR}
              fill="var(--foreground)"
              fillOpacity={active === i ? 1 : 0.85}
            />
          )),
        )}
      </g>

      {/* dimensions */}
      <DimLine x1={0} y1={HT} x2={W} y2={HT} offset={54} label={dim(lw)} />
      {sbe === undefined ? (
        <DimLine x1={0} y1={webTop} x2={0} y2={webBot} offset={44} label={dim(h)} />
      ) : (
        <>
          <DimLine x1={0} y1={0} x2={0} y2={HT} offset={44} label={dim(sbe.width)} />
          <DimLine
            x1={X(sbeLen)}
            y1={webTop}
            x2={X(sbeLen)}
            y2={webBot}
            offset={-34}
            label={dim(h)}
            className="opacity-55"
          />
          <DimLine x1={0} y1={HT} x2={X(sbeLen)} y2={HT} offset={24} label={dim(sbe.length)} />
          {layout === null || layout.hxSpan === null ? null : (
            <DimLine
              x1={X(layout.hxSpan[0])}
              y1={X(layout.hoop.y0)}
              x2={X(layout.hxSpan[1])}
              y2={X(layout.hoop.y0)}
              offset={-16}
              label={`hx ${dim(sbe.hx)}`}
              className="opacity-55"
            />
          )}
          <Note x={X(sbeLen) / 2} y={HT + 40} anchor="middle" size={9}>
            SBE, typ. both ends
          </Note>
        </>
      )}

      {stations[0] !== undefined ? (
        <DimLine x1={0} y1={0} x2={X(stations[0].x)} y2={0} offset={-30} label={dim(stations[0].x)} />
      ) : null}
      {endZone !== undefined && stations[1] !== undefined && stations[0] !== undefined ? (
        <DimLine
          x1={X(stations[0].x)}
          y1={0}
          x2={X(stations[1].x)}
          y2={0}
          offset={-30}
          label={dim(stations[1].x - stations[0].x)}
        />
      ) : null}
      {typicalFrom !== undefined && typicalTo !== undefined ? (
        <DimLine
          x1={X(typicalFrom.x)}
          y1={0}
          x2={X(typicalTo.x)}
          y2={0}
          offset={-30}
          label={`${dim(typicalTo.x - typicalFrom.x)} typ`}
        />
      ) : null}

      {/* cover, measured off the far end so it never fights the bar dims */}
      {curtains.length > 1 && sbe === undefined ? (
        <>
          <DimLine
            x1={W}
            y1={webTop}
            x2={W}
            y2={curtains[0]}
            offset={-46}
            label={dim(curtainInset)}
            className="opacity-55"
          />
          <Note x={W + 54} y={webBot / 2 + 16} size={9}>
            cover {dim(cover)} + db/2
          </Note>
        </>
      ) : null}

      <Note x={0} y={HT + 34} size={9}>
        vert #{vertical.bar} @ {dim(vertical.spacing)} · {vertical.curtains} curtain
        {vertical.curtains === 1 ? "" : "s"} · horiz #{horizontal.bar} @ {dim(horizontal.spacing)} ·
        cover {dim(cover)}
      </Note>
      {sbe === undefined ? null : (
        <Note x={0} y={HT + 52} size={9}>
          SBE {dim(sbe.width)} × {dim(sbe.length)} · ({dim(sbe.longCount, 0)}) #{sbe.longBar} hollow
          — detailing only, P–M uses the wall bar layout · #{sbe.tieBar} hoops @{" "}
          {dim(sbe.tieSpacing)}, {dim(sbe.tieLegsAcrossWidth, 0)} legs ⊥ b
        </Note>
      )}

      {/* Interaction layer, last so hit areas and the readout sit on top.

          The stations are selectable data points, not actions: nothing happens
          on Enter, and announcing 29 "buttons" that do nothing was the lie. A
          listbox of options with a roving tabindex says what they are — one
          tab stop, arrows to walk them, Escape to let go. */}
      <g
        role="listbox"
        aria-label={`vertical bar stations — ${count} across the ${dim(lw)} inch wall`}
        aria-orientation="horizontal"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            moveTo(cursorAt + 1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            moveTo(cursorAt - 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            moveTo(0);
          } else if (event.key === "End") {
            event.preventDefault();
            moveTo(count - 1);
          } else if (event.key === "Escape") {
            setFocused(null);
            setHovered(null);
          }
        }}
      >
        {stations.map((st, i) => {
          const width = hitWidth(i);
          return (
            <g
              key={`hit-${st.x}`}
              ref={(node) => {
                nodes.current[i] = node;
              }}
              tabIndex={i === cursorAt ? 0 : -1}
              role="option"
              aria-selected={active === i}
              aria-label={`bar station at ${dim(st.x)} inches, ${st.count} number ${st.bar} ${
                st.source === "endZone" ? "end-zone" : "distributed"
              } bars, ${dim(st.area)} square inches`}
              className="cursor-pointer focus:outline-none"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((prev) => (prev === i ? null : prev))}
              onFocus={() => {
                setCursor(i);
                setFocused(i);
              }}
              onBlur={() => setFocused((prev) => (prev === i ? null : prev))}
            >
              <rect
                x={X(st.x) - width / 2}
                y={webTop - 8}
                width={width}
                height={H + 16}
                fill="transparent"
              />
              {active === i ? (
                <line
                  x1={X(st.x)}
                  y1={webTop - 8}
                  x2={X(st.x)}
                  y2={webBot + 8}
                  stroke="currentColor"
                  className="station-fade opacity-70"
                  {...HAIRLINE}
                />
              ) : null}
            </g>
          );
        })}

        {active === null || stations[active] === undefined ? null : (
          <StationReadout station={stations[active]} x={X(stations[active].x)} width={W} />
        )}
      </g>
    </Drawing>
  );
}

function StationReadout({
  station,
  x,
  width,
}: {
  station: Station;
  x: number;
  width: number;
}) {
  const lines = [
    `x = ${dim(station.x)} in`,
    `${station.count} × #${station.bar} · ${station.source === "endZone" ? "end zone" : "distributed"}`,
    `As = ${dim(station.area)} in²`,
  ];
  const size = 10;
  const lineH = size * 1.35;
  const padX = 8;
  const padY = 7;
  const boxW = Math.max(...lines.map((l) => l.length)) * size * 0.62 + padX * 2;
  const boxH = lines.length * lineH + padY * 2 - (lineH - size);
  const bx = Math.max(-PAD.left + 4, Math.min(width + PAD.right - boxW - 4, x - boxW / 2));
  const by = -18 - boxH;

  return (
    /* Enters with the station it belongs to: opacity 0→1 and 2 px of travel in
       130 ms, so the box arrives instead of appearing. */
    <g aria-hidden="true" pointerEvents="none" className="station-readout">
      <line x1={x} y1={-8} x2={x} y2={by + boxH} stroke="currentColor" className="opacity-50" {...HAIRLINE} />
      <rect
        x={bx}
        y={by}
        width={boxW}
        height={boxH}
        rx={4}
        fill="var(--popover)"
        stroke="currentColor"
        className="opacity-95"
        {...HAIRLINE}
      />
      {lines.map((line, i) => (
        <Note
          key={line}
          x={bx + padX}
          y={by + padY + size / 2 + i * lineH}
          size={size}
          halo={false}
          tone={i === 0 ? "strong" : "muted"}
        >
          {line}
        </Note>
      ))}
    </g>
  );
}
