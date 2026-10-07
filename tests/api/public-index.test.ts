// @vitest-environment node

/**
 * The public `index.json` (#669), through the real `/p/` route: what it
 * lists, how it is served (CORS, ETag revalidation), the season narrowing,
 * the HTML indexes' alternate links, and unpublishing dropping a series.
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
import { publishSeries, unpublishBySeries } from '@/lib/api-handlers/publish';
import { NextRequest } from 'next/server';
import { GET } from '@/app/p/[...slug]/route';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('the public index.json (#669)', () => {
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
    workspaceId = `org_pi_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Index',
      slug: `pi-${workspaceId.slice(7, 17)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'pi-user',
      email: 'pi@sailscoring.test',
      workspaceId,
      workspaceSlug: `pi-${workspaceId.slice(7, 17)}`,
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

  function get(path: string, headers: Record<string, string> = {}) {
    return GET(new NextRequest(`http://localhost:3000${path}`, { headers }), {
      params: Promise.resolve({ slug: path.split('/').slice(2) }),
    });
  }

  test('nothing published: the index is a 404, like the HTML listing', async () => {
    expect((await get(`/p/${ctx.workspaceSlug}/index.json`)).status).toBe(404);
  });

  test('lists the publication with its pages, data file and summary', async () => {
    await publishSeries(ctx, seriesId, {});
    const res = await get(`/p/${ctx.workspaceSlug}/index.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-expose-headers')).toBe('ETag');
    const base = `http://localhost:3000/p/${ctx.workspaceSlug}`;
    const doc = await res.json();
    expect(doc).toEqual({
      version: 1,
      workspace: { slug: ctx.workspaceSlug, name: 'Index', url: base },
      seasons: [
        { label: '2026', current: true, url: `${base}/2026`, index: `${base}/2026/index.json` },
      ],
      publications: [
        {
          name: 'Summer Series',
          season: '2026',
          folder: { slug: 'summer-series', label: 'Summer Series', url: `${base}/summer-series` },
          url: `${base}/summer-series`,
          pages: [{ label: 'Standings', kind: 'standings', url: `${base}/summer-series/standings` }],
          data: `${base}/summer-series/summer-series.sailscoring.json`,
          fleets: [],
          publishedAt: expect.stringMatching(/^2\d{3}-/),
          firstRaceDate: '2026-06-06',
          lastRaceDate: '2026-06-06',
          races: 1,
          boats: 2,
        },
      ],
    });

    // An unchanged index revalidates.
    const again = await get(`/p/${ctx.workspaceSlug}/index.json`, {
      'if-none-match': res.headers.get('etag')!,
    });
    expect(again.status).toBe(304);
    expect(again.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('the season index narrows to its season; an unknown season is a 404', async () => {
    const res = await get(`/p/${ctx.workspaceSlug}/2026/index.json`);
    expect(res.status).toBe(200);
    expect((await res.json()).publications).toHaveLength(1);
    expect((await get(`/p/${ctx.workspaceSlug}/1999/index.json`)).status).toBe(404);
    expect((await get(`/p/${ctx.workspaceSlug}/a/b/index.json`)).status).toBe(404);
  });

  test('the HTML indexes declare their JSON twin', async () => {
    const ws = await (await get(`/p/${ctx.workspaceSlug}`)).text();
    expect(ws).toContain(
      `<link rel="alternate" type="application/json" href="/p/${ctx.workspaceSlug}/index.json">`,
    );
    const season = await (await get(`/p/${ctx.workspaceSlug}/2026`)).text();
    expect(season).toContain(
      `<link rel="alternate" type="application/json" href="/p/${ctx.workspaceSlug}/2026/index.json">`,
    );
  });

  test('unpublishing drops the series from the index', async () => {
    await unpublishBySeries(ctx, seriesId);
    expect((await get(`/p/${ctx.workspaceSlug}/index.json`)).status).toBe(404);
  });
});
