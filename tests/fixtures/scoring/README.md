# Scoring fixtures

Each `.yaml` file in this directory is a self-contained scoring scenario: series
configuration, competitor list, race results, and expected standings. The fixtures
are the authoritative statement of what the scoring engine is required to produce.

An `.htm` preview file is checked in alongside each `.yaml` file so that scorers
can review test cases in a browser without running any code.

## Running the tests

```sh
pnpm test:unit
```

The test runner in `tests/scoring-fixtures.test.ts` picks up every `.yaml` file
automatically. Adding a new file is enough to add a new test.

## Regenerating the .htm previews

```sh
pnpm generate:fixtures
```

Run this after editing or adding a `.yaml` file and commit both files together.
