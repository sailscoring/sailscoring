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
