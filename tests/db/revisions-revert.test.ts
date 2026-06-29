/**
 * DB-backed test for reverting to a revision (#166), driving the real
 * `revertToRevision` handler against Postgres.
 *
 * Verifies the replay restores the series' data to the chosen snapshot and that
 * the restore is itself recorded as a new `revert` revision.
 *
 * Skipped when DATABASE_URL is unset; CI and `pnpm test:unit:db` provide it.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import { captureRevision, listRevisions } from '@/lib/revision-log';
import { recordSaveMilestone, revertToRevision } from '@/lib/api-handlers/revisions';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import type { Competitor, Series } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid(): string {
  return crypto.randomUUID();
}

function makeSeries(id: string): Series {
  const now = Date.now();
  return {
    id,
    name: 'Revert Series',
    venue: 'HYC',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: now,
    lastSavedAt: null,
    lastModifiedAt: now,
    scoringMode: 'scratch',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    enabledCompetitorFields: [],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
  };
}

function makeCompetitor(seriesId: string, sailNumber: string): Competitor {
  return {
    id: uuid(),
    seriesId,
    fleetIds: [],
    sailNumber,
    name: `Boat ${sailNumber}`,
    crewName: '',
    boatName: '',
    boatClass: '',
    club: '',
    gender: '',
    age: null,
    createdAt: Date.now(),
  } as Competitor;
}

describe.skipIf(skip)('revertToRevision', () => {
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
      name: 'Revert workspace',
      slug: `revert-${workspaceId.slice(4, 12)}`,
      createdAt: new Date(),
    });

    actorA = `usr_${uuid().replace(/-/g, '')}`;
    actorB = `usr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.user).values([
      { id: actorA, name: 'Mark', email: `mark-${actorA}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      { id: actorB, name: 'Sarah', email: `sarah-${actorB}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    ]);
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.seriesRevision).where(eq(schema.seriesRevision.workspaceId, workspaceId));
      await db.delete(schema.series).where(eq(schema.series.workspaceId, workspaceId));
      await db.delete(schema.activityLog).where(eq(schema.activityLog.workspaceId, workspaceId));
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    if (actorA) await db.delete(schema.user).where(eq(schema.user.id, actorA));
    if (actorB) await db.delete(schema.user).where(eq(schema.user.id, actorB));
    await sql?.end();
  });

  function ctx(userId: string): WorkspaceContext {
    return {
      userId,
      email: 'x@example.test',
      workspaceId,
      workspaceSlug: 'revert-ws',
      role: 'owner',
      features: [],
    };
  }

  test('restores the series data and records a revert revision', async () => {
    const repos = createRepos({ workspaceId });
    const seriesId = uuid();
    await repos.series.save(makeSeries(seriesId));

    // Revision A: one competitor. Actor A.
    await repos.competitors.save(makeCompetitor(seriesId, 'A1'));
    await captureRevision({ workspaceId, userId: actorA }, seriesId, { summary: 'one competitor' });

    // Revision B: a second competitor. Actor B (so it doesn't coalesce).
    await repos.competitors.save(makeCompetitor(seriesId, 'B2'));
    await captureRevision({ workspaceId, userId: actorB }, seriesId, { summary: 'two competitors' });

    const before = await listRevisions(ctx(actorA), seriesId);
    expect(before).toHaveLength(2);
    expect(await repos.competitors.listBySeries(seriesId)).toHaveLength(2);

    // Revert to revision A (the older one).
    const revA = before[before.length - 1];
    await revertToRevision(ctx(actorA), seriesId, revA.id);

    // The series is back to one competitor (A1) — B2 is gone.
    const after = await repos.competitors.listBySeries(seriesId);
    expect(after).toHaveLength(1);
    expect(after[0].sailNumber).toBe('A1');

    // The restore is itself recorded as a new `revert` revision.
    const revs = await listRevisions(ctx(actorA), seriesId);
    expect(revs).toHaveLength(3);
    expect(revs[0].kind).toBe('revert');
  });

  test('a save milestone seals the open session and pins a `saved` revision', async () => {
    const repos = createRepos({ workspaceId });
    const seriesId = uuid();
    await repos.series.save(makeSeries(seriesId));

    await captureRevision({ workspaceId, userId: actorA }, seriesId, {
      summary: 'edit', sessionKey: 'settings',
    });
    await recordSaveMilestone(ctx(actorA), seriesId);
    // A same-context edit after the milestone must not fold back into the
    // sealed pre-save revision.
    await captureRevision({ workspaceId, userId: actorA }, seriesId, {
      summary: 'edit 2', sessionKey: 'settings',
    });

    const revs = await listRevisions(ctx(actorA), seriesId);
    // pre-save auto · saved milestone · post-save auto
    expect(revs).toHaveLength(3);
    expect(revs.map((r) => r.kind)).toEqual(['auto', 'saved', 'auto']);
    expect(revs.find((r) => r.kind === 'saved')?.label).toBe('Saved to file');
  });
});
