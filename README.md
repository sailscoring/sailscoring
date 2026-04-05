# Sail Scoring

A local-first web application for managing sail racing series, race days, and results.

Handles scratch (position-based) scoring, result codes, discard rules, and series standings per World Sailing Racing Rules of Sailing (RRS) Appendix A.

**Live:** [app.sailscoring.ie](https://app.sailscoring.ie)

## Features

- **Scoring** — scratch scoring across multiple fleets and races; equal finish positions; A5.3 alternative scoring
- **Result codes** — full RRS A5/A6/A8/A11 code set including additive penalties (ZFP, SCP, DPI)
- **Discards** — configurable discard rules per series
- **Start check-in** — mark competitors as checked in before a race
- **Standings** — live series standings with tiebreak resolution
- **Competitors** — manual entry or CSV import
- **Series settings** — venue, dates, burgee
- **Export** — HTML and JSON results export; publishing via FTP or [bilge](https://github.com/sailscoring/bilge)

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS v4, shadcn/ui
- **Storage:** IndexedDB via Dexie.js (local-first, no backend required)
- **Deploy:** Vercel

## Development

```bash
pnpm install
pnpm dev
```

Run tests:

```bash
pnpm test:unit   # Vitest unit/integration tests
pnpm test:e2e    # Playwright end-to-end tests
```

Deploy:

```bash
pnpm deploy        # preview
pnpm deploy:prod   # production
```

See `DEPLOY.md` for custom domain setup, and `docs/` for design docs, ADRs, and requirements.

## License

All rights reserved. Copyright Mark McLoughlin. See `LICENSE`.
