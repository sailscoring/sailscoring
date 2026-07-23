# Split-fleet format survey — premier championships 2021–2026

A methodical survey of how the twelve target classes actually structured and
scored their premier championships over the last five-plus years, to ground
the split-fleets test-fixture set. For each class the primary sources (NoR,
SIs, published results) were fetched and the scoring clauses extracted; the
"what actually happened" column was reconstructed from the published results
tables, not the paperwork. Exemplar SIs and results are captured in
reference-docs (see the capture table at the end).

Classes: ILCA, Optimist, Topper, 49er/49erFX, Nacra 17, 29er, 470, 420,
Moth, WASZP, iQFOiL, Formula Kite.

## The headline

Three findings shape the fixture plan:

1. **One family dominates.** The continuous-points Addendum-C format (with or
   without a medal race) covers the premier events of ILCA, Optimist, 420,
   470, Moth, the skiffs through 2024, and the *opening series* of every
   windsurf/kite event. Two fixture codes (F1, F2) cover roughly two-thirds
   of every event-year surveyed — and the events Sail Scoring is most likely
   to score in anger.
2. **The degenerate cases are not hypothetical.** In five seasons the premier
   fleets saw: a championship decided entirely on qualifying (ILCA 2025), a
   finals stage of 1–2 races with zero discards (29er 2025), a **void**
   championship (Moth 2023 — 2 races in 7 days, no title awarded), three
   scheduled finales that never sailed (49erFX 2023 medal race, 470 2024
   medal race, ILCA 2024's companion race), a world title decided on an
   unmodified A8 tie at equal points (ILCA 6 2021), and final fleets ending
   5 races apart (29er 2026). Every "esoteric" scenario in the fixture list
   below actually happened.
3. **The genuinely incompatible constructs are few, recent, and containable.**
   Only three things surveyed cannot be computed by a continuous low-point
   engine: knockout medal brackets (iQFOiL/Kite, skiffs 2025), the skiffs'
   2025 winner-takes-title "4-Point Race", and composite races whose score is
   imported from a sub-series (WASZP sprints). All three are handled by
   *recording* rather than computing — stated-points races plus a manual rank
   override — and the bracket currencies churn every cycle, which is itself
   the argument against computing them.

## Fixture codes — format archetypes

Each code is a scoring configuration a fixture must exercise. Carry = how
qualifying results enter the championship score; codes = the RRS A5.2
replacement base per stage (qualifying / finals).

| Code | Carry | Finale | Discards | Code base (Q / F) | Reassignment | Split rule | Seen at |
|---|---|---|---|---|---|---|---|
| **F1** Addendum-C classic | Continuous points, one line | None | Class ladder (Opti: exactly 1 @5; 420: 1 @3; ILCA: 1/4–9, 2/10+ with max-1-final + lone-final-race caps; Moth: pooled 2–3) | Largest Q fleet / own final fleet (pre-2024 ILCA + pre-2026 Opti: largest fleet both stages) | Daily serpentine, 20:00/21:00 freeze | Near-equal blocks, Gold-largest; or fixed Gold (Moth 2025: top 60) | Optimist all years; 420 all years; ILCA 2021-22, 2025; Moth 2021/24/25; WASZP 2022 |
| **F2** = F1 + medal race(s) | Continuous | Top-10 medal race, ×2 points, never discardable, breaks ties; companion "last race" scored from 11; ILCA 2026: two-race medal series | As F1 + medal exclusions (ILCA 2024: ONE discard total) | As F1; medal base = 10 | As F1 | As F1; skiffs: Gold fixed 25 | ILCA 2024, 2026 (planned); 470 Worlds/Europeans 2021-25; SWC 2023 (all classes); 49er/FX/Nacra 2021-24 (one discard only, F-scores-only tie-break) |
| **F3** compressed-carry medal series | Continuous through finals, then carried score **transformed** before an additive 2-race medal series (÷2.25 truncated; or chained gap caps 9/18) | 10-boat, 2 races, additive, non-discardable, Appendix MR | Stage-scoped | As F1 | As F1 | Fixed Gold 25 | Skiffs 2026; 470 Europeans 2026 (which also rank-carries into finals — F3+F6) |
| **F4** knockout overlay | Continuous opening; bracket **replaces** top 8–10 ranks via placement table | QF→SF→GF; currencies churn (winner-take-all → first-to-3-wins → match-points 1/½, 1-0-0-0, 1-1-0-0); fallback: no medal race → opening stands | Opening: sliding ladder, per-phase caps, max-1-sprint-BFD | Largest group/heat | Daily serpentine | G/S/B, fixed-size Gold | iQFOiL all years; Formula Kite all years; skiffs 2025 ("4-Point Race" = winner-takes-title variant) |
| **F5** net + net | Q net + F net, separately-discarded stages; carry displayed as non-race scalar | None | Per-stage schedules (29er 2023+: 1 @3 per stage) | Largest Q fleet / own final fleet | Daily serpentine **with two-race gate** (29er) | Fixed Gold scaled by entries (40/45/50); 4 or 6 fleets | 29er 2022-26; WASZP 2025 (3 flights, Gold+Silver fixed 70 each); Topper 4.2 2023 (nightly snake re-flight) |
| **F6** rank-seed carry | Finals restart; carried score = qualifying **rank**, non-discardable | None (Topper/29er); 470E 2026 adds F3 medal series | Per-stage | Largest start / own fleet | Daily (29er 2021) or frozen (Topper) | 50/50 or banded | Topper 5.3 2022 (only sailed instance); 29er 2021; 470 Europeans 2026 |
| **F7** no carry | Championship score = **final-series score only**; fleet band dominates | None | Per-stage | Largest start / own fleet | Frozen flights (see F8) | Percentage split (Gold 40–50% + ties, Silver 50–60% of rest) | Topper 5.3 2023-25 (SIs overrode the NoR's F6 boilerplate 2023-24; NoR rewritten 2025) |
| **F8** frozen flights + pairing rota | (orthogonal structure, combines with F7) | — | — | "Largest number of boats assigned to **start together**" | **None** — 4 flights frozen all week; fixed 6-race pairing rota; each Q race = TWO starts merged into one column, duplicate ranks, A7 disapplied | — | Topper 5.3 all sailed years |

Orthogonal structural flags (apply across codes):

- **Divisions as separate championships** — 420 Open/Women/U17 and Optimist
  Europeans boys/girls each split independently; model as separate series
  (women/U17 *within* a division are category extractions). (420, Opti-EU,
  ILCA 6 M+W 2021.)
- **Composite races** — a race whose score is imported: WASZP sprint = final
  ranking of a heats sub-series entered as one race score; WASZP distance
  race = interleaved mass start scored within-fleet; iQFOiL sprint heats
  score 2p−1 (heat winners tie on 1); iQFOiL marathon = two races at
  position÷groups (**fractional scores**). Record as stated-points races.
- **Entry-banded structure** — fleet counts derive from entries (420: 1/2/3
  at ≤50/≤100/>100; 470: bands at 40/80) with organiser discretion overriding
  bands in practice (470 2023 single at 64; 420 2025 two fleets at 101).
- **Mid-event fleet migration** — WASZP Green fleet merged into Silver/Bronze
  mid-event; one year "scored in both series".

## Scenario fixtures — degenerate cases that actually happened

Each is a fixture over some format code, asserting the fallback behaviour:

| # | Scenario | Real instance |
|---|---|---|
| D1 | **No split** — qualifying ranking becomes the official result | ILCA 2025 Qingdao (4 zero-race days; W 6 races, M 5; SI 18.4.2 invoked). Explicit fallback clauses now in ILCA, Opti (2024+), WASZP SIs |
| D2 | **Void championship** — minimum races not reached, no title | Moth 2023 Weymouth (2 races in 7 days; needed 4; scored as a plain single series). Validity minimum relaxed 6→4 in the class's next SIs |
| D3 | **Finale scheduled, never sailed** | 49erFX 2023 medal race (no wind — title stood on opening series); 470 2024 Palma medal race; ILCA 2024 Silver/Bronze companion race |
| D4 | **Finals stage nearly void** — 1–2 F races, zero discards, qualifying decides podium | 29er 2025 Porto (F: 2/2/1/1 races) |
| D5 | **Unequal final-fleet race counts** (normal, not exceptional) | 29er 2026 (9/9/6/4/5/5); ILCA 2022 (Gold 12/Silver 11); Opti 2021+2025; WASZP 2025 (Gold 8 / Silver+Bronze 6); 420 divisions ending 10/9/8 |
| D6 | **Qualifying closed early / extended** at the day boundary | SWC 2023 (closed at 4 races after abandoned days); ILCA A2.7 extension rule; Qingdao's mid-event schedule amendments (4-per-day notice, superseded next day) |
| D7 | **Title decided on tie-break** | ILCA 6 2021 Oman: 71.0 = 71.0, unmodified A8 (Plasschaert d. Barwińska); FK 2026 bronze from seed 10 via QF→SF→3rd-in-GF |
| D8 | **Retro-abandonment / equalisation of excess qualifying races** | ILCA A2.8 (abandon & cancel extras); LE/IODA/420/29er/Topper-2024+ variant (exclude each boat's most-recent extras); Barcelona 2021's unique discard-inside-split-ranking (SI 22.5(c)) |
| D9 | **SI/NoR contradiction or SI/practice divergence** resolved at the scorer's desk | Topper 2023-24 (SIs overrode NoR's rank-seed; SI-precedence, never amended); Opti 2025 (scorer applied per-fleet finals base a year before the SI said so; 2026 SI codified it); two Moth hosts shipped SIs with **no split clause at all** (split published as a notice) |
| D10 | **Redress across the split; fractional points** | Promotion-only clause universal; fractional RDG in real results (ILCA 2021 "14.8 RDGc"; 420 2024 winner's net 71.33) |

## Event table

★ = captured in reference-docs. Sailti-platform results (`resultsajax`
endpoints — Opti, 420, 470, ILCA 2021 Barcelona) are machine-readable
per-cell (fleet tag + score + code). Full link sets with per-clause citations
live in the per-class research dossiers this survey summarises.

| Class | Year | Event | SIs | Results | Code |
|---|---|---|---|---|---|
| ILCA 7 | 2021 | Worlds, Barcelona | archive.org (verified) | Sailti | F1 (+D8 quirk) |
| ILCA 6 | 2021 | Worlds, Al Mussanah | verified (http only) | Sailwave PDFs | single fleet; D7 |
| ILCA 7 | 2022 | Worlds, Vallarta ★ | rrs.org/documents/38317 | sailwave.com/results/vyc/ | **F1** (+D5) |
| ILCA 6 | 2022 | Worlds, Kemah | verified | Sailwave (jpvm.org) | F1 |
| ILCA both | 2023 | SWC The Hague | unrecoverable (JS board) | Wikipedia mirrors | F2; D6 |
| ILCA 7 | 2024 | Worlds, Adelaide ★ | onb.ilca.roms.ar (captured) | jpvm.org | **F2** (+D3, D5) |
| ILCA 6 | 2024 | Worlds, Mar del Plata | verified | Sailwave | F2 |
| ILCA both | 2025 | Worlds, Qingdao | verified | Sailwave | F1 → **D1** |
| ILCA both | 2026 | Worlds, Dun Laoghaire | NoRs verified; SIs pending | — | F2 (2-race medal) |
| Optimist | 2021–26 | IODA Worlds (Riva, Bodrum, Sant Pere, Mar del Plata, Portorož, Tangier ★) | all 6 years verified | sailti resultsajax, all parsed | **F1** (3-fleet 2024; D5 2021/25; D9 2025) |
| Optimist | 2025 | Europeans (boys/girls separate) | verified | sailti | F1 ×2 divisions |
| Topper | 2021 | Worlds (cancelled — COVID) | — | — | — |
| Topper | 2022 | Worlds, Garda ★ | SIs unlocated | Sailwave PDFs (archive) | **F6** (only sailed rank-seed) |
| Topper | 2023 | Worlds, Royal Cork ★ | rrs.org/documents/74884 | ourclubadmin (both rigs) | **F7+F8** (5.3); **F5** (4.2) ; D9 |
| Topper | 2024–25 | Worlds (Mar Menor, Medemblik) | verified | Sailti / manage2sail | F7+F8 |
| 49er/FX/N17 | 2021 | Worlds, Mussanah | NoR verified | 49er.org tables | single fleet + MR |
| 49er | 2022 | Worlds, Halifax | verified (full text) | 49er.org | F2 (FX/Nacra single) |
| all three | 2023 | SWC The Hague | unrecoverable | manage2sail/Wikipedia | F2; **D3** (FX MR abandoned) |
| 49er/FX | 2024 | Worlds, Lanzarote ★ | 49er.org SI (verified) | results PDFs | **F2** |
| all three | 2025 | Worlds, Cagliari | NoR verified; SSI partial | 49er.org | F4 ("4-Point Race") |
| all three | 2026 | Worlds, Quiberon ★ | combined NoRSI (best doc in survey) | manage2sail | **F3** |
| 29er | 2021 | Worlds, Valencia | verified | Sailwave | **F6** variant (rank carry) |
| 29er | 2022–26 | Worlds (El Balís, Weymouth ★, Aarhus, Porto, Kiel) | all verified | Sailwave (+ m2s JSON 2026) | **F5** (D4 2025; D5 2026) |
| 470 | 2021 | Worlds+Europeans, Vilamoura | listed | Sailti | single fleet + MR |
| 470 | 2022–25 | Worlds (Sdot Yam, The Hague, Palma, Gdynia ★) + Europeans (Çeşme, Sanremo, Cannes, Split) | NoRs verified; Cannes SI fullest | Sailti resultsajax | **F2** (D3 2024; single-fleet years by band) |
| 470 | 2026 | Europeans, Vilamoura ★ | NoR/SI v3 verified | Sailti (CF FS column) | **F6+F3** |
| 420 | 2021–26 | Worlds (Sanremo, Alsóörs, Alicante, Rio, Urla ★, Biscarrosse) + Junior Europeans | 2025 NoR+SI verified | Sailti resultsajax all parsed | **F1** ×3 divisions (D5, D10) |
| Moth | 2021–25 | Worlds (Malcesine, Buenos Aires, Weymouth, Manly ★, Malcesine) | 4 of 5 SIs verified/read | Sailwave/Sailti | **F1** pooled discards (D2 2023; no-split 2022; D9) |
| WASZP | 2022–26 | Games (Malcesine, Sorrento, Sandefjord, WPNSA ★, Pensacola) | 2022/25/26 verified read | Sailwave HTML (2025 Q+F) | 2022 F1; 2025 **F5**+composite; 2023/26 no split |
| iQFOiL | 2021–26 | Worlds (Silvaplana, Brest, The Hague, Lanzarote, Aarhus ★, Weymouth) + Paris 2024 | 2025 NoR/SI verified parsed | Sailwave 2021; SailTi later | **F4** (opening = F1-shaped) |
| F. Kite | 2021–26 | Worlds (Sardinia, Cagliari, The Hague, Hyères, Cagliari, Viana ★) + Paris 2024 | 2025+2026 NoR/SI verified parsed | Sailwave (fir.com.pl 2026 static ★) | **F4** |

## Priority argument

Ordered by coverage of events Sail Scoring will actually score:

1. **F1 + F2 with scenarios D1, D3, D5, D6, D8, D10** — covers every ILCA,
   Optimist, 420, 470, Moth and classic-skiff championship: the 2026 ILCA
   Worlds target, the IODAI constituency, and the two most common finales
   (none, or a double-points medal race with companion race). This is v1
   fixture territory and matches the prototype's scope.
2. **F5 (net+net)** — one engine feature (per-stage discard pools + carried
   nett scalar) unlocks the 29er's entire modern era and WASZP 2025. Already
   modelled in the design; fixtures next.
3. **F4 as record-only** — stated-points medal races + manual rank override +
   "no medal race → opening stands" flag capture every windsurf/kite event
   and the skiffs' 2025 experiment without computing brackets. The churn in
   bracket currencies (three different match-point schemes in three years)
   confirms record-not-compute as the durable position.
4. **F6/F7 (rank-seed, no-carry)** — small but real: rank-seed was sailed
   twice (Topper 2022, 29er 2021) and returned in the 2026 470 Europeans;
   no-carry is current Topper practice. Cheap in the engine (a synthetic
   non-discardable carried score; a finals-only total mode); fixture-test
   early, UI later — as the design already planned for rank-seed.
5. **F3 (compressed carry)** — two class lines converged on it in 2026
   (skiffs, 470 Europeans); expect more as LA2028 approaches. Needs a
   carried-score-transform hook. Post-v1, but the hook belongs in the data
   model conversation now.
6. **F8 (Topper's frozen flights / merged starts)** — one class, but scoring
   it requires merged-start race columns with duplicate ranks and a
   largest-*start* code base. Defer; document as known-unsupported.

## Compatibility assessment — the reassurance

Nothing surveyed breaks the **data model** (rounds of real fleets, physical
races per fleet, frozen assignments, one series). The constructs the *scoring
engine* cannot express natively, exhaustively:

1. **Knockout brackets** (F4 finale) — by design out of scope; record-only
   handles all observed variants, including the cancellation ladders (stage
   cancelled → rank by seeding; no medal race → opening stands).
2. **Winner-takes-title positional override** (skiffs 2025) — the extreme
   bracket case; same answer.
3. **Composite/imported race scores** (WASZP sprint sub-series, iQFOiL 2p−1
   heats and fractional marathon) — stated-points races cover them;
   fractional points already exist in the engine via RDG averages.
4. **Merged-start race columns** (Topper F8) — genuinely outside "one
   physical race per fleet"; the only construct that would require
   *extending* the model, and confined to one class.
5. **Carried-score transforms** (F3) and **rank-seed** (F6) — planned hooks,
   not incompatibilities.

Watch-item, not a construct: mid-event **fleet migration** (WASZP Green →
Silver) — handleable as manual membership edits with round overrides.

Archival warning for fixture-building: kite/windsurf live-results URLs are
reused between events, and Sailwave exports for F4 classes contain **only the
opening series** (the 2026 FK women's Sailwave table is topped by the silver
medallist, not the world champion). Capture documents and results at survey
time — done below — and never cite live URLs as fixture sources.

## Reference-docs captures

One exemplar per fixture code (SIs + results from the same event), in
`reference-docs:events/`:

| Dir | Event | Covers | Files |
|---|---|---|---|
| `ilca7-worlds-2022/` | ILCA 7 Worlds, Vallarta | F1 exemplar | SI PDF + Sailwave HTML |
| `ilca7-worlds-2024/` | ILCA 7 Worlds, Adelaide (SI already captured) | F2 exemplar | + results HTML |
| `optimist-worlds-2026/` | IODA Worlds, Tangier | F1 (Opti parameters) | NoR + SI PDFs + resultsajax HTML |
| `topper-worlds-2023/` | ITCA Worlds, Royal Cork | F7+F8; F5 (4.2); D9 | NoR + SI + both rigs' results |
| `topper-worlds-2022/` | ITCA Worlds, Garda | F6 (sailed rank-seed; SIs unlocated) | results PDFs |
| `29er-worlds-2023/` | 29er Worlds, Weymouth | F5 exemplar | SI + Q-series + finals Sailwave HTML |
| `waszp-games-2025/` | WASZP Games, WPNSA | F5 at 3 flights + composite races | NoR + SI + Q/F Sailwave HTML |
| `420-worlds-2025/` | 420 Worlds, Urla | F1 ×3 divisions | NoR + SI + resultsajax HTML |
| `470-worlds-2025/` | 470 Worlds, Gdynia | F2 (470 parameters) | NoR + final results PDF |
| `470-europeans-2026/` | 470 Europeans, Vilamoura | F6+F3 | NoR/SI + results |
| `skiff-worlds-2026/` | 49er/FX/Nacra Worlds, Quiberon | F3 exemplar (+F2 template) | combined NoRSI |
| `skiff-worlds-2024/` | 49er/FX Worlds, Lanzarote | F2 (skiff parameters) | SI |
| `formula-kite-worlds-2026/` | FK Worlds, Viana do Castelo | F4 exemplar | NoR/SI + static Sailwave HTML (M+W) |
| `iqfoil-worlds-2025/` | iQFOiL Worlds, Aarhus | F4 (opening wrinkles) | NoR/SI |
| `moth-worlds-2024/` | Moth Worlds, Manly | F1 (pooled discards) | SI + results PDF |

The Qingdao 2025 no-split results (D1) are already cited from the main design
doc's references; the 2026 Dun Laoghaire SIs join reference-docs when the ONB
publishes them.
