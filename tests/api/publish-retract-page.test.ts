// @vitest-environment node

/**
 * Retracting one page of a live publication: the page leaves the row and its
 * blob goes, every sibling page stays exactly as it was, and the freed sub-path
 * unfreezes so the page can be published again somewhere shorter. The last
 * remaining page is refused — that is Unpublish.
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
import { publishSeries, retractPage } from '@/lib/api-handlers/publish';
import { getPublishedBySeries } from '@/lib/published-repository';
import { readPublishedHtml } from '@/lib/blob-storage';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — retracting one page', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  let soloSeriesId: string;

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

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_rtr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Retract',
      slug: `rtr-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'rtr-user',
      email: 'rtr@sailscoring.test',
      workspaceId,
      workspaceSlug: `rtr-${workspaceId.slice(8, 18)}`,
      role: 'owner',
      features: [],
    };

    seriesId = await makeSeries('Retract League', ['Cruisers', 'Whitesails']);
    soloSeriesId = await makeSeries('Solo Series', []);
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('drops one page and its blob, leaving the siblings untouched', async () => {
    await publishSeries(ctx, seriesId, {});
    const before = (await getPublishedBySeries(seriesId))!;
    expect(before.pages.map((p) => p.subPath).sort()).toEqual(['cruisers', 'whitesails']);
    const cruisers = before.pages.find((p) => p.subPath === 'cruisers')!;
    const whitesails = before.pages.find((p) => p.subPath === 'whitesails')!;

    await retractPage(ctx, seriesId, 'cruisers');

    const after = (await getPublishedBySeries(seriesId))!;
    expect(after.pages.map((p) => p.subPath)).toEqual(['whitesails']);
    expect(await readPublishedHtml(cruisers.blobUrl)).toBeNull();
    // The sibling is untouched: same blob, same content, same sub-path.
    expect(after.pages[0].blobUrl).toBe(whitesails.blobUrl);
    expect(await readPublishedHtml(whitesails.blobUrl)).not.toBeNull();
    // The publication itself stays live under the same slug.
    expect(after.slug).toBe(before.slug);
  });

  test('re-publishing brings the page back even when nothing else changed', async () => {
    // The trap this guards: the publish handler short-circuits a re-publish
    // whose content hash matches the stored one, and re-rendering exactly what
    // was published before the retraction lands on exactly that hash. If the
    // retraction leaves the hash alone, the publish is read as a no-op and the
    // page never comes back — while reporting success.
    const retracted = (await getPublishedBySeries(seriesId))!;
    await publishSeries(ctx, seriesId, {});

    const restored = (await getPublishedBySeries(seriesId))!;
    expect(restored.pages.map((p) => p.subPath).sort()).toEqual(['cruisers', 'whitesails']);
    expect(restored.contentHash).not.toBe(retracted.contentHash);
    const cruisers = restored.pages.find((p) => p.subPath === 'cruisers')!;
    expect(await readPublishedHtml(cruisers.blobUrl)).not.toBeNull();
  });

  test('the freed sub-path unfreezes, so the page can move', async () => {
    await retractPage(ctx, seriesId, 'cruisers');
    await publishSeries(ctx, seriesId, {
      fleets: ['Cruisers'],
      subPaths: { Cruisers: 'cru' },
    });

    const moved = (await getPublishedBySeries(seriesId))!;
    expect(moved.pages.map((p) => p.subPath).sort()).toEqual(['cru', 'whitesails']);
    // The old path is gone rather than serving a stale copy.
    expect(moved.pages.some((p) => p.subPath === 'cruisers')).toBe(false);
  });

  test('an unknown sub-path is a 404, not a silent no-op', async () => {
    await expect(retractPage(ctx, seriesId, 'no-such-page')).rejects.toThrow(/not-found/);
    const unchanged = (await getPublishedBySeries(seriesId))!;
    expect(unchanged.pages).toHaveLength(2);
  });

  test('the last remaining page is refused — that is Unpublish', async () => {
    await publishSeries(ctx, soloSeriesId, {});
    const solo = (await getPublishedBySeries(soloSeriesId))!;
    expect(solo.pages).toHaveLength(1);

    await expect(
      retractPage(ctx, soloSeriesId, solo.pages[0].subPath),
    ).rejects.toMatchObject({ issues: { code: 'last-page' } });

    // Still live, blob and all.
    const after = (await getPublishedBySeries(soloSeriesId))!;
    expect(after.pages).toHaveLength(1);
    expect(await readPublishedHtml(after.pages[0].blobUrl)).not.toBeNull();
  });

  test('a publication in another workspace is not reachable', async () => {
    const other: WorkspaceContext = { ...ctx, workspaceId: 'org_somebody_else' };
    await expect(retractPage(other, seriesId, 'whitesails')).rejects.toThrow(/not-found/);
  });
});
