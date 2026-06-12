import 'server-only';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { and, desc, eq, lt } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { user } from '@/lib/db/schema/auth';
import { deletedSeries } from '@/lib/db/schema/series';
import { seriesFileReposFor } from '@/lib/postgres-repository';
import { getPublishedBySeries } from '@/lib/published-repository';
import { exportRevisions, importRevisions } from '@/lib/revision-log';
import {
  buildSeriesFile,
  restoreSeriesFromFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { DeletedSeriesEntry } from '@/lib/types';

/**
 * Soft-delete tombstones for series ("Recover a deleted series").
 *
 * Approach B (tombstone snapshot): on delete we serialise the whole series —
 * the `.sailscoring` file shape, with its revision history embedded — into one
 * self-contained `deleted_series` row, then hard-delete the live rows as
 * before. Recovery decodes the blob and re-creates the series under its
 * original id. A daily cron purges tombstones past the retention window.
 *
 * Server-only: the table is workspace-scoped and never touched from the client.
 */

/** How long a soft-deleted series stays recoverable before the cron purges it. */
export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Actor {
  workspaceId: string;
  userId: string;
}

function pack(file: SeriesFile): Buffer {
  return zstdCompressSync(Buffer.from(JSON.stringify(file)));
}

function unpack(blob: Buffer): SeriesFile {
  return JSON.parse(zstdDecompressSync(blob).toString('utf-8')) as SeriesFile;
}

/** The `SeriesFileRepos` used to restore a series, with `importRevisions` wired
 *  in here (not on `seriesFileReposFor` itself, which would cycle through
 *  `revision-log`). */
function restoreRepos(actor: Actor): SeriesFileRepos {
  return {
    ...seriesFileReposFor({ workspaceId: actor.workspaceId }),
    importRevisions: (seriesId, payload) => importRevisions(actor, seriesId, payload),
  };
}

/**
 * Capture a tombstone for a series about to be hard-deleted. Builds the
 * whole-series snapshot, embeds its revision history, records whether the
 * series had a live publication (left orphaned), and writes the row.
 *
 * Call this *before* the hard delete — it reads the live rows. Throws if the
 * series doesn't exist in the workspace (so the caller's existence check is the
 * single source of truth).
 */
export async function captureTombstone(actor: Actor, seriesId: string): Promise<void> {
  const repos = seriesFileReposFor({ workspaceId: actor.workspaceId });
  const file = await buildSeriesFile(seriesId, repos);

  // Embed the revision history so recovery is genuinely lossless.
  const { revisions, revisionSnapshots } = await exportRevisions(actor, seriesId);
  file.revisions = revisions;
  file.revisionSnapshots = revisionSnapshots;

  const publication = await getPublishedBySeries(seriesId);

  await getDb().insert(deletedSeries).values({
    id: crypto.randomUUID(),
    workspaceId: actor.workspaceId,
    seriesId,
    name: file.series.name,
    deletedBy: actor.userId,
    hadPublication: publication !== null,
    snapshotGz: pack(file),
  });
}

/** Reverse-chronological Trash list for a workspace (metadata only — the
 *  snapshot blobs are never read here). */
export async function listTombstones(workspaceId: string): Promise<DeletedSeriesEntry[]> {
  const rows = await getDb()
    .select({
      id: deletedSeries.id,
      seriesId: deletedSeries.seriesId,
      name: deletedSeries.name,
      deletedAt: deletedSeries.deletedAt,
      hadPublication: deletedSeries.hadPublication,
      actorId: user.id,
      actorEmail: user.email,
      actorName: user.name,
    })
    .from(deletedSeries)
    .leftJoin(user, eq(user.id, deletedSeries.deletedBy))
    .where(eq(deletedSeries.workspaceId, workspaceId))
    .orderBy(desc(deletedSeries.deletedAt));

  return rows.map((r) => ({
    id: r.id,
    seriesId: r.seriesId,
    name: r.name,
    deletedAt: r.deletedAt.toISOString(),
    hadPublication: r.hadPublication,
    actor: r.actorId
      ? {
          id: r.actorId,
          email: r.actorEmail ?? undefined,
          displayName:
            r.actorName && r.actorName.trim().length > 0 ? r.actorName : undefined,
        }
      : null,
  }));
}

/**
 * Recover a tombstoned series: re-create it under its original id (archived,
 * since delete is archive-gated) and drop the tombstone. Returns the restored
 * series' id and name, or null if the tombstone doesn't exist in the workspace.
 */
export async function restoreTombstone(
  actor: Actor,
  tombstoneId: string,
): Promise<{ seriesId: string; name: string } | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(deletedSeries)
    .where(
      and(
        eq(deletedSeries.id, tombstoneId),
        eq(deletedSeries.workspaceId, actor.workspaceId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const file = unpack(row.snapshotGz);
  await restoreSeriesFromFile(row.seriesId, file, restoreRepos(actor));
  await db.delete(deletedSeries).where(eq(deletedSeries.id, tombstoneId));

  return { seriesId: row.seriesId, name: row.name };
}

/**
 * Permanently delete a tombstone (the Trash "delete forever" path). Returns the
 * deleted series' name for the audit entry, or null if it didn't exist in the
 * workspace.
 */
export async function purgeTombstone(
  workspaceId: string,
  tombstoneId: string,
): Promise<{ name: string } | null> {
  const [row] = await getDb()
    .delete(deletedSeries)
    .where(
      and(
        eq(deletedSeries.id, tombstoneId),
        eq(deletedSeries.workspaceId, workspaceId),
      ),
    )
    .returning({ name: deletedSeries.name });
  return row ? { name: row.name } : null;
}

/** Retention sweep: purge tombstones past the window. Returns the count
 *  removed. Driven by the daily Vercel cron. */
export async function sweepDeletedSeries(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const result = await getDb()
    .delete(deletedSeries)
    .where(lt(deletedSeries.deletedAt, cutoff))
    .returning({ id: deletedSeries.id });
  return result.length;
}
