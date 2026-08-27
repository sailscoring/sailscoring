import 'server-only';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { getDb } from './db/client';
import * as schema from './db/schema';
import { humanizeSlug, kebab } from './publishing';
import { publicationPath, seasonLikeSlug } from './published-tree';
import type { PublishedSeries } from './types';

/**
 * Server-side data access for `published_series` (ADR-008 Phase 9/10, #153).
 *
 * A publication is identified by `(workspace_id, slug)` and is decoupled from
 * its series (`series_id` nullable — null = orphaned). `save` upserts by `id`,
 * which covers all three cases the handler drives: first publish (new id),
 * re-publish (the series' existing row), and orphan takeover (an orphaned
 * row's id, repointed to the new series). There is no concurrency column —
 * publish is the only writer.
 */

type PublishedRow = typeof schema.publishedSeries.$inferSelect;

function rowToPublished(row: PublishedRow): PublishedSeries {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    seriesId: row.seriesId,
    slug: row.slug,
    pages: row.pages,
    contentHash: row.contentHash,
    publishedAt: row.publishedAt.getTime(),
    publishedVersion: row.publishedVersion,
  };
}

/** The live publication for a series, or null if it has never been published. */
export async function getPublishedBySeries(
  seriesId: string,
): Promise<PublishedSeries | null> {
  const [row] = await getDb()
    .select()
    .from(schema.publishedSeries)
    .where(eq(schema.publishedSeries.seriesId, seriesId))
    .limit(1);
  return row ? rowToPublished(row) : null;
}

/** Map each given series id to the public path its publication lives at,
 *  omitting any that aren't published. Where a slug holds several publications
 *  the path descends past it to the event itself (see `publicationPath`), so a
 *  link lands on the event rather than on the season listing it. Two queries
 *  for a whole career arc — the publications, then how crowded their slugs
 *  are — so its timeline can deep-link every event with a public results page.
 *  Workspace-scoped. */
export async function getPublishedPathsBySeries(
  workspaceId: string,
  seriesIds: string[],
): Promise<Map<string, string>> {
  if (seriesIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      seriesId: schema.publishedSeries.seriesId,
      slug: schema.publishedSeries.slug,
      pages: schema.publishedSeries.pages,
    })
    .from(schema.publishedSeries)
    .where(
      and(
        eq(schema.publishedSeries.workspaceId, workspaceId),
        inArray(schema.publishedSeries.seriesId, seriesIds),
      ),
    );
  if (rows.length === 0) return new Map();

  // How many publications sit in each slug the arc touches. Counted rather
  // than inferred from `rows`: the other occupants are usually series this
  // sailor never entered, so the arc's own rows can't see the crowd.
  const slugs = [...new Set(rows.map((r) => r.slug))];
  const counts = await getDb()
    .select({
      slug: schema.publishedSeries.slug,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.publishedSeries)
    .where(
      and(
        eq(schema.publishedSeries.workspaceId, workspaceId),
        inArray(schema.publishedSeries.slug, slugs),
      ),
    )
    .groupBy(schema.publishedSeries.slug);
  const occupants = new Map(counts.map((c) => [c.slug, c.n]));

  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.seriesId) continue;
    const shared = (occupants.get(r.slug) ?? 1) > 1;
    map.set(r.seriesId, publicationPath(r.slug, r.pages, shared));
  }
  return map;
}

/** The set of series ids that have a live publication in the workspace. One
 *  query, used to filter the public competitor index down to published series
 *  (an unpublished series is the club's explicit "not public"). */
export async function listPublishedSeriesIds(
  workspaceId: string,
): Promise<Set<string>> {
  const rows = await getDb()
    .select({ seriesId: schema.publishedSeries.seriesId })
    .from(schema.publishedSeries)
    .where(eq(schema.publishedSeries.workspaceId, workspaceId));
  const ids = new Set<string>();
  for (const r of rows) if (r.seriesId) ids.add(r.seriesId);
  return ids;
}

/** The publication identified by its stable `id`, or null. Drives the
 *  workspace management page's unpublish-by-id path (#164), which addresses a
 *  publication directly — including an orphan whose series is gone. */
export async function getPublishedById(
  id: string,
): Promise<PublishedSeries | null> {
  const [row] = await getDb()
    .select()
    .from(schema.publishedSeries)
    .where(eq(schema.publishedSeries.id, id))
    .limit(1);
  return row ? rowToPublished(row) : null;
}

/** Every publication sharing `(workspaceId, slug)`. A slug is a shared
 *  namespace, so this can be more than one series' publication; the public read
 *  path unions their pages (sub-heading each series in this order) and the
 *  publish handler checks the group for sub-path collisions. Empty when nothing
 *  is published at the slug.
 *
 *  Ordered by the contributing series' manual `displayOrder` so the
 *  series-index page mirrors the in-app series order rather than publish
 *  recency; `publishedAt desc` is the tiebreak, and an orphaned publication
 *  (series deleted, no `displayOrder`) sorts last via NULLS LAST. The two
 *  order-insensitive callers (publish handler, single-fleet read) use `.find`
 *  on the result, so this only changes the rendered series-index order. */
export async function getPublishedGroupByWorkspaceSlug(
  workspaceId: string,
  slug: string,
): Promise<PublishedSeries[]> {
  const rows = await getDb()
    .select({
      id: schema.publishedSeries.id,
      workspaceId: schema.publishedSeries.workspaceId,
      seriesId: schema.publishedSeries.seriesId,
      slug: schema.publishedSeries.slug,
      pages: schema.publishedSeries.pages,
      contentHash: schema.publishedSeries.contentHash,
      publishedAt: schema.publishedSeries.publishedAt,
      publishedVersion: schema.publishedSeries.publishedVersion,
    })
    .from(schema.publishedSeries)
    .leftJoin(
      schema.series,
      eq(schema.publishedSeries.seriesId, schema.series.id),
    )
    .where(
      and(
        eq(schema.publishedSeries.workspaceId, workspaceId),
        eq(schema.publishedSeries.slug, slug),
      ),
    )
    .orderBy(
      asc(schema.series.displayOrder),
      desc(schema.publishedSeries.publishedAt),
    );
  return rows.map(rowToPublished);
}

/** Resolve a workspace (id + display name + own logo) from its public slug.
 *  Drives the public route's workspace lookup, listing heading and hero logo
 *  (#162). */
export async function getWorkspaceBySlug(
  workspaceSlug: string,
): Promise<{ id: string; name: string; logo: string } | null> {
  const [row] = await getDb()
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      logo: schema.organization.logo,
    })
    .from(schema.organization)
    .where(eq(schema.organization.slug, workspaceSlug))
    .limit(1);
  return row ? { id: row.id, name: row.name, logo: row.logo ?? '' } : null;
}

/** The display name of a series, or null if it no longer exists (orphaned
 *  publication). Unscoped — published pages are public, and the name already
 *  appears in the rendered results. Drives the series-listing title (#162). */
export async function getSeriesName(seriesId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ name: schema.series.name })
    .from(schema.series)
    .where(eq(schema.series.id, seriesId))
    .limit(1);
  return row?.name ?? null;
}

/** Calendar year parsed from an ISO start-date string ("YYYY-MM-DD"); null if
 *  unset or unparseable. Mirrors `seriesEventYear` (lib/series-list.ts) for the
 *  public listing's "Past results" year grouping. */
function yearOf(startDate: string | null): number | null {
  const m = /^(\d{4})/.exec(startDate ?? '');
  return m ? Number(m[1]) : null;
}

/** Every published slug in a workspace, newest first, for the public listing
 *  (#162). One entry per slug — contributions from several series sharing a
 *  slug collapse into a single row: `fleetCount` sums their pages, `publishedAt`
 *  is the most recent, and the title is the lone contributor's series name or,
 *  when several share the slug, a humanised slug (no single name fits). An
 *  orphaned sole contributor falls back to the slug itself.
 *
 *  Each row also carries placement fields (category / archive / order / year)
 *  so the listing can mirror the in-app series organisation. They
 *  come from the slug's *representative* series — the most recently published
 *  contributor (rows are newest-first). When several series share a slug under
 *  different categories this is a deliberate fudge: the slug lands wherever its
 *  newest contributor sits. An orphaned publication (series deleted) reads as
 *  active and uncategorised.
 *
 *  `contributors` carries each publication sharing the slug — its own series
 *  name, placement (year / category) and fleet pages, in the in-app series
 *  order — for the quick-jump picker (#320), whose Series level is the
 *  contributing series, not the slug (an archive workspace publishes a whole
 *  year of series into one slug). Stripped of blob locators — this listing
 *  feeds a public page. */
export async function listPublishedByWorkspace(workspaceId: string): Promise<
  {
    slug: string;
    title: string;
    publishedAt: number;
    fleetCount: number;
    archived: boolean;
    categoryName: string | null;
    categoryOrder: number;
    seriesOrder: number;
    year: number | null;
    /** The season the slug files under (ADR-011): folder-metadata pin, a
     *  season-like slug, or the start-date year; null = undated. */
    season: string | null;
    contributors: {
      /** The contributing series' name; null for an orphaned publication. */
      title: string | null;
      year: number | null;
      categoryName: string | null;
      /** The category's displayOrder; Infinity when uncategorised. */
      categoryOrder: number;
      pages: {
        fleetName: string;
        subSeriesName?: string;
        isPrizes?: boolean;
        isEntryList?: boolean;
        isDefault?: boolean;
        isAuxiliary?: boolean;
        isNamedPage?: boolean;
        isRaceResults?: boolean;
        subPath: string;
      }[];
    }[];
  }[]
> {
  const rows = await getDb()
    .select({
      slug: schema.publishedSeries.slug,
      pages: schema.publishedSeries.pages,
      publishedAt: schema.publishedSeries.publishedAt,
      seriesName: schema.series.name,
      archived: schema.series.archived,
      seriesOrder: schema.series.displayOrder,
      startDate: schema.series.startDate,
      categoryName: schema.categories.name,
      categoryOrder: schema.categories.displayOrder,
    })
    .from(schema.publishedSeries)
    .leftJoin(
      schema.series,
      eq(schema.publishedSeries.seriesId, schema.series.id),
    )
    .leftJoin(
      schema.categories,
      eq(schema.series.categoryId, schema.categories.id),
    )
    .where(eq(schema.publishedSeries.workspaceId, workspaceId))
    .orderBy(desc(schema.publishedSeries.publishedAt));
  const meta = await getPublishedFolderMeta(workspaceId);

  type Rep = {
    archived: boolean;
    categoryName: string | null;
    categoryOrder: number;
    seriesOrder: number;
    year: number | null;
  };
  type PageEntry = {
    fleetName: string;
    subSeriesName?: string;
    isPrizes?: boolean;
    isEntryList?: boolean;
    isDefault?: boolean;
    isAuxiliary?: boolean;
    isNamedPage?: boolean;
    isRaceResults?: boolean;
    subPath: string;
  };
  type Contributor = {
    title: string | null;
    year: number | null;
    categoryName: string | null;
    categoryOrder: number;
    // Sort keys only — the in-app series order, publish recency as tiebreak
    // (mirroring getPublishedGroupByWorkspaceSlug); stripped before return.
    seriesOrder: number;
    publishedAt: number;
    pages: PageEntry[];
  };
  const groups = new Map<
    string,
    {
      publishedAt: number;
      fleetCount: number;
      names: (string | null)[];
      contributors: Contributor[];
      rep: Rep;
    }
  >();
  for (const r of rows) {
    let g = groups.get(r.slug);
    if (!g) {
      // Rows are newest-first, so the first row seen for a slug is its
      // representative; its series' category / order / archive state place the
      // slug on the listing.
      g = {
        publishedAt: 0,
        fleetCount: 0,
        names: [],
        contributors: [],
        rep: {
          archived: r.archived ?? false,
          categoryName: r.categoryName ?? null,
          categoryOrder: r.categoryOrder ?? Number.POSITIVE_INFINITY,
          seriesOrder: r.seriesOrder ?? Number.POSITIVE_INFINITY,
          year: yearOf(r.startDate),
        },
      };
      groups.set(r.slug, g);
    }
    g.publishedAt = Math.max(g.publishedAt, r.publishedAt.getTime());
    g.fleetCount += r.pages.length;
    g.names.push(r.seriesName);
    g.contributors.push({
      title: r.seriesName ?? null,
      year: yearOf(r.startDate),
      categoryName: r.categoryName ?? null,
      categoryOrder: r.categoryOrder ?? Number.POSITIVE_INFINITY,
      seriesOrder: r.seriesOrder ?? Number.POSITIVE_INFINITY,
      publishedAt: r.publishedAt.getTime(),
      pages: r.pages.map((p) => ({
        fleetName: p.fleetName,
        ...(p.subSeriesName ? { subSeriesName: p.subSeriesName } : {}),
        ...(p.isPrizes ? { isPrizes: true } : {}),
        ...(p.isEntryList ? { isEntryList: true } : {}),
        ...(p.isDefault ? { isDefault: true } : {}),
        ...(p.isAuxiliary ? { isAuxiliary: true } : {}),
        ...(p.isNamedPage ? { isNamedPage: true } : {}),
        ...(p.isRaceResults ? { isRaceResults: true } : {}),
        subPath: p.subPath,
      })),
    });
  }

  return [...groups.entries()]
    .map(([slug, g]) => ({
      slug,
      title:
        meta.get(slug)?.label ??
        (g.names.length === 1 ? (g.names[0] ?? slug) : humanizeSlug(slug)),
      publishedAt: g.publishedAt,
      fleetCount: g.fleetCount,
      archived: g.rep.archived,
      categoryName: g.rep.categoryName,
      categoryOrder: g.rep.categoryOrder,
      seriesOrder: g.rep.seriesOrder,
      year: g.rep.year,
      season: seasonOf(slug, meta.get(slug), g.rep.year),
      contributors: g.contributors
        .sort(
          // Not `a - b`: unordered rows are both Infinity and the difference
          // would be NaN, which sorts unpredictably.
          (a, b) =>
            (a.seriesOrder < b.seriesOrder
              ? -1
              : a.seriesOrder > b.seriesOrder
                ? 1
                : 0) || b.publishedAt - a.publishedAt,
        )
        .map(({ title, year, categoryName, categoryOrder, pages }) => ({
          title,
          year,
          categoryName,
          categoryOrder,
          pages,
        })),
    }))
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * The freshness inputs for the public workspace listing, without the `pages`
 * JSONB. Same rows, joins and ordering as {@link listPublishedByWorkspace} —
 * only the page detail is condensed, into an `md5` Postgres computes so the
 * column itself never crosses the wire.
 *
 * The listing needs the full page lists to render, but a client revalidating a
 * copy it already holds does not. Reading this first lets an unchanged page
 * answer 304 without transferring every publication's pages, which on a
 * workspace with a large archive is the bulk of the request.
 *
 * One row per publication rather than per slug: everything the grouped listing
 * derives — the title, the season, `fleetCount`, the representative series'
 * placement — is a function of these fields plus the folder metadata the
 * caller already folds into the ETag, so hashing the rows is a sound (and
 * slightly broader) basis than hashing the grouped result.
 */
export async function listPublishedByWorkspaceDigest(
  workspaceId: string,
): Promise<
  {
    slug: string;
    seriesId: string | null;
    publishedAt: number;
    publishedVersion: number;
    contentHash: string;
    pagesHash: string;
    seriesName: string | null;
    archived: boolean | null;
    seriesOrder: number | null;
    startYear: number | null;
    categoryName: string | null;
    categoryOrder: number | null;
  }[]
> {
  const rows = await getDb()
    .select({
      slug: schema.publishedSeries.slug,
      seriesId: schema.publishedSeries.seriesId,
      publishedAt: schema.publishedSeries.publishedAt,
      publishedVersion: schema.publishedSeries.publishedVersion,
      contentHash: schema.publishedSeries.contentHash,
      // jsonb has a canonical text form, so this digest is stable for a given
      // stored value — the same page list always hashes the same way.
      pagesHash: sql<string>`md5(${schema.publishedSeries.pages}::text)`,
      seriesName: schema.series.name,
      archived: schema.series.archived,
      seriesOrder: schema.series.displayOrder,
      startDate: schema.series.startDate,
      categoryName: schema.categories.name,
      categoryOrder: schema.categories.displayOrder,
    })
    .from(schema.publishedSeries)
    .leftJoin(
      schema.series,
      eq(schema.publishedSeries.seriesId, schema.series.id),
    )
    .leftJoin(
      schema.categories,
      eq(schema.series.categoryId, schema.categories.id),
    )
    .where(eq(schema.publishedSeries.workspaceId, workspaceId))
    .orderBy(desc(schema.publishedSeries.publishedAt));
  return rows.map((r) => ({
    slug: r.slug,
    seriesId: r.seriesId,
    publishedAt: r.publishedAt.getTime(),
    publishedVersion: r.publishedVersion,
    contentHash: r.contentHash,
    pagesHash: r.pagesHash,
    seriesName: r.seriesName,
    archived: r.archived,
    seriesOrder: r.seriesOrder,
    startYear: yearOf(r.startDate),
    categoryName: r.categoryName,
    categoryOrder: r.categoryOrder,
  }));
}

/** The redirect target for a moved public path (ADR-011), or null. `fromPath`
 *  is the path under `/p/{ws}/` (no leading slash); the returned target is
 *  the same shape. Consulted by the `/p/` route only after everything else
 *  404s, so a redirect can never shadow a live page. */
export async function getPublishedRedirect(
  workspaceId: string,
  fromPath: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ toPath: schema.publishedRedirects.toPath })
    .from(schema.publishedRedirects)
    .where(
      and(
        eq(schema.publishedRedirects.workspaceId, workspaceId),
        eq(schema.publishedRedirects.fromPath, fromPath),
      ),
    )
    .limit(1);
  return row?.toPath ?? null;
}

/** Folder metadata rows for a workspace (ADR-011), keyed by path. The tree
 *  renders fine without rows — labels humanise, seasons derive — so this maps
 *  only the overrides. */
export async function getPublishedFolderMeta(
  workspaceId: string,
): Promise<Map<string, { label: string | null; season: string | null }>> {
  const rows = await getDb()
    .select({
      path: schema.publishedFolders.path,
      label: schema.publishedFolders.label,
      season: schema.publishedFolders.season,
    })
    .from(schema.publishedFolders)
    .where(eq(schema.publishedFolders.workspaceId, workspaceId));
  return new Map(rows.map((r) => [r.path, { label: r.label, season: r.season }]));
}

/** Insert or update one folder's metadata. Only the given fields change, so
 *  an ingest pinning `season` never clears a label set elsewhere. */
export async function upsertPublishedFolder(
  workspaceId: string,
  path: string,
  meta: { label?: string | null; season?: string | null },
): Promise<void> {
  const set: { label?: string | null; season?: string | null } = {};
  if ('label' in meta) set.label = meta.label;
  if ('season' in meta) set.season = meta.season;
  await getDb()
    .insert(schema.publishedFolders)
    .values({ workspaceId, path, ...set })
    .onConflictDoUpdate({
      target: [
        schema.publishedFolders.workspaceId,
        schema.publishedFolders.path,
      ],
      set,
    });
}

/** Pin a folder's display label unless one is already pinned — first
 *  publisher wins, so a series joining an existing event folder never
 *  renames it. */
export async function pinPublishedFolderLabelIfAbsent(
  workspaceId: string,
  path: string,
  label: string,
): Promise<void> {
  await getDb()
    .insert(schema.publishedFolders)
    .values({ workspaceId, path, label })
    .onConflictDoUpdate({
      target: [
        schema.publishedFolders.workspaceId,
        schema.publishedFolders.path,
      ],
      set: {
        label: sql`coalesce(${schema.publishedFolders.label}, excluded.label)`,
      },
    });
}

/** The season a published slug files under (ADR-011): the folder-metadata
 *  pin, a season-like slug itself, or the representative series' start year.
 *  Null = undated. */
function seasonOf(
  slug: string,
  meta: { season: string | null } | undefined,
  year: number | null,
): string | null {
  if (meta?.season) return meta.season;
  if (seasonLikeSlug(slug)) return slug;
  return year != null ? String(year) : null;
}

/** One season of the workspace's publication tree (ADR-011). `segment` is
 *  its URL form under `/p/{ws}/`; `folders` are the published top-level
 *  folders filed in it (for the archive shape, the single folder whose slug
 *  IS the season). */
export interface PublishedSeason {
  label: string;
  segment: string;
  current: boolean;
  folders: { slug: string; label: string }[];
}

/**
 * The workspace's seasons, newest first, each with its published top-level
 * folders (ADR-011). Seasons union the defined rows (`workspace_seasons`)
 * with those derived from publications; the current season is the explicitly
 * flagged one, else the newest label. Folders whose season can't be derived
 * land in `undated` (kept out of the season cascade).
 */
export async function getPublishedSeasonTree(
  workspaceId: string,
  folderMeta?: Map<string, { label: string | null; season: string | null }>,
): Promise<{ seasons: PublishedSeason[]; undated: { slug: string; label: string }[] }> {
  const meta = folderMeta ?? (await getPublishedFolderMeta(workspaceId));
  const rows = await getDb()
    .select({
      slug: schema.publishedSeries.slug,
      seriesName: schema.series.name,
      publishedAt: schema.publishedSeries.publishedAt,
      startDate: schema.series.startDate,
    })
    .from(schema.publishedSeries)
    .leftJoin(
      schema.series,
      eq(schema.publishedSeries.seriesId, schema.series.id),
    )
    .where(eq(schema.publishedSeries.workspaceId, workspaceId))
    .orderBy(desc(schema.publishedSeries.publishedAt));

  const groups = new Map<
    string,
    { names: (string | null)[]; at: number; year: number | null }
  >();
  for (const r of rows) {
    const g = groups.get(r.slug) ?? { names: [], at: 0, year: null };
    g.names.push(r.seriesName);
    if (r.publishedAt.getTime() > g.at) {
      g.at = r.publishedAt.getTime();
      g.year = yearOf(r.startDate);
    }
    groups.set(r.slug, g);
  }

  const folderOf = (slug: string, g: { names: (string | null)[] }) => ({
    slug,
    label:
      meta.get(slug)?.label ??
      (g.names.length === 1 && g.names[0] !== null
        ? g.names[0]
        : humanizeSlug(slug)),
  });

  const bySeason = new Map<string, { slug: string; label: string; at: number }[]>();
  const undated: { slug: string; label: string }[] = [];
  for (const [slug, g] of groups) {
    const season = seasonOf(slug, meta.get(slug), g.year);
    if (season === null) {
      undated.push(folderOf(slug, g));
      continue;
    }
    const list = bySeason.get(season) ?? [];
    list.push({ ...folderOf(slug, g), at: g.at });
    bySeason.set(season, list);
  }

  const defined = await getDb()
    .select({
      label: schema.workspaceSeasons.label,
      isCurrent: schema.workspaceSeasons.isCurrent,
    })
    .from(schema.workspaceSeasons)
    .where(eq(schema.workspaceSeasons.workspaceId, workspaceId));
  for (const d of defined) {
    if (!bySeason.has(d.label)) bySeason.set(d.label, []);
  }

  const labels = [...bySeason.keys()].sort((a, b) => b.localeCompare(a));
  const explicitCurrent = defined.find((d) => d.isCurrent)?.label;
  const current =
    explicitCurrent !== undefined && bySeason.has(explicitCurrent)
      ? explicitCurrent
      : labels[0];
  const seasons: PublishedSeason[] = labels.map((label) => ({
    label,
    segment: kebab(label),
    current: label === current,
    folders: (bySeason.get(label) ?? [])
      // A season-named folder (the archive shape) leads; the rest newest
      // publish first.
      .sort((a, b) =>
        a.slug === kebab(label) ? -1 : b.slug === kebab(label) ? 1 : b.at - a.at,
      )
      .map(({ slug, label: l }) => ({ slug, label: l })),
  }));
  return { seasons, undated };
}

/**
 * Every publication in a workspace, newest first, for the authenticated
 * management page (#164). Richer than {@link listPublishedByWorkspace} (the
 * public listing): carries the publication `id` (the unpublish handle), the
 * orphan flag, `editsSincePublish` — how many series edits have landed
 * since the snapshot, from the live `series.version` vs the captured
 * `publishedVersion` (0 for an orphan, whose series is gone) — and the
 * `seriesId` so live rows can link back to the authoring page.
 *
 * Unlike the public listing there is one row per publication, not per slug, so
 * the placement fields (category / archive / order / year) are each row's own
 * series — no representative fudge. An orphan has no placement at all.
 */
export async function listPublishedForWorkspace(workspaceId: string): Promise<
  {
    id: string;
    slug: string;
    title: string;
    seriesId: string | null;
    orphaned: boolean;
    publishedAt: number;
    editsSincePublish: number;
    sharedWith: string[];
    fleetCount: number;
    archived: boolean;
    categoryName: string | null;
    // null (not Infinity, which JSON can't carry — these rows cross /api/v1)
    // when the series has no category / manual order; sorts last either way.
    categoryOrder: number | null;
    seriesOrder: number | null;
    year: number | null;
  }[]
> {
  const rows = await getDb()
    .select({
      id: schema.publishedSeries.id,
      slug: schema.publishedSeries.slug,
      seriesId: schema.publishedSeries.seriesId,
      pages: schema.publishedSeries.pages,
      publishedVersion: schema.publishedSeries.publishedVersion,
      publishedAt: schema.publishedSeries.publishedAt,
      seriesName: schema.series.name,
      seriesVersion: schema.series.version,
      archived: schema.series.archived,
      seriesOrder: schema.series.displayOrder,
      startDate: schema.series.startDate,
      categoryName: schema.categories.name,
      categoryOrder: schema.categories.displayOrder,
    })
    .from(schema.publishedSeries)
    .leftJoin(
      schema.series,
      eq(schema.publishedSeries.seriesId, schema.series.id),
    )
    .leftJoin(
      schema.categories,
      eq(schema.series.categoryId, schema.categories.id),
    )
    .where(eq(schema.publishedSeries.workspaceId, workspaceId))
    .orderBy(desc(schema.publishedSeries.publishedAt));

  // Titles keyed by row id, so each row can name the *other* publications
  // sharing its slug (a slug is a shared namespace — see the schema note).
  // An orphan (series deleted) falls back to its event folder's pinned label
  // — the old series name (ADR-011) — before the bare slug, which under a
  // season slug would just read "2026".
  const meta = await getPublishedFolderMeta(workspaceId);
  const titleOf = (r: (typeof rows)[number]) => {
    if (r.seriesName) return r.seriesName;
    const segments = new Set(
      r.pages
        .filter((p) => p.subPath.includes('/'))
        .map((p) => p.subPath.split('/')[0]),
    );
    if (segments.size === 1) {
      const label = meta.get(`${r.slug}/${[...segments][0]}`)?.label;
      if (label) return label;
    }
    return r.slug;
  };
  const bySlug = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = bySlug.get(r.slug) ?? [];
    list.push(r);
    bySlug.set(r.slug, list);
  }

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: titleOf(r),
    seriesId: r.seriesId,
    orphaned: r.seriesId === null,
    publishedAt: r.publishedAt.getTime(),
    editsSincePublish:
      r.seriesVersion === null
        ? 0
        : Math.max(0, r.seriesVersion - r.publishedVersion),
    sharedWith: (bySlug.get(r.slug) ?? [])
      .filter((o) => o.id !== r.id)
      .map(titleOf),
    fleetCount: r.pages.length,
    archived: r.archived ?? false,
    categoryName: r.categoryName ?? null,
    categoryOrder: r.categoryOrder ?? null,
    seriesOrder: r.seriesOrder ?? null,
    year: yearOf(r.startDate),
  }));
}

/** Remove a publication row by `id`. The caller deletes the stored HTML
 *  blobs first (see the unpublish handler) — this only drops the record, which
 *  is what frees the `(workspace, slug)` and makes the public page 404. */
export async function deletePublished(id: string): Promise<void> {
  await getDb()
    .delete(schema.publishedSeries)
    .where(eq(schema.publishedSeries.id, id));
}

/** Insert or overwrite a publication, keyed by `id`. */
export async function savePublished(p: PublishedSeries): Promise<void> {
  await getDb()
    .insert(schema.publishedSeries)
    .values({
      id: p.id,
      workspaceId: p.workspaceId,
      seriesId: p.seriesId,
      slug: p.slug,
      pages: p.pages,
      contentHash: p.contentHash,
      publishedAt: new Date(p.publishedAt),
      publishedVersion: p.publishedVersion,
    })
    .onConflictDoUpdate({
      target: schema.publishedSeries.id,
      set: {
        seriesId: p.seriesId,
        slug: p.slug,
        pages: p.pages,
        contentHash: p.contentHash,
        publishedAt: new Date(p.publishedAt),
        publishedVersion: p.publishedVersion,
      },
    });
}
