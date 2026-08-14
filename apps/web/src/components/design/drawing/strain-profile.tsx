"use client";

/**
 * Strain profile — the governing flexure slice, drawn.
 *
 * `designSliceAt(input, Pu)` returns the neutral-axis depth the fiber engine
 * settled on for this axial load, and everything here is that one number made
 * visible: plane sections stay plane, so the strain diagram is the straight line
 * from εcu = 0.003 at the compression face (x = 0) through zero at x = c to εt at
 * the extreme tension bar. The shaded strip on the section is the equivalent
 * rectangular stress block a = β1·c, and φ is the Table 21.2.2 value that εt
 * bought. Nothing is recomputed here — the drawing reads the slice.
 */

import { barPositions, beta1, designSliceAt, type WallInput } from "@kern/engine";
import { DimLine } from "./dim-line";
import { Drawing, Eps, HAIRLINE, Note, paddedViewBox } from "./drawing";
import { dim, strain } from "./format";

const WALL_W = 420;
const MIN_T = 9;
const GAP = 52;
const AMPLITUDE = 58;
const PAD = { top: 76, right: 104, bottom: 44, left: 80 };
const FONT = 11;
const EPS_CU = 0.003;

export function StrainProfile({ input, Pu }: { input: WallInput; Pu: number }) {
  const { lw, h } = input.geometry;
  const slice = lw > 0 && h > 0 ? designSliceAt(input, Pu) : undefined;

  if (slice === undefined) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-6 text-center">
        <p className="font-mono text-xs2 text-muted-foreground">no governing slice</p>
        <p className="max-w-64 font-mono text-xs2 text-muted-foreground/70">
          the section cannot equilibrate Pu = {dim(Pu, 0)} kip — there is no neutral-axis depth to
          draw
        </p>
      </div>
    );
  }

  const stations = barPositions(input);
  const xt = stations.length > 0 ? stations[stations.length - 1].x : lw;
  const s = WALL_W / lw;
  const T = Math.max(h * s, MIN_T);
  const Y0 = T + GAP;
  const a = Math.min(beta1(input.concrete).value * slice.c, lw);

  const emax = Math.max(EPS_CU, slice.epsT, 1e-9);
  const yTop = Y0 - (EPS_CU / emax) * AMPLITUDE;
  const yBot = Y0 + (slice.epsT / emax) * AMPLITUDE;
  const cX = Math.min(slice.c, lw) * s;
  const tX = xt * s;

  const height = Math.max(Y0 + AMPLITUDE * 0.75, yBot) + 6;

  return (
    <Drawing
      viewBox={paddedViewBox({ width: WALL_W, height }, PAD)}
      fontSize={FONT}
      title={`strain profile — neutral axis at c = ${dim(slice.c, 1)} in, εt = ${strain(slice.epsT)}, φ = ${dim(slice.phi, 2)}`}
      desc={`Linear strain from 0.003 at the compression face through zero at the neutral axis to ${strain(
        slice.epsT,
      )} at the extreme tension bar, with the a = β1·c stress block shaded.`}
    >
      {/* the section, seen edge-on, compression face at x = 0 */}
      <rect x={0} y={0} width={WALL_W} height={T} fill="var(--muted)" fillOpacity={0.6} />
      <rect x={0} y={0} width={a * s} height={T} fill="var(--foreground)" fillOpacity={0.22} />
      <rect
        x={0}
        y={0}
        width={WALL_W}
        height={T}
        fill="none"
        stroke="currentColor"
        className="opacity-80"
        {...HAIRLINE}
      />

      {/* bar stations on the section line */}
      <g className="opacity-40">
        {stations.map((st) => (
          <line
            key={`st-${st.x}`}
            x1={st.x * s}
            y1={T * 0.22}
            x2={st.x * s}
            y2={T * 0.78}
            stroke="currentColor"
            {...HAIRLINE}
          />
        ))}
      </g>
      <circle cx={tX} cy={T / 2} r={3} fill="var(--foreground)" />

      {/* a = β1·c and c, dimensioned off the compression face */}
      <DimLine x1={0} y1={0} x2={a * s} y2={0} offset={-24} label={`a = ${dim(a, 1)}`} />
      <DimLine x1={0} y1={0} x2={cX} y2={0} offset={-48} label={`c = ${dim(slice.c, 1)}`} />

      {/* neutral axis */}
      <g className="opacity-70">
        <line
          x1={cX}
          y1={-56}
          x2={cX}
          y2={Y0 + 18}
          stroke="currentColor"
          strokeDasharray="6 4"
          {...HAIRLINE}
        />
      </g>
      <Note x={cX + 5} y={Y0 + 14} size={9}>
        N.A.
      </Note>

      {/* zero-strain baseline */}
      <g className="opacity-45">
        <line x1={0} y1={Y0} x2={WALL_W} y2={Y0} stroke="currentColor" {...HAIRLINE} />
      </g>

      {/* the strain diagram itself */}
      <polygon points={`0,${Y0} 0,${yTop} ${cX},${Y0}`} fill="var(--foreground)" fillOpacity={0.14} />
      <polygon
        points={`${cX},${Y0} ${tX},${yBot} ${tX},${Y0}`}
        fill="var(--foreground)"
        fillOpacity={0.08}
      />
      <line x1={0} y1={yTop} x2={tX} y2={yBot} stroke="currentColor" {...HAIRLINE} />
      <g className="opacity-60">
        <line x1={0} y1={Y0} x2={0} y2={yTop} stroke="currentColor" {...HAIRLINE} />
        <line x1={tX} y1={Y0} x2={tX} y2={yBot} stroke="currentColor" {...HAIRLINE} />
      </g>

      <Note x={6} y={yTop - 9} tone="strong">
        <Eps sub="cu" />= {strain(EPS_CU)}
      </Note>
      <Note x={tX - 6} y={yBot + 11} anchor="end" tone="strong">
        <Eps sub="t" />= {strain(slice.epsT)}
      </Note>

      <Note x={0} y={T + 15} size={9}>
        compression face
      </Note>
      <Note x={tX} y={T + 15} anchor="end" size={9}>
        extreme tension bar
      </Note>

      <Note x={WALL_W} y={-62} anchor="end" tone="strong">
        φ = {slice.phi.toFixed(2)}
      </Note>
      <Note x={WALL_W} y={-46} anchor="end" size={9}>
        Pu {dim(Pu, 0)} kip · φMn {dim(slice.phiMn, 0)} kip-ft
      </Note>
    </Drawing>
  );
}
