// @vitest-environment node

/**
 * A `/p` page's ETag must change whenever anything the page shows changes.
 * The CDN keeps a page until a writer purges it. After a purge, a browser
 * revalidates with the ETag it holds, and an unchanged ETag gets a 304: the
 * old copy stays on screen. The workspace and series names are read live
 * rather than from the publication, so they are the inputs at risk.
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
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import * as finishes from '@/lib/api-handlers/finishes';
import { publishSeries } from '@/lib/api-handlers/publish';
import { GET } from '@/app/p/[[...slug]]/route';

const DATABASE_URL = process.env.DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(!DATABASE_URL)('public page ETags follow the names they show', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_etag_${uuid().replace(/-/g, '')}`;
    const slug = `etag-${workspaceId.slice(9, 19)}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Etag Club',
      slug,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'etag-user',
      email: 'etag@sailscoring.test',
      workspaceId,
      workspaceSlug: slug,
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
    const raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-06-06', createdAt: Date.now(),
    });
    const compId = uuid();
    await competitors.putCompetitor(ctx, seriesId, compId, {
      id: compId, seriesId, fleetIds: [], sailNumber: '1',
      names: ['Aurelia'], clubs: ['HYC'], gender: '' as const, age: null,
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

  /** The ETag each page serves now, after checking it revalidates. */
  async function etags(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const path of paths) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      const etag = res.headers.get('etag')!;
      expect((await get(path, { 'if-none-match': etag })).status, path).toBe(304);
      out.set(path, etag);
    }
    return out;
  }

  async function expectChanged(before: Map<string, string>) {
    for (const [path, etag] of before) {
      expect((await get(path, { 'if-none-match': etag })).status, path).toBe(200);
    }
  }

  test('renaming the workspace changes every listing', async () => {
    const base = `/p/${ctx.workspaceSlug}`;
    const before = await etags([base, `${base}/summer-series`, `${base}/2026`]);
    await db
      .update(schema.organization)
      .set({ name: 'Renamed Club' })
      .where(eq(schema.organization.id, workspaceId));
    await expectChanged(before);
  });

  test('renaming the series changes its index and its pages', async () => {
    const base = `/p/${ctx.workspaceSlug}`;
    const before = await etags([
      base,
      `${base}/summer-series`,
      `${base}/summer-series/standings`,
    ]);
    await db.update(schema.series).set({ name: 'Summer League' }).where(eq(schema.series.id, seriesId));
    await expectChanged(before);
  });
});
