# ADR-009: API, SDK, and CLI

**Status:** Proposed

**Date:** 2026-06-15

**Deciders:** Mark McLoughlin

## Context

There is an immediate, concrete need: a large number of `.sailscoring`
files to import into a workspace in bulk. The application has an in-browser
"open series from file" flow, but no way to import many files at once, and
no command-line entry point at all.

The temptation is to write a one-off `DATABASE_URL` script in the mould of
the existing ops scripts (`provision-org`, `user-stats`, `change-email`,
`delete-account`). Those scripts bypass the API and write directly to
Postgres. That would unblock the import quickly — but it is a dead end. The
explicit goal here is for the import tool to be **the basis for a complete
CLI**, and a DB-direct tool cannot become that: it can only run with
production database credentials in hand, it forks the validation and
tenancy logic that lives at the API boundary, and it never exercises — let
alone pressures into shape — the surface that a real CLI must stand on.

The relevant facts about what already exists:

- **`/api/v1` is already a complete, workspace-scoped REST surface.** ~20
  handler modules under `lib/api-handlers/`, every write Zod-validated, an
  `Idempotency-Key` replay path and `If-Match` optimistic concurrency in the
  `workspaceRoute` wrapper, and tenancy enforced twice (route wrapper plus
  the repository layer — the post-CVE-2025-29927 belt-and-braces). It is a
  real API; it has simply never been treated as a *public* one.
- **The import logic is already transport-agnostic.** `openSeriesFromFile(content, repos)`
  in `lib/series-file.ts` runs against the `SeriesFileRepos` interface.
  `lib/api-repository.ts` implements that interface by forwarding to
  `/api/v1` over `fetch`; `lib/postgres-repository.ts` implements the same
  interface server-side. So "the import script" is not new logic — it is
  existing logic pointed at a transport and a credential.
- **The only missing piece is non-browser authentication.** Everything
  authenticates with a session cookie (`apiFetch` sends
  `credentials: 'same-origin'`); `requireWorkspace()` reads the Better Auth
  session and resolves the active workspace from
  `session.activeOrganizationId`. The `screenshots` script smuggles in a
  real session cookie — fragile and expiring. There is no API-key / bearer
  mechanism wired into `lib/auth.ts`.

So the decision is not really "how do we import files"; it is "do we treat
the CLI as a first-party API client, and what does that commit us to." This
ADR records that decision and the sub-decisions it forces (authentication,
import endpoint shape, workspace selection, CLI packaging), and — added in
scope here — **what language the CLI is built in** and **whether and how we
ship language bindings (an SDK) for the API**.

Those last two are coupled, which is why they are decided together. If the
CLI is TypeScript it can sit on a shared, typed client derived from the same
schemas that guard the API; if it is Go or Rust it cannot, and the contract
has to be restated in a second ecosystem. And the answer to "do we need
polyglot SDKs" determines whether a single source-of-truth API description
(from which clients are *generated*) is worth standing up now. Deciding the
CLI language without a view on the SDK strategy would risk picking a stack
that fights the binding story later.

The public-API question is deliberately staged: `/api/v1` remains an
**internal contract that the CLI consumes** for now — no third-party
stability promise — but a documented public API is a near-term follow-up,
so this ADR lays the low-hanging groundwork (a bearer auth scheme, an
explicit workspace-selection header, and a generatable API description)
rather than painting it into a corner.

## Decision Drivers

- **Reuse over reimplementation.** `openSeriesFromFile` and the repository
  interfaces already encode the import; a second implementation would drift.
- **Tenancy and validation must not be bypassed.** Whatever imports data
  must go through the same Zod + permission + workspace-scoping path the UI
  does.
- **The tool must run against production, remotely, without DB credentials.**
- **It must be the seed of a complete CLI**, not a throwaway — subcommands,
  durable auth, configurable target.
- **Low risk to the auth seam.** Authentication is security-critical and
  funnels through one function; changes there carry regression risk.
- **Near-term public-API readiness** without committing to it today.
- **One source of truth for the API contract.** The Zod schemas already
  guard `/api/v1`; the CLI, an SDK, and any future polyglot client should
  derive from that contract, not restate it.
- **Low CLI install friction** for an initially technical, internal
  audience — weighed against the cost of carrying a second language and
  toolchain in the repo.

## Considered Options

### Axis 1 — What does the CLI talk to?

#### Option 1a: API client (chosen)

The CLI is just another `/api/v1` client. It reuses `api-repository` /
`openSeriesFromFile` and a new import endpoint, authenticating with a token.

**Pros:**
- Reuses existing logic; no fork of validation/tenancy.
- Runs anywhere against any deployment; no DB credentials.
- Dogfoods `/api/v1` into a real product surface — the strategic payoff.

**Cons:**
- Requires a non-browser auth mechanism (does not exist yet).

#### Option 1b: DB-direct script (rejected as the foundation)

A `DATABASE_URL` script like the other ops tools, writing Postgres directly.

**Pros:**
- Fastest to ship the bulk import in isolation; no auth work.

**Cons:**
- Cannot become a real CLI (needs DB creds; production-only with risk).
- Forks the validation/tenancy logic or skips it entirely.
- Never exercises the API surface we want to harden.

DB-direct remains the right tool for genuine superuser/ops tasks
(provisioning, account deletion) and keeps that role — it is simply not the
basis for the CLI.

### Axis 2 — How does the CLI authenticate?

#### Option 2a: Use Better Auth's `apiKey` plugin (chosen)

We were on `better-auth@1.6.14`. The `apiKey` plugin is **no longer part of
the `better-auth/plugins` barrel** (verified: the 1.6.18 barrel exports
`bearer`, `jwt`, `organization`, `magicLink`, … but not `apiKey`, and there
is no `dist/plugins/api-key/` directory on any published line — 1.4 through
the 1.7 beta and the 1.0 canary). It has been hived off into its own scoped
package, **`@better-auth/api-key`**, published since 2026-02-26 and
versioned in lockstep with core (currently 1.6.18). It peer-depends on
`better-auth ^1.6.18`, so the work is: bump core to ≥ 1.6.18 (done —
upgraded 1.6.14 → 1.6.18) and `pnpm add @better-auth/api-key`, then
`import { apiKey } from "@better-auth/api-key"`. The plugin issues
revocable, hashable, metadata-scopable keys.

Verified against the 1.6.18 package source: keys are **hashed by default**
(`disableKeyHashing ?? false`; the raw key is returned once at creation,
the SHA-256 hash stored thereafter); **revocation** is an `enabled` flag
plus `expiresAt` and a delete endpoint; **metadata** is a per-key field
(the home for the default-workspace selector in §4 of the Decision);
built-in rate-limiting and `remaining`/`refill` quotas come along too. The
plugin reads the key from the **`x-api-key`** header by default
(`apiKeyHeaders ?? "x-api-key"`), and is configurable to read
`Authorization` and strip the `Bearer ` prefix — so the public-facing
header is a deliberate choice, not fixed by the plugin (see Decision §2).

**Pros:**
- First-class, maintained: revocation, expiry, rate-limiting, metadata,
  and session-from-key resolution out of the box.
- The bearer-style contract is exactly the public-API groundwork we want.

**Cons:**
- A new dependency on the security-critical auth seam, in lockstep with a
  core bump; its own regression surface (must re-run the full auth/e2e
  suite).

#### Option 2b: Roll our own minimal key layer (rejected)

A small `api_key` table (hashed secret + `userId` + optional workspace +
label + `revokedAt`) and a few lines in `requireWorkspace` to resolve a
Bearer key into a `WorkspaceContext`.

**Pros:**
- No Better Auth upgrade; smallest blast radius given the single auth seam.

**Cons:**
- Re-implements key lifecycle (rotation, rate-limiting, hashing) that the
  upstream plugin already solves; long-term maintenance we would rather not
  own on a security boundary.

#### Option 2c: Reuse the session token / `bearer` plugin (rejected)

The `bearer` plugin we already have only re-presents the **expiring session
token** via the `Authorization` header. Not a durable, revocable, scopable
key — unfit as a CLI/public-API foundation.

### Axis 3 — How is a single `.sailscoring` file imported?

#### Option 3a: New server-side import endpoint (chosen)

`POST /api/v1/series/import` accepts a parsed `SeriesFile`, validates it,
and runs `openSeriesFromFile` server-side against `postgres-repository`
within the request.

**Pros:**
- One round-trip per file; per-series atomicity.
- `Idempotency-Key` per file makes a bulk run resumable.
- Reuses `openSeriesFromFile` server-side — no new import logic.

**Cons:**
- A new endpoint, handler, and a Zod schema covering the `SeriesFile` shape.

#### Option 3b: Client-orchestrated N calls (rejected)

The CLI drives the existing per-resource endpoints via `api-repository`,
exactly as the browser does.

**Pros:**
- Zero new server code.

**Cons:**
- Chatty (many calls per file); no per-series atomicity; a failure
  mid-file leaves a partial series.

### Axis 4 — What language/runtime is the CLI built in?

Note one thing first: because import is a *server-side* endpoint (Axis 3),
the CLI does **not** run `openSeriesFromFile` locally, so the language is
not forced by import-logic reuse. The reuse that does favour TypeScript is
shared **types**, shared **validation**, and a shared **SDK** (Axis 5) — and
the single-toolchain argument.

#### Option 4a: TypeScript / Node (chosen)

The CLI is a TypeScript program in this repo, run on Node 24 (the existing
runtime), bundled with the existing toolchain.

**Pros:**
- Reuses `lib/types.ts`, the Zod validators, and — crucially — the
  first-class TS SDK (Axis 5a), so the CLI restates nothing.
- One language and toolchain (pnpm, tsx/esbuild); no new ecosystem to
  maintain in a one-person project.
- Distribution path scales: `pnpm cli` in-repo now → published npm package
  (`npx sailscoring`) → optional single-file executable (Node SEA / Bun
  compile / esbuild) if the audience ever widens beyond Node users.

**Cons:**
- The npm form needs a Node runtime; startup is slower than a static
  binary, and zero-runtime distribution requires a bundling step.

#### Option 4b: Go (rejected for now)

A single static binary — the classic "great CLI" stack.

**Pros:**
- Excellent distribution (one dependency-free binary per platform), fast
  cold start.

**Cons:**
- Zero reuse of the TS codebase: types, validation, and any client logic are
  reimplemented or code-generated into a second language.
- A second ecosystem and toolchain to carry. Justified only for a
  mass-market standalone public CLI — which we are explicitly not building
  yet.

#### Option 4c: Rust / Python (rejected)

Rust shares Go's distribution upside with smaller binaries but the steepest
dev cost and reuse loss; Python is low-friction (typer/click) but, like
Node, needs a runtime *without* the reuse benefit, and adds a third
ecosystem. Neither earns its keep at this stage.

### Axis 5 — Do we ship language bindings (an SDK), and how?

#### Option 5a: Spec-first; TS SDK first-class; polyglot generated on demand (chosen)

Stand up a single **OpenAPI 3.1 description generated from the existing Zod
schemas** as the contract's source of truth. From it: the **TypeScript SDK**
is the first-class, maintained binding (a thin typed `fetch` client —
essentially `api-repository` promoted to a publishable package), and the CLI
is built on it. Other-language clients (Python, Go, …) are *generatable* from
the same spec but **not** pre-built or hand-maintained; we publish the spec
and generate a client when a real consumer appears.

**Pros:**
- One contract, expressed three ways from the same schemas: server-side
  validation, the TS SDK, and the OpenAPI doc for everyone else.
- Closes the loop: CLI → TS SDK → `/api/v1`, all typed off the spec.
- Polyglot bindings become a cheap generation step, not a standing
  maintenance burden — answers "is it necessary?" with "not yet, but free
  when it is."

**Cons:**
- Zod-to-OpenAPI coverage must be kept honest (some schemas need annotation);
  the spec is another artifact to regenerate in CI.

#### Option 5b: Hand-written first-party SDKs per language (rejected)

A maintained client in each of TS, Python, Go, …

**Pros:**
- Idiomatic, hand-tuned clients.

**Cons:**
- N clients drift from the API and from each other; unsustainable
  maintenance for a one-person project, justified only at significant
  external adoption.

#### Option 5c: No SDK — document the REST API only (rejected as direction)

Consumers use raw HTTP and their own language's client.

**Pros:**
- Lowest cost; it is effectively where we are today.

**Cons:**
- Gives the TS CLI nothing to stand on, and leaves the contract living only
  in prose. Fine as the *current state*; the decision is to move off it.

## Decision

Build the bulk importer as the first subcommand of a **first-party CLI that
is an API client**, not a DB tool. Concretely:

1. **CLI = API client.** Reuse `openSeriesFromFile` and the repository
   interfaces. The DB-direct scripts keep their ops/superuser role and are
   not extended into a CLI.
2. **Authenticate with API keys via Better Auth's `apiKey` plugin.** Add the
   `@better-auth/api-key` package (which peer-depends on `better-auth ≥
   1.6.18`; core has been bumped to 1.6.18 to satisfy it). The CLI presents
   the key in a single header; we standardise on `Authorization: Bearer
   <key>` for public-API familiarity (the plugin defaults to `x-api-key`,
   but `apiKeyHeaders` lets us read `Authorization` and strip the `Bearer `
   prefix). `requireWorkspace` learns to resolve a keyed request into a
   `WorkspaceContext`.
3. **Token generation — GitHub-PAT style, created once.** The `apiKey`
   plugin returns the plaintext key **exactly once** at creation and stores
   only a hash thereafter; a lost key is rotated, never recovered. Two ways
   to mint one:
   - **Web UI (the normal path):** an "API keys" / "CLI access" card on
     `/account` (alongside the existing `OrgRequestCard`). A *Create token*
     dialog takes a **label** and a **default workspace** (from the user's
     memberships), calls `apiKey.create`, then reveals the plaintext once in
     a copy-to-clipboard field with a "you won't see this again" warning. The
     card lists existing keys (label, created, last-used) with a **Revoke**
     action and never re-displays a secret. The chosen default workspace is
     written to the key's metadata (see point 5).
   - **Ops bootstrap (chicken-and-egg):** a small `provision-token` script in
     the ops-script lane (like `provision-org`) calls `auth.api.createApiKey`
     for a given user and prints the plaintext once — so the very first key
     (and the bulk import) is unblocked before the `/account` card ships.

   The CLI consumes a token with `sailscoring auth login`: it prompts for the
   pasted key (and optional `--base-url`), verifies it with one authenticated
   call, and writes it to `~/.config/sailscoring/`. A browser-based
   device-authorization login (the `device-authorization` plugin is
   available) is a nicer future UX but deferred — paste-the-token is enough
   to seed the CLI. Keys default to **no expiry** (PAT-style; revoke to
   invalidate); a forced max-lifetime can be revisited if/when the API goes
   public.
4. **Server-side import endpoint.** Add `POST /api/v1/series/import` that
   runs `openSeriesFromFile` against Postgres, one file per request, with
   `Idempotency-Key` support; bulk import is a resumable loop over it.
5. **Workspace selection for keyed requests.** A key carries a **default
   workspace** in its metadata, overridable per request by an explicit
   `x-sailscoring-workspace` header (slug or id) that `requireWorkspace`
   validates against membership. Sessions are unaffected (they still use
   `activeOrganizationId`). This header is reusable public-API groundwork.
6. **Import id semantics.** Default to **minting new ids** on import to
   avoid cross-workspace `seriesId` collisions; an idempotent
   `--preserve-ids` / upsert mode is a later option, not part of this ADR.
7. **CLI packaging.** Lives in a `cli/` module, structured as subcommands
   from day one (`import` first; room for `series list`, etc.). It is the
   first tool that is a *pure* API client — **no `DATABASE_URL`** — so it
   sidesteps the named-script env convention; it takes `--base-url`
   (defaulting to production) and a token from `~/.config`/env. Run locally
   via a `pnpm cli` script. Publishing a standalone npm bin is deferred.
8. **Public-API groundwork now, public API later.** The Bearer scheme, the
   workspace header, and a generatable OpenAPI description (see §10) are done
   now. A *documented, stability-promised* public API (deprecation policy,
   published spec, polyglot SDKs) is a near-term follow-up ADR, not this one.
9. **CLI language: TypeScript / Node.** Built in TypeScript, run on Node 24,
   so it reuses the shared types, validators, and the TS SDK (§10) rather
   than restating them, and adds no second toolchain. Distribution starts as
   the in-repo `pnpm cli` script and a published npm package; a single-file
   executable (Node SEA / Bun compile) is held in reserve for if the audience
   ever outgrows Node users. Go/Rust/Python are rejected — their distribution
   upside does not pay for the lost reuse and the second ecosystem at this
   stage.
10. **SDK direction: spec-first, TS SDK first-class, polyglot on demand.**
    Generate an **OpenAPI 3.1 description from the Zod schemas** as the
    contract's single source of truth. Maintain a first-class **TypeScript
    SDK** (a thin typed `fetch` client — `api-repository` promoted to a
    publishable package) and build the CLI on it. Other-language SDKs are
    **generatable from the spec on demand, not hand-maintained** — we are not
    shipping Python/Go clients until a real consumer needs one. Sequencing:
    the spec generation is the groundwork landed with this work; extracting
    the TS SDK follows; polyglot generation is deferred until demand.

The detailed milestone plan lives in the tracking issue, not here.

## Consequences

### Positive

- The bulk importer ships *and* seeds the CLI in one effort — the importer
  is literally the CLI's first subcommand.
- `/api/v1` gains a second first-party client, surfacing gaps before any
  third party depends on it.
- Durable, revocable Bearer auth unblocks automation generally (CI,
  scripted backfills) beyond this one import.
- Workspace-selection-by-header and the Bearer scheme are the bulk of what a
  public API needs, paid down early and cheaply.
- One contract expressed three ways from the same Zod schemas (server
  validation, TS SDK, OpenAPI) — the CLI, the SDK, and future polyglot
  clients cannot drift from the API or from each other.
- Choosing TypeScript keeps the whole stack in one language and toolchain;
  the CLI rides the SDK rides the spec, all generated off existing schemas.

### Negative

- A Better Auth upgrade on the auth seam, with its attendant migration and
  full-suite re-verification cost.
- A new endpoint plus a `SeriesFile` Zod schema to maintain in step with
  `lib/types.ts` and `series-file.ts`.
- The OpenAPI description is a new generated artifact to keep honest in CI,
  and the TS SDK is a new internal package boundary to maintain.
- A Node-based CLI carries a runtime dependency; zero-runtime distribution
  (a single binary) is deferred work, not free.

### Risks

- **Plugin sourcing (resolved) and upgrade regressions.** The plugin's
  location is settled: it is the standalone `@better-auth/api-key` package
  (not the `better-auth/plugins` barrel), peer-depending on `better-auth ≥
  1.6.18`; core is upgraded. What remains unverified is the *behavioural*
  blast radius — the 1.6.14 → 1.6.18 bump and the new plugin against the
  `organization` / `magic-link` plugins we depend on. *Mitigation:* run the
  full `auth`/`api`/e2e suites, and keep the roll-our-own minimal key layer
  (Option 2b) as a fallback if the plugin proves disruptive — the
  bearer-style contract is identical either way, so the CLI and the future
  public API are insulated from which one we pick.
- **Keyed-request workspace ambiguity.** A key with no default workspace and
  no header is ambiguous. *Mitigation:* require one or the other; fail
  closed (no silent fallback to a "first" workspace).
- **`SeriesFile` schema drift.** A Zod schema that lags the file format
  silently rejects or drops fields. *Mitigation:* derive/round-trip-test it
  against `parseSeriesFile`, and treat it like the other format-version
  obligations in the Feature Checklist.
- **Zod-to-OpenAPI coverage gaps.** Some schemas (unions, refinements,
  branded types) may not translate cleanly, producing a spec that lies about
  the contract — worse than no spec for a generated client. *Mitigation:*
  generate the spec in CI and assert it covers every `/api/v1` route; treat
  an untranslatable schema as a bug in the schema or an annotation to add,
  not a reason to hand-edit the output.
- **Single-language reuse cuts both ways.** Standardising on TypeScript means
  a future need for a truly native non-Node CLI (a static binary) is a
  rewrite, not a recompile. *Mitigation:* the spec-first SDK direction means
  such a rewrite consumes a generated client rather than reverse-engineering
  the API — and the need is hypothetical for the current audience.

## Related Decisions

- [ADR-008: Full-Stack Transition](008-full-stack-transition.md) —
  established `/api/v1`, the repository layer, Better Auth, and the
  workspace model this builds on.
- [ADR-005: Hosting and Domains](005-hosting-and-domains.md) — `app.sailscoring.ie`
  is the CLI's default `--base-url`.

## References

- `lib/series-file.ts` (`openSeriesFromFile`), `lib/api-repository.ts`,
  `lib/postgres-repository.ts` — the reusable import + repository surface.
- `app/api/v1/_lib/handler.ts`, `lib/auth/require-workspace.ts` — the route
  wrapper and the single auth/workspace seam an API key must flow through.
- Better Auth `apiKey` plugin: `@better-auth/api-key` package,
  `https://better-auth.com/docs/plugins/api-key`.
- OpenAPI-from-Zod and client generation tooling: `@asteasolutions/zod-to-openapi`
  (or Zod's native JSON-Schema export), `openapi-typescript` / `openapi-fetch`
  for the TS SDK, `openapi-generator` for polyglot clients.
