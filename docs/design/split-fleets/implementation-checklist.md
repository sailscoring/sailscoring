# Split fleets — prototype → complete checklist

Work items to take the quick-and-dirty prototype (`prototype.md`) to
"complete enough" to run the prioritised scope in anger: **F1** (continuous-
carry qualifying/final), **F2** (+ medal race[s]), and scenarios **D1**
(no split), **D3** (finale not sailed), **D5** (unequal final counts), **D6**
(qualifying closed early), **D8** (a race not completed by all fleets), **D10**
(redress across the split). The full format taxonomy is in
[`format-survey.md`](format-survey.md); the design is
[`../split-fleets.md`](../split-fleets.md) and the UX is
[`../ux/flows/split-fleets.md`](../ux/flows/split-fleets.md).

Scenario tags in brackets mark the item's driver; **[replaces shortcut]**
marks a deliberate prototype cut being undone.

## Scope boundary

In: F1, F2, and D1/D3/D5/D6/D8/D10, one-design scratch series only. Out (later
milestones, per the survey): F5 net+net, F6 rank-seed, F7 no-carry, F8 frozen
fleets/merged starts, F4 knockout brackets, F3 compressed-carry medal series;
the IODA/LE *exclude-most-recent* equalisation beyond the common case;
split-fleets × handicap systems. Carry is always `points` for the in-scope
set, so no carry-mode work is needed.

## Data model & persistence

- [ ] Promote the prototype's sparse `SplitFleetConfig` to the full
  `QualifyingFinalConfig` (carry, split kind, `codeBasis`, `equalization`,
  `maxFinalDiscards`, `protectLoneFinalRace`, `reassignmentTieOrder`, medal).
  **[replaces shortcut]**
- [ ] `AssignmentRound`: keep basis snapshot + method; add `overrides`
  (competitor→fleet, for manual placement / promotion) and `publishedAt`.
- [ ] Round-scoped fleet identity in production: fleets are owned by a round
  (a round-1 "Yellow" ≠ round-2 "Yellow"), marked as round-owned, and
  **filtered from general-purpose fleet surfaces** — pickers, the Competitors
  tab, publishing groups, prize `fleetId` clauses (design open question 1).
- [ ] Round-scoped fleet naming for the raw fleet list ("Round 1 · Yellow"),
  bare colour on race chips and standings cells (review finding).
- [ ] `Competitor.seed?: number` and `Competitor.entryNumber?: string` —
  types, Drizzle schema + migration, Zod, repositories, the
  `enabledCompetitorFields` gating for `entryNumber`.
- [ ] `Race.firstPlaceOffset?: number` (companion "last race" primitive); keep
  `stage` / `stageRaceNumber`. **[replaces shortcut: medal-config flag]**
- [ ] Proper repository classes for rounds/config instead of raw Drizzle in
  the handler. **[replaces shortcut]**
- [ ] Series-file format bump: round-trip `qfConfig`, rounds, race stage
  fields + `firstPlaceOffset`, `seed`, `entryNumber`. **[replaces shortcut]**
- [ ] Public JSON export carriage of the same (fleet assignments are public);
  CSV import accepts a `seed`/seeding column.

## Scoring engine (`lib/split-fleets.ts`)

- [ ] **Redress (RDG)**: RRS A9(a)/(b) average points (fractional, to 0.1),
  honouring the include/exclude race sets. **[D10]** **[replaces shortcut]**
- [ ] **Penalties**: SCP / DPI / ZFP applied on top of a finish (real
  championship results are full of them). **[replaces shortcut]**
- [ ] **Full A8 tie-break**: add the A8.2 last-race-then-backwards step after
  A8.1. **[replaces shortcut]**
- [ ] Fix medal doubling to apply to **finish points only**, not to code
  scores (DNC/BFD in a medal race are the fleet base, not doubled).
  **[replaces shortcut]**
- [ ] Configurable score-code base per stage from `codeBasis`: largest
  qualifying fleet / own final fleet / fixed / largest-both (pre-2026 IODA).
  **[replaces hardcoded]**
- [ ] Discard selection: honour `protectLoneFinalRace` and medal races
  **not counting toward the discard threshold** (2024 ILCA), in addition to
  `maxFinalDiscards` (already present). **[F2]**
- [ ] `Race.firstPlaceOffset` scoring (first finisher = offset + 1). **[D3/F2]**
- [ ] `reassignmentTieOrder`: implement `fleet-order` (LE scatter) alongside
  the current `a8-then-entry-order`.
- [ ] Equalisation: keep the validity gate (a qualifying logical race doesn't
  count until every fleet completes it — this is ILCA abandon-and-cancel).
  **[D8]** *Exclude-most-recent (IODA resail case) deferred; document.*

## Assignment (`lib/split-fleets.ts` pure functions)

- [ ] Seed sources: `seed` field (add), nationality-then-sail (have),
  sail-number (have); drop entry-order from the UI (fixture-only).
- [ ] Explicit/manual initial assignment + override layering on any round
  (late entry, RC/jury, wrong-fleet correction, promotion). **[D10]**
- [ ] Snapshot capture on the reassignment/split basis (already modelled;
  wire the "ranking over races completed by all fleets" input).

## API (`/api/v1/series/:id/split-fleets`)

- [ ] Rewrite handlers onto repositories; tighten Zod. **[replaces shortcut]**
- [ ] Round commit stores basis + overrides; supports the editable-preview
  payload (computed order + hand-moves).
- [ ] Manual-override endpoint (place / promote / late-entry); promotion
  guarded with the after-first-final-race warning path. **[D10]**
- [ ] Config CRUD: setup write; editable-post-lock enforcement (freeze
  `carry` + qualifying fleet count once any race has finishes; the rest
  re-score). **[design open question 6]**
- [ ] Split commit accepts top-fleet size / boundary params.
- [ ] Replace round-deletion-as-undo with revision-history restore.
  **[replaces shortcut]**
- [ ] Assignment-list publishing endpoint (rolling page, newest round on top).

## UX — setup & config

- [ ] Setup at series creation (immutable format choice, like `scoringMode`):
  preset (ILCA World/Euro, IODA, Custom), qualifying fleet count + colours
  (same-initial warning), final fleet names, planned schedule sketch. **[D6]**
- [ ] Settings card (series-format card): config visible always, frozen
  fields read-only after lock, editable fields live (re-score on change).
- [ ] Custom exposes discard ladder + caps, code bases, equalisation mode,
  split rule + top-fleet size, tie-order, medal block.

## UX — the Split Fleets view & ceremonies

- [ ] Phase stack (Setup → Qualifying → Final → Medal) with the day strip and
  computed next-action; medal phase shown only when `medal` is configured.
  **[F1 vs F2]** **[replaces shortcut: no day strip]**
- [ ] Round cards with provenance, rosters, override diffs, published state.
- [ ] Seed ceremony: order sources **+ committee named-lists entry**, an
  **editable preview** (drag → override). **[gap]**
- [ ] Reassign ceremony: computed preview + basis snapshot + **manual
  overrides** (late entry / RC / wrong-fleet). **[gap]**
- [ ] Split ceremony: computed blocks with an **adjustable top-fleet size /
  boundary**, equalisation display, and **boundary-tie diagnostics** (A8 +
  which tie-order rule). **[D5 boundary]** **[gap]**
- [ ] Promote action on the split round, with the **before/after first final
  race** timing behaviour. **[D10]** **[replaces shortcut: none]**
- [ ] Medal selection ceremony as a real `CeremonyDialog` (not
  `window.confirm`), with a **scorer-chosen fleet size**; creates the medal
  fleet + companion fleet. **[F2]** **[replaces shortcut]**
- [ ] Companion "last race" as a general per-race offset; scorer can add one
  for any fleet; medal ceremony pre-fills it. **[D3]**
- [ ] Multiple medal races: add M1, M2… like final races. **[F2 2026]**
- [ ] Logical-race slot rows (Qk fills up per fleet; "counts" / "awaiting
  ‹fleet›"; a cancel-logical-race action). **[D8]**
- [ ] Finish entry fleet-scoped (works) + explicit **wrong-fleet exception
  flow** (record the observed finish, DNC in own fleet, resolvable).
  **[replaces shortcut]**
- [ ] Add-race per final fleet independently (finals need not be equal).
  **[D5]**
- [ ] Small-screens degradation (lead-scorer phone tweak).

## UX — standings, publishing, finalise

- [ ] Combined qualifying standings: fleet-tinted cells, greyed
  does-not-yet-count columns, discards in parens. **[D8]**
- [ ] Provisional **cut line** in qualifying standings (in-app and published).
- [ ] Tiered final standings (Gold 1…n, Silver n+1…), medal column doubled,
  carried columns where relevant.
- [ ] Hide the regular **Standings tab** on a split-fleet series; rehome
  **publish / preview / download** onto the Split Fleets standings section.
  **[review finding]** **[replaces shortcut: standings only on the tab]**
- [ ] Published pages carry the split (fleet-tinted, tiered) — not just the
  in-app view. **[replaces shortcut]**
- [ ] Rolling assignment-lists published page.
- [ ] Publish policy during qualifying: continuous provisional (greyed
  not-yet-counting column), no hold-until-valid toggle.
- [ ] **Event-complete → Mark as final**, surfaced from the Split Fleets page
  (results-status). Handles the fallbacks: **D1** (no split → qualifying
  ranking is the official result), **D3** (finale not sailed → results stand
  on what was sailed), no-medal / no-final ladders. **[D1, D3]**
- [ ] Medal phase completion state (all configured medal + companion races
  done) so the arc doesn't hang. **[review finding]**

## Fixtures & tests

- [ ] Ordered-steps fixture form: express seed → race → reassign (assert
  assignment) → rescore-a-protest (assert the round doesn't move) → split →
  finals, with assertions per step (partly present via `assign`/
  `expectedFleets`; add the after-round rescoring assertion).
- [ ] Once redress + penalties land, rebuild **full-event fixtures** from the
  published results: 2024 Adelaide (F2, D3, D5) and 2025 Qingdao (D1); make
  the currently spec-only D10 fixture runnable.
- [ ] Playwright happy path: seed → race → reassign → split → medal →
  publish → finalise.
- [ ] Keep the human-verifiable YAML fixtures + previews green.

## Feature checklist & rollout

- [ ] `split-fleets` gate (have, `selfService: false`); provisioning-doc row
  (have).
- [ ] Keyboard shortcuts for the Split Fleets actions; help-page section
  (a scorer's guide to running a split-fleet event).
- [ ] No GA before the 2026 ILCA Worlds; validation plan — the two full-event
  fixtures above, then a day-by-day dry run against the 2026 SIs when the ONB
  publishes them.
- [ ] File the general finish-entry fleet-badge bug fix (#327) so multi-fleet
  boats don't show every round's badge.
