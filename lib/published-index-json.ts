/**
 * The machine-readable index of a workspace's publications (#669): the JSON
 * twin of the workspace and season indexes the publication tree renders
 * (ADR-011), served at
 *
 *   /p/{workspace}/index.json
 *   /p/{workspace}/{season}/index.json
 *
 * so a third-party app can find every published series — its pages and its
 * `.sailscoring.json` data file — without scraping HTML or being handed one
 * URL per series. It lists only what is already published, labelled and
 * placed exactly as the HTML tree places it, so the two never disagree.
 *
 * The format is a public API surface, versioned like the public export:
 * `docs/public-index-format.md` is its reference.
 */

import { humanizeSlug, isSyntheticFleetName } from './publishing';
import { fleetPageLabel, isAuxiliaryPage } from './published-index';
import { folderSegmentOf, publicationPath, sharedFolderSegment } from './published-tree';
import type { PublishedSeason } from './published-repository';
import type { PublicationSummary, PublishedSeriesPage } from './types';

/** The index format's version. Additive optional fields leave it alone;
 *  a removal or a change of meaning bumps it. */
export const PUBLIC_INDEX_VERSION = 1;

/** What a published page is, for a reader choosing which to show. */
export type PublicIndexPageKind =
  | 'standings'
  | 'race-results'
  | 'prizes'
  | 'entry-list'
  | 'other';

export interface PublicIndexPage {
  /** The page's label as the published navigation shows it. */
  label: string;
  kind: PublicIndexPageKind;
  /** The fleet whose results the page holds, when it is one fleet's. */
  fleet?: string;
  /** The sub-series (block) the page covers, when not the whole series. */
  subSeries?: string;
  url: string;
}

export interface PublicIndexPublication {
  /** The series' name — for an orphaned publication (its series since
   *  deleted), the name of the folder it sits in. */
  name: string;
  /** The season it files under; null when it has none. */
  season: string | null;
  /** The top-level folder it is published into. */
  folder: { slug: string; label: string; url: string };
  /** The event folder inside it, when the publication's pages share one. */
  event?: { segment: string; label: string; url: string };
  /** The publication's own landing page. */
  url: string;
  pages: PublicIndexPage[];
  /** Its `.sailscoring.json` data file; null when the series opted out of
   *  the JSON export or publishes none. */
  data: string | null;
  /** Its fleets, with each one's scoring system where known. */
  fleets: { name: string; scoringSystem?: string }[];
  /** ISO time of the last publish — a poller can skip an unchanged series
   *  without fetching its data file. */
  publishedAt: string;
  /** `YYYY-MM-DD` of the first and last race; null when not recorded. */
  firstRaceDate: string | null;
  lastRaceDate: string | null;
  /** Races sailed and boats entered; absent when not recorded. */
  races?: number;
  boats?: number;
}

export interface PublicIndex {
  version: number;
  workspace: { slug: string; name: string; url: string; logo?: string };
  seasons: { label: string; current: boolean; url: string; index: string }[];
  publications: PublicIndexPublication[];
}

/** One publication row as the builder reads it. */
export interface PublicIndexInputRow {
  slug: string;
  seriesName: string | null;
  pages: Omit<PublishedSeriesPage, 'blobUrl'>[];
  dataSubPath: string | null;
  summary: PublicationSummary | null;
  publishedAt: number;
}

function pageKind(page: Omit<PublishedSeriesPage, 'blobUrl'>): PublicIndexPageKind {
  if (page.isPrizes) return 'prizes';
  if (page.isEntryList) return 'entry-list';
  if (isAuxiliaryPage(page)) return 'other';
  return page.isRaceResults ? 'race-results' : 'standings';
}

/** Path segments escaped for a URL; `/` separators kept. */
function pathOf(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split('/'))
    .map(encodeURIComponent)
    .join('/');
}

/**
 * Build the index document. `seasonTree` is the workspace's assembled season
 * tree (its folder labels are the tree's own); `folderMeta` carries the
 * interior-folder label pins. `season`, when given, narrows the document to
 * that season — the season index. Publications are listed in tree order:
 * newest season first, each season's folders as the tree orders them, each
 * folder's series in display order; undated folders last.
 */
export function buildPublicIndex(input: {
  /** Absolute origin URLs are built on, e.g. `https://app.sailscoring.ie`. */
  origin: string;
  workspace: { slug: string; name: string; logo: string };
  seasonTree: { seasons: PublishedSeason[]; undated: { slug: string; label: string }[] };
  folderMeta: Map<string, { label: string | null }>;
  publications: PublicIndexInputRow[];
  season?: string;
}): PublicIndex {
  const { origin, workspace, seasonTree, folderMeta } = input;
  const base = `${origin}/p/${encodeURIComponent(workspace.slug)}`;

  const bySlug = new Map<string, PublicIndexInputRow[]>();
  for (const p of input.publications) {
    const list = bySlug.get(p.slug) ?? [];
    list.push(p);
    bySlug.set(p.slug, list);
  }

  const seasons = seasonTree.seasons.filter(
    (s) =>
      s.folders.length > 0 &&
      (input.season === undefined || s.label === input.season),
  );
  const placed: { season: string | null; folder: { slug: string; label: string } }[] = [
    ...seasons.flatMap((s) => s.folders.map((folder) => ({ season: s.label, folder }))),
    ...(input.season === undefined
      ? seasonTree.undated.map((folder) => ({ season: null, folder }))
      : []),
  ];

  const publications = placed.flatMap(({ season, folder }) => {
    const group = bySlug.get(folder.slug) ?? [];
    const slugShared = group.length > 1;
    return group.map((p): PublicIndexPublication => {
      const single = p.pages.filter((pg) => !isAuxiliaryPage(pg)).length === 1;
      const segment = sharedFolderSegment(
        p.pages.filter((pg) => !isAuxiliaryPage(pg)).map((pg) => pg.subPath),
      );
      const event =
        segment !== null
          ? {
              segment,
              label:
                folderMeta.get(`${folder.slug}/${segment}`)?.label ??
                eventLabel(p.pages, segment),
              url: `${base}/${pathOf(folder.slug, segment)}`,
            }
          : undefined;
      const summary = p.summary;
      return {
        name: p.seriesName ?? folder.label,
        season,
        folder: { ...folder, url: `${base}/${pathOf(folder.slug)}` },
        ...(event ? { event } : {}),
        url: `${base}/${pathOf(publicationPath(folder.slug, p.pages, slugShared))}`,
        pages: p.pages.map((pg) => {
          const kind = pageKind(pg);
          const isFleetPage =
            (kind === 'standings' || kind === 'race-results') &&
            !pg.isNamedPage &&
            !isSyntheticFleetName(pg.fleetName);
          return {
            label: fleetPageLabel(pg, single),
            kind,
            ...(isFleetPage ? { fleet: pg.fleetName } : {}),
            ...(pg.subSeriesName ? { subSeries: pg.subSeriesName } : {}),
            url: `${base}/${pathOf(folder.slug, pg.subPath)}`,
          };
        }),
        data: p.dataSubPath ? `${base}/${pathOf(folder.slug, p.dataSubPath)}` : null,
        fleets: summary
          ? summary.fleets.map((f) => ({
              name: f.name,
              ...(f.scoringSystem ? { scoringSystem: f.scoringSystem } : {}),
            }))
          : pageFleets(p.pages),
        publishedAt: new Date(p.publishedAt).toISOString(),
        firstRaceDate: summary?.firstRaceDate ?? null,
        lastRaceDate: summary?.lastRaceDate ?? null,
        ...(summary ? { races: summary.races, boats: summary.boats } : {}),
      };
    });
  });

  return {
    version: PUBLIC_INDEX_VERSION,
    workspace: {
      slug: workspace.slug,
      name: workspace.name,
      url: base,
      ...(workspace.logo ? { logo: absolute(origin, workspace.logo) } : {}),
    },
    seasons: seasons.map((s) => ({
      label: s.label,
      current: s.current,
      url: `${base}/${pathOf(s.segment)}`,
      index: `${base}/${pathOf(s.segment)}/index.json`,
    })),
    publications,
  };
}

/** An event folder's label when no pin names it: its pages' sub-series name
 *  when they agree on one, else the humanised segment — the tree's rule. */
function eventLabel(
  pages: Omit<PublishedSeriesPage, 'blobUrl'>[],
  segment: string,
): string {
  const names = new Set(
    pages
      .filter((p) => folderSegmentOf(p.subPath) === segment && p.subSeriesName)
      .map((p) => p.subSeriesName!),
  );
  return names.size === 1 ? [...names][0] : humanizeSlug(segment);
}

/** The fleets a publication's pages name, for a row with no stored summary. */
function pageFleets(
  pages: Omit<PublishedSeriesPage, 'blobUrl'>[],
): { name: string }[] {
  const names = new Set(
    pages
      .filter((p) => !isAuxiliaryPage(p) && !p.isNamedPage && !isSyntheticFleetName(p.fleetName))
      .map((p) => p.fleetName),
  );
  return [...names].map((name) => ({ name }));
}

/** A logo reference made absolute: workspace logos are stored as
 *  site-relative paths (`/logos/{id}`) or full URLs. */
function absolute(origin: string, url: string): string {
  return /^https?:\/\//.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}
