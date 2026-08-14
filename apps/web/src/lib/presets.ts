/**
 * The walls the app can start from, plus the small vocabularies the inputs and
 * the URL codec share.
 *
 * Deliberately *not* a client module: `/design` decodes `?w=` on the server so
 * the first paint is already the shared design, and a server component may only
 * import plain modules (a `"use client"` module hands the server a reference
 * proxy, not the value). `wall-state.tsx` re-exports everything here, so client
 * code can keep importing from one place.
 */

import { GRADE60, type BarSize, type WallInput } from "@kern/engine";

export const BAR_SIZES: BarSize[] = ["3", "4", "5", "6", "7", "8", "9", "10", "11"];
export const K_VALUES = [0.8, 1.0, 2.0] as const;

/**
 * MNL-17(21) Shear Wall Example 1 — the handbook oracle the engine fixtures
 * assert against (ordinary wall, Ch. 11, all checks ok).
 */
export const EXAMPLE_1: WallInput = {
  geometry: { lw: 336, h: 12, hw: 1104, lu: 202, k: 0.8, cover: 1.5 },
  concrete: { fc: 5, lambda: 1 },
  grade: GRADE60,
  vertical: { bar: "5", spacing: 12, curtains: 2 },
  horizontal: { bar: "5", spacing: 12, curtains: 2 },
  endZone: { bar: "5", count: 4, distanceToFirst: 3, spacing: 9 },
  demands: [
    { id: "base", label: "base", Pu: 1015, Mu: 18600, Vu: 235, MuOut: 60, VuOut: 16 },
  ],
  wallType: "bearing",
  system: "ordinary",
};

/**
 * MNL-17(21) Shear Wall Example 2 — the same hotel wall in SDC D as a special
 * structural wall with a special boundary element (§18.10). Byte-for-byte the
 * engine's `test/fixtures.ts` wall, so the UI and the test suite are looking at
 * the same numbers.
 *
 * It is *not* an all-ok design: our fiber engine solves c = 68.7 in. against
 * ACI's spreadsheet 67.9 in., so 18.10.6.4(a) asks for ℓ_be = 35.1 in. where the
 * handbook detailed 34 in. That ng is real and the UI shows it.
 */
export const EXAMPLE_2: WallInput = {
  geometry: { lw: 336, h: 12, hw: 1104, hwcs: 1104, lu: 202, hu: 216, k: 0.8, cover: 1.5 },
  concrete: { fc: 5, lambda: 1 },
  grade: GRADE60,
  vertical: { bar: "8", spacing: 12, curtains: 2 },
  horizontal: { bar: "6", spacing: 12, curtains: 2 },
  endZone: { bar: "8", count: 4, distanceToFirst: 3, spacing: 9 },
  sbe: {
    width: 16,
    length: 34,
    longBar: "8",
    longCount: 10,
    hx: 10,
    tieBar: "4",
    tieSpacing: 4,
    tieLegsAcrossWidth: 3,
  },
  demands: [
    { id: "seismic", Pu: 1015, Mu: 37200, Vu: 470, MuOut: 120, VuOut: 32 },
    { id: "max-axial", Pu: 1200, Mu: 37200, Vu: 470 },
  ],
  seismic: { sdc: "D", deltaE: 2.4, Cd: 5, ns: 8, hsx: 216 },
  wallType: "bearing",
  system: "special",
};

/** A neutral wall to type over — code minimums, one empty load case. */
export const BLANK: WallInput = {
  geometry: { lw: 240, h: 12, hw: 480, lu: 120, k: 1.0, cover: 1.5 },
  concrete: { fc: 4, lambda: 1 },
  grade: GRADE60,
  vertical: { bar: "5", spacing: 12, curtains: 2 },
  horizontal: { bar: "5", spacing: 12, curtains: 2 },
  // Unlabelled on purpose: `load-1` is an internal id, and shipping it as the
  // case's name printed a slug where a name belongs. Nameless, the input shows
  // its placeholder and the results head the block with the id only.
  demands: [{ id: "load-1", Pu: 0, Mu: 0, Vu: 0 }],
  wallType: "bearing",
  system: "ordinary",
};

export const PRESETS = {
  "example-1": EXAMPLE_1,
  "example-2": EXAMPLE_2,
  blank: BLANK,
} satisfies Record<string, WallInput>;

export type PresetId = keyof typeof PRESETS;

export const PRESET_LABELS: Record<PresetId, string> = {
  "example-1": "example 1 — ordinary",
  "example-2": "example 2 — special",
  blank: "blank",
};
