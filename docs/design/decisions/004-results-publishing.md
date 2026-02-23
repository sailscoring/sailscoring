# ADR-004: MVP Results Publishing — bilge

**Status:** Proposed

**Date:** 2026-02-21

**Deciders:** Mark McLoughlin

## Context

Sail Scoring produces results standings as HTML. For a results viewer (sailor,
parent, club official) to see them, that HTML needs to reach a public URL.

The application is local-first (ADR-003): data lives in IndexedDB in the
scorer's browser, there is no server, and all computation happens on the
client. There is therefore no built-in place to host published results and no
built-in upload mechanism.

This ADR describes a **deliberately minimal, MVP-only** results publishing
backend. It is a throwaway service — a stopgap to get results online while the
main application is being validated. It is not designed for longevity, scale,
or real security. When the Sail Scoring application moves to its planned
full-stack phase (ADR-003), results publishing moves into the main application
and this service is retired.

### Prior art

Sailwave, a comparable Windows desktop application, solves this problem by
embedding shared upload credentials directly in its application binary. Any
copy of Sailwave can upload HTML results to a shared folder on the Sailwave
website with no configuration required. The model works because the blast
radius is small: a publicly readable folder of HTML sailing results is not a
valuable target. The right question is not "how do we protect the credentials?"
but "how do we make credential extraction not matter?"

## Decision Drivers

- Local-first MVP has no server — results need somewhere to go
- Free or near-free to operate
- Minimal implementation effort — not the core product
- **Clearly and unambiguously temporary** — must not become load-bearing
  infrastructure
- Obvious abuse prevention, not real security
- The main Sail Scoring app should have minimal coupling to this service

## Considered Options

Three approaches were considered before this decision:

1. **Download + manual upload** — app generates HTML, user manually uploads to
   a free static host (e.g. Netlify Drop). Zero integration cost but clunky
   UX; users have to leave the app and manage files themselves.

2. **GitHub Pages via API** — app uses the GitHub REST API with a personal
   access token to commit HTML to a GitHub Pages repository. Free and requires
   no dedicated service to maintain, but requires every scorer to have a
   GitHub account, a Pages-enabled repo, and a PAT — too much setup friction
   for non-technical users.

3. **Dedicated serverless endpoint** — a small purpose-built service accepts
   HTML via HTTP POST and serves it at a public URL, with email-based
   verification as the only access gate. More infrastructure than option 1,
   but simpler UX than option 2. Chosen.

## Decision

Build a minimal upload service called **bilge** as a separate repository
(`github.com/sailscoring/bilge`). The name is chosen deliberately: bilge is
the dirty water that collects at the bottom of a boat. It signals that this is
not a clean, permanent solution — it is the temporary mess you pump out before
the real plumbing is installed.

The service runs as a Vercel serverless application (free tier) using Vercel
Blob for HTML storage and Vercel KV for metadata. The Sail Scoring application
posts results HTML to it via a simple HTTP API. The service has no UI beyond
the public results pages, the listing pages, and a verification confirmation
page.

**bilge exists only for the duration of the Sail Scoring MVP.** The `bilge`
repository README must prominently state that the service will be shut down
when Sail Scoring ships its full-stack version. No features should be added to
bilge that are not directly required to support MVP-era Sail Scoring.

### Technology

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Vercel Serverless Functions | Free tier, zero ops |
| HTML storage | Vercel Blob | Free tier (500 MB), prefix-list API |
| Metadata storage | Vercel KV (Upstash Redis) | Free tier, atomic operations for slug ownership |
| Email | Resend | Already planned for Sail Scoring full-stack; free tier (3,000/month) |
| Language | TypeScript | Consistent with Sail Scoring main app |

### Upload Protocol

The Sail Scoring application is configured at build time with two values:

```
NEXT_PUBLIC_BILGE_URL=https://bilge.vercel.app
NEXT_PUBLIC_BILGE_API_KEY=<shared key>
```

These are the only things the main application needs to know about bilge.
The upload payload format is the contract between the two; it should be treated
as stable for the MVP period but is not a long-term API commitment.

**Upload endpoint: `POST /upload`**

```json
{
  "api_key": "<shared key>",
  "uuid":    "550e8400-e29b-41d4-a716-446655440000",
  "slug":    "hyc/autumn-league-2026-standings",
  "email":   "scorer@example.com",
  "html":    "<html>...</html>"
}
```

| Field | Notes |
|-------|-------|
| `api_key` | Shared key baked into the app at build time |
| `uuid` | A UUID generated once per series; identifies the publishing entity. One UUID may be used with multiple slugs (e.g. one per race file, one for overall standings). Stored in the series data — see below. |
| `slug` | Human-readable URL path (`[a-z0-9-/]`, max 80 chars). Becomes the public URL. Each slug is owned by the first UUID that verifies it and cannot be reassigned. |
| `email` | Scorer's email. Required on first upload from a UUID. Stored against the UUID; omitted or must match on subsequent uploads. |
| `html` | Full results HTML. Max 512 KB. |

**Responses:**

| Case | HTTP | Body |
|------|------|------|
| New UUID — pending verification | 202 | `{"status":"pending","message":"Verification email sent to scorer@example.com"}` |
| Known UUID, already verified — published immediately | 200 | `{"status":"published","url":"https://bilge.vercel.app/r/hyc/autumn-league-2026-standings"}` |
| UUID already used, slug claimed by a different UUID | 409 | `{"error":"slug_conflict"}` |
| HTML exceeds 512 KB | 413 | `{"error":"too_large"}` |
| Invalid or missing API key | 401 | `{"error":"unauthorized"}` |

### Email verification and publication lifecycle

Verification is per-UUID, not per-slug. A UUID is verified once — on its first
upload — and all subsequent uploads with that UUID (to any slug) go live
immediately without re-verification.

```
First upload (new UUID)
        │
        ▼
  [pending state]
  HTML stored in blob
  Verification email sent to scorer
        │
        ├── 10 minutes pass without clicking ──► pending upload deleted
        │
        └── Scorer clicks link (GET /verify?token=...) ──► [UUID verified]
                                                           HTML goes live at /r/{slug}
                                                                 │
                                                                 ▼
                                                     Subsequent uploads
                                                     with same UUID
                                                     (any slug) go live
                                                     immediately
```

Only the pending HTML for the unverified upload is deleted at the 10-minute
mark. A verified UUID retains its published results indefinitely (subject to
Vercel Blob retention).

### Public endpoints

**`GET /r/{slug}`** — serves the published HTML for the given slug. Returns
404 if the slug is unverified or does not exist.

**`GET /l/{prefix}`** — generates an HTML listing page of all verified slugs
that begin with `{prefix}`. For example, `/l/hyc/` lists every result
published under the `hyc/` namespace. Implemented using Vercel Blob's native
prefix-filter list API — no additional index to maintain. Useful when a scorer
publishes multiple files for a series and wants to share a single link with
sailors.

### UUID storage in Sail Scoring

The `uuid` field is generated by the Sail Scoring app the first time a series
is published. It is stored in the series data in IndexedDB and included in the
JSON export, alongside the slugs already published and their public URLs:

```json
{
  "publishing": {
    "service": "https://bilge.vercel.app",
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "pages": [
      {
        "slug": "hyc/autumn-league-2026-standings",
        "url":  "https://bilge.vercel.app/r/hyc/autumn-league-2026-standings"
      },
      {
        "slug": "hyc/autumn-league-2026-race3",
        "url":  "https://bilge.vercel.app/r/hyc/autumn-league-2026-race3"
      }
    ]
  }
}
```

The `service` field is stored so that a future migration tool can identify
which uploads came from bilge and move them to the full-stack system.

### Security model

bilge uses security-by-small-blast-radius, not security-by-secrecy.

**What provides some protection:**
- The API key prevents arbitrary HTTP clients from uploading without the app.
  A holder of the key can upload HTML to any unclaimed slug and trigger
  verification emails to any address they control. They cannot take over a
  slug already owned by another UUID.
- Email verification is the meaningful access gate — content is not public
  without inbox access to the registered address.
- UUID-prefixed blob keys mean public result pages are not enumerable without
  knowing a slug. There is no global listing endpoint.
- Pending uploads are deleted after 10 minutes — no persistent storage
  without email confirmation.
- HTML size limit (512 KB) prevents storage abuse.
- Rate limiting on `/upload` per IP (e.g. 10 requests/minute).

**What is not protected, and why it is acceptable:**
- The shared API key is in the app bundle and is trivially extractable with
  browser devtools. This is inherent to any client-side app with a shared
  secret. It is acceptable because the stored content is public sailing
  results — there is nothing confidential to extract and nothing damaging to
  do with write access beyond slug squatting.
- HTML uploaded by any client is served verbatim — bilge does not sanitise
  content. This is acceptable because the results pages are generated by the
  Sail Scoring app itself, not by arbitrary user input.

## Consequences

### Positive

- Results are publicly shareable from MVP day one with a clean URL
- Zero friction for return uploads once a UUID is verified — no re-verification,
  one click to update
- Prefix listing (`/l/hyc/`) gives clubs a single shareable URL for all their
  results without the app needing to generate or upload an index page
- No coupling to the main Sail Scoring server (which does not exist yet)
- Free to operate within expected MVP usage volumes
- The funny name and this ADR together make the temporary nature unambiguous
  to future maintainers

### Negative

- A second repository and Vercel project to create and maintain
- Resend account needed before the main app requires email
- No slug recovery mechanism — if the verified email address is lost, the
  slug is permanently locked to that UUID
- No way to delete or unpublish a result page short of direct Vercel Blob
  access by the operator

### Risks

- **Slug squatting:** Any app user with the API key can claim an unclaimed slug.
  Mitigation: not worth defending against for MVP; conflicts are resolved by
  contacting the operator.
- **bilge outliving its welcome:** If the full-stack migration is delayed,
  bilge could accumulate real users who treat it as permanent infrastructure.
  Mitigation: README and in-app UI must clearly state the temporary nature;
  this ADR documents the intended retirement trigger.
- **Vercel free tier limits:** Blob free tier is 500 MB storage / 1 GB egress.
  At ≤512 KB per file, this supports thousands of published results before
  hitting limits. Mitigation: monitor usage; Vercel paid tier is inexpensive
  if needed.

### Retirement trigger

bilge is retired when Sail Scoring ships its full-stack version. At that point:
1. A migration script reads `publishing.uuid` and `publishing.pages` from each
   series JSON export and re-uploads the content to the new server.
2. The `publishing.service` field distinguishes bilge uploads from any future
   publishing backend.
3. bilge is taken offline and the Vercel project deleted.

Note: **the bilge pump** (`scripts/pump.ts`) is the integration test suite for
the bilge endpoints — not the migration script. The migration script does not
yet exist.

## Related Decisions

- [ADR-003: Application Architecture](003-application-architecture.md) —
  bilge exists because ADR-003 chose a local-first MVP with no server.
  The transition plan in ADR-003 is the retirement trigger for bilge.

## References

- [Vercel Blob documentation](https://vercel.com/docs/storage/vercel-blob)
- [Vercel KV documentation](https://vercel.com/docs/storage/vercel-kv)
- [Resend documentation](https://resend.com/docs)
- Sailwave — a comparable desktop application with a similar results-publishing
  mechanism; examined as prior art during design of this ADR
