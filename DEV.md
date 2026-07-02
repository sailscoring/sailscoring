# DEV.md

How to validate a change before it reaches production: first **locally**
against a fresh database, then in a **preview** deployment. The rule of
thumb for any large feature is to run it through both before
`pnpm deploy:prod`.

See `docs/local-dev-scripts.md` for the full script reference.

## Local: fresh DB + run the app

The local Postgres container (`sailscoring-pg`) **persists its data**
between runs — `pnpm db:up` is idempotent and just starts the existing
one. So "fresh DB" means destroying and recreating the container.

```bash
# 1. Nuke the existing container (wipes all local data — it's just test data)
podman-remote rm -f sailscoring-pg

# 2. Recreate it empty and apply every migration
pnpm db:up            # fresh postgres:17 container on localhost:5432
pnpm db:migrate:test  # applies all Drizzle migrations

# 3. Run the app against it
pnpm dev:local        # next dev, DATABASE_URL pointed at localhost:5432
```

`pnpm dev:local` runs `db:up` for you via its `predev:local` hook, so
day-to-day you can skip straight to it and **keep your data**. Only do
the `rm -f` dance when you want to exercise first-run / empty-state
behaviour or a migration from a clean slate — which is exactly what you
want when validating a large new feature.

### After a fresh wipe

- **No user or workspace exists.** Sign up through the app's normal
  flow, or seed one with `pnpm provision-org:test` (creates an org, adds
  members) if the feature needs an existing workspace.
- **To create a workspace with gated features on (e.g. `sub-series`,
  `combined-pages`) and yourself as owner**, do it in one command — the
  owner must already exist (sign in once first):

  ```bash
  pnpm provision-org:test create-org test \
    --enable-feature sub-series,combined-pages \
    --owner you@example.com
  ```

  Feature keys come from `lib/features.ts`; see
  `docs/workspace-provisioning.md` for `enable-feature` /
  `disable-feature` on an existing workspace.
- **Inspect state** with `pnpm db:psql:test -c "..."` for one-shot SQL,
  or `pnpm db:studio` for a GUI (note: `db:studio` reads `.env.local`'s
  `DATABASE_URL`).
- **Connection string**, if anything asks:
  `postgres://sailscoring:sailscoring@localhost:5432/sailscoring`

## Preview deployment

_To be written._
