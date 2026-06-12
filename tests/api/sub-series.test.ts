// @vitest-environment node

/**
 * Integration tests for the sub-series handlers (#203): the split/merge
 * gestures, the full-partition invariant, displayOrder following race
 * order, and new races defaulting into the last block.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
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

  test('first block with no split point takes every race', async () => {
    const { seriesId } = await makeSeriesWithRaces(3);
    const winter = await subSeries.createSubSeries(ctxA, seriesId, { name: 'Winter' });
    expect(winter.name).toBe('Winter');

    const after = await races.listRaces(ctxA, seriesId);
    expect(after.every((r) => r.subSeriesId === winter.id)).toBe(true);
  });

  test('first split partitions the whole series and needs initialName', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(4);

    await expect(
      subSeries.createSubSeries(ctxA, seriesId, { name: 'Spring', firstRaceId: raceList[2].id }),
    ).rejects.toBeInstanceOf(BadRequestError);

    const spring = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'Spring',
      firstRaceId: raceList[2].id,
      initialName: 'Winter',
    });

    const blocks = await subSeries.listSubSeries(ctxA, seriesId);
    expect(blocks.map((b) => b.name)).toEqual(['Winter', 'Spring']);
    expect(blocks.map((b) => b.displayOrder)).toEqual([0, 1]);

    const after = await races.listRaces(ctxA, seriesId);
    expect(after.map((r) => r.subSeriesId)).toEqual([
      blocks[0].id, blocks[0].id, spring.id, spring.id,
    ]);
  });

  test('splitting an existing block claims its tail; first race of a block rejects', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(4);
    await subSeries.createSubSeries(ctxA, seriesId, { name: 'Winter' });

    await expect(
      subSeries.createSubSeries(ctxA, seriesId, { name: 'Spring', firstRaceId: raceList[0].id }),
    ).rejects.toBeInstanceOf(BadRequestError);

    const spring = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'Spring',
      firstRaceId: raceList[3].id,
    });
    const after = await races.listRaces(ctxA, seriesId);
    expect(after[3].subSeriesId).toBe(spring.id);
    expect(new Set(after.slice(0, 3).map((r) => r.subSeriesId)).size).toBe(1);
    expect(after[0].subSeriesId).not.toBe(spring.id);
  });

  test('rename round-trips', async () => {
    const { seriesId } = await makeSeriesWithRaces(1);
    const block = await subSeries.createSubSeries(ctxA, seriesId, { name: 'Winter' });
    const renamed = await subSeries.renameSubSeries(ctxA, seriesId, block.id, { name: 'Frostbite Winter' });
    expect(renamed.name).toBe('Frostbite Winter');
    const blocks = await subSeries.listSubSeries(ctxA, seriesId);
    expect(blocks[0].name).toBe('Frostbite Winter');
  });

  test('deleting a block merges its races into the previous block', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(4);
    const spring = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'Spring',
      firstRaceId: raceList[2].id,
      initialName: 'Winter',
    });

    await subSeries.deleteSubSeries(ctxA, seriesId, spring.id);
    const blocks = await subSeries.listSubSeries(ctxA, seriesId);
    expect(blocks.map((b) => b.name)).toEqual(['Winter']);
    const after = await races.listRaces(ctxA, seriesId);
    expect(after.every((r) => r.subSeriesId === blocks[0].id)).toBe(true);
  });

  test('deleting the only block returns the series to blockless', async () => {
    const { seriesId } = await makeSeriesWithRaces(2);
    const winter = await subSeries.createSubSeries(ctxA, seriesId, { name: 'Winter' });
    await subSeries.deleteSubSeries(ctxA, seriesId, winter.id);

    expect(await subSeries.listSubSeries(ctxA, seriesId)).toEqual([]);
    const after = await races.listRaces(ctxA, seriesId);
    expect(after.every((r) => r.subSeriesId === null)).toBe(true);
  });

  test('new races default into the last block', async () => {
    const { seriesId, raceList } = await makeSeriesWithRaces(2);
    await subSeries.createSubSeries(ctxA, seriesId, { name: 'Winter' });
    const spring = await subSeries.createSubSeries(ctxA, seriesId, {
      name: 'Spring',
      firstRaceId: raceList[1].id,
    });

    const raceId = uuid();
    const created = await races.putRace(ctxA, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 3, date: '2026-04-15', createdAt: Date.now(),
    });
    expect(created.subSeriesId).toBe(spring.id);

    // An update that omits subSeriesId keeps the existing membership.
    const updated = await races.putRace(ctxA, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 3, date: '2026-04-16', createdAt: created.createdAt,
    });
    expect(updated.subSeriesId).toBe(spring.id);
  });

  test('a race cannot name a sub-series of another series', async () => {
    const { seriesId } = await makeSeriesWithRaces(1);
    const other = await makeSeriesWithRaces(1);
    const otherBlock = await subSeries.createSubSeries(ctxA, other.seriesId, { name: 'Elsewhere' });

    const raceId = uuid();
    await expect(
      races.putRace(ctxA, seriesId, raceId, {
        id: raceId, seriesId, raceNumber: 2, date: '2026-04-15', createdAt: Date.now(),
        subSeriesId: otherBlock.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('cross-workspace access 404s', async () => {
    const { seriesId } = await makeSeriesWithRaces(1);
    const block = await subSeries.createSubSeries(ctxA, seriesId, { name: 'Winter' });

    await expect(subSeries.listSubSeries(ctxB, seriesId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      subSeries.renameSubSeries(ctxB, seriesId, block.id, { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
