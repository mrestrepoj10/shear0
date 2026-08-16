/**
 * Custom figure components for the PDF calc sheet.
 *
 * The react-pdf standard components cover text and tables; the pictures — the
 * wall plan section, the P–M interaction diagram, the utilization overview —
 * are drawn here with @react-pdf/renderer's own SVG primitives, from the same
 * engine data the on-screen charts plot. No rasterization, no headless
 * browser: the PDF's charts are vectors, computed server-side.
 *
 * Registered through `defineRegistry` and merged over the standard set by
 * `renderToBuffer(spec, { registry })`.
 */

import { defineCatalog } from "@json-render/core";
import { defineRegistry, schema } from "@json-render/react-pdf";
import { Circle, Line, Path, Rect, Svg, Text as SvgText, Text as PdfText, View } from "@react-pdf/renderer";
import { fmt } from "@shear0/engine";
import { z } from "zod";

const POINT = z.object({ x: z.number(), y: z.number() });

// Only the custom figures: the standard set (Document, Page, Table, …) stays in
// the renderer's own registry and is merged underneath this one at render time,
// and `defineRegistry` requires an implementation per catalog entry.
export const pdfCatalog = defineCatalog(schema, {
  components: {
    WallPlan: {
      // Lengths arrive in the wall's *reporting* system (in | mm), already
      // converted by `pdf-spec` — the figure is scaled relative to ℓw, so the
      // only place the system shows is the dimension line and its label.
      props: z.object({
        lw: z.number(),
        h: z.number(),
        /** bar station x-positions along ℓw */
        stations: z.array(z.number()),
        /** provided SBE length at each end — null when none */
        sbeLength: z.number().nullable(),
        lengthUnit: z.string(),
      }),
      slots: [],
      description: "Plan section of the wall with bar stations",
    },
    PmChart: {
      props: z.object({
        design: z.array(POINT),
        nominal: z.array(POINT),
        demands: z.array(
          z.object({ x: z.number(), y: z.number(), label: z.string(), ok: z.boolean() }),
        ),
        momentUnit: z.string(),
        forceUnit: z.string(),
      }),
      slots: [],
      description: "P-M interaction diagram: nominal and design surfaces with demand points",
    },
    UtilizationChart: {
      props: z.object({
        rows: z.array(
          z.object({ label: z.string(), value: z.number(), status: z.string() }),
        ),
      }),
      slots: [],
      description: "Horizontal utilization bars, one per check",
    },
  },
  actions: {},
});

const INK = "#111111";
const MUTED = "#6b7280";
const FAINT = "#d1d5db";
const NG = "#b91c1c";

/** Display cap shared with the UI's utilization bars. */
const U_CAP = 1.5;

function pathFrom(points: { px: number; py: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.px.toFixed(2)} ${p.py.toFixed(2)}`).join(" ");
}

export const { registry } = defineRegistry(pdfCatalog, {
  components: {
    WallPlan: ({ props }) => {
      const width = 460;
      const scale = width / props.lw;
      const wallH = Math.max(8, props.h * scale);
      const height = wallH + 26;
      const y0 = 4;
      return (
        <View style={{ marginTop: 6, marginBottom: 6 }}>
          <Svg width={width + 20} height={height} viewBox={`0 0 ${width + 20} ${height}`}>
            {props.sbeLength === null ? null : (
              <>
                <Rect x={10} y={y0} width={props.sbeLength * scale} height={wallH} fill="#f3f4f6" />
                <Rect
                  x={10 + width - props.sbeLength * scale}
                  y={y0}
                  width={props.sbeLength * scale}
                  height={wallH}
                  fill="#f3f4f6"
                />
              </>
            )}
            <Rect x={10} y={y0} width={width} height={wallH} stroke={INK} strokeWidth={1} fill="none" />
            {props.stations.map((x, i) => (
              <Circle
                key={i}
                cx={10 + x * scale}
                cy={y0 + wallH / 2}
                r={Math.min(2.2, wallH / 4)}
                fill={INK}
              />
            ))}
            <SvgText x={10} y={y0 + wallH + 12} style={{ fontSize: 6, fill: MUTED }}>
              {`lw = ${fmt(props.lw)} ${props.lengthUnit}  ·  h = ${fmt(props.h)} ${props.lengthUnit}  ·  ${props.stations.length} bar stations${
                props.sbeLength === null
                  ? ""
                  : `  ·  SBE ${fmt(props.sbeLength)} ${props.lengthUnit} each end (shaded)`
              }`}
            </SvgText>
          </Svg>
        </View>
      );
    },

    PmChart: ({ props }) => {
      const W = 460;
      const H = 240;
      const m = { left: 46, right: 14, top: 10, bottom: 30 };
      const all = [...props.design, ...props.nominal, ...props.demands, { x: 0, y: 0 }];
      const xMax = Math.max(...all.map((p) => p.x)) * 1.05 || 1;
      const yMin = Math.min(...all.map((p) => p.y)) * 1.05;
      const yMax = Math.max(...all.map((p) => p.y)) * 1.05 || 1;
      const sx = (x: number) => m.left + ((x - 0) / (xMax - 0)) * (W - m.left - m.right);
      const sy = (y: number) => m.top + ((yMax - y) / (yMax - yMin)) * (H - m.top - m.bottom);
      const ticks = 4;
      const xTicks = Array.from({ length: ticks + 1 }, (_, i) => (xMax / ticks) * i);
      const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) / ticks) * i);
      return (
        <View style={{ marginTop: 6, marginBottom: 2 }}>
          <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            {xTicks.map((t, i) => (
              <Line key={`x${i}`} x1={sx(t)} y1={m.top} x2={sx(t)} y2={H - m.bottom} stroke={FAINT} strokeWidth={0.5} />
            ))}
            {yTicks.map((t, i) => (
              <Line key={`y${i}`} x1={m.left} y1={sy(t)} x2={W - m.right} y2={sy(t)} stroke={FAINT} strokeWidth={0.5} />
            ))}
            {yMin < 0 ? (
              <Line x1={m.left} y1={sy(0)} x2={W - m.right} y2={sy(0)} stroke={MUTED} strokeWidth={0.75} />
            ) : null}
            <Path d={pathFrom(props.nominal.map((p) => ({ px: sx(p.x), py: sy(p.y) })))} stroke={MUTED} strokeWidth={1} strokeDasharray="4 3" fill="none" />
            <Path d={pathFrom(props.design.map((p) => ({ px: sx(p.x), py: sy(p.y) })))} stroke={INK} strokeWidth={1.5} fill="none" />
            {props.demands.map((d, i) =>
              d.ok ? (
                <Circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={3} fill={INK} />
              ) : (
                <Circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={3.5} stroke={NG} strokeWidth={1.5} fill="none" />
              ),
            )}
            {xTicks.map((t, i) => (
              <SvgText key={`xl${i}`} x={sx(t) - 8} y={H - m.bottom + 10} style={{ fontSize: 6, fill: MUTED }}>
                {fmt(t, { dp: 0 })}
              </SvgText>
            ))}
            {yTicks.map((t, i) => (
              <SvgText key={`yl${i}`} x={4} y={sy(t) + 2} style={{ fontSize: 6, fill: MUTED }}>
                {fmt(t, { dp: 0 })}
              </SvgText>
            ))}
            <SvgText x={W / 2 - 30} y={H - 6} style={{ fontSize: 7, fill: MUTED }}>
              {`M (${props.momentUnit})`}
            </SvgText>
            <SvgText x={4} y={m.top - 2} style={{ fontSize: 7, fill: MUTED }}>
              {`P (${props.forceUnit})`}
            </SvgText>
          </Svg>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 2 }}>
            <SvgLegend dash label="nominal Pn-Mn" />
            <SvgLegend label="design phiPn-phiMn" />
            <SvgLegend dot label="demand inside" />
            <SvgLegend ring label="demand outside" />
          </View>
        </View>
      );
    },

    UtilizationChart: ({ props }) => (
      <View style={{ marginTop: 4, marginBottom: 8 }}>
        {props.rows.map((row, i) => {
          const frac = Math.max(0, Math.min(row.value, U_CAP)) / U_CAP;
          const color = row.status === "ng" ? NG : INK;
          return (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
              <PdfText style={{ fontSize: 7, color: MUTED, width: 220 }}>{row.label}</PdfText>
              <View style={{ width: 180, height: 5, backgroundColor: "#e5e7eb", borderRadius: 2 }}>
                <View
                  style={{ width: `${(frac * 100).toFixed(1)}%`, height: 5, backgroundColor: color, borderRadius: 2 }}
                />
              </View>
              <PdfText style={{ fontSize: 7, color, marginLeft: 6 }}>{row.value.toFixed(3)}</PdfText>
            </View>
          );
        })}
      </View>
    ),
  },
});

function SvgLegend({ label, dash, dot, ring }: { label: string; dash?: boolean; dot?: boolean; ring?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <Svg width={16} height={8} viewBox="0 0 16 8">
        {dot ? (
          <Circle cx={8} cy={4} r={2.5} fill={INK} />
        ) : ring ? (
          <Circle cx={8} cy={4} r={2.8} stroke={NG} strokeWidth={1.2} fill="none" />
        ) : (
          <Line x1={0} y1={4} x2={16} y2={4} stroke={dash ? MUTED : INK} strokeWidth={dash ? 1 : 1.5} strokeDasharray={dash ? "3 2" : undefined} />
        )}
      </Svg>
      <PdfText style={{ fontSize: 6, color: MUTED }}>{label}</PdfText>
    </View>
  );
}
