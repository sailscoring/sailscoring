import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { getDb } from './db/client';
import * as schema from './db/schema';
import { humanizeSlug } from './publishing';
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

/** Map each given series id to the public slug it's published at, omitting any
 *  that aren't published. One query for a whole career arc, so its timeline can
 *  deep-link the events that have a public results page. Workspace-scoped. */
export async function getPublishedSlugsBySeries(
  workspaceId: string,
  seriesIds: string[],
): Promise<Map<string, string>> {
  if (seriesIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      seriesId: schema.publishedSeries.seriesId,
      slug: schema.publishedSeries.slug,
    })
    .from(schema.publishedSeries)
    .where(
      and(
        eq(schema.publishedSeries.workspaceId, workspaceId),
        inArray(schema.publishedSeries.seriesId, seriesIds),
      ),
    );
  const map = new Map<string, string>();
  for (const r of rows) if (r.seriesId) map.set(r.seriesId, r.slug);
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
 *  active and uncategorised. */
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

  type Rep = {
    archived: boolean;
    categoryName: string | null;
    categoryOrder: number;
    seriesOrder: number;
    year: number | null;
  };
  const groups = new Map<
    string,
    {
      publishedAt: number;
      fleetCount: number;
      names: (string | null)[];
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
  }

  return [...groups.entries()]
    .map(([slug, g]) => ({
      slug,
      title: g.names.length === 1 ? (g.names[0] ?? slug) : humanizeSlug(slug),
      publishedAt: g.publishedAt,
      fleetCount: g.fleetCount,
      archived: g.rep.archived,
      categoryName: g.rep.categoryName,
      categoryOrder: g.rep.categoryOrder,
      seriesOrder: g.rep.seriesOrder,
      year: g.rep.year,
    }))
    .sort((a, b) => b.publishedAt - a.publishedAt);
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
  const titleOf = (r: (typeof rows)[number]) => r.seriesName ?? r.slug;
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
