// @vitest-environment node

/**
 * A race's fleet changes through the race handler: stored and read back,
 * refused when malformed, and named in the activity log.
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
import * as fleetsApi from '@/lib/api-handlers/fleets';
import * as competitorsApi from '@/lib/api-handlers/competitors';
import { getActivityFeed } from '@/lib/api-handlers/activity';
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
    subdivisionAxes: [],
  };
}

describe.skipIf(skip)('race fleet changes', () => {
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


  async function setUp() {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    const overall = uuid();
    const twoHanded = uuid();
    await fleetsApi.putFleet(ctxA, seriesId, overall, { id: overall, seriesId, name: 'Overall', displayOrder: 0, scoringSystem: 'scratch' as const });
    await fleetsApi.putFleet(ctxA, seriesId, twoHanded, { id: twoHanded, seriesId, name: 'Two-Handed', displayOrder: 1, scoringSystem: 'scratch' as const });
    const boat = uuid();
    await competitorsApi.putCompetitor(ctxA, seriesId, boat, {
      id: boat, seriesId, fleetIds: [overall, twoHanded], sailNumber: '53308', boatName: 'Loinnir',
      names: ['John Malone'], clubs: [], gender: '', age: null, createdAt: Date.now(),
    });
    const raceId = uuid();
    const race = await races.putRace(ctxA, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 7, date: '2026-05-23', createdAt: Date.now(),
    });
    return { seriesId, overall, twoHanded, boat, race };
  }

  test('a fleet change is stored on the race and read back', async () => {
    const { seriesId, twoHanded, boat, race } = await setUp();
    await races.putRace(ctxA, seriesId, race.id, { ...race, fleetChanges: [{ competitorId: boat, drop: [twoHanded] }] });
    const [reloaded] = await races.listRaces(ctxA, seriesId);
    expect(reloaded.fleetChanges).toEqual([{ competitorId: boat, drop: [twoHanded] }]);

    const cleared = await races.putRace(ctxA, seriesId, race.id, { ...reloaded, fleetChanges: undefined });
    expect(cleared.fleetChanges).toBeUndefined();
    expect((await races.listRaces(ctxA, seriesId))[0].fleetChanges).toBeUndefined();
  });

  test('a change that changes nothing, or adds and drops one fleet, is refused', async () => {
    const { seriesId, twoHanded, boat, race } = await setUp();
    await expect(
      races.putRace(ctxA, seriesId, race.id, { ...race, fleetChanges: [{ competitorId: boat }] }),
    ).rejects.toThrow();
    await expect(
      races.putRace(ctxA, seriesId, race.id, {
        ...race, fleetChanges: [{ competitorId: boat, add: [twoHanded], drop: [twoHanded] }],
      }),
    ).rejects.toThrow();
  });

  test('the activity log names the boat, the fleet and the race', async () => {
    const { seriesId, twoHanded, boat, race } = await setUp();
    const saved = await races.putRace(ctxA, seriesId, race.id, { ...race, fleetChanges: [{ competitorId: boat, drop: [twoHanded] }] });
    const params = new URLSearchParams();
    params.set('seriesId', seriesId);
    const { items } = await getActivityFeed(ctxA, params);
    expect(items.some((i) => i.summary === 'Loinnir: not in Two-Handed for Race 7')).toBe(true);

    await races.putRace(ctxA, seriesId, race.id, { ...saved, fleetChanges: undefined });
    const after = await getActivityFeed(ctxA, params);
    expect(after.items.some((i) => i.summary === 'Loinnir: back in Two-Handed for Race 7')).toBe(true);
  });

  test('another workspace cannot see the race', async () => {
    const { seriesId } = await setUp();
    await expect(races.listRaces(ctxB, seriesId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
