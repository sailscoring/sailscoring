// @vitest-environment node

/**
 * Integration tests for the /api/v1 handler logic. These call the
 * handler functions in lib/api-handlers/ directly with a synthesised
 * WorkspaceContext, skipping the workspaceRoute wrapper (which has
 * its own focused test).
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
import * as fleets from '@/lib/api-handlers/fleets';
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import * as raceStarts from '@/lib/api-handlers/race-starts';
import * as finishes from '@/lib/api-handlers/finishes';

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
    role: 'owner',
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
    createdAt: Date.now(),
    lastSnapshotId: null,
    lastSavedAt: null,
    lastModifiedAt: Date.now(),
    snapshotHistory: [],
    scoringMode: 'handicap' as const,
    discardThresholds: [],
    dnfScoring: 'seriesEntries' as const,
    ftpHost: '',
    ftpPath: '',
    bilgeBundle: null,
    includeJsonExport: true,
    publishRatingCalculations: true,
    enabledCompetitorFields: ['boatName', 'club'],
    primaryPersonLabel: 'helm' as const,
  };
}

describe.skipIf(skip)('/api/v1 handler logic', () => {
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

  // ─── Series ────────────────────────────────────────────────────────────────

  test('series: PUT then GET; cross-workspace GET 404s', async () => {
    const id = uuid();
    const created = await series.putSeries(ctxA, id, sampleSeries(id));
    expect(created.id).toBe(id);

    const fetched = await series.getSeries(ctxA, id);
    expect(fetched.name).toBe(created.name);

    await expect(series.getSeries(ctxB, id)).rejects.toBeInstanceOf(NotFoundError);

    const list = await series.listSeries(ctxA);
    expect(list.items.some((s) => s.id === id)).toBe(true);
    const listB = await series.listSeries(ctxB);
    expect(listB.items.some((s) => s.id === id)).toBe(false);

    await series.deleteSeries(ctxA, id);
    await expect(series.getSeries(ctxA, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('series: PUT body id mismatch with path is rejected', async () => {
    const pathId = uuid();
    const bodyId = uuid();
    await expect(
      series.putSeries(ctxA, pathId, sampleSeries(bodyId)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // ─── Fleets ────────────────────────────────────────────────────────────────

  test('fleets: list/get/put/delete; series-id mismatch rejected', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));

    const fleetId = uuid();
    const fleet = {
      id: fleetId, seriesId, name: 'NHC',
      displayOrder: 0, scoringSystem: 'nhc' as const, nhcAlpha: 0.18,
    };
    const created = await fleets.putFleet(ctxA, seriesId, fleetId, fleet);
    expect(created).toMatchObject({ id: fleetId, scoringSystem: 'nhc', nhcAlpha: 0.18 });

    const list = await fleets.listFleets(ctxA, seriesId);
    expect(list.map((f) => f.id)).toContain(fleetId);

    // Cross-workspace returns NotFound on parent series.
    await expect(fleets.listFleets(ctxB, seriesId)).rejects.toBeInstanceOf(NotFoundError);

    // PUT under wrong series id is rejected.
    const otherSeriesId = uuid();
    await series.putSeries(ctxA, otherSeriesId, sampleSeries(otherSeriesId));
    await expect(
      fleets.putFleet(ctxA, otherSeriesId, fleetId, fleet),
    ).rejects.toBeInstanceOf(NotFoundError);

    await fleets.deleteFleet(ctxA, seriesId, fleetId);
    await expect(fleets.getFleet(ctxA, seriesId, fleetId)).rejects.toBeInstanceOf(NotFoundError);

    await series.deleteSeries(ctxA, seriesId);
    await series.deleteSeries(ctxA, otherSeriesId);
  });

  // ─── Bulk fleets ───────────────────────────────────────────────────────────

  test('fleets.bulkPutFleets inserts a batch and rejects mismatched seriesId', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));

    const inputs = [
      { id: uuid(), seriesId, name: 'IRC', displayOrder: 0, scoringSystem: 'irc' as const },
      { id: uuid(), seriesId, name: 'PY', displayOrder: 1, scoringSystem: 'py' as const },
    ];
    const result = await fleets.bulkPutFleets(ctxA, seriesId, { fleets: inputs });
    expect(result).toEqual({ count: 2 });
    const list = await fleets.listFleets(ctxA, seriesId);
    expect(list.map((f) => f.name).sort()).toEqual(['IRC', 'PY']);

    // Mixed seriesId is rejected.
    const otherSeriesId = uuid();
    await series.putSeries(ctxA, otherSeriesId, sampleSeries(otherSeriesId));
    await expect(
      fleets.bulkPutFleets(ctxA, seriesId, {
        fleets: [{ id: uuid(), seriesId: otherSeriesId, name: 'X', displayOrder: 0, scoringSystem: 'scratch' as const }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Cross-workspace returns NotFound on parent series.
    await expect(
      fleets.bulkPutFleets(ctxB, seriesId, { fleets: [] }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await series.deleteSeries(ctxA, seriesId);
    await series.deleteSeries(ctxA, otherSeriesId);
  });

  // ─── Competitors ───────────────────────────────────────────────────────────

  test('competitors: list/get/put round-trips optional fields', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const fleetId = uuid();
    await fleets.putFleet(ctxA, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'F', displayOrder: 0, scoringSystem: 'irc' as const,
    });

    const compId = uuid();
    const competitor = {
      id: compId, seriesId, fleetIds: [fleetId],
      sailNumber: '1234', boatName: 'Big', name: 'Helm',
      club: 'HYC', gender: 'M' as const, age: 42,
      createdAt: Date.now(), ircTcc: 0.972,
    };
    const created = await competitors.putCompetitor(ctxA, seriesId, compId, competitor);
    expect(created).toMatchObject({ sailNumber: '1234', boatName: 'Big', ircTcc: 0.972 });

    const fetched = await competitors.getCompetitor(ctxA, seriesId, compId);
    expect(fetched.boatName).toBe('Big');

    await competitors.deleteCompetitor(ctxA, seriesId, compId);
    await expect(competitors.getCompetitor(ctxA, seriesId, compId)).rejects.toBeInstanceOf(NotFoundError);
    await series.deleteSeries(ctxA, seriesId);
  });

  // ─── Bulk competitors ──────────────────────────────────────────────────────

  test('competitors.bulkPutCompetitors inserts a batch and rejects mismatched seriesId', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const fleetId = uuid();
    await fleets.putFleet(ctxA, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'F', displayOrder: 0, scoringSystem: 'irc' as const,
    });

    const inputs = Array.from({ length: 10 }, (_, i) => ({
      id: uuid(),
      seriesId,
      fleetIds: [fleetId],
      sailNumber: String(2000 + i),
      name: `Helm ${i}`,
      club: '', gender: '' as const, age: null,
      createdAt: Date.now(),
    }));
    const result = await competitors.bulkPutCompetitors(ctxA, seriesId, { competitors: inputs });
    expect(result).toEqual({ count: 10 });
    const list = await competitors.listCompetitors(ctxA, seriesId);
    expect(list).toHaveLength(10);

    // Mixed seriesId is rejected.
    const otherSeriesId = uuid();
    await series.putSeries(ctxA, otherSeriesId, sampleSeries(otherSeriesId));
    await expect(
      competitors.bulkPutCompetitors(ctxA, seriesId, {
        competitors: [{
          id: uuid(), seriesId: otherSeriesId, fleetIds: [],
          sailNumber: '1', name: 'X', club: '', gender: '' as const, age: null,
          createdAt: Date.now(),
        }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await series.deleteSeries(ctxA, seriesId);
    await series.deleteSeries(ctxA, otherSeriesId);
  });

  // ─── Races + race starts + finishes (bulk + single) ───────────────────────

  test('full race round-trip incl. bulk finishes', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const fleetId = uuid();
    await fleets.putFleet(ctxA, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'F', displayOrder: 0, scoringSystem: 'scratch' as const,
    });
    const compIds = [uuid(), uuid(), uuid()];
    for (const [i, id] of compIds.entries()) {
      await competitors.putCompetitor(ctxA, seriesId, id, {
        id, seriesId, fleetIds: [fleetId],
        sailNumber: String(100 + i), name: `Boat ${i}`,
        club: '', gender: '' as const, age: null, createdAt: Date.now(),
      });
    }

    const raceId = uuid();
    await races.putRace(ctxA, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-04-01', createdAt: Date.now(),
    });

    const startId = uuid();
    await raceStarts.putRaceStart(ctxA, raceId, startId, {
      id: startId, raceId, fleetIds: [fleetId], startTime: '11:00:00',
    });
    expect(await raceStarts.listRaceStarts(ctxA, raceId)).toHaveLength(1);

    const bulk = await finishes.bulkPutFinishes(ctxA, raceId, {
      finishes: compIds.map((id, i) => ({
        id: uuid(), raceId, competitorId: id,
        sortOrder: i + 1, resultCode: null, startPresent: null,
        penaltyCode: null, penaltyOverride: null,
        redressMethod: null, redressExcludeRaces: null,
        redressIncludeRaces: null,
        tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
      })),
    });
    expect(bulk.count).toBe(3);

    const list = await finishes.listFinishes(ctxA, raceId);
    expect(list).toHaveLength(3);

    // Cross-workspace operations on this race fail.
    await expect(finishes.listFinishes(ctxB, raceId)).rejects.toBeInstanceOf(NotFoundError);

    await series.deleteSeries(ctxA, seriesId);
  });

  test('bulk finish race-id mismatch is rejected', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const raceId = uuid();
    await races.putRace(ctxA, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-04-01', createdAt: Date.now(),
    });

    await expect(
      finishes.bulkPutFinishes(ctxA, raceId, {
        finishes: [{
          id: uuid(), raceId: uuid(), competitorId: null,
          sortOrder: null, resultCode: 'DNC', startPresent: null,
          penaltyCode: null, penaltyOverride: null,
          redressMethod: null, redressExcludeRaces: null,
          redressIncludeRaces: null,
          tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
        }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await series.deleteSeries(ctxA, seriesId);
  });
});
