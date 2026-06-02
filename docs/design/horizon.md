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

### Fetch IRC and ECHO certs from rating authorities

Importing IRC TCCs and ECHO handicaps directly — by sail number or boat name —
would save scorers from manually entering handicap values and reduce
transcription errors. Two candidate sources, with different coverage and terms:

- **Irish Sailing** (`sailing.ie/Racing/Racing-Services/Echo-IRC-Ratings`) — the
  primary source for Irish events. Publishes the full national list (IRC *and*
  ECHO, ~358 boats) as a single server-rendered HTML table; no API, JSON, or
  download endpoint, but one GET returns everything. A stdlib-only scraper and a
  CSV snapshot live in `reference/data/irc-echo-ratings/`. This is the only
  source for **ECHO** (an Irish-specific system), and it covers IRC for Irish
  boats too, so for an event of only Irish boats it's sufficient on its own.

- **International IRC TCC database** (RORC/YCF) — the online TCC listings at
  `ircrating.org/irc-racing/online-tcc-listings/`, with the full club listing
  downloadable as `topyacht.com.au/rorc/data/ClubListing.csv`. Needed only when
  an event includes non-Irish IRC boats; overkill for Irish-only events.
  RORC/YCF provide the data "solely for the purpose of verification of IRC TCCs
  … for boats competing in IRC events" and forbid using it to create or
  contribute to any handicap/rating. Applying a published TCC to score an IRC
  event is the data's intended use and is in scope (TopYacht, who host the CSV,
  are themselves a scoring vendor). Two boundaries to respect: (1) never let IRC
  TCCs feed ECHO computation — ECHO is itself a rating, so that would cross the
  "creation of a handicap" line; (2) fetch per-event for boats in events being
  scored rather than maintaining a permanent public mirror of the whole DB. The
  Irish Sailing terms are the open question for that source.

Two further sources join these once **VPRS** and **YTC** scoring lands (see
"VPRS and YTC (DBSC 2026)" under Deferred handicap-system work): VPRS ratings at
`vprs.org/ratings.html`, and RYA YTC certificates listed by the RORC Rating
Office at `rorcrating.com/ryaytc/ryaytclistings`. Same per-event,
verification-only posture as the IRC listing — fetch the boats in an event being
scored, don't mirror the whole database.

### Submit results to Irish Sailing and RYA

After scoring a series, results could be submitted back to Irish Sailing (for ECHO
and IRC) and the RYA (for PY). This closes the loop: handicap authorities use race
results to update handicap numbers. Currently this is a manual process involving
spreadsheets or web forms. Automating it would be valuable to both scorers and the
authorities, but requires agreement on data format and access.

### Push competitor list to racingrulesofsailing.org

racingrulesofsailing.org (RRS.org) is the de-facto online tool for race-committee /
jury workflows — protest and request-for-redress filing, hearing scheduling, and
notice-board posting. Events that score in Sail Scoring may run their protest process
on RRS.org, and that tool needs the same competitor list. Today RRS.org imports it from
Sailwave via a plugin: the scorer opens the **RRS Interface** widget under Sailwave's
Plugins menu, pastes the event-specific **UUID** from the RRS Event Panel, and clicks
upload (repeatable — re-uploading syncs changes). See
`https://www.racingrulesofsailing.org/pages/help/sailwave_import`.

Sail Scoring could offer the same: the scorer pastes an RRS event UUID into a series and
pushes its competitors to RRS.org, re-pushing on change. The fields RRS.org accepts map
cleanly onto our competitor model — Class, Division, Boat Name, SailNo, NAT, HelmName
(→ First/Last Name), Email, Phone, MNA No., Club Name — so this is mostly a transport
question, not a data-model one.

Open questions: RRS.org publishes the Sailwave plugin's behaviour but not a documented
public API or its terms for third-party clients — the integration contract (endpoint,
auth, payload shape) would need to be confirmed with them rather than reverse-engineered
from the plugin. Maps to the same "thin write client over the Sail Scoring API" framing
as the mobile finish-recorder above, except here Sail Scoring is the *source* pushing to
an external sink rather than the API being consumed.

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

Every signed-in scorer has an email address (Better Auth); include it as attribution in
the snapshot history entries in the series file format.

*(Was GitHub issue #37)*

### Lock or archive a finished series — resolved by #154

**Decided: archive *is* the lock — one action, not two.** Archiving a series (#154)
makes it read-only and collapses it out of the active list; unarchiving (or copying to
another workspace) restores editing. Read-only is enforced server-side, not just in the
UI. Delete is gated behind archiving first (archive-then-delete). This subsumes the
"lock a finished series" idea this section originally proposed — there is no separate
lock action.

Still genuinely future: per-race lock granularity (vs. whole-series), and an unlock
audit trail once revision history exists. Those can layer on top of archive if a need
emerges; they don't change the archive model.

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

## Account lifecycle

### Self-service account deletion

The Privacy Policy directs users wanting their account deleted to email `mark@hyc.ie`,
and we act within the GDPR one-month window. That's a defensible interim position at
the current scale, but the modern expectation is a self-service button in `/account`
that removes the account without anyone in the loop.

Open questions: confirmation flow (typing the account email, an email-loop confirm,
or both); a short retention window for accidental deletes versus immediate hard
delete; what happens to workspaces the user owns alone (transfer to another member?
force-delete with notice?) versus workspaces where they are one of several members
(just remove the membership); whether to offer a one-click export of owned workspaces
before deletion; how `lastModifiedBy` and activity-log references survive an erased
user (tombstone identifier vs. anonymise).

Distinct from the operator-triggered stealth-beta cleanup that landed under #121
(export-and-email by the operator) — that was about *us* deleting *their* data on a
short clock; this is about *them* deleting *their own* account on demand.

---

## Country-scoped instances

### Standing up Sail Scoring instances beyond sailscoring.ie

`sailscoring.ie` is scoped to Irish clubs and classes deliberately — a narrow,
legible userbase is far easier for a central organisation to fund or operate
than the open-ended cost of running the service for the entire world (see
[sustainability.md](../sustainability.md), "A central organisation funds or
operates the service"). The natural consequence is that other governing bodies
or large clubs may want their own country-scoped instance —
`sailscoring.co.uk` run by/for the RYA, `sailscoring.fr` for the FFVoile, and
so on — each funded and operated by an entity with an interest in its own
sailing community.

The mechanics already exist as a runbook, not a feature: the backup runbook
documents bootstrapping a separate instance under its own Neon project and AWS
account, "preferred if the new instance is run by a different operator or legal
entity" ([database-backup.md](../database-backup.md#bootstrapping-a-new-instance)).
What's deferred is everything around making that repeatable and supported:

- **Onboarding playbook for a new operator.** Turn the runbook into a path a
  governing body's IT staff can follow — domain, Vercel project, Neon, Blob,
  Resend, the env wiring — without hand-holding from the original maintainer.
  This is the same independence the sustainability note wants between code
  governance and service governance.
- **Per-instance branding and locale.** Domain, contact email, governing-body
  name in copy, and likely language. Touches the marketing site, the app shell,
  and any hard-coded `sailscoring.ie` / `mark@hyc.ie` references.
- **Per-instance handicap systems.** A UK instance leads with RYA NHC 2015 and
  PY; an Irish one with ECHO and IRC; a French one with its own systems. Which
  handicap engines and defaults a given instance exposes becomes a
  per-deployment concern — relates to the deferred RYA NHC 2015 work below.
- **Cross-instance identity and discovery.** Open questions, not commitments:
  does a scorer with accounts on two instances have any shared identity; is
  there a federated directory of "where is club X scored"; how do published
  `/p/...` URLs read across instances. Likely unnecessary for a long time —
  each instance can be fully independent — but worth flagging that the
  workspace-namespaced URL scheme assumes a single host today.

Strongly tied to the open-source-vs-commercial decision: an open project that
an adopter "who doesn't fit the funded audience can always host their own
instance" of is exactly the federation story above
([sustainability.md](../sustainability.md), "The bus factor").

### Localization (i18n)

A French instance can't ship an English UI — `sailscoring.fr` would need to be
*in French*. The app is currently English-only with strings inline in JSX, so
localization is a prerequisite for any non-English-speaking instance, not a
polish item. It's a sizeable cross-cutting change, captured here so the scope
is visible before a target instance forces it:

- **String extraction and a message catalogue.** Every user-facing string
  pulled out of components into a translatable catalogue (e.g. an `next-intl` /
  ICU-message setup), with a French translation as the first non-English locale.
  This is the bulk of the work and touches almost every component.
- **Scoring/RRS terminology is the hard part.** Result codes (DNF, OCS, DSQ…),
  RRS Appendix A vocabulary, and handicap-system names are terms of art. Some
  are internationally fixed (the RRS abbreviations are defined by World Sailing
  and may stay English even in a French UI); others have established French
  equivalents. Getting this right needs a French-speaking scorer, the same way
  the scoring fixtures need a human scorer to vet them — a wrong translation of
  a result code is worse than no translation.
- **Formats, not just words.** Dates, times, and number formatting follow the
  locale; finish-time entry and the published results pages both surface these.
- **Published-page locale.** A published `/p/...` page renders in the locale of
  the instance (or the series), since the audience is the local sailing
  community — independent of whatever locale the scorer's browser prefers.
- **Per-instance default vs. per-user choice.** Likely each instance has a
  default locale (French on `.fr`) with a per-user override; open question
  whether a single instance ever needs to serve multiple locales, or whether
  one-locale-per-instance is enough for a long time.

Pairs with the per-instance branding/locale bullet in the instances entry
above: branding and language are the two things that make an instance feel like
it belongs to its own community rather than a re-skinned `sailscoring.ie`.

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

### VPRS and YTC (DBSC 2026)

The **DBSC 2026 Summer Series** NoR
(`reference/NoR_Keelboats_Wag_Summer_2026_Amended1.pdf`) adds two rating
systems Sail Scoring doesn't yet model, both driven by this one real-world
series. DBSC's general SI
(`reference/SI-A_Sailing_Instructions_General_2026_v2.pdf`, A15.1) lists the
full 2026 handicap set — ECHO (Progressive), IRC, VPRS, ORC Club, YTC and PY —
so with IRC, ECHO and PY in production and ORC Club captured as Phase 3 below,
VPRS and YTC are the two missing pieces for full DBSC coverage.

- **VPRS** (Velocity Prediction Rating System) — a UK measurement handicap
  that, like IRC, issues each boat a single time-correction coefficient applied
  time-on-time (`CT = ET × TCC`). Mechanically it is a **static-TCF** system,
  identical to the IRC path already in production; the engine needs no new
  scoring maths. What it needs is a distinct `scoringSystem` value (so results
  label it correctly, and a boat can be scored under VPRS *and* ECHO in
  parallel, as DBSC requires), a per-boat `vprsTcc` rating field alongside
  `ircTcc`, and a rating source (below). DBSC scores its (Mixed) Sportsboats and
  Cruisers 4A/4B/5A/5B classes under VPRS by default (NoR 2.3, 2.7), and allows
  it to substitute for IRC in Cruisers 0–3 on class request (NoR 2.6).

- **YTC** (RYA Yacht Time Correction) — the RYA's national keelboat
  yardstick scheme. Like PY it is a published yardstick number turned into a
  TCF, so it reuses the existing PY mechanics — but unlike PY it is a
  **per-boat** rating carried on a certificate (NoR 3.5), not a per-boat-*type*
  class number. That distinction drives the data model: PY today is a boat-type
  lookup, whereas YTC is a certificate field on the individual competitor. DBSC
  allows YTC to substitute for IRC in Cruisers 0–3 and for VPRS in Cruisers 4/5
  on class request (NoR 2.6, 2.7).

Both are gated the same way the existing systems are: a boat may only be scored
under a system for which it holds a current certificate (NoR 3.5), and a class
winning under IRC/VPRS forfeits the parallel ECHO prize (NoR 9.2) — the
parallel-scoring and prize-eligibility shape is the same as the ECHO/one-design
pairing already supported.

**Rating sources.** Both want a fetch path mirroring the IRC rating import
(`lib/irc-rating.ts`, #170): VPRS publishes its ratings at
`vprs.org/ratings.html`, and RYA YTC certificates are listed by the RORC Rating
Office at `rorcrating.com/ryaytc/ryaytclistings`. See the "Fetch IRC and ECHO
certs from rating authorities" entry above for the per-event, verification-only
terms posture these sources share.

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

## Operator visibility

### User engagement metrics

Two roles to track (per `docs/requirements/user-stories.md`): scorers, who log in
and edit, and result viewers, who anonymously hit published pages. The operator
needs to see growth in both, and the right question evolves with the user base.

**Scorers.**

- *Right now:* have invited scorers ever logged in? A binary per-user signal — the
  schema doesn't carry it (no `user.lastLoginAt`; `session` rows expire).
- *Next:* are they coming back? Per-workspace last activity, including reads. The
  single `requireWorkspace()` seam would naturally be the place to stamp a throttled
  `member.lastSeenAt` — which also powers a "Last active" column in the Members card.
- *As the user base grows:* weekly/monthly active scorers, retention cohorts,
  per-workspace activity counts. At that point engagement belongs on a dedicated
  operator surface, not the per-workspace Members card — the questions are about the
  product as a whole, not a specific club's roster.

**Result viewers.**

- *Right now:* are published pages being hit at all, and is the count growing?
  Anonymous traffic; the `/p/[...slug]` function (see ADR-008 Phase 10) is a natural
  pinch point for app-side counting, and Vercel's analytics covers the CDN side.
- *Next:* hits per series and per workspace over time — distinguishing pages that
  draw repeat traffic from one-shot regatta wrap-ups.
- *As publishing grows:* aggregate trends across all workspaces, surfaced on the
  same operator-side dashboard as the scorer metrics.

Natural first concrete steps, when each check actually needs answering: a
`member.lastSeenAt` stamp in `requireWorkspace()` on the scorer side, and turning
on request counting at the `/p` function (or Vercel analytics) on the viewer side.

---

## Marketing and presence

### Logo for sailscoring.ie

A real logo for the marketing site and the app, replacing the current placeholder.
Needs to work at multiple sizes (favicon, nav bar, app icon), on light and dark
backgrounds; SVG preferred; sailing/racing theme.

*Tracked in [sailscoring/sailscoring.ie#4](https://github.com/sailscoring/sailscoring.ie/issues/4).*

### Short video demo on the website

A 60–90 second screencast showing the core scoring workflow, embedded on the marketing
site home page. Should reflect the keyboard-driven UX. Record at a stable milestone,
not too early; needs to be kept up to date as the UI evolves.

*(Was GitHub issue #6)*
