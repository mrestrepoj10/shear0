# shear0

Open-source concrete shear wall designer, per **ACI 318-19**. Enter one rectangular wall and its
factored demands, get every Chapter 11 (and, for special walls, §18.10) check live as you type.

The point is not the answer. The point is that you can see where the answer came from.

## no black box

Engine functions do not return bare numbers. They return trace nodes, each carrying a symbol, a
value, a unit, the LaTeX formula, the same formula with the numbers substituted, an ACI section
reference, and the nodes it was computed from. A check is a DAG of those, rooted at a `CheckResult`;
the UI renders the DAG as an expandable report, and `traceToMarkdown()` prints it.

Real output, MNL-17(21) Shear Wall Example 1, in-plane shear, abridged:

```markdown
## In-plane shear strength

ACI 318-19 §11.5.4 (Eq. 11.5.4.3) — **OK**

- demand: V_u = 235 kip
- capacity: φV_n = 1,209 kip
- utilization: V_u/φV_n = 0.194

- **V_n** = 1,612 kip — nominal in-plane shear strength — ACI 318-19 §11.5.4.2
  - formula: `V_n = \min\left(V_{n,calc},\ V_{n,max}\right)`
  - subst: `V_n = \min(1{,}612,\ 2{,}281) = 1{,}612\ \text{kip}`
  - note: Eq. (11.5.4.3) governs; the 11.5.4.2 limit is not reached
  - **V_n,calc** = 1,612 kip — nominal in-plane shear strength from Eq. (11.5.4.3) — ACI 318-19 §11.5.4.3 (Eq. 11.5.4.3)
    - formula: `V_n = \left(\alpha_c\,\lambda\sqrt{f'_c} + \rho_t f_{yt}\right) A_{cv}`
    - subst: `V_n = 570 + 1{,}042 = 1{,}612\ \text{kip}`
    - **V_nc** = 570 kip — concrete contribution to in-plane shear strength — ACI 318-19 §11.5.4.3 (Eq. 11.5.4.3)
      - formula: `V_{nc} = \alpha_c\,\lambda\sqrt{f'_c}\,A_{cv}`
      - subst: `V_{nc} = 2.00 \times 1.00 \times 70.7 \times 4{,}032 = 570\ \text{kip}`
      - **α_c** = 2.00 — coefficient defining the relative contribution of concrete to in-plane shear strength — ACI 318-19 §11.5.4.3
        - formula: `\alpha_c = 2 \quad (h_w/\ell_w \ge 2.0)`
        - subst: `h_w/\ell_w = 3.286 \ge 2.0 \Rightarrow \alpha_c = 2`
        - **h_w/ℓ_w** = 3.29 — wall aspect ratio
          - subst: `h_w/\ell_w = 1{,}104 / 336 = 3.286`
```

Every leaf of every trace is either a user input or a code constant that carries its own reference.
That invariant is enforced by `validateTrace()`, which the test suite runs on every check.

## status

v0. What works today:

- **ordinary walls** (Ch. 11): minimum thickness, minimum distributed reinforcement and the
  `0.5φα_cλ√f'c·A_cv` trigger, spacing and curtain limits, lateral-tie trigger, in-plane shear
  (11.5.4), simplified out-of-plane axial (11.5.3), out-of-plane shear (22.5), and P–M interaction
  from a fiber-section engine (22.2/22.4, φ per 21.2.2).
- **special structural walls** (§18.10, SDC D/E/F): amplified shear `Ve = Ωv·ωv·Vu`, seismic φ,
  seismic web reinforcement, both boundary-element triggers (displacement- and stress-based),
  drift capacity, SBE sizing and confinement detailing.
- one rectangular section, one wall, demands entered as factored values.
- the URL is the save file: no backend, no accounts, nothing leaves the tab.

Deferred on purpose (tracked in `PLAN.md` §1, not planned): coupling beams (18.10.7), wall piers
(18.10.8), walls with openings or multiple segments, flanged (T/L/C/I) sections, multi-story
envelopes along height, load-combination generation, the slender out-of-plane method (11.8),
shear friction (22.9), SI-first workflows (SI display conversion only), prestressed and precast
walls.

## quick start

```sh
pnpm install
pnpm dev        # http://localhost:3000
pnpm test
```

Also available at the root: `pnpm lint`, `pnpm typecheck`, `pnpm build`. Requires Node 22+ and the
pnpm version pinned in `packageManager`.

## verification

The oracle is the ACI Reinforced Concrete Design Handbook, MNL-17(21) Vol. 1, Chapter 10, which
contains exactly two worked shear wall examples: Example 1 (SDC B, wind-governed ordinary wall) and
Example 2 (SDC D special structural wall with a special boundary element). Both are transcribed
step by step into `docs/research/mnl-17-shear-wall-examples.md`, and every printed intermediate is
an assertion. **238 tests** pass across 15 files.

Hand-calculated steps (α_c, V_n, ρ, spacing limits, Ω_v, ω_v, V_e, the SBE triggers, A_sh, ℓ_dh)
match the printed values to the handbook's own rounding. The values the handbook took from ACI's
interaction-diagram spreadsheet come from a different numerical model than our fiber section, so
they are held to looser tolerances and the deltas are printed by the suite:

| quantity | handbook | shear0 | delta |
|---|---|---|---|
| Ex. 1 φMn at Pu = 1015 kip | 24,600 ft-kip | 24,593 | -0.03% |
| Ex. 2 φMn at Pu = 1015 kip | 40,200 ft-kip | 40,195 | -0.01% |
| Ex. 2 Mpr at Pu = 1200 kip | 51,900 ft-kip | 51,447 | -0.87% |
| Ex. 2 c at Pu = 1200 kip | 67.9 in. | 68.7 in. | +1.15% |

The fiber engine is separately anchored to closed-form results (pure axial Po and 0.80Po, a
synthetic two-bar section, the balanced point) at ±0.1%, which is where its own correctness is
actually pinned down; the handbook comparison is a cross-check against an independent tool.

One honest disagreement: because our neutral-axis depth `c` is 1.2% larger than the spreadsheet's,
18.10.6.4(a) asks for a 35.1 in. boundary element where Example 2 detailed 34 in. The app reports
that as **NG** rather than widening a tolerance until it passes. Running Example 2 in `/design` shows
it.

## architecture

```
shear0/
├── apps/web          # Next.js 16.3 SPA, App Router
├── packages/engine   # @shear0/engine: pure TypeScript, zero runtime deps
├── docs/research     # extracted provision inventory + fixture source (committed)
└── references        # source PDFs (gitignored)
```

**`packages/engine`** is the product. Pure TS, no DOM, no React, no runtime dependencies, US
customary internally (kip, in., psi) because that is the coefficient set ACI 318 is written in.
`checkOrdinaryWall(input)` and `checkSpecialWall(input)` each return a report of `CheckResult`s;
everything below them is `Traced` nodes built by `input()`, `constant()` and `derive()` from
`src/trace.ts`. It is meant to be usable on its own, so a CLI or a plugin can be built on it
without pulling in the UI.

**`apps/web`** is a client-side SPA. All calculation happens in the browser (privacy, and it is
fast enough to recompute on every keystroke, interaction curves included). The wall
definition is serialized into the query string, so a design is a link. Domain graphics (plan
section with true-scale rebar, elevation, strain profile) are hand-written React SVG; XY charts go
through wrappers in `src/components/charts`.

## disclaimer

**shear0 is a calculation aid, not an engineer.**

Output from this software must be reviewed, verified and accepted by a licensed professional
engineer before it is used for any purpose. It is not a substitute for engineering judgment,
for the governing building code, or for the ACI 318 document itself. Nothing here is engineering
advice, and no engineer-client relationship is created by using it.

The software is provided "as is", without warranty of any kind, express or implied, including no
warranty of correctness, accuracy, or fitness for a particular purpose. The authors and copyright
holders accept no liability for any claim, damage, loss or other liability arising from its use.
See `LICENSE`.

Responsibility for a design rests with the engineer of record. Always.

## references are not included

`references/` is gitignored. ACI 318-19 and MNL-17(21) are copyrighted documents and are not
redistributed here, in whole or in part. What is committed is `docs/research/`: our own extracted
provision inventory and a transcription of the two worked examples, written for the purpose of
building and verifying this software. If you want to work on the engine, get your own copies from
ACI.

## contributing

See `CONTRIBUTING.md`. The short version: a check starts as a provision spec in `docs/research/`,
becomes an engine function returning a fully traced `CheckResult`, gets a fixture from a published
worked example, and then renders in the UI for free.

## deploying

`apps/web` is a standard Next.js app and deploys to Vercel with no configuration file: set the
Vercel project's **root directory to `apps/web`** and let it auto-detect pnpm and Turborepo. There
is deliberately no `vercel.json`.

## license

MIT. See `LICENSE`.
