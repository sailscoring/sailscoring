import 'server-only';
import { eq } from 'drizzle-orm';

import { getDb } from './db/client';
import * as schema from './db/schema';
import type { PublishedSeries } from './types';

/**
 * Server-side data access for `published_series` (ADR-008 Phase 9).
 *
 * The authoring side (publish handler) is workspace-scoped by the caller; the
 * public `/p/{slug}` route reads by slug alone because published content is
 * unauthenticated. There is no optimistic-concurrency column: publish is the
 * only writer and the upsert keyed on `series_id` makes re-publishing
 * idempotent (last publish wins).
 */

type PublishedRow = typeof schema.publishedSeries.$inferSelect;

function rowToPublished(row: PublishedRow): PublishedSeries {
  return {
    seriesId: row.seriesId,
    slug: row.slug,
    pages: row.pages,
    contentHash: row.contentHash,
    publishedAt: row.publishedAt.getTime(),
    publishedVersion: row.publishedVersion,
  };
}

/** The publication for a series, or null if it has never been published. */
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

/** The publication for a public slug, or null. Not workspace-scoped. */
export async function getPublishedBySlug(
  slug: string,
): Promise<PublishedSeries | null> {
  const [row] = await getDb()
    .select()
    .from(schema.publishedSeries)
    .where(eq(schema.publishedSeries.slug, slug))
    .limit(1);
  return row ? rowToPublished(row) : null;
}

/**
 * Insert or overwrite a series' publication. `slug` is written only on first
 * insert; the conflict update deliberately leaves it untouched so a series'
 * public URL is stable across every re-publish.
 */
export async function upsertPublished(
  workspaceId: string,
  p: PublishedSeries,
): Promise<void> {
  await getDb()
    .insert(schema.publishedSeries)
    .values({
      seriesId: p.seriesId,
      workspaceId,
      slug: p.slug,
      pages: p.pages,
      contentHash: p.contentHash,
      publishedAt: new Date(p.publishedAt),
      publishedVersion: p.publishedVersion,
    })
    .onConflictDoUpdate({
      target: schema.publishedSeries.seriesId,
      set: {
        pages: p.pages,
        contentHash: p.contentHash,
        publishedAt: new Date(p.publishedAt),
        publishedVersion: p.publishedVersion,
      },
    });
}
