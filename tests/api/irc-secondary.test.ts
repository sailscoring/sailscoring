// @vitest-environment node

/**
 * A boat's secondary IRC certificate and a race declared on it, through the
 * competitor and rating-override handlers.
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
import * as races from '@/lib/api-handlers/races';
import * as fleetsApi from '@/lib/api-handlers/fleets';
import * as competitorsApi from '@/lib/api-handlers/competitors';
import * as overrides from '@/lib/api-handlers/race-rating-overrides';

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

describe.skipIf(skip)('secondary IRC certificate', () => {
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



  test('the secondary certificate and a race declared on it are stored and read back', async () => {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, { ...sampleSeries(seriesId), scoringMode: 'handicap' as const });
    const fleetId = uuid();
    await fleetsApi.putFleet(ctxA, seriesId, fleetId, { id: fleetId, seriesId, name: 'IRC Class 1', displayOrder: 0, scoringSystem: 'irc' as const });
    const boat = uuid();
    await competitorsApi.putCompetitor(ctxA, seriesId, boat, {
      id: boat, seriesId, fleetIds: [fleetId], sailNumber: 'GBR7664T', boatName: 'Crackajack',
      names: ['Owner'], clubs: [], gender: '', age: null, createdAt: Date.now(),
      ircTcc: 1.013, ircSecondaryTcc: 1.014, ircSecondaryCert: { certNumber: '50719', tcc: 1.014, appliedAt: Date.now() },
    });
    const [stored] = await competitorsApi.listCompetitors(ctxA, seriesId);
    expect(stored).toMatchObject({ ircTcc: 1.013, ircSecondaryTcc: 1.014, ircSecondaryCert: { certNumber: '50719' } });

    const raceId = uuid();
    await races.putRace(ctxA, seriesId, raceId, { id: raceId, seriesId, raceNumber: 1, date: '2026-04-05', createdAt: Date.now() });
    await overrides.bulkPutRaceRatingOverrides(ctxA, raceId, {
      overrides: [{ raceId, competitorId: boat, field: 'ircTcc', value: 1.014, certificate: 'secondary' }],
    });
    const [o] = await overrides.listRaceRatingOverrides(ctxA, raceId);
    expect(o).toMatchObject({ value: 1.014, certificate: 'secondary' });

    // A typed number in its place drops the declaration.
    await overrides.bulkPutRaceRatingOverrides(ctxA, raceId, {
      overrides: [{ id: o.id, raceId, competitorId: boat, field: 'ircTcc', value: 1.02 }],
    });
    const [typed] = await overrides.listRaceRatingOverrides(ctxA, raceId);
    expect(typed.value).toBe(1.02);
    expect(typed.certificate).toBeUndefined();

    await expect(
      overrides.bulkPutRaceRatingOverrides(ctxA, raceId, {
        overrides: [{ raceId, competitorId: boat, field: 'pyNumber', value: 1000, certificate: 'secondary' }],
      }),
    ).rejects.toThrow();
  });
});
