// @vitest-environment node

/**
 * Publishing is recorded (#576). Putting results on a public page, taking them
 * down, and retracting one page of a publication are all publishing acts, and
 * each leaves an entry in the workspace activity feed naming where the results
 * went. A re-publish that changes nothing, and an operator rebuild pass, are
 * deliberately silent — neither is an act of the scorer it would be
 * attributed to.
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
import {
  publishSeries,
  retractPage,
  unpublishBySeries,
} from '@/lib/api-handlers/publish';
import { listActivity } from '@/lib/activity-log';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — activity', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let workspaceSlug: string;
  let ctx: WorkspaceContext;

  /** A series with one race and one boat per fleet — one published page each.
   *  No fleets publishes a single page. */
  async function makeSeries(name: string, fleetNames: string[]): Promise<string> {
    const id = uuid();
    await series.putSeries(ctx, id, {
      id, name, venue: 'HYC',
      startDate: '2026-07-01', endDate: '2026-07-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });

    const fleetIds: string[] = [];
    for (const [i, fleetName] of fleetNames.entries()) {
      const fleetId = uuid();
      fleetIds.push(fleetId);
      await fleets.putFleet(ctx, id, fleetId, {
        id: fleetId, seriesId: id, name: fleetName, displayOrder: i,
        scoringSystem: 'scratch' as const,
      });
    }

    const compIds: string[] = [];
    for (const [i, fleetId] of (fleetIds.length > 0 ? fleetIds : [null]).entries()) {
      const compId = uuid();
      compIds.push(compId);
      await competitors.putCompetitor(ctx, id, compId, {
        id: compId, seriesId: id, fleetIds: fleetId ? [fleetId] : [],
        sailNumber: `${i + 1}`, names: [`Boat ${i + 1}`], clubs: ['HYC'],
        gender: '' as const, age: null, createdAt: Date.now(),
      });
    }

    const raceId = uuid();
    await races.putRace(ctx, id, raceId, {
      id: raceId, seriesId: id, raceNumber: 1, date: '2026-07-04', createdAt: Date.now(),
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
    return id;
  }

  /** The publishing entries for a series, newest first. */
  async function publishEntries(seriesId: string) {
    const { items } = await listActivity({
      workspaceId,
      seriesId,
      page: { limit: 50, cursor: null },
    });
    return items.filter((i) => i.action.startsWith('publish.'));
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_pua_${uuid().replace(/-/g, '')}`;
    workspaceSlug = `pua-${workspaceId.slice(8, 18)}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Publish Activity',
      slug: workspaceSlug,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'pua-user',
      email: 'pua@sailscoring.test',
      workspaceId,
      workspaceSlug,
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

  test('records the publish, naming the page it went to', async () => {
    const seriesId = await makeSeries('Activity League', []);
    await publishSeries(ctx, seriesId, { slug: 'activity-league' });

    const entries = await publishEntries(seriesId);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('publish.published');
    expect(entries[0].summary).toBe(`Published to /p/${workspaceSlug}/activity-league`);
  });

  test('a re-publish that changes nothing records nothing', async () => {
    const seriesId = await makeSeries('Unchanged Series', []);
    await publishSeries(ctx, seriesId, { slug: 'unchanged-series' });
    await publishSeries(ctx, seriesId, {});

    // The handler short-circuits on an unchanged content hash, before the
    // milestone — so the feed doesn't fill with publishes that published
    // nothing.
    expect(await publishEntries(seriesId)).toHaveLength(1);
  });

  test('an operator rebuild pass records nothing', async () => {
    const seriesId = await makeSeries('Rebuilt Series', []);
    await publishSeries(ctx, seriesId, { slug: 'rebuilt-series' });
    await publishSeries(ctx, seriesId, {}, { rebuildOnly: true });

    // Re-rendering what is already public is not the scorer's act, which is
    // why it pins no revision either.
    expect(await publishEntries(seriesId)).toHaveLength(1);
  });

  test('records taking the publication down', async () => {
    const seriesId = await makeSeries('Withdrawn Series', []);
    await publishSeries(ctx, seriesId, { slug: 'withdrawn-series' });
    await unpublishBySeries(ctx, seriesId);

    const entries = await publishEntries(seriesId);
    expect(entries.map((e) => e.action)).toEqual(['publish.unpublished', 'publish.published']);
    expect(entries[0].summary).toBe(`Unpublished /p/${workspaceSlug}/withdrawn-series`);
  });

  test('records retracting one page, naming that page', async () => {
    const seriesId = await makeSeries('Retracted Series', ['Cruisers', 'Whitesails']);
    await publishSeries(ctx, seriesId, { slug: 'retracted-series' });
    await retractPage(ctx, seriesId, 'cruisers');

    const entries = await publishEntries(seriesId);
    expect(entries[0].action).toBe('publish.page-retracted');
    expect(entries[0].summary).toBe(
      `Retracted /p/${workspaceSlug}/retracted-series/cruisers`,
    );
  });
});
