// @vitest-environment node

/**
 * The public directory at `/p/` and `/p/index.json` (#670), through the real
 * route: a club workspace with something published is listed, a personal one
 * never is, nor a club with nothing published, and unlisting takes a
 * workspace out while its own pages stay up.
 *
 * The directory spans every workspace in the database, so assertions look
 * for this test's own workspaces rather than at the whole listing.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { NextRequest } from 'next/server';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import * as finishes from '@/lib/api-handlers/finishes';
import { publishSeries } from '@/lib/api-handlers/publish';
import { setDirectorySettings } from '@/lib/api-handlers/workspace';
import { GET } from '@/app/p/[[...slug]]/route';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('the public directory (#670)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  const suffix = uuid().replace(/-/g, '').slice(0, 10);
  const ctxFor = (id: string, slug: string): WorkspaceContext => ({
    userId: `pd-user-${suffix}`,
    email: 'pd@sailscoring.test',
    workspaceId: id,
    workspaceSlug: slug,
    role: 'owner',
    features: [],
  });
  const club = ctxFor(`org_pdc_${suffix}`, `pd-club-${suffix}`);
  const quiet = ctxFor(`org_pdq_${suffix}`, `pd-quiet-${suffix}`);
  const personal = ctxFor(`org_pdp_${suffix}`, `u-pd${suffix}`);

  async function publishOne(ctx: WorkspaceContext, name: string) {
    const seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name, venue: 'HYC',
      startDate: '2026-06-01', endDate: '2026-08-30',
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
      id: raceId, seriesId, raceNumber: 1, date: '2026-06-06', createdAt: Date.now(),
    });
    const compId = uuid();
    await competitors.putCompetitor(ctx, seriesId, compId, {
      id: compId, seriesId, fleetIds: [], sailNumber: '1',
      names: ['Aurelia'], clubs: [], gender: '' as const, age: null,
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
    await publishSeries(ctx, seriesId, {});
  }

  function get(path: string) {
    const segments = path.split('/').slice(2).filter(Boolean);
    return GET(new NextRequest(`http://localhost:3000${path}`), {
      params: Promise.resolve(segments.length ? { slug: segments } : {}),
    });
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    await db.insert(schema.organization).values(
      [club, quiet, personal].map((c, i) => ({
        id: c.workspaceId,
        name: ['Directory Club', 'Quiet Club', 'My Workspace'][i],
        slug: c.workspaceSlug,
        createdAt: new Date(),
      })),
    );
    await setDirectorySettings(club, { listed: true, description: 'Racing on the bay' });
    await publishOne(club, 'Bay Series');
    await publishOne(personal, 'Private Series');
  });

  afterAll(async () => {
    await db
      .delete(schema.organization)
      .where(inArray(schema.organization.id, [club, quiet, personal].map((c) => c.workspaceId)));
    await sql?.end();
  });

  test('the page lists a club that has published, and no one else', async () => {
    const res = await get('/p');
    expect(res.status).toBe(200);
    expect(res.headers.get('vercel-cache-tag')).toBe('p:directory');
    const html = await res.text();
    expect(html).toContain(`data-workspace="${club.workspaceSlug}"`);
    expect(html).toContain('Racing on the bay');
    expect(html).toContain('Bay Series');
    expect(html).not.toContain(`data-workspace="${quiet.workspaceSlug}"`);
    expect(html).not.toContain(personal.workspaceSlug);
    expect(html).not.toContain('Private Series');
  });

  test('the JSON twin lists the club with a link to its own index', async () => {
    const res = await get('/p/index.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const doc = await res.json();
    expect(doc.version).toBe(1);
    const entry = doc.workspaces.find((w: { slug: string }) => w.slug === club.workspaceSlug);
    expect(entry).toMatchObject({
      name: 'Directory Club',
      description: 'Racing on the bay',
      index: `http://localhost:3000/p/${club.workspaceSlug}/index.json`,
      currentSeason: '2026',
      latest: { name: 'Bay Series', url: `http://localhost:3000/p/${club.workspaceSlug}/bay-series` },
      counts: { seasons: 1, series: 1, races: 1, entries: 1 },
      badges: [],
    });
    expect(doc.workspaces.some((w: { slug: string }) => w.slug === personal.workspaceSlug)).toBe(false);

    const again = await GET(
      new NextRequest('http://localhost:3000/p/index.json', {
        headers: { 'if-none-match': res.headers.get('etag')! },
      }),
      { params: Promise.resolve({ slug: ['index.json'] }) },
    );
    expect(again.status).toBe(304);
  });

  test('unlisting takes the club out of the directory; its own pages stay up', async () => {
    await setDirectorySettings(club, { listed: false, description: 'Racing on the bay' });
    expect(await (await get('/p')).text()).not.toContain(`data-workspace="${club.workspaceSlug}"`);
    const doc = await (await get('/p/index.json')).json();
    expect(doc.workspaces.some((w: { slug: string }) => w.slug === club.workspaceSlug)).toBe(false);
    expect((await get(`/p/${club.workspaceSlug}`)).status).toBe(200);
    expect((await get(`/p/${club.workspaceSlug}/index.json`)).status).toBe(200);
  });
});
