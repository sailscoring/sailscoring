import 'server-only';
import { after } from 'next/server';
import { constants as zlibConstants, gunzipSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { and, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { recordActivity } from '@/lib/activity-log';
import type { ActivityAction } from '@/lib/activity-actions';
import { user } from '@/lib/db/schema/auth';
import { seriesRevision } from '@/lib/db/schema/series';
import { createRepos, seriesFileReposFor } from '@/lib/postgres-repository';
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

/** Compress a snapshot (zstd) for storage in `snapshot_gz`. */
function packSnapshot(file: SeriesFile): Buffer {
  return zstdCompressSync(Buffer.from(JSON.stringify(file)));
}

/** Read a snapshot, sniffing the compressed column's codec (zstd for new rows,
 *  gzip for the brief round-2 window, neither → legacy uncompressed `snapshot`
 *  jsonb). Null when the blob has been thinned. */
function unpackSnapshot(row: {
  snapshot: SeriesFile | null;
  snapshotGz: Buffer | null;
}): SeriesFile | null {
  const blob = row.snapshotGz;
  if (blob && blob.length >= 4) {
    const isZstd = blob[0] === 0x28 && blob[1] === 0xb5 && blob[2] === 0x2f && blob[3] === 0xfd;
    const raw = isZstd ? zstdDecompressSync(blob) : gunzipSync(blob);
    return JSON.parse(raw.toString('utf-8')) as SeriesFile;
  }
  return row.snapshot;
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

    // A new revision was born — opportunistically thin this series' old auto
    // snapshots. (Coalesce updates above return early and don't trigger it.)
    await thinRevisions(actor.workspaceId, seriesId);
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

/**
 * One-call seam for a scoring-data mutation (#166): mark the series
 * modified, record the human-readable activity entry, and capture a
 * (deferred, context-coalesced) revision. Use this wherever a handler changes
 * competitors / fleets / races / finishes / starts / rating-overrides so the
 * unsaved-changes tracking, history, and audit trail stay complete with no
 * client cooperation.
 *
 * The touch bumps `lastModifiedAt` + `version` but deliberately does not
 * stamp `updatedBy` — it's the file-tracking heartbeat, not a user edit; the
 * activity entry below carries the actor. Callers have already passed a
 * writability guard (`assertSeriesWritable` / `assertRaceWritable` / …), so
 * no archived-series check is needed here.
 */
export async function trackChange(
  actor: Actor,
  input: {
    action: ActivityAction;
    seriesId: string;
    summary: string;
    sessionKey: string;
    dedupeKey?: string;
    /**
     * Skip the lastModifiedAt/version touch. Only for the series PUT itself,
     * which round-trips lastModifiedAt in its own payload — an extra version
     * bump there would invalidate the version the client just received.
     * Child-entity mutations always touch (the default).
     */
    touch?: boolean;
  },
): Promise<void> {
  if (input.touch ?? true) {
    const repos = createRepos({ workspaceId: actor.workspaceId });
    await repos.series.touch(input.seriesId);
  }
  await recordActivity(actor, {
    action: input.action,
    seriesId: input.seriesId,
    summary: input.summary,
    dedupeKey: input.dedupeKey,
  });
  captureRevisionAfter(actor, input.seriesId, {
    summary: input.summary,
    sessionKey: input.sessionKey,
  });
}

const REVISION_SELECTION = {
  id: seriesRevision.id,
  seriesId: seriesRevision.seriesId,
  kind: seriesRevision.kind,
  label: seriesRevision.label,
  summary: seriesRevision.summary,
  createdAt: seriesRevision.createdAt,
  // Whether a blob is still stored — without pulling the (large) blob itself.
  hasSnapshot: sql<boolean>`(${seriesRevision.snapshotGz} is not null or ${seriesRevision.snapshot} is not null)`,
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
  hasSnapshot: boolean;
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
    hasSnapshot: row.hasSnapshot,
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
): Promise<{ seriesId: string; snapshot: SeriesFile | null; createdAt: string } | null> {
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
 * The whole revision history for one series for embedding in an exported file
 * (#166), oldest-first: readable per-revision metadata plus one opaque
 * `revisionSnapshots` blob (base64 whole-array zstd of `[snapshot|null, …]`
 * index-aligned to the metadata; null = a thinned revision). Whole-array
 * compression dedupes the near-identical snapshots, so history is tiny.
 */
export async function exportRevisions(
  actor: Actor,
  seriesId: string,
): Promise<{ revisions: SeriesFileRevision[]; revisionSnapshots: string }> {
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

  const revisions: SeriesFileRevision[] = rows.map((r) => ({
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
  }));
  const snapshots = rows.map((r) => unpackSnapshot(r)); // null = thinned
  const revisionSnapshots = zstdCompressSync(Buffer.from(JSON.stringify(snapshots)), {
    params: { [zlibConstants.ZSTD_c_compressionLevel]: 19 },
  }).toString('base64');
  return { revisions, revisionSnapshots };
}

/** Retention tiers (#166): keep every auto snapshot newer than this… */
const THIN_KEEP_ALL_DAYS = 7;
/** …keep one auto snapshot per day between the two cutoffs, drop the rest, and
 *  drop every auto snapshot older than this. (Named / revert / publish / saved
 *  milestones and the latest auto revision are never thinned.) */
const THIN_DAILY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Thin a series' old auto revisions (#166): drop the snapshot blob (keeping the
 * row, so the timeline and audit trail survive) per the age tiers above. Run
 * opportunistically when a new revision is born. Best-effort.
 */
export async function thinRevisions(
  workspaceId: string,
  seriesId: string,
): Promise<void> {
  try {
    const db = getDb();
    const now = Date.now();
    const recentCutoff = new Date(now - THIN_KEEP_ALL_DAYS * DAY_MS);
    const dailyCutoff = new Date(now - THIN_DAILY_DAYS * DAY_MS);

    // Always keep the latest auto revision restorable, whatever its age.
    const [newest] = await db
      .select({ id: seriesRevision.id })
      .from(seriesRevision)
      .where(
        and(
          eq(seriesRevision.workspaceId, workspaceId),
          eq(seriesRevision.seriesId, seriesId),
          eq(seriesRevision.kind, 'auto'),
        ),
      )
      .orderBy(desc(seriesRevision.createdAt))
      .limit(1);

    // Candidate auto revisions: older than the keep-all window and still
    // holding a blob.
    const candidates = await db
      .select({ id: seriesRevision.id, createdAt: seriesRevision.createdAt })
      .from(seriesRevision)
      .where(
        and(
          eq(seriesRevision.workspaceId, workspaceId),
          eq(seriesRevision.seriesId, seriesId),
          eq(seriesRevision.kind, 'auto'),
          lt(seriesRevision.createdAt, recentCutoff),
          sql`(${seriesRevision.snapshotGz} is not null or ${seriesRevision.snapshot} is not null)`,
        ),
      )
      .orderBy(desc(seriesRevision.createdAt));

    const toThin: string[] = [];
    const keptDays = new Set<string>();
    for (const r of candidates) {
      if (r.id === newest?.id) continue;
      if (r.createdAt.getTime() < dailyCutoff.getTime()) {
        toThin.push(r.id); // older than the daily tier — drop
        continue;
      }
      // Daily tier: keep the newest per day (candidates are newest-first), thin the rest.
      const day = r.createdAt.toISOString().slice(0, 10);
      if (keptDays.has(day)) toThin.push(r.id);
      else keptDays.add(day);
    }

    if (toThin.length > 0) {
      await db
        .update(seriesRevision)
        .set({ snapshot: null, snapshotGz: null })
        .where(inArray(seriesRevision.id, toThin));
    }
  } catch (err) {
    console.error('thinRevisions failed (non-fatal):', err);
  }
}

/**
 * Restore an embedded revision history into a (freshly imported) series (#166).
 * `revisionSnapshots` is the base64 whole-array zstd blob whose decompressed
 * `[snapshot|null, …]` is index-aligned to `revisions`. Original timestamps are
 * preserved; actor attribution is dropped (source users don't exist here, so
 * `actorUserId` is null); a null entry restores as a thinned (metadata-only)
 * revision. Snapshots are sanitised before storage.
 */
export async function importRevisions(
  actor: Actor,
  seriesId: string,
  payload: { revisions: SeriesFileRevision[]; revisionSnapshots: string },
): Promise<void> {
  const { revisions, revisionSnapshots } = payload;
  if (revisions.length === 0) return;

  const snapshots = JSON.parse(
    zstdDecompressSync(Buffer.from(revisionSnapshots, 'base64')).toString('utf-8'),
  ) as (unknown | null)[];
  if (snapshots.length !== revisions.length) {
    throw new Error('revisionSnapshots length does not match revisions');
  }

  const db = getDb();
  await db.insert(seriesRevision).values(
    revisions.map((rev, i) => {
      const raw = snapshots[i];
      return {
        id: crypto.randomUUID(),
        workspaceId: actor.workspaceId,
        seriesId,
        actorUserId: null,
        kind: rev.kind,
        label: rev.label,
        summary: rev.summary,
        // Sanitise then compress — a tampered file can't smuggle a nested
        // `revisions` block (or other junk) into a stored snapshot. A null
        // snapshot (thinned in the source) restores as a metadata-only row.
        snapshotGz: raw == null ? null : packSnapshot(sanitizeSnapshot(raw)),
        createdAt: new Date(rev.createdAt),
      };
    }),
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
