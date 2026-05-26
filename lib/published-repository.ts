import 'server-only';
import { and, desc, eq } from 'drizzle-orm';

import { getDb } from './db/client';
import * as schema from './db/schema';
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

/** The publication at `(workspaceId, slug)`, or null. Drives the public route
 *  and the first-publish slug-collision check. */
export async function getPublishedByWorkspaceSlug(
  workspaceId: string,
  slug: string,
): Promise<PublishedSeries | null> {
  const [row] = await getDb()
    .select()
    .from(schema.publishedSeries)
    .where(
      and(
        eq(schema.publishedSeries.workspaceId, workspaceId),
        eq(schema.publishedSeries.slug, slug),
      ),
    )
    .limit(1);
  return row ? rowToPublished(row) : null;
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

/** Every publication in a workspace, newest first, for the public listing
 *  (#162). The title is the live series name, falling back to the slug for an
 *  orphaned publication (its series was deleted). */
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
  return rows.map((r) => ({
    slug: r.slug,
    title: r.seriesName ?? r.slug,
    publishedAt: r.publishedAt.getTime(),
    fleetCount: r.pages.length,
  }));
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
