# ADR-005: Hosting and Domain Structure

**Status:** Accepted

**Date:** 2026-03-22

**Deciders:** Mark McLoughlin

## Context

The Sail Scoring project needs a public domain and a clear mapping between
subdomains and the services that make up the system. Three distinct surfaces
need URLs:

1. A marketing and information site explaining the product
2. The Sail Scoring application itself (local-first web app, ADR-003)
3. The bilge results-publishing API (ADR-004)

ADR-004 used `bilge.vercel.app` as a placeholder URL for bilge. This ADR
establishes the canonical domain structure and supersedes that placeholder.

## Decision

The registered domain is **`sailscoring.ie`**, matching the project name.

| Subdomain | Purpose |
|-----------|---------|
| `sailscoring.ie` | Marketing and information site — explains the product, not the product itself |
| `app.sailscoring.ie` | The Sail Scoring application |
| `bilge.sailscoring.ie` | The bilge results-publishing API (ADR-004) |

**`sailscoring.ie`** (apex) is the public face of the project: what it is,
who it's for, how to get started. It is not the application.

**`app.sailscoring.ie`** is the application. The `app.` prefix is
conventional and unambiguous — scorers who bookmark it know exactly what they
have bookmarked.

**`bilge.sailscoring.ie`** hosts the bilge serverless API (ADR-004). Keeping
bilge under the `sailscoring.ie` domain rather than `bilge.vercel.app` means:
- Published result URLs are stable even if the underlying Vercel project is
  renamed or migrated
- The domain is controlled by the project, not by a third-party platform
- The subdomain name communicates the service's identity without requiring
  knowledge of the Vercel project name

The Vercel project for bilge is configured with `bilge.sailscoring.ie` as a
custom domain. DNS is a CNAME to Vercel's edge network.

### Impact on ADR-004

ADR-004 used `bilge.vercel.app` as the bilge URL in its examples. The
canonical URL is now `https://bilge.sailscoring.ie`. The build-time
environment variable is:

```
NEXT_PUBLIC_BILGE_URL=https://bilge.sailscoring.ie
```

Published result URLs take the form:

```
https://bilge.sailscoring.ie/r/hyc/autumn-league-2026-standings
```

All other details in ADR-004 are unchanged.

## Considered Options

### `app.sailscoring.ie`

Conventional, unambiguous. Immediately legible to any web user. Chosen.

### `helm.sailscoring.ie`

Nautically correct — the helm is where you steer from. Distinctive and fits
the project's tone. Declined in favour of the more conventional `app.` prefix;
`helm` is better reserved for a future CLI tool or operator-facing service if
one emerges.

### `score.sailscoring.ie`

Names the function directly. Minor redundancy with "sailscoring" in the
domain. Not chosen — `app.` is clearer about what kind of thing it is (a web
application you use, not a scoring endpoint).

## Consequences

### Positive

- All public URLs are under project-controlled DNS — no dependency on
  third-party platform naming
- `sailscoring.ie` is free to evolve as a marketing site without affecting
  the application URL
- `app.` and `bilge.` are self-describing; no documentation needed to explain
  what each subdomain does
- Custom domain on bilge means the Vercel project can be restructured without
  breaking published result URLs

### Negative

- DNS configuration required before either service can go live
- Custom domain on Vercel requires domain verification (TXT/CNAME record)

### Risks

- **Domain renewal:** `sailscoring.ie` must be renewed annually. Lapse would
  take down all services. Mitigation: enable auto-renewal; note in ops runbook.

## Related Decisions

- [ADR-003: Application Architecture](003-application-architecture.md) —
  establishes the local-first MVP; `app.sailscoring.ie` is where that app is
  served
- [ADR-004: Results Publishing — bilge](004-results-publishing.md) —
  `bilge.sailscoring.ie` is the canonical URL for the bilge API; this ADR
  supersedes the `bilge.vercel.app` placeholder used in ADR-004
