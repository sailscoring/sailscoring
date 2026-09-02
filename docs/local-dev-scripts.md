# Local development scripts

This page is the reference for every `pnpm` script, every file under
`scripts/`, and how the test environment is wired together. If you're
wondering "which command do I run?" or "where does this env var come
from?", start here.

## Quick reference

| Command                  | What it does                                         | Needs Postgres? |
|--------------------------|------------------------------------------------------|-----------------|
| `pnpm dev`               | Start Next.js in dev mode (uses `.env.local`)        | Only if you exercise auth/server routes |
| `pnpm dev:local`         | `pnpm dev` with `DATABASE_URL` overridden to the local container | Yes (auto-starts via `db:up`)  |
| `pnpm build`             | Production build (uses `.env.local`)                 | No              |
| `pnpm start`             | Run a production build (uses `.env.local`)           | Only if you exercise auth/server routes |
| `pnpm start:test`        | Build + start with `.env.test` baked in              | Yes (auto-starts via `db:up`)  |
| `pnpm lint`              | ESLint                                               | No              |
| `pnpm test:unit`         | Vitest, DB tests self-skip                           | No              |
| `pnpm test:unit:db`      | Vitest with `DATABASE_URL` set; DB tests run         | Yes (auto-starts via `db:up`)  |
| `pnpm test:watch`        | Vitest watch mode                                    | No              |
| `pnpm e2e:install`       | Download the Chromium build Playwright runs against; needed once per machine, and again after a Playwright version bump | No |
| `pnpm test:e2e`          | Playwright, full-stack build (`retries: 2`, so flaky-but-passed exits 0) | Yes — run `pnpm db:up` first   |
| `pnpm test:e2e:triage`   | `test:e2e` then file each flaky test as a `flake` GitHub issue (pre-push run) | Yes — run `pnpm db:up` first   |
| `pnpm test:e2e:stress`   | `test:e2e` with CPU burners on half the cores (flake stress test; no triage — read results as an aggregate signal) | Yes — run `pnpm db:up` first   |
| `pnpm flake:triage`      | Triage the last run's `test-results/report.json` into `flake` issues; `--dry-run` to preview, `--ignore-environmental` to file suspend / network-change ones anyway | No (needs `gh` auth) |
| `pnpm db:up`             | Bring up the local Postgres container, idempotent    | (it *is* the DB)|
| `pnpm db:migrate`        | Apply Drizzle migrations (uses `.env.local`)         | Yes             |
| `pnpm db:migrate:test`   | Apply Drizzle migrations to the local container      | Yes — run `pnpm db:up` first   |
| `pnpm db:psql:test`      | `psql` against the local container; pass `-c "..."` for one-shot SQL | Yes — run `pnpm db:up` first |
| `pnpm db:generate`       | Generate Drizzle migrations from schema              | No              |
| `pnpm db:generate:test`  | Same, in a checkout with no `.env.local` (drizzle-kit insists on a `DATABASE_URL` even though generate never connects; this supplies the local-container one) | No |
| `pnpm db:studio`         | Drizzle Studio against `.env.local`'s `DATABASE_URL` | Yes             |
| `pnpm db:auth:generate`  | Regenerate `lib/db/schema/auth.ts` from Better Auth  | No              |
| `pnpm provision-org`     | Admin CLI: create orgs, add members (uses `.env.local`) | Yes          |
| `pnpm provision-org:test` | Same, but against the local container                | Yes — run `pnpm db:up` first   |
| `pnpm change-email`      | Admin CLI: change a user's login email (uses `.env.local`) | Yes        |
| `pnpm change-email:test` | Same, but against the local container                | Yes — run `pnpm db:up` first   |
| `pnpm delete-account`    | Admin CLI: delete a user account + sole-member workspaces (uses `.env.local`) | Yes |
| `pnpm delete-account:test` | Same, but against the local container              | Yes — run `pnpm db:up` first   |
| `pnpm user-stats`        | Admin CLI: per-user activity/membership stats (uses `.env.local`) | Yes |
| `pnpm user-stats:test`   | Same, but against the local container                | Yes — run `pnpm db:up` first   |
| `pnpm republish`         | Operator pass: re-render existing publications with the current renderer; report only without `--apply` (uses `.env.local`; see [republish.md](republish.md)) | Yes |
| `pnpm republish:test`    | Same, but against the local container with `.env.test`'s app URL | Yes — run `pnpm db:up` first |
| `pnpm redirects`         | Admin CLI: list/add/remove public-URL redirects (ADR-011; uses `.env.local`) | Yes |
| `pnpm redirects:test`    | Same, but against the local container                | Yes — run `pnpm db:up` first   |
| `pnpm provision-token`   | Admin CLI: mint/list/revoke API keys (Bearer tokens) for the CLI (uses `.env.local`) | Yes |
| `pnpm provision-token:test` | Same, but against the local container             | Yes — run `pnpm db:up` first   |
| `pnpm cli`               | The `sailscoring` CLI — a pure `/api/v1` client (import/publish/reads); see [cli.md](cli.md) | No (talks to a deployment) |
| `pnpm generate:fixtures` | Regenerate scoring fixture HTML                      | No              |
| `pnpm racesense:inspect` | Read a RaceSense regatta export and report what the parser made of it, plus anything it didn't recognise; `--race N`, `--anomalies` | No |
| `pnpm nationality:sync`  | Regenerate `lib/nationality/generated/` from upstream dataset | No     |
| `pnpm deploy`            | `vercel deploy` (preview)                            | -               |
| `pnpm deploy:prod`       | `vercel deploy --prod`                               | -               |

The `predev:local` and `pretest:unit:db` lifecycle hooks call
`scripts/db-up.sh` automatically, so `pnpm dev:local` and `pnpm
test:unit:db` start the container for you. `pnpm test:e2e` and `pnpm
db:migrate:test` do *not* — run `pnpm db:up` first if the container
isn't already running. (CI provides Postgres via a service container,
so hooking `db-up.sh` into the e2e path would just invoke `podman` on a
runner that doesn't have it.)

## Files under `scripts/`

| File                              | Purpose                                                                                  |
|-----------------------------------|------------------------------------------------------------------------------------------|
| `scripts/local-env.sh`            | Resolve this checkout's app port + local Postgres container/URL (see [Working in a second git worktree](#working-in-a-second-git-worktree)); the one place the local `DATABASE_URL` is built. The `*:test` scripts wrap their commands in it |
| `scripts/db-up.sh`                | Idempotently bring up local Postgres in a podman container; verify the port mapping matches `local-env.sh`'s resolved port |
| `scripts/start-test.sh`           | Build + start Next.js with `.env.test` sourced; used by Playwright's `webServer.command` |
| `scripts/db-migrate.ts`           | Apply Drizzle migrations (called by `pnpm db:migrate`)                                   |
| `scripts/provision-org.ts`        | Admin CLI behind `pnpm provision-org` — create orgs, seed users, manage members          |
| `scripts/change-email.ts`         | Admin CLI behind `pnpm change-email` — reassign a user's login email                     |
| `scripts/delete-account.ts`       | Admin CLI behind `pnpm delete-account` — delete a user and their sole-member workspaces   |
| `scripts/user-stats.ts`           | Admin CLI behind `pnpm user-stats` — per-user activity and workspace stats               |
| `scripts/republish.ts`            | Behind `pnpm republish` — re-publish existing publications whose series is unchanged since they were published |
| `scripts/e2e-with-triage.sh`      | Behind `pnpm test:e2e:triage` — run the suite, then triage; exits with the suite's status |
| `scripts/flake-triage.ts`         | Behind `pnpm flake:triage` — file/update `flake` issues from the last run's report, skipping failures that a laptop suspend caused (see below) |
| `scripts/render-scoring-fixtures.ts` | Render YAML scoring fixtures to HTML for human review                                  |
| `scripts/racesense-inspect.ts`    | Behind `pnpm racesense:inspect` — inspect a RaceSense `.xlsx` from a regatta desk, no browser or series needed |
| `scripts/sync-national-letters.ts` | Refresh `lib/nationality/generated/` from the pinned upstream dataset                   |

`db-up.sh` runs the container under rootless `podman`, published on
`localhost:5432`. Stop it with `podman stop sailscoring-pg`; the data
persists until `podman rm`.

## Env file layout

Four env files matter:

1. **`.env.example`** — committed; documents what you'd set in `.env.local`. Never loaded.
2. **`.env.local`** — gitignored; your personal dev config (Neon URL, your Better Auth secret, etc.). Loaded by `pnpm dev`, `pnpm build`, `pnpm start`, and the `db:*` scripts via `tsx --env-file-if-exists`.
3. **`.env.test`** — committed; the test fixtures. Loaded by `tests/setup-env.ts` (vitest) and `scripts/start-test.sh` (Playwright). Values here are not secrets; they're test fixtures (see comments in `.env.test` for why that's safe).
4. **`.env.worktree`** — gitignored, optional; per-checkout port overrides (`SS_APP_PORT`, `SS_PG_PORT`). Loaded only by `scripts/local-env.sh`, never by Next.js — see [Working in a second git worktree](#working-in-a-second-git-worktree).

`DATABASE_URL` is deliberately *not* in `.env.test`. Both test paths default it to the local container URL when unset:
- vitest: tests with `const skip = !DATABASE_URL` self-skip when nothing has set it (i.e. plain `pnpm test:unit`); `pnpm test:unit:db` forces it via `scripts/local-env.sh --local-db`.
- Playwright: `scripts/start-test.sh` sets `DATABASE_URL=${DATABASE_URL:-$SS_PG_URL}` (the URL `local-env.sh` resolves for this checkout).

CI overrides `DATABASE_URL` directly when a service-container Postgres
is in scope; both defaults yield to whatever CI provides.

## How the test paths wire together

### `pnpm test:unit`

```
pnpm test:unit
  └─ vitest run
      └─ tests/setup-env.ts   ← loads .env.test (auth secret, URLs)
      └─ DATABASE_URL unset → DB tests self-skip
```

### `pnpm test:unit:db`

```
pnpm test:unit:db
  ├─ pretest:unit:db
  │   └─ scripts/db-up.sh     ← starts/verifies this checkout's container
  └─ scripts/local-env.sh --local-db vitest run   ← forces DATABASE_URL
      └─ tests/setup-env.ts   ← loads .env.test (DATABASE_URL already set, kept)
      └─ DB tests run against this checkout's local Postgres
```

### `pnpm test:e2e`

```
(prereq: pnpm db:up           ← starts/verifies this checkout's container)

pnpm test:e2e
  ├─ pretest:e2e
  │   └─ pnpm db:migrate:test
  │       └─ scripts/db-migrate.ts  ← applies Drizzle migrations (idempotent)
  └─ nice -n 10                     ← whole suite runs at low priority
      └─ scripts/local-env.sh --local-db playwright test  ← forces DATABASE_URL,
          │                                                  exports SS_APP_PORT
          └─ webServer: pnpm start:test
              └─ scripts/start-test.sh
                  ├─ source .env.test
                  ├─ source scripts/local-env.sh   ← re-derives URLs on a
                  │                                  non-default port
                  ├─ DATABASE_URL inherited from caller
                  ├─ pnpm build
                  └─ pnpm start
```

Two settings keep a local run from taking over the machine, both of which
CI leaves alone. `nice -n 10` covers the whole tree — the workers, their
headless Chromium processes, and the `next start` under `webServer` all
inherit it — so an interactive browser keeps winning the scheduler while
the suite runs; Postgres stays at normal priority, so the database side
stays responsive. Separately, `playwright.config.ts` pins `workers: 4`
locally rather than accepting the default of half the cores, which on a
12-core machine meant six workers and a load average near 27. Override
the worker count for one run with `pnpm test:e2e --workers=N`.

### `pnpm test:e2e:triage` and the suspend guard

```
pnpm test:e2e:triage
  └─ scripts/e2e-with-triage.sh
      ├─ pnpm test:e2e            ← reporters write test-results/
      │   ├─ json          → report.json     (per-test flaky status + attempt times)
      │   └─ clock-watch   → clock-gaps.json (windows where the machine stopped)
      └─ pnpm flake:triage        ← files `flake` issues, minus the environmental ones
```

Every filed issue also states what the test **used against what it was allowed**
(`14.8s of its 60s — 25%`). A bare timeout gives no sense of scale, so the reflex
is to raise the ceiling; the arithmetic makes it obvious when that's not on the
table. There are no `test.slow()` markers in the suite — one 60s budget covers
it, and the run summary names any marker that creeps back in without earning its
keep.

Suspending the laptop mid-suite fails whatever was in flight across all four
workers: the keep-alive sockets between the browser, the server and Postgres are
dead on resume, and the first requests through them hang until a timeout fires.
Those tests then pass on retry, so the report calls them `flaky` — which reads
as a load-sensitive test and invites the wrong fix, `test.slow()` on a healthy
test. `e2e/clock-watch-reporter.ts` catches this by sampling the wall clock
against the monotonic clock every two seconds: the wall clock advances across a
suspend, the monotonic one does not, so their divergence *is* the suspend.
`flake-triage` then reports rather than files any flaky test whose failed
attempt overlapped a gap (plus two minutes of socket recovery), and annotates
any hard failure that did. Re-run the suite for honest data. With no gaps file,
an unreadable one, or one from a different run, nothing is suppressed.

A change to the **host's network** does the same damage for the same reason: a
wifi roam, a VPN going up or down, or a link flap fires Chromium's
network-change notifier, which tears down every request in flight — loopback
included, so requests to the local test server die with the rest. The tell-tale
is unrelated specs flaking within seconds of each other, and `net::ERR_NETWORK_CHANGED`
in at least one of them. `e2e/helpers.ts` retries the navigations it owns, and
`flake-triage` reports rather than files any flaky test whose error names one of
these codes. Pass `--ignore-environmental` to file suspend and network-change
flakes regardless.

## Working in a second git worktree

By default every checkout shares one Postgres container (`sailscoring-pg`
on 5432) and one app port (3000). A second git worktree gets its own of
both by dropping an untracked `.env.worktree` at its repo root:

```bash
# .env.worktree
SS_APP_PORT=3001
SS_PG_PORT=5433
```

That's the whole setup. `scripts/local-env.sh` reads it and everything
downstream follows: `pnpm db:up` creates and manages a separate container
(`sailscoring-pg-5433`, its own data volume and lifecycle), the `*:test`
scripts and the e2e suite target it, and `pnpm dev` / the Playwright web
server listen on 3001. The two checkouts can run dev servers and test
suites concurrently without touching each other's data. Without the file,
nothing changes — the primary checkout and CI use the historical defaults.

Sign-in works on the non-default port because the dev scripts pass
`--app-origin` to the wrapper, which re-derives `BETTER_AUTH_URL` and
`NEXT_PUBLIC_APP_URL` to `http://localhost:3001` — overriding the
`.env.local` values, which name the default origin and would otherwise
make Better Auth reject the browser's requests as coming from an
untrusted origin. (`start-test.sh` does the same re-derivation itself
for the Playwright server.)

## Why this shape

A few decisions are not obvious:

- **Two `test:unit` variants instead of one.** Pure-logic tests (scoring, parsers) are the bulk of the suite and shouldn't require a running container. The DB tests already self-skip when `DATABASE_URL` is unset, so `pnpm test:unit` stays fast and dependency-free. `pnpm test:unit:db` is the strict superset.

- **`pretest:*` hooks instead of bundling `db:up` into the script.** The lifecycle hooks fail loudly: if Postgres can't come up or its port mapping has drifted, the tests don't run at all rather than running and silently connecting to the wrong place. Bundling them via `&&` would have the same effect, but lifecycle hooks document the dependency more clearly in `pnpm run` output.

- **`scripts/start-test.sh` does build + start.** `next build` bakes `NEXT_PUBLIC_*` into the bundle at build time, so the test env has to be in scope for the build, not just the start. Doing both in one script keeps the env-file sourcing in one place.

- **Container port mapping is verified, not just "docker run on first use".** A container created with a different `-p` mapping (because the port was busy once) keeps that mapping until recreated. Every script downstream assumes the port `local-env.sh` resolves; without the verification, you'd silently connect to the wrong DB. `db-up.sh` exits non-zero if the existing container's mapping doesn't match.

- **Explicit per-worktree ports instead of derived ones.** `.env.worktree` could compute ports from a hash of the checkout path, but predictable, greppable port numbers you chose yourself are worth the two-line file when you're staring at `podman ps` or a browser tab wondering which checkout you're in.
