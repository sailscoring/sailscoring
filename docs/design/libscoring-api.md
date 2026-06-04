# libscoring API

The scoring engine at the heart of Sail Scoring. Takes a series
configuration, a list of competitors, and per-race finishes as input;
returns per-race results and series standings as output.

## Scope

libscoring does one thing: given what happened on the water, compute the
scores. It has no knowledge of databases, user interfaces, or network
protocols. It does not persist anything. It does not validate whether a
sail number is registered or whether a start time is plausible. Those are
the application's concerns.

The implicit unit of work is a single fleet. One scoring system at a time.
All inputs and outputs are plain data structures with no external
dependencies.

**Not in scope:**
- Competitor registration or event setup
- Finish entry or data validation
- Result storage or retrieval
- Publishing or formatting
- Multi-fleet orchestration (the application calls libscoring once per
  fleet per scoring system)

## Guiding principles

**Scoring inputs only.** The API accepts exactly what the scoring algorithm
needs and nothing more. Competitor names, club affiliations, boat classes,
division assignments — none of these affect scores, so none of them are
passed in. The only identifier libscoring sees is the competitor's ID.

**Immutable inputs, pure outputs.** Given the same inputs, libscoring
always returns the same outputs. There are no side effects and no internal
state. This makes the engine straightforward to test, cache, and reason about.

**Explicit beats implicit.** Missing competitors, missing ratings, and
absent finishes each have defined, explicit handling. libscoring does not
guess or silently default to unexpected behaviour.

**Designed in stages, fully implemented.** The API shape was first
validated against scratch scoring (IODAI use case), then extended to
static-TCF handicaps (IRC, PY) and progressive handicaps (NHC1,
ECHO). All four scoring systems are in production; the descriptions
below cover all of them.

## Inputs

### ScoringConfig

Scoring rules that apply uniformly across all races in the series.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| scoring_system | enum | Yes | `scratch`, `irc`, `py`, `nhc`, `echo` |
| low_point | boolean | Yes | True for Low Point (1st = 1 pt); false for Bonus Point |
| discard_profile | DiscardProfile | Yes | How many discards apply at each race count |
| result_code_points | map[string → PointsRule] | No | Override default points for specific result codes |

**DiscardProfile** defines the number of scores to discard based on how
many races have been sailed:

```
DiscardProfile:
  thresholds: list of { min_races: integer, discards: integer }
```

Example — "0 discards for fewer than 4 races, 1 discard for 4–9 races,
2 discards for 10 or more races":

```
thresholds:
  - { min_races: 1,  discards: 0 }
  - { min_races: 4,  discards: 1 }
  - { min_races: 10, discards: 2 }
```

The active threshold is the last entry whose `min_races` is ≤ the number
of races sailed.

**PointsRule** for result codes:

```
PointsRule:
  fixed: decimal          # use this exact value, or ...
  entries_plus: integer   # ... entries + this value (default +1)
```

The default for DNS, DNF, DSQ, OCS, UFD, BFD, RET, and DNC is
`entries_plus: 1` per RRS Appendix A. RDG and SCP have no fixed default
and must be supplied per finish.

### Competitor

One entry per boat competing in this fleet under this scoring system.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Opaque identifier. libscoring returns this ID in all output; the application maps it back to a sail number, name, etc. |
| rating | decimal | No | Time correction factor. Required when `scoring_system` is `irc` or `nhc`; ignored for `scratch` |

### Race

One entry per race sailed.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Opaque identifier |
| start_time | time | No | Start time for this fleet in this race. Required when `scoring_system` is `irc` or `nhc`; ignored for `scratch` |

### Finish

One entry per competitor per race. Competitors with no Finish for a race
are treated as DNC (did not compete) and scored accordingly — no explicit
DNC finish record is required for absent competitors.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| competitor_id | string | Yes | Must match a Competitor.id |
| race_id | string | Yes | Must match a Race.id |
| finish_position | integer | No | Cross-the-line order within the fleet. Used for `scratch` scoring |
| finish_time | time | No | Time of day the boat crossed the finish line. Used for `irc` / `nhc` scoring |
| result_code | string | No | DNS, DNF, DSQ, OCS, UFD, BFD, RET, DNC, RDG, or SCP. Takes precedence over position/time |
| rdg_points | decimal | No | Points awarded for Redress Given. Required when `result_code` is `RDG` |
| scp_points | decimal | No | Points after Scoring Penalty. Required when `result_code` is `SCP` |

Exactly one of `finish_position`, `finish_time`, or `result_code` should
be present for a normal finish. A Finish record with none of the three is
treated as DNC.

## Outputs

### RaceResult

Per-race outcome for one competitor under one scoring system.

| Field | Type | Description |
|-------|------|-------------|
| competitor_id | string | Matches the input Competitor.id |
| race_id | string | Matches the input Race.id |
| place | integer | Rank within the fleet for this race (1 = first). Null for result codes that carry no place |
| points | decimal | Score for this race |
| result_code | string | The code applied, if any |
| elapsed_time | duration | finish_time − start_time. Null for scratch scoring or coded finishes |
| corrected_time | duration | elapsed_time × rating. Null for scratch scoring or coded finishes |
| rating_used | decimal | Snapshot of the rating applied. Null for scratch scoring. Important for progressive handicaps (NHC) where the rating changes race to race |
| is_discard | boolean | True if this race result is discarded from the competitor's series total |

### SeriesStanding

Series-level outcome for one competitor.

| Field | Type | Description |
|-------|------|-------------|
| competitor_id | string | Matches the input Competitor.id |
| rank | integer | Final series position (1 = winner) |
| total_points | decimal | Sum of all race points before discards |
| net_points | decimal | total_points minus the discarded scores |
| discards_applied | integer | Number of race results excluded |
| race_results | list[RaceResult] | All per-race results for this competitor, in race order, with `is_discard` set |

### ScoringOutput

The complete output of one libscoring call.

| Field | Type | Description |
|-------|------|-------------|
| standings | list[SeriesStanding] | All competitors, ordered by rank |
| race_results | list[RaceResult] | Flat list of all per-race results across all competitors and races. Redundant with standings.race_results but convenient for tabular display |

## Entry point

```
score(
  config: ScoringConfig,
  competitors: list[Competitor],
  races: list[Race],
  finishes: list[Finish],
) → ScoringOutput
```

The function is synchronous and pure. There is no partial or streaming
output.

## Tie-breaking

Ties in series standings are broken per RRS Appendix A8 (2025-2028):

1. **A8.1** — each boat's race scores are listed best-to-worst, *excluding
   discards*; the tie is broken at the first point of difference in favour of
   the better score.
2. **A8.2** — if still tied, rank by the score in the last race, then the
   next-to-last, and so on. These scores are used even if some are discarded.
3. If still tied after A8.2: the tie stands; both competitors receive the same
   rank.

There is no place-count rung ("most firsts, then seconds, …") — that method was
removed from the RRS before the 2025-2028 edition.

`SeriesStanding.rank` reflects the tie-break result. Tied competitors
receive the same rank value (both ranked 3rd, for example).

## Error handling

libscoring surfaces errors as a structured list rather than by throwing.
The call always returns a `ScoringOutput`; an `errors` field on the output
carries any problems encountered.

| Error | Condition | Behaviour |
|-------|-----------|-----------|
| `unknown_competitor` | A Finish references a competitor_id not in the competitors list | Finish ignored; error reported |
| `unknown_race` | A Finish references a race_id not in the races list | Finish ignored; error reported |
| `duplicate_finish` | More than one Finish for the same competitor/race pair | First record used; subsequent records ignored; error reported |
| `missing_rating` | `scoring_system` is `irc` or `nhc` and a Competitor has no rating | Competitor excluded from standings; error reported |
| `missing_rdg_points` | `result_code` is `RDG` and `rdg_points` is absent | Competitor scored DNC for that race; error reported |
| `missing_scp_points` | `result_code` is `SCP` and `scp_points` is absent | Competitor scored DNC for that race; error reported |

A call with no valid finishes and no valid competitors returns an empty
`ScoringOutput` with no errors.

## Counted entries

RRS Appendix A uses "entries" to determine points for penalty codes. In
libscoring, **entries** is the number of competitors in the `competitors`
input list, regardless of whether they started or finished any race. This
matches common practice: a competitor who registers but never sails is
still an entry, and their existence raises the penalty score for codes
like DNS and DNC.

## Use case examples

### IODAI Junior Fleet — scratch scoring

```
config:
  scoring_system: scratch
  low_point: true
  discard_profile:
    thresholds:
      - { min_races: 1,  discards: 0 }
      - { min_races: 5,  discards: 1 }
      - { min_races: 9,  discards: 2 }

competitors: [ { id: "c1" }, { id: "c2" }, { id: "c3" } ]  # 3 entries

races: [ { id: "r1" }, { id: "r2" } ]

finishes:
  - { competitor_id: "c1", race_id: "r1", finish_position: 1 }
  - { competitor_id: "c2", race_id: "r1", finish_position: 2 }
  - { competitor_id: "c3", race_id: "r1", result_code: "DNS" }
  # c2 absent in r2 — implicit DNC
  - { competitor_id: "c1", race_id: "r2", finish_position: 2 }
  - { competitor_id: "c3", race_id: "r2", finish_position: 1 }
```

Expected output (2 races sailed, 0 discards):

| Competitor | Race 1 | Race 2 | Net | Rank |
|------------|--------|--------|-----|------|
| c1 | 1 pt | 2 pts | 3 pts | 1st |
| c3 | 4 pts (DNS = 3+1) | 1 pt | 5 pts | 2nd |
| c2 | 2 pts | 4 pts (DNC = 3+1) | 6 pts | 3rd |

### HYC Class 1 — IRC scoring

IRC scoring uses the same input/output shape as scratch with `rating`
populated on each Competitor (the boat's TCC) and `start_time` populated
on each Race. The engine computes `elapsed_time = finish_time − start_time`
and `corrected_time = elapsed_time × rating`, then ranks within the
fleet by corrected time. The per-race output includes `elapsed_time`,
`corrected_time`, and `rating_used` for explainability. PY scoring is
identical with `rating = 1000 / py_number`.

For progressive systems (NHC, ECHO) the same input shape applies; the
engine computes a per-race adjustment after scoring and surfaces the
post-race rating via `rating_used` on the *next* race. See
[`handicap-scoring.md`](handicap-scoring.md) for the algorithms.
