// @vitest-environment node

/**
 * What a series save reports it changed (#580). One endpoint writes the whole
 * series row, so these drive the real handler and read the activity feed back:
 * an edit must name the facet it moved, a scoring change must not be folded
 * into an unrelated one and hidden, and a save that changes nothing must leave
 * no trace at all. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import { getActivityFeed } from '@/lib/api-handlers/activity';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const ACTOR = 'usr_series_change_actor';

function uuid() {
  return crypto.randomUUID();
}

function ctxFor(workspaceId: string): WorkspaceContext {
  return {
    userId: ACTOR,
    email: 'series-change-scorer@sailscoring.test',
    workspaceId,
    workspaceSlug: 'test-ws',
    role: 'owner',
    features: [],
  };
}

function sampleSeries(id: string) {
  return {
    id,
    name: `Series ${id.slice(0, 8)}`,
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

describe.skipIf(skip)('what a series save says it changed (#580)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspace: string;
  let ctx: WorkspaceContext;

  async function feed(seriesId: string) {
    const params = new URLSearchParams();
    params.set('seriesId', seriesId);
    const { items } = await getActivityFeed(ctx, params);
    return items;
  }

  /** A created series, ready to be edited. */
  async function newSeries() {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));
    return id;
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspace = `org_chg_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspace,
      name: 'Series change',
      slug: `chgw-${workspace.slice(8, 18)}`,
      createdAt: new Date(),
    });
    await db.insert(schema.user).values({
      id: ACTOR,
      name: 'Scorer',
      email: 'series-change-scorer@sailscoring.test',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ctx = ctxFor(workspace);
  });

  afterAll(async () => {
    if (workspace) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspace));
    }
    await db.delete(schema.user).where(eq(schema.user.id, ACTOR));
    await sql?.end();
  });

  test('a scoring change is recorded as one', async () => {
    const id = await newSeries();
    await series.putSeries(ctx, id, {
      ...sampleSeries(id),
      discardThresholds: [{ minRaces: 5, discardCount: 1 }],
    });

    const items = await feed(id);
    expect(items[0].action).toBe('series.scoring-updated');
    expect(items[0].summary).toBe('Changed the discard profile');
  });

  test('a rename is recorded as a rename, with the new name', async () => {
    const id = await newSeries();
    await series.putSeries(ctx, id, { ...sampleSeries(id), name: 'Winter League' });

    const items = await feed(id);
    expect(items[0].action).toBe('series.renamed');
    expect(items[0].summary).toBe('Renamed the series to “Winter League”');
  });

  test('a publish note does not swallow a scoring change', async () => {
    const id = await newSeries();
    await series.putSeries(ctx, id, {
      ...sampleSeries(id),
      dnfScoring: 'startingArea' as const,
    });
    await series.putSeries(ctx, id, {
      ...sampleSeries(id),
      dnfScoring: 'startingArea' as const,
      seriesNote: 'Corrected 16:40',
    });

    // Two facets, two entries — coalescing is per facet, so the scoring change
    // is still there to be read after the note edit lands on top of it.
    const summaries = (await feed(id)).map((i) => i.summary);
    expect(summaries).toContain('Changed how a boat that did not finish is scored');
    expect(summaries).toContain('Edited the note on the published pages');
  });

  test('repeated edits to one facet still coalesce', async () => {
    const id = await newSeries();
    await series.putSeries(ctx, id, { ...sampleSeries(id), venue: 'RIYC' });
    await series.putSeries(ctx, id, { ...sampleSeries(id), venue: 'RStGYC' });

    const venueEntries = (await feed(id)).filter(
      (i) => i.summary === 'Updated the venue and event details',
    );
    expect(venueEntries).toHaveLength(1);
    expect(venueEntries[0].count).toBe(2);
  });

  test('a save that changes nothing is not an edit', async () => {
    const id = await newSeries();
    const before = await series.getSeries(ctx, id);
    const returned = await series.putSeries(ctx, id, sampleSeries(id));

    // No version bump: that token is what the "N edits since you published"
    // indicators subtract, and nothing was edited.
    expect(returned.version).toBe(before.version);
    expect((await series.getSeries(ctx, id)).version).toBe(before.version);

    // And nothing beyond the creation itself in the feed.
    expect((await feed(id)).map((i) => i.action)).toEqual(['series.created']);
  });
});
