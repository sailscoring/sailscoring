// @vitest-environment node

/**
 * Single-race events through the publish handler (#347): a series set to
 * race-results detail publishes its lone page at `results` rather than
 * `standings`, flags it so listings can label it "Results", and renders the
 * race table without a series summary. Flipping the setting afterwards must
 * not move a URL that has already been announced.
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
import { publishSeries } from '@/lib/api-handlers/publish';
import { getPublishedBySeries } from '@/lib/published-repository';
import { readPublishedHtml } from '@/lib/blob-storage';
import { createRepos } from '@/lib/postgres-repository';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — race-results detail (#347)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  let raceId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_rr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Race results',
      slug: `rr-${workspaceId.slice(7, 17)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'rr-user',
      email: 'rr@sailscoring.test',
      workspaceId,
      workspaceSlug: `rr-${workspaceId.slice(7, 17)}`,
      role: 'owner',
      features: [],
    };

    // A one-race, single-fleet event — the shape #347 is about.
    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Lambay Race', venue: 'HYC',
      startDate: '2026-06-06', endDate: '',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-06-06', createdAt: Date.now(),
    });
    let sort = 0;
    for (const name of ['Aurelia', 'Bandit']) {
      const compId = uuid();
      await competitors.putCompetitor(ctx, seriesId, compId, {
        id: compId, seriesId, fleetIds: [], sailNumber: `${sort + 1}`,
        names: [name], club: 'HYC', gender: '' as const, age: null,
        createdAt: Date.now(),
      });
      sort += 1;
      const finishId = uuid();
      await finishes.putFinish(ctx, raceId, finishId, {
        id: finishId, raceId, competitorId: compId, sortOrder: sort,
        tiedWithPrevious: false, resultCode: null, startPresent: null,
        penaltyCode: null, penaltyOverride: null, redressMethod: null,
        redressExcludeRaceIds: null, redressIncludeRaceIds: null,
        redressIncludeAllLater: false, redressPoints: null,
      });
    }
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  async function setPublishDetail(publishDetail: 'full' | 'races') {
    const repos = createRepos({ workspaceId });
    const current = (await repos.series.get(seriesId))!;
    await repos.series.save({ ...current, publishDetail });
  }

  test('publishes the lone page at "results", flagged and without a summary', async () => {
    await setPublishDetail('races');
    const result = await publishSeries(ctx, seriesId, {});
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].url.endsWith('/results')).toBe(true);

    const stored = (await getPublishedBySeries(seriesId))!;
    expect(stored.pages[0].subPath).toBe('results');
    expect(stored.pages[0].isRaceResults).toBe(true);

    const html = await readPublishedHtml(stored.pages[0].blobUrl);
    expect(html).not.toContain('class="summarytable"');
    expect(html).toContain('class="racetable"');
    expect(html).toContain('Aurelia');
  });

  test('switching back to full detail keeps the announced URL', async () => {
    await setPublishDetail('full');
    const result = await publishSeries(ctx, seriesId, {});
    // The path was frozen at first publish, so the page stays at /results
    // even though a fresh publication would now derive /standings.
    expect(result.pages[0].url.endsWith('/results')).toBe(true);

    const stored = (await getPublishedBySeries(seriesId))!;
    expect(stored.pages[0].subPath).toBe('results');
    expect(stored.pages[0].isRaceResults).toBeUndefined();

    // The content follows the setting even though the URL cannot.
    const html = await readPublishedHtml(stored.pages[0].blobUrl);
    expect(html).toContain('class="summarytable"');
  });

  test('a full-detail series publishes at "standings" as before', async () => {
    const otherId = uuid();
    await series.putSeries(ctx, otherId, {
      id: otherId, name: 'Autumn League', venue: 'HYC',
      startDate: '2026-09-01', endDate: '2026-10-30',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    const otherRaceId = uuid();
    await races.putRace(ctx, otherId, otherRaceId, {
      id: otherRaceId, seriesId: otherId, raceNumber: 1, date: '2026-09-05',
      createdAt: Date.now(),
    });
    const compId = uuid();
    await competitors.putCompetitor(ctx, otherId, compId, {
      id: compId, seriesId: otherId, fleetIds: [], sailNumber: '7',
      names: ['Carmen'], club: 'HYC', gender: '' as const, age: null,
      createdAt: Date.now(),
    });
    const otherFinishId = uuid();
    await finishes.putFinish(ctx, otherRaceId, otherFinishId, {
      id: otherFinishId, raceId: otherRaceId, competitorId: compId, sortOrder: 1,
      tiedWithPrevious: false, resultCode: null, startPresent: null,
      penaltyCode: null, penaltyOverride: null, redressMethod: null,
      redressExcludeRaceIds: null, redressIncludeRaceIds: null,
      redressIncludeAllLater: false, redressPoints: null,
    });

    const result = await publishSeries(ctx, otherId, {});
    expect(result.pages[0].url.endsWith('/standings')).toBe(true);
    const stored = (await getPublishedBySeries(otherId))!;
    expect(stored.pages[0].isRaceResults).toBeUndefined();
  });
});
