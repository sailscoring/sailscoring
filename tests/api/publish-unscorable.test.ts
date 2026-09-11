// @vitest-environment node

/**
 * Publishing refuses a page whose fleet holds a race it cannot score (#554).
 * An ORC fleet scored on time-on-distance needs the start's course length;
 * without it nobody in the race is scored, and a page of blanks under the
 * fleet's rating system is not something to discover after it is public.
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
import * as competitors from '@/lib/api-handlers/competitors';
import * as fleets from '@/lib/api-handlers/fleets';
import * as races from '@/lib/api-handlers/races';
import * as raceStarts from '@/lib/api-handlers/race-starts';
import * as finishes from '@/lib/api-handlers/finishes';
import { publishSeries } from '@/lib/api-handlers/publish';
import { createRepos } from '@/lib/postgres-repository';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — a race the fleet cannot score (#554)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  let raceId: string;
  let startId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_un_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Unscorable',
      slug: `un-${workspaceId.slice(7, 17)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'un-user',
      email: 'un@sailscoring.test',
      workspaceId,
      workspaceSlug: `un-${workspaceId.slice(7, 17)}`,
      role: 'owner',
      features: [],
    };

    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Autumn League ORC', venue: 'HYC',
      startDate: '2026-09-12', endDate: '2026-10-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'handicap' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });

    const fleetId = uuid();
    await fleets.putFleet(ctx, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'Class 1 ORC', displayOrder: 0,
      scoringSystem: 'orc' as const, orcProfile: { option: 'APHD', kind: 'tod' },
    });

    raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-09-12', createdAt: Date.now(),
    });
    // A gun and a fleet, but no course length for the option to correct over.
    startId = uuid();
    await raceStarts.putRaceStart(ctx, raceId, startId, {
      id: startId, raceId, fleetIds: [fleetId], startTime: '14:00:00',
    });

    let sort = 0;
    for (const [name, aphd] of [['Impetuous', 623.0], ['Mojo', 594.7]] as const) {
      const compId = uuid();
      await competitors.putCompetitor(ctx, seriesId, compId, {
        id: compId, seriesId, fleetIds: [fleetId], sailNumber: `${sort + 1}`,
        names: [name], clubs: ['HYC'], gender: '' as const, age: null,
        createdAt: Date.now(),
        orcCert: { record: { APHD: aphd, APHT: 1 }, importedAt: Date.now() },
      });
      sort += 1;
      const finishId = uuid();
      await finishes.putFinish(ctx, raceId, finishId, {
        id: finishId, raceId, competitorId: compId, sortOrder: sort,
        finishTime: `15:0${sort}:00`,
        tiedWithPrevious: false, resultCode: null, startPresent: null,
        penaltyCode: null, penaltyOverride: null, redressMethod: null,
        redressExcludeRaceIds: null, redressIncludeRaceIds: null,
        redressIncludeAllLater: false, redressPoints: null,
      });
    }
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('refuses the publish and names the race and the fleet', async () => {
    await expect(publishSeries(ctx, seriesId, {})).rejects.toMatchObject({
      issues: {
        code: 'unscorable-race',
        races: [{ fleetName: 'Class 1 ORC', raceNumber: 1, option: 'APHD' }],
      },
    });
  });

  test('publishes once the start carries the course length', async () => {
    const repos = createRepos({ workspaceId });
    const current = (await repos.raceStarts.listByRace(raceId))[0];
    await repos.raceStarts.save({ ...current, distanceNm: 3.24 });

    const result = await publishSeries(ctx, seriesId, {});
    expect(result.pages).toHaveLength(1);
  });
});
