# As-published archives — operations and migration

The decisions live in [ADR-010](decisions/010-as-published-archives.md);
implementation is tracked in #283. This doc is the operational side: how a
class archive is wired up, and the plan for migrating the production IODAI
and DBSC corpora — **the migration is not yet executed**.

## How an archive repo works

Each class/club has an archive git repo (`iodai-archive`, `dbsc-archive`,
`hyc-archive`, …) holding:

- **Captures** under `sources/` — the original published results (Sailwave
  HTML, Sail100 HTML, HalSail pages, PII-scrubbed `.blw`). `.blw` files are
  scrubbed *before* commit with `pnpm blw-scrub <file>` (drops DOB / email /
  phone / address rows; age stays).
- **`as-published.config.json`** — the whole per-class mapping: which files
  compose which series, under which pinned ids, published slugs, and fleet
  sub-paths. Emitted by a repo-local script from whatever the repo already
  knows (IODAI: the `events/` definitions + `manifest.json`; DBSC: the
  per-year `catalog.json`).
- **`manifest.json`** (where the class has an identity spine) — the #218
  identity manifest; the ingest applies it and runs the scoped auto-pass.
- **`.github/workflows/as-published.yml`** — on push: check out the app repo,
  `pnpm archive-generate <config>`, then
  `pnpm cli as-published push <out> --workspace <slug>` with the workspace's
  archivist key. Everything is idempotent: unchanged documents no-op by
  content hash, ids are UUIDv5 of stable inputs, identity ids are
  manifest-pinned.

The toolkit (parsers, doc builders, generator, scrub) lives in the app repo
under `lib/archive-kit/` + `scripts/archive-generate.ts`, structured for a
future spin-out to `sailscoring/archive-kit`.

## Credentials

Per archive repo, two secrets:

- `APP_REPO_TOKEN` — read access to `sailscoring/sailscoring` (the CI checks
  the app repo out for the toolkit).
- `SAILSCORING_ARCHIVIST_TOKEN` — an API key whose user holds the
  **`archivist`** role in the target workspace only: `read` +
  `archive-ingest`, nothing else. A leaked key can rewrite that workspace's
  as-published series (already public) and nothing more.

Provisioning: pre-create a service user (`provision-org pre-create-user`),
add it to the workspace with the `archivist` role, then mint the key with
`provision-token create … --workspace <slug>` (the raised rate limits apply
to all keys since #the-bulk-import-lesson). One key per repo, revocable
independently.

## Production migration plan (NOT yet executed)

Preconditions: this work deployed to production; migrations applied
(`as_published` columns, `as_published_results`, `managed_by`,
`archive-ingest` permission).

### IODAI (~170 series, URL stability is hard requirement)

The generated documents reuse the workspace's **existing series ids** (the
manifest's slug→UUID map — the same adopted ids in prod), so the ingest
*converts the live series in place* rather than creating a parallel set.

1. **Snapshot the public URL set** (before):
   `pnpm cli published list --workspace iodai --json > before.json` and dump
   each publication's pages (`published get`). Competitor slugs:
   `pnpm cli identity list --workspace iodai --json` (needs the workspace's
   `competitor-reconcile` feature, planned on for IODAI anyway), or scrape
   `/p/iodai/competitors` without credentials.
2. **Verify the config's slugs against prod**: every generated document's
   `publishedSlug` + fleet `subPath`s must match the live publication for
   that series id. The config derives them from the archive slugs (event
   slug + kebab(fleet)); fix any mismatch **in the config** before ingest —
   pinned slugs are data.
3. **Dry-run locally**: ingest the full corpus into a local workspace;
   eyeball a sample of pages against the captures; run the career-arc spot
   checks.
4. **Convert**:
   `pnpm cli as-published push ../iodai-archive/as-published --workspace iodai --convert`.
   Per series: races/finishes dropped, stored results in, re-published into
   the same slug; the identity manifest re-applies (identity ids and slugs
   are manifest-pinned, so competitor-timeline URLs are byte-stable) and the
   scoped auto-pass drafts the uncovered tail.
5. **Verify zero URL breakage**: re-dump the URL set and diff against the
   snapshot — the set must be identical. Spot-check timelines, the
   competitor index, and a handful of fleet pages.
6. **Arm CI**: set the two secrets on `iodai-archive`.

2026 IODAI events are untouched throughout: they're full-fidelity,
in-app-scored, and excluded from the config.

### DBSC (2022–2025; new page scheme replaces the reconstruction)

The as-published shape (one series per class × year, ~222 series, per-race
handicap detail preserved) deliberately replaces the 29 reconstructed
sub-series-composed series. Their URLs were never announced, so this is a
re-organisation, not a breakage:

1. Ingest the new corpus:
   `pnpm cli as-published push ../dbsc-archive/as-published --workspace dbsc`
   (new deterministic ids — no `--convert` needed).
2. Organise: categorise the new series per year (`cli series categorise`).
   They land archived automatically — a new as-published series always does.
3. Retire the reconstruction: unpublish, archive, and delete the 29
   old series (`cli series unpublish/archive`, then delete). Keep them until
   the new pages are eyeballed.
4. Arm CI on `dbsc-archive`.

DBSC 2026 stays on the live parity/compare loop — proving the engine is the
point there.

### Rollback

`pnpm cli as-published delete <seriesId…>` removes ingested series and their
publications; both archive repos retain their previous reconstruction
pipelines and outputs, so the pre-migration state can be re-imported from
the `.sailscoring` files if it ever comes to that. For IODAI the convert is
the riskier step (it rewrites live series in place) — hence the local
dry-run and the URL-set diff before and after.
