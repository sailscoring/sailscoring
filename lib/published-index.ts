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

import { escapeHtml as esc } from './html';
import { kebab } from './publishing';
import {
  interiorFolderLabels,
  leafLabel,
  pagesInFolder,
  rootPages,
  slugFolders,
  type TreePage,
} from './published-tree';

/**
 * The fields the listing partition reads — what decides which section a
 * publication lands in and where it sorts. All placement fields are optional so
 * a bare item reads as an active, uncategorised entry — keeping the flat
 * common-case render and old call sites compiling. Both the public workspace
 * index and the in-app management page partition their items through this.
 */
export interface ListingPlacement {
  publishedAt: number; // Unix ms
  /** True when the series is archived → relegated to "Past results" rather
   *  than shown among the active category sections. */
  archived?: boolean;
  /** Category name; null/absent = the Uncategorized bucket. */
  categoryName?: string | null;
  /** The category's `displayOrder` (section order); absent/null → last. */
  categoryOrder?: number | null;
  /** The series' manual `displayOrder` within the active list; absent/null →
   *  last (null rather than absent where the value has crossed JSON). */
  seriesOrder?: number | null;
  /** The series' start-date year, for the "Past results" grouping. */
  year?: number | null;
  /** The season the publication files under (ADR-011): the folder-metadata
   *  pin, a season-like slug, or the start-date year as a string. Drives the
   *  public season grouping; null = undated. */
  season?: string | null;
}

/** One publication sharing a listing slug: its own series name, placement and
 *  fleet pages. The quick-jump picker's Series level is the contributor, not
 *  the slug — an archive workspace publishes a whole year of series into one
 *  slug, and "Tuesday Series 1" must still appear by name (#320). */
export interface WorkspaceIndexContributor {
  /** The contributing series' name; null for an orphaned publication. */
  title: string | null;
  year?: number | null;
  categoryName?: string | null;
  /** The category's displayOrder; absent/Infinity when uncategorised. */
  categoryOrder?: number;
  pages: SeriesIndexPage[];
}

/** A published series as shown in the workspace listing. Placement comes from
 *  the slug's representative series (its categorisation / archive state and
 *  manual order). */
export interface WorkspaceIndexItem extends ListingPlacement {
  slug: string;
  /** Display title: the series name, or the slug for an orphaned publication. */
  title: string;
  fleetCount: number;
  /** The slug's publications, feeding the quick-jump picker (#320). Absent =
   *  no picker data for this slug. */
  contributors?: WorkspaceIndexContributor[];
}

/** A category section of active publications on the workspace listing. */
export interface ListingCategoryGroup<T extends ListingPlacement = WorkspaceIndexItem> {
  /** null = the synthetic "Uncategorized" bucket. */
  categoryName: string | null;
  items: T[];
}

/** A year section of archived publications ("Past results"). */
export interface ListingYearGroup<T extends ListingPlacement = WorkspaceIndexItem> {
  /** null = the "Undated" bucket. */
  year: number | null;
  items: T[];
}

/** The workspace listing partitioned into active category sections and the
 *  relegated "Past results" year sections. */
export interface WorkspaceListing<T extends ListingPlacement = WorkspaceIndexItem> {
  active: ListingCategoryGroup<T>[];
  past: ListingYearGroup<T>[];
}

/** A fleet page as shown in the series listing. */
export interface SeriesIndexPage {
  fleetName: string;
  /** Sub-series (block) the page covers; whole-series pages omit it. */
  subSeriesName?: string;
  /** The prize sheet (#240) — labelled by its own name, never "Standings". */
  isPrizes?: boolean;
  /** Published at race-results detail (#347) — a lone page then reads
   *  "Results", since there are no standings on it. */
  isRaceResults?: boolean;
  subPath: string; // `standings` for a single fleet, else `kebab(fleetName)`
}

/** What a publication's lone results page is called: its standings, or — for a
 *  single-race event — the race result it actually carries (#347). */
export function loneResultsPageLabel(page: { isRaceResults?: boolean }): string {
  return page.isRaceResults ? 'Results' : 'Standings';
}

/** Display label for a fleet page outside the series index's own lists (the
 *  fleet switcher and the quick-jump picker, #320). A lone results page reads
 *  as "Standings" rather than its (possibly synthetic "Default") fleet name —
 *  `single` is that judgement over the page's whole publication — the prize
 *  sheet keeps its own name, and a sub-series page carries its block name so
 *  same-named fleets in different blocks stay distinguishable. */
export function fleetPageLabel(page: SeriesIndexPage, single: boolean): string {
  const leaf = !page.isPrizes && single ? loneResultsPageLabel(page) : page.fleetName;
  return page.subSeriesName ? `${page.subSeriesName} — ${leaf}` : leaf;
}

/** One contributing series' fleet pages within a shared-slug listing. With a
 *  single group the listing is flat; with several it is sub-headed per series. */
export interface SeriesIndexGroup {
  seriesName: string; // contributing series name (or the slug, for an orphan)
  pages: SeriesIndexPage[];
}

// The shared chrome lives in published-shell.ts; re-exported here for the
// long-standing external callers (career arc, competitor index, rankings).
import { renderPublicHero, renderPublicShell } from './published-shell';
export { renderPublicHero, renderPublicShell };

/** Category sections over a set of items: section order is the category's
 *  displayOrder, the Uncategorized bucket (null) always last; within a
 *  section the manual series order wins, newest first as a tiebreak. */
function groupByCategory<T extends ListingPlacement>(
  items: T[],
): ListingCategoryGroup<T>[] {
  const INF = Number.POSITIVE_INFINITY;
  const catBuckets = new Map<string | null, T[]>();
  const catOrder = new Map<string | null, number>();
  for (const it of items) {
    const key = it.categoryName ?? null;
    (catBuckets.get(key) ?? catBuckets.set(key, []).get(key)!).push(it);
    catOrder.set(key, Math.min(catOrder.get(key) ?? INF, it.categoryOrder ?? INF));
  }
  return [...catBuckets.entries()]
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
}

/** One season's slice of the public workspace listing (ADR-011), its items in
 *  category sections. */
export interface ListingSeasonGroup<T extends ListingPlacement = WorkspaceIndexItem> {
  /** null = the undated bucket, always last. */
  season: string | null;
  groups: ListingCategoryGroup<T>[];
}

/**
 * Partition the flat listing into season slices, newest season first, each
 * grouped by category (ADR-011 — the public workspace index shows the current
 * season expanded and prior seasons collapsed; the archived-based "Past
 * results" partition retired in its favour). Pure, so the ordering rules are
 * unit-tested directly.
 */
export function groupWorkspaceListingBySeason<T extends ListingPlacement>(
  items: T[],
): ListingSeasonGroup<T>[] {
  const buckets = new Map<string | null, T[]>();
  for (const it of items) {
    const key = it.season ?? null;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(it);
  }
  return [...buckets.entries()]
    .map(([season, list]) => ({ season, groups: groupByCategory(list) }))
    .sort((a, b) => {
      if (a.season === null) return 1;
      if (b.season === null) return -1;
      return b.season.localeCompare(a.season);
    });
}

/** A category heading that would merely repeat its season label is noise —
 *  the `category = year` filing hack of the archive corpora — so the season
 *  view suppresses it. */
export function suppressCategoryHeading(
  categoryName: string | null,
  season: string | null,
): boolean {
  return categoryName !== null && categoryName === season;
}

/**
 * Partition the flat listing into active category sections and archived
 * "Past results" year sections. The public workspace index moved to the
 * season partition (ADR-011 — `groupWorkspaceListingBySeason`); this remains
 * the in-app management page's partition (#292).
 *
 * Placement comes from each slug's representative series (see
 * `listPublishedByWorkspace`); a slug shared by several series under different
 * categories is fudged onto one section via that representative.
 */
export function groupWorkspaceListing<T extends ListingPlacement>(
  items: T[],
): WorkspaceListing<T> {
  const active: ListingCategoryGroup<T>[] = groupByCategory(
    items.filter((i) => !i.archived),
  );

  // Archived → year sections, newest year first; the undated bucket last.
  const yearBuckets = new Map<number | null, T[]>();
  for (const it of items.filter((i) => i.archived)) {
    const key = it.year ?? null;
    (yearBuckets.get(key) ?? yearBuckets.set(key, []).get(key)!).push(it);
  }
  const past: ListingYearGroup<T>[] = [...yearBuckets.entries()]
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

/** One event row of the public workspace index (ADR-011): an interior folder
 *  of a season's own slug, a root page of one, or a whole legacy top-level
 *  folder — with the page links that jump straight to a results table. */
export interface IndexEvent extends ListingPlacement {
  /** Stable row key for the picker's filtering. */
  key: string;
  label: string;
  href: string;
  pages: { label: string; href: string }[];
}

type EventPage = TreePage & {
  ownerCategory: string | null;
  ownerCategoryOrder: number;
};

function contributorPages(it: WorkspaceIndexItem): EventPage[] {
  return (it.contributors ?? []).flatMap((c) => {
    const single = c.pages.filter((p) => !p.isPrizes).length === 1;
    return c.pages.map((p) => ({
      ...p,
      ownerName: c.title,
      ownerSingle: single,
      ownerCategory: c.categoryName ?? null,
      ownerCategoryOrder: c.categoryOrder ?? Number.POSITIVE_INFINITY,
    }));
  });
}

/**
 * Explode the listing's slug items into event rows (ADR-011). A slug that is
 * its season's own folder (the archive shape) contributes one row per
 * interior folder and per root page — the season card that would otherwise
 * wrap them says nothing a season heading doesn't. Any other slug is one
 * event row. Categories come from the contributing series, so an exploded
 * event keeps its own filing (e.g. HYC's Open Events vs Club Racing).
 */
export function workspaceIndexEvents(
  workspaceSlug: string,
  items: WorkspaceIndexItem[],
  /** Folder metadata (ADR-011): label pins override derived folder names. */
  folderMeta?: Map<string, { label: string | null }>,
): IndexEvent[] {
  const events: IndexEvent[] = [];
  for (const it of items) {
    const base = `/p/${workspaceSlug}/${it.slug}`;
    const labels = folderMeta
      ? interiorFolderLabels(folderMeta, it.slug)
      : undefined;
    const season = it.season ?? null;
    const pages = contributorPages(it);
    // A season's own folder explodes into its events — but only when the
    // page data to explode is present; a bare item stays one row.
    const isSeasonFolder =
      season !== null && kebab(season) === it.slug && pages.length > 0;
    const sole = (it.contributors?.length ?? 1) <= 1;
    if (!isSeasonFolder) {
      events.push({
        key: it.slug,
        label: it.title,
        href: base,
        categoryName: it.categoryName ?? null,
        categoryOrder: it.categoryOrder ?? null,
        seriesOrder: it.seriesOrder ?? null,
        publishedAt: it.publishedAt,
        season,
        pages: pages.map((p) => ({
          label: leafLabel(p, pages, sole),
          href: `${base}/${p.subPath}`,
        })),
      });
      continue;
    }
    for (const f of slugFolders(pages, labels)) {
      const fp = pagesInFolder(pages, f.segment) as EventPage[];
      const cats = new Set(fp.map((p) => p.ownerCategory));
      const cat = cats.size === 1 ? [...cats][0] : null;
      events.push({
        key: `${it.slug}/${f.segment}`,
        label: f.label,
        href: `${base}/${f.segment}`,
        categoryName: cat,
        categoryOrder:
          cat !== null ? Math.min(...fp.map((p) => p.ownerCategoryOrder)) : null,
        seriesOrder: null,
        publishedAt: it.publishedAt,
        season,
        pages: fp.map((p) => ({
          label: leafLabel(p, fp, sole),
          href: `${base}/${p.subPath}`,
        })),
      });
    }
    const roots = rootPages(pages) as EventPage[];
    for (const p of roots) {
      events.push({
        key: `${it.slug}/${p.subPath}`,
        label: leafLabel(p, roots, sole),
        href: `${base}/${p.subPath}`,
        categoryName: p.ownerCategory,
        categoryOrder: p.ownerCategory !== null ? p.ownerCategoryOrder : null,
        seriesOrder: null,
        publishedAt: it.publishedAt,
        season,
        pages: [],
      });
    }
  }
  return events;
}

/**
 * Workspace listing at `/p/{ws}` (ADR-011). The unit is the *event* — a
 * season slug's interior folders and root pages, or a whole legacy top-level
 * folder — each row linking its index and its results pages directly. Events
 * group by season, every season a collapsible section with the current one
 * open, categories as headings within (suppressed where they merely repeat
 * the season). A workspace with one season and no categories collapses to a
 * flat list with no chrome.
 */
export function renderWorkspaceIndexHtml(
  workspaceSlug: string,
  workspaceName: string,
  items: WorkspaceIndexItem[],
  logoUrl = '',
  opts: {
    competitorsLink?: boolean;
    /** Whether the workspace has any public rankings — one forward link to
     *  the ranking index, not a link per ladder: the series results are the
     *  page's focus. */
    rankingsLink?: boolean;
    /** The workspace's current season (expanded by default); absent → the
     *  newest season. */
    currentSeason?: string;
    /** Folder metadata (ADR-011): label pins for event rows. */
    folderMeta?: Map<string, { label: string | null }>;
  } = {},
): string {
  const heading = `${esc(workspaceName)} &mdash; published results`;
  const hero = renderPublicHero(heading, logoUrl);
  // Forward links to the competitor and ranking indexes, when there's
  // something behind them.
  const competitorsLink =
    (opts.competitorsLink
      ? `<p class="browse"><a href="/p/${esc(workspaceSlug)}/competitors">Browse competitors &rarr;</a></p>`
      : '') +
    (opts.rankingsLink
      ? `<p class="browse"><a href="/p/${esc(workspaceSlug)}/rankings">Browse rankings &rarr;</a></p>`
      : '');
  if (items.length === 0) {
    return renderPublicShell(
      `${workspaceName} — published results`,
      hero,
      `${competitorsLink}<p class="empty">No published results yet.</p>`,
    );
  }

  const row = (e: IndexEvent) => {
    const pageLinks = e.pages
      .map((p) => `<a href="${esc(p.href)}">${esc(p.label)}</a>`)
      .join(' &middot; ');
    return `<li data-season="${esc(e.season ?? '')}" data-cat="${esc(e.categoryName ?? '')}" data-event="${esc(e.key)}"><a class="evt" href="${esc(e.href)}">${esc(e.label)}</a>${pageLinks ? `<span class="pages">${pageLinks}</span>` : ''}</li>`;
  };
  const list = (rows: IndexEvent[]) =>
    `<ul class="listing">\n${rows.map(row).join('\n')}\n</ul>`;
  // Each heading + list pairs inside a `section.lgroup` so the quick-jump
  // picker can hide a section its filter empties, heading and all.
  const section = (heading: string, rows: IndexEvent[]) =>
    `<section class="lgroup">\n${heading}${list(rows)}\n</section>`;

  const seasons = groupWorkspaceListingBySeason(
    workspaceIndexEvents(workspaceSlug, items, opts.folderMeta),
  );

  const seasonInner = (s: ListingSeasonGroup<IndexEvent>) =>
    s.groups
      .map((g) => {
        const noHeading =
          (g.categoryName === null && s.groups.length === 1) ||
          suppressCategoryHeading(g.categoryName, s.season) ||
          // A heading over a single row that reads the same is pure echo —
          // the event-family-as-category shape, where most seasons hold one
          // event per family.
          (g.items.length === 1 && g.items[0].label === g.categoryName);
        return section(
          noHeading
            ? ''
            : `<h3 class="cat">${esc(g.categoryName ?? 'Uncategorized')}</h3>\n`,
          g.items,
        );
      })
      .join('\n');

  let sections: string;
  if (seasons.length <= 1) {
    // A single season needs no season chrome.
    sections = seasons[0] ? seasonInner(seasons[0]) : section('', []);
  } else {
    const openLabel =
      opts.currentSeason !== undefined &&
      seasons.some((s) => s.season === opts.currentSeason)
        ? opts.currentSeason
        : seasons[0].season;
    // Every season is collapsible; the current one starts open (`data-open`
    // remembers the default so the picker can restore it after filtering).
    sections = seasons
      .map((s) => {
        const open = s.season === openLabel;
        return `<details class="season"${open ? ' open data-open' : ''}><summary>${esc(s.season ?? 'Undated')}</summary>\n${seasonInner(s)}\n</details>`;
      })
      .join('\n');
  }

  const picker = renderQuickJumpPicker(seasons);

  return renderPublicShell(
    `${workspaceName} — published results`,
    hero,
    `${competitorsLink}${picker.controls}${sections}${picker.script}`,
  );
}

/**
 * The quick-jump picker above the workspace listing (#320/ADR-011): Season /
 * Category / Event filter selects. The selects only ever *filter* — the rows
 * beneath carry the actual links (each event row links its pages directly),
 * so nothing navigates on `change` and a couple of selections put the wanted
 * table one click away. Population cascades: with several seasons the Event
 * select stays empty until a season is chosen, and Category narrows to the
 * chosen season's categories.
 *
 * Progressive enhancement: the controls ship `hidden` and are revealed by the
 * inline script, which reads the embedded JSON — no framework, no external
 * requests, nothing to see without JS. Degenerate dimensions (one season, one
 * category) don't render their select, and a workspace with fewer than two
 * events gets no picker at all.
 */
function renderQuickJumpPicker(
  seasons: ListingSeasonGroup<IndexEvent>[],
): { controls: string; script: string } {
  // Display order: seasons newest first, matching the listing below.
  const events = seasons.flatMap((s) => s.groups.flatMap((g) => g.items));
  if (events.length < 2) return { controls: '', script: '' };

  const seasonValues = seasons
    .map((s) => s.season)
    .filter((s): s is string => s != null);
  // Categories in section order across the seasons; a category that merely
  // repeats a season label (the archive filing hack) never appears.
  const cats = [
    ...new Set(
      seasons.flatMap((s) =>
        s.groups
          .filter((g) => !suppressCategoryHeading(g.categoryName, s.season))
          .map((g) => g.categoryName),
      ),
    ),
  ].filter((c): c is string => c != null);

  const multiSeason = seasonValues.length >= 2;
  const data = {
    multiSeason,
    events: events.map((e) => ({
      key: e.key,
      label: e.label,
      season: e.season ?? null,
      cat: e.categoryName ?? null,
    })),
  };

  const seasonSelect = multiSeason
    ? `<select id="picker-year" aria-label="Season"><option value="">All seasons</option>${seasonValues
        .map((s) => `<option value="${esc(s)}">${esc(s)}</option>`)
        .join('')}</select>`
    : '';
  const catSelect =
    cats.length >= 2
      ? `<select id="picker-cat" aria-label="Category"><option value="">All categories</option>${cats
          .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
          .join('')}</select>`
      : '';
  const controls = `<div class="picker" hidden>${seasonSelect}${catSelect}<select id="picker-series" aria-label="Event or series"><option value="">All events</option></select></div>\n`;

  // `<` escaped so an adversarial series title can't close the script tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const script = `\n<script type="application/json" id="picker-data">${json}</script>\n<script>${PICKER_SCRIPT}</script>`;
  return { controls, script };
}

/** The picker's behaviour. Runs after the listing markup (the script tag sits
 *  at the end of the body content), so every `li[data-slug]` exists. */
const PICKER_SCRIPT = `(function () {
  var data = JSON.parse(document.getElementById('picker-data').textContent);
  var yearSel = document.getElementById('picker-year');
  var catSel = document.getElementById('picker-cat');
  var eventSel = document.getElementById('picker-series');
  function matches(e, y, c) {
    if (y && (e.season || '') !== y) return false;
    if (c && e.cat !== c) return false;
    return true;
  }
  function option(value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }
  function refresh() {
    var y = yearSel ? yearSel.value : '';
    // Category sits downstream of Season in the cascade: its options narrow
    // to the categories with an event in the selected season, keeping the
    // selection when it survives. A category repeating its season label (the
    // archive filing hack) is skipped.
    var c = '';
    if (catSel) {
      var keepCat = catSel.value;
      var cats = [];
      data.events.forEach(function (e) {
        if (!e.cat || e.cat === e.season || cats.indexOf(e.cat) !== -1) return;
        if (y && (e.season || '') !== y) return;
        cats.push(e.cat);
      });
      catSel.textContent = '';
      catSel.appendChild(option('', 'All categories'));
      cats.forEach(function (cat) { catSel.appendChild(option(cat, cat)); });
      catSel.value = keepCat;
      if (catSel.value !== keepCat) catSel.value = '';
      c = catSel.value;
    }
    // The Event select cascades from Season: with several seasons it stays
    // empty until one is chosen, so it never lists the whole archive.
    var keep = eventSel.value;
    eventSel.textContent = '';
    if (data.multiSeason && !y) {
      eventSel.appendChild(option('', 'Choose a season\u2026'));
      eventSel.disabled = true;
    } else {
      eventSel.disabled = false;
      eventSel.appendChild(option('', 'All events'));
      data.events.forEach(function (e) {
        if (matches(e, y, c)) eventSel.appendChild(option(e.key, e.label));
      });
      eventSel.value = keep;
      if (eventSel.value !== keep) eventSel.value = '';
    }
    var sel = eventSel.disabled ? '' : eventSel.value;
    var filtering = !!(y || c || sel);
    document.querySelectorAll('li[data-event]').forEach(function (li) {
      var e = {
        season: li.getAttribute('data-season') || null,
        cat: li.getAttribute('data-cat') || null,
      };
      var show =
        matches(e, y, c) && (!sel || li.getAttribute('data-event') === sel);
      li.style.display = show ? '' : 'none';
    });
    var anyVisibleIn = function (root) {
      var any = false;
      root.querySelectorAll('li[data-event]').forEach(function (li) {
        if (li.style.display !== 'none') any = true;
      });
      return any;
    };
    document.querySelectorAll('section.lgroup').forEach(function (sec) {
      sec.style.display = anyVisibleIn(sec) ? '' : 'none';
    });
    // Season sections: hide an emptied one; a filter opens the collapsed
    // seasons that still match, and clearing it restores the default state.
    document.querySelectorAll('details.season').forEach(function (d) {
      var any = anyVisibleIn(d);
      d.style.display = any ? '' : 'none';
      d.open = filtering ? any : d.hasAttribute('data-open');
    });
  }
  [yearSel, catSel, eventSel].forEach(function (sel) {
    if (sel) sel.addEventListener('change', refresh);
  });
  refresh();
  document.querySelector('.picker').hidden = false;
})();`;

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
  /** Pre-rendered navigation-cascade fragment (ADR-011), above the listing. */
  nav = '',
): string {
  const renderFlatList = (pages: SeriesIndexPage[]): string => {
    // A lone results page reads better as "Standings" than as its (possibly
    // synthetic "Default") fleet name; the prize sheet always keeps its own
    // name, and doesn't stop a lone sibling fleet page reading as standings.
    const single = pages.filter((p) => !p.isPrizes).length === 1;
    return `<ul class="listing">
${pages
  .map((p) => {
    const label = !p.isPrizes && single ? loneResultsPageLabel(p) : p.fleetName;
    return `<li><a href="/p/${esc(workspaceSlug)}/${esc(slug)}/${esc(p.subPath)}">${esc(label)}</a></li>`;
  })
  .join('\n')}
</ul>`;
  };

  // Sub-series pages group under their block name, in page order; any
  // whole-series pages (no block) list first. A block heading links to its
  // folder index (ADR-011) when its pages live under a folder segment.
  const renderList = (pages: SeriesIndexPage[]): string => {
    const blockNames = [...new Set(pages.map((p) => p.subSeriesName).filter((n): n is string => !!n))];
    if (blockNames.length === 0) return renderFlatList(pages);
    const blockless = pages.filter((p) => !p.subSeriesName);
    const parts: string[] = [];
    if (blockless.length > 0) parts.push(renderFlatList(blockless));
    for (const name of blockNames) {
      const blockPages = pages.filter((p) => p.subSeriesName === name);
      const seg = blockPages[0].subPath.includes('/')
        ? blockPages[0].subPath.split('/')[0]
        : null;
      const heading = seg
        ? `<a href="/p/${esc(workspaceSlug)}/${esc(slug)}/${esc(seg)}">${esc(name)}</a>`
        : esc(name);
      parts.push(`<h3 class="subseries">${heading}</h3>`);
      parts.push(renderFlatList(blockPages));
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
  return renderPublicShell(title, hero, `${back}\n${nav}${sections}`);
}

/** The public ranking index at `/p/{ws}/rankings` (#209/#309): the live
 *  computed ladders first, then the as-published historical rankings,
 *  newest season first. */
export function renderRankingIndexHtml(
  workspaceSlug: string,
  workspaceName: string,
  entries: Array<{ name: string; slug: string }>,
  logoUrl = '',
): string {
  const hero = renderPublicHero(
    `${esc(workspaceName)} &mdash; rankings`,
    logoUrl,
  );
  const back = `<p class="back"><a href="/p/${esc(workspaceSlug)}">&larr; ${esc(workspaceName)}</a></p>`;
  const rows = entries
    .map(
      (r) =>
        `<li><a href="/p/${esc(workspaceSlug)}/ranking/${esc(r.slug)}">${esc(r.name)}</a></li>`,
    )
    .join('\n');
  return renderPublicShell(
    `${workspaceName} — rankings`,
    hero,
    `${back}\n<ul class="listing">\n${rows}\n</ul>`,
  );
}
