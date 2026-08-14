# kern — interface review (better-ui / better-typography / better-colors / better-writing)

> Reviewer: interface panel agent (Opus 5), 2026-08-13. Read-only diagnostic; nothing applied.
> Production build on :3803, Chrome 151 headless via CDP, both themes, 390/768/1024/1280/1440 px.
> Contrast computed oklch→sRGB→WCAG 2.1 + APCA 0.1.9 (validated against reference pairs); deuteranopia via Viénot–Brettel–Mollon.

## 1. Verdict per lens

**better-ui.** The surface system is genuinely good and mostly unforced: `Card` earns depth with `ring-1 ring-foreground/10` rather than a fake border (`ui/card.tsx:15`), the drawings theme themselves entirely through `currentColor` + opacity (`drawing/drawing.tsx:9-12`), and `UtilizationBar` is the right primitive drawn once and reused everywhere. What lets it down is *state*. The input panel — the surface an engineer touches for an hour — has no hover feedback at all: `Input` (`ui/input.tsx:12`) and `SelectTrigger` (`ui/select.tsx:44`) both ship a light-mode hover of nothing, while every `Button`, `Toggle` and `Badge` beside them has one, so the fields read as less interactive than the chrome around them. The load-case name field is a raw `<input>` with `outline-none` and a focus indicator of `focus-visible:bg-muted` (`inputs-panel.tsx:866`) — a 1.03:1 background change, functionally no focus ring. Collapsibles animate their chevron and not their content (`trace-report.tsx:215` vs `:263-269`), even though `tw-animate-css` is installed and `SelectContent` already uses a proper `data-open:animate-in` vocabulary — the app has an enter/exit language and the trace ignores it. The trace's expand target is `size-4` (16×16 px, `trace-report.tsx:212`), repeated dozens of times per check, below the 24×24 floor. Two peer containers in one column use two surface systems — `Card` uses a ring, `Plate` uses `border border-border` (`wall-canvas.tsx:60`) — identical-looking by coincidence of token values, not by design.

**better-typography.** The font-mono-body decision is right for `/design` and wrong for `/learn`, and the codebase can't act on that distinction because the sans half of the pairing is broken: `--font-sans` is defined as `var(--font-sans)` (`globals.css:11`) — self-referential, never resolved. Measured: it computes to the empty string, `font-sans` and `font-heading` are silent no-ops, and **every element on every page renders in Geist Mono**; Geist Sans is instantiated in `layout.tsx:7-10` and never appears on screen. On `/design` mono is genuinely correct, and `max-w-prose` lands at a measured 546 px ≈ 65ch. On `/learn` it is a real tax: `topics.ts` summaries run 700–1100 characters of expository prose, 11–17 mono lines each — exactly the text the unused sans was loaded for. The bigger craft problem is the trace row: one baseline-aligned row carries **15.73 px KaTeX_Main serif** (symbol), **12 px Geist Mono** (value), 11 px (label), 10 px (role), 11 px (ref) — five sizes, two families, with the math symbol 31% larger than the number it equals, because KaTeX's stock `.katex { font-size: 1.21em }` was never overridden. The scale is ad-hoc: 72 arbitrary `text-[Npx]` values vs 56 scale tokens. `/design` has **no `h1`** — its first heading is `<h2>wall</h2>` at 12 px.

**better-colors.** The two-hue discipline is real and the comment at `globals.css:79` is honest, but three things undercut it. (1) `--status-ok`/`--status-ng` are separated by hue almost alone: deuteranope-simulated luminance ratio **1.21:1** light / 1.14:1 dark. With a text label (`StatusBadge`) that's fine; in `UtilizationList` and the chart dots it's colour alone — precisely the surfaces built to answer "what's close to the edge?". (2) `warning` and `na` render *identically* (`status.tsx:31-40`), so "passes with warnings" is indistinguishable from "nothing to check"; that badge measures **4.34:1** at 11 px, below AA. (3) Dark mode is not a peer: `--chart-1…5` and `--sidebar-*` are copied unchanged into `.dark` (`chart-5` **1.31:1** on dark; `--sidebar-primary` dark is a saturated blue contradicting the two-hue comment). All dead tokens (0 references) — a latent trap. Separately, `--status-ng` is used for engine *errors* (`design-workspace.tsx:26,40`) and for "SBE required" (`drift-panel.tsx:245`) — neither is a failing check; `--destructive` exists unused.

**better-writing.** The voice is deliberate, not accidental: lowercase applied by function (`checkTitle`, `results-summary.tsx:82-86`) with proper-noun carve-outs (`SBE`, `P–M`, `ACI`, `Grade 60`, `SDC D`) — the right line. Jargon calibration is excellent (`ρt`, `φVn` unglossed and correct; learn notes specific and numeric; the boundary-element empty-state copy is a model). Where it slips is internals leaking: `wall-canvas.tsx:85` renders the raw enum (`— na overall`); `EXAMPLE_2` demands ship no `label` so the slug **`max-axial`** surfaces as a card title, chart marker, trace scope and governing suffix; new cases are named `load-2`; the load-case field's placeholder is an internal id doing a label's job; the preset toggle reads "ex 1 / ex 2 / blank" while a good `PRESET_LABELS` map sits unused (`presets.ts:91`). The two states most needing copy have none: a mangled `?w=` silently falls back to Example 1, and the blank preset gives no guidance.

## 2. Consolidated findings

| # | sev | lens | file:line | issue | proposed fix |
|---|---|---|---|---|---|
| 1 | **P0** | typography | `globals.css:11,13` | `--font-sans: var(--font-sans)` self-referential; computes to `""`; every element app-wide renders Geist Mono; Geist Sans never appears | `--font-sans: var(--font-geist-sans);` (leave `:13`); verify computed fontFamily |
| 2 | **P0** | writing | `app/design/page.tsx:20-23` | Truncated/edited `?w=` silently falls back to EXAMPLE_1 — a shared design becomes the handbook wall with no notice; worst failure mode for a calc tool | Pass `linkFailed` flag when encoded non-empty but decode null; verdict strip: "that link couldn't be read — showing example 1 instead" |
| 3 | **P1** | ui | `inputs-panel.tsx:866` | Load-case name input: `outline-none`, focus = 1.03:1 bg change, no hover; bypasses `Input` primitive | Add hover:bg-muted/60 + focus-visible:ring-3 ring-ring/50 treatment |
| 4 | **P1** | ui | `ui/input.tsx:12`; `ui/select.tsx:44` | No light-mode hover on Input/SelectTrigger while all adjacent chrome has one | Add `hover:bg-muted/40` to both |
| 5 | **P1** | typography | `tex.tsx:17` + trace rows | KaTeX stock `1.21em` never overridden: symbol 15.73 px vs value 12 px in one row | `.katex { font-size: 1em }`, `.katex-display > .katex { font-size: 1.05em }`; value span → 13px |
| 6 | **P1** | typography | `utilization-list.tsx:75-82`; `results-summary.tsx:156`; `fields.tsx:40` | 0 truncating spans carry `title`; check titles clip to ~16 chars at 1024 px; hwcs label clips at 1280 px | Add `title` attributes to all three |
| 7 | **P1** | colors | `status.tsx:31-40` | warning ≡ na visually; warning badge 4.34:1 at 11 px (below AA) | warning: `bg-muted text-foreground ring-1 ring-foreground/20` |
| 8 | **P1** | colors | `globals.css:81-82`; `utilization-list.tsx:88`; `xy-chart.tsx:248-256` | ok/ng hue-only for deuteranopes (1.21:1) on the list rows and chart dots | StatusBadge on ng/warning rows; ng chart dots: hollow, r 6, strokeWidth 2 |
| 9 | **P1** | colors | `globals.css:81`; `status.tsx` | ~45 elements render status-ok on an all-passing wall — 100% coverage colour carries zero information | Demote pass to neutral (`text-foreground`, bar `bg-foreground/70`); keep the one saturated colour for failure. Also collapses #8 |
| 10 | **P1** | writing | `wall-canvas.tsx:85` | Raw enum rendered: "— na overall" | Map through `STATUS_LABEL` |
| 11 | **P1** | writing | `presets.ts:63-64`; `inputs-panel.tsx:862` | `max-axial` slug surfaces in 4 UI places; placeholder prints internal id as only label | Add labels ("seismic", "max axial"); `placeholder="name this case"`; visible label |
| 12 | **P1** | writing | `design-workspace.tsx:38-42` | Engine failure prints raw exception as only guidance | Lead with instruction; exception behind `<details>engine message</details>` |
| 13 | **P1** | ui | `trace-report.tsx:212` | Trace expand affordance 16×16 px — most-repeated control in the app | `size-6` hit area, keep `size-3` glyph |
| 14 | **P1** | typography | `design-workspace.tsx:22-52` | `/design` has no h1; first heading is 12 px `<h2>wall</h2>` | `<h1 className="sr-only">shear wall design</h1>` or promote verdict |
| 15 | P2 | ui | `trace-report.tsx:263-269` | Collapsible content has no enter animation while its chevron animates; app already has the vocabulary (`ui/select.tsx:86`) | `animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out` |
| 16 | P2 | ui | `wall-canvas.tsx:60`; `learn/topic-visual.tsx:35`; `app/learn/page.tsx:46` | `Plate`/learn cards use `border border-border` vs Card's ring — two surface systems | Unify on `ring-1 ring-foreground/10` |
| 17 | P2 | ui | `inputs-panel.tsx:762`; `strain-profile.tsx:34` | Non-concentric nested radii (14 px outer, 12 px padding, 10 px inner) | Inner → `rounded-sm` (6 px) |
| 18 | P2 | colors | `globals.css:70-74/100-104`, `:75-83/105-113`, `:19-30` | Dead `--chart-*`/`--sidebar-*` tokens, unchecked in either theme (chart-5 1.31:1 dark; sidebar-primary dark is saturated blue) | Delete both blocks + 12 `@theme inline` aliases |
| 19 | P2 | colors | `design-workspace.tsx:26,40`; `drift-panel.tsx:245-249` | status-ng used for engine errors (use `--destructive`) and for the "SBE required" branch (not a failure) | `text-destructive` for errors; muted for the SBE sentence |
| 20 | P2 | typography | 72 `text-[Npx]` occurrences | Ad-hoc bracket sizes outnumber scale tokens; `text-[12px]` duplicates `text-xs` | Register `--text-2xs/--text-xs2/--text-sm2` tokens; replace |
| 21 | P2 | typography/colors | `app/learn/page.tsx:51`; dark `--muted-foreground` | Dark muted-foreground APCA Lc −51.2, below non-body floor; learn blurbs 11 px | `.dark { --muted-foreground: oklch(0.76 0 0) }`; blurbs → 12 px |
| 22 | P2 | ui | `theme-toggle.tsx:17-18` | Instant icon swap; both icons already in DOM | CSS cross-fade (300 ms, scale+blur) |
| 23 | P2 | ui | `trace-report.tsx:294-309`; `trace-walkthrough.tsx:212-216` | Full-width collapse triggers have no hover state | `transition-colors hover:bg-muted/40` |
| 24 | P2 | writing | `layout.tsx:33`; `trace-report.tsx:394`; `learn/[slug]/page.tsx:136-137` | The legally-meaningful disclaimer written 3 different ways | One `DISCLAIMER` constant in `lib/copy.ts` |
| 25 | P2 | writing | `presets.ts:91-95` vs `inputs-panel.tsx:77-81` | `PRESET_LABELS` defined and never rendered; UI ships "ex 1 / ex 2 / blank" | Drive toggle from `PRESET_LABELS` (or `title=` expansion) |
| 26 | P2 | writing | `results-summary.tsx:89-90`; `utilization-list.tsx:57` | "check fails" singular when two fail; "demand / capacity" subtitle wrong for ratio rows | Failing count with pluralization; subtitle "n checks · utilization" |
| 27 | P2 | writing | `presets.ts:72-81`; `wall-state.tsx:196-203` | Blank preset: zero-load case named `load-1`, all checks pass trivially, no guidance; addDemand names `load-2` | Placeholder instead of id label; "enter Pu, Mu and Vu to check this wall" hint when all-zero |
| 28 | P2 | ui | `trace-walkthrough.tsx:119-136` | Hand-rolled chevron SVG duplicates lucide `ChevronRight`; strokeWidth 2 beside 400-weight mono | Use lucide, `strokeWidth={1.5}` in both files |

## 3. Keep as is

- **`Card`'s `ring-1 ring-foreground/10`** — the correct elevation primitive; #16 asks outliers to join it, not the reverse.
- **Drawing theming** (`currentColor` + non-scaling-stroke + opacity, fills from CSS vars) — zero hex, correct in both themes at any zoom. Do not introduce chart tokens here.
- **`dim()` vs `fmt()`** — drawings drop separators ("1104"), tables keep them ("1,104 kip"). Real drafting practice; do not unify.
- **`max-w-prose` in mono** — measures exactly 65ch. Do not swap for a px cap.
- **Lowercase voice applied by function** with proper-noun carve-outs — identity, not sloppiness.
- **`Input`'s `text-base md:text-sm`** — 16 px mobile kills iOS zoom-on-focus. Do not "simplify".
- **Failing checks auto-expand** (`useState(check.status === "ng")`) — small decision, large effect.
- **`Tex`'s `looksLikeMath` guard** — keeps prose out of the math renderer. #5 changes size, not this gate.
- **Fixed-height chart readouts** (`min-h-8`) — hover never reflows. Preserve.
- **`aria-label`s in natural sentence case** while visible chrome is terse lowercase — the right split.
- **SSR KaTeX + build-time engine runs** — keep `Tex`/`TraceWalkthrough` server-renderable through any refactor.
- **`Button`'s translate-y press** — registry-wide press language with the `haspopup` carve-out; don't fragment it per-component.

## Verification & limits

Verified: production build, CDP probes of /, /design (Ex. 1 + Ex. 2 URL), /learn, /learn/sbe-detailing, /learn/in-plane-shear; both themes confirmed by re-reading every token per theme; 5 widths with `scrollWidth === innerWidth` at all (no horizontal overflow anywhere — a real strength); per-element computed font metrics; APCA implementation validated against published reference pairs.
Not verified: motion at reduced speed (headless), keyboard traversal of bar stations (code reads correct), screen-reader output, mid-session ordinary↔special toggle.

**Verdict: Needs changes** — two P0s (broken font pairing; silent bad-link fallback), then a cluster of P1 state and legibility work.
