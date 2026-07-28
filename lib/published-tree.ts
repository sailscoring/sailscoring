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
import type { SeriesIndexPage } from './published-index';

/** A page in a slug group, with its contributing series named so labels can
 *  distinguish same-named pages from different series on a shared slug. */
export interface TreePage extends SeriesIndexPage {
  /** The contributing series' name; null/absent for an orphaned publication. */
  ownerName?: string | null;
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

/** An interior folder implied by the slug's pages. */
export interface TreeFolder {
  segment: string;
  label: string;
}

/**
 * The interior folders under a slug, in order of first appearance (which is
 * contributor order — the in-app series order). A folder is labelled by its
 * pages' sub-series (block) name when they agree on one — live sub-series
 * publications carry it — falling back to the humanised segment (the archive
 * shape, where the segment is the event's own slug).
 */
export function slugFolders(pages: TreePage[]): TreeFolder[] {
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
      label: names.length === 1 ? names[0] : humanizeSlug(segment),
    };
  });
}

/** The slug's root-level pages (one-segment sub-paths), in page order. */
export function rootPages(pages: TreePage[]): TreePage[] {
  return pages.filter((p) => folderSegmentOf(p.subPath) === null);
}

/** The pages inside one interior folder, in page order. */
export function pagesInFolder(pages: TreePage[], segment: string): TreePage[] {
  return pages.filter((p) => folderSegmentOf(p.subPath) === segment);
}

/**
 * Display label for a page among its sibling set. The rules, in order:
 * prize sheets keep their own name; a synthetic "Default" fleet reads as its
 * series' name on a shared slug ("Standings" for a sole contributor — the
 * series name is already the folder label there); a lone results page of a
 * sole contributor reads as "Standings"; otherwise the fleet name,
 * disambiguated with the series name when siblings from different series
 * share it. Block names never appear — the folder level of the cascade
 * carries them.
 */
export function leafLabel(
  page: TreePage,
  siblings: TreePage[],
  soleContributor: boolean,
): string {
  if (page.isPrizes) return page.fleetName;
  if (page.fleetName === 'Default') {
    return soleContributor ? 'Standings' : (page.ownerName ?? 'Standings');
  }
  const nonPrizes = siblings.filter((p) => !p.isPrizes);
  if (soleContributor && nonPrizes.length === 1) return 'Standings';
  const duplicated = siblings.some(
    (p) => p !== page && !p.isPrizes && p.fleetName === page.fleetName,
  );
  return duplicated && page.ownerName
    ? `${page.ownerName} — ${page.fleetName}`
    : page.fleetName;
}

/** True when every top-level folder slug reads as a season ("2025",
 *  "2025-26") — the converged archive shape, where the cascade should offer
 *  seasons newest first rather than publish order. */
function allSeasonLike(folders: TopFolder[]): boolean {
  return (
    folders.length > 0 && folders.every((f) => /^\d{4}(-\d{2,4})?$/.test(f.slug))
  );
}

/** Order the top-level folders for the cascade: newest season first when the
 *  workspace publishes season folders, otherwise the given (publish-recency)
 *  order. */
export function orderTopFolders(folders: TopFolder[]): TopFolder[] {
  if (!allSeasonLike(folders)) return folders;
  return [...folders].sort((a, b) => b.slug.localeCompare(a.slug));
}

/** What the cascade needs to know about the page it sits on. */
export interface TreeNavPosition {
  workspaceSlug: string;
  /** Every top-level folder in the workspace (the current one included). */
  topFolders: TopFolder[];
  currentSlug: string;
  /** All pages in the current slug group, contributor order. */
  pages: TreePage[];
  /** Whether the slug has a single contributing publication. */
  soleContributor: boolean;
  /** The interior folder of the current position, if inside one. */
  currentFolder?: string;
  /** The sub-path of the page being served; absent on index pages. */
  currentSubPath?: string;
}

/** Inline links up to this many sibling pages; beyond it, a select. */
const MAX_LEAF_LINKS = 4;

// Scoped under `sstreenav-` so nothing collides with a stored page's own
// styles. The floating variant sits right beside a results page's breadcrumb;
// the block variant is a row above an index page's listing. Hidden in print
// like the rest of the page chrome.
const NAV_STYLE = `<style>
.sstreenav { font-size: 0.78em; }
.sstreenav-float { float: right; margin: 0 25px 10px 12px; text-align: right; max-width: 62%; }
.sstreenav-block { margin: 0 0 16px; font-size: 0.9em; }
.sstreenav select { font: inherit; color: #073358; max-width: 100%; margin-left: 8px; }
.sstreenav-block select { margin-left: 0; margin-right: 8px; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; }
.sstreenav a { color: #073358; text-decoration: none; margin-left: 12px; white-space: nowrap; }
.sstreenav a:hover { color: #fb3a3b; text-decoration: underline; }
.sstreenav .sstreenav-current { color: #fb3a3b; font-weight: 600; margin-left: 12px; white-space: nowrap; }
@media print { .sstreenav { display: none; } }
@media (max-width: 640px) { .sstreenav-float { float: none; text-align: center; margin: 10px 12px 0; max-width: none; } }
</style>`;

function renderSelect(level: NavLevel): string {
  const lead =
    level.placeholder && !level.options.some((o) => o.current)
      ? `<option value="" selected>${esc(level.placeholder)}</option>`
      : '';
  const options = level.options
    .map(
      (o) =>
        `<option value="${esc(o.href)}"${o.current ? ' selected' : ''}>${esc(o.label)}</option>`,
    )
    .join('');
  return `<select aria-label="${esc(level.aria)}" onchange="if(this.value&&this.value!==location.pathname)location.href=this.value">${lead}${options}</select>`;
}

function renderLeaf(level: NavLevel): string {
  if (level.options.length > MAX_LEAF_LINKS) return renderSelect(level);
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
    topFolders,
    currentSlug,
    pages,
    soleContributor,
    currentFolder,
    currentSubPath,
  } = position;
  const base = `/p/${workspaceSlug}`;
  const slugBase = `${base}/${currentSlug}`;

  const selects: NavLevel[] = [];
  const top: NavLevel = {
    aria: 'Season or event',
    options: orderTopFolders(topFolders).map((f) => ({
      label: f.label,
      href: `${base}/${f.slug}`,
      current: f.slug === currentSlug,
    })),
  };
  if (top.options.length >= 2) selects.push(top);

  // The slug's children — interior folders then root pages — are one level:
  // the folder select when the position is inside (or at) a folder, or the
  // leaf sibling set when the position is a root page.
  const children: NavLevel = {
    aria: 'Event or series',
    options: [
      ...slugFolders(pages).map((f) => ({
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
      // Series index: the children level renders as a trailing jump select —
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
    ...selects.map(renderSelect),
    ...(leaf ? [renderLeaf(leaf)] : []),
  ];
  if (parts.length === 0) return '';
  return `<div class="sstreenav sstreenav-${variant}">${NAV_STYLE}${parts.join('')}</div>`;
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
