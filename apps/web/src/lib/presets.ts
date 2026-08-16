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

import {
  GRADE60,
  GRADE80,
  GRADE420,
  GRADE550,
  type BarSize,
  type RebarGrade,
  type UnitSystem,
  type WallInput,
} from "@shear0/engine";

export const BAR_SIZES: BarSize[] = ["3", "4", "5", "6", "7", "8", "9", "10", "11"];
export const K_VALUES = [0.8, 1.0, 2.0] as const;

/**
 * The reinforcement grades the app offers, keyed by the number an engineer says
 * out loud. Grade 60/80 are ACI 318-19; Grade 420/550 are ACI 318M-19's own
 * grades, which are *not* 60 and 80 converted — they carry the metric edition's
 * E_s = 200,000 MPa and its ε_ty, so they are separate materials rather than a
 * relabelling. Bar *sizes* stay imperial (#3–#11) in both systems: this app has
 * no metric bar table, and inventing one would be worse than saying so.
 */
export const GRADES = {
  "60": GRADE60,
  "80": GRADE80,
  "420": GRADE420,
  "550": GRADE550,
} satisfies Record<string, RebarGrade>;

export type GradeId = keyof typeof GRADES;

/** Which grades belong to which edition — the select's options, in order. */
export const GRADE_IDS: Record<UnitSystem, GradeId[]> = {
  "in-lb": ["60", "80"],
  si: ["420", "550"],
};

export const GRADE_LABELS: Record<GradeId, string> = {
  "60": "Grade 60",
  "80": "Grade 80",
  "420": "Grade 420",
  "550": "Grade 550",
};

/**
 * The id of a stored grade, matched on f_y.
 *
 * Deliberately *not* an identity check against the table: `/design` decodes
 * `?w=` on the server and hands the wall to the client provider, which crosses
 * the RSC boundary as JSON — the grade arrives as a structurally identical but
 * different object, and an identity test silently reported every metric wall
 * as Grade 60. The four f_y values are 0.9 ksi apart at their closest (60 vs
 * 420 MPa = 60.92 ksi), so a tight tolerance separates them unambiguously.
 *
 * The fallback is for v1/v2 links, which carried only f_y rounded to a whole
 * ksi and where 60 and 80 were the only two grades that existed.
 */
const FY_TOL = 0.01;

export function gradeIdOf(grade: RebarGrade): GradeId {
  for (const [id, known] of Object.entries(GRADES) as [GradeId, RebarGrade][]) {
    if (Math.abs(known.fy - grade.fy) < FY_TOL) return id;
  }
  return grade.fy >= 70 ? "80" : "60";
}

/** The grade to land on when the unit system changes: same rank, other edition. */
export function equivalentGrade(grade: RebarGrade, system: UnitSystem): GradeId {
  const rank = GRADE_IDS[unitsKeyOf(grade)].indexOf(gradeIdOf(grade));
  return GRADE_IDS[system][Math.max(rank, 0)] ?? GRADE_IDS[system][0]!;
}

function unitsKeyOf(grade: RebarGrade): UnitSystem {
  const id = gradeIdOf(grade);
  return id === "420" || id === "550" ? "si" : "in-lb";
}

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
  // Labelled, because the id is the codec's business and nobody else's: without
  // these the slug `max-axial` surfaced as a card title, a chart marker, a trace
  // scope and the governing-check suffix.
  demands: [
    { id: "seismic", label: "seismic", Pu: 1015, Mu: 37200, Vu: 470, MuOut: 120, VuOut: 32 },
    { id: "max-axial", label: "max axial", Pu: 1200, Mu: 37200, Vu: 470 },
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

/** The order the presets are offered in — the only place that ordering lives. */
export const PRESET_ORDER: PresetId[] = ["example-1", "example-2", "blank"];

/** What a preset actually is. The toggle carries it as `title`; nothing else names them. */
export const PRESET_LABELS: Record<PresetId, string> = {
  "example-1": "example 1 — ordinary",
  "example-2": "example 2 — special",
  blank: "blank",
};

/**
 * The same three at toggle width. Three buttons plus a reset share a 380 px
 * column, so the full label cannot be the visible text — it arrives on hover and
 * focus instead, and this is the abbreviation, not a second name.
 */
export const PRESET_SHORT: Record<PresetId, string> = {
  "example-1": "ex 1",
  "example-2": "ex 2",
  blank: "blank",
};
