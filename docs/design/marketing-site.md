# Marketing Site: sailscoring.ie

## Overview

`sailscoring.ie` is the public face of the Sail Scoring project. It explains what the
product is, who it is for, and how to get started. It is not the application. The
application lives at `app.sailscoring.ie` (see ADR-005).

The site should establish credibility early — long before the product is widely released.
Scorers are exacting people; the site should feel like it was made by people who take
their craft seriously.

## Technology

**Next.js (App Router), statically exported, deployed on Vercel.**

The marketing site lives in a separate repository — `github.com/sailscoring/sailscoring.ie`
— so that changes to the public website do not touch the application codebase and vice
versa.

### Why static export over a full server deployment?

- All content is static HTML; no server-side logic is needed.
- Static export (`output: 'export'`) means zero cold-start latency and trivial CDN
  distribution via Vercel Edge.
- The build artefact can be served from any static host if Vercel ever changes.

### Why Next.js rather than a dedicated static site generator?

The same stack the application uses (Next.js, Tailwind CSS v4, TypeScript) means no new
toolchain to maintain, no context-switching between templating languages, and easy
reuse of any shared UI tokens or components if that becomes useful later. Astro would
also be a reasonable choice, but introduces a second framework and build pipeline for
marginal gain.

## Site Structure

| Path | Page | Purpose |
|------|------|---------|
| `/` | Home | Hero, feature highlights, call to action linking to `app.sailscoring.ie` |
| `/about` | About | What Sail Scoring is, why it was built, who is behind it |
| `/contact` | Contact | Contact email; no backend form (KISS) |
| `/results` | Sample results | One or two published results sheets embedded from bilge, demonstrating the end product |
| `/legal/terms` | Terms of Service | — |
| `/legal/privacy` | Privacy Policy | — |
| `/legal/cookies` | Cookie Policy | Minimal: no analytics, no tracking cookies during stealth beta |
| `/legal/acceptable-use` | Acceptable Use Policy | — |

Legal pages should be reviewed by a solicitor before any public-facing usage beyond
stealth beta.

## Design Direction

The goal is **clean, content-first, credible** — not a sailing cliché. No stock photos
of boats with generic overlaid text. No gratuitous nautical metaphors. The site should
look like it was made in 2026, not 2009.

Reference: [TournaChess](https://tournachess.com/) — a chess club management platform
with a similar audience profile (serious hobby-sport administrators). Its design language
is worth studying: constrained palette, generous whitespace, clear typographic hierarchy,
features described concisely in plain language.

### Key principles

- **Restrained palette.** A single strong accent colour, neutral backgrounds. Ink on paper.
- **Typography does the work.** Large, confident headline. Body copy that explains the
  product plainly. No fluff.
- **Feature highlights without a feature list.** Three or four short callouts
  (accessible, correct, open, sustainable) that frame the project's values — not a
  bullet-pointed changelog.
- **Single prominent CTA.** "Open the app" or equivalent, linking to `app.sailscoring.ie`.
  This is the only conversion goal for the foreseeable future.
- **No dark mode toggle.** Not needed for a mostly-static marketing site at this stage.
- **No cookies banner.** If no analytics or tracking are present, no banner is needed.
  That is the intended state during stealth beta.

### Colour and type palette (proposed, not final)

- Background: off-white (`#f9f9f7`) — softer than pure white, suggests print
- Foreground: near-black (`#111111`)
- Accent: deep navy (`#1a3a5c`) — nautically honest without being kitschy
- Typeface: [Geist](https://vercel.com/font) (already bundled with Next.js on Vercel)
  or [Inter](https://rsms.me/inter/) — both are geometric sans-serifs that read cleanly
  at both heading and body sizes.

## Home Page Layout

```
┌─────────────────────────────────────────────────┐
│  SAILSCORING.IE          [Open the app →]        │  ← nav, minimal
├─────────────────────────────────────────────────┤
│                                                 │
│  Race scoring that                              │
│  anyone can use.                                │  ← hero headline
│                                                 │
│  Sail Scoring is a web-based scoring tool       │
│  for Irish yacht clubs and class associations.  │  ← hero subhead
│                                                 │
│  [Get started →]                                │
│                                                 │
├─────────────────────────────────────────────────┤
│  Accessible   Correct    Open     Sustainable   │  ← 4 value props
│  ...          ...        ...      ...           │
├─────────────────────────────────────────────────┤
│  Published results                              │
│  [embedded sample standings sheet]             │  ← social proof
├─────────────────────────────────────────────────┤
│  Built by Mark McLoughlin  ·  Contact  ·  Legal │  ← footer
└─────────────────────────────────────────────────┘
```

## Relationship to the Application

The marketing site and the application are deliberately separate deployments:

- `sailscoring.ie` — static, informational; can be updated without touching app code
- `app.sailscoring.ie` — the Next.js application; user data lives here

The only coupling is navigational: the marketing site links to the app; the app may
eventually have a small "Back to sailscoring.ie" link in its footer. No shared
authentication, no shared data.

## Hosting

Separate Vercel project (`sailscoring-ie` or similar), connected to the
`sailscoring/sailscoring.ie` GitHub repository. Custom domain `sailscoring.ie` pointed
at Vercel via apex-domain DNS configuration (per ADR-005).

## Launch Criteria

The site should be live before the stealth beta begins. Minimum viable means: Home,
About, and Contact. The sample results page and the CTA to the app can follow once
bilge is live.
