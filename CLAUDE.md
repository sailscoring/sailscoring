# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sail Scoring is a sail racing scoring application for managing regattas, series, and race days. It handles handicap corrections, result codes, discard rules, and series standings per World Sailing Racing Rules of Sailing (RRS) Appendix A.

**Current status:** Milestone 1 (IODAI use case) complete. Handicap scoring is complete through Phase 2: static TCF (IRC, PY) and progressive handicaps (NHC1 — HYC's HPH — and ECHO), each with a rating-calculation explainability layer. A working local-first web app is deployed to `app.sailscoring.ie` (Vercel). It supports scratch (position-based) and time-corrected handicap scoring across multiple fleets and races, with the finish sheet model for mixed timed/untimed entry, multi-fleet competitors, per-fleet start groups, series standings, discards, a full set of RRS result codes (RRS A5/A6/A8/A11), A5.3 alternative scoring, start check-in, equal finish positions, configurable competitor fields, crew names, CSV competitor import (with multi-fleet support), series settings (venue, dates, burgee, scoring mode, default start sequence), HTML/JSON results export, and results publishing via bilge and FTP. The HYC Autumn League use case (progressive handicaps) is now served; current focus is the ADR-008 full-stack transition (see below). Remaining handicap-system work (RYA NHC 2015, ECHO certificate layer, etc.) is deferred in `docs/design/horizon.md`.

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS v4, shadcn/ui components (`components/ui/`)
- **Storage:** IndexedDB via Dexie.js (`lib/db.ts`, `lib/dexie-repository.ts`)
- **Package manager:** pnpm; Node 24.x
- **Unit/integration tests:** Vitest (`tests/` — `pnpm test:unit` runs no-DB tests; `pnpm test:unit:db` adds the Postgres-backed ones)
- **E2E tests:** Playwright (`e2e/` — `pnpm test:e2e` runs the local-first specs; `pnpm test:e2e:server` runs the auth/server-mode specs). See `docs/local-dev-scripts.md` for the full picture.
- **Deploy:** Vercel (`pnpm deploy` / `pnpm deploy:prod`); see `DEPLOY.md` for custom domain setup

## Source Layout

Pure logic lives in `lib/`; pages and UI in `app/`. Key lib modules: `scoring.ts` (engine), `scoring-codes.ts` (RRS code registry), `series-file.ts` (serialization), `results-renderer.ts` (HTML export), `public-export.ts` (JSON export/import), `bilge.ts` / `scupper.ts` (results publishing). Series pages live under `app/series/[id]/` with tabs: Competitors, Races, Standings, Settings.

See `docs/` for design docs, ADRs, requirements, and glossary. `reference/` holds PDFs of comparable tools and the RRS (Appendix A governs scoring).

The full-stack transition (ADR-008) is under way. Phases 1–7 are complete: Better Auth + Postgres, the full server-side data layer, the UI swap onto `lib/api-repository.ts` (with a lint rule banning direct `lib/db` imports outside the Dexie repository), optimistic concurrency on every single-row write, the "Move to my account" migration banner that sweeps existing IndexedDB series into the signed-in workspace, per-row autosave on finish entry (#111, closing the silent-overwrite hole on `FinishRepository.saveMany`), and the org-sharing core for HYC panel collaboration (#112 — workspace switcher, manual provisioning CLI, copy-to-workspace, actor attribution on conflicts, `/workspace` settings hub). Phase 8 (cutover — `USE_SERVER_DATA=true` by default in production, HYC panel onboarded, beta users prompted to migrate) is in flight. Next up: Phase 9 bilge replacement → Phase 10 residual collaboration UX (full activity log, self-service org admin, vanity URLs). The original Phase 8 (org-based collaboration) was split into Phases 7 and 10 and reordered so HYC's panel gets server-of-record + collaboration in the same flag flip rather than living through a `.sailscoring` file-exchange gap after cutover.

- **Schema** — Drizzle in `lib/db/schema/` (mirrors `lib/types.ts`), lazy client in `lib/db/client.ts`, migrations in `drizzle/`
- **Validation** — Zod schemas in `lib/validation/`, used at every `/api/v1` boundary
- **Repositories** — server-side in `lib/postgres-repository.ts` (workspace-scoped, `server-only`); client-side mirror in `lib/api-repository.ts`
- **Auth** — Better Auth in `lib/auth.ts`; `lib/auth/require-workspace.ts` is the single seam every server caller goes through
- **REST surface** — `/api/v1/...` routes; route files are thin glue, logic lives in `lib/api-handlers/`. `Idempotency-Key` replays are handled by the `workspaceRoute` wrapper in `app/api/v1/_lib/handler.ts`
- **Feature flag** — `USE_SERVER_DATA` in `lib/flags.ts` (server-only). On in production from Phase 8 cutover; the flag stays in place during the stabilisation window so individual deployments can revert. Local-first build still ships in the bundle and is reachable by setting the env var to `false`.
- **DB tests** — Vitest tests under `tests/db/`, `tests/postgres-repository.test.ts`, `tests/auth/`, `tests/api/` skip when `DATABASE_URL` is unset; CI provides it. Locally use `pnpm test:unit:db` (or `pnpm db:up` first and then `pnpm test:unit`); see `docs/local-dev-scripts.md`.

## Repository and Licensing

- **GitHub:** `github.com/sailscoring/sailscoring` (private; org is `sailscoring`)
- **Git:** Direct commits to `main` are fine; no PR requirement; SSH remote
- **License:** All rights reserved, copyright Mark McLoughlin — deliberately deferred pending open-source vs. commercial decision. See `LICENSE` and `docs/goals.md`. This constraint should inform dependency choices: avoid copyleft (GPL) libraries that would limit future licensing options; prefer MIT, Apache 2.0, or BSD.

## Issues Workflow

| Type | When | Label | Command |
|------|------|-------|---------|
| Feature | In-scope, will almost certainly be built | `feature` | `gh issue create --label feature --title "..." --body "..."` |
| Bug | Broken behaviour | `bug` | `gh issue create --label bug --title "..." --body "..."` |
| Far-future idea | Speculative; requires infrastructure that doesn't exist yet | — | Add to `docs/design/horizon.md` directly; no issue needed |

The `idea` GitHub label is deprecated — use `docs/design/horizon.md` instead.

## MANDATORY: Run Tests Before Every Push

**ALWAYS run `pnpm lint`, `pnpm test:unit`, `pnpm test:e2e`, and `pnpm test:e2e:server` before `git push`.** Do not push unless all four pass.
The `:server` variant covers the auth/server-mode specs; the default `test:e2e` covers the local-first specs. They're mutually exclusive — both have to run.
The `pretest:e2e:server` hook will start the local Postgres container automatically (see `docs/local-dev-scripts.md`).
If a test or lint check fails due to a code change you made, fix it before pushing — do not defer fixes to a follow-up commit.
If a check was already failing before your change, note it explicitly and confirm with the user before pushing.

This rule has no exceptions. Forgetting it has caused broken commits in the past.

## Use named pnpm scripts, not env-var prefixes

When running tests, builds, or dev servers, use the named `pnpm` scripts (`pnpm test:unit:db`, `pnpm test:e2e:server`, `pnpm start:test`, `pnpm db:up`, etc.). Do not prefix invocations with env vars like `E2E_SERVER_MODE=1 pnpm exec playwright test` or `DATABASE_URL=… pnpm test:unit` — the named scripts encode the right configuration (DATABASE_URL default, BETTER_AUTH_* values, mode flags) and keep local invocations, permission rules, and CI consistent. If a needed combination doesn't exist as a script, add it in `package.json` rather than running inline. See `docs/local-dev-scripts.md`.

## Feature Checklist

When implementing any new user-facing feature, ensure the following are covered before considering it done:

- **Keyboard shortcut** — if the feature is a page-level action (add, import, export, etc.), add a shortcut via `useGlobalKeyDown` in the relevant page, register it in `components/keyboard-help.tsx` under the appropriate section, and document it in `app/help/page.tsx` if that page covers the area.
- **Help documentation** — update `app/help/page.tsx` if the feature introduces a workflow or concept that a new scorer would need guidance on.
- **Unit tests** — if the feature includes pure logic (calculations, parsers, validators), add Vitest tests in `tests/`. E2e covers workflows; unit tests cover correctness of the underlying functions.
- **E2E test** — add a Playwright test in `e2e/` covering the happy path. Console errors and page errors fail tests automatically (see `e2e/` setup).
- **Series file format** — if the feature adds new persistent fields to any type in `lib/types.ts`, update the serialization in `lib/series-file.ts` and consider whether the format version needs bumping. Omitting this causes silent data loss on file round-trips.
- **CSV import and public JSON export** — if the feature extends the shape of competitors, races, or any other data users import or export, check whether `app/series/[id]/competitors/page.tsx` (CSV import) and `lib/public-export.ts` (JSON export/import) need to carry the new field. These are easy to miss because they live outside `lib/types.ts` — but silently dropping a field on import or export is just as bad as silently dropping it on a file round-trip.
- **Scoring fixtures** — if the feature changes or extends scoring logic in `lib/scoring.ts`, add one or more declarative YAML fixtures in `tests/fixtures/scoring/`. Fixtures are designed to be read and verified by human scorers, not just by the test runner. After adding fixtures, run `pnpm generate:fixtures` and commit the regenerated `.html` files alongside the `.yaml` files. See `tests/fixtures/scoring/README.md`.

## Contact Email

User-facing contact for feedback and support is **mark@hyc.ie**. Do not use `mark@sailscoring.ie` in product copy or docs — that mailbox isn't set up yet.

## Tone and Humour

The project aims to be credible and serious — scorers are exacting people — but a little wry humour is welcome. The bar: the name must do real communicative work, the nautical connection must be genuine, and it belongs in structure (a module name, a section heading), not inline prose. Example: **bilge** — the temporary results publishing service; bilge is dirty water you pump out before the real plumbing is installed. If a sailor wouldn't immediately recognise the term as correct, it's too cute.

## ADR Process

New architectural decisions should follow the template at `docs/design/decisions/000-template.md`. Existing ADRs:
- ADR-001: Database choice (Accepted — IndexedDB via Dexie.js)
- ADR-002: Scoring algorithm approach (Accepted — hybrid: hard-coded algorithms with configurable parameters)
- ADR-003: Application architecture (Accepted — local-first web app for MVP, full-stack later)
- ADR-004: Results publishing (Accepted — separate **bilge** service, `github.com/sailscoring/bilge`)
- ADR-005: Hosting and domain structure (Accepted — `sailscoring.ie` marketing, `app.sailscoring.ie` app, `bilge.sailscoring.ie` bilge API)
- ADR-006: Testing and debug logging (Accepted — Vitest for unit/integration, Playwright for e2e; no DB mocking; debug logs gated behind `DEBUG` env var)
- ADR-007: Finish sheet model for mixed timed/untimed finish entry (Accepted — unified ordered list, row order = crossing order, time column optional per row; implemented in `d8ad8d0`)
