/**
 * The URL is the save file — this is its codec.
 *
 * A `WallInput` is packed into positional arrays (short and stable), JSON'd, and
 * base64url'd into `?w=`. There is no backend and no account: a design is a
 * link. The payload is versioned, and *old versions keep decoding* — v1 links
 * predate §18.10 support, so they fill the special-wall fields with defaults and
 * land on the ordinary path exactly as they did before.
 *
 * Plain module, no `"use client"`: `/design` decodes on the server so a shared
 * link renders the right wall in the first HTML. The React hook that keeps the
 * URL in step lives in `url-state.ts`.
 *
 * ### v2 payload (positional)
 * ```
 * v  2
 * g  [lw, h, hw, lu, k, cover, hu|null, hwcs|null]     v1: first 6 only
 * m  [f'c psi, λ, fy ksi]
 * vr [bar, spacing, curtains]                          vertical layer
 * hz [bar, spacing, curtains]                          horizontal layer
 * ez [bar, count, distanceToFirst, spacing] | null     end-zone bars
 * d  [[id, label, Pu, Mu, Vu, MuOut|null, VuOut|null], …]
 * wt "b" | "n"                                         bearing / nonbearing
 * sy "o" | "s"                                         ordinary / special      (v2)
 * sm [sdc, δe|null, Cd|null, ns|null, hsx|null] | null seismic params          (v2)
 * sb [b, ℓbe, longBar, longCount, hx, tieBar, s, legs] | null   provided SBE   (v2)
 * pr "h" | "e" | null                                  φ reading, 21.2.4.1     (v2)
 * ```
 */

import {
  GRADE60,
  GRADE80,
  type BarSize,
  type Demands,
  type SbeProvided,
  type SeismicParams,
  type WallInput,
} from "@kern/engine";
import { BAR_SIZES, EXAMPLE_1 } from "./presets";

export const WALL_PARAM = "w";
export const PAYLOAD_VERSION = 2;

/** [lw, h, hw, lu, k, cover, hu?, hwcs?] */
type GeometryTuple = [number, number, number, number, number, number, ...(number | null)[]];
/** [f'c psi, λ, fy ksi] */
type MaterialTuple = [number, number, number];
/** [bar, spacing, curtains] */
type LayerTuple = [string, number, number];
/** [bar, count, distanceToFirst, spacing] */
type EndZoneTuple = [string, number, number, number];
/** [id, label, Pu, Mu, Vu, MuOut|null, VuOut|null] */
type DemandTuple = [string, string, number, number, number, number | null, number | null];
/** [sdc, δe|null, Cd|null, ns|null, hsx|null] */
type SeismicTuple = [string, number | null, number | null, number | null, number | null];
/** [width, length, longBar, longCount, hx, tieBar, tieSpacing, tieLegsAcrossWidth] */
type SbeTuple = [number, number, string, number, number, string, number, number];

interface Payload {
  v: number;
  g: GeometryTuple;
  m: MaterialTuple;
  vr: LayerTuple;
  hz: LayerTuple;
  ez: EndZoneTuple | null;
  d: DemandTuple[];
  wt: "b" | "n";
  sy: "o" | "s";
  sm: SeismicTuple | null;
  sb: SbeTuple | null;
  pr: "h" | "e" | null;
}

function toPayload(w: WallInput): Payload {
  const s = w.seismic;
  const sbe = w.sbe;
  return {
    v: PAYLOAD_VERSION,
    g: [
      w.geometry.lw,
      w.geometry.h,
      w.geometry.hw,
      w.geometry.lu,
      w.geometry.k,
      w.geometry.cover,
      w.geometry.hu ?? null,
      w.geometry.hwcs ?? null,
    ],
    m: [w.concrete.fc * 1000, w.concrete.lambda, w.grade.fy],
    vr: [w.vertical.bar, w.vertical.spacing, w.vertical.curtains],
    hz: [w.horizontal.bar, w.horizontal.spacing, w.horizontal.curtains],
    ez: w.endZone
      ? [w.endZone.bar, w.endZone.count, w.endZone.distanceToFirst, w.endZone.spacing]
      : null,
    d: w.demands.map((d) => [
      d.id,
      d.label ?? "",
      d.Pu,
      d.Mu,
      d.Vu,
      d.MuOut ?? null,
      d.VuOut ?? null,
    ]),
    wt: w.wallType === "bearing" ? "b" : "n",
    sy: w.system === "special" ? "s" : "o",
    sm: s ? [s.sdc, s.deltaE ?? null, s.Cd ?? null, s.ns ?? null, s.hsx ?? null] : null,
    sb: sbe
      ? [
          sbe.width,
          sbe.length,
          sbe.longBar,
          sbe.longCount,
          sbe.hx,
          sbe.tieBar,
          sbe.tieSpacing,
          sbe.tieLegsAcrossWidth,
        ]
      : null,
    pr:
      w.phiSeismicReading === undefined
        ? null
        : w.phiSeismicReading === "exempt-18.10.4.6"
          ? "e"
          : "h",
  };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function num(v: unknown, fallback: number): number {
  return isNum(v) ? v : fallback;
}

/**
 * Dimensions a crafted link must not be able to zero out: the bar-layout walk
 * steps by `spacing`, so a zero would never terminate. The §18.10 additions have
 * their own: a zero SBE width divides in Eq. (18.10.6.2b), a zero h_x divides in
 * the 18.7.5.3 s_o term.
 */
function positive(v: unknown, fallback: number): number {
  return isNum(v) && v > 0 ? v : fallback;
}

/** An optional positive length: absent, or a real number greater than zero. */
function optionalPositive(v: unknown): number | undefined {
  return isNum(v) && v > 0 ? v : undefined;
}

/** An optional non-negative quantity (C_d, n_s, δ_e). */
function optionalNonNegative(v: unknown): number | undefined {
  return isNum(v) && v >= 0 ? v : undefined;
}

function barSize(v: unknown, fallback: BarSize): BarSize {
  return isStr(v) && (BAR_SIZES as string[]).includes(v) ? (v as BarSize) : fallback;
}

function curtains(v: unknown): 1 | 2 {
  return v === 1 ? 1 : 2;
}

function kFactor(v: unknown): 0.8 | 1.0 | 2.0 {
  return v === 0.8 ? 0.8 : v === 2 ? 2.0 : 1.0;
}

const SDCS = ["A", "B", "C", "D", "E", "F"] as const;

function sdc(v: unknown): SeismicParams["sdc"] {
  return isStr(v) && (SDCS as readonly string[]).includes(v) ? (v as SeismicParams["sdc"]) : "D";
}

/** Structural validation with per-field fallback — a mangled link degrades, it never throws. */
function fromPayload(raw: unknown): WallInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Partial<Payload>;
  if (p.v !== 1 && p.v !== PAYLOAD_VERSION) return null;
  if (!Array.isArray(p.g) || !Array.isArray(p.m) || !Array.isArray(p.vr) || !Array.isArray(p.hz)) {
    return null;
  }
  if (!Array.isArray(p.d)) return null;

  const d0 = EXAMPLE_1;
  const demands: Demands[] = p.d
    .filter((t): t is DemandTuple => Array.isArray(t) && t.length >= 5)
    .map((t, i) => {
      const demand: Demands = {
        id: isStr(t[0]) && t[0].length > 0 ? t[0] : `load-${i + 1}`,
        Pu: num(t[2], 0),
        Mu: num(t[3], 0),
        Vu: num(t[4], 0),
      };
      if (isStr(t[1]) && t[1].length > 0) demand.label = t[1];
      if (isNum(t[5])) demand.MuOut = t[5];
      if (isNum(t[6])) demand.VuOut = t[6];
      return demand;
    });
  if (demands.length === 0) return null;

  const fcPsi = num(p.m[0], 5000);
  if (fcPsi <= 0) return null;

  const input: WallInput = {
    geometry: {
      lw: positive(p.g[0], d0.geometry.lw),
      h: positive(p.g[1], d0.geometry.h),
      hw: positive(p.g[2], d0.geometry.hw),
      lu: positive(p.g[3], d0.geometry.lu),
      k: kFactor(p.g[4]),
      cover: num(p.g[5], d0.geometry.cover),
    },
    concrete: { fc: fcPsi / 1000, lambda: positive(p.m[1], 1) },
    grade: num(p.m[2], 60) === 80 ? GRADE80 : GRADE60,
    vertical: {
      bar: barSize(p.vr[0], d0.vertical.bar),
      spacing: positive(p.vr[1], d0.vertical.spacing),
      curtains: curtains(p.vr[2]),
    },
    horizontal: {
      bar: barSize(p.hz[0], d0.horizontal.bar),
      spacing: positive(p.hz[1], d0.horizontal.spacing),
      curtains: curtains(p.hz[2]),
    },
    demands,
    wallType: p.wt === "n" ? "nonbearing" : "bearing",
    system: p.sy === "s" ? "special" : "ordinary",
  };

  // v1 links stop here: no hu/hwcs in the tuple, no seismic block, no SBE.
  const hwcs = optionalPositive(p.g[7]);
  if (hwcs !== undefined) input.geometry.hwcs = hwcs;
  const hu = optionalPositive(p.g[6]);
  if (hu !== undefined) input.geometry.hu = hu;

  const ez = p.ez;
  if (Array.isArray(ez) && ez.length >= 4) {
    input.endZone = {
      bar: barSize(ez[0], input.vertical.bar),
      count: Math.max(0, num(ez[1], 0)),
      distanceToFirst: Math.max(0, num(ez[2], 3)),
      spacing: positive(ez[3], 9),
    };
  }

  const sm = p.sm;
  if (Array.isArray(sm) && sm.length >= 1) {
    const seismic: SeismicParams = { sdc: sdc(sm[0]) };
    const deltaE = optionalNonNegative(sm[1]);
    if (deltaE !== undefined) seismic.deltaE = deltaE;
    const Cd = optionalNonNegative(sm[2]);
    if (Cd !== undefined) seismic.Cd = Cd;
    const ns = optionalNonNegative(sm[3]);
    if (ns !== undefined) seismic.ns = ns;
    const hsx = optionalPositive(sm[4]);
    if (hsx !== undefined) seismic.hsx = hsx;
    input.seismic = seismic;
  }

  const sb = p.sb;
  if (Array.isArray(sb) && sb.length >= 8) {
    const provided: SbeProvided = {
      width: positive(sb[0], input.geometry.h),
      length: positive(sb[1], input.geometry.h * 2),
      longBar: barSize(sb[2], input.vertical.bar),
      longCount: Math.max(0, num(sb[3], 0)),
      hx: positive(sb[4], 10),
      tieBar: barSize(sb[5], "4"),
      tieSpacing: positive(sb[6], 4),
      tieLegsAcrossWidth: Math.max(0, num(sb[7], 0)),
    };
    input.sbe = provided;
  }

  if (p.pr === "e") input.phiSeismicReading = "exempt-18.10.4.6";
  else if (p.pr === "h") input.phiSeismicReading = "handbook-conservative";

  return input;
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeWallInput(w: WallInput): string {
  return toBase64Url(JSON.stringify(toPayload(w)));
}

export function decodeWallInput(encoded: string): WallInput | null {
  try {
    return fromPayload(JSON.parse(fromBase64Url(encoded)));
  } catch {
    return null;
  }
}
