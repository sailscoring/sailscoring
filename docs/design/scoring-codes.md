# Scoring Codes

Design document covering all RRS scoring codes, their semantics, data model
implications, UX, and a phased implementation plan.

> **Terminology note:** RRS Appendix A uses the term *scoring abbreviations*
> for DNC, DNS, OCS, etc. We use *scoring codes* throughout this application —
> it is more natural in software contexts and is the term used by most scoring
> tools (including Sailwave). The two terms are interchangeable; "scoring
> abbreviation" should be recognised when encountered in the rules or race
> documents.

---

## Context and Current State

The current implementation supports three result codes:

| Code | Notes |
|------|-------|
| DNC  | Did Not Compete — implicit when no finish record; explicit also allowed |
| DNF  | Did Not Finish |
| OCS  | On Course Side |

All three score as `N + 1` (with N from either series entries or starting area
per the `dnfScoring` series setting). No distinction is made between codes that
should and should not be discardable. The type definition is:

```ts
export type ResultCode = 'DNC' | 'DNF' | 'OCS';
```

This document describes the full set of RRS codes and a plan for phased
support.

---

## RRS Reference

The key sections governing scoring codes in the 2025–2028 RRS are:

| Section | Content |
|---------|---------|
| Appendix A5 | Scores for boats that did not finish, retire, or are disqualified |
| Appendix A6 | Scores for DNS, DNC, and OCS; states that DNC scores more than DNS and OCS (entries vs. starters) under the standard method |
| Appendix A9 | Guidance on redress: three recommended averaging methods |
| Rule 30.2 | Z Flag Rule — ZFP penalty |
| Rule 30.3 | U Flag Rule — UFD disqualification |
| Rule 30.4 | Black Flag Rule — BFD disqualification; not excludable |
| Rule 44.3 | Scoring Penalty (SCP) — boat's own score worsened; others unchanged |

### Appendix A5 — "Series Entries" vs "Starting Area" scoring

Under A5.2 (the default, our `dnfScoring = 'seriesEntries'`):
- Boats that did not start, finish, retire, or were disqualified: **N + 1**
  where N = number of boats entered in the series.

Under A5.3 (our `dnfScoring = 'startingArea'`):
- The same boats score **n + 1** where n = number of boats that came to the
  starting area (or started, depending on the code).

DNC is always scored as series entries + 1 regardless of the A5 method in use.

### Rule 44.3(c) — Scoring Penalty calculation

> The race score for a boat that takes a Scoring Penalty shall be the score
> she would have received without that penalty, made worse by the number of
> points stated in the notice of race or sailing instructions. When the number
> of points is not stated, the penalty shall be 20% of the score for Did Not
> Finish, rounded to the nearest tenth of a point (0.05 rounded upward). The
> scores of other boats shall not be changed; therefore, two boats may receive
> the same score. However, the penalty shall not cause the boat's score to be
> worse than the score for Did Not Finish.

ZFP also follows this same 20% calculation (rule 30.2 cross-references 44.3(c)).

---

## Code Taxonomy

There are three structurally distinct categories of scoring code.

### Category 1 — Position-replacing codes

These replace a finish position entirely. The boat receives a penalty score
(typically N + 1 or some variant) instead of a place-based score. The boat
has no finish position in the scoring sense.

| Code | Full name | Scoring | Discardable? | Notes |
|------|-----------|---------|--------------|-------|
| DNC  | Did Not Come to start area | Series entries + 1 | Yes | Always uses entries (not starters) |
| DNS  | Did Not Start | Starters + 1 (A5.3) or entries + 1 (A5.2) | Yes | Came to area, did not start |
| OCS  | On Course Side | Starters + 1 (A5.3) or entries + 1 (A5.2) | Yes | Started, but from wrong side |
| NSC  | Did Not Sail the Course | Starters + 1 (A5.3) or entries + 1 (A5.2) | Yes | Finished but shortcutted the course |
| DNF  | Did Not Finish | Starters + 1 (A5.3) or entries + 1 (A5.2) | Yes | Started, did not reach finish |
| RET  | Retired | Starters + 1 (A5.3) or entries + 1 (A5.2) | Yes | Voluntarily withdrew after starting |
| DSQ  | Disqualified | Starters + 1 (A5.3) or entries + 1 (A5.2) | Yes | Protest committee decision |
| DNE  | Disqualification Not Excludable | Starters + 1 or entries + 1 | **No** | DSQ where the rule breach precludes discard |
| UFD  | U Flag Disqualification | Starters + 1 or entries + 1 | Yes | Per rule 30.3; discard allowed |
| BFD  | Black Flag Disqualification | Entries + 1 (per 30.4) | **No** | Per rule 30.4; cannot be excluded |

**DNC vs the rest:** DNC is the only code that always uses *series entries* for
its penalty base. All other codes score against either starters or series
entries depending on the A5 method. This is the key reason they have different
values in practice.

**DSQ vs DNE:** Both are disqualifications by the protest committee. DSQ can
be discarded in the normal way. DNE is used when the rule breach is such that
the result must not be excluded (e.g. breaking rule 2, intentional
infringement). The scorer records the correct code as directed by the protest
committee decision.

**UFD vs BFD:**
- UFD (rule 30.3): boat is disqualified without a hearing; the code *can* be
  discarded. Treated like DSQ for scoring purposes.
- BFD (rule 30.4): boat is disqualified without a hearing; the code *cannot*
  be discarded — even if the race is restarted or resailed. BFD is therefore
  equivalent to DNE in terms of non-discardability.

**OCS vs DNS:** Both mean the boat was in the starting area. OCS = was on the
wrong side of the line at the starting signal. DNS = came to the area but did
not start for any other reason. Both score the same way under RRS Appendix A
(starters + 1 or entries + 1 depending on A5 method).

### Category 2 — Additive penalty codes

These *amend* a recorded finish rather than replacing it. The boat has a finish
position and receives penalty points on top of what that position would
normally score. Crucially (per rule 44.3(c) and Appendix A6.2), **the scores
of other boats are not changed** — so two boats can share the same score.

| Code | Full name | Scoring | Notes |
|------|-----------|---------|-------|
| ZFP  | Z Flag Penalty | Base points + 20% of DNF score | Per rule 30.2; can be stacked if identified on a re-start |
| SCP  | Scoring Penalty | Base points + stated % (or 20% default) | Per rule 44.3; explicitly as decided by the protest committee |
| DPI  | Discretionary Penalty Imposed | Base points + stated points | Points value determined by the protest committee |

The additive penalty calculation (per 44.3(c)):
1. Take the boat's points for the race as if no penalty applied (i.e. their
   finishing position converted to points).
2. Add the penalty amount: either a stated number of points, or 20% of the DNF
   score for that race (rounded to nearest 0.1, 0.05 rounds up).
3. The result cannot exceed the DNF score for that race.

For example, with 10 boats (DNF = 11 points):
- Boat finishes 3rd (3 points), receives 20% ZFP.
- Penalty = 20% × 11 = 2.2 points.
- Boat's score = 3 + 2.2 = **5.2 points**.
- Other boats keep their scores (1, 2, 4, 5, …); no re-ranking.

Because these codes require recording both a finish position and a code, they
represent a structural break from the current data model which treats positions
and codes as mutually exclusive (see [Data Model Implications](#data-model-implications)).

### Category 3 — Redress

Redress replaces a boat's score with a calculated average, rather than
assigning a fixed penalty.

| Code | Full name | Scoring |
|------|-----------|---------|
| RDG  | Redress Given | Average of other races (scorer-specified method) |

RRS A9 recommends three methods for the protest committee to consider:
- **(a)** Average of all races in the series *except* the race in question.
- **(b)** Average of all races *before* the race in question.
- **(c)** Points based on the boat's position at the time of the incident.

In all cases the average is rounded to the nearest tenth (0.05 rounds up). The
method chosen, and any restricting range of races, is recorded by the protest
committee in their decision and entered by the scorer.

RDG is not discarded in the normal way; it replaces the race score entirely.
Whether the replaced score is itself discardable depends on the series rules,
but the RDG score is treated as the actual score for discard purposes.

---

## Obsolete Codes

Codes that appeared in earlier editions of the RRS but have since been removed.
Not implemented, but documented here so that historic series files or imports
from older scoring tools can be recognised and mapped to a current code.

| Code | Full name | Status |
|------|-----------|--------|
| RAF  | Retired After Finishing | Listed in RRS 2009–2012 Appendix A11; removed in subsequent revisions. RET now covers all retirements regardless of whether the boat had already crossed the finish line. |

RAF was used when a boat finished a race but then voluntarily retired —
typically after realising it had broken a rule. Under the current RRS, RET is
the single code for any voluntary withdrawal. See also UK Sailmakers,
[Decoding Sailing Scoring](https://www.uksailmakers.com/2025/09/05/decoding-sailing-scoring).

---

## A6.2 Analysis — When Other Boats' Scores Are Unchanged

A key scoring principle in RRS A6.2 is that the scores of other boats shall
not be changed when certain penalties are applied. This is unusual — in
standard scoring, giving one boat a higher score effectively improves all
boats ranked behind them (their rank doesn't change, but the gap widens).

**Codes where A6.2 applies (others' scores unchanged):**
- ZFP, SCP, DPI — per rule 44.3(c) and rule 30.2 explicitly

**Implication:** Two boats may share the same score. The standard assumption
that scores are a unique sequence 1, 2, 3, … does not hold for races where
these codes apply.

**Codes where A6.2 does NOT apply:**
- All Category 1 codes (DNC, DNS, OCS, DNF, etc.) — these replace the result
  entirely and shift other boats' effective ranks.

---

## Discardability Rules

| Code | Discardable? | Authority |
|------|--------------|-----------|
| DNC  | Yes          | RRS A |
| DNS  | Yes          | RRS A |
| OCS  | Yes          | RRS A |
| NSC  | Yes          | RRS A |
| DNF  | Yes          | RRS A |
| RET  | Yes          | RRS A |
| DSQ  | Yes          | RRS A |
| UFD  | Yes          | RRS A (rule 30.3 does not exclude discards) |
| BFD  | **No**       | Rule 30.4: "her disqualification shall not be excluded in calculating her series score" |
| DNE  | **No**       | RRS — DNE means "Disqualification Not Excludable" by definition |
| ZFP  | Yes (the penalised score is discardable as normal) | |
| SCP  | Yes (the penalised score is discardable as normal) | |
| DPI  | Yes          | |
| RDG  | Yes (the redress score is used for discard purposes) | |

The system must track non-discardable codes and protect those race scores from
being selected as discards even when the normal discard algorithm would pick
them.

---

## Data Model Implications

Two approaches are presented. They differ primarily in how the *behaviour* of
each code is represented: hard-coded in the engine (Option A) or expressed as
data in a code definition entity (Option B).

Both options share the same `Finish`-level recording needs described below.

---

### Shared: what a Finish records for non-standard results

Regardless of option, a `Finish` record must be able to capture:

- A **position-replacing code** (`resultCode`): the boat has no finish
  position; the code defines the penalty.
- An **additive penalty** applied on top of a recorded position: the boat has
  a finish position *and* a penalty modifier. This breaks the current
  "position or code, never both" constraint.
- **Additive penalty parameters**: either "use the default % from the code
  definition" or "use this explicit % or this explicit points value instead".
  The per-application override is important: DPI always requires an explicit
  points value; SCP may need a scorer-entered override of the SI-specified
  amount.
- **Redress parameters**: the A9 method chosen by the protest committee, the
  specific set of races to average (the PC may exclude certain races from the
  pool), and optionally a scorer-entered points value when the PC computes the
  result directly.

A sketch of the additional Finish fields (wording varies by option):

```ts
// Additive penalty (ZFP, SCP, DPI applied to a boat that has a finish position)
penaltyCode: string | null;           // e.g. 'ZFP', 'SCP', 'DPI', or a custom code
penaltyOverride:                      // null = use definition's default
  | null
  | { type: 'percentage'; pct: number }    // e.g. SCP with a non-default %
  | { type: 'points'; points: number }     // e.g. DPI, or SCP with explicit points

// Redress (RDG or custom redress code)
// RDG is always recalculated dynamically — the score is not stored.
// includeRaces restricts the averaging pool to the races the PC specifies
// (e.g. "average of all races excluding Race 3 and the boat's worst score").
// null/empty = use all races consistent with the chosen A9 method.
redressMethod: 'all_races' | 'races_before' | 'stated' | null;
redressIncludeRaces: number[] | null; // race numbers; null = method default
redressPoints: number | null;         // for 'stated' method; null otherwise
```

### Non-discardable flag in `Standing`

Both options require `Standing` to track which races cannot be discarded:

```ts
export interface Standing {
  // existing fields …
  raceNonDiscardable: boolean[];  // true = this score is protected from discard selection
}
```

---

### Option A — Hard-coded categories, flat type extension

The engine treats the structural categories (position-replacing, additive
penalty, redress) as fixed logic. The `ResultCode` union is extended with
every standard code, and the engine contains explicit switch/case logic that
maps each code to its scoring behaviour. Additive codes are a separate concern
from position-replacing codes, reflected in distinct field names on `Finish`.

```ts
export type ResultCode =
  | 'DNC' | 'DNS' | 'OCS' | 'NSC' | 'DNF' | 'RET'
  | 'DSQ' | 'DNE' | 'UFD' | 'BFD';

export type PenaltyCode = 'ZFP' | 'SCP' | 'DPI';
export type RedressCode = 'RDG';
```

Engine logic (pseudocode):

```
switch (resultCode) {
  case 'DNC': return entriesPenalty;
  case 'DNS': case 'OCS': case 'NSC': …: return startersPenalty;
  case 'BFD': case 'DNE': return entriesPenalty AND mark non-discardable;
  …
}
if (penaltyCode) {
  base = finish_position_score;
  pct  = penaltyOverride?.pct ?? codeDefaults[penaltyCode].defaultPct;
  …
}
```

**Pros:**
- Straightforward to implement in phases; no new entity type required.
- The type system encodes the category distinctions; misuse is a compile error.

**Cons:**
- Adding a custom code means a code change in the engine, not a data change.
- Behavioural properties (discardable? A6.2 exempt? penalty base?) are
  scattered across engine switch statements rather than co-located.
- Supporting a YAML-driven custom code library later would require a
  significant engine refactor.

---

### Option B — Scoring Code Definition entity

Every code — including all built-in RRS codes — is modelled as a
`ScoringCodeDefinition` record. The engine becomes a generic interpreter of
these definitions; it contains no code-name-specific logic. Built-in
definitions ship with the application and are marked `builtIn: true`; custom
definitions are user-created.

```ts
interface ScoringCodeDefinition {
  code: string;          // abbreviation: 'DNC', 'ZFP', 'MYCLUB', …
  name: string;          // full name
  builtIn: boolean;      // true = RRS standard; false = user-defined

  pointsMethod: PointsMethod;

  // Behavioural flags
  discardable: boolean;
  otherScoresUnchanged: boolean;   // A6.2: don't re-rank other boats when this applies
}

type PointsMethod =
  // Standard position-replacing: N+1 penalty
  | { type: 'fixed_penalty'; penaltyBase: 'entries' | 'starters' }

  // ZFP/SCP style: add a percentage of the DNF score to the boat's points
  // per-application override (% or explicit points) is stored on the Finish
  | { type: 'additive_percentage'; defaultPct: number }

  // DPI style: scorer always enters explicit points at application time
  // (no default makes sense at the definition level)
  | { type: 'additive_stated' }

  // RDG style: A9 averaging; method and parameters stored on the Finish
  | { type: 'redress' };
```

The built-in definitions are a fixed set that ships with the app:

| code | pointsMethod | discardable | otherScoresUnchanged |
|------|-------------|-------------|----------------------|
| DNC  | fixed_penalty(entries)   | true  | false |
| DNS  | fixed_penalty(starters)  | true  | false |
| OCS  | fixed_penalty(starters)  | true  | false |
| NSC  | fixed_penalty(starters)  | true  | false |
| DNF  | fixed_penalty(starters)  | true  | false |
| RET  | fixed_penalty(starters)  | true  | false |
| DSQ  | fixed_penalty(starters)  | true  | false |
| DNE  | fixed_penalty(starters)  | **false** | false |
| UFD  | fixed_penalty(starters)  | true  | false |
| BFD  | fixed_penalty(entries)   | **false** | false |
| ZFP  | additive_percentage(20)  | true  | **true** |
| SCP  | additive_percentage(20)  | true  | **true** |
| DPI  | additive_stated          | true  | **true** |
| RDG  | redress                  | true  | false |

The engine reads these properties at scoring time; it never branches on the
code string itself.

**Custom codes:** a scorer (or advanced user via a YAML file) can define a new
code by specifying a `ScoringCodeDefinition`. The engine automatically handles
it correctly without any code change. For example, a club that uses "OOD"
(Officer of the Day, exempt from racing) could define:

```yaml
code: OOD
name: Officer of the Day
builtIn: false
pointsMethod:
  type: fixed_penalty
  penaltyBase: entries   # or could use average points — future extension
discardable: false        # OOD races are typically excluded from standings
otherScoresUnchanged: false
```

**Built-in code protection:** Built-in definitions are read-only in the UI.
The `builtIn` flag prevents them from appearing in the "edit" flow. Internally
they are still plain data — the engine imposes no special handling — but the
UI enforces their immutability. This prevents surprising reconfigurations
(e.g. making DNC additive) while keeping the engine fully generic.

**YAML surface for advanced users:** The definitions lend themselves naturally
to a YAML representation — the same shape as test fixtures. Exposing this as
a per-series `scoring_codes.yaml` section (embedded in the series file) is a
clean escape hatch for clubs with non-standard needs, without requiring a full
configurability UI. This would be a Phase 4 concern but the data model
supports it from day one.

**Pros:**
- All knowledge about a code's behaviour is co-located in its definition —
  no scattered engine switch statements.
- Custom codes are first-class citizens from the start.
- The engine is a generic interpreter; adding a code never requires an engine
  change.
- YAML-driven configurability is a natural extension path.

**Cons:**
- Slightly more upfront design work; a new entity type and resolver are
  required even for Phase 1.
- The type system loses some precision: the engine receives a `PointsMethod`
  union at runtime rather than a compile-time `ResultCode` discriminant.
  More discipline needed to ensure definitions are validated on load.
- Built-in definitions ship as a static TypeScript/JSON asset bundled with the
  app (not seeded into IndexedDB). The engine merges them with any user-defined
  codes at scoring time. This avoids migration headaches when built-in
  definitions change between app versions.

---

### Comparison

| Concern | Option A | Option B |
|---------|----------|----------|
| Phase 1 implementation effort | Lower | Slightly higher (new entity) |
| Custom codes | Engine change required | Data change only |
| YAML configurability path | Major refactor | Natural extension |
| Behavioural properties co-located | No (scattered in engine) | Yes (in definition) |
| Type-system safety | Strong (union types) | Weaker (runtime validation) |
| Risk of user misconfiguring built-ins | N/A (hard-coded) | Low (builtIn flag + UI guard) |
| Similarity to Sailwave | Closer (enumerated codes) | Closer in spirit, different in detail |

**Recommendation:** Option B, adopted from Phase 1. The engine-as-generic-
interpreter pattern is the right architecture for a tool that aspires to
support custom codes and YAML-driven configurability, and the upfront cost is
modest. The key discipline required is that the built-in definitions are
treated as a canonical, tested dataset — any change to them is as significant
as a change to the scoring engine itself.

The one area where we deliberately diverge from Sailwave's approach: we do
not expose the definition's `defaultPct` as a series-level override in the
UI. The 20% figure for ZFP and SCP is set by the RRS and should not be
quietly changed at series level. Instead, the per-application override on
`Finish` (percentage or explicit points) is the right place for scorer-entered
exceptions — it is explicit, per-boat, and tied to a specific protest committee
decision.

---

## UX Design

### Phase 1 codes (position-replacing)

Minimal UX change: extend the code picker to show all Category 1 codes. The
existing "most-common inline buttons + overflow picker" pattern works:

```
  IRL 0042  Patrick Regan  Senior · Silver
  Position [ 83 ]   [DNS] [DNF] [OCS] [···]
```

The `[···]` overflow picker expands to:

```
  [DNS]  [DNF]  [OCS]
  [NSC]  [RET]  [DSQ]
  [DNE]  [UFD]  [BFD]
  [DNC]
```

Ordering principle: most frequent at top-left, least frequent at
bottom-right. In practice DNS, DNF, OCS are the highest traffic. DSQ, DNE,
UFD, BFD are protest committee codes entered less often.

### ZFP / SCP / DPI — additive penalty entry

These codes require a position *and* a penalty. The UX must clearly
distinguish "boat did not finish (code replaces position)" from "boat
finished but received a penalty (code adds to points)".

**Proposed flow:**

1. Scorer enters the boat's finish position normally (e.g. position 12).
2. The finish list shows the boat at position 12.
3. Later (or immediately, if the ZFP is known at the time of scoring), the
   scorer selects the boat from the finish list and applies a penalty code via
   an "Add penalty" action — separate from the result code assignment.

```
  Finish list entry with penalty:
  12  IRL 1234  Jane Murphy  Junior · Gold  [ZFP]  [×]
```

The `[ZFP]` badge is displayed on the finish record. The score shown in the
results table will reflect the penalised points, with a tooltip or footnote
explaining the penalty calculation.

In the standings table, the penalised score is shown with a superscript or
footnote marker (e.g. `5.2ᶻ`) to indicate ZFP applied.

**Penalty points entry for SCP/DPI:**

When the stated penalty is a number of points rather than a percentage, a
points field appears:

```
  Apply penalty to IRL 1234
  Code: [SCP]
  Points: [ 3.0 ]   ← scorer enters stated penalty, or leaves blank for 20% default
```

### RDG — redress entry

Redress is a protest committee action. The UX should:
1. Allow the scorer to look up the boat and select "Apply redress".
2. Present the three A9 methods clearly, with a plain-English description of
   each.
3. Allow the scorer to either enter stated points directly (method (c) or
   committee-computed), or let the system calculate the average.

```
  Apply redress to IRL 5678 · Race 4

  Method:
  ○ Average of all races except Race 4 (A9a)
  ○ Average of races 1–3 only (A9b)
  ○ Points at time of incident: [ ___ ] (A9c / stated)

  Calculated average: 4.3 pts  ← live preview for A9a/A9b
```

### Standings table display

The standings table should convey non-normal results clearly:

| Scenario | Display |
|----------|---------|
| Standard penalty code (DNS, DNF, etc.) | Show code (e.g. `DNS`) instead of points in the race column |
| Discarded code | Strikethrough: `(DNS)` |
| Non-discardable code | Bold or red: **BFD** — always shown without strikethrough |
| Additive penalty (ZFP) | Show penalised points with marker: `5.2ᶻ` |
| Redress | Show redress points with marker: `4.3ʳ` |

---

## Implementation Phases

### Phase 1 — Full set of position-replacing codes

**Scope:**
- Define the `ScoringCodeDefinition` entity and seed the built-in definitions
  for all RRS codes (Option B).
- Scoring engine: refactor to read `pointsMethod`, `discardable`, and
  `otherScoresUnchanged` from definitions rather than branching on code
  strings. At this phase only `fixed_penalty` pointsMethod is needed.
- Discard logic: add `raceNonDiscardable` to `Standing`; the engine protects
  any result whose code definition has `discardable: false`.
- Finish entry UI: expand code picker to show all position-replacing codes.
- Standings table: display codes correctly; indicate non-discardable results.
- Series file: update serialization for new codes.
- Fixtures: add scoring fixtures for DNS/NSC/RET/DSQ/DNE/UFD/BFD scenarios,
  including a discard scenario where a non-discardable code is protected.
- Glossary: define all codes.

**Effort:** Medium — the engine refactor toward generic interpretation is the
main risk; test fixtures will catch regressions.

**Does not include:** Additive penalties (ZFP/SCP/DPI), RDG, custom codes,
any configurability UI.

---

### Phase 2 — Additive penalty codes (ZFP, SCP, DPI)

**Scope:**
- Data model: add `penaltyCode` and `penaltyPoints` fields to `Finish`.
- Scoring engine: calculate penalised points per rule 44.3(c); apply A6.2
  (no re-ranking of other boats; allow duplicate scores).
- Finish entry UI: "Add penalty" action on existing finish list entries.
  Show penalty badge on penalised entries.
- Standings table: show penalised points with footnote markers.
- Series file: update serialization.
- Fixtures: add scoring fixtures for ZFP, SCP (default 20%, explicit points
  override), DPI.

**Dependencies:** Phase 1 complete.

**Effort:** Medium-high — the A6.2 requirement (no re-ranking) is a
meaningful change to the scoring engine's assumptions; careful fixture design
needed.

---

### Phase 3 — Redress (RDG)

**Scope:**
- Data model: add `redressMethod`, `redressIncludeRaces`, and `redressPoints`
  to `Finish` (see shared Finish fields above).
- Scoring engine: implement three A9 averaging methods. RDG is always
  recalculated dynamically on each scoring run — the score is never stored.
  The engine requires access to the full series context (all race results for
  this competitor). `redressIncludeRaces` restricts the averaging pool when
  the PC has directed specific races to be included or excluded.
- Finish entry UI: "Apply redress" action; method selection with plain-English
  labels; `includeRaces` picker for pool restriction; live points preview.
- Standings table: show redress points with footnote marker.
- Series file: update serialization.
- Fixtures: add scenarios for each A9 method, including a pool-restricted case.

**Dependencies:** Phase 1 complete.

**Effort:** High — dynamic calculation requires a two-pass scoring run (other
races first, then RDG races). Circular dependency risk if two boats in the same
race both have RDG assigned; the engine should detect this and surface an error.

---

### Phase 4 — Scoring code configurability

**Scope (indicative, needs separate design):**
- Per-series configurable scoring code table.
- Custom code definitions: name, abbr., base points method, discardable flag,
  A6.2 flag, "came to start area" / "started" / "finished" semantics.
- Pre-defined code library that matches the full RRS set but allows SI/NOR
  overrides (e.g. a club that uses a non-standard points value for DSQ).
- Fleet-level scoring configuration override (per Sailwave model).

**Dependencies:** Phases 1–3 complete.

**Effort:** High — this is largely a UI problem (configuration screens are
complex to build well) rather than a scoring logic problem.

---

## Open Questions

| # | Question | Phase |
|---|----------|-------|
| 1 | Circular RDG dependency: if two boats in the same race both have RDG assigned, each boat's average depends on the other's RDG score. The engine should detect this and surface an error rather than looping — but what should the scorer do in that case? Likely rare in practice; the PC would stagger or state one result explicitly. | Phase 3 |
| 2 | ZFP stacking (multiple penalties in same race from a re-start): deferred until real-world demand is confirmed. When it arises, decide between an array of penalty applications on `Finish` vs. two separate linked records. | Post-Phase 2 |

---

## Quick Reference

```
====================================================================
POSITION-REPLACING CODES
(replace finish position; boat receives penalty score)
====================================================================

Code  Full name                        Points base          Disc?  Notes
----  -------------------------------  -------------------  -----  -----
DNC   Did Not Come to start area       Series entries+1     Yes    Always entries, never starters
DNS   Did Not Start                    Starters/entries+1   Yes    Came to area but did not start
OCS   On Course Side                   Starters/entries+1   Yes    Wrong side at start; rule 30.1
NSC   Did Not Sail the Course          Starters/entries+1   Yes    Finished but missed a mark
DNF   Did Not Finish                   Starters/entries+1   Yes    Started, did not finish
RET   Retired                          Starters/entries+1   Yes    Voluntarily withdrew (rule 44.1)
DSQ   Disqualified                     Entries+1            Yes    Protest committee, after hearing
DNE   Disqualification Not Excludable  Entries+1            NO     Serious breach; cannot be discarded
UFD   U Flag Disqualification          Entries+1            Yes    Rule 30.3; no hearing; discardable
BFD   Black Flag Disqualification      Entries+1            NO     Rule 30.4; no hearing; not discardable

Starters/entries+1: depends on series A5 setting (default: entries+1)

====================================================================
ADDITIVE PENALTY CODES
(amend finish position; other boats NOT re-ranked — RRS A6.2)
====================================================================

Code  Full name                        Penalty                          Disc?
----  -------------------------------  -------------------------------  -----
ZFP   Z Flag Penalty                   +20% of DNF score (≤ DNF)        Yes
SCP   Scoring Penalty                  +stated% or 20% default (≤ DNF)  Yes
DPI   Discretionary Penalty Imposed    +stated points                    Yes

Penalty formula (rule 44.3(c)):
  penalised_score = min(base_score + penalty_amount, dnf_score)
  penalty_amount  = 20% × dnf_score, rounded to nearest 0.1 (0.05 rounds up)

ZFP can be stacked (additional 20% per re-start attempt if re-identified)

====================================================================
REDRESS
====================================================================

Code  Full name     Scoring                              Disc?
----  ------------  -----------------------------------  -----
RDG   Redress Given Average of other races (A9 method)  Yes

A9 methods (protest committee chooses):
  (a) Average of all races in series except race in question
  (b) Average of races before the race in question
  (c) Points based on position at time of incident
All averages rounded to nearest 0.1 (0.05 rounds up)

====================================================================
KEY DISTINCTIONS
====================================================================

DNC vs DNS:  DNC = absent from area (entries+1, always higher)
             DNS = came but did not start (starters/entries+1)

DSQ vs DNE:  Both protest committee; DNE cannot be discarded

UFD vs BFD:  UFD discardable; BFD NOT discardable

ZFP vs SCP:  ZFP automatic (30.2), no hearing
             SCP protest committee decision
             Both add to boat's score; A6.2 exemption

====================================================================
RRS REFERENCES
====================================================================

Rule 30.2    Z Flag Rule — ZFP
Rule 30.3    U Flag Rule — UFD
Rule 30.4    Black Flag Rule — BFD
Rule 44.3    Scoring Penalty calculation (also used by ZFP)
Rule 62      Redress
Appendix A5  Scores for boats not finishing, retiring, disqualified
Appendix A6  DNS/DNC/OCS scores; A6.2 additive penalty exemption
Appendix A9  Guidance on redress scoring
```
