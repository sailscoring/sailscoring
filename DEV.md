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
(In a secondary git worktree the container name and ports differ — see
[Working on a branch in a git worktree](#working-on-a-branch-in-a-git-worktree);
everything below applies per checkout.)

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

## Working on a branch in a git worktree

A [git worktree](https://git-scm.com/docs/git-worktree) is a second
working directory sharing the main checkout's `.git` store — useful for
keeping a long-running branch buildable and testable alongside `main`
without stash/checkout churn. A branch can only be checked out in one
worktree at a time: `main` stays in the primary checkout, the branch
lives in its own directory.

### Create and set up

```bash
# From the primary checkout
git worktree add ../sailscoring-flights feature/flights

cd ../sailscoring-flights
pnpm install                     # node_modules is per-directory
cp ../sailscoring/.env.local .   # untracked files don't come along
```

Then give the worktree its own app port and Postgres container, so the
two checkouts can run dev servers and test suites concurrently without
clobbering each other's data — an untracked `.env.worktree` at its root:

```bash
# .env.worktree
SS_APP_PORT=3001
SS_PG_PORT=5433
```

`scripts/local-env.sh` reads it and everything follows: `pnpm db:up`
creates a separate container (`sailscoring-pg-5433`, own data volume),
the `*:test` scripts and the e2e suite target it, and `pnpm dev` / the
Playwright web server listen on 3001. Pick any free ports; the file is
the mechanism, the numbers are yours. See "Working in a second git
worktree" in `docs/local-dev-scripts.md` for how the resolution works.

Note the branch itself must contain `scripts/local-env.sh` — a branch
cut before it existed ignores `.env.worktree` until rebased onto
current `main`.

### Day-to-day

Work normally: edit, `pnpm dev`, commit, push. Refs are shared, so
commits made in the worktree are immediately visible from the primary
checkout and vice versa. To pick up `main`:

```bash
git rebase main        # or merge, as the branch warrants
```

After a rebase, pushing needs `--force-with-lease` (history was
rewritten; the lease refuses if origin has commits you haven't seen):

```bash
git push --force-with-lease origin feature/flights
```

The pre-push rule applies unchanged: `pnpm lint`, `pnpm test:unit`, and
`pnpm test:e2e:triage` — all against the worktree's own container
(`pnpm db:up` first).

### Clean up

```bash
# From the primary checkout, once the branch is merged or abandoned
git worktree remove ../sailscoring-flights
podman-remote rm -f sailscoring-pg-5433   # its Postgres container + data
```

`git worktree remove` deletes the directory and releases the branch
(refusing if there are uncommitted changes); the branch itself
survives. If the directory was deleted by hand instead, `git worktree
prune` clears the stale registration. `git worktree list` shows what's
active.

## Preview deployment

_To be written._
