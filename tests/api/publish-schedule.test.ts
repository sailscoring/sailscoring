// @vitest-environment node

/**
 * The Schedule page through the publish handler (ADR-014, Decision 4):
 * publishable before any entry, changed only when it is ticked — a race
 * sailed since reads `scheduled` until then — and linking a sailed race to
 * its results once it is.
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
import { publishSeries } from '@/lib/api-handlers/publish';
import { getPublishedBySeries } from '@/lib/published-repository';
import { readPublishedHtml, readPublishedObject } from '@/lib/blob-storage';
import { publishedResourceKey } from '@/lib/public-api/store';
import { publicationSchema, scheduleSchema } from '@/lib/validation/public-api-v1';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — the Schedule page', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  const fleetIds: string[] = [];
  const raceIds: string[] = [];

  async function schedule() {
    const published = (await getPublishedBySeries(seriesId))!;
    const text = await readPublishedObject(publishedResourceKey(published.id, 'schedule'));
    return scheduleSchema.parse(JSON.parse(text!));
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_sch_${uuid().replace(/-/g, '')}`;
    const slug = `sch-${workspaceId.slice(8, 18)}`;
    await db.insert(schema.organization).values({ id: workspaceId, name: 'Schedule Club', slug, createdAt: new Date() });
    ctx = {
      userId: 'sch-user', email: 'sch@sailscoring.test', workspaceId,
      workspaceSlug: slug, role: 'owner', features: ['schedule-page'],
    };
    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Winter League', venue: 'GBSC',
      startDate: '2026-11-01', endDate: '2027-02-28',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const, discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: [], primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    for (const [i, name] of ['Cruisers', 'Whitesails'].entries()) {
      const id = uuid();
      fleetIds.push(id);
      await fleets.putFleet(ctx, seriesId, id, { id, seriesId, name, displayOrder: i, scoringSystem: 'scratch' as const });
    }
    for (const [i, date] of ['2026-11-01', '2026-11-08'].entries()) {
      const id = uuid();
      raceIds.push(id);
      await races.putRace(ctx, seriesId, id, { id, seriesId, raceNumber: i + 1, date, createdAt: Date.now() });
    }
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    await sql?.end();
  });

  test('a series with no entries publishes its schedule', async () => {
    await publishSeries(ctx, seriesId, {});
    const published = (await getPublishedBySeries(seriesId))!;
    expect(published.pages.map((p) => [p.fleetName, p.subPath, p.isSchedule, p.isAuxiliary])).toEqual([
      ['Schedule', 'schedule', true, true],
    ]);
    expect(published.dataBlobUrl ?? null).toBeNull();
    const s = await schedule();
    expect(s.races.map((r) => [r.race, r.date, r.status])).toEqual([
      [1, '2026-11-01', 'scheduled'],
      [2, '2026-11-08', 'scheduled'],
    ]);
    const publication = publicationSchema.parse(
      JSON.parse((await readPublishedObject(publishedResourceKey(published.id, '')))!),
    );
    expect(Object.keys(publication.resources)).toEqual(['schedule']);
  });

  test('a race sailed since reads scheduled until the Schedule is ticked again', async () => {
    const competitorId = uuid();
    await competitors.putCompetitor(ctx, seriesId, competitorId, {
      id: competitorId, seriesId, fleetIds: [fleetIds[0]], sailNumber: '7', names: ['Helm 7'],
      clubs: [], gender: '' as const, age: null, createdAt: Date.now(),
    });
    const finishId = uuid();
    await finishes.putFinish(ctx, raceIds[0], finishId, {
      id: finishId, raceId: raceIds[0], competitorId, sortOrder: 1, tiedWithPrevious: false, resultCode: null,
      startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
      redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
    });

    await publishSeries(ctx, seriesId, { fleets: ['Cruisers'] });
    expect((await schedule()).races[0].status).toBe('scheduled');

    await publishSeries(ctx, seriesId, { fleets: ['Schedule'] });
    const s = await schedule();
    expect(s.races[0]).toMatchObject({ status: 'sailed' });
    expect(s.races[0].results).toMatch(/\/p\/sch-[^/]+\/winter-league\/cruisers$/);
    expect(s.races[1]).not.toHaveProperty('results');

    // The page links the race the same way.
    const page = (await getPublishedBySeries(seriesId))!.pages.find((p) => p.isSchedule)!;
    expect(await readPublishedHtml(page.blobUrl)).toContain('href="cruisers">Results</a>');
  });
});
