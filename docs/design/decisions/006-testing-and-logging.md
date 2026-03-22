# ADR-006: Testing and Debug Logging Strategy

**Status:** Accepted

**Date:** 2026-03-22

**Deciders:** Mark McLoughlin

## Context

Before writing implementation code, the project needs agreed conventions for
testing and debug logging. Both are harder to retrofit than to establish
upfront, and both interact with the architecture: the scoring engine is a pure
function that deserves exhaustive table-driven tests; the repository layer
wraps IndexedDB and must be tested against real storage; the UI layer needs
end-to-end coverage of critical scorer workflows.

The bilge repo (the results-publishing service in this project) has already
made these choices and run them in production. Where bilge's answers fit, Sail
Scoring should match them rather than diverge without reason.

## Decision Drivers

- libscoring is the trust-critical core — its correctness must be backed by
  comprehensive, readable, easily-extended tests
- Repository tests must catch real Dexie/IndexedDB behaviour; mocking the DB
  was explicitly rejected after a prior incident where mocked tests passed but
  the real store failed (see bilge's history)
- End-to-end tests should cover the scorer workflows that end users depend on
- Tooling should match bilge where possible to reduce cognitive overhead
- Debug output from libscoring must not pollute test output or production
  console logs

## Decisions

### Test tooling

**Vitest** for unit and integration tests; **Playwright** for end-to-end tests.
This matches bilge exactly. No alternatives considered — the choice is already
validated by production use in this project.

### Directory layout

```
tests/            Vitest unit and integration tests  (*.test.ts)
e2e/              Playwright end-to-end tests         (*.spec.ts)
```

Unit tests live alongside the source they cover in `tests/`; e2e tests are
entirely in `e2e/`. This mirrors the bilge layout and keeps the project root
clean.

### Vitest environment

`jsdom` for all Vitest tests. libscoring is pure TypeScript and does not
require a DOM, but the repository layer uses Dexie/IndexedDB which needs a
browser-like environment. Using a single environment for all unit and
integration tests avoids the need to configure per-file overrides.

### libscoring tests

The scoring engine is a pure function: same inputs always produce the same
outputs. Tests are table-driven: each scenario is a named fixture with explicit
inputs (`ScoringConfig`, competitors, races, finishes) and expected outputs
(standings, per-race results, discard flags, tie-break ranks).

Each scenario should document what rule or edge case it covers in a comment.
The scenario inventory grows with the implementation — one-design scratch first,
then IRC/NHC, then edge cases (ties, redress, SCP, abandoned races, etc.).
See [issue #2](https://github.com/sailscoring/sailscoring/issues/2) for the
planned declarative test case library.

libscoring must not call `console.log`, `console.debug`, or any equivalent.
Diagnostic output — errors, warnings, explanations — is returned through the
`ScoringOutput.errors` field defined in the [libscoring API](../libscoring-api.md).
Tests assert on `errors` where relevant.

### Repository layer tests

Integration tests hit real Dexie/IndexedDB in the jsdom environment. No mocking
of the storage layer. Tests seed state directly (as bilge's e2e tests seed
IndexedDB via `page.evaluate()`), perform operations, and assert on the returned
domain objects.

The rationale mirrors bilge's: the repository abstraction exists to be swapped
out (Dexie → Drizzle/PostgreSQL in the full-stack phase). A mocked repository
test exercises the application code but not the repository contract. Only a real
store test catches schema bugs, query errors, and Dexie versioning issues.

### End-to-end tests

Playwright covering the critical scorer workflows: event setup, competitor entry,
finish entry, scoring, publishing. Configuration follows bilge:

- `testDir: './e2e'`
- `fullyParallel: true`
- `retries: 2` on CI; `0` locally
- Single `chromium` project for MVP (no cross-browser matrix until there are
  real users on other browsers)
- `webServer` block starts the dev server automatically

Tests seed application state directly into IndexedDB via `page.evaluate()`,
using the same helper pattern established in bilge's `e2e/helpers.ts`.

### Coverage expectations

No enforced coverage threshold for MVP. The expectation instead:

- **libscoring:** every supported scoring system, every result code, every
  discard profile variation, and every tie-break scenario has a named test case.
  Coverage here should be effectively complete because the input space is finite
  and well-defined by the rules.
- **Repository layer:** every repository method has at least one happy-path and
  one edge-case test.
- **E2e:** the two MVP use cases (IODAI scratch scoring, HYC IRC/NHC) can be
  walked end-to-end in a test.

Coverage tooling (e.g. `v8` reporter in Vitest) can be added when useful, but
raw percentage targets are not the goal. A test that proves a specific scoring
rule is implemented correctly is worth more than a test that exists solely to
move a coverage number.

### Debug logging

The application follows bilge's two-environment pattern:

**Client-side** (the scorer UI):

```typescript
// lib/log.ts
function log(...args: unknown[]): void {
  try {
    if (localStorage.getItem('sailscoring:debug') !== '1') return;
  } catch {
    return;
  }
  console.debug('[sailscoring]', ...args);
}
```

Gated on `localStorage.setItem('sailscoring:debug', '1')` in the browser
console. All API calls log at the call-site and on the result. The `try/catch`
handles environments where `localStorage` is unavailable (e.g. server-side
rendering).

**Server-side** (full-stack phase only — not relevant for MVP):

When the full-stack phase arrives, adopt bilge's server-side pattern:
structured JSON (`{ ts, tag, msg, data? }`), gated on an environment variable
(`SAILSCORING_DEBUG=1`), with every API handler wrapped in a `withLogging()`
decorator. Until then, there is no server to log from.

**In tests:**

The `sailscoring:debug` localStorage key is not set in test setup, so debug
output is suppressed by default. Individual test files can enable it if
diagnosing a specific failure.

libscoring emits no console output in any environment; its diagnostics are
entirely in-band through `ScoringOutput.errors`.

## Consequences

### Positive

- libscoring tests are self-documenting: each scenario names the rule it
  covers, making gaps obvious during rule implementation
- Repository integration tests will catch Dexie/IndexedDB bugs that mocked
  tests would miss, including schema migration failures
- Tooling consistency with bilge reduces context-switching
- Debug logging is off by default and adds no noise to normal test runs

### Negative

- jsdom is not a real browser; some Dexie/IndexedDB edge cases (notably iOS
  Safari's storage eviction behaviour) cannot be caught in unit tests and
  require manual verification
- Table-driven libscoring tests require more upfront fixture work than writing
  ad-hoc tests, though this pays off quickly as the test count grows

### Risks

- **Dexie version upgrades:** Dexie's IndexedDB implementation may behave
  differently across versions. Integration tests mitigate this but should be
  re-run after any Dexie upgrade.

## Related Decisions

- [ADR-001: Database Choice](001-database-choice.md) — establishes Dexie/IndexedDB
  for MVP, Drizzle/PostgreSQL for full-stack; informs the two-phase repository
  testing approach
- [ADR-003: Application Architecture](003-application-architecture.md) — defines
  the local-first MVP; explains why server-side logging is deferred

## References

- [libscoring API](../libscoring-api.md) — defines `ScoringOutput.errors`
- [bilge vitest config](https://github.com/sailscoring/bilge/blob/main/vitest.config.ts)
- [bilge playwright config](https://github.com/sailscoring/bilge/blob/main/playwright.config.ts)
- [bilge server-lib/log.ts](https://github.com/sailscoring/bilge/blob/main/server-lib/log.ts)
- [bilge e2e/helpers.ts](https://github.com/sailscoring/bilge/blob/main/e2e/helpers.ts)
- [Issue #2: Declarative scoring test cases](https://github.com/sailscoring/sailscoring/issues/2)
