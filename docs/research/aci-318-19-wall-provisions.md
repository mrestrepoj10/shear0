# ACI 318-19 Provision Inventory — Concrete Shear Wall Design/Calculation Tool

> Extracted 2026-08-13 from the Spanish-language SI edition scan (`references/aci-318-19.pdf`) and
> **verified 2026-08-13 against the official English in-lb edition with commentary
> (`references/aci-318-19-english.pdf`) — the primary reference going forward.**
> Equations shown in SI (MPa/mm/N) form with in-lb (psi) coefficient equivalents in brackets for
> `sqrt(f'c)` terms: `0.083 ↔ 1`, `0.17 ↔ 2`, `0.25 ↔ 3`, `0.33 ↔ 4`, `0.42 ↔ 5`, `0.5 ↔ 6`,
> `0.66 ↔ 8`, `0.83 ↔ 10`, and the `sqrt(f'c) <= 8.3 MPa` cap ↔ `100 psi`.

**Verification status (all former `FLAG(318-19-en)` items resolved against the English edition):**

1. 11.6.1/11.6.2 threshold: confirmed `0.5*phi*alpha_c*lambda*sqrt(f'c)*Acv`.
2. Eq. (18.10.6.2b): confirmed `delta_c/hwcs = (1/100)*(4 - (1/50)*(lw/b)*(c/b) - Ve/(8*sqrt(f'c)*Acv))`
   — shear term uses **Ve** (amplified) with `8*sqrt(f'c)*Acv` (in-lb); `delta_c/hwcs` need not be taken
   less than 0.015 (a floor on computed capacity, not a demand cap).
3. 18.10.3.1.3: confirmed `ns >= 0.007*hwcs` (in-lb edition, hwcs in inches; commentary: accounts for
   buildings with large story heights).
4. 18.10.4.6: confirmed verbatim — "The requirements of 21.2.4.1 shall not apply to walls or wall piers
   designed according to 18.10.6.2." (R18.10.4.6: such walls are flexure-controlled with amplified shear.)
5. Section numbering correction: in 318-19, **18.10.9 = Ductile coupled walls** (new provision);
   construction joints = **18.10.10**; discontinuous walls = **18.10.11** (the scan/318-14 numbering
   was off by one; Part B below uses the correct 318-19 numbers).
6. Spot-checked in-lb coefficients all match: 11.5.4.3 (αc = 3/2), 11.5.4.2 cap (8√f'c·Acv),
   Eq. 11.5.4.4 (`2*(1 + Nu/(500*Ag))`), 18.10.2.1 (`λ√f'c·Acv`), 18.10.2.2 (`2λ√f'c·Acv`),
   18.10.2.4 (`6√f'c/fy`), 18.10.6.5(b) (`400/fy`), Table 21.2.2 transition
   (`0.65 + 0.25*(eps_t - eps_ty)/0.003`, tension-controlled at `eps_ty + 0.003`).

---

## PART A — CHAPTER 11: WALLS (non-seismic / ordinary walls)

### 11.1 — Scope
- **Section:** 11.1.1–11.1.6
- **Equation:** none
- **Limits/Applicability:** Applies to cast-in-place, plant-precast, and site-precast (tilt-up) walls, prestressed and nonprestressed. **11.1.2: special structural walls must comply with Chapter 18 (detailing per 18.10)** — this is the routing switch for the tool: ordinary wall → Ch 11; special seismic wall → 18.10 (+ Ch 11 where not superseded). 11.1.3: plain concrete walls → Ch 14. 11.1.4: cantilever retaining walls → Ch 13.
- **Notes:** [Commentary R11.1.2] "structural wall" ≡ "shear wall"; Ch 11 governs in-plane shear for ordinary walls.

### 11.2.3 — Distribution of concentrated loads
- **Section:** 11.2.3.1
- **Equation:** effective horizontal bearing length per concentrated load = `min(center-to-center spacing of loads, bearing width + 4*h)`
- **Variables:** h = wall thickness (mm).
- **Limits:** effective length shall not extend across vertical wall joints unless designed for force transfer.

### 11.2.4.2 — Wall/floor interface concrete strength
- **Section:** 11.2.4.2
- **Equation:** if `Pu > 0.2*f'c*Ag`, concrete within the floor-system thickness must have `f'c_joint >= 0.8*f'c_wall`.
- **Notes:** checker-level warning, not a strength calc.

### 11.3.1 — Minimum wall thickness (Table 11.3.1.1)
- **Section:** 11.3.1.1
- **Table 11.3.1.1:**
  | Wall type | Minimum h |
  |---|---|
  | Bearing [1] | greater of **100 mm (4 in.)** and **(1/25) × min(unsupported length, unsupported height)** |
  | Nonbearing | greater of **100 mm (4 in.)** and **(1/30) × min(unsupported length, unsupported height)** |
  | Exterior basement & foundation [1] | **190 mm (7.5 in.)** |
- **Limits:** Footnote [1]: the bearing and basement rows apply **only to walls designed by the simplified method 11.5.3**. Thinner walls permitted if adequate strength and stability demonstrated by analysis.

### 11.4 — Required strength
- **Section:** 11.4.1.1–11.4.1.4, 11.4.2.1, 11.4.3.1
- **Equation:** 11.4.2.1: design for max `Mu` accompanying each `Pu`; `Pu <= phi*Pn,max` with `Pn,max` per 22.4.2.1 and **phi = compression-controlled value from Table 21.2.2 (0.65 for tied)**; magnify Mu for slenderness per 6.6.4/6.7/6.8 (or use 11.8 out-of-plane).
- **Notes:** 11.4.3.1: design for max in-plane Vu **and** max out-of-plane Vu. No effective-flange-width rule exists in Ch 11 — flanges are only codified for special walls (18.10.5.2).

### 11.5.1 — Design strength (governing inequality)
- **Section:** 11.5.1.1–11.5.1.2
- **Equation:** at every section: `phi*Pn >= Pu`, `phi*Mn >= Mu`, `phi*Vn >= Vu`; **P–M interaction shall be considered**; phi per 21.2.

### 11.5.2 — Axial + flexure
- **Section:** 11.5.2.1–11.5.2.2
- **Equation:** bearing walls: Pn, Mn (in-plane and out-of-plane) per **22.4** (full interaction). Nonbearing walls: Mn per 22.3.
- **Notes:** alternative for out-of-plane only: 11.5.3.

### 11.5.3 — Simplified design method (out-of-plane axial)
- **Section:** 11.5.3.1–11.5.3.4 / **Eq. (11.5.3.1)**
- **Equation:** `Pn = 0.55*f'c*Ag*[1 - (k*lc/(32*h))^2]`
- **Variables:** Ag mm², lc = unsupported height (mm), h = thickness (mm), k = effective length factor per **Table 11.5.3.2**: braced + rotation-restrained end(s) → **0.8**; braced + unrestrained both ends → **1.0**; unbraced → **2.0**.
- **Limits:** only for **solid rectangular sections** with the factored load resultant **within the middle third of h** (e ≤ h/6). phi = compression-controlled value (0.65). Reinforcement still must satisfy 11.6.
- **Notes:** this is what activates the Table 11.3.1.1 minimum-thickness rows.

### 11.5.4 — In-plane shear strength
- **Section:** 11.5.4.1–11.5.4.4 / **Eq. (11.5.4.3), Eq. (11.5.4.4)**
- **Equations:**
  - `Vn = (alpha_c*lambda*sqrt(f'c) + rho_t*fyt) * Acv` (Eq. 11.5.4.3)
  - `alpha_c = 0.25 [3]` for `hw/lw <= 1.5`; `alpha_c = 0.17 [2]` for `hw/lw >= 2.0`; **linear interpolation** for 1.5 < hw/lw < 2.0  (SI [psi] coefficients)
  - Cap (11.5.4.2): `Vn <= 0.66 [8] *sqrt(f'c)*Acv` at any horizontal section
  - Net axial **tension** (Eq. 11.5.4.4): `alpha_c = 0.17*(1 + Nu/(3.5*Ag)) >= 0` (SI), **Nu negative for tension** (N, Ag mm²). In-lb form: `2*(1 + Nu/(500*Ag))`.
- **Variables:** Acv = gross area bounded by web thickness h and wall length lw (**Acv = h·lw**, per R11.5.4.2 — the 318-19 cap dropped from 10 to 8 precisely because Acv replaced h·d); rho_t = distributed horizontal reinforcement ratio; fyt; lambda per 19.2.4.
- **Limits:** hw/lw shall be taken as the **larger of** the entire-wall ratio and the segment ratio. Alternative for `hw/lw < 2`: strut-and-tie (Ch 23). Reinforcement must still satisfy 11.6, 11.7.2, 11.7.3.

### 11.5.5 — Out-of-plane shear
- **Section:** 11.5.5.1 → `Vn` per **22.5** (see Part D).

### 11.6 — Reinforcement limits (minimum rho_l, rho_t)
- **Section:** 11.6.1, 11.6.2 / **Eq. (11.6.2)**
- **Threshold:** if `Vu <= 0.5*phi*alpha_c*lambda*sqrt(f'c)*Acv` (in-plane) → Table 11.6.1 minimums; if `Vu >` that threshold → 11.6.2. **[Implement 0.5 — see flag 2.]**
- **Table 11.6.1 — minimum distributed reinforcement (cast-in-place):**
  | Reinf. type | Bar size | fy (MPa) | min rho_l | min rho_t |
  |---|---|---|---|---|
  | Deformed bars | ≤ No. 16 (No. 5) | ≥ 420 (60 ksi) | **0.0012** | **0.0020** |
  | Deformed bars | ≤ No. 16 (No. 5) | < 420 | **0.0015** | **0.0025** |
  | Deformed bars | > No. 16 (No. 5) | any | **0.0015** | **0.0025** |
  | WWR ≤ MW/MD200 | — | any | **0.0012** | **0.0020** |
  | Precast (bars or WWR) | any | any | **0.0010** | **0.0010** |
- **11.6.2 (high-shear case):** (a) `rho_l >= max(0.0025, 0.0025 + 0.5*(2.5 - hw/lw)*(rho_t - 0.0025))`, but **need not exceed the rho_t required for strength by 11.5.4.3**; (b) `rho_t >= 0.0025`.
- **Notes:** [R11.6.2] for hw/lw > 2.5 Eq. (11.6.2) collapses to 0.0025; for squat walls vertical steel requirement rises toward the horizontal amount.

### 11.7 — Reinforcement detailing (spacing, curtains, ties, openings)
- **Section:** 11.7.1–11.7.5
- **Spacing — cast-in-place:** longitudinal (vertical) bars: `s <= min(3h, 450 mm [18 in.])`; **if shear reinforcement is required for in-plane strength, additionally s <= lw/3** (11.7.2.1). Transverse (horizontal) bars: `s <= min(3h, 450 mm [18 in.])`; if required for in-plane strength, additionally **s <= lw/5** (11.7.3.1).
- **Spacing — precast:** `s <= min(5h, 450 mm exterior / 750 mm interior)`; if shear reinforcement required: long. `s <= min(3h, 450, lw/3)`, transv. `s <= min(3h, 450, lw/5)` (11.7.2.2 / 11.7.3.2).
- **Two curtains (ordinary walls):** walls **thicker than 250 mm (10 in.)** (except single-story basement walls and cantilever retaining walls) require distributed reinforcement in **two layers** near each face (11.7.2.3).
- **Ties:** if longitudinal reinforcement is used as compression reinforcement and `Ast > 0.01*Ag`, it must be laterally tied (11.7.4.1).
- **Openings:** ≥ 2 No. 16 (No. 5) bars both directions (two-curtain walls) or 1 No. 16 (single curtain) around openings, anchored to develop fy at corners (11.7.5.1).
- **Notes:** cover per 20.5.1; development per 25.4; splices per 25.5 (11.7.1).

### 11.8 — Alternative out-of-plane slender wall method (secondary for a shear-wall tool)
- **Section:** 11.8.1–11.8.4
- **Applicability (11.8.1.1):** (a) constant cross section over height; (b) tension-controlled out-of-plane; (c) `phi*Mn >= Mcr` (fr per 19.2.3); (d) `Pu at mid-height <= 0.06*f'c*Ag`; (e) service Delta_s (incl. P-Delta) ≤ `lc/150`.
- **Equations:** `Mu = Mua + Pu*Delta_u` (11.8.3.1a); `Delta_u = 5*Mu*lc^2/(0.75*48*Ec*Icr)` (11.8.3.1b); `Icr = (Es/Ec)*(As + (Pu/fy)*(h/(2d)))*(d-c)^2 + lw*c^3/3`, with `Es/Ec >= 6` (11.8.3.1c); direct form `Mu = Mua/(1 - 5*Pu*lc^2/(0.75*48*Ec*Icr))` (11.8.3.1d). Service deflection: bilinear per Table 11.8.4.1 with `Delta_cr = 5*Mcr*lc^2/(48*Ec*Ig)`, `Delta_n = 5*Mn*lc^2/(48*Ec*Icr)`, `Ma = Msa + Ps*Delta_s` (iterative).

---

## PART B — SECTION 18.10: SPECIAL STRUCTURAL WALLS (seismic)

### 18.10.1 — Scope
- **Section:** 18.10.1.1–18.10.1.2
- **Notes:** covers special walls, ductile coupled walls, coupling beams, wall piers. Precast special walls also need 18.11. [Commentary Table R18.10.1] segment classification: a vertical segment with `hw/lw >= 2` and `lw/bw <= 6` is a **wall pier** (→ 18.10.8); otherwise design as wall (`hw/lw < 2` any lw/bw, or lw/bw > 6).

### 18.10.2.1 — Minimum distributed web reinforcement
- **Section:** 18.10.2.1
- **Equation/Limits:** `rho_l >= 0.0025` and `rho_t >= 0.0025`, **except** if `Vu <= 0.083 [1] *lambda*sqrt(f'c)*Acv` the minimums may be reduced to the Ch 11 values (Table 11.6.1). Spacing each way `<= 450 mm (18 in.)`. Reinforcement contributing to Vn must be continuous and distributed across the shear plane.

### 18.10.2.2 — Two curtains trigger (seismic)
- **Section:** 18.10.2.2
- **Equation:** two curtains required if `Vu > 0.17 [2] *lambda*sqrt(f'c)*Acv` **OR** `hw/lw >= 2.0` (entire wall; the hw/lw trigger is new in 318-19).

### 18.10.2.3 — Development and splices
- **Section:** 18.10.2.3 (a)–(d)
- **Limits:** (a) longitudinal bars extend ≥ 3.6 m (12 ft) past the point no longer required for flexure (≤ ld above next floor, except at top); (b) where yielding is likely, `ld = 1.25 × ld(fy)`; (c) **lap splices prohibited** in boundary regions over height `hsx above + ld below` critical sections (hsx ≤ 6 m (20 ft)); (d) mechanical splices per 18.2.7, welded per 18.2.8.

### 18.10.2.4 — Minimum longitudinal reinforcement at wall ends (NEW 318-19)
- **Section:** 18.10.2.4 (a)–(c)
- **Equation:** for walls/piers with `hw/lw >= 2.0`, continuous base-to-top, single critical section: within `0.15*lw` from each end (over one wall thickness): `rho >= 0.5*sqrt(f'c)/fy` (SI; ↔ `6*sqrt(f'c)/fy` psi).
- **Limits:** (b) extend vertically above/below critical section ≥ `max(lw, Mu/(3*Vu))`; (c) terminate ≤ 50% of it at any one section.

### 18.10.3 — Design shear force (amplified)
- **Section:** 18.10.3.1, 18.10.3.1.1–18.10.3.1.3 / **Eq. (18.10.3.1), Table 18.10.3.1.2, Eq. (18.10.3.1.3)**
- **Equation:** `Ve = Omega_v * omega_v * Vu <= 3*Vu`
- **Omega_v (overstrength), Table 18.10.3.1.2:** `hwcs/lw > 1.5` → `Omega_v = max(Mpr/Mu, 1.5)` (Mpr/Mu for the combination maximizing it; the 1.5 floor may be reduced by detailed analysis but never < 1.0); `hwcs/lw <= 1.5` → `Omega_v = 1.0`.
- **omega_v (dynamic amplification), Eq. 18.10.3.1.3:** for `hwcs/lw < 2.0` → `omega_v = 1.0`; otherwise `omega_v = 0.9 + ns/10` for `ns <= 6`; `omega_v = 1.3 + ns/30 <= 1.8` for `ns > 6`; ns = stories above critical section, with floor `ns >= 0.007*hwcs` (hwcs in inches — see flag 4).
- **Variables:** hwcs = height of wall above the critical section; Mpr = probable flexural strength (1.25*fy, phi = 1.0); Vu, Mu = factored analysis values at critical section.

### 18.10.4 — Shear strength
- **Section:** 18.10.4.1–18.10.4.6 / **Eq. (18.10.4.1)**
- **Equations:**
  - `Vn = (alpha_c*lambda*sqrt(f'c) + rho_t*fyt) * Acv`; `alpha_c = 0.25 [3]` (hw/lw ≤ 1.5), `0.17 [2]` (hw/lw ≥ 2.0), linear interp between (identical to 11.5.4.3).
  - **18.10.4.2:** hw/lw for a segment = **greater of** entire-wall ratio and segment ratio.
  - **18.10.4.3:** distributed reinforcement in two orthogonal directions; if `hw/lw <= 2.0` then **rho_l >= rho_t**.
  - **18.10.4.4 caps:** all vertical segments sharing a common lateral force: `Vn_total <= 0.66 [8] *sqrt(f'c)*Acv`; each individual vertical segment (pier): `Vn <= 0.83 [10] *sqrt(f'c)*Acw`.
  - **18.10.4.5:** horizontal wall segments and coupling beams: `Vn <= 0.83 [10] *sqrt(f'c)*Acw` (rho_t = vertical steel for horizontal segments).
- **18.10.4.6 (verified verbatim):** "The requirements of 21.2.4.1 shall not apply to walls or wall piers designed according to 18.10.6.2" — walls on the displacement-based path keep phi=0.75 (R18.10.4.6: they are flexure-controlled and their shear is already amplified).

### 18.10.5 — Flexure and axial force
- **Section:** 18.10.5.1–18.10.5.2
- **Equation:** P–M interaction per **22.4**, including concrete and developed longitudinal steel in the effective flange, boundary elements, and web; consider openings.
- **Effective flange width (18.10.5.2):** from web face, the **lesser of** half the distance to an adjacent wall web and **25% of the total wall height above the section**.

### 18.10.6.1 — Boundary element method selection
- **Section:** 18.10.6.1
- **Logic:** use **18.10.6.2** (displacement-based) if `hwcs/lw >= 2.0`, wall continuous base-to-top with a single critical section; **otherwise 18.10.6.3** (stress-based). In all cases also satisfy 18.10.6.4 (if SBE required) and 18.10.6.5 (if not).

### 18.10.6.2 — Displacement-based special boundary element trigger
- **Section:** 18.10.6.2(a),(b) / **Eq. (18.10.6.2a), Eq. (18.10.6.2b)**
- **Trigger (a):** SBE required when `1.5*delta_u/hwcs >= lw/(600*c)` (equivalently `c >= lw/(600*1.5*delta_u/hwcs)`), with `delta_u/hwcs >= 0.005` floor; c = **largest** neutral axis depth for factored axial force and nominal moment strength consistent with delta_u.
- **If required (b):** (i) SBE transverse reinforcement extends vertically above/below the critical section ≥ `max(lw, Mu/(4*Vu))`; AND either (ii) `b >= sqrt(0.025*c*lw)` or (iii) drift-capacity check (NEW 318-19): `delta_c/hwcs >= 1.5*delta_u/hwcs` where `delta_c/hwcs = (1/100)*[4 - (1/50)*(lw/b)*(c/b) - Ve/(0.66 [8] *sqrt(f'c)*Acv)]`, need not be taken < **0.015**. (Uses Ve — see flag 3.)
- **Variables:** b = width of flexural compression zone (flange width at flanged ends per 18.10.5.2, wall thickness at rectangular ends); delta_u = design displacement (= Cd * delta_e per ASCE 7).

### 18.10.6.3 — Stress-based special boundary element trigger
- **Section:** 18.10.6.3
- **Equation:** SBE required at edges and around openings where extreme-fiber compressive stress under factored loads incl. E exceeds **`0.2*f'c`**; may be **discontinued** where stress < **`0.15*f'c`**. Stresses from a **linear-elastic gross-section model** (`sigma = Pu/Ag + Mu*y/Ig`, with flanged properties per 18.10.5.2).

### 18.10.6.4 — Special boundary element detailing
- **Section:** 18.10.6.4(a)–(k) / **Table 18.10.6.4(g)**
- **(a) Horizontal length of SBE:** ≥ `max(c - 0.1*lw, c/2)` from extreme compression fiber.
- **(b) Minimum width:** `b >= hu/16` over that length (hu = laterally unsupported height at extreme compression fiber).
- **(c):** if `hw/lw >= 2.0`, continuous single-critical-section wall, and `c/lw >= 3/8` → `b >= 300 mm (12 in.)`.
- **(d) Flanges:** include effective flange in compression; extend SBE ≥ 300 mm (12 in.) into the web.
- **(e) Transverse reinforcement:** per 18.7.5.2(a)–(d) and 18.7.5.3, except 18.7.5.3(a) spacing limit = one-third of least SBE dimension; vertical spacing also per Table 18.10.6.5(b).
- **(f) hx:** spacing of laterally supported longitudinal bars around perimeter ≤ `min(350 mm [14 in.], (2/3)*b_be)`; hoop leg length ≤ 2×SBE width; overlapping hoops lap ≥ `min(150 mm [6 in.], (2/3)*b_be)`.
- **(g) Amount — Table 18.10.6.4(g):** rectilinear hoops: `Ash/(s*bc) >= max(0.3*(Ag/Ach - 1)*f'c/fyt, 0.09*f'c/fyt)`; spirals/circular hoops: `rho_s >= max(0.45*(Ag/Ach - 1)*f'c/fyt, 0.12*f'c/fyt)`. For rectangular SBEs, Ag = lbe·b, Ach = core to outside of hoops (bc1·bc2).
- **(h):** floor-system concrete at SBE ≥ `0.7*f'c_wall`.
- **(i):** over the 18.10.6.2(b)(i) height, web vertical bars need lateral support (hoop corner or crosstie w/ seismic hooks), vertical spacing ≤ 300 mm (12 in.).
- **(j):** SBE transverse reinforcement extends into support ≥ ld of largest SBE bar; ≥ 300 mm (12 in.) into footing/mat/pile cap (more if 18.13.2.4 requires).
- **(k):** horizontal web reinforcement extends to within 150 mm (6 in.) of the wall end and is anchored to develop fy within the confined core (standard hook/head); may terminate straight if the core can develop it and web `As*fy/s` ≤ boundary parallel transverse `As*fyt/s`.

> Eq. (18.10.6.2b) verified from the English edition: `delta_c/hwcs = (1/100)*(4 - (1/50)*(lw/b)*(c/b) - Ve/(8*sqrt(f'c)*Acv))` (in-lb), floor 0.015 on the computed capacity.

### 18.10.6.5 — Where SBE not required (ordinary boundary detailing)
- **Section:** 18.10.6.5(a),(b) / **Table 18.10.6.5(b)**
- **(a):** unless `Vu < 0.083 [1] *lambda*sqrt(f'c)*Acv`, horizontal reinforcement at wall edges without boundary elements must terminate in a standard hook engaging edge reinforcement, or use spliced U-stirrups.
- **(b) Tie trigger:** if boundary longitudinal `rho > 2.8/fy` (MPa; ↔ `400/fy` psi), provide boundary transverse reinforcement per 18.7.5.2(a)–(e) over the 18.10.6.4(a) length, with vertical spacing per **Table 18.10.6.5(b):**
  | Reinf. grade | Location | Max vertical spacing |
  |---|---|---|
  | 420 (60) | within `max(lw, Mu/(4Vu))` of critical sections | min(6db, 150 mm [6 in.]) |
  | 420 (60) | other | min(8db, 200 mm [8 in.]) |
  | 550 (80) | within critical region | min(5db, 150 mm) |
  | 550 (80) | other | min(6db, 150 mm) |
  | 690 (100) | within critical region | min(4db, 150 mm) |
  | 690 (100) | other | min(6db, 150 mm) |
  (db = smallest primary flexural bar diameter.)

### 18.10.7 — Coupling beams (post-MVP)
- **18.10.7.1:** `ln/h >= 4` → design per 18.6 (SMF beam rules).
- **18.10.7.2 (diagonal trigger):** `ln/h < 2` AND `Vu >= 0.33 [4] *lambda*sqrt(f'c)*Acw` → **two intersecting diagonal bar groups required** (unless loss of the beam is shown not to impair gravity capacity/egress).
- **18.10.7.3:** intermediate cases — either diagonal groups or 18.6.3–18.6.5.
- **18.10.7.4 / Eq. (18.10.7.4):** `Vn = 2*Avd*fy*sin(alpha) <= 0.83 [10] *sqrt(f'c)*Acw`; each group ≥ 4 bars in ≥ 2 layers; confinement per-diagonal (option c) or full-section (option d). Diagonal bar development = 1.25×ld (18.10.2.5(b)). phi for shear = **0.85** (21.2.4.4).

### 18.10.8 — Wall piers
- **Section:** 18.10.8.1–18.10.8.2
- **Logic:** wall piers satisfy SMF column provisions 18.7.4/18.7.5/18.7.6 (joint faces = top/bottom of clear height); **alternative for `lw/bw > 2.5`:** (a) design shear per 18.7.6.1, capped by `Omega_o × analysis shear`; (b) Vn and distributed reinforcement per 18.10.4; (c) closed hoops (single-leg horizontal bars with 180° hooks allowed for single-curtain piers); (d) transverse spacing ≤ 150 mm (6 in.); (e) extend transverse reinforcement ≥ 300 mm (12 in.) above/below clear height; (f) SBE where required by 18.10.6.3. 18.10.8.2: piers at a wall edge need horizontal reinforcement in adjacent segments above/below to transfer the pier's design shear.

### 18.10.9 — Ductile coupled walls (verified from English edition; post-MVP)
- **18.10.9.2:** individual walls satisfy `hwcs/lw >= 2` and the applicable special-wall provisions of 18.10.
- **18.10.9.3:** coupling beams satisfy 18.10.7 and, in the direction considered: (a) `ln/h >= 2` at all levels; (b) all coupling beams at a floor level have `ln/h <= 5` in at least 90% of the levels; (c) 18.10.2.5 satisfied at both ends of all coupling beams.

### 18.10.10 — Construction joints (verified from English edition)
- **18.10.10.1:** construction joints in structural walls specified per 26.5.6; contact surfaces roughened consistent with condition (b) of Table 22.9.4.2 (intentionally roughened, ~1/4 in. amplitude → mu = 1.0λ).

### 18.10.11 — Discontinuous walls (verified from English edition)
- **18.10.11.1:** columns supporting discontinuous structural walls reinforced per 18.7.5.6.

---

## PART C — CHAPTER 21: STRENGTH REDUCTION FACTORS

### Table 21.2.1 — phi by action (wall-relevant rows)
| Action | phi | Exception |
|---|---|---|
| Moment / axial / combined | **0.65–0.90 per 21.2.2** | pretensioned ends → 21.2.3 |
| **Shear** | **0.75** | seismic structures → **21.2.4** |
| Bearing | 0.65 | — |
| Plain concrete | 0.60 | — |

### 21.2.2 / Table 21.2.2 — phi for P–M (strain-based)
- **eps_ty definition (21.2.2.1):** `eps_ty = fy/Es`; for Grade 420 (60) deformed bars, `eps_ty = 0.002` permitted.
- **Table 21.2.2** (walls use the "Other" column — no spirals):
  | Net tensile strain eps_t | Class | phi (spiral) | phi (other) |
  |---|---|---|---|
  | `eps_t <= eps_ty` | compression-controlled | 0.75 | **0.65** |
  | `eps_ty < eps_t < eps_ty + 0.003` | transition | `0.75 + 0.15*(eps_t - eps_ty)/0.003` | **`0.65 + 0.25*(eps_t - eps_ty)/0.003`** |
  | `eps_t >= eps_ty + 0.003` | tension-controlled | 0.90 | **0.90** |
- **Notes:** this is the **318-19 form** — transition denominator is 0.003 and the tension-controlled limit is `eps_ty + 0.003` (not 0.005). eps_t = net tensile strain in extreme tension reinforcement at nominal strength (linear strain profile, eps_cu = 0.003). Apply the **same phi to both Pn and Mn** on the interaction diagram.

### 21.2.4 — Seismic shear phi (critical for special walls)
- **21.2.4 scope:** applies to structures relying on special moment frames, **special structural walls**, or intermediate precast walls in SDC D/E/F.
- **21.2.4.1:** phi for shear = **0.60** in any member resisting E whose **nominal shear strength is less than the shear corresponding to development of its nominal moment strength** (Mn maximized over factored axial loads of E combinations). [R21.2.4.1: targets shear-controlled members — low-rise walls, wall segments between openings.] **Interacts with 18.10.4.6:** walls designed per 18.10.6.2 (amplified-shear/displacement path) are exempt → keep phi = 0.75. (Handbook Ex. 2 nevertheless applies phi = 0.6 — follow the handbook's conservative reading for fixtures.)
- **21.2.4.4:** **diagonally reinforced coupling beams: phi = 0.85** for shear.

---

## PART D — CHAPTER 22: SECTIONAL STRENGTH

### 22.2 — Design assumptions for P–M interaction
- **Section:** 22.2.1–22.2.2 / **Eq. (22.2.2.4.1), Table 22.2.2.4.3**
- **Assumptions:** equilibrium + plane sections; max concrete strain **0.003**; concrete tension neglected; rectangular stress block: uniform `0.85*f'c` over depth `a = beta1*c`.
- **Table 22.2.2.4.3 (beta1):** SI: `17 <= f'c <= 28` → **0.85**; `28 < f'c < 55` → **`0.85 - 0.05*(f'c - 28)/7`**; `f'c >= 55` → **0.65**. In-lb: `2500 <= f'c <= 4000` psi → 0.85; `4000 < f'c < 8000` → `0.85 - 0.05*(f'c - 4000)/1000`; `>= 8000` → 0.65.
- **Steel:** elastic-perfectly-plastic, Es per 20.2.2.

### 22.3 / 22.4 — Flexural and axial strength
- **22.3.1.1:** Mn from the 22.2 assumptions (strain-compatibility section analysis — the basis of the P–M surface).
- **22.4.2.1 / Table 22.4.2.1:** `Pn <= Pn,max = 0.80*Po` (tied — the wall case) or `0.85*Po` (spiral). **fy capped at 550 MPa (80 ksi)** for this calculation.
- **Eq. (22.4.2.2):** `Po = 0.85*f'c*(Ag - Ast) + fy*Ast`.
- **22.4.3.1 / Eq. (22.4.3.1):** axial tension cap: `Pnt,max = fy*Ast` (nonprestressed).

### 22.5 — One-way shear (wall out-of-plane path, per 11.5.5.1)
- **Eq. (22.5.1.1):** `Vn = Vc + Vs`.
- **Eq. (22.5.1.2) section cap:** `Vu <= phi*(Vc + 0.66 [8] *sqrt(f'c)*bw*d)`.
- **22.5.3.1:** `sqrt(f'c) <= 8.3 MPa [100 psi]` in Vc calcs. **22.5.3.3:** fy, fyt for Vs ≤ 420 MPa (60 ksi).
- **Table 22.5.5.1 (Vc, nonprestressed):**
  - `Av >= Av,min` (either): (a) `Vc = (0.17 [2] *lambda*sqrt(f'c) + Nu/(6*Ag))*bw*d` or (b) `Vc = (0.66 [8] *lambda*rho_w^(1/3)*sqrt(f'c) + Nu/(6*Ag))*bw*d`
  - `Av < Av,min`: (c) `Vc = (0.66 [8] *lambda_s*lambda*rho_w^(1/3)*sqrt(f'c) + Nu/(6*Ag))*bw*d`
  - **Nu positive in compression, negative in tension; Vc >= 0.**
- **Limits:** `Vc <= 0.42 [5] *lambda*sqrt(f'c)*bw*d` (22.5.5.1.1); `Nu/(6*Ag) <= 0.05*f'c` (22.5.5.1.2); size effect `lambda_s = sqrt(2/(1 + 0.004*d)) <= 1.0` (d in mm; in-lb: `sqrt(2/(1 + d/10))`, d in in.). rho_w = As/(bw·d), As countable = bars farther than (2/3)h from the compression fiber [R22.5.5.1]. Av,min per 9.6.3.4.
- **Vs:** where `Vu > phi*Vc`, `Vs >= Vu/phi - Vc` (22.5.8.1); `Vs = Av*fyt*d/s` (22.5.8.5.3); inclined: `Vs = Av*fyt*(sin(alpha)+cos(alpha))*d/s` (22.5.8.5.4).

### 22.9 — Shear friction (sliding shear at construction joints / wall base)
- **Scope (22.9.1.1):** shear transfer across a crack, dissimilar-material interface, or **cold joint**. `fy <= 420 MPa (60 ksi)` (22.9.1.3).
- **Governing:** `phi*Vn >= Vu` (phi = 0.75 shear).
- **Eq. (22.9.4.2):** perpendicular reinforcement: `Vn = mu*Avf*fy`.
- **Table 22.9.4.2 (mu):** monolithic **1.4·lambda**; hardened concrete intentionally roughened to ~6 mm (1/4 in.) amplitude **1.0·lambda**; not roughened **0.6·lambda**; against structural steel w/ studs **0.7·lambda**.
- **Eq. (22.9.4.3):** inclined reinforcement in tension: `Vn = Avf*fy*(mu*sin(alpha) + cos(alpha))`; bar in compression → shear friction does not apply.
- **Table 22.9.4.4 (Vn cap):** monolithic or roughened normalweight: `Vn <= min(0.2*f'c*Ac, (3.3 + 0.08*f'c)*Ac, 11*Ac)` (SI stresses; in-lb: `min(0.2*f'c*Ac, (480 + 0.08*f'c)*Ac, 1600*Ac)` psi); other cases: `Vn <= min(0.2*f'c*Ac, 5.5*Ac)` (in-lb: `800*Ac` psi).
- **22.9.4.5:** permanent net compression may be **added to Avf·fy**. **22.9.4.6:** net factored tension requires **additional** reinforcement. **22.9.5.1:** Avf developed for fy both sides.

---

## Implementation flow (calc-trace order)

1. **Classify:** ordinary (Ch 11) vs special (18.10) via SDC/system; classify vertical segments as walls vs wall piers (Table R18.10.1: pier if hw/lw ≥ 2 and lw/bw ≤ 6).
2. **Geometry/limits:** min thickness (Table 11.3.1.1, only if simplified method), Acv = h·lw, effective flanges (18.10.5.2, special only).
3. **Minimum reinforcement + curtains:** ordinary → 11.6 threshold + Table 11.6.1 / Eq. 11.6.2 + 11.7 spacing + 11.7.2.3 (>10 in. → 2 curtains); special → 18.10.2.1, 18.10.2.2 two-curtain triggers, 18.10.2.4 end-zone rho, plus rho_l ≥ rho_t when hw/lw ≤ 2 (18.10.4.3).
4. **Shear demand:** ordinary → Vu; special → `Ve = Omega_v·omega_v·Vu ≤ 3Vu` (18.10.3).
5. **Shear capacity:** `Vn = (alpha_c·lambda·sqrt(f'c) + rho_t·fyt)·Acv`, alpha_c by hw/lw (max of wall/segment ratio), tension modification Eq. 11.5.4.4 (ordinary), caps `8√f'c·Acv` total / `10√f'c·Acw` per segment; phi = 0.75, dropped to 0.60 per 21.2.4.1 when Vn < shear @ Mn (unless exempt via 18.10.4.6).
6. **P–M interaction:** fiber/strain-compatibility section per 22.2 (eps_cu = 0.003, block 0.85f'c·beta1·c), caps Pn,max = 0.80·Po and Pnt,max = fy·Ast (22.4), phi from Table 21.2.2 via eps_t, check all load pairs.
7. **Boundary elements (special):** method select 18.10.6.1 → displacement trigger Eq. 18.10.6.2a (+ width/drift-capacity Eq. 18.10.6.2b) or stress trigger 0.2f'c/0.15f'c (18.10.6.3) → SBE geometry + Ash (18.10.6.4) or non-SBE ties (rho > 400/fy psi, Table 18.10.6.5(b)).
8. **Secondary checks:** out-of-plane shear (22.5), sliding shear at joints (22.9), wall piers (18.10.8); coupling beams (18.10.7, phi = 0.85) post-MVP.
