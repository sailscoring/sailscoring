// @vitest-environment node

/**
 * Every request-path write that changes what `/p` serves drops the
 * workspace's cached public pages. The CDN holds those pages until a purge,
 * so a writer that forgets to purge leaves `/p` stale for the full lifetime.
 * Each case drives the real handler against Postgres and watches the purge
 * call, which is mocked: off Vercel, the purge is a no-op.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { randomUUID as uuid } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

const deleteByTag = vi.hoisted(() => vi.fn());
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: deleteByTag }));

import * as categories from '@/lib/api-handlers/categories';
import { setWorkspaceLogo } from '@/lib/api-handlers/logos';
import { createRanking, deleteRanking, putRanking } from '@/lib/api-handlers/rankings';
import * as seasons from '@/lib/api-handlers/seasons';
import * as series from '@/lib/api-handlers/series';
import { setWorkspaceFeature } from '@/lib/api-handlers/workspace';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import {
  relinkIdentitiesAfterCompetitorWrite,
  sweepIdentitiesAfterCompetitorDelete,
} from '@/lib/competitor-identity-after-write';
import * as schema from '@/lib/db/schema';
import { serializeOrgMetadata } from '@/lib/features';
import { DIRECTORY_CACHE_TAG, publishedCacheTag } from '@/lib/published-cache';

const DATABASE_URL = process.env.DATABASE_URL;
const ACTOR = 'usr_public_cache_purge';

function sampleSeries(id: string, name = `Series ${id.slice(0, 8)}`) {
  return {
    id,
    name,
    venue: 'HYC',
    startDate: '2026-04-01',
    endDate: '',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: Date.now(),
    lastSavedAt: null,
    lastModifiedAt: Date.now(),
    scoringMode: 'handicap' as const,
    discardThresholds: [],
    dnfScoring: 'seriesEntries' as const,
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    publishRatingCalculations: true,
    enabledCompetitorFields: ['boatName', 'club'],
    primaryPersonLabel: 'helm' as const,
    subdivisionAxes: [],
  };
}

describe.skipIf(!DATABASE_URL)('writers purge the public cache', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  const created: string[] = [];
  const vercel = process.env.VERCEL;

  /** A fresh club workspace with its own context, so purges from one case
   *  can't be mistaken for another's. */
  async function newWorkspace(
    features: WorkspaceContext['features'] = [],
    ownFeatures: string[] = [],
  ): Promise<WorkspaceContext> {
    const workspaceId = `org_purge_${uuid().replace(/-/g, '')}`;
    created.push(workspaceId);
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Purge Club',
      slug: `purge-${workspaceId.slice(10, 22)}`,
      metadata: serializeOrgMetadata({
        kind: 'club',
        enabledFeatures: ownFeatures as never,
        disabledFeatures: [],
        seededFeatureSamples: [],
      }),
      createdAt: new Date(),
    });
    return {
      userId: ACTOR,
      email: 'purge@sailscoring.test',
      workspaceId,
      workspaceSlug: 'purge',
      role: 'owner',
      features,
    };
  }

  async function newSeries(ctx: WorkspaceContext): Promise<string> {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));
    return id;
  }

  async function publish(ctx: WorkspaceContext, seriesId: string): Promise<void> {
    await db.insert(schema.publishedSeries).values({
      id: uuid(),
      workspaceId: ctx.workspaceId,
      seriesId,
      slug: `s-${seriesId.slice(0, 8)}`,
      pages: [],
      contentHash: 'x',
      publishedVersion: 1,
    });
  }

  function expectPurged(ctx: WorkspaceContext) {
    expect(deleteByTag).toHaveBeenCalledWith([
      publishedCacheTag(ctx.workspaceId),
      DIRECTORY_CACHE_TAG,
    ]);
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    await db.insert(schema.user).values({
      id: ACTOR,
      name: 'Scorer',
      email: 'purge@sailscoring.test',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();
  });

  beforeEach(() => {
    process.env.VERCEL = '1';
    deleteByTag.mockReset();
  });

  afterEach(() => {
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
  });

  afterAll(async () => {
    for (const id of created) {
      await db.delete(schema.organization).where(eq(schema.organization.id, id));
    }
    await db.delete(schema.user).where(eq(schema.user.id, ACTOR));
    await sql?.end();
  });

  test('seasons: creating one and choosing the current one', async () => {
    const ctx = await newWorkspace();
    await seasons.createSeason(ctx, { label: '2026' });
    expectPurged(ctx);
    deleteByTag.mockReset();
    await seasons.setCurrentSeason(ctx, { label: '2026' });
    expectPurged(ctx);
  });

  test('the workspace logo', async () => {
    const ctx = await newWorkspace(['logo-library']);
    await setWorkspaceLogo(ctx, { logo: 'https://logos.sailscoring.ie/club.png' });
    expectPurged(ctx);
  });

  test('a feature toggle, but only when it changes something', async () => {
    const ctx = await newWorkspace();
    await setWorkspaceFeature(ctx, { feature: 'csv-finish-import', enabled: true });
    expectPurged(ctx);
    deleteByTag.mockReset();
    await setWorkspaceFeature(ctx, { feature: 'csv-finish-import', enabled: true });
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  test('a series edit purges only once the series is published', async () => {
    const ctx = await newWorkspace();
    const id = await newSeries(ctx);
    await series.putSeries(ctx, id, sampleSeries(id, 'Renamed before publishing'));
    expect(deleteByTag).not.toHaveBeenCalled();

    await publish(ctx, id);
    await series.putSeries(ctx, id, sampleSeries(id, 'Renamed after publishing'));
    expectPurged(ctx);
  });

  test("a published series' placement, order and deletion", async () => {
    const ctx = await newWorkspace();
    const id = await newSeries(ctx);
    await publish(ctx, id);

    deleteByTag.mockReset();
    await series.setSeriesCategory(ctx, id, { categoryId: null });
    expectPurged(ctx);

    deleteByTag.mockReset();
    await series.reorderSeries(ctx, { orderedIds: [id] });
    expectPurged(ctx);

    deleteByTag.mockReset();
    await series.setSeriesArchived(ctx, id, { archived: true });
    expectPurged(ctx);

    deleteByTag.mockReset();
    await series.deleteSeries(ctx, id);
    expectPurged(ctx);
  });

  test('reordering series with nothing published purges nothing', async () => {
    const ctx = await newWorkspace();
    const id = await newSeries(ctx);
    await series.reorderSeries(ctx, { orderedIds: [id] });
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  test('categories, once there is something published', async () => {
    const ctx = await newWorkspace();
    await publish(ctx, await newSeries(ctx));
    const category = await categories.createCategory(ctx, { name: 'Dinghies' });

    deleteByTag.mockReset();
    await categories.renameCategory(ctx, category.id, { name: 'Dinghy racing' });
    expectPurged(ctx);

    deleteByTag.mockReset();
    await categories.reorderCategories(ctx, { orderedIds: [category.id] });
    expectPurged(ctx);

    deleteByTag.mockReset();
    await categories.deleteCategory(ctx, category.id);
    expectPurged(ctx);
  });

  test('rankings: editing and deleting, not creating a private one', async () => {
    const ctx = await newWorkspace(['rankings']);
    const ranking = await createRanking(ctx, { name: 'Season Ladder' });
    expect(deleteByTag).not.toHaveBeenCalled();

    await putRanking(ctx, ranking.id, {
      name: 'Season Ladder',
      config: {
        buckets: [{ id: 'b1', name: 'All', seriesIds: [], countBest: 1, requiredMin: 1 }],
      },
      published: true,
    });
    expectPurged(ctx);

    deleteByTag.mockReset();
    await deleteRanking(ctx, ranking.id);
    expectPurged(ctx);
  });

  test('identities: the first ones appear, and the last ones go', async () => {
    const ctx = await newWorkspace([], ['competitor-identity']);
    const seriesId = uuid();
    await db.insert(schema.series).values({
      id: seriesId,
      workspaceId: ctx.workspaceId,
      name: 'Identity Series',
      startDate: '2026-05-01',
      displayOrder: 0,
    });
    const addCompetitor = async (name: string, sailNumber: string) => {
      const id = uuid();
      await db.insert(schema.competitors).values({
        id,
        seriesId,
        workspaceId: ctx.workspaceId,
        fleetIds: [],
        sailNumber,
        names: [name],
        clubs: [],
        gender: '',
        age: null,
      });
      return id;
    };

    await addCompetitor('Holly Cantwell', 'IRL1641');
    await relinkIdentitiesAfterCompetitorWrite(ctx.workspaceId);
    expectPurged(ctx);

    // A second sailor is one more identity, not the first: the listing's
    // competitors link was already there.
    deleteByTag.mockReset();
    await addCompetitor('Aoife Murphy', 'IRL1200');
    await relinkIdentitiesAfterCompetitorWrite(ctx.workspaceId);
    expect(deleteByTag).not.toHaveBeenCalled();

    await db.delete(schema.competitors).where(eq(schema.competitors.seriesId, seriesId));
    await sweepIdentitiesAfterCompetitorDelete(ctx.workspaceId);
    expectPurged(ctx);
  });
});
