# shear0 — Implementation Plan

Open-source concrete shear wall design tool per ACI 318-19. Fast, visual, and **never a black box**:
every number the app produces carries a machine-readable trace back to the code section, formula,
and substituted values that produced it.

Companion docs (read these before implementing any check):
- `docs/research/aci-318-19-wall-provisions.md` — the provision/equation inventory (implementation spec)
- `docs/research/mnl-17-shear-wall-examples.md` — the two handbook worked examples (test oracle)
- Source PDFs in `references/` (gitignored — copyrighted, never commit)

---

## 1. Product scope

### MVP (Phases 0–2): ordinary walls, single critical section
A designer enters one rectangular wall (geometry, materials, rebar layout, factored demands at the
critical section) and gets, live as they type:
- **Checks per ACI 318 Ch. 11**: minimum thickness, minimum distributed reinforcement + spacing +
  curtain count (11.6/11.7), in-plane shear φVn vs Vu (11.5.4), P–M interaction from a fiber section
  engine (22.2/22.4, φ per 21.2.2), simplified out-of-plane axial (11.5.3), out-of-plane shear (22.5).
- **Visuals**: wall plan section with true-scale rebar layout, elevation, P–M interaction diagram with
  demand points, utilization summary.
- **Trace**: expandable step-by-step calculation report for every check, with code references and
  rendered math.

### Phase 3: special structural walls (SDC D/E/F, §18.10)
Amplified shear Ve = Ωv·ωv·Vu, seismic φ logic (21.2.4.1 / 18.10.4.6), displacement-based and
stress-based boundary element triggers (18.10.6.2/.3), SBE sizing + confinement detailing
(18.10.6.4/.5), seismic web reinforcement rules (18.10.2, 18.10.4.3).

### Phase 4: learn mode, OSS hygiene, deploy

### Explicitly out of scope (for now — tracked, not planned)
Coupling beams (18.10.7), wall piers (18.10.8), walls with openings / multiple segments, flanged
sections (T/L/C/I), multi-story envelope along height, load-combination generation (users enter
factored demands), slender out-of-plane method (11.8), shear friction (22.9), prestressed/precast
walls. (SI is no longer on this list — see Units below.)

---

## 2. Architecture

```
shear0/
├── apps/web              # Next.js 16.3 SPA (client-heavy, App Router)
├── packages/engine       # @shear0/engine — pure TypeScript, zero deps, framework-free
├── docs/research         # extracted specs + fixtures source (committed)
└── references            # source PDFs (gitignored)
```

### `packages/engine` — the core product
Pure TS library, no DOM, no React, no runtime deps. Everything the UI shows is computed here.
Published intent: usable standalone (`import { checkWall } from '@shear0/engine'`) so the OSS
community can build CLIs/plugins on it.

**Trace-first value model.** Engine functions do not return bare numbers; they return trace nodes:

```ts
interface Traced<T = number> {
  id: string;              // stable slug, e.g. "shear.vn.alpha_c"
  symbol: string;          // "α_c"
  label: string;           // "shear strength coefficient"
  value: T;
  unit: Unit;              // "kip" | "psi" | "in" | "1" | ...
  formula?: string;        // LaTeX template: "\\alpha_c = 2 \\text{ for } h_w/\\ell_w \\ge 2"
  substitution?: string;   // LaTeX with numbers substituted
  ref?: CodeRef;           // { standard: "ACI 318-19", section: "11.5.4.3", eq?: "11.5.4.3" }
  inputs: Traced[];        // dependency DAG — this is the whole no-black-box story
  status?: "ok" | "ng" | "warning" | "na";
  note?: string;           // commentary, e.g. "linear interpolation between 1.5 and 2.0"
}
```

Checks compose these into a `CheckResult` (id, title, governing demand/capacity, utilization,
status, trace root). The UI renders the DAG as an expandable report; `mathText(node)` renders
LaTeX via KaTeX on the client. Tests assert on `value`s; snapshot tests pin the trace shape.

**Units.** Internal canonical system = **US customary (kip, in, ksi)** — it matches the ACI in-lb
coefficient set and the handbook oracle, and *storage never leaves it in either mode*. `WallInput.
units` selects the edition instead: each formula site branches to the ACI 318M-19 expression and
evaluates it in MPa/mm/N, so SI is a second coefficient set rather than a display conversion (0.17
is not 2/12.1, 4700 is not 57000/12.1). `unitScheme()` in `units.ts` is the per-system vocabulary
every check and trace reads. The web app wraps it in `lib/units-view.ts` for field labels and the
inverse conversions, and takes every factor from the engine's `convert()`. No unit library
dependency. Known gap: bar sizes are imperial (#3–#11) in both systems.

**Performance.** All checks including a 400-point fiber P–M curve run in well under 16 ms — compute
synchronously on every input change (no debounce, no worker, no server). This is what makes the app
feel like an instrument.

### `apps/web` — SPA per the official Next.js 16.3 SPA guide
- `/design` is a `"use client"` page tree; **all calculation happens client-side** — the engine ships
  to the browser, nothing leaves the tab (privacy sell for engineers, works offline-ish).
- **URL is the save file**: wall definition serialized into the query string (compact base64 JSON)
  via native `pushState` shallow routing → shareable/bookmarkable designs, no backend, no accounts.
- State: single `WallInput` object in a `useReducer` + context (no state library until it hurts).
- Keep server rendering for `/` and `/learn` (static, SEO). Turn on `cacheComponents` +
  `partialPrefetching` ("Instant Navigations") once things work — not before.

### Charts & visualization strategy
Two different problems, two tools:
1. **Domain graphics** (wall plan section with rebar, elevation with SBE zones, strain profile):
   hand-written **React SVG components**. No chart library does true-to-scale engineering drawings
   well, and these are the soul of the app. Shared `<Drawing>` scaffold (viewBox scaling,
   dimension-line primitives, theme-aware tokens from `--chart-*` / `--muted-foreground`).
2. **XY charts** (P–M interaction diagram, utilization bars, later drift-capacity curves):
   **TanStack Charts** (`@tanstack/react-charts` v0.x — the new official grammar, verified current
   Aug 2026). ⚠️ It is **pre-alpha**; we accept that risk deliberately because this is a greenfield
   OSS project, but we contain it: pin the exact version, and route every usage through our own
   `apps/web/src/components/charts/*` wrappers so a swap to Recharts v3 (what shadcn charts wrap)
   is a contained change. **Escape hatch rule:** if TanStack Charts can't do demand-point overlays +
   hover tooltips on the P–M diagram within one task's effort, the implementing agent falls back to
   custom SVG for that chart and says so — the interaction diagram is too important to fight a
   pre-alpha API for.

### Visual & interaction design (preserve current style)
Geist Sans + Geist Mono, `font-mono` body, monochrome oklch palette, `max-w-5xl`, lowercase
navbar, sparse Vercel-lab aesthetic. Dark mode is first-class (engineers at night). Status colors:
introduce exactly two accents on top of the monochrome scheme — ok (green) and ng (red), defined
as CSS variables in `globals.css`, used only for check outcomes. Numbers in tables/traces always
`font-mono` with fixed decimals and units.

---

## 3. Verification strategy (the handbook oracle)

- **Fixtures**: the two MNL-17(21) examples (`docs/research/mnl-17-shear-wall-examples.md`).
  Every printed intermediate becomes an assertion — Ex. 1: 14 asserted values (αc=2, Vn=570 kip,
  φVn=428 kip, threshold 214 kip, ρ=0.0043, Pn=9120 kip, φPn=5920 kip, …); Ex. 2: ~30 asserted
  values (Ωv=1.5, ωv=1.57, Ve=1107 kip, Vn=2045 kip, φ=0.6, SBE trigger 0.0163 vs 0.00825,
  drift capacity 0.0035/0.0173, SBE 34×16 in., Ash ratio 0.00875, ℓdh=7.1 in., …).
- **Tolerances**: hand-calc steps ±0.5% (handbook rounds); values from ACI's interaction-diagram
  Excel aid (φMn = 24,600 / 40,200 ft-kip; Mpr = 51,900 ft-kip; c = 67.9 in.) ±2% for our fiber
  engine, and additionally cross-check the fiber engine against closed-form anchors (pure axial
  Po/0.80Po, pure bending of a known section, balanced point) at ±0.1%.
- **Unit tests** per provision (each αc branch, each table row, each trigger boundary) — test at
  the boundaries (hw/lw = 1.5, 2.0, 2.5; Vu just above/below thresholds).
- **Trace integrity tests**: every `CheckResult` trace DAG is acyclic, every leaf is an input or a
  constant with a `ref`, every non-leaf has `formula` + `substitution`.
- **Source verification**: all formerly ambiguous provisions from the SI scan were verified verbatim
  against the official English in-lb edition (`references/aci-318-19-english.pdf`, now the primary
  reference) — 0.5 threshold in 11.6, `Ve/(8√f'c·Acv)` in the drift-capacity equation, ns floor,
  18.10.4.6 φ exemption, and 318-19 section numbering (18.10.9 = ductile coupled walls,
  18.10.10 = construction joints, 18.10.11 = discontinuous walls). No open source flags remain.
- Vitest workspace at repo root; `turbo test` wired into CI (GitHub Actions: lint, typecheck, test,
  build on PR).

---

## 4. Work breakdown (orchestrated subagent tasks)

Execution model: I orchestrate; each task below goes to a **fresh-context Opus 5 subagent** with a
self-contained prompt (files to read: this plan + relevant research doc + the exact target paths;
explicit acceptance criteria; "run `pnpm typecheck && pnpm test` before returning"). Tasks in the
same phase-row can run in parallel; phases are sequential gates. I review diffs between phases and
run the app.

### Phase 0 — Engine foundations (1 agent)
**T0** `packages/engine` scaffold: package.json (`@shear0/engine`, type module, zero deps), tsconfig,
vitest, turbo wiring; `units.ts` (Q helper, kip/in/psi/ft conversions), `trace.ts` (Traced,
CheckResult, DAG helpers, trace integrity invariants + tests), `materials.ts` (concrete: Ec, β1
table 22.2.2.4.3, λ; rebar: US bar table #3–#11 with db/Ab; Grade 60/80), `wall.ts` (WallInput
model: geometry, distributed rebar layout incl. end-zone bars, demands list). *Gate: types + unit
tests green.*

### Phase 1 — Ordinary wall engine (3 agents, parallel after T0)
- **T1a** Detailing & minimums (11.3.1, 11.6, 11.7): thickness, threshold `0.5φαcλ√f'c·Acv`,
  Table 11.6.1 vs Eq. 11.6.2 path, spacing limits incl. lw/3–lw/5, curtain count, 11.7.4.1 tie
  trigger. Fixture: Ex. 1 steps 1, 7, 8.
- **T1b** In-plane shear (11.5.4) + out-of-plane (11.5.3 simplified, 22.5 shear): αc interpolation,
  tension modification 11.5.4.4, 8√f'c cap, φ=0.75; Pn simplified with k table; Vc per Table
  22.5.5.1 with size effect + caps. Fixture: Ex. 1 steps 5, 6; Ex. 2 steps 4c.
- **T1c** Fiber P–M engine (22.2/22.4/21.2.2): strain-compatibility section analysis of the actual
  bar layout, rectangular stress block, interaction curve generation (θ-sweep of neutral axis),
  φ(εt) transition, Pn,max/Pnt,max caps, demand-point utilization (radial), plus Mpr (1.25fy, φ=1)
  and c-at-Mn extraction (needed by Phase 3). Anchors: closed-form checks ±0.1%; Ex. 1 φMn ≈
  24,600 ft-kip and Ex. 2 φMn ≈ 40,200 ft-kip, Mpr ≈ 51,900 ft-kip, c ≈ 67.9 in. within ±2%.
  *This is the hardest task — give it the most review.*

**Gate: full Example 1 fixture passes end-to-end via a single `checkOrdinaryWall(input)` entry.**

### Phase 2 — UI MVP (3 agents, sequential-ish)
- **T2a** Design page shell: input panel (shadcn form controls; grouped Geometry / Materials /
  Reinforcement / Demands), WallInput reducer + URL serialization, live engine invocation, check
  summary list with utilization + status. shadcn components added via CLI (run from `apps/web`).
- **T2b** Domain SVG: `<WallPlanSection>` (true-scale plan with bars, cover, curtains, end zones),
  `<WallElevation>`, `<StrainProfile>` (εcu=0.003 wedge, neutral axis, εt readout); dimension-line
  primitives; theme-aware; hover a bar → highlights its row in the input panel.
- **T2c** Charts + trace report: P–M interaction diagram (φMn curve + Mn curve, demand points,
  hover readout — TanStack Charts behind wrapper, escape hatch per §2), utilization bars;
  `<CalcTrace>` recursive expandable report with KaTeX (client-only import), code refs as badges,
  copy-as-markdown button (exports the full trace — the shareable calc sheet).

**Gate: enter Example 1 in the browser, see all checks pass with correct numbers and full traces.**

### Phase 3 — Special walls (2 agents)
- **T3a** Engine: SDC routing, 18.10.2 minimums/curtains/end-zone ρ, Ve amplification (Ωv from
  Mpr/Mu, ωv with ns floor in inches, 3Vu cap), 18.10.4 strength + caps + ρl≥ρt rule, φ=0.6 logic
  (21.2.4.1, with the handbook-conservative vs 18.10.4.6 setting), SBE triggers 18.10.6.2(a)
  (needs δu, Cd, c from T1c) and 18.10.6.3 stress-based, drift-capacity eq., SBE sizing 18.10.6.4
  (a–c, f, g: hx, Ash, spacing) and 18.10.6.5(b) tie table. Fixture: full Example 2 (~30 asserts).
- **T3b** UI: SDC/system inputs (δe, Cd, ns, stories), SBE result cards, plan section renders SBE
  (thickened end zones, hoops + crossties, hx), elevation shows SBE vertical extent + tie-spacing
  zones, drift-capacity vs demand chart, trace wired through.

**Gate: Example 2 end-to-end in the browser.**

### Phase 4 — Learn mode, OSS, ship (2 agents)
- **T4a** `/learn`: provision walkthroughs generated from the same engine — each page runs a small
  example through one check and renders its trace with prose; index by code section. (The trace
  system is the content engine; no duplicated math.)
- **T4b** OSS hygiene: README (screenshots, philosophy: traceable calcs, disclaimer that output
  requires review by a licensed engineer and is not engineering advice), LICENSE (**MIT** unless you
  say otherwise), CONTRIBUTING (how to add a check: provision doc → engine + trace → fixture → UI),
  engineering disclaimer surfaced in-app footer, CI workflow, Vercel deploy.

---

## 5. Decisions taken (veto anytime) & open questions

**Taken:**
1. **US-customary internal storage** (handbook oracle + in-lb coefficient set), with the ACI 318M-19
   coefficient set branched at each formula site and chosen per wall by `units` — *not* a display
   conversion of an in-lb answer.
2. **TanStack Charts despite pre-alpha**, pinned + wrapped, with per-chart SVG escape hatch.
3. **No backend, no accounts** — URL-as-save-file. (A share-link shortener or saved projects would
   be a later, separate decision.)
4. **MIT license**, standard engineering-software disclaimer.
5. Handbook-conservative φ=0.6 reading for shear-controlled special walls (setting to relax).
6. Coupling beams / piers / openings / flanges deferred (§1).

**Open (non-blocking):**
- Whether `/design` should eventually support multiple walls / story envelopes (data model keeps
  demands as a list to leave room).
- Name/branding of the published npm package (`@shear0/engine` placeholder).
