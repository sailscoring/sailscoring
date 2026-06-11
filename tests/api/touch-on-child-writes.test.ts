// @vitest-environment node

/**
 * Every scoring-data mutation must mark the series modified server-side —
 * `lastModifiedAt` (and `version`) bump with no client cooperation, because
 * the unsaved-changes tracking on the home page compares `lastModifiedAt`
 * against `lastSavedAt`. The client-side `touchSeries` round-trip is gone;
 * these tests pin the server-side replacement for each child-entity handler,
 * including the handicaps bulk PATCH that historically missed the touch.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as fleets from '@/lib/api-handlers/fleets';
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import * as raceStarts from '@/lib/api-handlers/race-starts';
import * as raceRatingOverrides from '@/lib/api-handlers/race-rating-overrides';
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

function sampleFinish(raceId: string, competitorId: string, sortOrder: number) {
  return {
    id: uuid(), raceId, competitorId, sortOrder,
    resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null,
    redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null,
    tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
  };
}

describe.skipIf(skip)('child-entity writes mark the series modified', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_t_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Touch',
      slug: `t-${workspaceId.slice(6, 16)}`,
      createdAt: new Date(),
    });
    ctx = ctxFor(workspaceId);
    seriesId = uuid();
    await series.putSeries(ctx, seriesId, sampleSeries(seriesId));
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  /** Rewind `lastModifiedAt` to a fixed past instant (the series PUT
   *  round-trips the client value), so the child write under test must move
   *  it forward to pass — robust against clock skew and same-ms writes. */
  async function rewindModified(): Promise<number> {
    const past = Date.now() - 10 * 60 * 1000;
    const current = await series.getSeries(ctx, seriesId);
    await series.putSeries(ctx, seriesId, { ...current, lastModifiedAt: past });
    return past;
  }

  async function modifiedAt(): Promise<number> {
    return (await series.getSeries(ctx, seriesId)).lastModifiedAt;
  }

  test('competitor put / delete', async () => {
    let past = await rewindModified();
    const compId = uuid();
    await competitors.putCompetitor(ctx, seriesId, compId, {
      id: compId, seriesId, fleetIds: [],
      sailNumber: 'T1', name: 'Helm', club: '', gender: '' as const, age: null,
      createdAt: Date.now(), ircTcc: 1.0,
    });
    expect(await modifiedAt()).toBeGreaterThan(past);

    past = await rewindModified();
    await competitors.deleteCompetitor(ctx, seriesId, compId);
    expect(await modifiedAt()).toBeGreaterThan(past);
  });

  test('competitors bulk put and bulk handicaps PATCH', async () => {
    let past = await rewindModified();
    const compId = uuid();
    await competitors.bulkPutCompetitors(ctx, seriesId, {
      competitors: [{
        id: compId, seriesId, fleetIds: [],
        sailNumber: 'T2', name: 'Bulk', club: '', gender: '' as const, age: null,
        createdAt: Date.now(), ircTcc: 1.01,
      }],
    });
    expect(await modifiedAt()).toBeGreaterThan(past);

    // The handicaps PATCH is the call site that historically never touched.
    past = await rewindModified();
    const created = await competitors.getCompetitor(ctx, seriesId, compId);
    await competitors.bulkUpdateHandicaps(ctx, seriesId, {
      updates: [{ competitorId: compId, expectedVersion: created.version, ircTcc: 1.005 }],
    });
    expect(await modifiedAt()).toBeGreaterThan(past);
  });

  test('fleet put and ensure', async () => {
    let past = await rewindModified();
    const fleetId = uuid();
    await fleets.putFleet(ctx, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'IRC', displayOrder: 0, scoringSystem: 'irc' as const,
    });
    expect(await modifiedAt()).toBeGreaterThan(past);

    past = await rewindModified();
    await fleets.ensureFleet(ctx, seriesId, { name: 'Ensured' });
    expect(await modifiedAt()).toBeGreaterThan(past);
  });

  test('race put, race starts, finishes, rating overrides', async () => {
    let past = await rewindModified();
    const raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-04-04', createdAt: Date.now(),
    });
    expect(await modifiedAt()).toBeGreaterThan(past);

    const fleetList = await fleets.listFleets(ctx, seriesId);
    past = await rewindModified();
    await raceStarts.bulkPutRaceStarts(ctx, raceId, {
      starts: [{ id: uuid(), raceId, fleetIds: [fleetList[0].id], startTime: '11:00:00' }],
    });
    expect(await modifiedAt()).toBeGreaterThan(past);

    const compId = uuid();
    await competitors.putCompetitor(ctx, seriesId, compId, {
      id: compId, seriesId, fleetIds: [fleetList[0].id],
      sailNumber: 'T3', name: 'Racer', club: '', gender: '' as const, age: null,
      createdAt: Date.now(), ircTcc: 0.99,
    });

    past = await rewindModified();
    await finishes.bulkPutFinishes(ctx, raceId, {
      finishes: [sampleFinish(raceId, compId, 1)],
    });
    expect(await modifiedAt()).toBeGreaterThan(past);

    past = await rewindModified();
    await raceRatingOverrides.bulkPutRaceRatingOverrides(ctx, raceId, {
      overrides: [{ id: uuid(), raceId, competitorId: compId, field: 'ircTcc' as const, value: 0.985 }],
    });
    expect(await modifiedAt()).toBeGreaterThan(past);

    past = await rewindModified();
    await races.deleteRace(ctx, seriesId, raceId);
    expect(await modifiedAt()).toBeGreaterThan(past);
  });
});
