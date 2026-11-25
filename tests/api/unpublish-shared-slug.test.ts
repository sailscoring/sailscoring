// @vitest-environment node

/**
 * Unpublishing one series takes down only what that series published, even
 * when it shares its slug — every series in a season does — or its event
 * folder with others. The other publications' pages, data files and API
 * resources stay, and the folder and season indexes, rendered live from the
 * remaining publications, keep listing them.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { NextRequest } from 'next/server';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as fleets from '@/lib/api-handlers/fleets';
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import * as finishes from '@/lib/api-handlers/finishes';
import { publishSeries, unpublishById } from '@/lib/api-handlers/publish';
import { getPublishedBySeries } from '@/lib/published-repository';
import { readPublishedObject } from '@/lib/blob-storage';
import { publishedResourceKey } from '@/lib/public-api/store';
import type { PublishedSeries } from '@/lib/types';
import { GET } from '@/app/p/[[...slug]]/route';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('unpublishing one series under a shared slug', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  // A and B share an event folder; C is in the same season, its own folder.
  let a: PublishedSeries;
  let b: PublishedSeries;
  let c: PublishedSeries;

  /** A series with one race and `fleetNames.length` boats, one per fleet — so
   *  it publishes one page per fleet. No fleets at all publishes one page. */
  async function makeSeries(name: string, fleetNames: string[]): Promise<string> {
    const id = uuid();
    await series.putSeries(ctx, id, {
      id, name, venue: 'HYC',
      startDate: '2026-07-01', endDate: '2026-07-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
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

    // A race nobody has sailed is not published (#513), so every boat finishes.
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

  function get(path: string) {
    return GET(new NextRequest(`http://localhost:3000${path}`), {
      params: Promise.resolve({ slug: path.split('/').slice(2) }),
    });
  }

  /** Every public path a publication owns: its pages and its data file. */
  function pathsOf(p: PublishedSeries): string[] {
    const base = `/p/${ctx.workspaceSlug}/${p.slug}`;
    return [
      ...p.pages.map((pg) => `${base}/${pg.subPath}`),
      ...(p.dataSubPath ? [`${base}/${p.dataSubPath}`] : []),
    ];
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_ush_${uuid().replace(/-/g, '')}`;
    const slug = `ush-${workspaceId.slice(8, 18)}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'Unpublish shared', slug, createdAt: new Date(),
    });
    ctx = {
      userId: 'ush-user',
      email: 'ush@sailscoring.test',
      workspaceId,
      workspaceSlug: slug,
      role: 'owner',
      features: [],
    };

    const aId = await makeSeries('Lambay One Designs', ['Squibs', 'Etchells']);
    const bId = await makeSeries('Lambay Cruisers', ['Cruisers 1', 'Cruisers 2']);
    const cId = await makeSeries('Frostbite', ['Dinghies', 'Lasers']);
    await publishSeries(ctx, aId, { slug: '2026', season: '2026', folder: 'lambay-races' });
    await publishSeries(ctx, bId, { slug: '2026', season: '2026', folder: 'lambay-races' });
    await publishSeries(ctx, cId, { slug: '2026', season: '2026', folder: 'frostbite' });
    a = (await getPublishedBySeries(aId))!;
    b = (await getPublishedBySeries(bId))!;
    c = (await getPublishedBySeries(cId))!;
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('before: all three publications serve under the one season slug', async () => {
    expect([a.slug, b.slug, c.slug]).toEqual(['2026', '2026', '2026']);
    for (const p of [a, b, c]) {
      expect(p.dataSubPath, p.id).not.toBeNull();
      for (const path of pathsOf(p)) expect((await get(path)).status, path).toBe(200);
    }
  });

  test('after: only the unpublished series is gone', async () => {
    await unpublishById(ctx, a.id);

    for (const path of pathsOf(a)) expect((await get(path)).status, path).toBe(404);
    expect(await readPublishedObject(publishedResourceKey(a.id, ''))).toBeNull();

    // B and C are untouched: same rows, every page and data file still
    // serving, and their published API resources still stored.
    expect(await getPublishedBySeries(b.seriesId!)).toEqual(b);
    expect(await getPublishedBySeries(c.seriesId!)).toEqual(c);
    for (const p of [b, c]) {
      for (const path of pathsOf(p)) expect((await get(path)).status, path).toBe(200);
      expect(await readPublishedObject(publishedResourceKey(p.id, '')), p.id).not.toBeNull();
    }

    // The shared folder's index still links B's pages and none of A's.
    const pageLinks = (p: PublishedSeries) =>
      p.pages.map((pg) => `href="/p/${ctx.workspaceSlug}/${p.slug}/${pg.subPath}"`);
    const season = `/p/${ctx.workspaceSlug}/2026`;
    const folder = await get(`${season}/lambay-races`);
    expect(folder.status).toBe(200);
    const folderHtml = await folder.text();
    for (const link of pageLinks(b)) expect(folderHtml).toContain(link);
    for (const link of pageLinks(a)) expect(folderHtml).not.toContain(link);

    // The season index still offers both events: the shared folder (now
    // just B) and C's.
    const index = await get(season);
    expect(index.status).toBe(200);
    const indexHtml = await index.text();
    expect(indexHtml).toContain(`href="${season}/lambay-races`);
    expect(indexHtml).toContain(`href="${season}/frostbite`);
    for (const link of pageLinks(a)) expect(indexHtml).not.toContain(link);
  });
});
