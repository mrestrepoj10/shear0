# MNL-17(21) Vol. 1 — Structural (Shear) Wall Design Examples — Test Fixture Source

> Extracted from the ACI Reinforced Concrete Design Handbook MNL-17(21) Vol. 1
> (`references/aci-design-handbook-mnl-17-21.pdf`) on 2026-08-13.
> Chapter 10 "Structural Reinforced Concrete Walls," printed pp. 433–466 = PDF pp. 434–467.
> These two examples are the **verification oracle** for `@shear0/engine` — every numeric intermediate
> below becomes a test assertion (see tolerance policy in PLAN.md).

**Chapter inventory of worked examples (there are exactly two):**
1. **Shear Wall Example 1** — SDC B / wind-governed ordinary wall (printed pp. 444–450)
2. **Shear Wall Example 2** — SDC D special structural wall with special boundary element (printed pp. 451–466)

Other wall content in Vol. 1: Ch. 11 §11.6 is retaining walls (foundations context); the seismic chapters
are in Volume 2 (not in our PDF). No other shear-wall worked examples exist in Volume 1.

**Chapter discussion highlights (10.1–10.5):**
- Two LFRS wall categories: ordinary cast-in-place walls (SDC A/B/C, Code Ch. 11) and special structural walls (required SDC D/E/F, Ch. 11 + 18.10).
- Min thickness (Table 11.3.1.1): bearing ≥ greater of 4 in. and 1/25 of lesser of unsupported length/height; nonbearing 1/30; basement/foundation 7.5 in.
- Ωv (Table 18.10.3.1.2): hwcs/ℓw > 1.5 → greater of Mpr/Mu and 1.5; else 1.0. ωv = 0.9 + ns/10 (ns ≤ 6); 1.3 + ns/30 ≤ 1.8 (ns > 6); ns ≥ 0.007·hwcs (in.); Ωv·ωv need not exceed 3.0.
- ASCE 7 R/Cd (bearing wall systems): special RC shear walls R=5, Cd=5; ordinary R=4, Cd=4. (Building frame: special R=6, Cd=5; ordinary R=5, Cd=4.5. Dual w/ SMF: special R=7, Cd=5.5; ordinary R=6, Cd=5.)

---

## Example 1 — Shear Wall, SDC B / wind (ordinary wall, Ch. 11)

### Problem statement
- Hotel LFRS, N-S direction; one shear wall at each end; nonprestressed; design at wall base only. Demands from elastic 3D FEA.
- **Geometry:** ℓw = 28 ft (336 in.); h = 12 in.; hw = 92 ft; first-story unsupported height = 18 ft; out-of-plane ℓc = 202 in., k = 0.8; cover 1.5 in. (exterior, Table 20.5.1.3.1).
- **Materials:** f'c = 5000 psi, fy = 60,000 psi (Grade 60, uncoated).
- **Demands at base (governing combo):** Pu = 1015 kip; in-plane Vu = 235 kip, Mu = 18,600 ft-kip; out-of-plane Vu = 16 kip, Mu = 60 ft-kip.

### Calculation steps

| Step | ACI 318-19 ref | Formula | Substitution | Result |
|---|---|---|---|---|
| 1. Thickness check | 11.3.1 (Table 11.3.1.1) | h ≥ greater of 4 in. and (lesser unsupported ht/length)/25 | (18 ft)(12)/25 | 8.64 in. < h = 12 in. **OK** |
| 1. Cover | 20.5.1.3.1 | — | exterior exposure | 1.5 in. |
| 4. Flexure+axial (in-plane) | 11.5, 11.5.2 | Interaction diagram (φ included); No. 5 @ 12 in. e.f.; end pair 3 in. from wall end, next pair at 12 in., rest @ 12 in. | at Pu = 1015 kip | φMn = 24,600 ft-kip > Mu = 18,600 ft-kip **OK** |
| 5. Max shear cap | 11.5.4.2 | φVn,max = φ·8√f'c·Acv | Acv = 12(336) = 4032 in.²; 0.75(8)√5000(4032) | φVn,max = 1711 kip > 235 kip **OK** |
| 5. In-plane Vn | 11.5.4.3 | Vn = (αc·λ√f'c + ρt·fyt)Acv; αc = 3 (hw/ℓw ≤ 1.5), 2 (≥ 2), interp between | hw/ℓw = 92/28 = 3.3 > 2 → αc = 2; Vn = 2√5000(4032), ρt term ignored | Vn = 570 kip; φVn = 428 kip > 235 kip **OK** (concrete alone) |
| 6. Out-of-plane e | 11.5.3.1 | e = Mu/Pu ≤ h/6 | 60 ft-kip/1015 kip → e = 0.7 in. | e < 2 in. → simplified method applies |
| 6. Simplified Pn | 11.5.3.1 | Pn = 0.55f'c·Ag[1 − (kℓc/32h)²] | 0.55(5)(12)(336)[1 − ((0.8·202)/(32·12))²] | Pn = 9120 kip |
| 6. φPn | 21.2.2(b) | φ = 0.65 | 0.65(9120) | φPn = 5920 kip ≥ 1015 kip **OK** |
| 7. Min-reinf trigger | 11.6 + 21.2.1 | Vu > 0.5φ·αc·λ√f'c·Acv ? | 0.5(0.75)(2)√5000(4032) = 214 kip | 235 > 214 → use 11.6.2 minimums |
| 7. ρt provided | 11.6.2 | ρt = ΣAs/(s·h), No. 5 @ 12 e.f. | 2(0.31)/(12·12) | ρt = 0.0043 > 0.0025 **OK** |
| 7. ρℓ provided | 11.6.2 | same | 2(0.31)/(12·12) | ρℓ = 0.0043 |
| 7. ρℓ required | 11.6.2 | ρℓ ≥ 0.0025 + 0.5(2.5 − hw/ℓw)(ρt − 0.0025) ≥ 0.0025, need not exceed ρt req'd for strength | 0.0025 + 0.5(2.5 − 2)(0.0043 − 0.0025) = 0.0030; ρt req'd for strength = 0 | ρℓ,reqd = 0 → No. 5 @ 12 e.w./e.f. **OK** |
| 8. Max spacing | 11.7.2.1, 11.7.3.1 | s ≤ lesser of 3h and 18 in. | 3h = 36 → 18 governs | s = 12 in. **OK** (both directions) |
| 8. Layers | 11.7.2.3 | h > 10 in. → two curtains | h = 12 in. | Two layers **OK** |
| 8. Ties needed? | 11.7.4.1 | ties if Ast > 0.01Ag or steel resists axial | end-strip Ast/Ag = 0.62/144 = 0.0043 < 0.01; σ = 1,015,000/[(12)(28)(12)] + 223,200,000·336/37,933,056 = 2229 psi (I = 12·336³/12 = 37,933,056 in.⁴) | Ties **not required** |

### Final design (Ex. 1)
- Wall 12 in. × 28 ft × 92 ft. Vertical: No. 5 @ 12 in. e.f. (end pair 3 in. from wall end, then 9 in., then 12 in. typ.). Horizontal: No. 5 @ 12 in. e.f. Two curtains. No ties, no boundary elements.

---

## Example 2 — Special Structural Shear Wall, SDC D (Ch. 11 + 18.10)

### Problem statement
- Same hotel geometry; special structural wall; design/detailing at base; one load condition; elastic 3D FEA demands.
- **Geometry:** ℓw = 28 ft (336 in.); h = 12 in. (web); hw = hwcs = 92 ft; first story 18 ft; ns = 8 stories; hu = 216 in.; cover 1.5 in.; ℓc = 202 in., k = 0.8.
- **Materials:** f'c = 5000 psi, fy = fyt = 60,000 psi (Grade 60).
- **Demands at base:** Pu = 1015 kip; in-plane Vu = 470 kip, Mu = 37,200 ft-kip; out-of-plane Vu = 32 kip, Mu = 120 ft-kip. Max seismic-combo axial ≈ 1200 kip. Elastic top-of-wall deflection δe = 2.4 in.; Cd = 5.

### Calculation steps

| Step | ACI 318-19 ref | Formula | Substitution | Result |
|---|---|---|---|---|
| 1. Thickness | 11.3.1 (guide) | h_req'd = ht/25 | (18)(12)/25 | 8.64 in. < 12 in. **OK** |
| 4b. In-plane P–M | 11.1.2, 18.10.5, 22.4 | Interaction diagram; No. 8 @ 12 in. e.f. (end pair 3 in. from end, next at 12, rest @ 12) | at Pu = 1015 kip | φMn = 40,200 ft-kip > Mu = 37,200 ft-kip **OK** |
| 4c. Out-of-plane e | 11.5.3.1 | e = Mu/Pu | 120/1015 → e = 1.4 in. | e < 2 in. → simplified OK |
| 4c. Pn | 11.5.3.1 | Pn = 0.55f'c·Ag[1 − (kℓc/32h)²] | 0.55(5)(12)(336)[1 − ((0.8·202)/(32·12))²] | Pn = 9090 kip |
| 4c. φPn | 21.2.2(b) | φ = 0.65 | 0.65(9090) | φPn = 5900 kip ≥ 1015 **OK** |
| 4c. Out-of-plane shear | 11.5.5.1, 22.5.5.1 | φVc ≈ φ(2/3)√f'c·bw·d (simplified; ρw = 0.0012, λs = 1.0) | d = 12 − 1.5 − 0.5 − 8/16 = 9.5 in.; 0.75(2/3)√5000(336)(9.5) | φVc = 113 kip ≫ 32 kip **OK** |
| 5. ρt (No. 6 @ 12 e.f.) | 18.10.2 | ρt = As/(s·h) | 0.88/(12·12) | ρt = 0.0061 > 0.0025 **OK** |
| 5. ρℓ (No. 8 @ 12 e.f.) | 18.10.2 | ρℓ = As/(s·h) | 1.58/(12·12) | ρℓ = 0.0110 > 0.0025 **OK** |
| 5. Two curtains | 18.10.2.2 | Vu > 2Acvλ√f'c or hw/ℓw ≥ 2 | hw/ℓw = 3.3 > 2 | Required & provided **OK** |
| 6. Ωv | 18.10.3.1.2 | Ωv = Mpr/Mu ≥ 1.5 (hwcs/ℓw > 1.5); Mpr from 1.25fy, φ = 1.0 | Mpr/Mu = 51,900/37,200 = 1.4 < 1.5 | **Ωv = 1.5** |
| 6. ωv | 18.10.3.1.3 | ns ≥ 0.007hwcs (in.); ωv = 1.3 + ns/30 ≤ 1.8 (ns > 6) | 0.007(92·12) = 7.7 < 8 → ns = 8; 1.3 + 8/30 | ωv = 1.57 |
| 6. Design shear | 18.10.3.1 | Ve = Ωv·ωv·Vu ≤ 3Vu | 1.5(1.57)(470) = 1107 < 3(470) = 1410 | **Ve = 1107 kip** |
| 6. Vn | 18.10.4 | Vn = Acv(αcλ√f'c + ρt·fyt); αc = 2 | 4032(2√5000 + 0.0061·60,000) | Vn = 2045 kip |
| 6. φ selection | 21.2.4.1, 18.10.4.4 | φ = 0.6 if wall can't develop Mn without exceeding shear cap; cap = 10Acw√f'c | Pu,max ≈ 1200 → Mn-level Mu = 41,860 ft-kip; Vu@Mn = 2(41,860)/18 = 4650 kip > cap = 4032(10√5000) = 2851 kip | **φ = 0.6** |
| 6. φVn | 18.10.4 | φVn ≥ Ve | 0.6(2045) = 1227 | 1227 > 1107 **OK** — No. 8 vert @ 12, No. 6 horiz @ 12, e.f. |
| 7. SBE trigger | 18.10.6.2(a) | SBE if 1.5δu/hwcs ≥ ℓw/(600c); δu/hwcs ≥ 0.005 | c = 67.9 in. (interaction software); δu = Cd·δe = 5(2.4) = 12 in.; ℓw/600c = 336/(600·67.9) = 0.00825; δu/hwcs = 12/1104 = 0.0109; 1.5(0.0109) = 0.0163 | 0.0163 > 0.00825 → **SBE required** |
| 7. SBE vertical extent | 18.10.6.2(b) | ≥ greater of ℓw and Mu/4Vu | 336 in. vs 41,860·12/(4·470) = 267.2 in. | ≥ 336 in. (28 ft) above critical section |
| 7. Width option (a) | 18.10.6.2(b) | b ≥ √(0.025·c·ℓw) | √(0.025·67.9·336) | 23.9 in. (not used; drift option taken) |
| 7. Drift capacity, b = 12 | 18.10.6.2(b) | δc/hwcs = (1/100)[4 − (1/50)(ℓw/b)(c/b) − Ve/(8√f'c·Acv)] ≥ 1.5δu/hwcs | (1/100)[4 − (1/50)(336/12)(67.9/12) − 1,107,000/(8√5000·4032)] | 0.0035 < 0.0163 **NG** → widen |
| 7. Drift capacity, b = 16 | 18.10.6.2(b) | same, b = 16 (same c, conservative) | (1/100)[4 − (1/50)(336/16)(67.9/16) − same shear term] | **0.0173 > 0.0163 OK** → SBE width 16 in. |
| 7. SBE horiz length | 18.10.6.4(a) | ≥ greater of c − 0.1ℓw and c/2 | 67.85 − 33.6 = 34.25; 67.85/2 = 33.9 | **34 in.** |
| 7. Width min | 18.10.6.4(b) | b ≥ hu/16 | 216/16 = 13.5 | 16 ≥ 13.5 **OK** |
| 7. Slender-wall width | 18.10.6.4(c) | c/ℓw ≥ 3/8 → b ≥ 12 in. | b = 16 | **OK** |
| 7. Tie spacing | 18.10.6.4(e), 18.7.5.3 | s ≤ min(least dim/3, 6db, so); so = 4 + (14 − hx)/3 ∈ [4, 6] | 16/3 = 5.33; 6(1.0) = 6; hx = 11 → so = 5.0 | **s = 4 in.** |
| 7. Vertical spacing zones | 18.10.6.5(b) | within max(ℓw, Mu/4Vu): s ≤ min(6db, 6 in.); elsewhere min(8db, 8 in.) | 336 > 268 | 4 in. up to 28 ft above base; 8 in. above |
| 7. hx check | 18.10.6.4(f) | hx ≤ min(14 in., (2/3)b) | 2/3(16) = 10.6; hx = 11 **NG** | add 2 intermediate No. 8 per long face + mid short face → hx = (34 − 3 − 1)/3 = 10 in. **OK** |
| 7. Hoop geometry | 18.10.6.4(f) | leg ≤ 2× SBE thickness; overlap ≥ min(6 in., 2/3 b) | bc = 13; ℓ1 = 21 < 2(13) = 32 | Single perimeter hoop + crossties + stacked hoop |
| 7. Ash | 18.10.6.4(g) | Ash/(s·bc) ≥ max(0.3(Ag/Ach − 1)f'c/fyt, 0.09f'c/fyt) | Ag = 16(34) = 544; Ach = 13(31) = 403; 0.3(544/403 − 1)(5/60) = 0.00875 vs 0.09(5/60) = 0.00750 | 0.00875 → legs ≥ 0.00875(4)(13)/0.2 = 2.3 → **3 No. 4 legs** ⊥ bc |
| 7. Floor concrete | 18.10.6.4(h) | ≥ 0.7f'c,wall | 0.7(5000) | ≥ 3500 psi in floor at SBE |
| 7. Web bar support | 18.10.6.4(i), 25.7.2.2 | web verticals laterally supported, s ≤ 12 in. | — | No. 4 crossties @ 12 in. |
| 7. Into foundation | 18.10.6.4(j) | ≥ 12 in. into support | — | Extend 12 in. |
| 7. Horiz bar anchorage | 18.10.6.4(k), 25.4.3 | ℓdh = [fy·ψe·ψr·ψo·ψc/(55λ√f'c)]·db^1.5 ≥ max(8db, 6 in.) | ψe = ψr = ψo = 1.0; ψc = 5000/15,000 + 0.6 = 0.933; [60,000(0.93)/(55√5000)](0.625)^1.5 | ℓdh = 7.1 in. vs 26.5 in. available **OK** (90° hooks in SBE core) |
| — Construction joints | 18.10.10, 26.5.6, Table 22.9.4.2(b) | roughened surface | — | ~1/4 in. amplitude roughening |

### Final design (Ex. 2)
- Web 12 in.; SBE each end **16 in. thick × 34 in. long**; ℓw = 28 ft; hw = 92 ft.
- Vertical web: No. 8 @ 12 in. e.f. Horizontal: No. 6 @ 12 in. e.f., extending into boundary elements with 90° hooks (26.5 in. available vs 7.1 in. required).
- SBE longitudinal: (10) No. 8 per boundary element, hx = 10 in.
- SBE transverse: (2) No. 4 overlapping hoops + (1) No. 4 crosstie per set (3 legs ⊥ bc); 4 in. o.c. from foundation to 336 in. above critical section, 8 in. o.c. above; 12 in. into foundation; No. 4 web crossties @ 12 in.
- Governing values: c = 67.85–67.9 in., δu = 12 in., Ve = 1107 kip, φVn = 1227 kip (φ = 0.6), φMn = 40,200 ft-kip.

---

## Notes for fixture builders
- Both examples share the same building (hotel; 12 bays @ 18 ft = 216 ft long; 24×24 in. columns; 15 ft core opening) — only SDC and demands differ. Pu = 1015 kip in both.
- Ex. 1 ρℓ,min printed intermediate is 0.0030 (hw/ℓw capped at 2 in Eq. 11.6.2), then waived because ρt required for strength = 0.
- Ex. 1 combined-stress check as printed: σ = 1,015,000/[(12)(28)(12)] + 223,200,000 × 336/37,933,056 = 2229 psi. (Note: the flexural term as printed uses y = 336 in. rather than ℓw/2 = 168 in. — flag when building the fixture; assert the printed value but mark it `handbook-as-printed`.)
- Ex. 2 first drift-capacity trial (0.0035) is for b = 12 in.; the b = 16 in. recheck conservatively reuses c = 67.9 in.
- **φMn (24,600 / 40,200 ft-kip), Mpr (51,900 ft-kip), and c (67.9 in.) are outputs of ACI's Interaction Diagram Excel aid** (concrete.org/MNL1721Download2), not hand-calc steps — our fiber engine must reproduce them within tolerance (see PLAN.md), not exactly.
- Ex. 2 applies φ = 0.6 via 21.2.4.1 even though 18.10.4.6 arguably exempts 18.10.6.2-designed walls — fixtures follow the handbook's conservative reading; the engine should expose both readings with a setting (default: handbook-conservative).
