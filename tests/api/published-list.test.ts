// @vitest-environment node

/**
 * The workspace Published list names each publication by the address of its
 * own pages. A series published into a season has the season as its slug, so
 * the slug alone would give every series in the season the same URL and make
 * each one "share" it with the rest of the season. The row's URL is its event
 * folder instead, and it shares only with the series in that folder.
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
import { listPublished, publishSeries } from '@/lib/api-handlers/publish';
import type { PublishedListItem } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('workspace Published list — addresses and sharing', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let rows: PublishedListItem[];

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
    workspaceId = `org_pls_${uuid().replace(/-/g, '')}`;
    const slug = `pls-${workspaceId.slice(8, 18)}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'Published list', slug, createdAt: new Date(),
    });
    ctx = {
      userId: 'pls-user',
      email: 'pls@sailscoring.test',
      workspaceId,
      workspaceSlug: slug,
      role: 'owner',
      features: [],
    };

    // Two series in one event folder, a third in the same season, and one
    // on a slug of its own.
    const oneDesigns = await makeSeries('Lambay One Designs', ['Squibs', 'Etchells']);
    const cruisers = await makeSeries('Lambay Cruisers', ['Cruisers 1', 'Cruisers 2']);
    const frostbite = await makeSeries('Frostbite', ['Dinghies', 'Lasers']);
    const solo = await makeSeries('Solo Series', ['Ones', 'Twos']);
    await publishSeries(ctx, oneDesigns, { slug: '2026', season: '2026', folder: 'lambay-races' });
    await publishSeries(ctx, cruisers, { slug: '2026', season: '2026', folder: 'lambay-races' });
    await publishSeries(ctx, frostbite, { slug: '2026', season: '2026', folder: 'frostbite' });
    await publishSeries(ctx, solo, {});

    rows = await listPublished(ctx);
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  const row = (title: string) => rows.find((r) => r.title === title)!;

  test('a series in a season is listed at its event folder, not the season', () => {
    const base = `/p/${ctx.workspaceSlug}`;
    expect(row('Lambay One Designs').path).toBe('2026/lambay-races');
    expect(new URL(row('Lambay One Designs').url).pathname).toBe(`${base}/2026/lambay-races`);
    expect(new URL(row('Lambay Cruisers').url).pathname).toBe(`${base}/2026/lambay-races`);
    expect(new URL(row('Frostbite').url).pathname).toBe(`${base}/2026/frostbite`);
  });

  test('a series shares its URL only with the series in the same folder', () => {
    expect(row('Lambay One Designs').sharedWith).toEqual(['Lambay Cruisers']);
    expect(row('Lambay Cruisers').sharedWith).toEqual(['Lambay One Designs']);
    expect(row('Frostbite').sharedWith).toEqual([]);
  });

  test('a publication with its slug to itself is listed at the slug', () => {
    expect(row('Solo Series').path).toBe('solo-series');
    expect(row('Solo Series').sharedWith).toEqual([]);
  });
});
