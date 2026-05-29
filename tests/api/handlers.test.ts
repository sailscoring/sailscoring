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

// Delete now requires the series to be archived first (#154). These tests
// predate that rule and use deleteSeries for teardown, so archive-then-delete.
async function removeSeries(ctx: WorkspaceContext, id: string) {
  await series.setSeriesArchived(ctx, id, { archived: true });
  await series.deleteSeries(ctx, id);
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
    lastSnapshotId: null,
    lastSavedAt: null,
    lastModifiedAt: Date.now(),
    snapshotHistory: [],
    scoringMode: 'handicap' as const,
    discardThresholds: [],
    dnfScoring: 'seriesEntries' as const,
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    publishRatingCalculations: true,
    enabledCompetitorFields: ['boatName', 'club'],
    primaryPersonLabel: 'helm' as const,
    subdivisionLabel: 'Division',
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

    await removeSeries(ctxA, id);
    await expect(series.getSeries(ctxA, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('series: PUT round-trips every optional / default-true field', async () => {
    // The booleans below default to `true` on save, so a field dropped in the
    // putSeries merge is silently coerced back to `true` (the showPerRace bug).
    // Set them `false` and the other optionals to non-defaults so any dropped
    // field surfaces as a failed round-trip rather than hiding behind a default.
    const id = uuid();
    const input = {
      ...sampleSeries(id),
      includeJsonExport: false,
      publishRatingCalculations: false,
      showPerRaceRatingsInSummary: false,
      defaultStartSequence: [{ fleetIds: [], intervalMinutes: 5 }],
      subdivisionLabel: 'Class',
    };
    await series.putSeries(ctxA, id, input);

    const got = await series.getSeries(ctxA, id);
    expect(got.includeJsonExport).toBe(false);
    expect(got.publishRatingCalculations).toBe(false);
    expect(got.showPerRaceRatingsInSummary).toBe(false);
    expect(got.defaultStartSequence).toEqual(input.defaultStartSequence);
    expect(got.subdivisionLabel).toBe('Class');

    await removeSeries(ctxA, id);
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
      displayOrder: 0, scoringSystem: 'nhc' as const,
    };
    const created = await fleets.putFleet(ctxA, seriesId, fleetId, fleet);
    expect(created).toMatchObject({ id: fleetId, scoringSystem: 'nhc' });

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

    await removeSeries(ctxA, seriesId);
    await removeSeries(ctxA, otherSeriesId);
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

    await removeSeries(ctxA, seriesId);
    await removeSeries(ctxA, otherSeriesId);
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
    await removeSeries(ctxA, seriesId);
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

    await removeSeries(ctxA, seriesId);
    await removeSeries(ctxA, otherSeriesId);
  });

  test('competitors.bulkUpdateHandicaps writes only the listed fields', async () => {
    const { ConflictError } = await import('@/lib/repository');
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const fleetId = uuid();
    await fleets.putFleet(ctxA, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'F', displayOrder: 0, scoringSystem: 'nhc' as const,
    });
    const compId = uuid();
    const created = await competitors.putCompetitor(ctxA, seriesId, compId, {
      id: compId, seriesId, fleetIds: [fleetId],
      sailNumber: 'IRL 1', boatName: 'Zesty', name: 'Skipper',
      club: 'HYC', gender: 'M' as const, age: 40, createdAt: Date.now(),
      nhcStartingTcf: 1.201, ircTcc: 0.972,
    });

    // Happy path: only nhcStartingTcf is updated; the rest of the row is preserved.
    const { updated } = await competitors.bulkUpdateHandicaps(ctxA, seriesId, {
      updates: [
        { competitorId: compId, expectedVersion: created.version, nhcStartingTcf: 1.019 },
      ],
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      id: compId,
      nhcStartingTcf: 1.019,
      ircTcc: 0.972,   // untouched
      boatName: 'Zesty', // untouched
    });
    expect(updated[0].version).toBe((created.version ?? 1) + 1);

    // Cross-series competitor in the same batch is rejected (transaction rolls back).
    const otherSeriesId = uuid();
    await series.putSeries(ctxA, otherSeriesId, sampleSeries(otherSeriesId));
    const otherFleetId = uuid();
    await fleets.putFleet(ctxA, otherSeriesId, otherFleetId, {
      id: otherFleetId, seriesId: otherSeriesId, name: 'F', displayOrder: 0, scoringSystem: 'irc' as const,
    });
    const otherCompId = uuid();
    const otherCreated = await competitors.putCompetitor(ctxA, otherSeriesId, otherCompId, {
      id: otherCompId, seriesId: otherSeriesId, fleetIds: [otherFleetId],
      sailNumber: 'X', name: 'X', club: '', gender: '' as const, age: null, createdAt: Date.now(),
      ircTcc: 1.0,
    });
    await expect(
      competitors.bulkUpdateHandicaps(ctxA, seriesId, {
        updates: [
          { competitorId: otherCompId, expectedVersion: otherCreated.version ?? 1, ircTcc: 0.5 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Other-series row untouched.
    const otherFetched = await competitors.getCompetitor(ctxA, otherSeriesId, otherCompId);
    expect(otherFetched.ircTcc).toBe(1.0);

    // Stale expectedVersion → ConflictError, rolls back the whole batch.
    const compNow = await competitors.getCompetitor(ctxA, seriesId, compId);
    const staleVersion = (compNow.version ?? 1) - 1;
    await expect(
      competitors.bulkUpdateHandicaps(ctxA, seriesId, {
        updates: [
          { competitorId: compId, expectedVersion: staleVersion, nhcStartingTcf: 9.999 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Row still at the latest committed value.
    const compAfterConflict = await competitors.getCompetitor(ctxA, seriesId, compId);
    expect(compAfterConflict.nhcStartingTcf).toBe(1.019);

    await removeSeries(ctxA, seriesId);
    await removeSeries(ctxA, otherSeriesId);
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

    const bulkStarts = await raceStarts.bulkPutRaceStarts(ctxA, raceId, {
      starts: [
        { id: uuid(), raceId, fleetIds: [fleetId], startTime: '11:05:00' },
        { id: uuid(), raceId, fleetIds: [fleetId], startTime: '11:10:00' },
      ],
    });
    expect(bulkStarts.count).toBe(2);
    expect(await raceStarts.listRaceStarts(ctxA, raceId)).toHaveLength(3);

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

    await removeSeries(ctxA, seriesId);
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

    await removeSeries(ctxA, seriesId);
  });

  test('bulk race start race-id mismatch is rejected', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const raceId = uuid();
    await races.putRace(ctxA, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-04-01', createdAt: Date.now(),
    });

    await expect(
      raceStarts.bulkPutRaceStarts(ctxA, raceId, {
        starts: [{ id: uuid(), raceId: uuid(), fleetIds: [], startTime: '11:00:00' }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await removeSeries(ctxA, seriesId);
  });

  // ─── Collection deletes ────────────────────────────────────────────────────

  test('bulkDeleteFleets drops every fleet; cross-workspace 404s', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    await fleets.bulkPutFleets(ctxA, seriesId, {
      fleets: [
        { id: uuid(), seriesId, name: 'IRC', displayOrder: 0, scoringSystem: 'irc' as const },
        { id: uuid(), seriesId, name: 'PY', displayOrder: 1, scoringSystem: 'py' as const },
      ],
    });
    expect(await fleets.listFleets(ctxA, seriesId)).toHaveLength(2);

    await expect(
      fleets.bulkDeleteFleets(ctxB, seriesId),
    ).rejects.toBeInstanceOf(NotFoundError);

    await fleets.bulkDeleteFleets(ctxA, seriesId);
    expect(await fleets.listFleets(ctxA, seriesId)).toHaveLength(0);

    await removeSeries(ctxA, seriesId);
  });

  test('bulkDeleteCompetitors drops every competitor; cross-workspace 404s', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const fleetId = uuid();
    await fleets.putFleet(ctxA, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'F', displayOrder: 0, scoringSystem: 'irc' as const,
    });
    await competitors.bulkPutCompetitors(ctxA, seriesId, {
      competitors: Array.from({ length: 5 }, (_, i) => ({
        id: uuid(), seriesId, fleetIds: [fleetId],
        sailNumber: String(3000 + i), name: `Helm ${i}`,
        club: '', gender: '' as const, age: null, createdAt: Date.now(),
      })),
    });
    expect(await competitors.listCompetitors(ctxA, seriesId)).toHaveLength(5);

    await expect(
      competitors.bulkDeleteCompetitors(ctxB, seriesId),
    ).rejects.toBeInstanceOf(NotFoundError);

    await competitors.bulkDeleteCompetitors(ctxA, seriesId);
    expect(await competitors.listCompetitors(ctxA, seriesId)).toHaveLength(0);

    await removeSeries(ctxA, seriesId);
  });

  test('bulkDeleteRaces drops every race and cascades to starts/finishes', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const fleetId = uuid();
    await fleets.putFleet(ctxA, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'F', displayOrder: 0, scoringSystem: 'scratch' as const,
    });
    const compId = uuid();
    await competitors.putCompetitor(ctxA, seriesId, compId, {
      id: compId, seriesId, fleetIds: [fleetId],
      sailNumber: '500', name: 'Boat', club: '', gender: '' as const,
      age: null, createdAt: Date.now(),
    });
    const raceId = uuid();
    await races.putRace(ctxA, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-04-01', createdAt: Date.now(),
    });
    const startId = uuid();
    await raceStarts.putRaceStart(ctxA, raceId, startId, {
      id: startId, raceId, fleetIds: [fleetId], startTime: '11:00:00',
    });
    await finishes.bulkPutFinishes(ctxA, raceId, {
      finishes: [{
        id: uuid(), raceId, competitorId: compId,
        sortOrder: 1, resultCode: null, startPresent: null,
        penaltyCode: null, penaltyOverride: null,
        redressMethod: null, redressExcludeRaces: null,
        redressIncludeRaces: null,
        tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
      }],
    });

    await expect(
      races.bulkDeleteRaces(ctxB, seriesId),
    ).rejects.toBeInstanceOf(NotFoundError);

    await races.bulkDeleteRaces(ctxA, seriesId);
    expect(await races.listRaces(ctxA, seriesId)).toHaveLength(0);
    // Race gone → starts/finishes are FK-cascaded; querying them 404s on parent race.
    await expect(
      raceStarts.listRaceStarts(ctxA, raceId),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      finishes.listFinishes(ctxA, raceId),
    ).rejects.toBeInstanceOf(NotFoundError);

    await removeSeries(ctxA, seriesId);
  });

  test('bulkDeleteRaceStarts drops every start; cross-workspace 404s', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const fleetId = uuid();
    await fleets.putFleet(ctxA, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'F', displayOrder: 0, scoringSystem: 'scratch' as const,
    });
    const raceId = uuid();
    await races.putRace(ctxA, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-04-01', createdAt: Date.now(),
    });
    await raceStarts.bulkPutRaceStarts(ctxA, raceId, {
      starts: [
        { id: uuid(), raceId, fleetIds: [fleetId], startTime: '11:00:00' },
        { id: uuid(), raceId, fleetIds: [fleetId], startTime: '11:05:00' },
      ],
    });
    expect(await raceStarts.listRaceStarts(ctxA, raceId)).toHaveLength(2);

    await expect(
      raceStarts.bulkDeleteRaceStarts(ctxB, raceId),
    ).rejects.toBeInstanceOf(NotFoundError);

    await raceStarts.bulkDeleteRaceStarts(ctxA, raceId);
    expect(await raceStarts.listRaceStarts(ctxA, raceId)).toHaveLength(0);

    await removeSeries(ctxA, seriesId);
  });

  test('bulkDeleteFinishes drops every finish; cross-workspace 404s', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const fleetId = uuid();
    await fleets.putFleet(ctxA, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'F', displayOrder: 0, scoringSystem: 'scratch' as const,
    });
    const compIds = [uuid(), uuid()];
    for (const [i, id] of compIds.entries()) {
      await competitors.putCompetitor(ctxA, seriesId, id, {
        id, seriesId, fleetIds: [fleetId],
        sailNumber: String(600 + i), name: `Boat ${i}`,
        club: '', gender: '' as const, age: null, createdAt: Date.now(),
      });
    }
    const raceId = uuid();
    await races.putRace(ctxA, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-04-01', createdAt: Date.now(),
    });
    await finishes.bulkPutFinishes(ctxA, raceId, {
      finishes: compIds.map((id, i) => ({
        id: uuid(), raceId, competitorId: id,
        sortOrder: i + 1, resultCode: null, startPresent: null,
        penaltyCode: null, penaltyOverride: null,
        redressMethod: null, redressExcludeRaces: null,
        redressIncludeRaces: null,
        tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
      })),
    });
    expect(await finishes.listFinishes(ctxA, raceId)).toHaveLength(2);

    await expect(
      finishes.bulkDeleteFinishes(ctxB, raceId),
    ).rejects.toBeInstanceOf(NotFoundError);

    await finishes.bulkDeleteFinishes(ctxA, raceId);
    expect(await finishes.listFinishes(ctxA, raceId)).toHaveLength(0);

    await removeSeries(ctxA, seriesId);
  });
});
