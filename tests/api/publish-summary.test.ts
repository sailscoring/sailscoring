// @vitest-environment node

/**
 * The publish-time publication summary: publishing stores the counts and
 * race dates the public indexes show, from the published snapshot (sailed
 * races only), and the backfill rebuilds a missing one from the
 * publication's own data file.
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
import * as races from '@/lib/api-handlers/races';
import * as finishes from '@/lib/api-handlers/finishes';
import { publishSeries } from '@/lib/api-handlers/publish';
import { getPublishedBySeries } from '@/lib/published-repository';
import { runCli as backfill } from '@/scripts/backfill-publication-summaries';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — the publication summary', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  let raceId: string;

  async function addBoat(name: string, sail: string, sortOrder: number) {
    const compId = uuid();
    await competitors.putCompetitor(ctx, seriesId, compId, {
      id: compId, seriesId, fleetIds: [], sailNumber: sail,
      names: [name], clubs: ['HYC'], gender: '' as const, age: null,
      createdAt: Date.now(),
    });
    const finishId = uuid();
    await finishes.putFinish(ctx, raceId, finishId, {
      id: finishId, raceId, competitorId: compId, sortOrder,
      tiedWithPrevious: false, resultCode: null, startPresent: null,
      penaltyCode: null, penaltyOverride: null, redressMethod: null,
      redressExcludeRaceIds: null, redressIncludeRaceIds: null,
      redressIncludeAllLater: false, redressPoints: null,
    });
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_ps_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Summary',
      slug: `ps-${workspaceId.slice(7, 17)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'ps-user',
      email: 'ps@sailscoring.test',
      workspaceId,
      workspaceSlug: `ps-${workspaceId.slice(7, 17)}`,
      role: 'owner',
      features: [],
    };

    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Summer Series', venue: 'HYC',
      startDate: '2026-06-01', endDate: '2026-08-30',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-06-06', createdAt: Date.now(),
    });
    await addBoat('Aurelia', '1', 1);
    await addBoat('Bandit', '2', 2);
    // A second race with nothing on its sheet: unsailed, so not published.
    const unsailed = uuid();
    await races.putRace(ctx, seriesId, unsailed, {
      id: unsailed, seriesId, raceNumber: 2, date: '2026-06-13', createdAt: Date.now(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('publishing stores what the publication holds', async () => {
    await publishSeries(ctx, seriesId, {});
    const stored = (await getPublishedBySeries(seriesId))!;
    expect(stored.summary).toEqual({
      firstRaceDate: '2026-06-06',
      lastRaceDate: '2026-06-06',
      races: 1,
      boats: 2,
      // A series that never defined a fleet publishes one unnamed page and
      // has no fleets to list.
      fleets: [],
    });
  });

  test('the backfill restores a missing summary from the data file', async () => {
    const published = (await getPublishedBySeries(seriesId))!;
    await db
      .update(schema.publishedSeries)
      .set({ summary: null })
      .where(eq(schema.publishedSeries.id, published.id));
    // A report-only run writes nothing.
    await backfill(['--workspace', ctx.workspaceSlug]);
    expect((await getPublishedBySeries(seriesId))!.summary).toBeNull();

    await backfill(['--apply', '--workspace', ctx.workspaceSlug]);
    expect((await getPublishedBySeries(seriesId))!.summary).toEqual(published.summary);
  });
});
