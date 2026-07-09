/**
 * Renderers for the public published-results listing pages (ADR-008 Phase 9/10,
 * #162). Two static-feeling listings sit above the per-fleet results pages:
 *
 *   /p/{ws}            → workspace index: every published series in the workspace
 *   /p/{ws}/{series}   → series index: that publication's fleet pages
 *
 * Both are rendered on the fly by the `/p/[...slug]` route (the read path is a
 * thin always-fresh function, not a static blob — see #162), so there is no
 * stored index blob to regenerate on publish/unpublish. The chrome mirrors
 * `results-renderer.ts` (arial, centred, the `Sail Scoring — sailscoring.ie`
 * footer) so a listing and a results page feel like one site.
 */

import { formatShortDate as formatDate } from './format-date';
import { escapeHtml as esc } from './html';

/** A published series as shown in the workspace listing. */
export interface WorkspaceIndexItem {
  slug: string;
  /** Display title: the series name, or the slug for an orphaned publication. */
  title: string;
  publishedAt: number; // Unix ms
  fleetCount: number;
  // Placement on the listing, from the slug's representative series (its
  // categorisation / archive state and manual order). All optional so a bare item
  // reads as an active, uncategorised entry — keeping the flat common-case
  // render and old call sites compiling.
  /** True when the representative series is archived → relegated to "Past
   *  results" rather than shown among the active category sections. */
  archived?: boolean;
  /** Representative category name; null/absent = the Uncategorized bucket. */
  categoryName?: string | null;
  /** Representative category's `displayOrder` (section order); absent → last. */
  categoryOrder?: number;
  /** Representative series' manual `displayOrder` within the active list. */
  seriesOrder?: number;
  /** Representative series' start-date year, for the "Past results" grouping. */
  year?: number | null;
}

/** A category section of active publications on the workspace listing. */
export interface ListingCategoryGroup {
  /** null = the synthetic "Uncategorized" bucket. */
  categoryName: string | null;
  items: WorkspaceIndexItem[];
}

/** A year section of archived publications ("Past results"). */
export interface ListingYearGroup {
  /** null = the "Undated" bucket. */
  year: number | null;
  items: WorkspaceIndexItem[];
}

/** The workspace listing partitioned into active category sections and the
 *  relegated "Past results" year sections. */
export interface WorkspaceListing {
  active: ListingCategoryGroup[];
  past: ListingYearGroup[];
}

/** A fleet page as shown in the series listing. */
export interface SeriesIndexPage {
  fleetName: string;
  /** Sub-series (block) the page covers; whole-series pages omit it. */
  subSeriesName?: string;
  /** The prize sheet (#240) — labelled by its own name, never "Standings". */
  isPrizes?: boolean;
  subPath: string; // `standings` for a single fleet, else `kebab(fleetName)`
}

/** One contributing series' fleet pages within a shared-slug listing. With a
 *  single group the listing is flat; with several it is sub-headed per series. */
export interface SeriesIndexGroup {
  seriesName: string; // contributing series name (or the slug, for an orphan)
  pages: SeriesIndexPage[];
}

/** The sail-mark path, on the tightened `205 205 840 840` viewBox. */
const MARK_PATH =
  'M551,757.3c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-125.9,125.9c29.4-.8,58.5-.7,87.4.3l191.1-191.1c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-177.3,177.3c33.3,1.8,66.2,4.7,98.7,8.8l59.9-59.9c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-48.4,48.4c87.3,12.9,171.9,34.6,253.4,65.8-95.4-229.3-112.6-465-9.6-706L315.1,906.2c31.6-3.2,62.9-5.5,93.9-6.9l142.1-142Z';

/** Inline brand sail mark — self-contained (no external image). */
function markSvg(fill: string, size: number): string {
  return `<svg viewBox="205 205 840 840" width="${size}" height="${size}" aria-hidden="true" style="vertical-align:middle;"><path fill="${fill}" d="${MARK_PATH}"/></svg>`;
}

/** Self-contained SVG favicon (red sail mark as a data URI). */
const FAVICON = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="205 205 840 840"><path fill="#fb3a3b" d="${MARK_PATH}"/></svg>`,
)}">`;

/** Brand lockup for the hero: white sail mark + the "Sail Scoring" wordmark,
 *  side by side, linking to the brand site. */
function brandLockup(): string {
  return `<a class="brand" href="https://sailscoring.ie" target="_top" rel="noopener">${markSvg('#ffffff', 44)}<span class="brandname">Sail Scoring</span></a>`;
}

/** The workspace's own logo in the hero, on a white chip so any colourway stays
 *  legible on the navy background. Empty string when the workspace has no logo. */
function heroLogo(url: string): string {
  if (!url) return '';
  return `<div class="wslogo"><img src="${esc(url)}" alt=""></div>`;
}

const FOOTER = `<footer class="credit">${markSvg('#fb3a3b', 14)} Sail Scoring &mdash; <a href="https://sailscoring.ie" target="_top" rel="noopener">sailscoring.ie</a></footer>`;

const STYLE = `*{box-sizing:border-box;}
body { font-family: "Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, helvetica, sans-serif; margin: 0; background: #f4f6f8; color: #1a1a1a; }
.hero { background: #073358; color: #fff; padding: 32px 24px 28px; text-align: center; border-bottom: 4px solid #fb3a3b; }
.hero h1 { font-size: 1.7em; font-weight: 700; color: #fff; margin: 22px 0 0; }
/* Logos sit in a centred row with a generous gap. The lockup is vertically
   stacked — mark over wordmark — so it reads square next to the (usually
   squarish) workspace logo rather than as a wide banner. */
.hero .herologos { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 40px; }
.hero .brand { display: inline-flex; flex-direction: column; align-items: center; gap: 8px; text-decoration: none; }
.hero .brandname { color: #fff; font-size: 1.15em; font-weight: 700; letter-spacing: 0.01em; }
.hero .brand:hover .brandname { text-decoration: underline; }
.hero .wslogo { display: inline-flex; align-items: center; justify-content: center; background: #fff; border-radius: 10px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.18); }
.hero .wslogo img { display: block; height: 60px; width: auto; max-width: 260px; object-fit: contain; }
.content { max-width: 720px; margin: 28px auto 40px; padding: 0 20px; }
p.back { margin: 0 0 16px; font-size: 0.82em; }
p.back a { color: #073358; text-decoration: none; }
p.back a:hover { color: #fb3a3b; text-decoration: underline; }
p.browse { margin: 0 0 18px; font-size: 0.9em; font-weight: 600; }
p.browse a { color: #073358; text-decoration: none; }
p.browse a:hover { color: #fb3a3b; text-decoration: underline; }
ul.listing { list-style: none; padding: 0; margin: 16px 0; }
ul.listing li { background: #fff; border: 1px solid #e2e6ea; border-left: 4px solid transparent; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 1px 2px rgba(7,51,88,0.06); transition: box-shadow .15s, border-color .15s, transform .1s; }
ul.listing li:hover { box-shadow: 0 4px 14px rgba(7,51,88,0.13); border-left-color: #fb3a3b; transform: translateY(-1px); }
ul.listing li a { display: block; padding: 16px 20px 18px; font-size: 1.15em; font-weight: 600; color: #073358; text-decoration: none; }
ul.listing .meta { display: block; color: #6b7280; font-size: 0.78em; font-weight: 400; margin-top: 6px; padding-bottom: 2px; }
h2.section { font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.08em; color: #073358; font-weight: 700; margin: 28px 0 10px; }
h2.series { font-size: 1.15em; color: #073358; font-weight: 700; margin: 24px 0 8px; }
h3.subseries { font-size: 1.0em; color: #073358; font-weight: 700; margin: 20px 0 6px; }
h2.past { font-size: 1.2em; color: #073358; font-weight: 700; margin: 36px 0 0; border-top: 1px solid #e2e6ea; padding-top: 18px; }
h3.year { font-size: 0.95em; color: #556; font-weight: 600; margin: 18px 0 8px; }
p.empty { color: #6b7280; text-align: center; margin: 48px 0; }
footer.credit { text-align: center; color: #475569; font-size: 0.85em; padding: 22px 20px; border-top: 1px solid #e2e6ea; }
footer.credit a { color: #073358; text-decoration: none; }
footer.credit a:hover { color: #fb3a3b; text-decoration: underline; }`;

/**
 * The shared public-page chrome (navy hero, red accent, Poppins, the
 * `Sail Scoring — sailscoring.ie` footer). Reused by the career-arc page so the
 * whole `/p/...` surface reads as one site. `extraCss` is appended after the
 * base stylesheet for page-specific rules.
 */
export function renderPublicShell(
  title: string,
  hero: string,
  body: string,
  extraCss = '',
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
${FAVICON}
<style type="text/css">
${STYLE}
${extraCss}
</style>
</head>
<body>
<header class="hero">${hero}</header>
<main class="content">
${body}
</main>
${FOOTER}
</body>
</html>`;
}

/** The standard hero: the brand lockup beside the workspace logo, then the
 *  heading. `headingHtml` is inserted as-is (callers escape their own text). */
export function renderPublicHero(headingHtml: string, logoUrl = ''): string {
  return `<div class="herologos">${brandLockup()}${heroLogo(logoUrl)}</div>\n<h1>${headingHtml}</h1>`;
}

/**
 * Partition the flat listing into the sections the workspace index renders:
 * active publications as category sections (mirroring the in-app series list),
 * and archived publications relegated to "Past results" year
 * sections. Pure, so the ordering rules are unit-tested directly.
 *
 * Placement comes from each slug's representative series (see
 * `listPublishedByWorkspace`); a slug shared by several series under different
 * categories is fudged onto one section via that representative.
 */
export function groupWorkspaceListing(
  items: WorkspaceIndexItem[],
): WorkspaceListing {
  const INF = Number.POSITIVE_INFINITY;

  // Active → category sections. Section order is the representative category's
  // displayOrder; the Uncategorized bucket (null) always sorts last. Within a
  // section the manual series order wins, newest first as a tiebreak.
  const catBuckets = new Map<string | null, WorkspaceIndexItem[]>();
  const catOrder = new Map<string | null, number>();
  for (const it of items.filter((i) => !i.archived)) {
    const key = it.categoryName ?? null;
    (catBuckets.get(key) ?? catBuckets.set(key, []).get(key)!).push(it);
    catOrder.set(key, Math.min(catOrder.get(key) ?? INF, it.categoryOrder ?? INF));
  }
  const active: ListingCategoryGroup[] = [...catBuckets.entries()]
    .map(([categoryName, list]) => ({
      categoryName,
      items: list.sort(
        (a, b) =>
          (a.seriesOrder ?? INF) - (b.seriesOrder ?? INF) ||
          b.publishedAt - a.publishedAt,
      ),
    }))
    .sort((a, b) => {
      if (a.categoryName === null) return 1;
      if (b.categoryName === null) return -1;
      return catOrder.get(a.categoryName)! - catOrder.get(b.categoryName)!;
    });

  // Archived → year sections, newest year first; the undated bucket last.
  const yearBuckets = new Map<number | null, WorkspaceIndexItem[]>();
  for (const it of items.filter((i) => i.archived)) {
    const key = it.year ?? null;
    (yearBuckets.get(key) ?? yearBuckets.set(key, []).get(key)!).push(it);
  }
  const past: ListingYearGroup[] = [...yearBuckets.entries()]
    .map(([year, list]) => ({
      year,
      items: list.sort((a, b) => b.publishedAt - a.publishedAt),
    }))
    .sort((a, b) => {
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });

  return { active, past };
}

/**
 * Workspace listing at `/p/{ws}`. Publications are grouped into category
 * sections and a relegated "Past results" block (the in-app series
 * organisation surfaced publicly).
 * A workspace with no categories and nothing archived collapses to a single
 * flat list with no section headings, matching the original look.
 */
export function renderWorkspaceIndexHtml(
  workspaceSlug: string,
  workspaceName: string,
  items: WorkspaceIndexItem[],
  logoUrl = '',
  opts: {
    competitorsLink?: boolean;
    /** Public season ladders (#209) to link above the series listing. */
    rankings?: Array<{ name: string; slug: string }>;
  } = {},
): string {
  const heading = `${esc(workspaceName)} &mdash; published results`;
  const hero = renderPublicHero(heading, logoUrl);
  // Forward link to the competitor index, when the workspace has one to show.
  const rankingLinks = (opts.rankings ?? [])
    .map(
      (r) =>
        `<p class="browse"><a href="/p/${esc(workspaceSlug)}/ranking/${esc(r.slug)}">${esc(r.name)} &rarr;</a></p>`,
    )
    .join('');
  const competitorsLink =
    (opts.competitorsLink
      ? `<p class="browse"><a href="/p/${esc(workspaceSlug)}/competitors">Browse competitors &rarr;</a></p>`
      : '') + rankingLinks;
  if (items.length === 0) {
    return renderPublicShell(
      `${workspaceName} — published results`,
      hero,
      `${competitorsLink}<p class="empty">No published results yet.</p>`,
    );
  }

  const row = (it: WorkspaceIndexItem) => {
    const fleets = it.fleetCount > 1 ? ` &middot; ${it.fleetCount} fleets` : '';
    return `<li><a href="/p/${esc(workspaceSlug)}/${esc(it.slug)}">${esc(it.title)}</a><span class="meta">Published ${esc(formatDate(it.publishedAt))}${fleets}</span></li>`;
  };
  const list = (rows: WorkspaceIndexItem[]) =>
    `<ul class="listing">\n${rows.map(row).join('\n')}\n</ul>`;

  const { active, past } = groupWorkspaceListing(items);

  // Flat (no headings) when there's a single uncategorised active section and
  // nothing archived — the common single-club, no-categories case.
  const flat =
    past.length === 0 &&
    active.length <= 1 &&
    (active.length === 0 || active[0].categoryName === null);

  let sections: string;
  if (flat) {
    sections = list(active[0]?.items ?? []);
  } else {
    const activeHtml = active
      .map(
        (g) =>
          `<h2 class="section">${esc(g.categoryName ?? 'Uncategorized')}</h2>\n${list(g.items)}`,
      )
      .join('\n');
    const pastHtml = past.length
      ? `\n<h2 class="past">Past results</h2>\n${past
          .map(
            (g) =>
              `<h3 class="year">${g.year ?? 'Undated'}</h3>\n${list(g.items)}`,
          )
          .join('\n')}`
      : '';
    sections = activeHtml + pastHtml;
  }

  return renderPublicShell(
    `${workspaceName} — published results`,
    hero,
    `${competitorsLink}${sections}`,
  );
}

/**
 * Series listing at `/p/{ws}/{series}`. Lists the publication's fleet pages; a
 * single-fleet publication renders as a one-item listing so the bare slug stays
 * a stable listing rather than the standings page itself.
 *
 * A slug is a shared namespace, so `groups` may carry several contributing
 * series. With one group the listing is flat (as before); with several, each
 * series is sub-headed so the fleets read as that event's, e.g. Lambay Races →
 * Cruisers fleets + One Designs fleets under one page.
 *
 * A `← {workspace} — published results` link sits above the heading, up to the
 * workspace index `/p/{ws}`. Reaching this page means the workspace has at least
 * one publication, so that index always resolves.
 */
export function renderSeriesIndexHtml(
  workspaceSlug: string,
  workspaceName: string,
  slug: string,
  title: string,
  groups: SeriesIndexGroup[],
  logoUrl = '',
): string {
  const renderFlatList = (pages: SeriesIndexPage[]): string => {
    // A lone results page reads better as "Standings" than as its (possibly
    // synthetic "Default") fleet name; the prize sheet always keeps its own
    // name, and doesn't stop a lone sibling fleet page reading as standings.
    const single = pages.filter((p) => !p.isPrizes).length === 1;
    return `<ul class="listing">
${pages
  .map((p) => {
    const label = !p.isPrizes && single ? 'Standings' : p.fleetName;
    return `<li><a href="/p/${esc(workspaceSlug)}/${esc(slug)}/${esc(p.subPath)}">${esc(label)}</a></li>`;
  })
  .join('\n')}
</ul>`;
  };

  // Sub-series pages group under their block name, in page order; any
  // whole-series pages (no block) list first.
  const renderList = (pages: SeriesIndexPage[]): string => {
    const blockNames = [...new Set(pages.map((p) => p.subSeriesName).filter((n): n is string => !!n))];
    if (blockNames.length === 0) return renderFlatList(pages);
    const blockless = pages.filter((p) => !p.subSeriesName);
    const parts: string[] = [];
    if (blockless.length > 0) parts.push(renderFlatList(blockless));
    for (const name of blockNames) {
      parts.push(`<h3 class="subseries">${esc(name)}</h3>`);
      parts.push(renderFlatList(pages.filter((p) => p.subSeriesName === name)));
    }
    return parts.join('\n');
  };

  const sections =
    groups.length <= 1
      ? renderList(groups[0]?.pages ?? [])
      : groups
          .map(
            (g) => `<h2 class="series">${esc(g.seriesName)}</h2>\n${renderList(g.pages)}`,
          )
          .join('\n');

  const back = `<p class="back"><a href="/p/${esc(workspaceSlug)}">&larr; ${esc(workspaceName)} &mdash; published results</a></p>`;
  const hero = renderPublicHero(esc(title), logoUrl);
  return renderPublicShell(title, hero, `${back}\n${sections}`);
}
