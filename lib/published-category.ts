/**
 * A category's public page, `/p/{ws}/-/{slug}`: every published event filed in
 * the category, across every season. Categories are a facet of the
 * publication tree rather than a level of it (ADR-011), so the page sits
 * beside the tree under the reserved `-` segment — no published slug can be
 * `-`, so it never collides with a season or a folder.
 */

import { escapeHtml as esc } from './html';
import {
  categoryLinkLabel,
  groupWorkspaceListingBySeason,
  renderIndexEventRow,
  type IndexEvent,
} from './published-index';
import { renderPublicHero, renderPublicShell } from './published-shell';
import { folderSegmentOf } from './published-tree';

/** The reserved segment under `/p/{ws}/` that category pages live beneath. */
export const CATEGORY_SEGMENT = '-';

/** A category with something published in it — what its public page and the
 *  links to that page need. */
export interface PublishedCategory {
  id: string;
  name: string;
  slug: string;
  /** Slugs the category had before a rename; each redirects to `slug`. */
  formerSlugs: string[];
  displayOrder: number;
  /** How many publications (one per series) the category holds. */
  publishedCount: number;
}

/** The public path of a category's page. */
export function categoryPagePath(workspaceSlug: string, categorySlug: string): string {
  return `/p/${workspaceSlug}/${CATEGORY_SEGMENT}/${categorySlug}`;
}

/** The category a public URL segment names: by its current slug, or — after
 *  a rename — by a former one, which the caller redirects. A current slug
 *  always wins over another category's former one. */
export function resolveCategorySegment(
  categories: readonly PublishedCategory[],
  segment: string,
): { category: PublishedCategory; former: boolean } | null {
  const current = categories.find((c) => c.slug === segment);
  if (current) return { category: current, former: false };
  const renamed = categories.find((c) => c.formerSlugs.includes(segment));
  return renamed ? { category: renamed, former: true } : null;
}

/** A link from one page to a category's page. */
export interface CategoryLink {
  label: string;
  href: string;
}

/**
 * The category link for a position in the tree — a slug's index, one of its
 * folders, or a results page — when everything there is filed in one
 * category, and that category has more to show than this one event. Null
 * otherwise: a season slug holding many categories, an uncategorised event,
 * or a category with a single publication (its page would show only what the
 * reader is already looking at). A category named exactly like a season is
 * the old `category = year` filing and links to nothing the season index
 * doesn't already show.
 */
export function positionCategoryLink(opts: {
  workspaceSlug: string;
  categories: readonly PublishedCategory[];
  /** The slug's publications: each one's category and its pages' sub-paths. */
  members: readonly { categoryId: string | null; pages: readonly { subPath: string }[] }[];
  /** The interior folder of the position, if inside one. */
  currentFolder?: string;
  /** The sub-path of the page being served; absent on index pages. */
  currentSubPath?: string;
  /** The workspace's season labels. */
  seasonLabels: readonly string[];
}): CategoryLink | null {
  const { currentFolder, currentSubPath } = opts;
  const here = opts.members.filter((m) => {
    if (currentFolder !== undefined) {
      return m.pages.some((p) => folderSegmentOf(p.subPath) === currentFolder);
    }
    if (currentSubPath !== undefined) {
      return m.pages.some((p) => p.subPath === currentSubPath);
    }
    return true;
  });
  const ids = new Set(here.map((m) => m.categoryId));
  if (ids.size !== 1) return null;
  const [id] = ids;
  const category = opts.categories.find((c) => c.id === id);
  if (!category || category.publishedCount < 2) return null;
  if (opts.seasonLabels.includes(category.name)) return null;
  return {
    label: categoryLinkLabel(category.name),
    href: categoryPagePath(opts.workspaceSlug, category.slug),
  };
}

/**
 * The category page: the category's events, newest season first, each
 * season a heading over its event rows (the same rows the workspace index
 * shows, linking each event and its results pages). Every season is open —
 * seeing one event across the years is the point of the page — and a
 * category within a single season needs no season heading.
 */
export function renderCategoryIndexHtml(opts: {
  workspaceSlug: string;
  workspaceName: string;
  categoryName: string;
  events: IndexEvent[];
  logoUrl?: string;
}): string {
  const { workspaceSlug, workspaceName, categoryName } = opts;
  const seasons = groupWorkspaceListingBySeason(opts.events);
  const list = (rows: IndexEvent[]) =>
    `<ul class="listing">\n${rows.map(renderIndexEventRow).join('\n')}\n</ul>`;
  const sections =
    seasons.length <= 1
      ? list(seasons[0]?.groups.flatMap((g) => g.items) ?? [])
      : seasons
          .map(
            (s) =>
              `<section class="cseason">\n<h2 class="series">${esc(s.season ?? 'Undated')}</h2>\n${list(s.groups.flatMap((g) => g.items))}\n</section>`,
          )
          .join('\n');
  const back = `<p class="back"><a href="/p/${esc(workspaceSlug)}">&larr; ${esc(workspaceName)} &mdash; published results</a></p>`;
  const hero = renderPublicHero(esc(categoryName), opts.logoUrl ?? '');
  return renderPublicShell(
    `${categoryName} results — ${workspaceName}`,
    hero,
    `${back}\n${sections}`,
  );
}
