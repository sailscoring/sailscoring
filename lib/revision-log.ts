import 'server-only';
import { after } from 'next/server';
import { gzipSync, gunzipSync } from 'node:zlib';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { user } from '@/lib/db/schema/auth';
import { seriesRevision } from '@/lib/db/schema/series';
import { seriesFileReposFor } from '@/lib/postgres-repository';
import {
  buildSeriesFile,
  type SeriesFile,
  type SeriesFileRevision,
} from '@/lib/series-file';
import type { RevisionEntry } from '@/lib/types';

/** Known top-level keys of a `.sailscoring` snapshot. Anything else (notably a
 *  nested `revisions` block a tampered import might carry) is dropped. */
const SNAPSHOT_KEYS = [
  'formatVersion', 'seriesId', 'exportedAt', 'series',
  'fleets', 'competitors', 'races', 'tcfHistory', 'nhcTcfHistory',
] as const;

/** gzip a snapshot for storage in `snapshot_gz`. */
function packSnapshot(file: SeriesFile): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(file)));
}

/** Read a snapshot, preferring the compressed column and falling back to the
 *  legacy uncompressed `snapshot` jsonb. */
function unpackSnapshot(row: {
  snapshot: SeriesFile | null;
  snapshotGz: Buffer | null;
}): SeriesFile {
  if (row.snapshotGz) {
    return JSON.parse(gunzipSync(row.snapshotGz).toString('utf-8')) as SeriesFile;
  }
  return row.snapshot as SeriesFile;
}

/** Strip an imported snapshot to known keys only — defence against a
 *  hand-crafted file smuggling a nested `revisions` block or other junk. */
function sanitizeSnapshot(raw: unknown): SeriesFile {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const clean: Record<string, unknown> = {};
  for (const k of SNAPSHOT_KEYS) if (k in obj) clean[k] = obj[k];
  return clean as unknown as SeriesFile;
}

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

type RevisionKind = 'auto' | 'named' | 'revert' | 'publish' | 'saved';

interface Actor {
  workspaceId: string;
  userId: string;
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
  opts: { kind?: RevisionKind; label?: string; summary?: string; sessionKey?: string } = {},
): Promise<void> {
  try {
    const db = getDb();
    const kind = opts.kind ?? 'auto';
    const sessionKey = opts.sessionKey ?? null;
    const snapshot: SeriesFile = await buildSeriesFile(
      seriesId,
      seriesFileReposFor({ workspaceId: actor.workspaceId }),
    );

    if (kind === 'auto') {
      const cutoff = new Date(Date.now() - COALESCE_WINDOW_MS);
      // Coalesce only into the same actor's still-open session for the *same*
      // context (sessionKey) within the window — and never into a sealed one.
      const [open] = await db
        .select({ id: seriesRevision.id })
        .from(seriesRevision)
        .where(
          and(
            eq(seriesRevision.seriesId, seriesId),
            eq(seriesRevision.actorUserId, actor.userId),
            eq(seriesRevision.kind, 'auto'),
            eq(seriesRevision.sealed, false),
            sessionKey === null
              ? isNull(seriesRevision.sessionKey)
              : eq(seriesRevision.sessionKey, sessionKey),
            gt(seriesRevision.createdAt, cutoff),
          ),
        )
        .orderBy(desc(seriesRevision.createdAt))
        .limit(1);

      if (open) {
        await db
          .update(seriesRevision)
          .set({
            snapshotGz: packSnapshot(snapshot),
            snapshot: null,
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
      sessionKey,
      snapshotGz: packSnapshot(snapshot),
    });
  } catch (err) {
    console.error('captureRevision failed (non-fatal):', err);
  }
}

/**
 * Seal every still-open auto revision for a series (#166) — called by a
 * milestone (publish / save / revert) so subsequent edits start a fresh
 * revision instead of folding back into the pre-milestone one. Best-effort.
 */
export async function sealOpenRevisions(
  workspaceId: string,
  seriesId: string,
): Promise<void> {
  try {
    await getDb()
      .update(seriesRevision)
      .set({ sealed: true })
      .where(
        and(
          eq(seriesRevision.workspaceId, workspaceId),
          eq(seriesRevision.seriesId, seriesId),
          eq(seriesRevision.kind, 'auto'),
          eq(seriesRevision.sealed, false),
        ),
      );
  } catch (err) {
    console.error('sealOpenRevisions failed (non-fatal):', err);
  }
}

/**
 * Capture on the autosave hot path: snapshotting must never add latency to the
 * mutation it follows, so it runs *after* the response flushes (Fluid Compute
 * keeps the instance alive to finish it). Use this for the auto revisions
 * piggybacked on data writes; deliberate captures (named checkpoints, reverts)
 * stay synchronous so the caller can confirm them.
 */
export function captureRevisionAfter(
  actor: Actor,
  seriesId: string,
  opts: { kind?: RevisionKind; label?: string; summary?: string; sessionKey?: string } = {},
): void {
  try {
    after(() => captureRevision(actor, seriesId, opts));
  } catch {
    // No request scope (e.g. a unit test invoking the handler directly, or a
    // script): fall back to a fire-and-forget capture. `captureRevision`
    // swallows its own errors, so the floating promise never rejects.
    void captureRevision(actor, seriesId, opts);
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

/** One revision's snapshot blob plus the metadata a caller needs to act on it
 *  (its series and timestamp), scoped to the caller's workspace. Null if it
 *  doesn't exist there. */
export async function getRevision(
  actor: Actor,
  revisionId: string,
): Promise<{ seriesId: string; snapshot: SeriesFile; createdAt: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      seriesId: seriesRevision.seriesId,
      snapshot: seriesRevision.snapshot,
      snapshotGz: seriesRevision.snapshotGz,
      createdAt: seriesRevision.createdAt,
    })
    .from(seriesRevision)
    .where(
      and(
        eq(seriesRevision.id, revisionId),
        eq(seriesRevision.workspaceId, actor.workspaceId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    seriesId: row.seriesId,
    snapshot: unpackSnapshot(row),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The whole revision history for one series in `.sailscoring` file shape
 * (#166), oldest-first — for embedding in an exported file. Carries each
 * revision's full snapshot plus display-only actor info (user ids don't cross
 * workspaces).
 */
export async function listRevisionsForExport(
  actor: Actor,
  seriesId: string,
): Promise<SeriesFileRevision[]> {
  const db = getDb();
  const rows = await db
    .select({
      kind: seriesRevision.kind,
      label: seriesRevision.label,
      summary: seriesRevision.summary,
      createdAt: seriesRevision.createdAt,
      snapshot: seriesRevision.snapshot,
      snapshotGz: seriesRevision.snapshotGz,
      actorEmail: user.email,
      actorName: user.name,
    })
    .from(seriesRevision)
    .leftJoin(user, eq(user.id, seriesRevision.actorUserId))
    .where(
      and(
        eq(seriesRevision.workspaceId, actor.workspaceId),
        eq(seriesRevision.seriesId, seriesId),
      ),
    )
    .orderBy(seriesRevision.createdAt);
  return rows.map((r) => ({
    kind: r.kind as SeriesFileRevision['kind'],
    label: r.label,
    summary: r.summary,
    createdAt: r.createdAt.toISOString(),
    actor:
      r.actorEmail || r.actorName
        ? {
            email: r.actorEmail ?? undefined,
            displayName: r.actorName && r.actorName.trim().length > 0 ? r.actorName : undefined,
          }
        : null,
    snapshot: unpackSnapshot(r),
  }));
}

/**
 * Restore an embedded revision history into a (freshly imported) series (#166).
 * Original timestamps are preserved; actor attribution is dropped — the source
 * users don't exist in this workspace, so `actorUserId` is null.
 */
export async function importRevisions(
  actor: Actor,
  seriesId: string,
  revisions: SeriesFileRevision[],
): Promise<void> {
  if (revisions.length === 0) return;
  const db = getDb();
  await db.insert(seriesRevision).values(
    revisions.map((rev) => ({
      id: crypto.randomUUID(),
      workspaceId: actor.workspaceId,
      seriesId,
      actorUserId: null,
      kind: rev.kind,
      label: rev.label,
      summary: rev.summary,
      // Sanitise then compress — a tampered file can't smuggle a nested
      // `revisions` block (or other junk) into a stored snapshot.
      snapshotGz: packSnapshot(sanitizeSnapshot(rev.snapshot)),
      createdAt: new Date(rev.createdAt),
    })),
  );
}

/** The full snapshot blob for one revision, or null if it doesn't exist in the
 *  caller's workspace. */
export async function getRevisionSnapshot(
  actor: Actor,
  revisionId: string,
): Promise<SeriesFile | null> {
  const rev = await getRevision(actor, revisionId);
  return rev?.snapshot ?? null;
}
