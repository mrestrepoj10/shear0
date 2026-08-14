# contributing to kern

Thanks for looking. kern is a calculation tool for structural engineers, so the bar for a change is
not "the tests are green", it is "an engineer can read the trace and agree with it".

Everything here assumes you have read the disclaimer in `README.md` and understand that this
project produces aids to design, not designs.

## the shape of a contribution

Most work is one of:

1. **a new check** (a provision kern does not implement yet),
2. **a correction** to an existing check (with the code section that says so),
3. **UI or drawing work** in `apps/web`,
4. **research**: transcribing a provision or a published worked example into `docs/research/`.

Open an issue before a large one. Structural code is full of provisions that look independent and
are not.

## adding a check, end to end

### 1. write the provision down first

Add the provision to `docs/research/aci-318-19-wall-provisions.md`: section number, the equation
verbatim, every variable, every limit, every table row, and the conditions under which it applies.
Note the edition and the units of the coefficient set (kern is in-lb internally). If the provision
is ambiguous, say so in the doc rather than resolving it silently in code.

Do not commit the ACI documents themselves. `references/` is gitignored on purpose.

### 2. write the engine function

A check lives in `packages/engine/src/checks/`, is a pure function of `(WallInput, Demands?)`, and
returns a `CheckResult`. Build it out of the three constructors in `src/trace.ts` and nothing else:

- `input(id, symbol, label, value, unit, note?)` for values that came from the user.
- `constant(id, symbol, label, value, unit, ref, note?)` for numbers that came from the code.
  The `CodeRef` is **required**: `aci("11.5.4.2")` or `aci("11.5.4.3", "11.5.4.3")`. A magic number
  without a section reference is exactly the black box this project exists to avoid.
- `derive({ id, symbol, label, value, unit, formula, substitution, ref?, inputs, status?, note? })`
  for anything computed. `formula` is the LaTeX template, `substitution` is the same expression with
  the actual numbers in it. Both are mandatory and `derive` throws without them.

Then `checkResult({ id, title, ref, demand?, capacity?, utilization?, trace })`. Status is derived
for you: any `ng` node, or a utilization above 1, makes the check `ng`.

Conventions that matter:

- **Node ids are namespaced by check**, dot-separated, stable: `shear.alpha_c`, `sbe.length_req`,
  `oop.k`. Ids must be unique within a single trace graph, and `validateTrace` enforces it, so
  reuse the *same node object* when a value is shared rather than building a second one with the
  same id.
- **Symbols and labels are for a reader**, not for a variable name: `α_c`, "coefficient defining
  the relative contribution of concrete to in-plane shear strength". Copy the code's own wording
  where you can.
- **Every branch is traced.** When a table row or an interpolation decides the value, the chosen
  branch belongs in `formula`/`substitution` (see `alphaC` in `checks/shear-in-plane.ts` for the
  pattern), and the reason for it in `note`.
- **Units are canonical inside the engine**: kip, in., psi. Convert at the boundary with the
  helpers in `src/units.ts`. `fmtTex` formats numbers for substitution strings.
- **No runtime dependencies.** `@kern/engine` has zero of them and must keep zero. No DOM, no
  React, no date libraries, no unit libraries.

### 3. fixture it against a published worked example

A check is not done until it reproduces a number somebody else published. The two MNL-17(21)
examples in `docs/research/mnl-17-shear-wall-examples.md` are the current oracle; a different
handbook, an ACI design aid, or a peer-reviewed paper is fine too, as long as the source is cited
in the test file.

Tests live in `packages/engine/test/<check>.test.ts` and use the helpers in `test/fixtures.ts`:

- `example1` / `example2` — the handbook walls.
- `node(check, "shear.alpha_c")` — pull one node out of a check's trace graph.
- `expectValidTrace(check)` — every check must have one of these. It runs `validateTrace`, which
  asserts the graph is acyclic, ids are unique, every leaf came from `input()` or `constant()`,
  every constant has a `ref`, and every derived node has both a formula and a substitution.
- `delta(ours, handbook)` — relative difference in percent, for oracle comparisons.

Pick the tolerance the source deserves, and say why in a comment:

- closed-form anchors you can verify by hand: ±0.1%,
- handbook hand-calculation steps: tight, they are exact arithmetic with printed rounding,
- values the handbook itself took from a different numerical tool (the interaction-diagram
  spreadsheet): a few percent, because you are comparing two models, not checking one.

Also test the **boundaries**, not just the example: each branch of a table, each side of a
threshold, the interpolation endpoints (`h_w/ℓ_w` = 1.5, 2.0, 2.5), a demand just above and just
below a trigger.

If kern and the source disagree, do not widen the tolerance. Find out why, and if the disagreement
is real, write it down and let the check report `ng` (see the boundary-element length test in
`test/special-wall.test.ts` for the precedent).

### 4. wire it into the wall report

Add the call to `checks/ordinary-wall.ts` (`checkOrdinaryWall`) and/or `checks/special-wall.ts`
(`checkSpecialWall`) — general checks if the result does not depend on a load case, `perDemand`
otherwise. Export the function and its public types from `src/index.ts`.

### 5. the UI is already done

There is nothing to do in `apps/web` for a new check. The results summary, the utilization list and
the expandable trace report all iterate over `WallReport`, so a check that is wired into the report
renders, with its math, its code badge and its status, automatically. Add a UI change only if the
check needs a *new input field* (`components/design/inputs-panel.tsx`, plus the URL codec in
`lib/wall-codec.ts`) or a drawing.

## running things

```sh
pnpm install
pnpm -F @kern/engine test          # the fast loop
pnpm -F @kern/engine exec vitest   # ... in watch mode
pnpm test                          # everything, via turbo
pnpm lint
pnpm typecheck
pnpm build
```

All four of `lint`, `typecheck`, `test`, `build` must pass at the root before a PR. CI runs exactly
those, in that order, on Node 22.

## style

Match the file you are in. Beyond that:

- TypeScript, `strict`, and `noUncheckedIndexedAccess` in the engine. No `any` in new engine code
  (`Traced<any>` in the existing DAG plumbing is deliberate and contained).
- Comments explain *why*, and cite the section when the why is a code provision. The engine's
  existing comments are the model: they read like a design note, not like documentation.
- The UI is lowercase, monospace, `max-w-5xl`, monochrome except the ok/ng accents. Numbers are
  always `font-mono` with fixed decimals and a unit.
- No new dependencies in `packages/engine`, ever. New dependencies in `apps/web` need a reason in
  the PR description.

## licensing

By contributing you agree that your contribution is licensed under the MIT license in `LICENSE`.
Do not paste text from ACI 318, MNL-17, or any other copyrighted standard into the repository.
Section numbers, equation numbers and the variable names an equation defines are fine; the
prose is not.
