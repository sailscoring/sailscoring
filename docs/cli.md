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
> executable (and `npx sailscoring`) is the M7 packaging step; until then,
> `pnpm link --global` from a checkout is the way to get the bare command.

The examples below use `sailscoring`; substitute `pnpm cli` if you haven't
linked.

## Getting a token

The CLI authenticates with a Bearer API key. Until the in-app "API keys" UI
lands (M5), mint one with the admin script (run by whoever has database
access):

```sh
pnpm provision-token create you@example.com --name "laptop" --workspace <slug>
# prints the key once — copy it immediately, it is stored hashed and
# cannot be shown again
```

`--workspace` pins a default workspace into the key; the CLI can still target a
different one per command with `--workspace`. See also `pnpm provision-token
list <email>` and `pnpm provision-token revoke <key-id>`.

Then save it locally:

```sh
sailscoring auth login --token <paste-the-key>
# or omit --token to paste it at a prompt
```

This verifies the token against the deployment and writes it to
`~/.config/sailscoring/config.json` (mode 0600). Point at a non-default
deployment with `--base-url https://app.sailscoring.ie` (the default), or set
`SAILSCORING_BASE_URL` / `SAILSCORING_TOKEN` in the environment (handy for CI —
they override the saved config).

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
sailscoring series publish <seriesIds…>     # also: sailscoring publish …
sailscoring series categorise <seriesIds…> --category <name>
sailscoring series archive <seriesIds…> [--unarchive]
```

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

## Bulk import

```sh
sailscoring import *.sailscoring --workspace <slug>
```

- Resumable: a failed file is reported but doesn't stop the batch; a re-run
  replays already-imported files rather than duplicating them (the
  `Idempotency-Key` is a hash of each file's contents).
- `--concurrency <n>` bounds parallelism (default 4).
- `--json` emits the per-file results (with the new series ids) and skips the
  human log and post-phases — use it to capture ids and drive your own
  follow-up.

## Import → publish → categorise → archive (the IODAI workflow)

Several series' fleets can publish under one shared slug (`/p/{workspace}/{slug}`),
and the whole lifecycle is a single command:

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
namespace (without it, each series gets its own derived slug);
`--subpath fleet=path,…` resolves fleet-URL collisions; `--fleets a,b` limits
which fleets publish.

## Configuration and environment

| Source | Key | Notes |
|--------|-----|-------|
| `~/.config/sailscoring/config.json` | `baseUrl`, `token` | written by `auth login` |
| env | `SAILSCORING_BASE_URL` | overrides the saved base URL |
| env | `SAILSCORING_TOKEN` | overrides the saved token (CI) |
| flag | `--base-url`, `--workspace` | per-command overrides |
