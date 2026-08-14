# kern — design engineering review (emil-design-eng) + Sonner proposal

> Reviewer: design-eng agent (Opus 5), 2026-08-13. Read-only diagnostic; nothing applied.

## 1. Verdict

kern is *substantively* excellent and superficially inert. The information design is the best thing here: the verdict strip, the utilization ruler, the demand→capacity line under every check, the true-scale drawings, and the trace DAG rendered from the engine's own nodes rather than a second implementation — that's real craft, and the SSR discipline (KaTeX server-rendered, `?w=` decoded server-side, learn pages statically generated) is better than most production apps. But the whole app has **six** transition declarations outside `components/ui/` — three of them chevron rotations. Nothing hovers, nothing settles, nothing acknowledges you. It reads less like restraint and more like the motion pass never happened, because the one thing that *is* animated (the utilization bar's `width`) is the one thing that shouldn't be.

The three things most holding it back:

1. **Typing thrashes the page.** Typing `336` into a cleared `ℓw` walks through `3` and `33` — measured document height swinging **3134px → 1890px → back** mid-word, verdict flipping, 240 fiber solves + two chart scene rebuilds per keystroke. The comment in `fields.tsx` claims half-typed numbers never reach the reducer; true for `""` and `"1."`, false for every partial integer — which is most of them.
2. **The typography system is broken and nobody noticed.** `--font-sans: var(--font-sans)` — circular, resolves to empty. `html` computes to **Times**, `font-heading`/`font-sans` are no-ops, Geist Sans is downloaded on every page and never painted. The entire app renders in Geist Mono by accident, including 60ch prose on /learn.
3. **Feedback is missing exactly where actions are destructive or silent.** A mangled `?w=` loads Example 1 with no word and then *overwrites the bad link* 300ms later. A failed clipboard write does literally nothing. `reset` and preset swaps discard an edited wall with no undo. Meanwhile the copy button's success feedback jumps its own width by 66px.

## 2. Findings

| # | sev | area | file:line | what's wrong | proposed fix |
|---|---|---|---|---|---|
| 1 | **P0** | input ergonomics | `fields.tsx:95-104` | Every intermediate keystroke dispatches: typing `336` produces hw/ℓw = 368 then 33.5; page height 3134→1890→3134 px; verdict flips; ~12 ms JS/keystroke | `useDeferredValue(input)` feeding WallCanvas/InteractionChart/DriftPanel only (summary + derived rows stay synchronous). Do NOT debounce the reducer |
| 2 | **P0** | data integrity | `fields.tsx:87-110` | No wheel guard: one wheel tick over a focused field, 12 → 13, silently | `onWheel={(e) => e.currentTarget.blur()}` |
| 3 | **P0** | typography | `globals.css:11` | `--font-sans` self-referential → html computes to Times; Geist Sans shipped, never painted | `--font-sans: var(--font-geist-sans)`. Then deliberately: keep mono chrome, let /learn prose opt into sans |
| 4 | **P1** | keyboard | `plan-section.tsx:161,569` | Roving cursor never clamped when station count shrinks: End (28) then spacing 12→60 → zero tabbable stations, drawing keyboard-dead | Clamp `cursor` to `stations.length - 1` at render; truncate stale refs |
| 5 | **P1** | feedback | `wall-codec.ts:299-305` → `design/page.tsx:20`, `url-state.ts:29-30,57-71` | Bad `?w=` silently loads Example 1 AND the debounced sync replaces the broken link within 300 ms — evidence destroyed | Toast (§3.1) + `skipFirstWrite` ref so the address bar keeps the broken link while the toast is up |
| 6 | **P1** | micro-interaction | `trace-report.tsx:157-182` | Copy button width jumps 137.6→71.6→137.6 px ("copied"); per-check `md` 45→72→45. `transition-all` can't interpolate intrinsic width | Grid-stack both labels (grid-area 1/1), reserve min-width, crossfade opacity+blur(2px) 200 ms; icon Copy→Check in same stack |
| 7 | **P1** | perceived perf | `xy-chart.tsx:110-151,294-299` | SSR chart is all `currentColor`; hydration repaints curve gray→foreground, marker gray→green. `initialWidth=720` vs real ~838 relayouts on mount | Emit `var(--token)` strings in SVG presentation attributes (plan-section already does); match initialWidth to shipped layout |
| 8 | **P1** | motion | `status.tsx:109` | The app's only state transition is `transition-[width]` on the utilization bar: layout-triggering, ~15 bars at once, 150 ms behind the number beside it | `transform: scaleX(var(--fill))`, origin left, 180 ms cubic-bezier(0.23,1,0.32,1); reduced-motion guard |
| 9 | **P1** | hover/affordance | `trace-report.tsx:294-309` | Full-width expand button: focus ring, zero hover. Chevron animates while panel pops — motion contradicts content | `hover:bg-muted/40` on the row; chevron `duration-120 ease-out` or drop it |
| 10 | **P1** | motion | `plan-section.tsx:444-446,590-600,605-607` | Signature micro-interaction (bar-station hover) has zero transition: r snaps ×1.75, crosshair and readout appear at full opacity — reads as flicker | `transition: r 130ms`; readout opacity 0→1 + translateY(2px)→0 130 ms ease-out; gate hover behind `(hover:hover) and (pointer:fine)` |
| 11 | **P1** | touch | `plan-section.tsx:219-227` | Hit widths in canvas units: at 390 px viewport = 6–7 × 14 CSS px; tap is the only path to the readout on touch and it's untappable. 89 elements < 44 px on mobile | Floor hit rects in CSS px via rendered scale; Button xs → h-7; nav links py-2 -my-2 below md |
| 12 | **P1** | contrast | `drawing.tsx:171` + every `<Note size={9}>` | Drawing notes: muted-foreground ≈3.9:1 at ~8–10 effective px — illegible in light captures | `--drawing-note` (oklch 0.46 light); floor rendered note size at 11 CSS px via inverse fit scale |
| 13 | **P1** | empty state | `presets.ts:78` + `results-summary.tsx:88-93` | Blank preset: wall carrying nothing reports green "ok — all checks pass" | When all demands are zero: na styling, "no loads applied — enter a load case" |
| 14 | P2 | alignment | `design-workspace.tsx:32-37` vs `inputs-panel.tsx:853` | Two-column workspace's first cards don't share a top edge (~43 px offset from the presets header row) | Move preset/reset row above the grid, or give results a matching header line |
| 15 | P2 | surfaces | `ui/card.tsx:15` vs `wall-canvas.tsx:59` vs `inputs-panel.tsx:762` | Three container treatments; visible in dark (cards raised at oklch 0.205, plates flat on 0.145) | Make Plate a Card (or bg-card + ring); one surface rule |
| 16 | P2 | truncation priority | `results-summary.tsx:113-125` | Verdict strip truncates the check *title* while RefBadge (least useful) is shrink-0: "governing in-pla… [11.5.1.1 / …] 0.76" at 390 px | Truncate the ref, or hide RefBadge below sm: |
| 17 | P2 | truncation | `fields.tsx:38` + `inputs-panel.tsx:52-56,72-75` | Fixed 8.5rem control column clips select options ("0.8 — restr…", "21.2.4.1 ap") | Shorten option labels (long form as hint), or minmax the grid |
| 18 | P2 | select feel | `ui/select.tsx:86` + `fields.tsx:140-152` | `alignItemWithTrigger` default triggers `animate-none`: every zoom/fade/slide class on that line is dead code; 9-item list pops | Either `alignItemWithTrigger={false}` and let the 160 ms zoom/fade run, or delete the dead classes |
| 19 | P2 | affordance | `inputs-panel.tsx:764-772` | Load-case label reads as a heading: borderless, transparent, no hover; focus is the only (undiscoverable) signal | `hover:bg-muted/50 transition-colors`; box on approach |
| 20 | P2 | hover feel | `navbar.tsx:18,27`, `layout.tsx:38,44`, learn links | Every nav/footer link: `hover:text-foreground`, no transition (one learn link got `transition-colors` — proof of oversight). No active-route state | `transition-colors duration-150` everywhere; `aria-current="page"` via usePathname |
| 21 | P2 | tooltips | `status.tsx:69` | RefBadge uses native `title` (~1 s delay, no touch/keyboard) while a fully-built Base UI Tooltip sits unused (as do dropdown-menu, separator) | Wrap RefBadge in Tooltip; provider delay 400 with instant-adjacent behavior (15+ badges/screen); delete the two unused ui files |
| 22 | P2 | button press | `ui/button.tsx:7` | `transition-all` + 1 px translate at ease-in-out on the most-watched moment | Enumerated transition props, `active:scale-[0.97]` 160 ms ease-out |
| 23 | P2 | charts | `xy-chart.tsx:265-283`; `drift-panel.tsx:315` | `grid: true` passed but no gridlines render (both charts, both themes) — can't read values off curves. Drift legend gives one dashed swatch to two different dashed series | Fix theme.grid wiring or draw gridlines; split the legend |
| 24 | P2 | a11y/motion | app-wide | No `prefers-reduced-motion` anywhere; becomes a real gap the moment motion findings land | Global reduce block first, then selective re-enables |
| 25 | P2 | waste | `inputs-panel.tsx:838-844` | `activePreset` runs `encodeWallInput` 4× per render (per keystroke) | Hoist `PRESET_CODES` to module scope |
| 26 | P2 | selection bug | `plan-section.tsx:578-581` | `onMouseLeave`/`onBlur` both clear selection unconditionally: hover away from a focused station kills its highlight while it keeps focus | Track hover and focus separately; `active = focused ?? hovered` |
| 27 | P2 | meter semantics | `results-summary.tsx:172-176` + `status.tsx:100-107` | Ratio-less checks render an empty green `role="meter"` with `aria-valuenow=undefined` — reads "0% utilised" | Return null when utilization undefined; `h-1` spacer for rhythm |

## 3. The Sonner proposal

### 3.1 Where a toast is genuinely right

| # | moment | file:line | why |
|---|---|---|---|
| 1 | Bad `?w=` fallback | `design/page.tsx:20` → effect in `design-workspace.tsx` | **Strongest case in the app**: wrong wall loads, nothing says so, link then destroyed. Transient, page-level, origin-less. `toast("that link couldn't be read", { description: "the ?w= payload was invalid or from an incompatible version — loaded example 1 instead", duration: 8000 })`. Pair with finding #5 so the broken link survives to be copied |
| 2 | Clipboard write fails | `trace-report.tsx:165-169` (missing `else`) | Currently *nothing happens at all*. Error must not be missable and doesn't fit a 45 px button. `toast("couldn't copy to the clipboard", { description: "your browser blocked clipboard access — select the report and copy manually", duration: 6000 })` |
| 3 | `reset` discards edits | `inputs-panel.tsx:881` | Toast earns its place solely as the **undo** carrier (no history entry exists; replaceState kills Back). Capture `previous` before dispatch |
| 4 | Preset over edited wall | `inputs-panel.tsx:858-863` | Only when `activePreset(input) === null` (user had edits). Pristine→pristine swaps: the pressed toggle + page change IS the feedback — no toast. This guard is the difference between helpful and annoying |
| 5 | Load case removed | `inputs-panel.tsx:778` | Undo only; restore via a new `restoreDemand` action (index matters). Optional same treatment for `setSbe(null)` |

### 3.2 What should NOT be a toast
- **Copy success** — stays inline at the button (9 buttons on one page; a toast per copy is a slot machine). Fix the width jump instead.
- **URL saved** — fires every 300 ms-debounced edit; the address bar is the feedback.
- **Pristine preset swaps** — the pressed state says it.
- **Engine failure** — already a persistent inline panel where results would be; a dismissible toast is strictly worse.
- **Individual ng checks** — that's the verdict strip's entire job.
- **Theme toggle** — instant, total, self-evident.

### 3.3 Integration spec
- **Headless, not richColors**: Sonner's injected styles would need `!important` on ~9 properties to match; use `toast.custom()` JSX matching `Card size="sm"` (`bg-card ring-1 ring-foreground/10 rounded-xl px-3 py-2.5 font-mono text-[13px]`, description `text-[11px] text-muted-foreground`) behind a `notify()` helper in `components/ui/sonner.tsx`. Keeps Sonner's positioning/stacking/swipe/timer-pausing.
- **Colour law**: `globals.css` reserves the only two hues for check outcomes — **no `richColors`, never `toast.success`/`toast.error`**. A green toast would make a clipboard confirmation look like a passing ACI check. Monochrome; words carry meaning.
- **Toaster**: mount once in `layout.tsx` inside ThemeProvider: `theme={resolvedTheme === "dark" ? "dark" : "light"}` (never `"system"` — next-themes allows OS override and they'd disagree; coerce undefined→light for SSR match), `position="bottom-right"` (top is taken by navbar + verdict strip; bottom is clear), `offset={16} mobileOffset={16} gap={8} visibleToasts={3} duration={4000} closeButton={false}`.
- **Durations**: 8000 decode failure; 6000 undo/error; 4000 default; nothing Infinity.
- **Motion**: Sonner defaults are right (transitions, retargeting); don't override.

## 4. Do not touch

1. KaTeX server-rendered (`tex.tsx`) with the `looksLikeMath` gate — never client-only.
2. `?w=` decoded on the server; url-state no-ops when server applied it.
3. The codec's defensive decoding (positive() guards, barSize allowlist, v1 compat) — a decode-failure toast must not turn per-field degradation into hard reject.
4. Engine runs synchronously on every change — solve #1 by deferring *rendering*, never debouncing the reducer.
5. `mergeOptional` deleting keys (cleared δe = "not supplied", round-trips clean).
6. Selection context no-op default — drawings render standalone in /learn.
7. `fitScale` uniform axes + `HAIRLINE` non-scaling-stroke — drawings are drawings, never stretch an axis.
8. DAG→tree flattening with back-references (mirrors traceToMarkdown).
9. /learn static, zero-JS, `<details open>` — don't client-ify to animate disclosure.
10. `num()`/`valueText()` never printing NaN/Infinity; `dim()` vs `fmt()` conventions.
11. `Readout` min-h-8 — chart hover never reflows.
12. `DISCRETE_CHECKS` governing-check exclusion.
13. `text-base md:text-sm` on Input (iOS zoom).
14. `suppressHydrationWarning` + `disableTransitionOnChange` — new global transitions must not defeat the latter.
15. The footer disclaimer — quiet, undismissable, on every page.
16. SBE bars drawn hollow with the note saying why — the app's integrity in one detail.
