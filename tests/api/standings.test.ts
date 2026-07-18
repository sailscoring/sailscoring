// @vitest-environment node

/**
 * ADR-009 M4 — getSeriesStandings (GET /api/v1/series/:id/standings) returns
 * the public-export JSON with computed per-fleet standings. Skipped when
 * DATABASE_URL is unset.
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
import * as finishes from '@/lib/api-handlers/finishes';
import { getSeriesStandings } from '@/lib/api-handlers/standings';
import { NotFoundError } from '@/app/api/v1/_lib/handler';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('series standings (ADR-009 M4)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_std_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'Std', slug: `std-${workspaceId.slice(8, 18)}`, createdAt: new Date(),
    });
    ctx = {
      userId: 'std-user', email: 'std@sailscoring.test', workspaceId,
      workspaceSlug: `std-${workspaceId.slice(8, 18)}`, role: 'owner', features: [],
    };
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('returns the public export with standings for the seeded boats', async () => {
    const srcId = uuid();
    await series.putSeries(ctx, srcId, {
      id: srcId, name: 'Standings Series', venue: 'HYC', startDate: '2026-09-01', endDate: '2026-09-30',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'startingArea' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
      publishRatingCalculations: true, enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    const fleetId = uuid();
    await fleets.putFleet(ctx, srcId, fleetId, {
      id: fleetId, seriesId: srcId, name: 'IRC', displayOrder: 0, scoringSystem: 'scratch' as const,
    });
    const compIds: string[] = [];
    for (const sailNo of ['111', '222']) {
      const compId = uuid();
      compIds.push(compId);
      await competitors.putCompetitor(ctx, srcId, compId, {
        id: compId, seriesId: srcId, fleetIds: [fleetId], sailNumber: sailNo,
        names: [`Helm ${sailNo}`], club: 'HYC', gender: '' as const, age: null, createdAt: Date.now(),
      });
    }
    const raceId = uuid();
    await races.putRace(ctx, srcId, raceId, {
      id: raceId, seriesId: srcId, raceNumber: 1, date: '2026-09-05', createdAt: Date.now(),
    });
    await finishes.bulkPutFinishes(ctx, raceId, {
      finishes: compIds.map((competitorId, i) => ({
        id: uuid(), raceId, competitorId, sortOrder: i + 1,
        finishTime: `12:0${i}:00`, resultCode: null, startPresent: null,
        penaltyCode: null, penaltyOverride: null, redressMethod: null,
        redressExcludeRaceIds: null, redressIncludeRaceIds: null,
        tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
      })),
    });

    const result = await getSeriesStandings(ctx, srcId);
    expect(result.series.name).toBe('Standings Series');
    const blob = JSON.stringify(result);
    expect(blob).toContain('111');
    expect(blob).toContain('222');
  });

  test('a missing series is a NotFoundError (404)', async () => {
    await expect(getSeriesStandings(ctx, uuid())).rejects.toBeInstanceOf(NotFoundError);
  });
});
