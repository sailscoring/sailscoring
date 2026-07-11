# Sail Scoring

A web application for managing sail racing series, race days, and results.

Handles scratch (position-based) scoring, result codes, discard rules, and series standings per World Sailing Racing Rules of Sailing (RRS) Appendix A.

**Live:** [app.sailscoring.ie](https://app.sailscoring.ie) — sign in with a magic link to your email.

## Features

- **Scoring** — scratch and handicap (IRC, PY, NHC, ECHO) scoring across multiple fleets and races; equal finish positions; A5.3 alternative scoring
- **Result codes** — full RRS A5/A6/A8/A11 code set including additive penalties (ZFP, SCP, DPI)
- **Discards** — configurable discard rules per series
- **Start check-in** — mark competitors as checked in before a race
- **Standings** — live series standings with tiebreak resolution
- **Competitors** — manual entry or CSV import
- **Series settings** — venue, dates, burgee
- **Workspaces** — solo scorers work in a personal workspace; club scoring panels share an org workspace with member-by-member access control and actor attribution on every edit
- **Per-row autosave on finish entry** — concurrent edits between scorers surface clean conflicts rather than silently overwriting
- **Publishing** — in-app publishing to public results pages under `/p/{workspace}/{series}`; HTML and JSON export; optional FTP upload to a club's own site
- **Activity log** — per-series activity trail with actor attribution
- **Revision history** — automatic series snapshots with named checkpoints and restore

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS v4, shadcn/ui
- **Database:** Postgres (Neon via the Vercel Marketplace in production), Drizzle ORM
- **Auth:** Better Auth (magic-link email via Resend) + organizations plugin
- **Deploy:** Vercel (Fluid Compute)

## Development

```bash
pnpm install
pnpm db:up        # local Postgres in a container; see docs/local-dev-scripts.md
pnpm dev:local    # `next dev` against the local Postgres
```

Run tests:

```bash
pnpm test:unit         # Vitest unit tests (no DB)
pnpm test:unit:db      # adds the Postgres-backed tests
pnpm test:e2e          # Playwright end-to-end suite
```

Deploy:

```bash
pnpm deploy        # preview
pnpm deploy:prod   # production
```

See `DEPLOY.md` for custom domain setup, `docs/workspace-provisioning.md` for setting up a shared org workspace via the `pnpm provision-org` CLI, `docs/cli.md` for the `sailscoring` CLI (bulk import, publish, and read access to the API), and `docs/` for design docs, ADRs, and requirements.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
development setup, testing expectations, and the DCO sign-off. Project spaces
are covered by the [code of conduct](CODE_OF_CONDUCT.md). To report a
security vulnerability, see [`SECURITY.md`](SECURITY.md).

## License

MIT — see `LICENSE`. Copyright Mark McLoughlin.

The "Sail Scoring" name and logo are trademarks of Mark McLoughlin and are not
covered by the code license. Anyone may fork and run the software; operating a
service under the Sail Scoring name requires permission.
