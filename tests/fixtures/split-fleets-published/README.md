# Published split-fleet championships

The three championships scored with split fleets, captured as published, for
`tests/split-fleets-published.test.ts`.

| Event | Page |
|---|---|
| `junior-champions-cup-2026` | https://app.sailscoring.ie/p/irishsailing/2026/junior-champions-cup/standings |
| `ilca7-men-worlds-2026` | https://app.sailscoring.ie/p/ilca-worlds/2026/ilca7-men/standings |
| `ilca6-women-worlds-2026` | https://app.sailscoring.ie/p/ilca-worlds/2026/ilca6-women/standings |

Each event has two files, both captured on 2026-09-24:

- **`<event>.sailscoring.json`**: the page's published data file (ADR-012), as
  linked from the page footer. This is the input: the test imports it.
- **`<event>.standings.json`**: the standings tables of the published page,
  one entry per table, with each row as header → cell text. This is the
  expectation. It was extracted with the same reading the test applies to the
  page it renders (`standingsTables`: SVG sprites stripped, tags removed,
  entities decoded, whitespace trimmed).

The expectation comes from the page rather than from the data file's own
`standings`, because the ILCA 7 data file is export version 2. It was published
on 2026-09-03, before the export carried a championship's standings in their
championship form. The page is what competitors read, whatever the data file's
version.

Don't refresh these to make a failing test pass. They record what was
published. A change that is meant to alter a published result, such as
relabelling the ILCA 7 races, should change the test's expectation
explicitly, with the reason written beside it.
