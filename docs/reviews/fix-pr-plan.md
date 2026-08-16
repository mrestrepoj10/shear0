# UI review — fix implementation plan (PRs)

Source: the 61-row consolidated findings table (`findings-table` rows referenced as #n).
Execution: one Opus 5 fix agent per PR, fresh context, straight instructions, sequential
(each PR branches from the previous merge — many findings share files, so stacking
beats parallel merge conflicts). Every agent gets the three reviewers' combined
**do-not-touch list** baked into its prompt. I (orchestrator) gate each PR before it
opens: `turbo lint typecheck test build --force` + targeted runtime verification of the
specific findings (grep SSR HTML / headless check), then open the PR for your review.

## Step 0 — prerequisite (one-time)
Create `github.com/frame-labs/shear0` and push `main`. **Decision needed: public now or
private until the fix PRs land.** CI (`.github/workflows/ci.yml`) starts running on PRs
immediately either way.

## PR 1 — `fix/p0-hotfixes` — P0 correctness & ergonomics
Findings: #1 wheel guard · #2 `--font-sans` fix (+ deliberate call: /learn prose and
`max-w-prose` blocks opt into `font-sans`; /design chrome stays mono) · #4 typing
thrash (`useDeferredValue` feeding WallCanvas/InteractionChart/DriftPanel ONLY —
reducer and engine stay synchronous, per do-not-touch #4) · #61 `PRESET_CODES` hoist.
Small, high-value, reviewable in minutes. No visual redesign.
Verify: wheel tick no-ops; computed `fontFamily` shows Geist Sans on learn prose;
typing `336` into cleared ℓw produces no layout oscillation; encode runs once/render.

## PR 2 — `fix/feedback-sonner` — link integrity, toasts, honest empty state
Findings: #3 bad-`?w=` detection + preserve broken link (skipFirstWrite) · #17
clipboard-failure handling · #18 undo for reset / preset-over-edits / remove-load-case
(new `restoreDemand` action) · #19 Sonner integration per the emil spec §3.3
(headless `toast.custom` matching Card, monochrome — **no richColors, no
toast.success/error**, bottom-right, theme={resolvedTheme}) · #16 zero-load wall
verdict → "no loads applied — enter a load case".
Verify: `/design?w=GARBAGE` shows the toast and keeps the bad payload in the address
bar; blank preset no longer shows green; undo restores the exact prior wall.

## PR 3 — `fix/a11y-forms-focus` — forms & focus
Findings: #5 load-case input focus/hover treatment · #6 label↔control wiring via
`useId` in FieldRow (delete duplicated aria-labels) · #10 light `--ring` → ≈oklch(0.55)
· #58 `autocomplete/name/spellcheck`, `aria-invalid` + inline message on rejected
values, `placeholder="name this case"`.
Verify: 23/23 labels associated (label.control !== null), clickable; focus ring ≥3:1
light; invalid entry announces.

## PR 4 — `fix/a11y-structure-motion` — structure, live regions, keyboard, targets
Findings: #7 aria-live verdict + chart readouts · #8 h1 + CardTitle-as-headings ·
#9 global `prefers-reduced-motion` block · #11 bar-station semantics
(listbox/option) · #12 roving-cursor clamp · #13 hit-target floors (trace toggle
size-6, nav py, CSS-px bar hits) · #14 visually-hidden chart summary · #15 hover/focus
selection split (`focused ?? hovered`) · #59 skip link, scroll-margin, aria-controls,
`touch-action: manipulation`.
Verify: heading outline present; verdict announces on change; stations reachable after
spacing change; reduced-motion emulation kills transitions.

## PR 5 — `fix/status-color-system` — status semantics & tokens
Findings: #20 demote "pass" to neutral (single saturated color reserved for failure;
hollow ng chart dots) · #21 warning ≠ na + AA contrast · #40 delete dead
`--chart-*`/`--sidebar-*` tokens + aliases · #41 `--destructive` for engine errors,
muted for the SBE-required sentence · #43 dark `--muted-foreground` lift · #55
ratio-less checks render no meter.
Note: lands BEFORE motion/polish so later PRs style against the final color system.
Verify: all-passing wall shows neutral rows + one green nowhere; deuteranope sim
distinguishes ng by shape; contrast numbers from the report re-measured.

## PR 6 — `fix/legibility-copy` — typography & language
Findings: #22 KaTeX 1em + 13px values · #35 truncation `title=` recovery · #42
`--text-2xs/xs2/sm2` tokens replacing 72 brackets · #29 preset demand labels +
STATUS_LABEL + addDemand naming · #30 engine-error copy (instruction first, exception
in details) · #45 single DISCLAIMER constant · #46 PRESET_LABELS rendered · #47
pluralized verdict + honest utilization subtitle · #48 lucide chevron @1.5 · #49
verdict truncation priority (title wins over ref) · #50 select option labels fit.
Verify: one trace row = two font sizes max; grep for text-[12px] returns 0; copy
strings match the approved wording.

## PR 7 — `fix/interaction-polish` — hover, motion, surfaces
Findings: #23 input/select hover · #24 trace-row hover + chevron consistency · #25
utilization bar scaleX · #26 copy-button width morph · #27 bar-station hover
transitions (gated `(hover:hover)`) · #36 enumerate transition props + press scale ·
#37 collapse enter animation · #38 one surface system (Plate → Card ring) · #39
concentric radii · #44 theme-toggle crossfade · #51 select animation decision ·
#52 nav transitions + aria-current · #53 RefBadge → Base UI Tooltip (delete unused ui
files) · #54 chart gridlines + drift legend split · #56 column top alignment · #57
wire selection → ReinforcementCard highlight (the promised half of the T2b feature).
Depends on PR 4 (reduced-motion guard exists first) and PR 5 (final colors).
Verify: every interactive element has hover; motion honors reduced-motion; no
regression on emil's do-not-touch #14 (disableTransitionOnChange).

## PR 8 — `fix/performance-platform` — weight & metadata
Findings: #31 `next/dynamic` chart panels (~150 KB gz off critical path) · #32
`content-visibility` on learn trace nodes · #33 KaTeX font-display swap · #34 chart
SSR palette via `var(--token)` + honest initialWidth · #60 metadata pass
(title.template, metadataBase, OG for learn, theme-color, translate="no",
safe-area padding, text-balance).
Verify: /design first-load JS re-measured and reported in the PR body; no hydration
color-flash; learn page style/layout cost sampled.

## Explicitly deferred (tracked, not in any PR)
- Trace-expansion state in the URL (G25) — nice idea, needs design.
- `Intl.NumberFormat` (G31) — en-US formatting is arguably correct for an ACI tool.

## Guardrails given to every fix agent
The union of the three reviewers' do-not-touch lists (emil §4's 16 items, interface
§3's 12 items, guidelines' "verified as passing" list), plus: no new hues; no
richColors; engine untouched except where a finding names it; every PR keeps
`turbo lint typecheck test build --force` green and 238 engine tests passing.

## PR mechanics
- Branch names as above, from up-to-date main after the previous merge.
- PR body: findings addressed (row numbers), verification evidence, before/after notes.
- You review/merge in GitHub (or tell me to merge after green gates).
