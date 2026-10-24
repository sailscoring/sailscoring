// @vitest-environment node

/**
 * The published results API's view through the publish handler (ADR-015):
 * written on publish, following the pages ticked — an Entries-only publish
 * leaves standings as they were — pruned when a page is retracted, and gone
 * with the publication.
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
import { publishSeries, retractPage, unpublishBySeries } from '@/lib/api-handlers/publish';
import { getPublishedBySeries } from '@/lib/published-repository';
import { readPublishedObject } from '@/lib/blob-storage';
import { publicCompetitorId, publishedResourceKey } from '@/lib/public-api/store';
import {
  competitorsSchema,
  publicationSchema,
  raceSchema,
  standingsSchema,
} from '@/lib/validation/public-api-v1';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — the published results API view', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  const compIds: string[] = [];
  let raceId: string;

  async function resource(path: string): Promise<unknown> {
    const published = (await getPublishedBySeries(seriesId))!;
    const text = await readPublishedObject(publishedResourceKey(published.id, path));
    return text === null ? null : JSON.parse(text);
  }

  async function finish(competitorId: string, sortOrder: number, resultCode: 'DNF' | null = null) {
    const finishId = `${raceId.slice(0, 8)}${competitorId.slice(8)}`;
    await finishes.putFinish(ctx, raceId, finishId, {
      id: finishId, raceId, competitorId, sortOrder,
      tiedWithPrevious: false, resultCode, startPresent: null,
      penaltyCode: null, penaltyOverride: null, redressMethod: null,
      redressExcludeRaceIds: null, redressIncludeRaceIds: null,
      redressIncludeAllLater: false, redressPoints: null,
    });
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_apv_${uuid().replace(/-/g, '')}`;
    const slug = `apv-${workspaceId.slice(8, 18)}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'API View Club', slug, createdAt: new Date(),
    });
    ctx = {
      userId: 'apv-user', email: 'apv@sailscoring.test', workspaceId,
      workspaceSlug: slug, role: 'owner', features: ['entry-list'],
    };

    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Autumn League', venue: 'GBSC',
      startDate: '2026-09-01', endDate: '2026-10-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    const fleetIds: string[] = [];
    for (const [i, name] of ['Cruisers', 'Whitesails'].entries()) {
      const fleetId = uuid();
      fleetIds.push(fleetId);
      await fleets.putFleet(ctx, seriesId, fleetId, {
        id: fleetId, seriesId, name, displayOrder: i, scoringSystem: 'scratch' as const,
      });
    }
    for (let i = 0; i < 4; i++) {
      const compId = uuid();
      compIds.push(compId);
      await competitors.putCompetitor(ctx, seriesId, compId, {
        id: compId, seriesId, fleetIds: [fleetIds[i % 2]],
        sailNumber: `${i + 1}`, names: [`Helm ${i + 1}`], boatName: `Boat ${i + 1}`,
        clubs: ['GBSC'], gender: '' as const, age: null, createdAt: Date.now(),
      });
    }
    raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-09-20', createdAt: Date.now(),
    });
    for (const [i, compId] of compIds.entries()) await finish(compId, i + 1);
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('a publish writes the publication, standings, races and entry list', async () => {
    await publishSeries(ctx, seriesId, {});
    const publication = publicationSchema.parse(await resource(''));
    expect(publication.name).toBe('Autumn League');
    expect(publication.kind).toBe('series');
    expect(publication.workspace.name).toBe('API View Club');
    expect(Object.keys(publication.resources).sort()).toEqual(['competitors', 'races', 'standings']);

    const standings = standingsSchema.parse(await resource('standings'));
    expect(standings.tables.map((t) => t.fleet.key)).toEqual(['cruisers', 'whitesails']);
    const winner = standings.tables[0].rows[0].competitor;
    // The public id, never the internal one.
    expect(winner.id).toBe(publicCompetitorId(seriesId, compIds[0]));
    expect(JSON.stringify(standings)).not.toContain(compIds[0]);

    expect(standingsSchema.parse(await resource('standings/whitesails')).tables).toHaveLength(1);
    expect(raceSchema.parse(await resource('races/1')).fleets).toHaveLength(2);
    expect(competitorsSchema.parse(await resource('competitors')).count).toBe(4);
  });

  test('publishing only the entry list leaves the standings as published', async () => {
    const before = standingsSchema.parse(await resource('standings'));
    // Boat 1 retires; only Entries goes out.
    await finish(compIds[0], 1, 'DNF');
    await publishSeries(ctx, seriesId, { fleets: ['Entries'] });
    expect(standingsSchema.parse(await resource('standings'))).toEqual(before);

    // Ticking Cruisers moves its standings and the race on; Whitesails' stay.
    await publishSeries(ctx, seriesId, { fleets: ['Cruisers'] });
    const after = standingsSchema.parse(await resource('standings'));
    const cruisers = after.tables.find((t) => t.fleet.key === 'cruisers')!;
    expect(cruisers.rows.find((r) => r.competitor.sailNumber === '1')!.scores[0]!.code).toBe('DNF');
    expect(after.tables.find((t) => t.fleet.key === 'whitesails')).toEqual(
      before.tables.find((t) => t.fleet.key === 'whitesails'),
    );
  });

  test('retracting a page removes what only it showed', async () => {
    await retractPage(ctx, seriesId, 'whitesails');
    expect(await resource('standings/whitesails')).toBeNull();
    const standings = standingsSchema.parse(await resource('standings'));
    expect(standings.tables.map((t) => t.fleet.key)).toEqual(['cruisers']);
    const race = raceSchema.parse(await resource('races/1'));
    expect(race.fleets.map((f) => f.fleet.key)).toEqual(['cruisers']);
  });

  test('unpublishing removes every resource', async () => {
    const id = (await getPublishedBySeries(seriesId))!.id;
    await unpublishBySeries(ctx, seriesId);
    for (const path of ['', 'standings', 'standings/cruisers', 'races', 'races/1', 'competitors']) {
      expect(await readPublishedObject(publishedResourceKey(id, path))).toBeNull();
    }
  });
});
