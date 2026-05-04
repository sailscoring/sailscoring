# Local development scripts

This page is the reference for every `pnpm` script, every file under
`scripts/`, and how the test environment is wired together. If you're
wondering "which command do I run?" or "where does this env var come
from?", start here.

## Quick reference

| Command                  | What it does                                         | Needs Postgres? |
|--------------------------|------------------------------------------------------|-----------------|
| `pnpm dev`               | Start Next.js in dev mode (uses `.env.local`)        | Only if you exercise auth/server routes |
| `pnpm build`             | Production build (uses `.env.local`)                 | No              |
| `pnpm start`             | Run a production build (uses `.env.local`)           | Only if you exercise auth/server routes |
| `pnpm start:test`        | Build + start with `.env.test` baked in              | Yes (auto-starts via `db:up`)  |
| `pnpm lint`              | ESLint                                               | No              |
| `pnpm test:unit`         | Vitest, DB tests self-skip                           | No              |
| `pnpm test:unit:db`      | Vitest with `DATABASE_URL` set; DB tests run         | Yes (auto-starts via `db:up`)  |
| `pnpm test:watch`        | Vitest watch mode                                    | No              |
| `pnpm test:e2e`          | Playwright, local-first build (no auth/server specs) | No              |
| `pnpm test:e2e:server`   | Playwright, full-stack build, only `@auth`/`@server` specs | Yes (auto-starts via `db:up`)  |
| `pnpm db:up`             | Bring up the local Postgres container, idempotent    | (it *is* the DB)|
| `pnpm db:migrate`        | Apply Drizzle migrations (uses `.env.local`)         | Yes             |
| `pnpm db:migrate:test`   | Apply Drizzle migrations to the local container      | Yes (auto-starts via `db:up`)  |
| `pnpm db:generate`       | Generate Drizzle migrations from schema              | No              |
| `pnpm db:studio`         | Drizzle Studio against `.env.local`'s `DATABASE_URL` | Yes             |
| `pnpm db:auth:generate`  | Regenerate `lib/db/schema/auth.ts` from Better Auth  | No              |
| `pnpm generate:fixtures` | Regenerate scoring fixture HTML                      | No              |
| `pnpm deploy`            | `vercel deploy` (preview)                            | -               |
| `pnpm deploy:prod`       | `vercel deploy --prod`                               | -               |

The `pretest:unit:db`, `pretest:e2e:server`, and `predb:migrate:test`
lifecycle hooks call `scripts/db-up.sh` automatically — you never need
to start the container by hand before running those commands.

## Files under `scripts/`

| File                              | Purpose                                                                                  |
|-----------------------------------|------------------------------------------------------------------------------------------|
| `scripts/db-up.sh`                | Idempotently bring up local Postgres in a podman container; verify port mapping is 5432  |
| `scripts/start-test.sh`           | Build + start Next.js with `.env.test` sourced; used by Playwright's `webServer.command` |
| `scripts/db-migrate.ts`           | Apply Drizzle migrations (called by `pnpm db:migrate`)                                   |
| `scripts/render-scoring-fixtures.ts` | Render YAML scoring fixtures to HTML for human review                                  |

## Env file layout

Three env files matter, in this load order (later wins):

1. **`.env.example`** — committed; documents what you'd set in `.env.local`. Never loaded.
2. **`.env.local`** — gitignored; your personal dev config (Neon URL, your Better Auth secret, etc.). Loaded by `pnpm dev`, `pnpm build`, `pnpm start`, and the `db:*` scripts via `tsx --env-file-if-exists`.
3. **`.env.test`** — committed; the test fixtures. Loaded by `tests/setup-env.ts` (vitest) and `scripts/start-test.sh` (Playwright). Values here are not secrets; they're test fixtures (see comments in `.env.test` for why that's safe).

`DATABASE_URL` is deliberately *not* in `.env.test`. Both test paths default it to the local container URL when unset:
- vitest: tests with `const skip = !DATABASE_URL` self-skip when nothing has set it (i.e. plain `pnpm test:unit`); `pnpm test:unit:db` sets it inline.
- Playwright: `scripts/start-test.sh` sets `DATABASE_URL=${DATABASE_URL:-postgres://sailscoring:...:5432/sailscoring}`.

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
  │   └─ scripts/db-up.sh     ← starts/verifies sailscoring-pg container
  └─ DATABASE_URL=… vitest run
      └─ tests/setup-env.ts   ← loads .env.test (DATABASE_URL already set, kept)
      └─ DB tests run against localhost:5432
```

### `pnpm test:e2e`

```
pnpm test:e2e
  └─ playwright test          ← chromium-local project, grepInvert=@auth|@server
      └─ webServer: pnpm start:test
          └─ scripts/start-test.sh
              ├─ source .env.test
              ├─ DATABASE_URL defaulted (unused in this mode)
              ├─ pnpm build
              └─ pnpm start
```

### `pnpm test:e2e:server`

```
pnpm test:e2e:server
  ├─ pretest:e2e:server
  │   └─ scripts/db-up.sh
  └─ USE_SERVER_DATA=true E2E_SERVER_MODE=1 DATABASE_URL=… playwright test
      └─ chromium-server project, grep=@auth|@server
      └─ webServer: pnpm start:test
          └─ scripts/start-test.sh
              ├─ source .env.test
              ├─ DATABASE_URL inherited from caller
              ├─ pnpm build (USE_SERVER_DATA baked in)
              └─ pnpm start
```

## Why this shape

A few decisions are not obvious:

- **Two `test:unit` variants instead of one.** Pure-logic tests (scoring, parsers) are the bulk of the suite and shouldn't require a running container. The DB tests already self-skip when `DATABASE_URL` is unset, so `pnpm test:unit` stays fast and dependency-free. `pnpm test:unit:db` is the strict superset.

- **`pretest:*` hooks instead of bundling `db:up` into the script.** The lifecycle hooks fail loudly: if Postgres can't come up or its port mapping has drifted, the tests don't run at all rather than running and silently connecting to the wrong place. Bundling them via `&&` would have the same effect, but lifecycle hooks document the dependency more clearly in `pnpm run` output.

- **`scripts/start-test.sh` does build + start.** `next build` bakes `NEXT_PUBLIC_*` into the bundle at build time, so the test env has to be in scope for the build, not just the start. Doing both in one script keeps the env-file sourcing in one place.

- **Container port mapping is verified, not just "docker run on first use".** A container created with `-p 5433:5432` (because 5432 was busy once) keeps that mapping until recreated. Every script downstream assumes 5432; without the verification, you'd silently connect to the wrong DB. `db-up.sh` exits non-zero if the existing container's mapping doesn't match.
