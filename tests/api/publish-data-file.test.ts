// @vitest-environment node

/**
 * The publication's data file (ADR-012): publishing a series also stores its
 * sanitized public export beside the pages, at a `.sailscoring.json` sub-path
 * frozen at first assignment; re-publish supersedes the blob, unpublish (and
 * opting out of the JSON export) removes it.
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
import { getPublishedBySeries } from '@/lib/published-repository';
import { readPublishedHtml } from '@/lib/blob-storage';
import { createRepos } from '@/lib/postgres-repository';
import type { PublicSeriesExport } from '@/lib/public-export';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — the data file (ADR-012)', () => {
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
      names: [name], club: 'HYC', gender: '' as const, age: null,
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
    workspaceId = `org_df_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Data file',
      slug: `df-${workspaceId.slice(7, 17)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'df-user',
      email: 'df@sailscoring.test',
      workspaceId,
      workspaceSlug: `df-${workspaceId.slice(7, 17)}`,
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
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('publishing stores the export at a .sailscoring.json sub-path', async () => {
    await publishSeries(ctx, seriesId, {});
    const stored = (await getPublishedBySeries(seriesId))!;
    expect(stored.dataSubPath).toBe('summer-series.sailscoring.json');
    expect(stored.dataBlobUrl).toBeTruthy();

    const json = await readPublishedHtml(stored.dataBlobUrl!);
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!) as PublicSeriesExport;
    expect(parsed.version).toBe(2);
    expect(parsed.series.name).toBe('Summer Series');
    const boat = parsed.competitors.find((c) => c.sailNumber === '1')!;
    expect(boat.names).toEqual(['Aurelia']);
    // The v2 contract in the stored artifact: club is set on the competitor
    // but not displayed and read by nothing published, so it must not travel.
    expect(boat.club).toBeUndefined();
  });

  test('re-publish keeps the frozen sub-path and supersedes the blob', async () => {
    const before = (await getPublishedBySeries(seriesId))!;
    await addBoat('Corsair', '3', 3);
    await publishSeries(ctx, seriesId, {});

    const after = (await getPublishedBySeries(seriesId))!;
    expect(after.dataSubPath).toBe(before.dataSubPath);
    expect(after.dataBlobUrl).not.toBe(before.dataBlobUrl);
    // The superseded blob is gone; the fresh one holds the new boat.
    expect(await readPublishedHtml(before.dataBlobUrl!)).toBeNull();
    const parsed = JSON.parse((await readPublishedHtml(after.dataBlobUrl!))!) as PublicSeriesExport;
    expect(parsed.competitors.some((c) => c.sailNumber === '3')).toBe(true);
  });

  test('opting out of the JSON export withdraws the data file', async () => {
    const before = (await getPublishedBySeries(seriesId))!;
    const repos = createRepos({ workspaceId });
    const current = (await repos.series.get(seriesId))!;
    await repos.series.save({ ...current, includeJsonExport: false });
    await publishSeries(ctx, seriesId, {});

    const after = (await getPublishedBySeries(seriesId))!;
    expect(after.dataSubPath).toBeNull();
    expect(after.dataBlobUrl).toBeNull();
    expect(await readPublishedHtml(before.dataBlobUrl!)).toBeNull();

    // Opting back in re-publishes it at the same frozen name... or a fresh
    // assignment — the frozen name was cleared with the opt-out, and the
    // series name has not changed, so it derives identically.
    await repos.series.save({ ...current, includeJsonExport: true });
    await publishSeries(ctx, seriesId, {});
    const restored = (await getPublishedBySeries(seriesId))!;
    expect(restored.dataSubPath).toBe('summer-series.sailscoring.json');
  });

  test('unpublishing deletes the data blob with the pages', async () => {
    const stored = (await getPublishedBySeries(seriesId))!;
    expect(stored.dataBlobUrl).toBeTruthy();
    await unpublishBySeries(ctx, seriesId);
    expect(await getPublishedBySeries(seriesId)).toBeNull();
    expect(await readPublishedHtml(stored.dataBlobUrl!)).toBeNull();
  });
});
