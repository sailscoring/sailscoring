# Contributing to Sail Scoring

Thanks for your interest in Sail Scoring. The project is in beta, developed by a
single maintainer who commits directly to `main`; external contributions come in
as pull requests.

## Before you write code

- **Bugs:** open an issue describing what you did, what you expected, and what
  happened. A series file or a minimal reproduction helps enormously.
- **Features:** open an issue first so the approach can be agreed before you
  invest in an implementation. Scoring behaviour in particular is constrained by
  the Racing Rules of Sailing (RRS Appendix A) and by real events' sailing
  instructions — changes there need a rules citation, not just a preference.

## Development setup

```bash
pnpm install
pnpm db:up        # local Postgres in a container
pnpm dev:local    # next dev against the local Postgres
```

See `DEV.md` and `docs/local-dev-scripts.md` for the full picture, including the
named pnpm scripts for every dev/test/DB task — use those rather than ad-hoc
`DATABASE_URL=…` invocations.

## What a change needs before it merges

- `pnpm lint`, `pnpm test:unit` (plus `pnpm test:unit:db` for DB-backed tests),
  and the Playwright suite (`pnpm test:e2e`) all green.
- Changes to scoring logic (`lib/scoring.ts`) need declarative YAML fixtures in
  `tests/fixtures/scoring/` — they are written to be verified by human scorers,
  not just the test runner. Run `pnpm generate:fixtures` and commit the
  regenerated `.html` files alongside. See `tests/fixtures/scoring/README.md`.
- User-facing features should work through the Feature Checklist in `CLAUDE.md`
  (keyboard shortcuts, help page, serialization, import/export surfaces) — it
  exists because each of those is easy to forget and painful to miss.

## AI-assisted contributions

AI tools are welcome — much of Sail Scoring is itself developed with AI
assistance — but accountability always stays with the human. Like the DCO
sign-off below, this comes down to one thing: you are responsible for what you
submit, however it was written.

- **Stay involved.** No "pure agent" pull requests. You must have reviewed
  every changed line, understood it well enough to defend it, validated the
  behaviour end-to-end, and run the relevant tests yourself.
- **The same bar applies.** AI-assisted changes meet the same quality,
  testing, and review standards as anything else — for scoring logic that
  still means a rules citation and human-verifiable fixtures. The Racing Rules
  of Sailing don't care how the code was written.
- **Disclose it.** Say in the PR description that AI assistance was used, and
  add a commit trailer such as `Co-authored-by: Claude <noreply@anthropic.com>`
  — you'll see the same trailer throughout this repo's history. Disclosure
  isn't a mark against a contribution; it helps the reviewer read it in
  context.
- **No busywork.** Don't open one-off PRs for a single typo or an isolated
  style tweak. Bundle mechanical cleanups into a clearly scoped change, or
  attach them to substantive work.

If an AI agent is doing the work, these rules apply to the person running it —
and a PR that can't meet them shouldn't be opened.

## Developer Certificate of Origin

Contributions must be signed off:

```bash
git commit -s
```

The sign-off certifies the [Developer Certificate of
Origin](https://developercertificate.org/) — that you wrote the change or
otherwise have the right to submit it under the project's license.

## License

Sail Scoring is released under the MIT license (see `LICENSE`); by contributing,
you agree your contributions are licensed the same way. The "Sail Scoring" name
and logo are trademarks of Mark McLoughlin and are not covered by the code
license.
