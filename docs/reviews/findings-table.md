# Consolidated findings table

86 raw findings from the three reviews, deduped to 61 rows. Severity = highest any reviewer
assigned. Sources: G = web-design-guidelines.md, I = interface-review.md, E = emil-design-eng.md
(numbers refer to each report's own findings table — full detail, exact file:line and proposed
fixes live there). Batch → PR mapping in fix-pr-plan.md.

## P0 — correctness / broken systems

| # | Batch | Finding | Fix (short) | Where | Src |
|---|---|---|---|---|---|
| 1 | A | Scroll wheel over focused field silently changes values & re-runs checks | `onWheel` → blur | `fields.tsx:87` | G1, E2 |
| 2 | A | `--font-sans` self-referential → whole app renders mono/Times; Geist Sans never paints | `var(--font-geist-sans)` + decide /learn prose | `globals.css:11` | I1, E3 |
| 3 | A | Bad `?w=` link silently loads Example 1, then URL sync destroys the broken link in 300 ms | detect + toast + `skipFirstWrite` | `design/page.tsx:20`, `url-state.ts:57` | I2, E5 |
| 4 | A | Typing thrash: partial keystrokes dispatch; page height oscillates 3134→1890 px mid-word | `useDeferredValue` for canvas/charts only (never debounce reducer) | `fields.tsx:95`, `wall-state.tsx:270` | E1 |
| 5 | B | Invisible focus state on load-case input (1.03:1), no hover, bypasses `Input` | shared ring treatment | `inputs-panel.tsx:771/866` | G2, I3, E19 |

## P1 — accessibility & feedback

| # | Batch | Finding | Fix (short) | Where | Src |
|---|---|---|---|---|---|
| 6 | B | All 23 form labels orphaned — none clickable; duplicated `aria-label`s | `useId()` in `FieldRow` | `fields.tsx:39` + call sites | G3 |
| 7 | B | No `aria-live` anywhere — verdict flips ok→ng silently for AT | `role="status"` on verdict + chart readouts | `results-summary.tsx:95` | G5 |
| 8 | B | No h1 on /design; results titles are divs — zero heading navigation | sr-only h1 + `CardTitle` as headings | `design-workspace.tsx:22` | G4, I14 |
| 9 | B | `prefers-reduced-motion` has zero effect (118 elements) | global reduce block | `globals.css` | G7, E24 |
| 10 | B | Light-theme focus ring 2.58:1 (below 3:1) | darken `--ring` to ≈ oklch(0.55) | `globals.css:71` | G8 |
| 11 | B | Bar stations announce as buttons but Enter/Space do nothing | `listbox`/`option` semantics | `plan-section.tsx:568` | G6 |
| 12 | B | Keyboard bug: shrink station count after `End` → drawing permanently untabbable | clamp roving cursor | `plan-section.tsx:161,569` | E4 |
| 13 | B | Tiny targets: 16×16 trace toggles, 20 px nav links, 6×13 px bar hits at 375 px | size-6 toggle, py nav, CSS-px hit floor | `trace-report.tsx:212`, `navbar.tsx`, `plan-section.tsx:219` | G14, I13, E11 |
| 14 | B | Chart is `role="img"` — data unreachable by AT; promised readout has no live region | visually-hidden summary table | `xy-chart.tsx:294` | G13 |
| 15 | B | Hover-away from a keyboard-focused station kills its highlight while focus remains | separate hover/focus, `focused ?? hovered` | `plan-section.tsx:578` | E26 |
| 16 | A | Blank wall (zero loads) reports green "ok — all checks pass" | "no loads applied — enter a load case" verdict | `results-summary.tsx:88` | E13, I27 |
| 17 | A | Clipboard failure does literally nothing (no `else` branch) | failure toast | `trace-report.tsx:165` | E-Sonner2 |
| 18 | A | Destructive actions (reset, preset over edits, remove load case, clear SBE) — no confirm, no undo, Back doesn't recover | undo toasts (Sonner) | `inputs-panel.tsx:778,606,881` | G26, E-Sonner3-5 |
| 19 | A | Sonner integration itself: headless monochrome toasts, bottom-right, 5 call sites, no richColors | per emil report §3.3 | new `ui/sonner.tsx`, `layout.tsx` | E§3 |

## P1 — visual & performance

| # | Batch | Finding | Fix (short) | Where | Src |
|---|---|---|---|---|---|
| 20 | C | ~45 green elements on a passing wall — pass-color carries zero info; ok/ng only 1.21:1 for deuteranopes | demote pass to neutral; hollow ng chart dots | `status.tsx`, `utilization-list.tsx`, `xy-chart.tsx:248` | I8, I9 |
| 21 | C | `warning` renders identically to `na`; warning badge 4.34:1 (below AA) | ring + `text-foreground` for warning | `status.tsx:31-40` | I7 |
| 22 | C | KaTeX symbols 31% larger than the values they equal (stock 1.21em) | `.katex { font-size: 1em }` + 13 px values | `globals.css`, trace rows | I5 |
| 23 | C | No hover on any Input/Select while all adjacent chrome has one | `hover:bg-muted/40` | `ui/input.tsx:12`, `ui/select.tsx:44` | I4, E20 |
| 24 | C | Trace expand rows: focus ring but zero hover; chevron animates while panel pops | row hover + consistent motion | `trace-report.tsx:294` | I23, E9 |
| 25 | C | Utilization bar animates `width` (layout, 15 bars, lags its own number) | `scaleX` transform 180 ms | `status.tsx:109` | E8 |
| 26 | C | Copy buttons jump width 137→72→137 px on "copied" | grid-stack labels, reserve width, crossfade | `trace-report.tsx:157` | E6 |
| 27 | C | Bar-station hover snaps (r ×1.75, readout pops) — signature interaction reads as flicker | 130 ms transitions; gate on `(hover:hover)` | `plan-section.tsx:444,590` | E10 |
| 28 | C | Drawing notes ≈3.9:1 at ~8–10 effective px — illegible in light | `--drawing-note` token + 11 px floor | `drawing.tsx:171` | E12 |
| 29 | C | `max-axial` slug + raw enum "na overall" + `load-1/-2` leak as UI copy | labels in presets; `STATUS_LABEL`; placeholder | `presets.ts:63`, `wall-canvas.tsx:85`, `wall-state.tsx:198` | I10, I11 |
| 30 | C | Engine error prints raw exception as only guidance | instruction first, exception in `<details>` | `design-workspace.tsx:38` | I12, G29 |
| 31 | D | 390 KB gz JS; ~150 KB chart chunk eager-loaded even when it renders nothing | `next/dynamic` both chart panels | `results-panels.tsx` | G10 |
| 32 | D | Learn sbe-detailing: 11,964 DOM nodes, all `<details>` open | `content-visibility: auto` or close below depth 2 | `trace-walkthrough.tsx:210` | G11 |
| 33 | D | KaTeX fonts `font-display: block` — invisible math up to 3 s | swap overrides | after katex css import | G12 |
| 34 | D | Chart SSR ships `currentColor` → hydration color-flash; `initialWidth=720` vs real 838 relayouts | `var(--token)` in SVG attrs; honest width | `xy-chart.tsx:110,294` | E7 |
| 35 | C | Truncated titles have no `title` recovery; check names clip to 16 chars at 1024 px | add `title=` to 3 spans | `utilization-list.tsx:75`, `results-summary.tsx:156`, `fields.tsx:40` | I6 |

## P2 — polish, copy, hygiene

| # | Batch | Finding | Fix (short) | Where | Src |
|---|---|---|---|---|---|
| 36 | C | `transition-all` on button/badge/toggle | enumerate properties | `ui/button.tsx:7` etc. | G9, E22 |
| 37 | C | Trace collapse has no enter animation (vocabulary exists in select) | `animate-in fade-in slide-in` 150 ms | `trace-report.tsx:263` | I15 |
| 38 | C | Two surface systems (Card ring vs Plate border) — visible in dark | unify on `ring-1 ring-foreground/10` | `wall-canvas.tsx:60` + 2 more | I16, E15 |
| 39 | C | Non-concentric nested radii (14/12/10 px) | inner → `rounded-sm` | `inputs-panel.tsx:762` | I17 |
| 40 | C | Dead `--chart-*`/`--sidebar-*` tokens, unchecked contrast, stray saturated blue in dark | delete blocks + aliases | `globals.css:70-113` | I18 |
| 41 | C | `--status-ng` used for engine errors and the "SBE required" branch (not failures) | `text-destructive` / muted | `design-workspace.tsx:26,40`, `drift-panel.tsx:245` | I19 |
| 42 | C | 72 ad-hoc `text-[Npx]` vs 56 scale tokens | register `--text-2xs/xs2/sm2` | components/ | I20 |
| 43 | C | Dark `--muted-foreground` APCA −51 (below floor); 11 px learn blurbs | `.dark` → oklch(0.76); blurbs 12 px | `globals.css`, `learn/page.tsx:51` | I21 |
| 44 | C | Theme toggle icons swap instantly | CSS crossfade 300 ms | `theme-toggle.tsx:17` | I22 |
| 45 | C | Disclaimer written 3 different ways | one `DISCLAIMER` constant | `layout.tsx:33` + 2 more | I24 |
| 46 | C | `PRESET_LABELS` built and never rendered; UI ships "ex 1 / ex 2 / blank" | drive toggle from labels | `presets.ts:91`, `inputs-panel.tsx:77` | I25 |
| 47 | C | "check fails" singular when 2 fail; "demand / capacity" subtitle wrong for ratio rows | pluralize count; neutral subtitle | `results-summary.tsx:89`, `utilization-list.tsx:57` | I26 |
| 48 | C | Hand-rolled chevron duplicates lucide; strokeWidth 2 vs 1.5 optical match | lucide + 1.5 | `trace-walkthrough.tsx:119` | I28 |
| 49 | C | Verdict strip truncates the *title* while the code ref hogs 250 px | truncate ref / hide below sm | `results-summary.tsx:113` | E16 |
| 50 | C | Select options clip ("0.8 — restr…") in fixed 8.5rem column | shorter labels + hint | `fields.tsx:38`, `inputs-panel.tsx:52` | E17 |
| 51 | C | Select animation is dead code (`alignItemWithTrigger` → `animate-none`) | enable or delete classes | `ui/select.tsx:86` | E18 |
| 52 | C | Nav/footer links color-snap (no transition); no active-route state | `transition-colors` + `aria-current` | `navbar.tsx`, `layout.tsx` | E20 |
| 53 | C | RefBadge uses native `title` while built Base UI Tooltip sits unused | wrap in Tooltip; delete unused ui files | `status.tsx:69` | E21 |
| 54 | C | No gridlines render on either chart; drift legend merges two dashed series | fix theme.grid wiring; split legend | `xy-chart.tsx:265`, `drift-panel.tsx:315` | E23 |
| 55 | C | Empty green `role="meter"` with `aria-valuenow=undefined` on ratio-less checks | render null + spacer | `results-summary.tsx:172` | E27 |
| 56 | C | Columns don't share a top edge (~43 px) | presets row above the grid | `design-workspace.tsx:32` | E14 |
| 57 | C | Dead affordance: bar-hover publishes selection, nothing consumes it | wire into `ReinforcementCard` or delete | `wall-state.tsx:248` | G30 |
| 58 | B | Forms: no `autocomplete/name/spellcheck`; silent rejection of invalid values (no `aria-invalid`); placeholder = internal id | add attrs + inline invalid message | `fields.tsx`, `inputs-panel.tsx` | G16-18 |
| 59 | B | No skip link; anchors land under sticky header; `aria-expanded` without `aria-controls`; no `touch-action` | 4 small additions | `layout.tsx`, `learn/[slug]`, `trace-report.tsx` | G15,19,20,28 |
| 60 | C | Metadata: no `title.template`/`metadataBase`/OG cards/`theme-color`; no `translate="no"`; no safe-area padding; no `text-wrap: balance` | metadata pass | `layout.tsx` + pages | G21-24,27 |
| 61 | D | `activePreset` runs `encodeWallInput` 4× per keystroke | hoist to module scope | `inputs-panel.tsx:838` | E25 |

Deferred (no PR): trace-expansion state in URL (G25); `Intl.NumberFormat` (G31 — en-US arguably correct for an ACI tool).
