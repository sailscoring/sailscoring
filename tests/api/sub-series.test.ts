// @vitest-environment node

/**
 * Integration tests for the sub-series handlers (#203): membership selection
 * (many-to-many, overlapping), PUT editing, deletion leaving races and other
 * sub-series intact, and workspace isolation.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as races from '@/lib/api-handlers/races';
import * as subSeries from '@/lib/api-handlers/sub-series';
import type { Race } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

function ctxFor(workspaceId: string): WorkspaceContext {
  return {
    userId: 'test-user',
    email: 'test@sailscoring.test',
    workspaceId,
    workspaceSlug: 'test-ws',
    role: 'owner',
    features: [],
  };
}

function sampleSeries(id: string) {
  return {
    id,
    name: `Series ${id.slice(0, 8)}`,
    venue: 'HYC',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: Date.now(),
    lastSavedAt: null,
    lastModifiedAt: Date.now(),
    scoringMode: 'scratch' as const,
    discardThresholds: [],
    dnfScoring: 'seriesEntries' as const,
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    enabledCompetitorFields: ['boatName', 'club'],
    primaryPersonLabel: 'helm' as const,
    subdivisionLabel: 'Division',
  };
}

describe.skipIf(skip)('sub-series handlers', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceA: string;
  let workspaceB: string;
  let ctxA: WorkspaceContext;
  let ctxB: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceA = `org_a_${uuid().replace(/-/g, '')}`;
    workspaceB = `org_b_${uuid().replace(/-/g, '')}`;
    const now = new Date();
    await db.insert(schema.organization).values([
      { id: workspaceA, name: 'A', slug: `a-${workspaceA.slice(6, 16)}`, createdAt: now },
      { id: workspaceB, name: 'B', slug: `b-${workspaceB.slice(6, 16)}`, createdAt: now },
    ]);
    ctxA = ctxFor(workspaceA);
    ctxB = ctxFor(workspaceB);
  });

  afterAll(async () => {
    if (workspaceA) await db.delete(schema.organization).where(eq(schema.organization.id, workspaceA));
    if (workspaceB) await db.delete(schema.organization).where(eq(schema.organization.id, workspaceB));
    await sql?.end();
  });

  async function makeSeriesWithRaces(raceCount: number): Promise<{ seriesId: string; raceList: Race[] }> {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const raceList: Race[] = [];
    for (let n = 1; n <= raceCount; n++) {
      const raceId = uuid();
      raceList.push(
        await races.putRace(ctxA, seriesId, raceId, {
          id: raceId, seriesId, raceNumber: n, date: '2026-04-01', createdAt: Date.now(),
        }),
      );
    }
    return { seriesId, raceList };
  }

  test('create selects the given races', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(3);
    const ss = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'Tuesdays',
      raceIds: [raceList[0].id, raceList[2].id],
    });
    expect(ss.name).toBe('Tuesdays');
    expect(new Set(ss.raceIds)).toEqual(new Set([raceList[0].id, raceList[2].id]));

    const [reloaded] = await subSeries.listSubSeries(ctxA, seriesId);
    expect(new Set(reloaded.raceIds)).toEqual(new Set([raceList[0].id, raceList[2].id]));
    // Races themselves are unchanged.
    expect((await races.listRaces(ctxA, seriesId)).map((r) => r.raceNumber)).toEqual([1, 2, 3]);
  });

  test('create with no races is allowed and editable via PUT', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(2);
    const ss = await subSeries.createSubSeries(ctxA, seriesId, { name: 'Empty' });
    expect(ss.raceIds).toEqual([]);

    const updated = await subSeries.putSubSeries(ctxA, seriesId, ss.id, {
      ...ss, raceIds: [raceList[1].id],
    });
    expect(updated.raceIds).toEqual([raceList[1].id]);
    const [reloaded] = await subSeries.listSubSeries(ctxA, seriesId);
    expect(reloaded.raceIds).toEqual([raceList[1].id]);
  });

  test('sub-series may overlap — a race belongs to several', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(3);
    const all = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'Overall', raceIds: raceList.map((r) => r.id),
    });
    const opener = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'Opener', raceIds: [raceList[0].id],
    });
    expect(all.raceIds).toHaveLength(3);
    expect(opener.raceIds).toEqual([raceList[0].id]);
  });

  test('create drops race ids that belong to another series', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(2);
    const other = await makeSeriesWithRaces(1);
    const ss = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'Mixed', raceIds: [raceList[0].id, other.raceList[0].id],
    });
    expect(ss.raceIds).toEqual([raceList[0].id]);
  });

  test('rename round-trips via PUT upsert and keeps membership', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(1);
    const block = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'Winter', raceIds: [raceList[0].id],
    });
    const renamed = await subSeries.putSubSeries(ctxA, seriesId, block.id, {
      ...block, name: 'Frostbite Winter',
    });
    expect(renamed.name).toBe('Frostbite Winter');
    expect(renamed.raceIds).toEqual([raceList[0].id]);
  });

  test('deleting a sub-series leaves races and other sub-series intact', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(3);
    const a = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'A', raceIds: [raceList[0].id, raceList[1].id],
    });
    await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'B', raceIds: [raceList[1].id, raceList[2].id],
    });

    await subSeries.deleteSubSeries(ctxA, seriesId, a.id);

    const blocks = await subSeries.listSubSeries(ctxA, seriesId);
    expect(blocks.map((b) => b.name)).toEqual(['B']);
    expect(blocks[0].displayOrder).toBe(0); // compacted
    expect(new Set(blocks[0].raceIds)).toEqual(new Set([raceList[1].id, raceList[2].id]));
    // The races (including the shared one) are untouched.
    expect((await races.listRaces(ctxA, seriesId)).map((r) => r.raceNumber)).toEqual([1, 2, 3]);
  });

  test('cross-workspace access 404s', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(1);
    const block = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'Winter', raceIds: [raceList[0].id],
    });

    await expect(subSeries.listSubSeries(ctxB, seriesId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      subSeries.putSubSeries(ctxB, seriesId, block.id, { ...block, name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
