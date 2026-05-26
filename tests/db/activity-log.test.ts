/**
 * DB-backed tests for the activity log (#153, ADR-008 Phase 10).
 *
 * Exercises the write seam and read queries in `lib/activity-log.ts` against a
 * real Postgres: insert vs. coalesce, the actor join, the reverse-chronological
 * feed with cursor pagination, and the latest-per-series recency query.
 *
 * Skipped when DATABASE_URL is unset (the no-DB unit workflow); CI and
 * `pnpm test:unit:db` provide it.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import {
  latestActivityPerSeries,
  listActivity,
  recordActivity,
} from '@/lib/activity-log';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid(): string {
  return crypto.randomUUID();
}

describe.skipIf(skip)('activity log', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let actorA: string;
  let actorB: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });

    workspaceId = `org_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Activity workspace',
      slug: `activity-${workspaceId.slice(4, 12)}`,
      createdAt: new Date(),
    });

    actorA = `usr_${uuid().replace(/-/g, '')}`;
    actorB = `usr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.user).values([
      {
        id: actorA,
        name: 'Mark',
        email: `mark-${actorA}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: actorB,
        name: '',
        email: `sarah-${actorB}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.activityLog).where(eq(schema.activityLog.workspaceId, workspaceId));
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    if (actorA) await db.delete(schema.user).where(eq(schema.user.id, actorA));
    if (actorB) await db.delete(schema.user).where(eq(schema.user.id, actorB));
    await sql?.end();
  });

  test('inserts an entry with the joined actor display name', async () => {
    const seriesId = uuid();
    await recordActivity(
      { workspaceId, userId: actorA },
      { action: 'series.created', seriesId, summary: 'Created the series' },
    );

    const { items } = await listActivity({ workspaceId, seriesId, page: { cursor: null, limit: 50 } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      action: 'series.created',
      summary: 'Created the series',
      count: 1,
      seriesId,
    });
    expect(items[0].actor).toMatchObject({ id: actorA, displayName: 'Mark' });
    // Blank user.name must not surface as an empty displayName.
    expect(items[0].actor?.email).toContain('mark-');
  });

  test('coalesces repeated writes sharing a dedupe key by the same actor', async () => {
    const seriesId = uuid();
    const dedupeKey = `finishes:${uuid()}`;
    for (let i = 0; i < 4; i++) {
      await recordActivity(
        { workspaceId, userId: actorA },
        {
          action: 'finishes.recorded',
          seriesId,
          summary: 'Recorded finishes for Race 3',
          dedupeKey,
        },
      );
    }

    const { items } = await listActivity({ workspaceId, seriesId, page: { cursor: null, limit: 50 } });
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(4);
    expect(items[0].summary).toBe('Recorded finishes for Race 3');
  });

  test('does not coalesce across different actors', async () => {
    const seriesId = uuid();
    const dedupeKey = `finishes:${uuid()}`;
    await recordActivity(
      { workspaceId, userId: actorA },
      { action: 'finishes.recorded', seriesId, summary: 'A', dedupeKey },
    );
    await recordActivity(
      { workspaceId, userId: actorB },
      { action: 'finishes.recorded', seriesId, summary: 'B', dedupeKey },
    );

    const { items } = await listActivity({ workspaceId, seriesId, page: { cursor: null, limit: 50 } });
    expect(items).toHaveLength(2);
    // actorB's row has a blank name → no displayName, but the actor is present.
    const b = items.find((i) => i.actor?.id === actorB);
    expect(b?.actor?.displayName).toBeUndefined();
    expect(b?.actor?.email).toContain('sarah-');
  });

  test('feed is newest-first and cursor-paginates', async () => {
    const seriesId = uuid();
    for (let i = 0; i < 5; i++) {
      await recordActivity(
        { workspaceId, userId: actorA },
        { action: 'race.added', seriesId, summary: `Added Race ${i + 1}` },
      );
    }

    const first = await listActivity({ workspaceId, seriesId, page: { cursor: null, limit: 2 } });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    // Newest first: "Added Race 5" was the last inserted.
    expect(first.items[0].summary).toBe('Added Race 5');

    const second = await listActivity({
      workspaceId,
      seriesId,
      page: {
        cursor: decodeCursorForTest(first.nextCursor!),
        limit: 10,
      },
    });
    // Remaining 3 entries, no overlap with the first page.
    expect(second.items).toHaveLength(3);
    const firstIds = new Set(first.items.map((i) => i.id));
    expect(second.items.every((i) => !firstIds.has(i.id))).toBe(true);
  });

  test('latestActivityPerSeries returns one row per series, excluding workspace-level rows', async () => {
    const s1 = uuid();
    const s2 = uuid();
    await recordActivity({ workspaceId, userId: actorA }, { action: 'series.created', seriesId: s1, summary: 'one' });
    await recordActivity({ workspaceId, userId: actorA }, { action: 'series.updated', seriesId: s1, summary: 'one-newer' });
    await recordActivity({ workspaceId, userId: actorA }, { action: 'series.created', seriesId: s2, summary: 'two' });
    // Workspace-level (no series) — must not appear in the per-series strip.
    await recordActivity({ workspaceId, userId: actorA }, { action: 'series.deleted', seriesId: null, summary: 'gone' });

    const latest = await latestActivityPerSeries(workspaceId);
    const forS1 = latest.find((e) => e.seriesId === s1);
    const forS2 = latest.find((e) => e.seriesId === s2);
    expect(forS1?.summary).toBe('one-newer');
    expect(forS2?.summary).toBe('two');
    expect(latest.every((e) => e.seriesId !== null)).toBe(true);
  });
});

/** Mirror the opaque cursor format so the test can page without exporting internals. */
function decodeCursorForTest(encoded: string): { createdAtMs: number; id: string } {
  const raw = Buffer.from(encoded, 'base64url').toString('utf8');
  const sep = raw.indexOf(':');
  return { createdAtMs: Number.parseInt(raw.slice(0, sep), 10), id: raw.slice(sep + 1) };
}
