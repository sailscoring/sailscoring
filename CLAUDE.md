# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sail Scoring is a sail racing scoring application for managing regattas, series, and race days. It handles handicap corrections, result codes, discard rules, and series standings per World Sailing Racing Rules of Sailing (RRS) Appendix A. Deployed at `app.sailscoring.ie` on Vercel. See `docs/goals.md` for the project's purpose and `docs/` for design docs, ADRs, and requirements.

**Current focus.** The ADR-008 full-stack transition is complete through Phase 9: in-app publishing (workspace-namespaced `/p/{workspace}/{series}` URLs, ADR-008 Phase 9, **#152**) replaced bilge, which has been decommissioned to a redirect-only stub (repo archived); the publishing follow-ups (#162 static read path + public listings, #163 Preview, #164 workspace publish management / Unpublish) are done. **Phase 10 collaboration UX (#153)** has landed: the activity log (per-series Activity tab, series-list recency strips, per-record stamps), the invitation / member-management UI (Members card on Workspace settings + `/accept-invitation`), and self-service org-creation requests (request from `/account`, owner fulfils via `provision-org`). Remaining residue (field-level activity diffs, vanity URLs) is deferred to `docs/design/horizon.md`. Deferred handicap-system work (RYA NHC 2015, ECHO certificate layer, etc.) lives in `docs/design/horizon.md`.

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS v4, shadcn/ui components (`components/ui/`)
- **Storage:** Postgres (Neon in production), Drizzle ORM (`lib/db/schema/`, `lib/postgres-repository.ts`)
- **Package manager:** pnpm; Node 24.x
- **Unit/integration tests:** Vitest (`tests/` — `pnpm test:unit` runs no-DB tests; `pnpm test:unit:db` adds the Postgres-backed ones)
- **E2E tests:** Playwright (`e2e/` — `pnpm test:e2e` runs the full suite against the local Postgres). See `docs/local-dev-scripts.md` for the full picture.
- **Deploy:** Vercel (`pnpm deploy` / `pnpm deploy:prod`); see `DEPLOY.md` for custom domain setup

## Source Layout

Pure logic lives in `lib/`; pages and UI in `app/`. Key lib modules: `scoring.ts` (engine), `scoring-codes.ts` (RRS code registry), `series-file.ts` (serialization), `results-renderer.ts` (HTML export), `public-export.ts` (JSON export/import), `publishing.ts` + `blob-storage.ts` + `published-repository.ts` (in-app publishing to `/p/{workspace}/{series}/{fleet}`, ADR-008 Phase 9 — #152), `activity-log.ts` + `activity-actions.ts` (the workspace activity log, ADR-008 Phase 10 — #153), `scupper.ts` (FTP upload relay). Series pages live under `app/series/[id]/` with tabs: Competitors, Races, Standings, Settings, Activity.

See `docs/` for design docs, ADRs, requirements, and glossary. `reference/` holds external source material that isn't part of the codebase: PDFs of the RRS, NORs / Sailing Instructions for target events, manuals for comparable tools (Sailwave, HalSail, ORC), plus `reference/data/` with anonymised real-world event data and per-handicap-system worked examples used during reverse-engineering. New design notes go in `docs/design/`, not `reference/`.

The full-stack transition (ADR-008) is complete through Phase 8. Better Auth + Postgres + the full server-side data layer is the only runtime; the IndexedDB / Dexie path and its `USE_SERVER_DATA` gate are gone. HYC's panel is onboarded on a shared workspace; beta users were prompted to migrate. Phase 9 is complete: in-app publishing (workspace-namespaced `/p/...`, #152) replaced bilge, now decommissioned to a redirect-only stub (bilge repo archived); the publishing follow-ups (#162–#164) are done. Phase 10 (#153) has landed: the activity log, the invitation / member-management UI, and self-service org-creation requests. Field-level activity diffs and vanity URLs remain as deferred residue. The original Phase 8 (org-based collaboration) was split into Phases 7 and 10 and reordered so HYC's panel got server-of-record + collaboration in the same flag flip rather than living through a `.sailscoring` file-exchange gap after cutover.

- **Schema** — Drizzle in `lib/db/schema/` (mirrors `lib/types.ts`), lazy client in `lib/db/client.ts`, migrations in `drizzle/`
- **Validation** — Zod schemas in `lib/validation/`, used at every `/api/v1` boundary
- **Repositories** — server-side in `lib/postgres-repository.ts` (workspace-scoped, `server-only`); client-side mirror in `lib/api-repository.ts`
- **Auth** — Better Auth in `lib/auth.ts`; `lib/auth/require-workspace.ts` is the single seam every server caller goes through
- **REST surface** — `/api/v1/...` routes; route files are thin glue, logic lives in `lib/api-handlers/`. `Idempotency-Key` replays are handled by the `workspaceRoute` wrapper in `app/api/v1/_lib/handler.ts`
- **DB tests** — Vitest tests under `tests/db/`, `tests/postgres-repository.test.ts`, `tests/auth/`, `tests/api/` skip when `DATABASE_URL` is unset; CI provides it. Locally use `pnpm test:unit:db` (or `pnpm db:up` first and then `pnpm test:unit`); see `docs/local-dev-scripts.md`.

## Repository and Licensing

- **GitHub:** `github.com/sailscoring/sailscoring` (private; org is `sailscoring`)
- **Git:** Direct commits to `main` are fine; no PR requirement; SSH remote
- **License:** All rights reserved, copyright Mark McLoughlin — deliberately deferred pending open-source vs. commercial decision. See `LICENSE` and `docs/goals.md`. This constraint should inform dependency choices: avoid copyleft (GPL) libraries that would limit future licensing options; prefer MIT, Apache 2.0, or BSD.
- **Brand assets:** the logo, mark, favicons, and brand book live in a **separate git-lfs repo** — `github.com/sailscoring/branding` (private), checked out locally at `../branding`. Produced in the June 2026 refresh (Fiverr designer Ahtisham Ali); copyright transferred to Mark McLoughlin, "Sail Scoring" + logo asserted as unregistered (™) trademarks (see that repo's `LICENSE` / `TRADEMARK.md`). Fonts are **Audiowide** (display) + **Poppins** (body), both Google Fonts under the OFL. Not yet wired into the app — when doing so, build the favicon from the true-vector mark `logo/logo_mark 1.svg` (red `#fb3a3b`), **not** the shipped `favicon/*.svg`, which are raster bitmaps wrapped in SVG. The mark ships in red (`logo_mark 1`, light bg), white (`logo_mark 2`, dark/navy bg) and black (`logo_mark 4`, mono) colourways, all transparent — so use white on navy and the red-on-dark legibility worry doesn't arise.

### Sibling repositories

Sail Scoring is spread across several repos under the `sailscoring` org, all private and SSH, each checked out as a sibling directory of this one (`../<repo>`). When a task touches one of these concerns, the source of truth lives in the named repo — not here:

| Repo | Local path | What it holds |
|------|-----------|---------------|
| `sailscoring/sailscoring` | `../sailscoring` | **This repo** — the Next.js app and scoring engine. |
| `sailscoring/sailscoring.ie` | `../sailscoring.ie` | The apex **marketing site** (`sailscoring.ie`), a separate Vercel project. The **legal pages** (`app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx`) live here — see the Feature Checklist note on Privacy Policy and Terms. See `docs/design/marketing-site.md`. |
| `sailscoring/governance` | `../governance` | The **non-technical** side, kept deliberately in the open: funding, sponsorship, governance, and long-term sustainability. Sustainability/finance docs were moved out of this app repo into here. |
| `sailscoring/branding` | `../branding` | **Brand assets** (git-lfs): logo, mark, favicons, brand book. Detailed in the Brand assets bullet above. |
| `sailscoring/national-letters` | `../national-letters` | A versioned, public-domain **dataset of three-letter national codes** (with country names + flag images) for entry-list dropdowns and results. The app vendors it into `lib/nationality/generated/` via `scripts/sync-national-letters.ts` (`pnpm nationality:sync`). |
| `sailscoring/canonical-logos` | `../canonical-logos` | The maintained, versioned **canonical sailing-logo set** (governing bodies, clubs, class associations, sponsors, venues) served from `logos.sailscoring.ie` as the built-in tier of the workspace logo library (the `logo-library` feature). |
| `sailscoring/scupper` | `../scupper` | **scupper** — the temporary FTP upload relay for the local-first MVP (`lib/scupper.ts` talks to it). Slated for shutdown; do not build anything new on it. |

## Issues Workflow

| Type | When | Label | Command |
|------|------|-------|---------|
| Feature | In-scope, will almost certainly be built | `feature` | `gh issue create --label feature --title "..." --body "..."` |
| Bug | Broken behaviour | `bug` | `gh issue create --label bug --title "..." --body "..."` |
| Far-future idea | Speculative; requires infrastructure that doesn't exist yet | — | Add to `docs/design/horizon.md` directly; no issue needed |

The `idea` GitHub label is deprecated — use `docs/design/horizon.md` instead.

## MANDATORY: Run Tests Before Every Push

**ALWAYS run `pnpm lint`, `pnpm test:unit`, and `pnpm test:e2e` before `git push`.** Do not push unless all three pass.
`pnpm test:e2e` needs the local Postgres container up; run `pnpm db:up` first if it isn't already (see `docs/local-dev-scripts.md`). The `pretest:e2e` hook applies migrations but does not start the container.
If a test or lint check fails due to a code change you made, fix it before pushing — do not defer fixes to a follow-up commit.
If a check was already failing before your change, note it explicitly and confirm with the user before pushing.

This rule has no exceptions. Forgetting it has caused broken commits in the past.

## Use named pnpm scripts — never `DATABASE_URL=…`, `pnpm exec`, or `pnpm tsx scripts/`

This is enforced by a PreToolUse Bash hook (`scripts/guard-bash.sh`, wired in `.claude/settings.json`); the three patterns below are actively blocked, not just discouraged. Issue #113 tracks the regressions that prompted this.

The named scripts encode `DATABASE_URL`, `BETTER_AUTH_*`, and any other env wiring once, in one place — they keep local invocations, permission rules, and CI consistent. If a needed combination doesn't exist as a script, **add one to `package.json` rather than running inline**. See `docs/local-dev-scripts.md` for the full table.

| ❌ Don't                                                  | ✅ Do                                                |
|-----------------------------------------------------------|-----------------------------------------------------|
| `DATABASE_URL=… pnpm exec vitest tests/foo.test.ts`        | `pnpm test:unit:db tests/foo.test.ts`               |
| `DATABASE_URL=… pnpm exec playwright test e2e/foo.spec.ts` | `pnpm test:e2e e2e/foo.spec.ts`                     |
| `DATABASE_URL=… pnpm db:migrate`                           | `pnpm db:migrate:test` (local container)            |
| `DATABASE_URL=… pnpm db:generate`                          | `pnpm db:generate` (doesn't need a DB at all)       |
| `PGPASSWORD=… psql -h localhost -U sailscoring …`          | `pnpm db:psql:test` (add `-c "..."` for one-shots)  |
| `DATABASE_URL=… pnpm tsx scripts/provision-org.ts …`       | `pnpm provision-org:test …`                         |
| `DATABASE_URL=… pnpm tsx scripts/user-stats.ts …`          | `pnpm user-stats:test …`                            |
| `DATABASE_URL=… pnpm tsx scripts/change-email.ts …`        | `pnpm change-email:test …`                          |
| `pnpm tsc --noEmit; echo "exit=$?"`                        | `pnpm tsc --noEmit` (the bare exit code is enough)  |

If a script lacks a feature you need (e.g. a missing subcommand on `provision-org`), **extend the script** rather than reaching for `psql -c`, `tsx -e`, or a throwaway `scripts/_*.ts`. Inline workarounds need an env prefix specifically because they don't go through a named script — the missing affordance is the actual bug.

## Feature Checklist

When implementing any new user-facing feature, ensure the following are covered before considering it done:

- **Keyboard shortcut** — if the feature is a page-level action (add, import, export, etc.), add a `ShortcutSpec` via `useShortcuts` (`hooks/use-keyboard-shortcut.ts`) in the relevant page; the `?` help dialog renders from the shortcut registry automatically. Keys a page binds itself (element-level handlers, custom `useGlobalKeyDown` logic) contribute their dialog rows via `useShortcutHelp`. Document the shortcut in `app/help/page.tsx` if that page covers the area.
- **Help documentation** — update `app/help/page.tsx` if the feature introduces a workflow or concept that a new scorer would need guidance on.
- **Unit tests** — if the feature includes pure logic (calculations, parsers, validators), add Vitest tests in `tests/`. E2e covers workflows; unit tests cover correctness of the underlying functions.
- **E2E test** — add a Playwright test in `e2e/` covering the happy path. Console errors and page errors fail tests automatically (see `e2e/` setup).
- **Series file format** — if the feature adds new persistent fields to any type in `lib/types.ts`, update the serialization in `lib/series-file.ts` and consider whether the format version needs bumping. Omitting this causes silent data loss on file round-trips.
- **CSV import and public JSON export** — if the feature extends the shape of competitors, races, or any other data users import or export, check whether `app/series/[id]/competitors/page.tsx` (CSV import) and `lib/public-export.ts` (JSON export/import) need to carry the new field. These are easy to miss because they live outside `lib/types.ts` — but silently dropping a field on import or export is just as bad as silently dropping it on a file round-trip.
- **Scoring fixtures** — if the feature changes or extends scoring logic in `lib/scoring.ts`, add one or more declarative YAML fixtures in `tests/fixtures/scoring/`. Fixtures are designed to be read and verified by human scorers, not just by the test runner. After adding fixtures, run `pnpm generate:fixtures` and commit the regenerated `.html` files alongside the `.yaml` files. See `tests/fixtures/scoring/README.md`.
- **Privacy Policy and Terms** — if the feature changes what personal data is collected, how it's used, how long it's kept, who processes it (new sub-processor), or introduces pricing, billing, or new acceptable-use boundaries, update the corresponding page in the marketing site repo (`sailscoring/sailscoring.ie`: `app/legal/privacy/page.tsx`, `app/legal/terms/page.tsx`) and bump the "Last updated" date. Cross-repo: the legal pages live in the marketing site, not this repo.
- **Feature-gate documentation** — if the feature registers a new key in `lib/features.ts` (#155 gating), add a row for it to the feature table in `docs/workspace-provisioning.md` (key, default on/off, and what it unlocks) so the operator can actually turn it on. This is consistently overlooked: a gated feature with no doc entry is invisible to whoever provisions workspaces.

## Contact Email

User-facing contact for feedback and support is **mark@hyc.ie**. Do not use `mark@sailscoring.ie` in product copy or docs — that mailbox isn't set up yet.

## Tone and Humour

The project aims to be credible and serious — scorers are exacting people — but a little wry humour is welcome. The bar: the name must do real communicative work, the nautical connection must be genuine, and it belongs in structure (a module name, a section heading), not inline prose. Example: **bilge** — the temporary results publishing service; bilge is dirty water you pump out before the real plumbing is installed. If a sailor wouldn't immediately recognise the term as correct, it's too cute.

## ADR Process

New architectural decisions should follow the template at `docs/design/decisions/000-template.md`. Existing ADRs:
- ADR-001: Database choice (Superseded by ADR-008 — IndexedDB for MVP, Postgres for full-stack; the Postgres half is now in production)
- ADR-002: Scoring algorithm approach (Accepted — hybrid: hard-coded algorithms with configurable parameters)
- ADR-003: Application architecture (Superseded by ADR-008 — local-first MVP transitioned to full-stack Next.js on Vercel)
- ADR-004: Results publishing (Superseded by ADR-008 — the **bilge** MVP service was replaced by in-app publishing and decommissioned in Phase 9)
- ADR-005: Hosting and domain structure (Accepted — `sailscoring.ie` marketing, `app.sailscoring.ie` app; `bilge.sailscoring.ie` retired to a redirect-only stub in Phase 9)
- ADR-006: Testing and debug logging (Accepted — Vitest for unit/integration, Playwright for e2e; no DB mocking; debug logs gated behind `DEBUG` env var)
- ADR-007: Finish sheet model for mixed timed/untimed finish entry (Accepted — unified ordered list, row order = crossing order, time column optional per row; implemented in `d8ad8d0`)
- ADR-008: Full-stack transition (Accepted — Next.js + Vercel Fluid Compute + Neon Postgres + Better Auth + workspace collaboration; Phases 1–10 complete — Phase 10 (#153) shipped the activity log, invitations / member management, and self-service org-creation requests)
