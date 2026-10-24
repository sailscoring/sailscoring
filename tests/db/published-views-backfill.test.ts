// @vitest-environment node

/**
 * The published-views backfill: a publication made before the published
 * results API gets its view from the live series while that is unchanged
 * since the publish, and is left for its next publish once it has been
 * edited. The ids it writes are the ones a publish would.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import * as finishes from '@/lib/api-handlers/finishes';
import { publishSeries } from '@/lib/api-handlers/publish';
import { getPublishedBySeries } from '@/lib/published-repository';
import { readPublishedObject } from '@/lib/blob-storage';
import { deletePublishedView, publicCompetitorId, publishedResourceKey } from '@/lib/public-api/store';
import { standingsSchema } from '@/lib/validation/public-api-v1';
import { runCli as backfill } from '@/scripts/backfill-published-views';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('published-views backfill', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let userId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  let competitorId: string;

  /** The publication as one made before the API: no view, not flagged. */
  async function forgetView(): Promise<string> {
    const published = (await getPublishedBySeries(seriesId))!;
    await deletePublishedView(published.id);
    await db.update(schema.publishedSeries).set({ apiView: false }).where(eq(schema.publishedSeries.id, published.id));
    return published.id;
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    userId = `usr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.user).values({
      id: userId, name: 'Backfill Owner', email: `pvb-${userId.slice(4, 14)}@sailscoring.test`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    });
    workspaceId = `org_pvb_${uuid().replace(/-/g, '')}`;
    const slug = `pvb-${workspaceId.slice(8, 18)}`;
    await db.insert(schema.organization).values({ id: workspaceId, name: 'Backfill', slug, createdAt: new Date() });
    await db.insert(schema.member).values({
      id: `mem_${uuid().replace(/-/g, '')}`, organizationId: workspaceId, userId, role: 'owner', createdAt: new Date(),
    });
    ctx = { userId, email: 'pvb@sailscoring.test', workspaceId, workspaceSlug: slug, role: 'owner', features: [] };

    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Frostbites', venue: 'GBSC',
      startDate: '2026-11-01', endDate: '2027-02-28',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const, discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: [], primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    competitorId = uuid();
    await competitors.putCompetitor(ctx, seriesId, competitorId, {
      id: competitorId, seriesId, fleetIds: [], sailNumber: '7', names: ['Helm 7'],
      clubs: [], gender: '' as const, age: null, createdAt: Date.now(),
    });
    const raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-11-01', createdAt: Date.now(),
    });
    const finishId = uuid();
    await finishes.putFinish(ctx, raceId, finishId, {
      id: finishId, raceId, competitorId, sortOrder: 1, tiedWithPrevious: false, resultCode: null,
      startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
      redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
    });
    vi.stubEnv('COMPETITOR_ID_KEY', 'backfill-test-key');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example');
    await publishSeries(ctx, seriesId, {});
  });

  afterEach(() => {
    vi.spyOn(console, 'log').mockRestore();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (workspaceId) await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
    await sql?.end();
  });

  test('refuses to write without the instance key and origin', async () => {
    vi.stubEnv('COMPETITOR_ID_KEY', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await backfill(['--workspace', ctx.workspaceSlug, '--apply'])).toBe(1);
    vi.stubEnv('COMPETITOR_ID_KEY', 'backfill-test-key');
  });

  test('writes the view of an unchanged series, with the ids a publish writes', async () => {
    const id = await forgetView();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await backfill(['--workspace', ctx.workspaceSlug]);
    expect(await readPublishedObject(publishedResourceKey(id, 'standings'))).toBeNull();

    expect(await backfill(['--workspace', ctx.workspaceSlug, '--apply'])).toBe(0);
    expect((await getPublishedBySeries(seriesId))!.apiView).toBe(true);
    const standings = standingsSchema.parse(
      JSON.parse((await readPublishedObject(publishedResourceKey(id, 'standings')))!),
    );
    expect(standings.tables[0].rows[0].competitor.id).toBe(publicCompetitorId(seriesId, competitorId));
    expect(standings.publication).toBe(`https://app.example/api/public/v1/publications/${id}`);
  });

  test('leaves a series edited since publishing for its next publish', async () => {
    const id = await forgetView();
    await competitors.putCompetitor(ctx, seriesId, competitorId, {
      id: competitorId, seriesId, fleetIds: [], sailNumber: '7', names: ['Helm Seven'],
      clubs: [], gender: '' as const, age: null, createdAt: Date.now(),
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await backfill(['--workspace', ctx.workspaceSlug, '--apply']);
    expect(log.mock.calls.flat().join('\n')).toContain('SKIP  series edited since publishing');
    expect(await readPublishedObject(publishedResourceKey(id, 'standings'))).toBeNull();
    expect((await getPublishedBySeries(seriesId))!.apiView).toBe(false);
  });
});
