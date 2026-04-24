# Scoring fixtures

Each `.yaml` file in this directory is a self-contained scoring scenario: series
configuration, competitor list, race results, and expected standings. The fixtures
are the authoritative statement of what the scoring engine is required to produce.

An `.html` preview file is checked in alongside each `.yaml` file so that scorers
can review test cases in a browser without running any code.

## Unified schema

All fixtures — scratch, fleets, codes, tcc-handicap, nhc — share one YAML shape.
The full TypeScript definitions live in `types.ts`; in broad strokes:

```yaml
description: "…"          # one-line summary, used as the test name
rrs_notes: "…"            # optional: which rule is under test
notes: |                  # optional: multi-line free-form

series:
  discardThresholds: []   # always present; may be empty
  dnfScoring: standard    # optional: 'seriesEntries' (default) or 'startingArea'

fleet:                    # optional; present for handicap/NHC fixtures
  scoringSystem: scratch | irc | py | nhc
  alpha: 0.15             # NHC only

competitors:
  - sailNumber: "…"
    name: "…"
    fleet: "Junior"       # optional: multi-fleet scratch fixtures only
    ircTcc: 1.05          # IRC only
    pyNumber: 1050        # PY only
    nhcStartingTcf: 0.95  # NHC only

races:
  - number: 1
    startTime: "14:05:00" # required for handicap/NHC, optional for scratch
    finishes:
      - sailor: "…"
        position: 1        # scratch
        finishTime: "…"    # handicap
        code: "DNF"        # optional
    aggregates:            # NHC only — per-race ctAvg / meanTcf / finisherCount / alpha
      …
    expected:              # optional — per-race per-boat arithmetic (CT, TCF, newTcf…)
      - sailor: "…"
        rank: 1
        …
    rejected:              # optional — handicap/NHC: boats excluded from scoring
      - sailor: "…"
        reason: "…"

expected:
  standings:               # always present — series totals exercised by every fixture
    - rank: 1
      sailor: "…"
      racePoints: [1, 2, …]
      raceCodes: [null, …]
      raceDiscards: [false, …]
      totalPoints: …
      netPoints: …
```

### Per-race `expected` is optional

Every fixture asserts the series standings. Fixtures additionally carry a
per-race `expected` array when the race-level arithmetic is worth showing a
human scorer — most importantly the CT/TCF calculations in tcc-handicap
fixtures and the TCF progression in NHC fixtures. Scratch fixtures omit it
because "position = rank = points" is already visible in `finishes`.

## Running the tests

```sh
pnpm test:unit
```

Three runners consume the fixtures, all sharing the loader in `types.ts`:

- `tests/scoring-fixtures.test.ts` — scratch / fleets / codes
- `tests/tcc-handicap-fixtures.test.ts` — IRC / PY per-race arithmetic + standings
- `tests/nhc-fixtures.test.ts` — NHC per-race progression + standings

Adding a new `.yaml` file in the appropriate subdirectory is enough to add a new test.

## Regenerating the .html previews

```sh
pnpm generate:fixtures
```

Run this after editing or adding a `.yaml` file and commit both files together.
The renderer dispatches on `fleet.scoringSystem` to produce a layout appropriate
to the scoring type.
