import 'server-only';
import { and, desc, eq, gt, isNotNull, lt, or } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { user } from '@/lib/db/schema/auth';
import { activityLog } from '@/lib/db/schema/series';
import {
  encodeCursor,
  type PageRequest,
} from '@/app/api/v1/_lib/pagination';

/**
 * Activity log (#153, ADR-008 Phase 10). The write seam (`recordActivity`),
 * the read queries that back the Activity tab and the series-list recency
 * strips, and the pure `activityKind` mapping the surfaces use to pick an
 * icon. Server-only — the table is workspace-scoped and never touched from
 * the client.
 *
 * Logging is best-effort: `recordActivity` swallows its own errors so a
 * logging failure can never fail the mutation it describes. Attribution is a
 * convenience, not a transactional guarantee.
 */

/**
 * The action vocabulary. Coarse and stable — surfaces key icons/grouping off
 * `activityKind(action)`, and an unknown string degrades gracefully rather
 * than throwing, so a newer server writing an action an older client doesn't
 * know about never crashes the feed.
 */
export const ACTIVITY_ACTIONS = [
  'series.created',
  'series.updated',
  'series.archived',
  'series.unarchived',
  'series.recategorized',
  'series.deleted',
  'series.copied',
  'competitors.imported',
  'competitors.handicaps_updated',
  'competitors.cleared',
  'race.added',
  'race.deleted',
  'finishes.recorded',
  'finishes.entered',
  'finishes.cleared',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export type ActivityKind =
  | 'series'
  | 'competitor'
  | 'race'
  | 'finish'
  | 'other';

/**
 * Maps an action to its display kind (drives the icon/colour on the Activity
 * surfaces). Pure and total: any unrecognised action — including a future one
 * this build predates — falls back to `'other'`.
 */
export function activityKind(action: string): ActivityKind {
  if (action.startsWith('series.')) return 'series';
  if (action.startsWith('competitors.')) return 'competitor';
  if (action.startsWith('finishes.')) return 'finish';
  if (action.startsWith('race.')) return 'race';
  return 'other';
}

/** A race-day session: per-row finish writes inside this window fold together. */
const COALESCE_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface RecordActivityInput {
  action: ActivityAction;
  /** Series the action belongs to; omit / null for workspace-level actions. */
  seriesId?: string | null;
  /** Pre-rendered human sentence, e.g. `Entered 12 finishes for Race 3`. */
  summary: string;
  /**
   * When set, repeated writes sharing this key (per workspace + actor) inside
   * the session window fold into one row, bumping `metadata.count` and the
   * timestamp instead of inserting a new row.
   */
  dedupeKey?: string;
  /** Structured context; reserved for future field-level detail. */
  metadata?: Record<string, unknown>;
}

interface Actor {
  workspaceId: string;
  userId: string;
}

function countOf(metadata: unknown): number {
  const c = (metadata as { count?: unknown } | null)?.count;
  return typeof c === 'number' && c > 0 ? c : 1;
}

/**
 * Append an activity entry. Best-effort — never throws into the caller.
 *
 * Coalescing: when `dedupeKey` is set and a matching row exists inside the
 * window, the existing row is updated (summary refreshed, `count` incremented,
 * `created_at` bumped to float it to the head of the feed) rather than a new
 * row inserted.
 */
export async function recordActivity(
  actor: Actor,
  input: RecordActivityInput,
): Promise<void> {
  try {
    const db = getDb();

    if (input.dedupeKey) {
      const cutoff = new Date(Date.now() - COALESCE_WINDOW_MS);
      const [recent] = await db
        .select({ id: activityLog.id, metadata: activityLog.metadata })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.workspaceId, actor.workspaceId),
            eq(activityLog.dedupeKey, input.dedupeKey),
            eq(activityLog.actorUserId, actor.userId),
            gt(activityLog.createdAt, cutoff),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(1);

      if (recent) {
        await db
          .update(activityLog)
          .set({
            summary: input.summary,
            metadata: { ...(input.metadata ?? {}), count: countOf(recent.metadata) + 1 },
            createdAt: new Date(),
          })
          .where(eq(activityLog.id, recent.id));
        return;
      }
    }

    await db.insert(activityLog).values({
      id: crypto.randomUUID(),
      workspaceId: actor.workspaceId,
      seriesId: input.seriesId ?? null,
      actorUserId: actor.userId,
      action: input.action,
      summary: input.summary,
      dedupeKey: input.dedupeKey ?? null,
      metadata: { ...(input.metadata ?? {}), count: 1 },
    });
  } catch (err) {
    console.error('recordActivity failed (non-fatal):', err);
  }
}

export interface ActivityEntry {
  id: string;
  seriesId: string | null;
  action: string;
  summary: string;
  /** Coalesced occurrence count; 1 for ordinary entries. */
  count: number;
  /** ISO-8601 timestamp of the (most recent) occurrence. */
  createdAt: string;
  actor: { id: string; email?: string; displayName?: string } | null;
}

function toEntry(row: {
  id: string;
  seriesId: string | null;
  action: string;
  summary: string;
  metadata: unknown;
  createdAt: Date;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
}): ActivityEntry {
  return {
    id: row.id,
    seriesId: row.seriesId,
    action: row.action,
    summary: row.summary,
    count: countOf(row.metadata),
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

const ACTIVITY_SELECTION = {
  id: activityLog.id,
  seriesId: activityLog.seriesId,
  action: activityLog.action,
  summary: activityLog.summary,
  metadata: activityLog.metadata,
  createdAt: activityLog.createdAt,
  actorId: user.id,
  actorEmail: user.email,
  actorName: user.name,
} as const;

/**
 * Reverse-chronological activity feed for a workspace, optionally narrowed to
 * one series. Cursor-paginated with the shared opaque cursor (createdAt + id),
 * so coalesced rows that float to the head don't break the page boundary.
 */
export async function listActivity(opts: {
  workspaceId: string;
  seriesId?: string;
  page: PageRequest;
}): Promise<{ items: ActivityEntry[]; nextCursor: string | null }> {
  const { workspaceId, seriesId, page } = opts;
  const filters = [eq(activityLog.workspaceId, workspaceId)];
  if (seriesId) filters.push(eq(activityLog.seriesId, seriesId));
  if (page.cursor) {
    const c = page.cursor;
    const cursorTs = new Date(c.createdAtMs);
    // Keyset: strictly older, or same instant with a smaller id.
    filters.push(
      or(
        lt(activityLog.createdAt, cursorTs),
        and(eq(activityLog.createdAt, cursorTs), lt(activityLog.id, c.id)),
      )!,
    );
  }

  const rows = await getDb()
    .select(ACTIVITY_SELECTION)
    .from(activityLog)
    .leftJoin(user, eq(activityLog.actorUserId, user.id))
    .where(and(...filters))
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(page.limit + 1);

  const hasMore = rows.length > page.limit;
  const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toEntry),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.getTime(), id: last.id })
        : null,
  };
}

/**
 * The most recent activity entry per series in a workspace — feeds the
 * "last edited by … 2h ago" strip on the series list. Workspace-level rows
 * (`series_id IS NULL`, e.g. a deletion) are excluded; they have no card to
 * attach to.
 */
export async function latestActivityPerSeries(
  workspaceId: string,
): Promise<ActivityEntry[]> {
  const rows = await getDb()
    .selectDistinctOn([activityLog.seriesId], ACTIVITY_SELECTION)
    .from(activityLog)
    .leftJoin(user, eq(activityLog.actorUserId, user.id))
    .where(
      and(
        eq(activityLog.workspaceId, workspaceId),
        isNotNull(activityLog.seriesId),
      ),
    )
    .orderBy(activityLog.seriesId, desc(activityLog.createdAt), desc(activityLog.id));
  return rows.map(toEntry);
}
