// @vitest-environment node

/**
 * Publish bookkeeping is written quietly (#575): the fields land, and the
 * series is not treated as edited. The version counter stays where it was —
 * it is what the "N edits since you last published" indicators count, and
 * these very fields feed those indicators — `lastModifiedAt` stays put, and
 * nothing reaches the activity feed or the revision history.
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
import { listActivity } from '@/lib/activity-log';
import { listRevisions } from '@/lib/revision-log';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('series publish prefs', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;

  async function makeSeries(name: string): Promise<string> {
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
    return id;
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_pp_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Publish Prefs',
      slug: `pp-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'pp-user',
      email: 'pp@sailscoring.test',
      workspaceId,
      workspaceSlug: `pp-${workspaceId.slice(8, 18)}`,
      role: 'owner',
      features: [],
    };
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('writes the named fields and leaves the rest of the row alone', async () => {
    const id = await makeSeries('Prefs Series');
    const serverId = uuid();
    const saved = await series.setSeriesPublishPrefs(ctx, id, {
      publishMode: 'ftp',
      ftpServerId: serverId,
      ftpHost: 'results.hyc.ie',
    });

    expect(saved.publishMode).toBe('ftp');
    expect(saved.ftpServerId).toBe(serverId);
    expect(saved.ftpHost).toBe('results.hyc.ie');
    // Untouched by a write that named neither.
    expect(saved.name).toBe('Prefs Series');
    expect(saved.ftpPaths).toEqual({});
  });

  test('does not count as an edit to the series', async () => {
    const id = await makeSeries('Version Series');
    const before = (await series.getSeries(ctx, id))!;

    await series.setSeriesPublishPrefs(ctx, id, { publishMode: 'ftp' });
    await series.setSeriesPublishPrefs(ctx, id, { ftpHost: 'results.hyc.ie' });

    const after = (await series.getSeries(ctx, id))!;
    // The trap this guards: the version is the token the publish indicators
    // subtract to count unpublished edits, so a bump here reports edits the
    // scorer never made — from nothing but opening a dialog.
    expect(after.version).toBe(before.version);
    expect(after.lastModifiedAt).toBe(before.lastModifiedAt);
  });

  test('leaves no activity entry and no revision', async () => {
    const id = await makeSeries('Quiet Series');

    await series.setSeriesPublishPrefs(ctx, id, {
      publishMode: 'ftp',
      ftpServerId: uuid(),
      ftpHost: 'results.hyc.ie',
    });

    const { items } = await listActivity({
      workspaceId,
      seriesId: id,
      page: { limit: 50, cursor: null },
    });
    // Creating the series is the only thing that happened to it — no
    // `series.updated`, which is what surfaced as "Updated series settings"
    // when this write went through the general PUT.
    expect(items.map((i) => i.action)).toEqual(['series.created']);
    // And nothing named it in the history either. Asserted on the summaries
    // rather than a count: the creation's own revision is captured after the
    // response flushes, so its arrival races a count taken here.
    const revisions = await listRevisions(ctx, id);
    expect(revisions.map((r) => r.summary)).not.toContain('Updated series settings');
  });

  test('works on a finalised series — publishing one is allowed', async () => {
    const id = await makeSeries('Final Series');
    await series.setSeriesResultsStatus(ctx, id, { status: 'final' });

    // The general PUT refuses a finalised series, which is why this write
    // can't go through it: the results can still be published, so recording
    // where they went has to work too.
    const saved = await series.setSeriesPublishPrefs(ctx, id, {
      ftpHost: 'results.hyc.ie',
    });
    expect(saved.ftpHost).toBe('results.hyc.ie');
  });

  test('a missing series is a 404, not a silent no-op', async () => {
    await expect(
      series.setSeriesPublishPrefs(ctx, uuid(), { publishMode: 'ftp' }),
    ).rejects.toThrow();
  });
});
