# The `sailscoring` CLI

A command-line client for the Sail Scoring API (`/api/v1`). It bulk-imports
`.sailscoring` files, publishes standings, and reads the key entities — useful
for onboarding historical events (the IODAI use case) and for scripting against
a deployment. It is a **pure API client**: it talks to a deployment over HTTPS
with a Bearer token and never touches the database, so it needs no
`DATABASE_URL`.

Design and rationale: [ADR-009](design/decisions/009-api-and-cli.md).

## Running it

Two ways to invoke the same code:

- **In-repo:** `pnpm cli <command>` (runs `tsx cli/index.ts`). Nothing to
  install.
- **As a real command:** `pnpm link --global` once, then `sailscoring <command>`
  from anywhere.

```sh
pnpm link --global      # registers `sailscoring` on your PATH
sailscoring --help
```

> The linked `sailscoring` runs the TypeScript through tsx at runtime, so it
> relies on this repo's `node_modules`. A standalone, dependency-free
> executable (and `npx sailscoring`) is the M7 packaging step, deferred to
> `docs/design/horizon.md`; `pnpm link --global` from a checkout is the way
> to get the bare command.

The examples below use `sailscoring`; substitute `pnpm cli` if you haven't
linked.

## Signing in

```sh
sailscoring auth login
```

This prints a page and a code. Open the page in a browser where you're signed
in to Sail Scoring, check the code matches, and approve it (ADR-016's device
sign-in). The CLI then acts as you, in every workspace you belong to, and
renews its access as it goes. The sign-in is saved to
`~/.config/sailscoring/config.json` (mode 0600); disconnect it from your
account page's Connected apps card. Point at a non-default deployment with
`--base-url`, or set `SAILSCORING_BASE_URL`.

### API keys, for automation

Automation with nobody to approve a code (the archive repos' CI) uses an API
key instead, minted by whoever has database access:

```sh
pnpm provision-token create you@example.com --name "cli" --workspace <slug> --admin
```

`--workspace` pins a default workspace into the key; `--admin` raises its rate
limit for bulk imports (or `--rate-limit-max <n> --rate-limit-window-seconds
<n>`, or `--no-rate-limit`). Save it with `sailscoring auth login --token
<key>` (or `--paste` to paste it at a prompt), or set `SAILSCORING_TOKEN` in the
environment, which overrides the saved sign-in.

## Command grammar

Commands follow `sailscoring <noun> <verb>`. The read verbs are always `list`
and `get`. Global flags: `--workspace <slug-or-id>`, `--base-url <url>`. Reads
accept `--json` (or `--output json`) to emit the raw API shape for `jq`;
otherwise they print an aligned table.

### Series

```sh
sailscoring series list
sailscoring series get <seriesId>
sailscoring series import <files…>          # also: sailscoring import …
sailscoring series import <files…> --replace   # upsert at each file's own id
sailscoring series publish <seriesIds…>     # also: sailscoring publish …
sailscoring series categorise <seriesIds…> --category <name>
sailscoring series archive <seriesIds…> [--unarchive]
sailscoring series reorder <seriesIds…>
```

`reorder` rewrites the workspace's series display order to match the id
sequence (ids omitted keep their order, so pass the full set for a clean total
order). This drives both the in-app series-list order and the order of
contributing series on a shared-slug published page (`/p/{ws}/{slug}`).

`import` and `publish` are also available as top-level aliases, since bulk
import is the workflow the CLI grew out of.

### Reads

```sh
sailscoring whoami                              # identity, active workspace, role, features
sailscoring competitor list --series <id>
sailscoring race list --series <id>
sailscoring fleet list --series <id>
sailscoring sub-series list --series <id>
sailscoring category list
sailscoring published list                      # workspace publications + URLs
sailscoring published get <seriesId>            # one series' publication status
sailscoring activity list [--series <id>]
sailscoring standings get <seriesId> [--fleet <name>]
```

### Rankings

Workspace cross-series rankings (#209); the workspace needs the `rankings`
feature. `set` replaces the whole config (buckets, nationality/fleet filters,
place recomputation, adjustments) from a JSON file — the scripting surface the
archive pipelines use to replicate historical season rankings.

```sh
sailscoring ranking list
sailscoring ranking create <name>
sailscoring ranking get <id>
sailscoring ranking set <id> [--config <file.json>] [--name <n>] [--slug <s>] [--publish|--unpublish]
sailscoring ranking standings <id>              # the computed ladder (--json for the full shape)
```

## Bulk import

```sh
sailscoring import *.sailscoring --workspace <slug>
```

- Resumable: a failed file is reported but doesn't stop the batch; a re-run
  replays already-imported files rather than duplicating them (the
  `Idempotency-Key` is a hash of each file's contents).
- `--replace` upserts each file at the series id the **file** carries
  (`PUT /api/v1/series/:id/file`) instead of minting a new series per import.
  For a generator that owns its identity — an archive repo whose ids are
  derived from stable keys, re-emitting a season as it progresses — where a
  second run over changed content means *this series again, updated*, not a
  second copy of it. Without it, changed content is a new series: the
  idempotency key only deduplicates a byte-identical replay.

  The series keeps its id, `createdAt`, category and archived flag; the racing
  is replaced. The name is taken verbatim rather than disambiguated, so
  re-running doesn't rename the series. An id already live in another
  workspace is a 403, and an as-published series is never overwritten by a
  full-fidelity file.
- `--concurrency <n>` bounds parallelism (default 4).
- `--json` emits the per-file results (with the new series ids) and skips the
  human log and post-phases — use it to capture ids and drive your own
  follow-up.

## Import → publish → categorise → archive (the IODAI workflow)

Several series' fleets can publish into one shared folder of the publication
tree (`/p/{workspace}/{slug}`, ADR-011), and the whole lifecycle is a single
command:

```sh
sailscoring import *.sailscoring \
  --workspace iodai \
  --publish-slug 2026-iodai \
  --category "2026 IODAI Nationals" \
  --archive
```

The phases run in order **import → publish → categorise → archive** (categorise
must precede archive, because moving an archived series is blocked). Equivalent
decoupled commands:

```sh
ids=$(sailscoring import *.sailscoring --workspace iodai --json | jq -r '.[].id')
sailscoring publish --slug 2026-iodai $ids       # co-publish under one slug
sailscoring categorise $ids --category "2026 IODAI Nationals"
sailscoring archive $ids
```

Publish flags: `--slug <slug>` co-publishes the given series into one shared
folder (without it, each series gets its own derived slug);
`--subpath fleet=path,…` resolves fleet-URL collisions; `--fleets a,b` limits
which fleets publish.

## Configuration and environment

| Source | Key | Notes |
|--------|-----|-------|
| `~/.config/sailscoring/config.json` | `baseUrl`, `token` | written by `auth login` |
| env | `SAILSCORING_BASE_URL` | overrides the saved base URL |
| env | `SAILSCORING_TOKEN` | overrides the saved token (CI) |
| flag | `--base-url`, `--workspace` | per-command overrides |
