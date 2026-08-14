/**
 * /learn — the walkthrough registry.
 *
 * PLAN §4 T4a: *the trace system is the content engine*. Nothing in this file
 * computes anything. A topic names a provision, says in a few sentences what it
 * guards against and when it applies, and then hands `/learn/[slug]` a wall and
 * the engine function to run on it. The numbers on the page are whatever
 * `@kern/engine` produced — the same call `/design` makes — rendered as a fully
 * expanded trace. Fix a coefficient in the engine and the lesson changes with it.
 *
 * Plain module, no `"use client"`: the pages are server components, so the
 * checks run at build time and every value lands in the static HTML.
 *
 * Walls come from `lib/presets` — Example 1 (ordinary, Ch. 11) and Example 2
 * (special, §18.10), the same MNL-17(21) handbook walls the engine fixtures
 * assert against. A topic varies one field only where a *branch* needs showing
 * (a squat wall for αc = 3, a low-shear wall for the Table 11.6.1 path), and
 * every variation says which branch it is there to demonstrate.
 *
 * Prose here is plain text, not LaTeX: symbols read as `hw/ℓw`, `αc`, `φVn` the
 * way the rest of the app's chrome writes them. The typeset math is the
 * engine's own `formula` / `substitution`, rendered in the trace below.
 */

import {
  amplifiedShear,
  checkFlexureAxial,
  checkMinReinforcement,
  checkMinThickness,
  checkInPlaneShear,
  checkOutOfPlaneShear,
  checkSbeDetailing,
  checkSbeRequired,
  checkSimplifiedAxial,
  checkSpecialShear,
  type CheckResult,
  type CodeRef,
  type Demands,
  type WallInput,
} from "@kern/engine";
import { EXAMPLE_1, EXAMPLE_2 } from "@/lib/presets";

/**
 * The domain graphic or chart a walkthrough leads with. Each maps to a
 * context-free component from `components/design/` — the walkthrough draws the
 * same picture `/design` draws, from the same input.
 */
export type LearnVisual = "plan" | "elevation" | "strain" | "interaction" | "drift";

export interface LearnCase {
  /** stable within a topic; used as a React key and an anchor id */
  id: string;
  /** what this run is, e.g. "example 1 — hw/ℓw = 3.29" */
  label: string;
  /** why this run is here: the branch it demonstrates */
  caption: string;
  input: WallInput;
  /** the load combination the check reads, when the check takes one */
  demand?: Demands;
  /** the engine call — one check, run for real */
  run: (input: WallInput) => CheckResult;
}

export interface LearnTopic {
  slug: string;
  title: string;
  ref: CodeRef;
  group: "ordinary" | "special";
  /** one line, for the index card and the page description */
  blurb: string;
  /** 2–4 sentences: what the provision guards against, and when it applies */
  summary: string;
  /** pointers to the subtleties the trace below actually shows */
  notes: string[];
  cases: LearnCase[];
  visual?: LearnVisual;
}

const ACI = "ACI 318-19" as const;
const ref = (section: string, eq?: string): CodeRef =>
  eq === undefined ? { standard: ACI, section } : { standard: ACI, section, eq };

/** The load combination a single-demand walkthrough runs on. */
function only(w: WallInput): Demands {
  return w.demands[0];
}

/** A preset with its load combination replaced — used to move across a branch. */
function withDemand(w: WallInput, patch: Partial<Demands>): WallInput {
  return { ...w, demands: [{ ...w.demands[0], ...patch }] };
}

/** Example 1 at hw/ℓw = 1.20 — a squat wall, so αc reaches its 3.0 branch. */
const SQUAT: WallInput = withDemand(
  { ...EXAMPLE_1, geometry: { ...EXAMPLE_1.geometry, hw: 403 } },
  { id: "squat", label: "squat", Mu: 6000, Vu: 600 },
);

/** Example 1 held below the 11.6.1 threshold, so Table 11.6.1 governs. */
const LOW_SHEAR: WallInput = withDemand(EXAMPLE_1, {
  id: "low-shear",
  label: "low-shear",
  Vu: 150,
});

export const LEARN_TOPICS: LearnTopic[] = [
  {
    slug: "min-thickness",
    title: "minimum wall thickness",
    ref: ref("11.3.1.1"),
    group: "ordinary",
    blurb: "the Table 11.3.1.1 floor on h, and the slenderness it stands in for",
    summary:
      "Table 11.3.1.1 puts a floor under wall thickness: for a bearing wall, the greater of 4 in. and 1/25 of the smaller of the unsupported length and the unsupported height (1/30 for a nonbearing wall). Footnote [1] ties the bearing row to walls designed by the simplified method of 11.5.3 — the limit is what keeps that method's slenderness term meaningful, rather than a strength requirement in its own right. A thinner wall is permitted where strength and stability are demonstrated by analysis.",
    notes: [
      "the governing dimension is min(ℓu, hw), not the wall length — for Example 1 that is the 202 in. unsupported height, so h,min = 202/25 = 8.08 in.",
      "the 4 in. absolute floor sits in the trace as its own node; it only governs for very short unsupported dimensions.",
      "utilization is reported as h,min/h, so a passing wall sits below 1.0 — the same convention every other check uses.",
    ],
    visual: "plan",
    cases: [
      {
        id: "example-1",
        label: "example 1 — bearing wall, ℓu = 202 in.",
        caption: "the handbook wall: 12 in. provided against an 8.08 in. minimum.",
        input: EXAMPLE_1,
        run: checkMinThickness,
      },
    ],
  },

  {
    slug: "min-reinforcement",
    title: "minimum distributed reinforcement",
    ref: ref("11.6"),
    group: "ordinary",
    blurb: "Table 11.6.1 or Eq. (11.6.2) — the in-plane shear decides which",
    summary:
      "Every wall carries a minimum of distributed reinforcement in both directions, and the in-plane shear decides which minimum applies. At or below 0.5·φ·αc·λ·√f'c·Acv the wall is far from its shear strength and the Table 11.6.1 ratios govern — 0.0012 longitudinal and 0.0020 transverse for No. 5 and smaller Grade 60 deformed bars, essentially shrinkage-and-temperature amounts. Above that threshold 11.6.2 takes over: ρt ≥ 0.0025, and ρℓ ≥ 0.0025 + 0.5(2.5 − hw/ℓw)(ρt − 0.0025), which need not exceed the ρt required for shear strength by 11.5.4.3. The two runs below are the same wall on either side of that threshold.",
    notes: [
      "the threshold node is the whole story: 0.5 × 0.75 × αc·λ√f'c·Acv = 213.8 kip for this wall. Example 1's Vu = 235 kip clears it by 10%, which is why the handbook wall lands on the 11.6.2 path.",
      "on the 11.6.2 path ρℓ,min comes out 0 here: with hw/ℓw = 3.29 the (2.5 − hw/ℓw) term goes negative, and the requirement need not exceed the ρt required for strength — which is zero, because the concrete alone carries Vu. R11.6.2 describes the same collapse for hw/ℓw > 2.5.",
      "the required ratios are only half the check: the trace also carries the provided ρ = nc·Ab/(s·h) for each direction, and utilization is the worse of the two.",
      "the αc inside the threshold is the same node §11.5.4.3 uses — one interpolation, shared by both checks rather than restated.",
    ],
    visual: "plan",
    cases: [
      {
        id: "table",
        label: "Vu = 150 kip — below the threshold",
        caption:
          "Table 11.6.1 path: ρℓ,min = 0.0012 and ρt,min = 0.0020, read off the No. 5 / Grade 60 row.",
        input: LOW_SHEAR,
        demand: only(LOW_SHEAR),
        run: (w) => checkMinReinforcement(w, only(w)),
      },
      {
        id: "eq-11-6-2",
        label: "Vu = 235 kip — above the threshold (example 1)",
        caption: "11.6.2 path: ρt ≥ 0.0025, and Eq. (11.6.2) for ρℓ.",
        input: EXAMPLE_1,
        demand: only(EXAMPLE_1),
        run: (w) => checkMinReinforcement(w, only(w)),
      },
    ],
  },

  {
    slug: "in-plane-shear",
    title: "in-plane shear strength",
    ref: ref("11.5.4", "11.5.4.3"),
    group: "ordinary",
    blurb: "Vn = (αc·λ√f'c + ρt·fyt)·Acv, and where αc comes from",
    summary:
      "In-plane shear strength is Vn = (αc·λ·√f'c + ρt·fyt)·Acv, Eq. (11.5.4.3), with Acv = h·ℓw the gross web area — 318-19 lowered the cap from 10 to 8 precisely because Acv replaced h·d (R11.5.4.2). αc is 3 for hw/ℓw ≤ 1.5, 2 for hw/ℓw ≥ 2.0 and linearly interpolated between: a squat wall mobilizes more concrete shear than a slender one. 11.5.4.2 caps Vn at 8√f'c·Acv at any horizontal section and φ = 0.75 (Table 21.2.1); under net axial tension Eq. (11.5.4.4) reduces αc instead of the concrete term.",
    notes: [
      "example 1 is slender — hw/ℓw = 3.29 — so αc = 2 with no interpolation, and the node's own note says which branch it took.",
      "the second run shortens hw to 403 in. (hw/ℓw = 1.20) and αc jumps to 3. Between 1.5 and 2.0 the trace shows the interpolation arithmetic in place of a constant.",
      "φVn = 1,209 kip against Vu = 235 kip: the concrete term alone is 570 kip and the ρt·fyt term is the rest. This wall is nowhere near shear-controlled — which is exactly why the §11.6 threshold is the interesting check for it.",
      "hw/ℓw must be taken as the larger of the entire-wall and segment ratios (11.5.4.2); kern uses the entire-wall ratio and flags that in the αc node.",
    ],
    visual: "plan",
    cases: [
      {
        id: "slender",
        label: "example 1 — hw/ℓw = 3.29, αc = 2",
        caption: "the slender branch: αc takes its lower bound.",
        input: EXAMPLE_1,
        demand: only(EXAMPLE_1),
        run: (w) => checkInPlaneShear(w, only(w)),
      },
      {
        id: "squat",
        label: "squat variation — hw/ℓw = 1.20, αc = 3",
        caption:
          "the same wall shortened to hw = 403 in. with Vu raised to 600 kip: αc takes its upper bound.",
        input: SQUAT,
        demand: only(SQUAT),
        run: (w) => checkInPlaneShear(w, only(w)),
      },
    ],
  },

  {
    slug: "flexure-axial",
    title: "flexure and axial force (P–M)",
    ref: ref("11.5.2.1"),
    group: "ordinary",
    blurb: "the interaction surface built from the real bar layout, and φ from εt",
    summary:
      "A bearing wall is checked on the full axial–moment interaction surface rather than on moment alone: 11.5.1.1 requires φPn ≥ Pu and φMn ≥ Mu with interaction considered, and 11.5.2.1 sends the strength calculation to 22.4. kern builds the surface from the actual bar layout by strain compatibility — εcu = 0.003 at the extreme compression fiber, the equivalent rectangular stress block of 22.2.2.4, and φ from Table 21.2.2 as a function of the extreme tension strain εt — plus the φPn,max cap of 22.4.2.1. Capacity is read as the vertical slice: φMn where the design curve carries the factored Pu.",
    notes: [
      "at Pu = 1015 kip the solved neutral axis is c = 46.4 in., giving εt = 0.0185 — well past εty + 0.003, so the section is tension-controlled and φ = 0.90.",
      "φMn = 24,593 kip-ft against ACI's own interaction-diagram spreadsheet at 24,600 kip-ft: the fiber engine and the published aid agree to about 0.03%.",
      "the 22.4.2.1 axial cap is a separate limit state, reported as its own traced ratio (Pu/φPn,max = 0.11 here) rather than folded into the moment utilization.",
      "the diagram draws only the M ≥ 0 half: the bar layout is symmetric about ℓw/2, so the mirrored half carries no extra information.",
    ],
    visual: "interaction",
    cases: [
      {
        id: "example-1",
        label: "example 1 — Pu = 1015 kip, Mu = 18,600 kip-ft",
        caption: "tension-controlled at this axial load, so φ = 0.90.",
        input: EXAMPLE_1,
        demand: only(EXAMPLE_1),
        run: (w) => checkFlexureAxial(w, only(w)),
      },
    ],
  },

  {
    slug: "simplified-axial",
    title: "simplified out-of-plane axial",
    ref: ref("11.5.3", "11.5.3.1"),
    group: "ordinary",
    blurb: "Eq. (11.5.3.1), the middle-third rule, and the k table",
    summary:
      "Where the section is solid and rectangular and the factored load resultant falls within the middle third of the thickness (e ≤ h/6), 11.5.3 allows out-of-plane axial strength to come from a single expression instead of a full interaction analysis: Pn = 0.55·f'c·Ag·[1 − (k·ℓc/(32h))²], Eq. (11.5.3.1). The bracket is the slenderness knock-down, k comes from Table 11.5.3.2 (0.8 braced with a restrained end, 1.0 braced and unrestrained, 2.0 unbraced), and φ is the compression-controlled 0.65. Choosing this method is what activates the Table 11.3.1.1 minimum-thickness rows; the reinforcement still has to satisfy 11.6.",
    notes: [
      "the eligibility test is a node in the trace, not a footnote: e = Mu,oop/Pu = 0.71 in. against e,max = h/6 = 2.0 in., so the method applies. Outside the middle third the check reports n/a and the P–M path is the only honest answer.",
      "with k = 0.8 and ℓc = 202 in. the slenderness bracket costs under 1% of the squash term — this wall is stocky out of plane.",
      "φPn = 5,931 kip against Pu = 1015 kip; the handbook prints 5,920 kip for the same wall.",
      "0.55 and the 32 in the bracket are in-lb constants baked into the equation, not derived — the trace marks them as code constants carrying the section reference.",
    ],
    visual: "elevation",
    cases: [
      {
        id: "example-1",
        label: "example 1 — k = 0.8, ℓc = 202 in.",
        caption: "braced with one restrained end, resultant inside the middle third.",
        input: EXAMPLE_1,
        demand: only(EXAMPLE_1),
        run: (w) => checkSimplifiedAxial(w, only(w)),
      },
    ],
  },

  {
    slug: "out-of-plane-shear",
    title: "out-of-plane (one-way) shear",
    ref: ref("22.5.5.1"),
    group: "ordinary",
    blurb: "Table 22.5.5.1 with the size-effect factor λs and the axial term",
    summary:
      "Out-of-plane shear on a wall is ordinary one-way shear: 11.5.5.1 points straight at 22.5. With no shear reinforcement provided, the concrete strength comes from Table 22.5.5.1 row (c), Vc = (8·λs·λ·ρw^(1/3)·√f'c + Nu/(6Ag))·bw·d, where λs = √(2/(1 + d/10)) ≤ 1.0 is the 318-19 size-effect factor and the axial term is capped at 0.05f'c (22.5.5.1.2). Vc is further limited to 5·λ·√f'c·bw·d (22.5.5.1.1), √f'c is limited to 100 psi (22.5.3.1), and φ = 0.75.",
    notes: [
      "d is the out-of-plane effective depth of a 12 in. wall — 9.56 in. to the vertical bars — so λs works out to 1.0 and the size effect does not bite. It would on a thick mat-like section.",
      "ρw counts only the steel farther than 2h/3 from the compression face (R22.5.5.1); the trace shows which area was counted.",
      "axial compression is a strength bonus here (Nu positive in compression), and the trace shows the term against its 0.05f'c cap.",
      "φVc = 291 kip against Vu,oop = 16 kip — out-of-plane shear essentially never governs a shear wall, and the trace makes that visible in one line.",
    ],
    visual: "elevation",
    cases: [
      {
        id: "example-1",
        label: "example 1 — Vu,oop = 16 kip",
        caption: "no shear reinforcement, so Table 22.5.5.1 row (c) governs Vc.",
        input: EXAMPLE_1,
        demand: only(EXAMPLE_1),
        run: (w) => checkOutOfPlaneShear(w, only(w)),
      },
    ],
  },

  {
    slug: "amplified-shear",
    title: "amplified design shear Ve",
    ref: ref("18.10.3", "18.10.3.1"),
    group: "special",
    blurb: "Ve = Ωv·ωv·Vu ≤ 3Vu, and the φ = 0.60 question",
    summary:
      "A special structural wall is meant to be limited by flexural yielding, not by shear, so its design shear is amplified above the analysis value: Ve = Ωv·ωv·Vu, not more than 3Vu (18.10.3.1). Ωv is flexural overstrength from Table 18.10.3.1.2 — max(Mpr/Mu, 1.5) when hwcs/ℓw > 1.5, and 1.0 otherwise. ωv is dynamic amplification from Eq. (18.10.3.1.3) — 1.0 below hwcs/ℓw = 2.0, else 0.9 + ns/10 for ns ≤ 6 and 1.3 + ns/30 ≤ 1.8 above, with ns not taken less than 0.007·hwcs. Vn then follows 18.10.4 (the same αc form as 11.5.4.3, capped at 8√f'c·Acv across all segments sharing a lateral force), and 21.2.4.1 can pull φ down to 0.60.",
    notes: [
      "Mpr = 49,939 kip-ft comes from the same fiber section engine as φMn, but at 1.25fy and φ = 1.0 — the overstrength moment the wall can actually deliver.",
      "Mpr/Mu = 1.34 here, below the 1.5 floor, so Ωv = 1.5 governs. That floor may be reduced by a detailed analysis but never below 1.0.",
      "ns = 8 stories beats the 0.007·hwcs = 7.73 floor, so ωv = 1.3 + 8/30 = 1.567. The floor is written in inches — a unit trap the trace resolves explicitly.",
      "Ve = 1.5 × 1.567 × 470 = 1,105 kip, comfortably under the 3Vu = 1,410 kip cap.",
      "φ = 0.60: Vn = 2,049 kip is less than the shear that develops Mn, so 21.2.4.1 applies on kern's handbook-conservative default. 18.10.4.6 exempts walls designed by 18.10.6.2 from 21.2.4.1 — which reading is used is a setting, and the trace names it.",
    ],
    visual: "elevation",
    cases: [
      {
        id: "example-2",
        label: "example 2 — SDC D, 8 stories above the critical section",
        caption: "Vu = 470 kip from analysis becomes Ve = 1,105 kip for design.",
        input: EXAMPLE_2,
        demand: only(EXAMPLE_2),
        run: (w) => checkSpecialShear(w, only(w)),
      },
    ],
  },

  {
    slug: "sbe-trigger",
    title: "special boundary element trigger",
    ref: ref("18.10.6.2", "18.10.6.2a"),
    group: "special",
    blurb: "c ≥ ℓw/(600·1.5δu/hwcs) — the displacement-based path",
    summary:
      "Where the compression zone of a wall is deep and the building is pushed far, the concrete at the wall end will crush unless it is confined. For a wall with hwcs/ℓw ≥ 2.0 that is continuous from base to top with a single critical section, 18.10.6.1 selects the displacement-based trigger of 18.10.6.2: special boundary elements are required where c ≥ ℓw/(600·(1.5δu/hwcs)), with δu/hwcs not taken less than 0.005 and c the largest neutral axis depth for the factored axial force and the nominal moment strength consistent with δu. Where they are required, 18.10.6.2(b) also fixes the vertical extent — at least max(ℓw, Mu/4Vu) — and asks for either b ≥ √(0.025·c·ℓw) or the 318-19 drift-capacity check, δc/hwcs = (1/100)[4 − (1/50)(ℓw/b)(c/b) − Ve/(8√f'c·Acv)] ≥ 1.5δu/hwcs, need not be taken less than 0.015. A wall that does not qualify for this path is judged instead by extreme-fiber stress against 0.2f'c (18.10.6.3).",
    notes: [
      "δu = Cd·δe = 5 × 2.4 = 12 in., so δu/hwcs = 0.0109 — above the 0.005 floor, which the trace evaluates rather than assumes.",
      "the comparison is 1.5δu/hwcs = 0.0163 against ℓw/(600c) = 0.00825: the demand is double the limit, so special boundary elements are required, and not marginally.",
      "c = 68.7 in. is the fiber engine's neutral axis at nominal moment — the largest over the supplied load combinations, which here is the Pu = 1200 kip case rather than the seismic one. It is the same solve the P–M walkthrough shows, reused here rather than re-derived.",
      "the drift-capacity panel sweeps Eq. (18.10.6.2b) over b: the geometric term goes as 1/b², so the first inches of width buy far more capacity than the last. MNL-17 finds this by trying b = 12 in. and then b = 16 in.; the curve shows the whole trade at once.",
    ],
    visual: "drift",
    cases: [
      {
        id: "example-2",
        label: "example 2 — δu = 12 in., hwcs = 1104 in.",
        caption: "hwcs/ℓw = 3.29 ≥ 2.0, so the displacement-based path applies.",
        input: EXAMPLE_2,
        demand: only(EXAMPLE_2),
        run: (w) => checkSbeRequired(w, only(w)),
      },
    ],
  },

  {
    slug: "sbe-detailing",
    title: "special boundary element detailing",
    ref: ref("18.10.6.4"),
    group: "special",
    blurb: "length, width, hx and the Table 18.10.6.4(g) hoop amount",
    summary:
      "Once a special boundary element is required, 18.10.6.4 sizes and confines it. It runs from the extreme compression fiber a length of at least max(c − 0.1ℓw, c/2) (a); it is at least hu/16 wide over that length (b), and at least 12 in. wide where hwcs/ℓw ≥ 2.0, the wall is continuous with a single critical section, and c/ℓw ≥ 3/8 (c). Confinement follows 18.7.5.2 and 18.7.5.3 with the spacing limit taken as one-third of the least boundary dimension, laterally supported bars at hx ≤ min(14 in., 2·bbe/3) (f), and the hoop amount from Table 18.10.6.4(g): Ash/(s·bc) ≥ max(0.3(Ag/Ach − 1)·f'c/fyt, 0.09·f'c/fyt).",
    notes: [
      "this walkthrough ends ng, on purpose. kern's fiber engine solves c = 68.7 in. where ACI's spreadsheet gives 67.9 in., so 18.10.6.4(a) asks for ℓbe = 35.1 in. against the 34 in. the handbook detailed. The trace is what lets you see that it is the c solve that moved, not the detailing rule.",
      "the width check reports the governing of the two 18.10.6.2(b) options: √(0.025·c·ℓw) = 24.0 in. is not met by b = 16 in., so option (iii) carries it — drift capacity δc/hwcs = 0.0171 against a demand of 0.0163.",
      "hx = 10 in. is checked against min(14 in., 2b/3 = 10.7 in.): the 2b/3 term governs on a narrow boundary element, which is easy to miss reading only the 14 in. limit.",
      "the Ash requirement is reported as required legs against provided legs, so the answer is a number of crossties rather than an area still to be converted.",
      "the vertical extent max(ℓw, Mu/4Vu) = 336 in. is in the trace even though it is not a pass/fail on this section — it is the dimension that sets how far up the hoops run.",
    ],
    visual: "plan",
    cases: [
      {
        id: "example-2",
        label: "example 2 — 34 × 16 in. boundary element, #4 hoops @ 4 in.",
        caption: "the handbook's detailed SBE, verified against the engine's own c.",
        input: EXAMPLE_2,
        demand: only(EXAMPLE_2),
        run: (w) => checkSbeDetailing(w, only(w), amplifiedShear(w, only(w)).Ve),
      },
    ],
  },
];

export const LEARN_GROUPS: { id: LearnTopic["group"]; title: string; blurb: string }[] = [
  {
    id: "ordinary",
    title: "ordinary walls (ch. 11)",
    blurb: "what applies to any cast-in-place structural wall",
  },
  {
    id: "special",
    title: "special walls (§18.10)",
    blurb: "what SDC D–F adds: capacity design, and confined wall ends",
  },
];

export function learnTopic(slug: string): LearnTopic | undefined {
  return LEARN_TOPICS.find((topic) => topic.slug === slug);
}

export function topicsInGroup(group: LearnTopic["group"]): LearnTopic[] {
  return LEARN_TOPICS.filter((topic) => topic.group === group);
}
