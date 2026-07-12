# ADR-010: As-published archives

**Status:** Proposed

**Date:** 2026-07-13

**Deciders:** Mark McLoughlin

## Context

Sail Scoring now carries three historical-results efforts, all built the same
way: reconstruct past seasons as **full-fidelity, re-scoreable series** and
push them through our own scoring engine, aiming to match the output the
original engine (Sailwave, HalSail) published at the time.

- **iodai-archive** — ~180 IODAI series back to 2009, reconstructed from
  Sailwave HTML, imported into the `iodai` workspace; the corpus behind the
  competitor-identity spine (#212), the public timelines (#217), and the
  identity manifest (#218).
- **dbsc-archive** — DBSC 2022–2025 reconstructed from HalSail captures. This
  is the effort that forced sub-series (#203), per-fleet race membership,
  `excludeDncOnlyCompetitors`, and file format v12 — and still landed on an
  *honest* 749-of-837 parity with a documented delta list.
- **hyc-archive** (#233) — planned: HYC's Sailwave-published history, captured
  verbatim in `markmc/reshyc`, not yet reconstructed.

The reconstruction approach has a structural problem: **exact-match parity
with another engine is asymptotic**. Every class's history embeds another
engine's scoring semantics — tie-break subtleties, code handling,
manually-applied SI clauses, per-fleet race membership conventions — and each
must be reverse-engineered, modelled, and maintained in *our* engine even
though no user will ever re-score a 2015 regatta. Where parity falls short,
the published record and our display disagree, which is exactly the kind of
discrepancy scorers notice (hence the delta-notes convention). The cost is
paid again per class and per source engine, which caps how many class
archives (ILCA, GP14, …) can realistically be brought in.

Meanwhile the July 2026 reconcile work (#221/#222) surfaced a second tension:
historical identity corrections live in two places — the in-app reconcile UI
and the archive repo's manifest — with the manifest authoritative on
re-apply. Two writers over one set of rows will drift; each row needs exactly
one owner.

The reframe this ADR records: **archiving historical results is a different
activity from scoring a current event.** For history, the originally-published
results *are* the truth — the job is to ingest and display them faithfully
and hang the competitor-identity spine off them, not to re-derive them. Only
current seasons (IODAI 2026 onward; the series clubs actually score in-app)
need the full re-scoreable model.

Timing constraint: the career-arc feature — including archived results — is
announced at the IODAI event of ~2026-07-19, on the corpus already in
production. This decision must therefore not sit on the event's critical
path, and the later migration must not break any URL announced at it.

## Decision Drivers

- **Fidelity to the record.** The published results are authoritative; a
  display that can disagree with them (parity gaps, delta notes) undermines
  the archive's whole point.
- **Cost per class.** Bringing in a new class's history should cost "write a
  capture parser", not "model another engine's scoring semantics".
- **One authority per row.** Git-driven data and UI-driven data must not
  fight over the same rows or identities.
- **Automation.** Archives are maintained by small git changes; ingest must
  be idempotent, incremental, and runnable from CI without hand-holding.
- **One identity spine.** Career arcs must span archived history and current
  in-app seasons seamlessly; the split in *management* must not become a
  split in *identity*.
- **URL stability.** Series pages and competitor-timeline slugs announced on
  the existing corpus must survive the migration byte-for-byte.
- **PII hygiene.** Source captures checked into git must carry no more
  personal data than the originally-published results did.
- **Reusability.** IODAI, HYC, and DBSC instantiate the same machinery;
  ILCA and GP14 should follow with only a parser and a repo.

## Considered Options

### Option 1: Full-fidelity reconstruction (status quo)

Keep reconstructing history as re-scoreable series through our engine,
chasing parity with the original engines' published output.

**Pros:**
- One data model and one code path; every feature (rankings, exports,
  re-scoring) works uniformly over all history.
- Proven: the IODAI and DBSC corpora exist and drove real feature design
  (sub-series, race-fleet exclusions, v12).

**Cons:**
- Parity is never exact; the archive can contradict the published record.
- Requires modelling each source engine's semantics in ours, per class,
  forever — the cost that caps expansion to more classes.
- Editable-in-principle history invites silent drift from the record.
- Leaves the manifest-vs-UI dual-authority problem unsolved.

### Option 2: Verbatim capture hosting

Serve the captured original HTML pages as-is (the `reshyc` model), with a
thin index around them.

**Pros:**
- Perfect fidelity by definition; near-zero transformation cost.
- Trivially reusable — any class with saved HTML qualifies.

**Cons:**
- No structured data, so no competitor-identity spine, no career arcs, no
  search, no timelines — it abandons the product goal, not just the parity
  chase.
- Foreign page chrome; results don't read as part of the workspace's site.
- .blw / non-HTML sources have nothing to serve.

### Option 3: As-published archives (chosen)

Ingest the *published outputs* into a structured but never-recomputed form:
enough structure for identity, timelines, and navigation (series and
per-race **ranks** are real numbers), everything else carried as display
strings exactly as published. Displayed in Sail Scoring's own chrome,
read-only forever, driven entirely by a git pipeline.

**Pros:**
- Fidelity by construction — nothing is recomputed, so nothing can disagree
  with the record; delta notes cease to exist as a category.
- Per-class cost collapses to a capture parser plus repo conventions.
- The identity spine and career arcs work over all history.
- Git becomes the single authority for archived rows and their identities,
  resolving the manifest-vs-UI tension by jurisdiction rather than merge
  rules.

**Cons:**
- Two series regimes forever, with branching in display, identity handling,
  and API enforcement.
- Archived results can't feed features that need raw finishes (re-scoring,
  what-if analysis) — accepted: no user need identified. Features that need
  only *places* — rankings (#209), career-arc positions — work fine off the
  stored ranks.

## Decision

Adopt **as-published archives**: a second, permanent series regime alongside
full-fidelity series. ("Static archive" was the runner-up name; *as-published*
wins because it states the contract — shown as published, never recomputed —
rather than a property.) The existing in-app **Archived** display state is
untouched and orthogonal; the `*-archive` git repos keep their names — they
are archives of source captures that feed a workspace's as-published series.

The sub-decisions:

1. **Data shape.** As-published series reuse the existing `series`, `fleets`,
   and `competitors` tables (so categories, the public listing, publishing,
   and the identity spine work unchanged), marked with a provenance flag.
   Instead of races/finishes feeding the scoring engine, they carry stored
   results: per-competitor **series standing** (structured rank + display
   cells) and per-race results (structured rank where present, the cell as a
   display string, a discard flag). Elapsed time, handicap, and corrected
   time are display strings — captured, never used to compute anything. The
   structured ranks are first-class inputs to place-consuming features: the
   career-arc timeline and rankings (#209) read them for as-published series
   exactly where they re-score a full-fidelity one, so a season ladder can
   span (or live entirely in) archived history.

2. **Display.** Rendered by us, through the existing publishing pipeline,
   **auto-published on ingest** (no separate publish step). The public pages
   should not be obviously different from full-fidelity ones; they simply
   omit what doesn't exist — the embedded JSON export and the detailed
   handicap-calculation views.

3. **Regime boundary.** As-published series are read-only in-app, enforced at
   the API (as archived-series writes are today). In-app-scored series stay
   full-fidelity forever; there is no "graduation" step for now — it would
   only discard information for no user benefit. Revisit if a real need
   appears.

4. **Identity.** One workspace-level identity spine spans both regimes. For
   as-published rows, identity assignment is **manifest-driven and fully
   pinned** (deterministic identity ids/slugs, the #218 model), applied by
   the ingest. The reconcile UI (#221) operates only on full-fidelity rows
   and identities — with one deliberate crossing: the UI may link a
   full-fidelity competitor to an archive-managed identity, and any merge
   involving an archive-managed identity keeps the archive-managed one as
   survivor (git will re-assert it regardless). The review queue never
   suggests merging two archive-managed identities; those belong to the
   manifest. Likewise the lazy after-write pass (#222) never touches
   as-published rows.

5. **Pipeline.** Each class/club has an archive git repo holding: the
   original captures (Sailwave HTML, PII-stripped `.blw`, HalSail public
   results, Sail100, …), per-event metadata (including **pinned published
   slugs**), and the identity manifest. PII stripping removes date of birth,
   email addresses, and phone numbers; **age at event stays** — it is part
   of the published results and an identity-matching signal. A generator
   builds the ingest file (a **distinct format**, not a `.sailscoring`
   variant — different contract: no revision history, no open-in-app, no
   round-trip), and **CI ingests it via `/api/v1`** — never `DATABASE_URL`
   (the ADR-009 rule). Ingest is idempotent and incremental: series ids are
   deterministic (derived from stable archive-repo paths), unchanged events
   are skipped by content hash, and a small git change never triggers a full
   rebuild.

6. **Credential.** Each archive repo's CI holds a workspace-scoped **and
   capability-scoped** key: it can create/update/publish as-published series
   and manage archive-managed identities in its workspace — nothing else. A
   leaked class-repo secret cannot touch full-fidelity series, members, or
   settings. Keys are per-repo and revocable, provisioned with the raised
   rate limits from day one (the #IODAI bulk-import lesson).

7. **Toolkit home.** Parsers, the PII scrubber, the file generator, and the
   ingest client live in the app repo for now, structured as a coherent unit
   for a clean later spin-out to `sailscoring/archive-kit`. Format
   definitions and the API client evolve atomically with the app.

8. **Migration.** The production IODAI corpus and DBSC 2022–2025 are
   **replaced** by as-published ingests. Zero URL breakage is a hard
   requirement, not a nice-to-have: published-series slugs and competitor
   slugs are seeded into the archive repos from current production before
   the first ingest, and the migration is verified against the full URL set.
   The DBSC reconstruction work is retired as product but keeps its value as
   provenance and as the crucible that shaped sub-series. DBSC 2026 stays on
   the live parity/compare loop — there the point *is* proving our engine.
   None of this is on the 2026-07-19 event's critical path; the event runs
   on the existing corpus and shipped features.

## Consequences

### Positive

- The archive can never contradict the published record; the delta-notes
  convention and the parity chase end.
- New class archives (ILCA, GP14, HYC #233) cost a parser and a repo, not an
  engine-semantics research project.
- One authority per row: git owns archived data and identities; the UI owns
  live ones; the boundary is a jurisdiction, not a merge policy.
- Career arcs, the competitor index, and public results present one seamless
  record across both regimes.
- Continuous, low-friction archive maintenance: fix a capture or a manifest
  entry in git, CI re-ingests just that.

### Negative

- Two regimes forever: the career-arc/timeline path, publishing, identity
  tooling, and write-enforcement all branch on provenance.
- Part of the DBSC reconstruction (per-season scripts, parity tooling for
  2022–25) becomes provenance rather than product.
- A new file format, ingest API surface, and credential type to maintain.
- Features needing raw finishes (re-scoring, what-if analysis) are
  unavailable over archived history; place-based features are not.

### Risks

- **Credential leakage from class-repo CI.** Mitigated by capability scoping
  (blast radius = that workspace's as-published data, all of it already
  public), per-repo revocable keys, and audit via the activity log.
- **Slug-stability discipline.** A re-mint anywhere breaks announced URLs.
  Mitigated by pinning slugs in git as data (never derived at ingest) and a
  migration check that asserts the before/after URL sets are identical.
- **Regime confusion.** Scorers may not grasp why one series is editable and
  another isn't. Mitigated by the *as-published* naming, banner copy on the
  series pages, and help docs.
- **Scope creep back toward re-scoring** ("can we just recompute this one
  column…"). The contract is stated here precisely so it can be pointed at:
  as-published data is never an input to computation beyond ordering by the
  ranks it already carries.

## Related Decisions

- [ADR-008](008-full-stack-transition.md): the workspace/Postgres foundation
  the ingest writes into.
- [ADR-009](009-api-and-cli.md): the ingest pipeline is a keyed API client —
  the "no DB-direct tooling" rule extends to CI.
- [ADR-004](004-results-publishing.md) (superseded) and its successor
  in-app publishing (#152): as-published series reuse the same pipeline,
  auto-triggered on ingest.

## References

- #212 / #217 / #218 — the identity spine, public timelines, and manifest.
- #221 / #222 — the reconcile UI and lazy linking whose jurisdiction this
  ADR narrows to full-fidelity rows.
- #209 — rankings; consumes stored ranks for as-published series, so
  ladders work across both regimes.
- #233 — the HYC archive, expected to be the first archive built natively on
  this pipeline rather than migrated to it.
- `docs/design/horizon.md` — *Cross-series identity and ranking*; the
  sections touching reconstruction to be revised under this ADR.
- Sibling repos: `iodai-archive`, `dbsc-archive`, `hyc-archive`,
  `markmc/reshyc` (verbatim HYC capture).
