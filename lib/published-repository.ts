import 'server-only';
import { and, desc, eq } from 'drizzle-orm';

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

/** Every publication sharing `(workspaceId, slug)`, newest first. A slug is a
 *  shared namespace, so this can be more than one series' publication; the
 *  public read path unions their pages and the publish handler checks the group
 *  for sub-path collisions. Empty when nothing is published at the slug. */
export async function getPublishedGroupByWorkspaceSlug(
  workspaceId: string,
  slug: string,
): Promise<PublishedSeries[]> {
  const rows = await getDb()
    .select()
    .from(schema.publishedSeries)
    .where(
      and(
        eq(schema.publishedSeries.workspaceId, workspaceId),
        eq(schema.publishedSeries.slug, slug),
      ),
    )
    .orderBy(desc(schema.publishedSeries.publishedAt));
  return rows.map(rowToPublished);
}

/** Resolve a workspace (id + display name) from its public slug. Drives the
 *  public route's workspace lookup and listing heading (#162). */
export async function getWorkspaceBySlug(
  workspaceSlug: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await getDb()
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.slug, workspaceSlug))
    .limit(1);
  return row ?? null;
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

/** Every published slug in a workspace, newest first, for the public listing
 *  (#162). One entry per slug — contributions from several series sharing a
 *  slug collapse into a single row: `fleetCount` sums their pages, `publishedAt`
 *  is the most recent, and the title is the lone contributor's series name or,
 *  when several share the slug, a humanised slug (no single name fits). An
 *  orphaned sole contributor falls back to the slug itself. */
export async function listPublishedByWorkspace(
  workspaceId: string,
): Promise<
  { slug: string; title: string; publishedAt: number; fleetCount: number }[]
> {
  const rows = await getDb()
    .select({
      slug: schema.publishedSeries.slug,
      pages: schema.publishedSeries.pages,
      publishedAt: schema.publishedSeries.publishedAt,
      seriesName: schema.series.name,
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
    { publishedAt: number; fleetCount: number; names: (string | null)[] }
  >();
  for (const r of rows) {
    const g = groups.get(r.slug) ?? {
      publishedAt: 0,
      fleetCount: 0,
      names: [],
    };
    g.publishedAt = Math.max(g.publishedAt, r.publishedAt.getTime());
    g.fleetCount += r.pages.length;
    g.names.push(r.seriesName);
    groups.set(r.slug, g);
  }

  return [...groups.entries()]
    .map(([slug, g]) => ({
      slug,
      title:
        g.names.length === 1 ? (g.names[0] ?? slug) : humanizeSlug(slug),
      publishedAt: g.publishedAt,
      fleetCount: g.fleetCount,
    }))
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Every publication in a workspace, newest first, for the authenticated
 * management page (#164). Richer than {@link listPublishedByWorkspace} (the
 * public listing): carries the publication `id` (the unpublish handle), the
 * orphan flag, and `editsSincePublish` — how many series edits have landed
 * since the snapshot, from the live `series.version` vs the captured
 * `publishedVersion` (0 for an orphan, whose series is gone).
 */
export async function listPublishedForWorkspace(workspaceId: string): Promise<
  {
    id: string;
    slug: string;
    title: string;
    orphaned: boolean;
    publishedAt: number;
    editsSincePublish: number;
    sharedWith: string[];
  }[]
> {
  const rows = await getDb()
    .select({
      id: schema.publishedSeries.id,
      slug: schema.publishedSeries.slug,
      seriesId: schema.publishedSeries.seriesId,
      publishedVersion: schema.publishedSeries.publishedVersion,
      publishedAt: schema.publishedSeries.publishedAt,
      seriesName: schema.series.name,
      seriesVersion: schema.series.version,
    })
    .from(schema.publishedSeries)
    .leftJoin(
      schema.series,
      eq(schema.publishedSeries.seriesId, schema.series.id),
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
    orphaned: r.seriesId === null,
    publishedAt: r.publishedAt.getTime(),
    editsSincePublish:
      r.seriesVersion === null
        ? 0
        : Math.max(0, r.seriesVersion - r.publishedVersion),
    sharedWith: (bySlug.get(r.slug) ?? [])
      .filter((o) => o.id !== r.id)
      .map(titleOf),
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
