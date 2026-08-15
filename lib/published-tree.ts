/**
 * The publication tree behind the public `/p/...` navigation (ADR-011).
 *
 * A workspace's publications form a tree: top-level folders (the published
 * slugs — usually seasons, per the converged archive shape), interior folders
 * (the first segment of two-segment sub-paths — events or sub-series), and
 * pages at the leaves. Nothing here is stored: the tree is derived from the
 * `(slug, subPath)` data every publication already carries, so every announced
 * URL keeps its meaning and folders exist wherever pages imply them.
 *
 * One navigation cascade renders from this tree on every public page — a row
 * of selects marking the current position at each level, siblings as options,
 * changing a select navigates. The leaf level (sibling pages) renders as
 * inline links when there are few, a select beyond that — absorbing the fleet
 * switcher this cascade replaces. The fragment is injected into served fleet
 * pages at serve time (blobs stay byte-identical to the published artifact)
 * and embedded directly by the index-page renderers.
 */

import { escapeHtml as esc } from './html';
import { humanizeSlug } from './publishing';
import { renderPublicHero, renderPublicShell } from './published-shell';
import { loneResultsPageLabel, type SeriesIndexPage } from './published-index';

/** A page in a slug group, with its contributing series named so labels can
 *  distinguish same-named pages from different series on a shared slug. */
export interface TreePage extends SeriesIndexPage {
  /** The contributing series' name; null/absent for an orphaned publication. */
  ownerName?: string | null;
  /** True when the owning publication has exactly one non-prizes page — the
   *  page is that publication's standings, whatever its fleet is called
   *  (possibly the synthetic "Default"/"Unknown" single-fleet name). */
  ownerSingle?: boolean;
}

/** A top-level folder (published slug) as offered by the cascade's first
 *  select. `label` follows the listing rule: the sole contributor's series
 *  name, or the humanised slug when several series share it. */
export interface TopFolder {
  slug: string;
  label: string;
}

/** One cascade level: the current position's siblings, in display order.
 *  `placeholder` renders as an inert first option when no option is current —
 *  the trailing "jump down a level" select on an index page. */
export interface NavLevel {
  aria: string;
  options: { label: string; href: string; current?: boolean }[];
  placeholder?: string;
}

/** The interior-folder segment of a sub-path (`autumn-league` from
 *  `autumn-league/class-1`), or null for a root-level page. */
export function folderSegmentOf(subPath: string): string | null {
  const at = subPath.indexOf('/');
  return at === -1 ? null : subPath.slice(0, at);
}

/** The one interior folder every given sub-path lives in, or null when they
 *  span folders (a block series' per-block segments) or include root pages.
 *  Decides where a publication's breadcrumb climbs to: its event folder when
 *  it has exactly one, its slug otherwise. */
export function sharedFolderSegment(subPaths: string[]): string | null {
  const segments = new Set(subPaths.map(folderSegmentOf));
  if (segments.size !== 1) return null;
  return [...segments][0];
}

/**
 * Where a publication's own index lives — the target for a link that names
 * *that event*, such as a competitor timeline's rows.
 *
 * The bare slug is the event's address only while the publication has the slug
 * to itself (the default first-publish slug, `kebab(series name)`). A slug is a
 * shared namespace, and where several publications occupy one — the converged
 * archive shape files a whole season under `{year}/{event}/{class}` — the slug
 * index lists every event in it, so a link there says "somewhere in 2024"
 * rather than naming the event. Then the path descends to what the publication
 * actually owns: its interior folder when its pages share one, or its lone
 * root-level page. A publication whose pages span folders (a block series) owns
 * no single address below the slug, so the slug listing stays the landing.
 * Prize sheets don't get a say — a prizes page beside the results shouldn't
 * decide where the event's link lands.
 */
export function publicationPath(
  slug: string,
  pages: SeriesIndexPage[],
  slugShared: boolean,
): string {
  if (!slugShared) return slug;
  const results = pages.filter((p) => !p.isPrizes);
  const considered = results.length > 0 ? results : pages;
  if (considered.length === 0) return slug;
  const folder = sharedFolderSegment(considered.map((p) => p.subPath));
  if (folder) return `${slug}/${folder}`;
  if (considered.length === 1) return `${slug}/${considered[0].subPath}`;
  return slug;
}

/** An interior folder implied by the slug's pages. */
export interface TreeFolder {
  segment: string;
  label: string;
}

/**
 * The interior folders under a slug, in order of first appearance (which is
 * contributor order — the in-app series order). A folder is labelled by its
 * metadata row when one exists (ADR-011), else by its pages' sub-series
 * (block) name when they agree on one — live sub-series publications carry
 * it — falling back to the humanised segment (the archive shape, where the
 * segment is the event's own slug).
 */
export function slugFolders(
  pages: TreePage[],
  labels?: Map<string, string>,
): TreeFolder[] {
  const order: string[] = [];
  const blockNames = new Map<string, Set<string>>();
  for (const p of pages) {
    const seg = folderSegmentOf(p.subPath);
    if (seg === null) continue;
    if (!blockNames.has(seg)) {
      order.push(seg);
      blockNames.set(seg, new Set());
    }
    if (p.subSeriesName) blockNames.get(seg)!.add(p.subSeriesName);
  }
  return order.map((segment) => {
    const names = [...blockNames.get(segment)!];
    return {
      segment,
      label:
        labels?.get(segment) ??
        (names.length === 1 ? names[0] : humanizeSlug(segment)),
    };
  });
}

/** The interior-folder label overrides for one slug, keyed by segment, from
 *  the workspace folder-metadata map (whose keys are full `slug/segment`
 *  paths). */
export function interiorFolderLabels(
  meta: Map<string, { label: string | null }>,
  slug: string,
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [path, m] of meta) {
    if (m.label && path.startsWith(`${slug}/`)) {
      labels.set(path.slice(slug.length + 1), m.label);
    }
  }
  return labels;
}

/** The slug's root-level pages (one-segment sub-paths), in page order. */
export function rootPages(pages: TreePage[]): TreePage[] {
  return pages.filter((p) => folderSegmentOf(p.subPath) === null);
}

/** The pages inside one interior folder, in page order. */
export function pagesInFolder(pages: TreePage[], segment: string): TreePage[] {
  return pages.filter((p) => folderSegmentOf(p.subPath) === segment);
}

/** The single-fleet placeholder names a publication's lone page can carry:
 *  the series-creation default fleet and the scoring engine's fleetless
 *  bucket. Neither is a name worth showing a viewer. */
const SYNTHETIC_FLEET_NAMES = new Set(['Default', 'Unknown']);

function baseLeafLabel(page: TreePage, soleContributor: boolean): string {
  if (page.isPrizes) return page.fleetName;
  // A synthetic name is never shown: such a page is its publication's (or
  // block's) standings — its race result, on a single-race event (#347) — so
  // call it that, by the series' name when the slug is shared, since the bare
  // word wouldn't say whose.
  const lone = loneResultsPageLabel(page);
  if (SYNTHETIC_FLEET_NAMES.has(page.fleetName)) {
    return soleContributor ? lone : (page.ownerName ?? lone);
  }
  if (page.ownerSingle && soleContributor) return lone;
  return page.fleetName;
}

/**
 * Display label for a page among its sibling set. The rules, in order:
 * prize sheets keep their own name; a publication's only results page is its
 * standings — "Standings" for a sole contributor, its series' name on a
 * shared slug when the fleet name is a synthetic placeholder; otherwise the
 * fleet name. When siblings share a fleet name it carries no signal, so the
 * series name takes over — alone when the series contributes just that one
 * page to the set (the every-class-in-one-folder shape), prefixed onto the
 * fleet name when it contributes several. Block names never appear — the
 * folder level of the cascade carries them.
 */
export function leafLabel(
  page: TreePage,
  siblings: TreePage[],
  soleContributor: boolean,
): string {
  const base = baseLeafLabel(page, soleContributor);
  const duplicated = siblings.some(
    (p) => p !== page && baseLeafLabel(p, soleContributor) === base,
  );
  if (!duplicated || !page.ownerName) return base;
  const ownersPages = siblings.filter(
    (p) => p.ownerName === page.ownerName,
  ).length;
  return ownersPages === 1 ? page.ownerName : `${page.ownerName} — ${base}`;
}

/** A slug that reads as a season: a year, or a year-spanning "2025-26". The
 *  converged archive shape publishes one such folder per season. */
export function seasonLikeSlug(slug: string): boolean {
  return /^\d{4}(-\d{2,4})?$/.test(slug);
}

/** The workspace's seasons and their published top-level folders, as the
 *  cascade consumes them (the repository's `getPublishedSeasonTree` shape). */
export interface SeasonNavTree {
  seasons: {
    label: string;
    /** URL segment under `/p/{ws}/`. */
    segment: string;
    current: boolean;
    folders: TopFolder[];
  }[];
  /** Folders whose season can't be derived; kept out of the season level. */
  undated: TopFolder[];
}

/** What the cascade needs to know about the page it sits on. */
export interface TreeNavPosition {
  workspaceSlug: string;
  seasonTree: SeasonNavTree;
  /** The top-level folder of the position; absent on a season index. */
  currentSlug?: string;
  /** The season of the position, for season indexes with no slug. */
  currentSeason?: string;
  /** All pages in the current slug group, contributor order. */
  pages: TreePage[];
  /** Whether the slug has a single contributing publication. */
  soleContributor: boolean;
  /** The interior folder of the current position, if inside one. */
  currentFolder?: string;
  /** The sub-path of the page being served; absent on index pages. */
  currentSubPath?: string;
  /** Interior-folder label overrides for the slug, keyed by segment. */
  folderLabels?: Map<string, string>;
}

/** Inline links up to this many sibling pages; beyond it, a select. */
const MAX_LEAF_LINKS = 4;

// Scoped under `sstreenav-` so nothing collides with a stored page's own
// styles. The floating variant sits right beside a results page's breadcrumb;
// the block variant is a row above an index page's listing. Hidden in print
// like the rest of the page chrome.
//
// Each level is a dropdown *menu of links* (details/summary), never a select
// that navigates on `change`: a navigating select fires while traversing
// options with arrow keys or a scroll wheel, so keyboard and wheel users get
// carried to a neighbour of the option they wanted.
const NAV_STYLE = `<style>
.sstreenav { font-size: 0.78em; }
.sstreenav-float { float: right; margin: 0 25px 10px 12px; text-align: right; max-width: 62%; }
.sstreenav-block { margin: 0 0 16px; font-size: 0.9em; }
.sstreenav-menu { display: inline-block; position: relative; margin-left: 8px; text-align: left; }
.sstreenav-block .sstreenav-menu { margin-left: 0; margin-right: 8px; }
.sstreenav-menu > summary { list-style: none; cursor: pointer; padding: 4px 22px 4px 8px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #073358; white-space: nowrap; position: relative; }
.sstreenav-menu > summary::-webkit-details-marker { display: none; }
.sstreenav-menu > summary::after { content: ""; position: absolute; right: 8px; top: 50%; margin-top: -2px; border: 4px solid transparent; border-top-color: #073358; }
.sstreenav-menu > summary:hover { border-color: #073358; }
.sstreenav-menu > nav { position: absolute; z-index: 30; left: 0; top: calc(100% + 2px); min-width: 100%; max-height: 60vh; overflow-y: auto; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 6px 18px rgba(7,51,88,0.18); padding: 4px 0; }
.sstreenav-float .sstreenav-menu > nav { left: auto; right: 0; }
.sstreenav-menu > nav a, .sstreenav-menu > nav .sstreenav-current { display: block; padding: 4px 12px; margin: 0; white-space: nowrap; text-align: left; }
.sstreenav a { color: #073358; text-decoration: none; margin-left: 12px; white-space: nowrap; }
.sstreenav a:hover { color: #fb3a3b; text-decoration: underline; }
.sstreenav .sstreenav-current { color: #fb3a3b; font-weight: 600; margin-left: 12px; white-space: nowrap; }
@media print { .sstreenav { display: none; } }
@media (max-width: 640px) { .sstreenav-float { float: none; text-align: center; margin: 10px 12px 0; max-width: none; } }
</style>`;

// Close any open menu on a click outside it. One binding per document — the
// fragment can appear alongside another (e.g. a folder index rendering both
// block and float variants would still bind once).
const MENU_SCRIPT = `<script>(function(){
if(document.documentElement.hasAttribute('data-sstreenav'))return;
document.documentElement.setAttribute('data-sstreenav','');
document.addEventListener('click',function(e){
  document.querySelectorAll('details.sstreenav-menu[open]').forEach(function(d){
    if(!d.contains(e.target))d.removeAttribute('open');
  });
});
})();</script>`;

function renderMenu(level: NavLevel): string {
  const current = level.options.find((o) => o.current);
  const summary = current?.label ?? level.placeholder ?? level.aria;
  const items = level.options
    .map((o) =>
      o.current
        ? `<span class="sstreenav-current">${esc(o.label)}</span>`
        : `<a href="${esc(o.href)}">${esc(o.label)}</a>`,
    )
    .join('');
  return `<details class="sstreenav-menu"><summary aria-label="${esc(level.aria)}">${esc(summary)}</summary><nav>${items}</nav></details>`;
}

function renderLeaf(level: NavLevel): string {
  if (level.options.length > MAX_LEAF_LINKS) return renderMenu(level);
  return level.options
    .map((o) =>
      o.current
        ? `<span class="sstreenav-current">${esc(o.label)}</span>`
        : `<a href="${esc(o.href)}">${esc(o.label)}</a>`,
    )
    .join('');
}

/**
 * Build the cascade's levels for a position in the tree. Ancestor levels are
 * selects; the level holding the served page is the leaf (links when few).
 * Levels with a single option are dropped — a degenerate dimension renders
 * nothing, so a one-slug workspace or one-page folder adds no chrome.
 */
export function buildTreeNav(position: TreeNavPosition): {
  selects: NavLevel[];
  leaf: NavLevel | null;
} {
  const {
    workspaceSlug,
    seasonTree,
    currentSlug,
    currentSeason,
    pages,
    soleContributor,
    currentFolder,
    currentSubPath,
  } = position;
  const base = `/p/${workspaceSlug}`;
  const selects: NavLevel[] = [];

  // Season level: which season holds the position — by its slug, or (on a
  // season index) by label. An undated slug carries no season level.
  const season = currentSlug
    ? seasonTree.seasons.find((s) =>
        s.folders.some((f) => f.slug === currentSlug),
      )
    : seasonTree.seasons.find((s) => s.label === currentSeason);
  const seasonLevel: NavLevel = {
    aria: 'Season',
    options: seasonTree.seasons.map((s) => ({
      label: s.label,
      href: `${base}/${s.segment}`,
      current: s === season,
    })),
  };
  if (seasonLevel.options.length >= 2 && (season || !currentSlug)) {
    selects.push(seasonLevel);
  }

  // Season index: no slug below — the season's folders are the jump level.
  if (!currentSlug) {
    const jump: NavLevel = {
      aria: 'Event or series',
      options: (season?.folders ?? []).map((f) => ({
        label: f.label,
        href: `${base}/${f.slug}`,
      })),
      placeholder: 'Go to results…',
    };
    if (jump.options.length >= 2) selects.push(jump);
    return { selects, leaf: null };
  }

  // Event level: a legacy slug (one that isn't its season's own folder) sits
  // among the season's other folders. The archive shape — slug == season —
  // skips this level; its events are the slug's interior folders below.
  const slugIsSeason = season !== undefined && currentSlug === season.segment;
  if (!slugIsSeason) {
    const siblings = season?.folders ?? seasonTree.undated;
    const eventLevel: NavLevel = {
      aria: 'Event or series',
      options: siblings.map((f) => ({
        label: f.label,
        href: `${base}/${f.slug}`,
        current: f.slug === currentSlug,
      })),
    };
    if (eventLevel.options.length >= 2) selects.push(eventLevel);
  }

  const slugBase = `${base}/${currentSlug}`;
  // The slug's children — interior folders then root pages — are one level:
  // the folder menu when the position is inside (or at) a folder, or the
  // leaf sibling set when the position is a root page.
  const children: NavLevel = {
    aria: slugIsSeason ? 'Event or series' : 'Section',
    options: [
      ...slugFolders(pages, position.folderLabels).map((f) => ({
        label: f.label,
        href: `${slugBase}/${f.segment}`,
        current: f.segment === currentFolder,
      })),
      ...rootPages(pages).map((p) => ({
        label: leafLabel(p, rootPages(pages), soleContributor),
        href: `${slugBase}/${p.subPath}`,
        current: currentFolder === undefined && p.subPath === currentSubPath,
      })),
    ],
  };

  if (currentFolder === undefined) {
    if (currentSubPath === undefined) {
      // Series index: the children level renders as a trailing jump menu —
      // on an archive year slug it's the only route into the folder indexes.
      if (children.options.length >= 2) {
        selects.push({ ...children, placeholder: 'Go to results…' });
      }
      return { selects, leaf: null };
    }
    // A root-level page: the children are its sibling set.
    return { selects, leaf: children.options.length >= 2 ? children : null };
  }

  if (children.options.length >= 2) selects.push(children);
  const folderPages = pagesInFolder(pages, currentFolder);
  if (currentSubPath === undefined) return { selects, leaf: null };
  const leaf: NavLevel = {
    aria: 'Results page',
    options: folderPages.map((p) => ({
      label: leafLabel(p, folderPages, soleContributor),
      href: `${slugBase}/${p.subPath}`,
      current: p.subPath === currentSubPath,
    })),
  };
  return { selects, leaf: leaf.options.length >= 2 ? leaf : null };
}

/**
 * The cascade fragment for a position, or `''` when every level is
 * degenerate. `variant` picks the layout: `float` sits beside a served
 * results page's breadcrumb (the injected case), `block` is a row above an
 * index page's listing.
 */
export function renderTreeNav(
  position: TreeNavPosition,
  variant: 'float' | 'block',
): string {
  const { selects, leaf } = buildTreeNav(position);
  const parts = [
    ...selects.map(renderMenu),
    ...(leaf ? [renderLeaf(leaf)] : []),
  ];
  if (parts.length === 0) return '';
  return `<div class="sstreenav sstreenav-${variant}">${NAV_STYLE}${MENU_SCRIPT}${parts.join('')}</div>`;
}

/**
 * Season index at `/p/{ws}/{season}` (ADR-011) for a season with no
 * same-named published slug — the live-workspace shape, where each event
 * publishes under its own top-level folder and the season exists as their
 * grouping. (Where a slug *is* the season — the archive shape — that slug's
 * own index serves this URL instead.) Lists the season's folders.
 */
export function renderSeasonIndexHtml(opts: {
  workspaceSlug: string;
  workspaceName: string;
  season: string;
  folders: TopFolder[];
  logoUrl?: string;
  nav?: string;
}): string {
  const { workspaceSlug, workspaceName, season, folders } = opts;
  const rows = folders
    .map(
      (f) =>
        `<li><a href="/p/${esc(workspaceSlug)}/${esc(f.slug)}">${esc(f.label)}</a></li>`,
    )
    .join('\n');
  const back = `<p class="back"><a href="/p/${esc(workspaceSlug)}">&larr; ${esc(workspaceName)} &mdash; published results</a></p>`;
  const hero = renderPublicHero(esc(season), opts.logoUrl ?? '');
  return renderPublicShell(
    `${season} — ${workspaceName}`,
    hero,
    `${back}\n${opts.nav ?? ''}<ul class="listing">\n${rows}\n</ul>`,
  );
}

/**
 * Folder index at `/p/{ws}/{slug}/{folder}` (ADR-011): the pages inside one
 * interior folder — an event or sub-series — across every series publishing
 * into the slug. These paths appear in every two-segment page URL but
 * resolved to nothing before the publication tree made them addressable.
 * `slugTitle` names the back link's target (the series index above); `nav` is
 * a pre-rendered cascade fragment, placed above the listing.
 */
export function renderFolderIndexHtml(opts: {
  workspaceSlug: string;
  slug: string;
  folder: TreeFolder;
  pages: TreePage[];
  soleContributor: boolean;
  slugTitle: string;
  logoUrl?: string;
  nav?: string;
}): string {
  const { workspaceSlug, slug, folder, pages, soleContributor } = opts;
  const rows = pages
    .map((p) => {
      const label = leafLabel(p, pages, soleContributor);
      return `<li><a href="/p/${esc(workspaceSlug)}/${esc(slug)}/${esc(p.subPath)}">${esc(label)}</a></li>`;
    })
    .join('\n');
  const back = `<p class="back"><a href="/p/${esc(workspaceSlug)}/${esc(slug)}">&larr; ${esc(opts.slugTitle)}</a></p>`;
  const hero = renderPublicHero(esc(folder.label), opts.logoUrl ?? '');
  return renderPublicShell(
    `${folder.label} — ${opts.slugTitle}`,
    hero,
    `${back}\n${opts.nav ?? ''}<ul class="listing">\n${rows}\n</ul>`,
  );
}

/** Insert a fragment immediately after the document's opening `<body ...>`
 *  tag. A document without one (never our own rendered pages) is returned
 *  unchanged rather than corrupted. */
export function injectAfterBodyTag(html: string, fragment: string): string {
  const bodyOpen = /<body[^>]*>/i.exec(html);
  if (!bodyOpen) return html;
  const at = bodyOpen.index + bodyOpen[0].length;
  return html.slice(0, at) + fragment + html.slice(at);
}
