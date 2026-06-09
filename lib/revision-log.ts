import 'server-only';
import { and, desc, eq, gt } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { user } from '@/lib/db/schema/auth';
import { seriesRevision } from '@/lib/db/schema/series';
import { createRepos } from '@/lib/postgres-repository';
import { buildSeriesFile, type SeriesFile, type SeriesFileRepos } from '@/lib/series-file';
import type { RevisionEntry } from '@/lib/types';

export type { RevisionEntry };

/**
 * Revision history (#166, ADR-008 follow-on). The write seam
 * (`captureRevision`) and the read queries that back the per-series Revisions
 * surface. Server-only — the table is workspace-scoped and never touched from
 * the client.
 *
 * Each revision is a full point-in-time snapshot in `.sailscoring` file shape.
 * Capture is best-effort: `captureRevision` swallows its own errors so a
 * snapshot failure can never fail the mutation it describes.
 */

/** Idle gap that ends an editing session. Edits by the same actor closer
 *  together than this fold into one `auto` revision. */
const COALESCE_WINDOW_MS = 5 * 60 * 1000;

type RevisionKind = 'auto' | 'named' | 'revert';

interface Actor {
  workspaceId: string;
  userId: string;
}

/** A `SeriesFileRepos` backed by the workspace-scoped Postgres repos.
 *  `buildSeriesFile` only reads, so the two mutating members it never calls
 *  (`listSeriesNames`, `deleteSeriesChildren`) are omitted. */
function fileReposFor(workspaceId: string): SeriesFileRepos {
  const repos = createRepos({ workspaceId });
  return {
    seriesRepo: repos.series,
    competitorRepo: repos.competitors,
    fleetRepo: repos.fleets,
    raceRepo: repos.races,
    raceStartRepo: repos.raceStarts,
    raceRatingOverrideRepo: repos.raceRatingOverrides,
    finishRepo: repos.finishes,
  } as unknown as SeriesFileRepos;
}

/**
 * Snapshot the current state of a series into the revision history.
 *
 * Coalescing: an `auto` revision created while the same actor is still editing
 * (the previous `auto` revision for this series is within the idle window) is
 * overwritten in place rather than appended, so a burst of edits becomes one
 * "end of session" revision. `named` and `revert` revisions always append.
 *
 * Best-effort: never throws into the caller.
 */
export async function captureRevision(
  actor: Actor,
  seriesId: string,
  opts: { kind?: RevisionKind; label?: string; summary?: string } = {},
): Promise<void> {
  try {
    const db = getDb();
    const kind = opts.kind ?? 'auto';
    const snapshot: SeriesFile = await buildSeriesFile(
      seriesId,
      fileReposFor(actor.workspaceId),
    );

    if (kind === 'auto') {
      const cutoff = new Date(Date.now() - COALESCE_WINDOW_MS);
      const [open] = await db
        .select({ id: seriesRevision.id })
        .from(seriesRevision)
        .where(
          and(
            eq(seriesRevision.seriesId, seriesId),
            eq(seriesRevision.actorUserId, actor.userId),
            eq(seriesRevision.kind, 'auto'),
            gt(seriesRevision.createdAt, cutoff),
          ),
        )
        .orderBy(desc(seriesRevision.createdAt))
        .limit(1);

      if (open) {
        await db
          .update(seriesRevision)
          .set({
            snapshot,
            summary: opts.summary ?? null,
            createdAt: new Date(),
          })
          .where(eq(seriesRevision.id, open.id));
        return;
      }
    }

    await db.insert(seriesRevision).values({
      id: crypto.randomUUID(),
      workspaceId: actor.workspaceId,
      seriesId,
      actorUserId: actor.userId,
      kind,
      label: opts.label ?? null,
      summary: opts.summary ?? null,
      snapshot,
    });
  } catch (err) {
    console.error('captureRevision failed (non-fatal):', err);
  }
}

const REVISION_SELECTION = {
  id: seriesRevision.id,
  seriesId: seriesRevision.seriesId,
  kind: seriesRevision.kind,
  label: seriesRevision.label,
  summary: seriesRevision.summary,
  createdAt: seriesRevision.createdAt,
  actorId: user.id,
  actorEmail: user.email,
  actorName: user.name,
} as const;

function toEntry(row: {
  id: string;
  seriesId: string;
  kind: string;
  label: string | null;
  summary: string | null;
  createdAt: Date;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
}): RevisionEntry {
  return {
    id: row.id,
    seriesId: row.seriesId,
    kind: row.kind as RevisionEntry['kind'],
    label: row.label,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    actor: row.actorId
      ? {
          id: row.actorId,
          email: row.actorEmail ?? undefined,
          displayName:
            row.actorName && row.actorName.trim().length > 0
              ? row.actorName
              : undefined,
        }
      : null,
  };
}

/** Reverse-chronological revision list for one series (metadata only — the
 *  snapshot blobs are fetched on demand). Workspace-scoped. */
export async function listRevisions(
  actor: Actor,
  seriesId: string,
): Promise<RevisionEntry[]> {
  const db = getDb();
  const rows = await db
    .select(REVISION_SELECTION)
    .from(seriesRevision)
    .leftJoin(user, eq(user.id, seriesRevision.actorUserId))
    .where(
      and(
        eq(seriesRevision.workspaceId, actor.workspaceId),
        eq(seriesRevision.seriesId, seriesId),
      ),
    )
    .orderBy(desc(seriesRevision.createdAt));
  return rows.map(toEntry);
}

/** The full snapshot blob for one revision, or null if it doesn't exist in the
 *  caller's workspace. */
export async function getRevisionSnapshot(
  actor: Actor,
  revisionId: string,
): Promise<SeriesFile | null> {
  const db = getDb();
  const [row] = await db
    .select({ snapshot: seriesRevision.snapshot })
    .from(seriesRevision)
    .where(
      and(
        eq(seriesRevision.id, revisionId),
        eq(seriesRevision.workspaceId, actor.workspaceId),
      ),
    )
    .limit(1);
  return row?.snapshot ?? null;
}
