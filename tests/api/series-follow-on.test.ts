// @vitest-environment node

/**
 * Integration tests for `createFollowOnSeries` — rolling a finished series
 * into the next one of the season: structure copied, races left behind,
 * progressive starting handicaps seeded from the source's end-of-series
 * TCFs, lineage recorded.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as categories from '@/lib/api-handlers/categories';
import * as fleets from '@/lib/api-handlers/fleets';
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import * as raceStarts from '@/lib/api-handlers/race-starts';
import * as finishes from '@/lib/api-handlers/finishes';
import { listTcfHistory } from '@/lib/api-handlers/tcf-history';
import { endOfSeriesTcfKey, endOfSeriesTcfs } from '@/lib/source-handicaps';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

async function removeSeries(ctx: WorkspaceContext, id: string) {
  await series.setSeriesArchived(ctx, id, { archived: true });
  await series.deleteSeries(ctx, id);
}

function sampleSeries(id: string) {
  return {
    id,
    name: 'Spring Series 1',
    venue: 'HYC',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    venueLogoUrl: 'https://example.test/venue.png',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: Date.now(),
    lastSavedAt: null,
    lastModifiedAt: Date.now(),
    scoringMode: 'handicap' as const,
    discardThresholds: [{ minRaces: 4, discardCount: 1 }],
    dnfScoring: 'startingArea' as const,
    ftpHost: 'ftp.example.test',
    ftpPath: '/results/spring.html',
    ftpPaths: {},
    includeJsonExport: true,
    publishRatingCalculations: true,
    enabledCompetitorFields: ['boatName', 'club'],
    primaryPersonLabel: 'helm' as const,
    subdivisionLabel: 'Division',
  };
}

describe.skipIf(skip)('createFollowOnSeries', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_fo_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'FollowOn',
      slug: `fo-${workspaceId.slice(7, 17)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'test-user',
      email: 'test@sailscoring.test',
      workspaceId,
      workspaceSlug: 'fo-ws',
      role: 'owner',
      features: [],
    };
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('rolls a scored NHC series into a follow-on with seeded handicaps', async () => {
    // ── Source: an NHC fleet with three boats that race and one that never does
    const srcId = uuid();
    await series.putSeries(ctx, srcId, sampleSeries(srcId));

    const fleetId = uuid();
    await fleets.putFleet(ctx, srcId, fleetId, {
      id: fleetId, seriesId: srcId, name: 'HPH', displayOrder: 0,
      scoringSystem: 'nhc' as const,
    });
    await series.putSeries(ctx, srcId, {
      ...sampleSeries(srcId),
      defaultStartSequence: [{ fleetIds: [fleetId], intervalMinutes: 0 }],
    });
    const category = await categories.createCategory(ctx, { name: `Season ${srcId.slice(0, 8)}` });
    await series.setSeriesCategory(ctx, srcId, { categoryId: category.id });

    const boats = [
      { sail: '101', tcf: 1.0, finish: '12:00:00' },
      { sail: '202', tcf: 0.95, finish: '12:10:00' },
      { sail: '303', tcf: 0.9, finish: '12:30:00' },
      { sail: '404', tcf: 0.925, finish: null }, // entered, never raced
    ];
    const compIdBySail = new Map<string, string>();
    for (const b of boats) {
      const compId = uuid();
      compIdBySail.set(b.sail, compId);
      await competitors.putCompetitor(ctx, srcId, compId, {
        id: compId, seriesId: srcId, fleetIds: [fleetId],
        sailNumber: b.sail, name: `Helm ${b.sail}`, club: 'HYC',
        gender: '' as const, age: null, createdAt: Date.now(),
        nhcStartingTcf: b.tcf, vprsTcc: 0.992,
      });
    }

    const raceId = uuid();
    await races.putRace(ctx, srcId, raceId, {
      id: raceId, seriesId: srcId, raceNumber: 1, date: '2026-04-04', createdAt: Date.now(),
    });
    const startId = uuid();
    await raceStarts.putRaceStart(ctx, raceId, startId, {
      id: startId, raceId, fleetIds: [fleetId], startTime: '11:00:00',
    });
    await finishes.bulkPutFinishes(ctx, raceId, {
      finishes: boats
        .filter((b) => b.finish !== null)
        .map((b, i) => ({
          id: uuid(), raceId, competitorId: compIdBySail.get(b.sail)!,
          sortOrder: i + 1, finishTime: b.finish!, resultCode: null,
          startPresent: null, penaltyCode: null, penaltyOverride: null,
          redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
          tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
        })),
    });

    // The engine's own view of the end-of-series TCFs — what seeding must match.
    const history = await listTcfHistory(ctx, srcId);
    const srcCompetitors = await competitors.listCompetitors(ctx, srcId);
    const srcFleets = await fleets.listFleets(ctx, srcId);
    const srcRaces = await races.listRaces(ctx, srcId);
    const endTcfs = endOfSeriesTcfs(srcCompetitors, srcFleets, srcRaces, history);
    const endTcfBySail = new Map(
      srcCompetitors.map((c) => [
        c.sailNumber,
        endTcfs.get(endOfSeriesTcfKey(c.id, fleetId))?.endTcf,
      ]),
    );
    // Sanity: the racing moved at least one rating, so the assertions below
    // can't pass vacuously with seeds equal to starting TCFs.
    expect(boats.some((b) => endTcfBySail.get(b.sail) !== b.tcf)).toBe(true);

    // ── Roll over (from an archived source — the natural order of operations)
    await series.setSeriesArchived(ctx, srcId, { archived: true });
    const { id: newId, seededCount } = await series.createFollowOnSeries(ctx, srcId, {
      startDate: '2026-06-01',
    });
    expect(seededCount).toBe(4);

    const created = await series.getSeries(ctx, newId);
    expect(created).toMatchObject({
      name: 'Spring Series 2',
      venue: 'HYC',
      startDate: '2026-06-01',
      endDate: '',
      scoringMode: 'handicap',
      discardThresholds: [{ minRaces: 4, discardCount: 1 }],
      dnfScoring: 'startingArea',
      ftpHost: '',
      ftpPath: '',
      categoryId: category.id,
      archived: false,
      previousSeriesId: srcId,
    });
    expect(created.lastSavedAt).toBeNull();
    expect(created.source).toBeUndefined();

    const newFleets = await fleets.listFleets(ctx, newId);
    expect(newFleets).toHaveLength(1);
    expect(newFleets[0].id).not.toBe(fleetId);
    expect(newFleets[0]).toMatchObject({ name: 'HPH', scoringSystem: 'nhc' });
    expect(created.defaultStartSequence).toEqual([
      { fleetIds: [newFleets[0].id], intervalMinutes: 0 },
    ]);

    // No races, starts, or finishes came along.
    expect(await races.listRaces(ctx, newId)).toHaveLength(0);

    const newCompetitors = await competitors.listCompetitors(ctx, newId);
    expect(newCompetitors).toHaveLength(4);
    for (const c of newCompetitors) {
      expect(c.fleetIds).toEqual([newFleets[0].id]);
      expect(c.vprsTcc).toBe(0.992);
      // Every boat's starting TCF is the engine's end-of-series TCF for it
      // (the unraced boat's end-of-series TCF is its unchanged starting one).
      expect(c.nhcStartingTcf).toBe(endTcfBySail.get(c.sailNumber));
    }
    const unraced = newCompetitors.find((c) => c.sailNumber === '404')!;
    expect(unraced.nhcStartingTcf).toBe(0.925);

    // Lineage action recorded against the new series.
    const activity = await db
      .select()
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.workspaceId, workspaceId),
          eq(schema.activityLog.action, 'series.created-follow-on'),
        ),
      );
    expect(activity).toHaveLength(1);
    expect(activity[0].seriesId).toBe(newId);
    expect(activity[0].summary).toContain('Spring Series 2');

    await removeSeries(ctx, newId);
    await removeSeries(ctx, srcId);
  });

  test('a source with no scored races seeds nothing and keeps starting TCFs', async () => {
    const srcId = uuid();
    await series.putSeries(ctx, srcId, { ...sampleSeries(srcId), name: 'Frostbites' });
    const fleetId = uuid();
    await fleets.putFleet(ctx, srcId, fleetId, {
      id: fleetId, seriesId: srcId, name: 'PY', displayOrder: 0,
      scoringSystem: 'nhc' as const,
    });
    const compId = uuid();
    await competitors.putCompetitor(ctx, srcId, compId, {
      id: compId, seriesId: srcId, fleetIds: [fleetId],
      sailNumber: '7', name: 'Helm', club: 'HYC',
      gender: '' as const, age: null, createdAt: Date.now(),
      nhcStartingTcf: 0.88,
    });

    const { id: newId, seededCount } = await series.createFollowOnSeries(ctx, srcId, {
      name: '  Frostbites — Spring Leg  ',
    });
    expect(seededCount).toBe(0);

    const created = await series.getSeries(ctx, newId);
    expect(created.name).toBe('Frostbites — Spring Leg');
    expect(created.startDate).toBe('');

    const newCompetitors = await competitors.listCompetitors(ctx, newId);
    expect(newCompetitors).toHaveLength(1);
    expect(newCompetitors[0].nhcStartingTcf).toBe(0.88);

    await removeSeries(ctx, newId);
    await removeSeries(ctx, srcId);
  });
});
