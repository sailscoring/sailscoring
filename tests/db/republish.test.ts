// @vitest-environment node

/**
 * The operator re-publish pass end to end against Postgres: a publication
 * left behind by an older renderer is rebuilt in place — same pages, same
 * published-at time, no revision pinned — and a rebuild that would change
 * the page set is refused.
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
import { BadRequestError } from '@/app/api/v1/_lib/handler';
import { getPublishedBySeries } from '@/lib/published-repository';
import { readPublishedHtml } from '@/lib/blob-storage';
import { serializeOrgMetadata } from '@/lib/features';
import {
  classify,
  listPublications,
  rebuildPublication,
  workspaceContextFor,
} from '@/scripts/republish';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('republish — rebuilding a publication in place', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let userId: string;
  let workspaceId: string;
  let workspaceSlug: string;
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

  async function revisionCount(): Promise<number> {
    const rows = await db
      .select({ id: schema.seriesRevision.id })
      .from(schema.seriesRevision)
      .where(eq(schema.seriesRevision.seriesId, seriesId));
    return rows.length;
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    userId = `usr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.user).values({
      id: userId,
      name: 'Republish Owner',
      email: `republish-${userId.slice(4, 14)}@sailscoring.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    workspaceId = `org_rp_${uuid().replace(/-/g, '')}`;
    workspaceSlug = `rp-${workspaceId.slice(7, 17)}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Republish',
      slug: workspaceSlug,
      createdAt: new Date(),
    });
    await db.insert(schema.member).values({
      id: `mem_${uuid().replace(/-/g, '')}`,
      organizationId: workspaceId,
      userId,
      role: 'owner',
      createdAt: new Date(),
    });
    ctx = {
      userId,
      email: 'rp@sailscoring.test',
      workspaceId,
      workspaceSlug,
      role: 'owner',
      features: [],
    };

    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Winter Series', venue: 'HYC',
      startDate: '2026-01-04', endDate: '2026-03-01',
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
      id: raceId, seriesId, raceNumber: 1, date: '2026-01-04', createdAt: Date.now(),
    });
    await addBoat('Aurelia', '1', 1);
    await addBoat('Bandit', '2', 2);
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    if (userId) {
      await db.delete(schema.user).where(eq(schema.user.id, userId));
    }
    await sql?.end();
  });

  test('a rebuild needs an existing publication', async () => {
    await expect(publishSeries(ctx, seriesId, {}, { rebuildOnly: true })).rejects.toMatchObject({
      issues: { code: 'not-published' },
    });
  });

  test('the workspace context stands in for the owner', async () => {
    await db
      .update(schema.organization)
      .set({ metadata: serializeOrgMetadata({ kind: 'club', enabledFeatures: ['prizes'], disabledFeatures: [], seededFeatureSamples: [] }) })
      .where(eq(schema.organization.id, workspaceId));
    const stood = await workspaceContextFor(db, workspaceId, workspaceSlug);
    expect(stood).toMatchObject({ userId, workspaceId, workspaceSlug, role: 'owner' });
    expect(stood!.features).toContain('prizes');
    await db.update(schema.organization).set({ metadata: null }).where(eq(schema.organization.id, workspaceId));
  });

  test('a publication of an unchanged series is a candidate; one with edits is not', async () => {
    await publishSeries(ctx, seriesId, {});
    let [row] = await listPublications(db, { series: seriesId });
    expect(row.seriesVersion).toBe(row.publishedVersion);
    expect(classify(row, 'db')).toEqual({ kind: 'rebuild' });

    await addBoat('Corsair', '3', 3);
    [row] = await listPublications(db, { series: seriesId });
    expect(row.seriesVersion).toBeGreaterThan(row.publishedVersion);
    expect(classify(row, 'db').kind).toBe('skip');
  });

  test('an older publication is rebuilt: data file restored, time kept, no revision pinned', async () => {
    // Bring the publication up to date, then age it: this is what a page
    // published before the data file existed looks like in the row.
    await publishSeries(ctx, seriesId, {});
    const fresh = (await getPublishedBySeries(seriesId))!;
    const publishedAt = new Date('2026-01-05T10:15:00Z');
    await db
      .update(schema.publishedSeries)
      .set({ dataSubPath: null, dataBlobUrl: null, contentHash: 'stale', publishedAt })
      .where(eq(schema.publishedSeries.id, fresh.id));
    const revisionsBefore = await revisionCount();

    const [row] = await listPublications(db, { series: seriesId });
    expect(classify(row, 'db')).toEqual({ kind: 'rebuild' });
    const outcome = await rebuildPublication(db, row);
    expect(outcome).toEqual({ kind: 'rebuilt', pages: 1, dataFile: true });

    const after = (await getPublishedBySeries(seriesId))!;
    expect(after.pages.map((p) => p.subPath)).toEqual(fresh.pages.map((p) => p.subPath));
    expect(after.dataSubPath).toBe('winter-series.sailscoring.json');
    expect(after.dataBlobUrl).toBeTruthy();
    expect(after.publishedAt).toBe(publishedAt.getTime());
    expect(after.publishedVersion).toBe(fresh.publishedVersion);
    expect(await revisionCount()).toBe(revisionsBefore);

    // The page links the data file and says the results are provisional as
    // of the publish it re-rendered, not as of now.
    const html = (await readPublishedHtml(after.pages[0].blobUrl))!;
    expect(html).toContain('/open?from=');
    expect(html).not.toContain('import#data=');
    expect(html).toMatch(/provisional as of 10:15\b.* on 5 January 2026|provisional as of 10:15\b.* on January 5, 2026/);
    // Superseded blobs are gone.
    expect(await readPublishedHtml(fresh.pages[0].blobUrl)).toBeNull();
  });

  test('a rebuild that would change the page set is refused', async () => {
    const [row] = await listPublications(db, { series: seriesId });
    // The workspace gains the entry-list feature: a scorer's publish would
    // now add an Entries page; a rebuild must not.
    await db
      .update(schema.organization)
      .set({ metadata: serializeOrgMetadata({ kind: 'club', enabledFeatures: ['entry-list'], disabledFeatures: [], seededFeatureSamples: [] }) })
      .where(eq(schema.organization.id, workspaceId));
    try {
      const before = (await getPublishedBySeries(seriesId))!;
      const outcome = await rebuildPublication(db, row);
      expect(outcome).toEqual({ kind: 'skip', reason: 'page set changed (would add Entries)' });
      const after = (await getPublishedBySeries(seriesId))!;
      expect(after.contentHash).toBe(before.contentHash);
      expect(after.pages).toHaveLength(1);

      await expect(
        publishSeries({ ...ctx, features: ['entry-list'] }, seriesId, {}, { rebuildOnly: true }),
      ).rejects.toSatisfy((err: unknown) =>
        err instanceof BadRequestError &&
        (err.issues as { code: string; added: string[] }).code === 'page-set-changed' &&
        (err.issues as { added: string[] }).added.includes('Entries'),
      );
    } finally {
      await db.update(schema.organization).set({ metadata: null }).where(eq(schema.organization.id, workspaceId));
    }
  });

  test('a rebuild of a page that already renders identically is a no-op', async () => {
    const [row] = await listPublications(db, { series: seriesId });
    const before = (await getPublishedBySeries(seriesId))!;
    expect(await rebuildPublication(db, row)).toEqual({ kind: 'unchanged' });
    const after = (await getPublishedBySeries(seriesId))!;
    expect(after.pages[0].blobUrl).toBe(before.pages[0].blobUrl);
  });
});
