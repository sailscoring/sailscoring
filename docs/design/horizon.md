# Horizon

Long-range possibilities worth remembering but not actively tracking as issues.
Not scheduled, not designed — just captured so they're not lost.

---

## Third-party integrations

### Mobile finish-recording app

A mobile app for finish-line officials to log boat finishes in real time — using voice
recognition or document scanning — is a natural third-party application built on the
Sail Scoring API. It would be a thin write client: POSTs finish times (or positions)
as boats cross the line, with no scoring, series management, or standings logic of its own.

Shapes API design: the finish-recording use case requires a simple, low-latency write
endpoint, which should inform how the external API is scoped and authenticated. Voice
and scanning input are specific enough to be worth designing the data model around
(e.g. tolerating corrections, ambiguous identifiers).

Sail Scoring's public documentation should explicitly invite this kind of integration
and describe the API surface it would use.

*(Was GitHub issue #15)*

### Live results display for clubhouse big screens

A read-only display client consuming the Sail Scoring API, designed for large screens
in a clubhouse or race office — big text, high contrast, minimal chrome, cycling between
current race standings, series standings, and next start times.

Real-time or near-real-time read access has different requirements to the write API —
likely polling or a push mechanism (WebSocket / SSE). Shapes how standings data is
exposed: the API needs to serve current standings cheaply and frequently.

A clubhouse display is immediately tangible to sailors and clubs — a good example to
lead with in developer-facing documentation.

*(Was GitHub issue #16)*

### Fetch PY numbers from RYA

Portsmouth Yardstick numbers are published by the RYA. Fetching them directly would
let scorers select a class and get the current PY number automatically, rather than
looking it up manually. Requires understanding the RYA's data availability — whether
there's a public API or whether scraping/download is needed.

### Fetch IRC and ECHO certs from Irish Sailing

IRC certificates and ECHO handicaps are managed by Irish Sailing. Importing them
directly — by sail number or boat name — would save scorers from manually entering
handicap values and reduce transcription errors. Depends on what data Irish Sailing
exposes and under what terms.

### Submit results to Irish Sailing and RYA

After scoring a series, results could be submitted back to Irish Sailing (for ECHO
and IRC) and the RYA (for PY). This closes the loop: handicap authorities use race
results to update handicap numbers. Currently this is a manual process involving
spreadsheets or web forms. Automating it would be valuable to both scorers and the
authorities, but requires agreement on data format and access.

---

## Finish entry UX

### Drag-reorder in finish list

Insertion and position editing cover the current UX needs. Drag-reorder could make
mid-list corrections faster, but whether it's worth the complexity depends on how
the existing UX holds up in real use. Revisit once there's experience with it.

*(Was GitHub issue #20)*

### Elapsed time recording in finish entry

MVP records finish time of day; elapsed time is back-calculated from the start. Some
finish boats use stopwatches and record elapsed times directly — supporting this natively
would save the scorer a step. Unclear how common this practice actually is in the field;
worth asking real recorders before building anything.

*(Was GitHub issue #21)*

---

## Scoring records and audit trail

### Revision history with revert and diff

Scorers need confidence that changes are tracked and reversible. Full revision history
of scoring data, allowing scorers to revert to an earlier state or compare between
revisions.

Open questions: granularity (per-save, per-field-change, or per-deliberate-checkpoint);
compression strategy; how far back to retain; how revisions are surfaced in the UI.
Revision history must be included in the JSON export — it is part of the authoritative
record.

*(Was GitHub issue #7)*

### Recover a deleted series

Revision history (above) covers reverting changes *within* a series. The complementary
gap is bringing back a series that was deleted outright — an accidental delete of the
whole record, not a bad edit inside it. Deleting a series should be a soft delete: the
row is marked deleted and hidden from the active list, but recoverable for some window
rather than destroyed immediately.

Open questions: retention window before a soft-deleted series is purged for good;
whether recovery is a self-service "trash" view or an admin/support action; how it
interacts with workspace scoping (a deleted series stays in its workspace) and with the
JSON export.

### Changelog on published results pages

Each time a scorer publishes an update, the change should be recorded in a changelog
visible on the published results page — collapsed by default. Scorer is prompted (but
not forced) to add a short summary when publishing an update. Each entry records at
minimum: timestamp, scorer identity, and optional commentary.

Natural extension once revision history is in place: link changelog entries to the diff
between versions, and allow viewers to browse earlier result snapshots.

*(Was GitHub issue #8)*

### Scorer attribution in snapshot history

When we have the user's email address (e.g. collected for bilge publishing), include it
as attribution in the snapshot history entries in the series file format.

*(Was GitHub issue #37)*

### Lock or archive a finished series

Once a series is over, the scorer should be able to mark it as finished — locking it
read-only so further edits aren't possible without an explicit unlock. Protects the
authoritative record from accidental changes (a stray keystroke on the standings tab
months later) and makes the series' status explicit in the UI.

Open questions: lock granularity (whole series vs. per-race); how unlock works and
whether it leaves an audit trail; whether locking is distinct from "archiving" (hiding
from the active list) or the same action; interaction with revision history once that
exists. The manual-archive side — archive as visibility, not locking — is tracked in
#154; decide there whether the two share a single action or stay separate.

---

## Workspaces and sharing

### Reconsider snapshot lineage once file-sharing is no longer the collaboration mechanism

`Series.lastSnapshotId`, `Series.snapshotHistory`, and `checkLineage()` exist to make
`.sailscoring` file exchange between scorers safe — classifying an incoming file as
`identical` / `clean` / `diverged` before clobbering local changes. The mechanism is
woven through `lib/types.ts`, `lib/series-file.ts`, the Postgres schema, validation,
API handlers, and the Open/Save dialogs in settings.

After Phase 8 (server-of-record) and Phase 10 (collaboration UX, #153) land, two scorers in
the same workspace edit the same row with `lastModifiedAt` doing conflict detection,
and cross-workspace sharing is "copy to my workspace" (which already resets lineage).
The only residual role for `.sailscoring` files is backup / occasional offline rescue,
none of which needs a multi-step history — a single "exported from" marker would do.

Once Phase 8 is stable, decide whether to keep the lineage as-is, simplify to a single
"last exported snapshot id", or remove it entirely and treat every file open as
diverged (matching cross-workspace copy semantics). Knock-on effects on the series-file
format (potential `formatVersion` bump), the Postgres schema, and the Open dialog UX.

*(Was GitHub issue #127)*

---

## Esoteric scoring engine requirements

Scoring variations that go beyond standard RRS Appendix A — supported by
Sailwave and occasionally specified in Notices of Race, but not common enough
to prioritise. Captured here so that when a real-world series needs one, we
have a starting point rather than a blank page.

### Non-discardable races

A series NoR can designate certain races as non-discardable — they must count
toward the final total even when the series allows discards. Example: the
Lambay Race is the centrepiece of the HYC Wave Regatta and its NoR marks it
as non-discardable, so a competitor's worst result cannot be the Lambay Race.

Shape of the change: a per-race flag on `Race`, surfaced in race settings, and
a tweak to the discard selection logic in `lib/scoring.ts` to exclude flagged
races from the discardable set.

### Race weightings

A series NoR can weight individual races differently — e.g. the Lambay Race
counts for 1.5× points. The weighting multiplies each competitor's score for
that race before series totals are computed.

Shape of the change: a per-race multiplier on `Race` (default 1.0), applied in
the series totalling step. Interaction with discards needs thought: is the
weighted or unweighted score used when selecting which race to discard?
Sailwave's behaviour here is worth checking before designing.

---

## Deferred handicap-system work

Variants and refinements of the existing handicap engine, designed against
the relevant specifications but not implemented. Held back pending real
demand from a target series. Detail in `docs/design/handicap-scoring.md`.

### RYA NHC 2015

The published RYA NHC algorithm — symmetric `α = 0.3`, T_C-based extreme
clamping (`cap-input` outlier strategy), base-number realignment anchored
to `H0`. Distinct from the implemented NHC1 (SWNHC2015) which uses
asymmetric blend rates, classifies on `S = Q/L`, and realigns to the
fleet's prior sum.

### Named NHC profiles (per-series registry and per-workspace library)

Per-fleet `Fleet.nhcProfile` override of the seven SWNHC2015 parameters
landed for #143 — every NHC fleet can already carry custom blend rates,
σ thresholds, and `MinFin` inline. The deferred work is sharing those
profiles by name across fleets, series, and workspaces:

- **Per-series profile registry.** `Series.nhcProfiles: NhcProfile[]`
  with a fleet-side `Fleet.nhcProfileId` pointer, replacing the inline
  `Fleet.nhcProfile`. Auto-created `"NHC1 (Sailwave)"` default profile so
  existing series keep stock parameters; scorers can add a `"HPH
  (aggressive)"` variant in the same series for an A/B run across two
  NHC fleets. Lock parameters on a shared profile after the first race
  scores to prevent retroactive rescoring across fleets; offer
  "duplicate profile" to fork an experiment.
- **Per-workspace profile library.** Workspace owners maintain a list
  of named profiles that get copied into new series at creation time.
  HYC could define the "HPH" profile once, every new HYC series picks it
  up automatically. Open questions: how does a personal-workspace scorer
  pick up a club's profile set (export/import JSON? join-org copy?);
  when the workspace edits a profile, do existing series get the
  update or stay frozen (lean: frozen — series are historical records).
- **Profile attribution in published HTML.** The per-race fleet header
  carries the profile name (`Rating system: NHC1 (HPH-aggressive)`),
  and — once workspace-sharing lands — the source workspace too,
  surfacing "this series used a custom profile" without exposing the raw
  parameters inline.

See the scoping discussion in #135 for the original options analysis;
the inline per-fleet step landed under #143 as the bridge.

### Scoring-inquiry rating adjustments

NHC and ECHO can be configured to exclude specific results (e.g. RDG, BFD,
DSQ) from the rating calculation while still counting them for series
points. Currently every participating boat is adjusted on every race.

### Series-level rating-history page

A view across the whole series showing each boat's rating evolution race
by race, with the existing per-race explainability columns rolled up.
Per-race explainability is implemented; the series-level rollup is not.

### ECHO certificate-layer features

The first ECHO pass implements the per-race performance-index blend only.
The formal Irish Sailing *ECHO Rules* document defines a certificate-
administration layer that production ECHO clubs run on top of that
algorithm — out of scope for the first pass, captured so it isn't lost:

- **Standard TCF per boat** (Rule 6) — the IS-issued certificate rating;
  a per-competitor field alongside the progressive handicap.
- **Hard limits on Current TCF** (Rules 6.6, 8.3) — Current TCF clamped
  to Standard TCF × [0.925, 1.12]; a post-blend clamp on the new handicap.
- **Block Adjustment** (Appendix E) — a scorer-triggered season-start
  action scaling every Current TCF by ΣStandard / ΣCurrent.
- **Provisional TCF status** (Rules 7.2, 8.1) — newly-rated boats whose
  results don't drive other boats' updates while their own TCF settles;
  affects whether a boat contributes to ΣH_S and Σ(1/T_E).

Detail in `docs/design/handicap-scoring.md` (ECHO → "Out of scope (first
ECHO pass): certificate-layer features").

### Carry-over of starting handicaps between series

Progressive systems (NHC, ECHO) need a starting handicap for race 1 of
each series. Today the scorer enters it per competitor by hand. A future
flow could auto-carry each boat's end-of-last-series TCF into the new
series.

Open question first: the HYC Championships data shows boats starting a
series on a TCF that differs from their carried-over master rating, so
the real-world convention isn't pinned down — straight carry-over, a
class-baseline reset between seasons, or deliberate manual entry. Ask the
fleet scorer before building anything.

### Phase 3: ORC Club

A more elaborate handicap system used internationally for offshore
racing, distinct from IRC. Out of scope for HYC and IODAI but the
obvious next system after IRC, NHC, and ECHO.

### ORC advanced methods (PCS, Custom Courses)

Beyond ORC Club itself, ORC defines Performance Curve Scoring (PCS) and
Custom Courses — scoring that models a boat's speed against the actual
wind conditions and course geometry of each race rather than a single
time allowance. Far horizon; only relevant if a target series runs full
ORC International scoring.

---

## AI and automation

### LLM-drafted changelog entries

When a scorer publishes an update, an LLM could automatically draft the changelog entry
by diffing the previous and new results — the scorer then reviews, edits, and confirms
before publishing. The input (structured results diff) is well-suited to LLM
summarisation.

Considerations: cost and latency of an LLM call at publish time (may need to be
optional or async); privacy (results data would leave the system if sent to an external
LLM API).

Depends on the changelog feature above.

*(Was GitHub issue #9)*

### Claude-assisted workflow for non-coder domain experts

Domain expertise (RRS Appendix A, obscure scenarios, edge cases) is rare and hard to
encode. A contributor workflow where an experienced scorer uses Claude to explore a
scoring scenario in natural language, Claude translates it into a declarative YAML test
case, and the contributor vets the YAML for accuracy — lowering the barrier to
contributing deep scoring knowledge without requiring coding ability.

The natural-language description alongside the YAML serves as human-readable
documentation, making the test case legible to other non-coders. The vetting step is
critical and non-trivial — only someone who really knows the rules can confirm the YAML
is correct.

*(Was GitHub issue #18)*

---

## Marketing and presence

### Short video demo on the website

A 60–90 second screencast showing the core scoring workflow, embedded on the marketing
site home page. Should reflect the keyboard-driven UX. Record at a stable milestone,
not too early; needs to be kept up to date as the UI evolves.

*(Was GitHub issue #6)*
