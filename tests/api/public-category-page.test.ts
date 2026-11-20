// @vitest-environment node

/**
 * A category's public page, `/p/{ws}/-/{slug}`, through the real `/p/` route:
 * 404 until something in the category is published, every season's events
 * once it is, a former slug redirecting after a rename, and the links to the
 * page from the workspace index, the event pages and `index.json`.
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
import * as categories from '@/lib/api-handlers/categories';
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import * as finishes from '@/lib/api-handlers/finishes';
import { publishSeries } from '@/lib/api-handlers/publish';
import { GET } from '@/app/p/[[...slug]]/route';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('category pages at /p/{ws}/-/{slug}', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let ws: string;
  let categoryId: string;
  const ids: Record<string, string> = {};

  /** A scratch series with one sailed race, so it can be published. */
  async function makeSeries(name: string, startDate: string): Promise<string> {
    const seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name, venue: 'RCYC',
      startDate, endDate: startDate,
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    const raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: startDate, createdAt: Date.now(),
    });
    const compId = uuid();
    await competitors.putCompetitor(ctx, seriesId, compId, {
      id: compId, seriesId, fleetIds: [], sailNumber: '1',
      names: ['Aurelia'], clubs: ['RCYC'], gender: '' as const, age: null,
      createdAt: Date.now(),
    });
    const finishId = uuid();
    await finishes.putFinish(ctx, raceId, finishId, {
      id: finishId, raceId, competitorId: compId, sortOrder: 1,
      tiedWithPrevious: false, resultCode: null, startPresent: null,
      penaltyCode: null, penaltyOverride: null, redressMethod: null,
      redressExcludeRaceIds: null, redressIncludeRaceIds: null,
      redressIncludeAllLater: false, redressPoints: null,
    });
    return seriesId;
  }

  function get(path: string, headers: Record<string, string> = {}) {
    return GET(new NextRequest(`http://localhost:3000${path}`, { headers }), {
      params: Promise.resolve({ slug: path.split('/').slice(2) }),
    });
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_pc_${uuid().replace(/-/g, '')}`;
    ws = `pc-${workspaceId.slice(7, 17)}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'Royal Cork', slug: ws, createdAt: new Date(),
    });
    ctx = {
      userId: 'pc-user',
      email: 'pc@sailscoring.test',
      workspaceId,
      workspaceSlug: ws,
      role: 'owner',
      features: [],
    };
    categoryId = (await categories.createCategory(ctx, { name: 'Cork Week' })).id;
    ids.cw2024 = await makeSeries('Cork Week 2024', '2024-07-08');
    ids.cw2026 = await makeSeries('Cork Week 2026', '2026-07-13');
    ids.club = await makeSeries('Club Racing 2026', '2026-05-01');
    await series.setSeriesCategory(ctx, ids.cw2024, { categoryId });
    await series.setSeriesCategory(ctx, ids.cw2026, { categoryId });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('a category with nothing published has no page', async () => {
    expect((await get(`/p/${ws}/-/cork-week`)).status).toBe(404);
    expect((await categories.listCategories(ctx)).items[0].publicPath).toBeNull();
  });

  test("lists every season's events in the category, newest first", async () => {
    await publishSeries(ctx, ids.cw2024, {});
    await publishSeries(ctx, ids.cw2026, {});
    await publishSeries(ctx, ids.club, {});

    const res = await get(`/p/${ws}/-/cork-week`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Cork Week results — Royal Cork</title>');
    expect(html).toContain(`href="/p/${ws}/cork-week-2026"`);
    expect(html).toContain(`href="/p/${ws}/cork-week-2024"`);
    expect(html).not.toContain('Club Racing 2026');
    expect(html.indexOf('>2026</h2>')).toBeLessThan(html.indexOf('>2024</h2>'));

    // Revalidation answers 304 without re-rendering.
    const etag = res.headers.get('etag')!;
    expect((await get(`/p/${ws}/-/cork-week`, { 'if-none-match': etag })).status).toBe(304);
  });

  test('the in-app list gives a published category its public path', async () => {
    const [cat] = (await categories.listCategories(ctx)).items;
    expect(cat.publicPath).toBe(`/p/${ws}/-/cork-week`);
  });

  test('the workspace index links the category heading', async () => {
    const html = await (await get(`/p/${ws}`)).text();
    expect(html).toContain(`<h3 class="cat"><a href="/p/${ws}/-/cork-week">Cork Week</a></h3>`);
  });

  test("an event page links its category's page; an uncategorised one doesn't", async () => {
    const index = await (await get(`/p/${ws}/cork-week-2024`)).text();
    expect(index).toContain(`href="/p/${ws}/-/cork-week">All Cork Week results &rarr;</a>`);
    const page = await (await get(`/p/${ws}/cork-week-2024/standings`)).text();
    expect(page).toContain(`href="/p/${ws}/-/cork-week">All Cork Week results &rarr;</a>`);
    const club = await (await get(`/p/${ws}/club-racing-2026`)).text();
    expect(club).not.toContain('class="sstreenav-cat"');
  });

  test('index.json lists the category and files each publication in it', async () => {
    const doc = await (await get(`/p/${ws}/index.json`)).json();
    const url = `http://localhost:3000/p/${ws}/-/cork-week`;
    expect(doc.categories).toEqual([{ name: 'Cork Week', url }]);
    const byName = Object.fromEntries(
      doc.publications.map((p: { name: string; category?: unknown }) => [p.name, p.category]),
    );
    expect(byName['Cork Week 2026']).toEqual({ name: 'Cork Week', url });
    expect(byName['Club Racing 2026']).toBeUndefined();
  });

  test('a renamed category moves its page; the old URL redirects', async () => {
    await categories.renameCategory(ctx, categoryId, { name: 'Cork Week Regatta' });
    const moved = await get(`/p/${ws}/-/cork-week`);
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe(`/p/${ws}/-/cork-week-regatta`);
    expect((await get(`/p/${ws}/-/cork-week-regatta`)).status).toBe(200);
  });

  test('an unknown category is a 404', async () => {
    expect((await get(`/p/${ws}/-/no-such-category`)).status).toBe(404);
  });
});
