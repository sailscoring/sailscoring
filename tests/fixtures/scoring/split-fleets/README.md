# Split-fleet fixtures

Declarative test cases for qualifying/final-series (split-fleet) scoring, each
capturing a real championship scoring case. Companion to
[`codes.md`](codes.md) (the format/scenario codes) and the design docs
(`docs/design/split-fleets.md`, `.../format-survey.md`).

Run with `pnpm test:unit tests/split-fleets-fixtures.test.ts`. Adding a `.yaml`
here is enough to add a test. `pnpm generate:fixtures` renders an `.html`
preview alongside each one (Sailwave-style fleet-tinted standings — fleet-tinted
cells, medal-race points doubled and bold); commit both, like the other
scoring fixtures. The previews publish to the worked-examples site with the
rest of `tests/fixtures/scoring/`.

## What these are

Small, hand-verifiable YAML fixtures — the project's established fixture style
(`tests/fixtures/scoring/`) applied to split fleets. Each is anchored to a
specific real event via its `provenance` block, and preserves that event's real
**structure and rules** (fleet counts, discard profile, score-code bases, medal
config, and what actually happened). Fleet sizes are reduced to a handful of
boats so every score is checkable by hand; the real full-fleet outcome lives in
the `notes` prose. See [`codes.md`](codes.md) "Scale note" for why full-fleet
reconstruction from the captured results isn't possible.

## Schema

```yaml
description: str                 # test name
provenance:
  class: str
  year: int
  event: str
  si: str                        # reference-docs path or URL
  results: str
  code: F1 | F2                  # format archetype
  scenarios: [D5, ...]           # degenerate scenarios exercised
  alternatives: str              # other real events for the same case
runnable: bool                   # false => spec-only; runner marks it pending
reason: str                      # required when runnable is false
notes: |                         # prose: real event, real parameters, arithmetic

config:
  qualifyingFleets: [Yellow, Blue]
  finalFleets: [Gold, Silver]    # omit when the split never happens (D1)
  discardThresholds: [{minRaces, discardCount}]
  maxFinalDiscards: int          # cap on discards falling on final-series races
  medal: {size, raceCount, multiplier}   # omit for F1

competitors:
  - "y1 Helm Y1"                 # first token = sail number, rest = name

stages:
  - stage: qualifying | final | medal
    from: 1                      # fromStageRace (default 1)
    # Assign the round's fleets — prefer `assign` so the assignment logic is
    # under test; `fleets` declares membership explicitly (hand-picked cases).
    assign:
      seed: entry-order          # qualifying round 1: seed by an ordering
      # reassignAfter: 2         # qualifying: reshuffle by standings after Q2
      # split: true              # final: split the qualifying ranking
      # medalTop: 10             # medal: top N of the opening series
    expectedFleets:              # assert the computed membership (optional)
      Yellow: [s1, s4, s5]
      Blue: [s2, s3, s6]
    # fleets: { Yellow: [...], Blue: [...] }   # OR: explicit membership
    races:
      - n: 1                     # stage race number (Q1, F1, M1…)
        results:                 # fleet -> finish order; "sail" or "sail CODE"
          Yellow: [y1, y2, "y3 BFD"]
          Blue: [b1, b2, b3]

expected:
  standings:
    - {rank, sail, total, net, fleet?, medal?}   # fleet/medal optional
```

Notes on the schema:

- **Implicit DNC.** A boat in a fleet's membership who does not appear in a
  race's `results` is scored DNC by the engine (code base per stage). List a
  boat with an explicit `sail CODE` token (e.g. `"y3 DNF"`) only for a
  non-DNC code.
- **Finish order = crossing order.** In a `results` list, the position is the
  index; coded finishers (`sail CODE`) take no place.
- **`from`** lets a fixture carry more than one qualifying round (a
  reassignment), though most fixtures use a single round — the daily
  reassignment *pattern* is unit-tested separately
  (`tests/split-fleets.test.ts`), so these fixtures focus on scoring outcomes.
- **Medal stage.** The first fleet listed under a `medal` stage is the medal
  fleet (doubled points); any other is a companion "last race" fleet (scored
  from `medal.size + 1`).

## Testing fleet assignment

Fixtures should test the *assignment ceremony*, not just declare its output —
initial seeding, daily reassignment, and the final split are the most
format-specific, edge-case-prone part of the format. So a round declares
`assign:` (how it is formed) plus `expectedFleets:` (what that should
produce), and the runner computes the assignment via the engine's
`assignByRankPattern` / `finalBlockSizes` / `seedOrder` and asserts it:

- **01** seeds round 1 from the entry ranking and derives the final split —
  note the rank pattern (down the fleet list and back) spreads ability
  across fleets, so consecutive seeds
  land in *different* fleets (the whole point of seeding).
- **10** is the dedicated assignment test: seed → race → **reassign by the
  standings after Q2** → assert the fleets reshuffled.

The scenario fixtures (02–09) derive the final split from the qualifying
ranking too, but declare their qualifying fleets explicitly with `fleets:` —
they isolate a scoring rule (discards, medal, no-split, redress), so the
qualifying assignment is a fixed input, like a scoring fixture's declared
races. Each round's fleet id is scoped to the round, so a round-1 "Yellow" and
a round-2 "Yellow" are distinct fleets — a boat reassigned between them is not
double-scored.

## Score-code bases at small scale

The engine derives the qualifying code base from the largest modelled fleet
(+1) and the finals base from the boat's own fleet (+1). At the reduced fixture
scale these are small numbers (a DNC in a 3-boat fleet scores 4), and each
fixture's `notes` records the real event's value (e.g. ILCA Vallarta's 64). The
*rule* is what's tested; the *value* scales with the model.
