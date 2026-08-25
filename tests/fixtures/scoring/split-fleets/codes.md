# Split-fleet fixture codes

The format archetypes (F-codes) and degenerate scenarios (D-codes) these
fixtures cover, condensed from the format survey
(`docs/design/split-fleets/format-survey.md`, which has the full 12-class /
2021–2026 evidence and the priority argument). Each fixture's `provenance`
block names its real anchor event and links its captured SIs/results in
`reference-docs`.

## Format codes

| Code | Meaning | Fixture(s) |
|---|---|---|
| **F1** | Addendum-C classic: one continuous low-point line across qualifying + final; per-fleet finals score-code base; class discard ladder | `01` (ILCA ladder), `02` (IODA single discard) |
| **F2** | F1 + a medal race: doubled, non-discardable medal points; medal boats ranked above the fleets; non-medal companion "last race" scored from below the medal fleet | `03` (ILCA Adelaide) |
| **F3** | Compressed carry: the medal boats' opening-series score is divided and rounded before an additive, non-discardable medal series | `15` (ILCA Dun Laoghaire, ÷2 rounding 0.5 up), `16` (its sub-series tie-break), `17` (the extra race for the boats who did not qualify) |
| **F5** | Net + net: qualifying and final are separately-discarded series and the championship score is their sum | `13` (29er) |
| **F6** | Rank-seed carry: the qualifying *position* carries into the final series as one non-excludable score and the qualifying race scores drop out | `14` (Topper / 470) |

Not covered here (later priorities, per the survey): **F4** knockout overlay
(record-only), **F7** no-carry, **F8** frozen fleets / merged starts.

## Scenario codes (this batch)

| Code | Scenario | Fixture | Real anchor |
|---|---|---|---|
| **D1** | No split — qualifying ranking becomes the official result | `04` | ILCA 2025 Qingdao (fog: 5–6 races, never split) |
| **D3** | Finale scheduled but never sailed | `05` | ILCA 2024 Adelaide (companion "last race" not run); 49erFX 2023 (medal race abandoned) |
| **D5** | Unequal final-fleet race counts | `06` | ILCA 2022 Vallarta (Gold 12 / Silver 11) |
| **D6** | Qualifying closed early at the day boundary | `07` | SWC 2023 The Hague (split at the 4-race minimum) |
| **D8** | Equalisation of a qualifying race not completed by all fleets | `08` | ILCA A2.8 (abandon & cancel the surplus) |
| **D10** | Redress across the split — A9(a) fractional average points + promotion | `09` (spec-only) | ILCA 6 2021 Oman ("14.8 RDGc"); IODA promote-only refleeting |
| **D7** | Title places decided on a tie-break | `16` | 2026 ILCA SI 18.7.4 (the halved carry manufactures the ties); ILCA 6 2021 Oman, decided on unmodified A8 |
| **D11** | A tie RRS A8 cannot break — the boats share the rank | `19` | 2026 ILCA 7 Dun Laoghaire (identical DNC lines in different qualifying fleets, published joint 140th) |

The remaining survey scenarios (D2 void championship, D4 finals near-void,
D9 SI/practice divergence) are not in this batch.

## Runnable vs spec-only

Fixtures with `runnable: true` are asserted against the prototype engine
(`lib/split-fleets.ts`) by `tests/split-fleets-fixtures.test.ts`. Fixtures with
`runnable: false` are specifications for the eventual engine — the prototype
cannot reproduce them — and the runner marks them pending with the fixture's
`reason`. Currently only `09` (redress) is spec-only: the prototype scores an
RDG cell at the code base rather than the RRS A9(a) average.

Two rules are *partially* covered and flagged for the eventual engine:

- **Equalisation (D8):** the prototype's validity gate handles the common case
  (a whole fleet never sailed a qualifying race → that logical race counts for
  nobody), which matches ILCA's abandon-and-cancel. The IODA/420/470/29er
  variant — exclude each boat's *most-recent surplus* score when boats within a
  fleet have unequal counts (e.g. a resail) — is not modelled; `08` notes it.
- **Redress (D10):** fractional average points and promotion-only refleeting,
  both spec-only for now.
- **Fleet-boundary ties at the split:** when the Gold/Silver boundary falls on
  a tie that RRS A8 cannot break (identical race scores — A8.1 and A8.2 both
  tie), the SIs specify a further order: registration/seeding order, or LE's
  deliberate fleet-order scatter (the design's `reassignmentTieOrder`). The
  prototype resolves such ties by **entry order** (the `a8-then-entry-order`
  variant); it does not implement the fleet-order scatter, and it omits the
  A8.2 last-race step (which does not affect identical-score ties). Fixture
  `02` exercises exactly this boundary tie (y2 vs b2) and documents it.

## Scale note

The fixtures are small (6–9 boats, 2–3 fleets, a handful of races) so a human
scorer can verify every cell by hand — the project's established fixture style.
The real events are 100–280 boats; the captured published results (see each
fixture's `provenance`) are Sailwave/Sailti tables that carry per-race *scores*
but not the per-race *fleet assignments*, so full-fleet reconstruction is not
possible from them. What each fixture preserves faithfully is the real event's
*structure and rules*: fleet counts, discard profile, score-code bases, medal
config, and what actually happened. Real full-fleet totals appear in the
`notes` prose, not the modelled cells.
