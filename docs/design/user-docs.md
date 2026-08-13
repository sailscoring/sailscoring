# User Documentation Approach

## Rationale

User documentation is a first-class deliverable: a race scorer encountering
the app for the first time should not need to figure it out from scratch, and
any feature worth shipping is worth explaining. Docs live in-app so they
deploy with the app and can never fall out of date with the running version.

## How Docs Are Read

Two surfaces over one set of chapters:

- **The help panel** is the primary way help is read. It opens beside the
  working screen from the header's Help control or the `h` key, and minimises
  off-canvas without unmounting, so the reader's chapter, section and scroll
  position survive the round trip. Its index pins the section covering the
  current route (`helpSectionForPath`), and links between help sections move
  the panel rather than navigating the app. It is deliberately absent on
  `/help` itself, where a second copy would duplicate every section id.
- **The `/help` routes** remain the shareable, linkable, printable form, and
  the panel's "Open as a page" leads to them.

Both render the same components: chapter bodies live in `app/help/content/`,
marked `'use client'` and gating on the `FeaturesProvider` context. The routes
re-provide the server-computed feature set so their TOC and sections can never
disagree; the panel loads chapters on demand through `content/index.ts`, which
keeps the chapter JSX out of every page's bundle.

## Where Docs Live

User documentation is served in-app at `/help` (`app.sailscoring.ie/help`):

- **`/help`** — the landing page: what Sail Scoring is, signing in and
  workspaces, and an index of every chapter's sections.
- **`/help/<chapter>`** — one page per feature group, sharing the grouping
  and slugs of `docs/design/feature-inventory.md` and the marketing site's
  `/features` page, so all three surfaces navigate the same map
  (`/help/running-a-series`, `/help/entering-results`, …).

This replaced the original single-page help in August 2026, when it passed
2,400 lines across ~40 sections.

### The manifest

`app/help/sections.ts` is the single source for the structure: every section,
its chapter, its TOC title, and the feature gate (if any) that hides it. The
landing index, each chapter's TOC, and the legacy-anchor redirect all render
from it. Rules:

- **Section ids are shareable URLs — never rename one.** Old
  `/help#<section>` links forward to the section's chapter via
  `app/help/hash-redirect.tsx`; ids that move chapters keep working because
  the redirect looks the chapter up per id.
- **Gated sections** carry their feature key in the manifest and render only
  for viewers whose workspace has the feature (`getEffectiveFeatures`, #155).
  `FEATURES.helpSectionIds` records the same relationship on the registry
  side.

## Screenshots

Help sections embed the same captures the marketing site uses, produced by
`scripts/feature-shots.ts` (see `docs/design/feature-inventory.md`). The rig
writes a lighter WebP set into `public/help/shots/`; sections render them via
the `HelpShot` component with instructional captions. When a feature's UI
changes, re-run the rig and both surfaces update together.

## Tooling

Help pages are plain React server components styled with the same
Tailwind/shadcn stack as the app. **MDX** remains the upgrade path if
prose-heavy editing ever becomes painful — it has not so far, and plain TSX
keeps the feature gating straightforward.

## Style

- **Workflow-oriented** — "how do I do X", not "here is what button Y does"
- **Written for a non-technical scorer** who may be the only person at their
  club who does this job
- **Screenshots where they teach**, prose where it's clearer; captions
  instruct rather than sell

## Keeping Docs Current

Convention: **when a feature ships, its help text ships with it** — same
commit. New sections are added to the manifest and their chapter page
together; the index, TOC, and redirects follow automatically. The full
checklist for a feature (inventory row, help section, marketing entry) is in
`docs/design/feature-inventory.md`.
