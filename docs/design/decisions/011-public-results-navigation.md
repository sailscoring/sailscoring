# ADR-011: Public results navigation and the publication tree

**Status:** Accepted — implementation tracked in #320

**Date:** 2026-07-28

**Deciders:** Mark McLoughlin

## Context

The public results surface has one URL grammar —
`/p/{workspace}/{seriesSlug}/{subPath}` — and, as of #320, two navigation
models layered over it that don't share a data model:

- a **path tree**: server-rendered index pages at `/p/{ws}` and
  `/p/{ws}/{slug}`, breadcrumbs on fleet pages, a fleet switcher between
  sibling pages of one publication;
- a **dimension picker**: the #320 quick-jump cascade (Year → Category →
  Series → Fleet), a client-side enhancement that exists only on the
  workspace index and disappears the moment a viewer drills in.

The seams show. "Go to fleet" is wrong when the leaf is a combined page, a
prize sheet, or a whole event. The picker's "Series" level lists
`published_series` contributors by name, which means a different kind of
thing per workspace. Interior URLs implied by every published path
(`/p/hyc/2025/autumn-league`) resolve to nothing. And a viewer who arrives
on a fleet page meets a third navigation style (breadcrumb + switcher)
unrelated to the picker they left behind.

The deeper cause is a gap between the model and converged practice. The
model thinks the middle of the URL is a *series* slug with an opaque
sub-path beneath it. In production, nobody uses it that way. All four
archive corpora (ADR-010) independently converged on the same shape:

| Workspace | Top slug | Beneath it | Example |
|---|---|---|---|
| HYC | year | `{event}/{class}` | `/p/hyc/2023/tuesday-mini-series/puppeteers` |
| DBSC | year | `{sub-series}/{class}` | `/p/dbsc/2024/thursday-overall/cruisers-2-irc` |
| IODAI | year | `{event}/{fleet}` | `/p/iodai/2019/leinsters/senior` |
| KSC | year | `{event}[/{fleet}]` | `/p/ksc/2024/gp14-munsters/gold-fleet` |

IODAI actively reworked from event slugs (`2009-leinsters`) to year slugs
in July 2026 to get this shape. The only live counter-example encodes the
year *inside* the slug (`/p/m15/2026-westerns`). The de facto grammar is a
tree — `workspace → season → event-or-sub-series → page` — that the model
doesn't acknowledge, so its upper levels exist only as URL convention, the
picker's embedded JSON, and listing-page grouping code.

Two more attributes are being bent to fake the missing levels:

- **Year** is derived from `series.start_date`. It breaks for seasons that
  span a year boundary (a Southern-Hemisphere or winter season is
  "2025–26", not 2025 or 2026), and it drives a "Past results" partition
  that presents archived publications by year while active ones group by
  category — two unrelated partitions of one listing.
- **Category** means open/club for HYC but is set to the bare year by the
  other three corpora, purely as filing — a hack that exists because the
  season level has nowhere else to live.

## Decision Drivers

- **URL stability.** ADR-010 makes zero breakage of announced URLs a hard
  requirement; slugs are pinned data in the archive repos. Any redesign
  that moves a published URL is disqualified.
- **Few selections, sibling switching.** The #320 scorer feedback: a
  couple of quick selections reach any table; the sibling (another class
  in the event, the same series last season) is one control away.
- **One navigation affordance everywhere.** The same controls at every
  level, including leaf pages — not picker-at-top, tree-below,
  switcher-at-leaf.
- **One structure for every workspace shape.** Clubs (season → day-group →
  series → class), class associations (season → event → fleet), open-event
  sites (year → open/club → event → class), and non-calendar-year seasons.
- **Degenerate collapse.** A two-series club must see almost no chrome;
  levels with one value don't render.
- **Static discipline.** Public pages stay server-rendered HTML with ETag
  caching and no framework (the #162 settlement); navigation must not pull
  a client framework onto them.
- **Model follows practice.** Four corpus emitters written independently
  converged on the same tree; the model should ratify it, not fight it.

## Considered Options

### Option 1: Polish the current course

Keep the model. Inject the #320 picker on every public page (the fleet
switcher's serve-time injection generalises), fix the "Go to fleet"
wording, tune labels.

**Pros:**
- Cheap; no schema change, no new concepts.
- Fixes the most visible complaint (dropdowns vanishing on drill-in).

**Cons:**
- The picker's "Series" level keeps meaning a different thing per
  workspace, because the navigation unit viewers want is the tree node and
  "series" only coincidentally aligns with it.
- Interior URLs still 404; the event level stays unaddressable.
- The category-vs-"Past results" split and the `category = year` hack
  persist; seasons stay derived from dates.
- Every page ships the whole workspace's page list as picker JSON.

### Option 2: The publication tree (chosen)

Ratify the converged grammar. Reinterpret `/p/{ws}/{a}/{b}/{c}` as a tree
of **folders** — workspace → top-level folder (usually a season) →
interior folders (event, sub-series) → pages — and make the folders real:
labels, ordering, index pages, and one navigation cascade rendered from
the tree on every public page. Seasons become first-class and
workspace-defined; category becomes a facet on the tree, not a level.

**Pros:**
- Every announced URL survives byte-for-byte; the grammar is unchanged,
  only its interpretation grows.
- Interior index pages are additive (paths that 404 today start
  resolving).
- One navigation component subsumes the picker, the breadcrumb, and the
  fleet switcher; the two navigation styles merge because the dropdowns
  *are* the tree.
- "Multiple series share a slug" becomes the obviously sane "multiple
  series publish pages into the same folder"; the shared-slug listing
  placement fudge (one row per slug, placed by its newest contributor)
  dissolves because placement hangs on the folder.
- Seasons as labels fix the year-boundary problem and retire the
  `category = year` filing hack.

**Cons:**
- A new table and a metadata backfill for existing corpora (labels for
  ~250 distinct folder segments; titleised slugs as fallback).
- The publish dialog, CLI, archive-kit format, and docs all need a
  vocabulary shift from "series slug" to "folder".
- More index pages to render and ETag correctly.

### Option 3: Full faceted navigation

Drop the tree. Tag every page (season, category, event, class) and make
the public surface a filter UI throughout, with flat pinned URLs.

**Pros:**
- Maximally flexible; no hierarchy arguments ever again.
- Cross-cutting queries ("every Squib page") fall out for free.

**Cons:**
- Abandons URL-as-location; a shared link no longer implies a browsable
  neighbourhood.
- Demands much more client-side machinery on deliberately static pages.
- Matches neither comparator scorers actually cited (HalSail and the HYC
  site are both trees browsed via dropdowns); #320 already declined
  drill-down-by-query for good reasons.

A fourth shape — generating static index pages per node at publish time —
was already tried and rejected in #162 (Vercel Blob's overwrite
propagation window makes freshly-published results stale); nothing has
changed there, and this ADR keeps the always-fresh dynamic read path.

## Decision

> **Revised 2026-07-29**, after browsing the deployed first cut against the
> HYC corpus. The original cut kept seasons as a display grouping over slug
> *cards*, which collapsed into empty nesting for the archive shape (a season
> section wrapping one card named after the season). The revision goes where
> the ADR pointed and further, enabled by a new **static redirect table**
> (`published_redirects`, operator-maintained via `pnpm redirects`, no UI)
> that makes any future URL move a managed 301 rather than breakage:
>
> - **Seasons are tree nodes, workspace-wide.** `/p/{ws}/{season}` resolves
>   for every season — the slug's own index where a slug *is* the season (the
>   archive shape, URLs unchanged), a synthesized season index otherwise — and
>   the cascade's levels are uniformly **Season / Event / Page**, with legacy
>   per-event slugs sitting at the event level of their season. A
>   `workspace_seasons` table holds what derivation can't: pre-defined
>   seasons and the explicit **current** one.
> - **The workspace index lists events, not slugs.** A season's own slug
>   explodes into one row per event, each linking its pages directly; every
>   season is collapsible with the current one open.
> - **No control navigates on `change`.** The cascade's levels are
>   details/summary menus of links (a navigating select fires while
>   traversing options with arrow keys or a scroll wheel); the quick-jump
>   picker is pure filters — Season / Category / Event, cascading population,
>   no page select — and the rows' links do the navigating.
> - **The publish dialog composes Season + Folder, and nothing else.** The
>   custom-slug shape is gone from the UI (the API keeps it for the CLI);
>   an undated series defaults to the current year. A single-fleet series'
>   standings page sits at `folder/standings`, laid out symmetrically with
>   its prizes sibling; a block series' folder becomes its own top-level
>   slug (its `{block}/{page}` paths use both segments), filed under the
>   season by a folder season pin. First publish pins the folder's label to
>   the series name (reset to the humanised segment once a second series
>   joins), and publishing into a season slug joins without the merge
>   confirmation. A workspace-settings Seasons card manages seasons and
>   adopts year-named categories as season pins.

Adopt the **publication tree**. The sub-decisions:

1. **Grammar reinterpretation, not migration.** The URL space is
   unchanged: `/p/{ws}/{segments...}`. What was "series slug" is the
   **top-level folder**; what was a one- or two-segment sub-path is one or
   two more tree levels, the last being the **page**. Every prefix of a
   published path becomes a resolvable index page: `/p/hyc/2025` (the
   season), `/p/hyc/2025/autumn-league` (the event — a 404 today). No
   existing URL changes meaning; freezing rules for published paths are
   untouched.

2. **Folder metadata.** A small table (per workspace: path, label, kind,
   display order, optional category) gives interior and top-level nodes a
   name and an ordering. It is metadata *over* paths that already exist —
   `published_series`, its `pages`, and the blobs are untouched. Where no
   row exists, the label is the titleised slug, so the tree works with an
   empty table. Archive ingest upserts folder labels from the config
   (event names are already there) the same way it files categories today;
   the in-app publish flow creates folder rows as paths are first used.

3. **Seasons are first-class and workspace-defined.** A workspace carries
   an ordered list of seasons (label + sort key — "2025", "2025–26").
   Each top-level folder is assigned to a season; the default is derived
   from contributing series' start dates, and the assignment is editable.
   The derived-year axis and the public "Past results" partition retire in
   favour of season grouping (the in-app `archived` flag remains as an
   authoring/management state, unchanged). The three corpora using
   `category = year` drop the hack; their categories go back to meaning
   nothing until they have something real to say.

4. **Category is a facet, not a tree level.** It stays the existing
   workspace-defined attribute, surfaced on folders (a folder shows its
   contributing series' category; folder metadata can override), rendered
   as a cascade dropdown only when a workspace actually uses ≥2
   categories, and **never a URL segment** — URL stability rules out
   splicing `open`/`club` into HYC's announced paths, and day-group
   categories cut across seasons rather than nesting inside them.

5. **One cascade, every page.** A server-rendered row of selects —
   Season / Category (when non-degenerate) / Folder / Page — appears on
   every public page with the current position selected; changing any
   select navigates. Options for a select are the current node's siblings,
   so the payload is a few dozen options, not the workspace's whole page
   list. The breadcrumb becomes the text rendering of the same tree data;
   the #320 fleet switcher becomes the cascade's last select; the #320
   workspace-index picker is superseded by the same component in its
   root-level form. Wording follows the node: "Go to results", never "Go
   to fleet".

6. **Workspace index: current season expanded.** `/p/{ws}` shows the
   current season's tree expanded (grouped by category where one exists),
   with prior seasons as collapsed season links. The current season is the
   workspace's newest by sort key, with a manual override for the
   handover weeks around season end.

7. **Publishing UX reframes to folders.** The publish dialog reads
   "Publish under: `[2026 ▾] / [lambay-races]`" with the same live URL
   preview; joining an occupied slug becomes the unremarkable "publish
   into this folder" (the explicit-join confirmation stays, as does every
   collision check). The CLI's `--publish-slug`/`--subpath` keep working
   with docs recast in folder terms. Code-level renames follow the same
   staged path rather than a big-bang sweep.

Implementation stages, each independently shippable: (1) the cascade on
every page plus wording fixes — read-path only; (2) interior index pages
with titleised labels; (3) folder metadata + seasons + the workspace-index
rework, and the archive emitters drop `category = year`; (4) publish
dialog/CLI/vocabulary reframing.

## Consequences

### Positive

- One navigation model at every level; the picker/tree/switcher style
  clash disappears.
- Every level of every announced URL is addressable and linkable — an
  event page can be cited, embedded, or bookmarked.
- Seasons work for any hemisphere and any season boundary, and the
  category machinery returns to meaning something.
- The model matches what all four corpus emitters already publish, so the
  archive repos need only additive config (labels, season declarations).
- Small workspaces see less chrome than today: one season, no categories,
  one folder → the cascade collapses to Page, or to nothing.

### Negative

- A new table, new index routes, and a labelling backfill for ~250
  existing folder segments (bounded: titleised slugs are an acceptable
  floor, and archive configs already carry event names).
- Vocabulary churn: "series slug" appears throughout the publish dialog,
  CLI docs, and code; the reframing is staged but real.
- The #320 picker and its tests, landed a week ago, are superseded by the
  cascade (the fleet switcher survives as its last select; the picker's
  cascade logic and e2e coverage carry over in spirit).

### Risks

- **Season assignment ambiguity.** A folder whose contributing series
  straddle a season boundary lands somewhere surprising. Mitigated:
  assignment is editable metadata, and the default (earliest start date)
  is only a default.
- **ETag discipline on interior pages.** Each new index page must fold the
  folder metadata and its children's page sets into its ETag or serve
  stale navigation. Mitigated by reusing the existing contentHash
  composition pattern from the workspace and series indexes.
- **Scope creep toward vanity URLs.** Folders invite "can I rename this
  path". Renaming published paths stays out of scope — paths are frozen,
  labels are editable; vanity URLs remain deferred (horizon).
- **Two sources of truth for labels.** Folder metadata vs. series names
  could drift. The rule: the tree renders folder labels; series names are
  page titles. Where a folder has one contributing series and no explicit
  label, the series name is the derived label.

## Related Decisions

- [ADR-008](008-full-stack-transition.md): revises the "Publishing model"
  revision block's navigation surface (`/p/{ws}` index, series listing
  pages); the URL grammar, slug freezing, and orphaning rules stand.
- [ADR-010](010-as-published-archives.md): unchanged in substance; pinned
  slugs/sub-paths become pinned tree paths, and the ingest config
  additionally carries folder labels and a season.
- [ADR-004](004-results-publishing.md): superseded (historical); its
  prefix-listing instinct — one shareable URL above the individual pages —
  is what interior index pages finally deliver properly.
- [ADR-006](006-testing-and-debug-logging.md): the cascade and index pages
  are covered by unit tests over the pure renderers plus e2e over the
  public routes, as today.

## References

- #320 — the dropdown-navigation scorer feedback and the picker/fleet
  switcher this ADR subsumes.
- #152 / #162 / #164 — in-app publishing, the always-fresh read path, and
  the management surface.
- #292 — the management listing that shares the public partition code and
  will follow the season/tree grouping.
- #154 — categories and manual archive; #203 — sub-series pages (the
  two-segment paths that become interior folders); #255 — publishing
  groups (combined pages remain leaf pages).
- Archive repos: `hyc-archive`, `dbsc-archive`, `iodai-archive`,
  `ksc-archive` — the four independent emitters whose converged URL shape
  this ADR ratifies.
