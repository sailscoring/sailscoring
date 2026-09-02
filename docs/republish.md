# Re-publishing existing publications

A published results page is an immutable stored blob. Nothing re-renders
it when the renderer changes, so a page published before a rendering
change keeps serving its old HTML until its series is next republished,
and a finished series may never be. `pnpm republish` republishes on the
scorer's behalf so the hosted `/p/` pages converge without waiting for
them.

The first use is shedding the embedded series payload: pages published
before the data file existed (ADR-012) still carry the whole series as
base64 in their "Open in Sail Scoring" link, which fails for a signed-out
reader and triples the page weight. Downloaded pages and FTP copies on
club sites are outside our control and keep the payload; `/import` reads
the fragment for them indefinitely.

```bash
pnpm republish                          # report only: what would be rebuilt, and why the rest is skipped
pnpm republish --workspace hyc          # one workspace (slug or id)
pnpm republish --series <uuid>          # one series
pnpm republish --apply --limit 3        # rebuild the first three candidates
pnpm republish --apply                  # rebuild everything eligible
```

Without `--apply` nothing is written. Read the report, trial a few with
`--limit`, check a rebuilt page, then run the rest.

## What it will and will not touch

A publication is rebuilt only when its series is unchanged since it was
last published: `series.version` still equals the publication's
`published_version`. The publish dialog's "N edits since" is the same
comparison. Everything else is skipped and the reason printed:

- **Pending edits.** Republishing renders from the live series, so a
  bulk pass would push a scorer's unpublished edits onto public pages.
  These heal when the scorer next publishes deliberately.
- **Orphans** (the series was deleted) and **as-published archives**.
  There is nothing live to render either from.
- **Blobs in the other storage backend.** The rebuild writes to Vercel
  Blob when `BLOB_READ_WRITE_TOKEN` is set and to the `published_blobs`
  table otherwise; a publication whose blobs live elsewhere is skipped
  rather than silently moved.
- **A changed page set.** The rebuild re-renders exactly the live pages.
  If the current build would add a page (a feature enabled since, such
  as the entry list) or no longer produces one, the publication is
  skipped rather than have its public page set change unasked.

A rebuild keeps the publication's published-at time and stamps the pages
"provisional as of" the publish it re-renders, pins no revision, and
keeps every page's URL. Superseded blobs are deleted as on any
re-publish. A page that already renders identically is reported as
unchanged and nothing is written.

## Running it against production

The script reads `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` and
`NEXT_PUBLIC_APP_URL`, and refuses to apply without the app URL: the
renderer only replaces the embedded payload with a link to the data
file when it knows the origin the pages are served from. `.env.local`
holds the Development environment (see `DEPLOY.md`), whose database is
the dev branch and which has no Blob token, so a production run goes
through the `:prod` variant, which fetches all three from Bitwarden for
the duration of the run (see [account-admin.md](account-admin.md#production-usage)):

```bash
pnpm republish:prod
```

The report costs nothing. Then `--apply --limit 3`, open one of the
rebuilt pages (each `rebuilt` line is followed by its pages' URLs) and
confirm its footer link reads `/open?from=…`, and finish with `--apply`.

Every line names the series and lists its pages by their path under
the slug: a slug is shared, so several series can publish into
`m15/2026`, and the first column alone does not say which one a line
is about. `rebuilt` means every page of that publication was rewritten
— blobs are addressed by the publication's hash, so a page is not
skipped for rendering identically on its own.

Two production notes:

- The pass runs from a laptop, so it cannot purge the CDN cache the way
  an in-app publish does. `/p/` pages are cached at the edge for 60
  seconds, so a rebuilt page is live within a minute either way.
- Each rebuilt page is one Blob upload and one delete, concurrent per
  publication. The pass runs publications one at a time, so it stays
  well inside the Pro plan's per-second budget.

Locally, `pnpm republish:test` runs the same pass against the local
container with `.env.test`'s app URL.
