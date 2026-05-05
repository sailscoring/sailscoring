# Deploying Sail Scoring

## Overview

Sail Scoring runs as a Next.js application on Vercel. The user-visible app
today is fully client-side — scoring data lives in IndexedDB via Dexie.js,
results are published via the [bilge](https://github.com/sailscoring/bilge)
and [scupper](https://github.com/sailscoring/scupper) services.

The server backend (Postgres + Better Auth) is being introduced incrementally
per [ADR-008](docs/design/decisions/008-full-stack-transition.md). Phase 1
wires up the database, authentication, and a personal-workspace model behind
the `USE_SERVER_DATA` feature flag (off by default). Until Phase 6 flips that
flag, only the new `/sign-in`, `/account`, and `/api/health` routes exercise
the backend; everything else continues to run from IndexedDB.

This guide is a single end-to-end run for a fresh deployment. If you're just
setting a new env var, skip to the [Environment variables](#environment-variables)
section.

---

## Prerequisites

- A [Vercel account](https://vercel.com) with the project repo connected
  (Pro tier required for private repos)
- [Vercel CLI](https://vercel.com/docs/cli): `pnpm add -g vercel`
- Node 24.x, pnpm 10
- Optional but recommended for local DB work: a container runtime
  (`podman` / `docker`) for the @auth Playwright suite

---

## 1. Install dependencies

```sh
pnpm install
```

## 2. Log in to Vercel and link the project

```sh
vercel login
vercel link
```

Follow the prompts to either link to the existing `sailscoring` project or
create a new one. This writes `.vercel/project.json`.

## 3. Provision Neon Postgres

In the Vercel dashboard: **Storage → Create Database → Neon (Marketplace)**.
Create separate branches for **Production**, **Preview**, and **Development**;
Vercel auto-injects `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`) per
environment.

The Neon integration is the only source of `DATABASE_URL` — do not set it
manually.

## 4. Provision Resend

Resend sends magic-link emails. For dev you can skip this entirely (see
[Local development](#local-development) below) — the dev sender writes
magic-link URLs to the terminal and `tests/.magic-links.log` when
`RESEND_API_KEY` is unset.

For Preview/Production:

1. Sign up at [resend.com](https://resend.com)
2. **Domains → Add Domain →** `sailscoring.ie` (the apex; the marketing site
   already lives there but doesn't currently send mail, so SPF/DKIM are free).
   Resend shows the DNS records to add.
3. Add them at your DNS registrar:

   | Type | Name                | Value                                          |
   |------|---------------------|------------------------------------------------|
   | TXT  | `resend._domainkey` | (DKIM key from Resend)                         |
   | TXT  | `send`              | `v=spf1 include:amazonses.com ~all` (or root)  |
   | MX   | `send`              | `feedback-smtp.<region>.amazonses.com`         |

   > Copy the exact values from the Resend dashboard — they vary by region.
   > If we later add a second sender that uses `sailscoring.ie`, the SPF
   > record at the apex will need to include both providers in one record;
   > you cannot have two `v=spf1` TXT records on the same name.

4. Click **Verify DNS Records**. Propagation usually takes minutes.
5. **API Keys → Create API Key** with send-only access. Save the value for
   step 5.

## 5. Set Vercel environment variables

Vercel has three environments: **Production**, **Preview**, and
**Development**. Production deploys when you `vercel deploy --prod` (or push
to `main`). Preview deploys for any other branch / `vercel deploy`.
Development is *only* used to populate `.env.local` via `vercel env pull`.

### Per-environment matrix

| Variable                       | Production           | Preview              | Development          | Sensitive? |
|--------------------------------|----------------------|----------------------|----------------------|------------|
| `DATABASE_URL`                 | from Neon            | from Neon            | from Neon            | (managed)  |
| `BETTER_AUTH_SECRET`           | random (set)         | random (set)         | random (set)         | yes for prod/preview, no for dev |
| `BETTER_AUTH_URL`              | `https://app.sailscoring.ie` | **unset**    | `http://localhost:3000` | no         |
| `RESEND_API_KEY`               | from Resend          | from Resend          | unset (recommended)  | yes for prod/preview |
| `RESEND_FROM`                  | `Sail Scoring <noreply@sailscoring.ie>` | same | same         | no |
| `CREDENTIAL_KEY`               | random (set, **permanent**) | random (set, **permanent**) | random (set) | yes for prod/preview |
| `USE_SERVER_DATA`              | unset (Phase 1)      | unset (Phase 1)      | unset (Phase 1)      | no         |
| `NEXT_PUBLIC_APP_URL`          | `https://app.sailscoring.ie` | unset / preview URL  | `http://localhost:3000` | no  |
| `NEXT_PUBLIC_BILGE_URL`        | `https://bilge.sailscoring.ie` | (same)     | (same)               | no         |
| `NEXT_PUBLIC_BILGE_API_KEY`    | from bilge project   | from bilge project   | from bilge project   | no         |
| `NEXT_PUBLIC_SCUPPER_URL`      | `https://scupper.sailscoring.ie` | (same)   | (same)               | no         |
| `NEXT_PUBLIC_SCUPPER_API_KEY`  | from scupper project | from scupper project | from scupper project | no         |

### Notes on the trickier ones

**`BETTER_AUTH_SECRET`** — generate with `openssl rand -base64 32`. The
production secret signs production session cookies; rotating it logs every
user out. Use a different secret for Development so a leaked dev value can't
forge a real session. Mark Production and Preview as **sensitive** but leave
Development non-sensitive: Vercel excludes sensitive values from the
Development environment, which would break `vercel env pull`.

**`BETTER_AUTH_URL`** — set on Production (your canonical URL) and Development
(localhost) only. **Leave it unset on Preview.** Preview deployments live at
per-deploy hostnames (`*.vercel.app`); a fixed value would scope the session
cookie to the wrong host and point magic-link emails at production. With it
unset, Better Auth derives the base URL from the request, and `lib/auth.ts`
already appends `process.env.VERCEL_URL` to `trustedOrigins` for previews.

**`RESEND_API_KEY`** — leaving this unset in Development is the recommended
default. The dev sender (`lib/auth/email.ts`) falls back to `console.log` +
`tests/.magic-links.log`, which is exactly what the e2e suite reads.

**`CREDENTIAL_KEY`** — 32-byte symmetric key (64 hex chars) used by
`lib/crypto.ts` to AES-256-GCM-encrypt FTP server passwords at the application
layer before they hit Postgres. Generate with `openssl rand -hex 32`. Without
it, any write to `/api/v1/ftp-servers/...` returns 500 with
`"CREDENTIAL_KEY is not set"` in the function logs.

Treat the key as **permanent for the lifetime of the data**: rotating or
losing it makes every previously-stored FTP password undecryptable. If you
ever need to rotate, you must re-enter every FTP server password after the
swap. Use the **same value** in Production and Preview because they share the
same Neon database — a preview deploy reading a row written by production
needs the same key. Development can use a different value (its own DB).

**`USE_SERVER_DATA`** — server-only flag (do *not* prefix with
`NEXT_PUBLIC_`). Off by default through Phase 5; explicitly setting it to
`true` is what later phases will use to swap the UI from IndexedDB to the
server backend. Leave unset for now.

**`NEXT_PUBLIC_APP_URL`** — used elsewhere in the app for "Open in Sail
Scoring" links in exported HTML. The auth client *does not* use this; it
relies on the current page origin so the same code works in dev, on previews,
and in production.

### CLI commands

```sh
vercel env add BETTER_AUTH_SECRET
# Generate value: openssl rand -base64 32
# Production: paste, mark sensitive
# Preview: paste (a different value if you want isolation), mark sensitive
# Development: paste a third value, leave non-sensitive

vercel env add BETTER_AUTH_URL
# Production: https://app.sailscoring.ie  (not sensitive)
# Preview: SKIP — do not add
# Development: http://localhost:3000

vercel env add RESEND_API_KEY
# Production / Preview: paste from Resend, mark sensitive
# Development: SKIP — leave unset so the dev sender writes to log

vercel env add RESEND_FROM
# All three environments: "Sail Scoring <noreply@sailscoring.ie>"

vercel env add CREDENTIAL_KEY
# Generate value: openssl rand -hex 32
# Production and Preview: paste the SAME value, mark sensitive
#   (they share the Neon DB — different keys would break decrypts across envs)
# Development: paste a different value, leave non-sensitive
# Stash the production value in your password manager; losing it means
# every stored FTP password becomes undecryptable.
```

## 6. Pull env vars locally

```sh
vercel env pull
```

This writes `.env.local` from the **Development** environment values. Inspect
it to confirm `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` are
present.

## 7. Migrate the database

```sh
pnpm db:migrate
```

The script reads `.env.local` automatically (`tsx --env-file-if-exists=.env.local`)
and applies the SQL files in `drizzle/` to the database. CI does the same with
`DATABASE_URL` from job env. Two related scripts:

- `pnpm db:generate` — regenerate `drizzle/*.sql` from changes to
  `lib/db/schema/*.ts`
- `pnpm db:auth:generate` — regenerate `lib/db/schema/auth.ts` from changes
  to `lib/auth.ts` (Better Auth plugin config)

## 8. Deploy

```sh
pnpm run deploy        # preview deployment
pnpm run deploy:prod   # production
```

Pushing to `main` on GitHub also triggers a production deployment automatically.

---

## Local development

### Without a database (existing local-first flows only)

```sh
pnpm dev
```

`/`, `/series/...`, `/settings`, `/help`, `/import` work fully. Anything that
hits `/api/health`, `/api/v1/...`, `/sign-in`, or `/account` will fail
(Postgres not configured) — that's expected.

### With a local Postgres (podman-remote)

Bring up the local container:

```sh
pnpm db:up
```

This is idempotent — safe to run repeatedly — and exits non-zero if a
container named `sailscoring-pg` already exists with a different port
mapping (recreate it as the script's error suggests). It uses
`podman-remote` because the canonical dev environment is a podman-
managed dev container that talks to a rootless podman daemon on the
host. See `scripts/db-up.sh` for the details.

The container listens on `localhost:5432` from the host. From inside
the dev container, reach it at `host.containers.internal:5432`:

```
DATABASE_URL=postgres://sailscoring:sailscoring@host.containers.internal:5432/sailscoring
```

Apply migrations with `pnpm db:migrate`. Stop with
`podman-remote stop sailscoring-pg`; data persists until you
`podman-remote rm` it.

The Vitest suites under `tests/db/`, `tests/postgres-repository.test.ts`,
`tests/auth/`, and `tests/api/` exercise the live database. They skip
when `DATABASE_URL` is unset. `pnpm test:unit` skips them; `pnpm
test:unit:db` brings the container up via the `pretest` hook, sets
`DATABASE_URL` to the local URL, and runs the full suite. See
`docs/local-dev-scripts.md` for the full picture.

### With the full server backend

After step 6 you should have these in `.env.local`:

```
DATABASE_URL=postgres://...                 # from Neon (Development branch)
BETTER_AUTH_SECRET=...                      # 32+ chars random
BETTER_AUTH_URL=http://localhost:3000
CREDENTIAL_KEY=...                          # 64 hex chars (`openssl rand -hex 32`)
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_BILGE_URL=https://bilge.sailscoring.ie
NEXT_PUBLIC_BILGE_API_KEY=...
NEXT_PUBLIC_SCUPPER_URL=https://scupper.sailscoring.ie
NEXT_PUBLIC_SCUPPER_API_KEY=...
# RESEND_API_KEY intentionally unset — dev sender writes to log
RESEND_FROM="Sail Scoring <noreply@sailscoring.ie>"
```

Apply migrations once (`pnpm db:migrate`), then:

```sh
pnpm dev
```

Magic-link emails go to the terminal stdout and `tests/.magic-links.log`,
not to a real inbox.

---

## Verifying a deployment

The same three checks apply to local dev, preview, and production. Replace
`$BASE` with `http://localhost:3000` / `https://<preview>.vercel.app` /
`https://app.sailscoring.ie`.

### 1. Health check

```sh
curl -s $BASE/api/health | jq
```

Expected:

```json
{ "status": "ok" }
```

A 200 with `{"status":"error",...}` body means the route reached Postgres but
the query failed; non-200 means the route handler crashed before reaching the
DB (usually a missing env var). Pipe through `jq` so the prompt doesn't
overwrite the unterminated body line.

### 2. Magic-link sign-in

Open `$BASE/sign-in` in a browser, type any email, click **Send magic link**.
The page flips to "Check your inbox at …".

The link arrives in:

- **Production / Preview (with Resend configured)** — the inbox you typed
- **Development (no Resend)** — the terminal running `pnpm dev` plus
  `tests/.magic-links.log` (one URL per line, tab-separated:
  `<iso timestamp>\t<email>\t<url>`)

Click the link in the same browser the form is in (the verify endpoint sets
the session cookie on that origin). You land on `$BASE/account` showing:

- **Signed in as** the email you typed
- **Workspace** auto-created on first sign-in (`<localpart>'s workspace`)
- **Slug** `u-<first 16 chars of user id>`
- **Role** `owner`

### 3. /account behaviour

While signed in: refreshing `/account` keeps you there. Clicking **Sign out**
clears the session and bounces you to `/`. After that, any request to
`/account` redirects to `/sign-in?callbackURL=/account` via `proxy.ts` —
the page itself also calls `requireSession()` (defence in depth, since
middleware-only auth was the failure mode of CVE-2025-29927).

### Direct DB inspection (if anything looks off)

```sh
pnpm db:studio       # browse user / organization / member rows
```

For a one-off query:

```sh
node --env-file-if-exists=.env.local -e '
  const postgres = require("postgres");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  sql`select id, email from "user" order by created_at desc limit 5`
    .then(console.log).finally(() => sql.end());
'
```

---

## Schema migrations

### How migrations are applied

The Vercel `build` script runs `tsx scripts/db-migrate.ts && next build`.
Each deployment migrates its own database before serving traffic:

- **Production** — applies pending migrations to the Neon `main` branch, then
  the new function code goes live a few seconds later.
- **Preview** — the Vercel↔Neon integration auto-forks a fresh Neon branch
  per preview deployment; the build migrates that fork in isolation.
- **Development (local)** — `pnpm db:migrate` runs the same script. It
  prefers `DATABASE_URL_UNPOOLED` and falls back to `DATABASE_URL`.

Migrations must use the **unpooled** connection. PgBouncer transaction-mode
pooling — what Neon's `-pooler` host gives you — breaks DDL.

Drizzle's `__drizzle_migrations` table makes the runner idempotent, so
re-running on every deploy is safe.

### Expand-contract: migrations must be backwards-compatible

Build-time migrate means the schema is updated a few seconds **before** the
new function code goes live. For that window, old code runs against new
schema. Every migration has to survive that. (Old schema vs. new code is also
possible if a deploy fails mid-flip; same defence applies.)

The rules:

- **Adding a column** — must be nullable or have a default. Old code ignores
  it; safe to land in one deploy.
- **Renaming a column** — never in one step. Add the new column, deploy code
  that writes both, backfill, deploy code that reads from the new column,
  deploy code that stops writing the old, drop the old column. Five deploys
  minimum.
- **Removing a column** — stop writing it (deploy 1), drop it (deploy 2).
- **Tightening a constraint** (`NOT NULL`, FK, `UNIQUE`) — backfill or clean
  offending rows first (deploy 1), add the constraint in a separate
  migration (deploy 2). A single migration that backfills *and* tightens
  will fail on prod the moment the data isn't already clean.
- **Locking DDL** — Drizzle's generated `ALTER`s are lightweight in normal
  cases, but anything that rewrites a table or holds an `ACCESS EXCLUSIVE`
  lock needs to be applied out-of-band against prod with a maintenance plan,
  not via the deploy.

If a change can't be done as one of the above, do it as a sequence of
deploys, not as one clever migration.

---

## Custom domain

To serve the app from `app.sailscoring.ie`:

1. **Settings → Domains → Add** → `app.sailscoring.ie`
2. Add the CNAME record at your registrar:

   | Type  | Name  | Value                  |
   |-------|-------|------------------------|
   | CNAME | `app` | `cname.vercel-dns.com` |

3. Wait for DNS propagation (usually a few minutes).

When the custom domain is live, also set:

```sh
vercel env rm NEXT_PUBLIC_APP_URL    # if a placeholder was set
vercel env add NEXT_PUBLIC_APP_URL   # https://app.sailscoring.ie (Production)
```

`BETTER_AUTH_URL` for Production should already be `https://app.sailscoring.ie`.

---

## Debug logging

### Client (per-browser)

Open browser DevTools console:

```js
localStorage.setItem('sailscoring:debug', '1')   // Sail Scoring core
localStorage.setItem('bilge:debug', '1')         // bilge calls
localStorage.setItem('scupper:debug', '1')       // scupper calls
```

Logs appear under the **Verbose** level (hidden by default — enable in the
console filter). Disable with `removeItem`. Per-browser; no redeploy needed.

### Server

Function logs are visible in the Vercel dashboard under **Logs** for each
deployment, or via `vercel logs <deployment-url>`.

---

## Data persistence

Pre-Phase 6, all scoring data (series, competitors, races, finishes) is stored
in IndexedDB in the scorer's browser:

- Data is **not synced** across devices or browsers
- Clearing browser data will erase all scoring data
- For important events, the scorer should work from a single browser on a
  single device throughout the event

The server backend stores only authentication data (users, sessions,
organizations, members) until Phase 3, when the UI starts reading and writing
series via the API.
