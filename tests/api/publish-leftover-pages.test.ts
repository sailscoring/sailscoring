// @vitest-environment node

/**
 * The live pages a publish no longer rebuilds. A publish carries every live
 * page it doesn't build, so a page whose extra page was deleted, or whose
 * fleet was renamed, stays up unchanged; `listLeftoverPages` is how the
 * publish dialog finds them to offer taking them down.
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
import * as finishes from '@/lib/api-handlers/finishes';
import { listLeftoverPages, publishSeries, retractPage } from '@/lib/api-handlers/publish';
import { getPublishedBySeries } from '@/lib/published-repository';
import { createRepos } from '@/lib/postgres-repository';
import type { PublishingGroup } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — leftover pages', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  let whitesailsId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_lft_${uuid().replace(/-/g, '')}`;
    const workspaceSlug = `lft-${workspaceId.slice(8, 18)}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'Leftovers', slug: workspaceSlug, createdAt: new Date(),
    });
    ctx = {
      userId: 'lft-user', email: 'lft@sailscoring.test', workspaceId, workspaceSlug,
      role: 'owner', features: [],
    };

    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Leftover League', venue: 'HYC',
      startDate: '2026-07-01', endDate: '2026-07-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    const compIds: string[] = [];
    for (const [i, fleetName] of ['Cruisers', 'Whitesails'].entries()) {
      const fleetId = uuid();
      if (fleetName === 'Whitesails') whitesailsId = fleetId;
      await fleets.putFleet(ctx, seriesId, fleetId, {
        id: fleetId, seriesId, name: fleetName, displayOrder: i,
        scoringSystem: 'scratch' as const,
      });
      const compId = uuid();
      compIds.push(compId);
      await competitors.putCompetitor(ctx, seriesId, compId, {
        id: compId, seriesId, fleetIds: [fleetId], sailNumber: `${i + 1}`,
        names: [`Boat ${i + 1}`], clubs: ['HYC'], gender: '' as const, age: null,
        createdAt: Date.now(),
      });
    }
    // A race nobody has sailed is not published, so every boat finishes.
    const raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-07-04', createdAt: Date.now(),
    });
    for (const [i, compId] of compIds.entries()) {
      const finishId = uuid();
      await finishes.putFinish(ctx, raceId, finishId, {
        id: finishId, raceId, competitorId: compId, sortOrder: i + 1,
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

  async function setGroups(groups: PublishingGroup[]) {
    const repos = createRepos({ workspaceId });
    const current = (await repos.series.get(seriesId))!;
    await repos.series.save({ ...current, publishingGroups: groups });
  }

  test('a series never published has none', async () => {
    expect(await listLeftoverPages(ctx, seriesId)).toEqual([]);
  });

  test('a publication the series still builds in full has none', async () => {
    await publishSeries(ctx, seriesId, {});
    expect(await listLeftoverPages(ctx, seriesId)).toEqual([]);
  });

  test('a deleted extra page is left over until it is taken down', async () => {
    await setGroups([{
      id: uuid(), name: 'Overall', fleetMode: 'all', fleetIds: [], detail: 'standings',
    }]);
    await publishSeries(ctx, seriesId, {});
    expect(await listLeftoverPages(ctx, seriesId)).toEqual([]);

    await setGroups([]);
    // Publishing again the way the dialog does, naming the pages it ticks,
    // carries the page rather than dropping it…
    await publishSeries(ctx, seriesId, { fleets: ['Cruisers', 'Whitesails'] });
    const live = (await getPublishedBySeries(seriesId))!;
    expect(live.pages.map((p) => p.fleetName)).toContain('Overall');

    // …and it is reported as left over, with the URL it is served at.
    const leftovers = await listLeftoverPages(ctx, seriesId);
    expect(leftovers.map((p) => p.fleetName)).toEqual(['Overall']);
    expect(leftovers[0].url.endsWith('/overall')).toBe(true);

    await retractPage(ctx, seriesId, 'overall');
    expect(await listLeftoverPages(ctx, seriesId)).toEqual([]);
  });

  test("a renamed fleet's old page is left over; its new one is not", async () => {
    await fleets.putFleet(ctx, seriesId, whitesailsId, {
      id: whitesailsId, seriesId, name: 'White Sails', displayOrder: 1,
      scoringSystem: 'scratch' as const,
    });
    await publishSeries(ctx, seriesId, { fleets: ['Cruisers', 'White Sails'] });
    const leftovers = await listLeftoverPages(ctx, seriesId);
    expect(leftovers.map((p) => p.fleetName)).toEqual(['Whitesails']);
  });

  test('another workspace cannot ask', async () => {
    const other: WorkspaceContext = { ...ctx, workspaceId: 'org_somebody_else' };
    await expect(listLeftoverPages(other, seriesId)).rejects.toThrow(/not-found/);
  });
});
