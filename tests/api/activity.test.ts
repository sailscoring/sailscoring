// @vitest-environment node

/**
 * Activity log wiring (#153). Drives the real /api/v1 handlers with a
 * synthesised WorkspaceContext (as tests/api/handlers.test.ts does) and reads
 * the result back through the activity read endpoint — proving the handlers
 * emit the right actions and that per-row finish writes coalesce. Skipped when
 * DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as races from '@/lib/api-handlers/races';
import * as finishes from '@/lib/api-handlers/finishes';
import { getActivityFeed, getRecentActivity } from '@/lib/api-handlers/activity';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

const ACTOR = 'usr_activity_test_actor';

function ctxFor(workspaceId: string): WorkspaceContext {
  return {
    userId: ACTOR,
    email: 'scorer@sailscoring.test',
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

async function feed(ctx: WorkspaceContext, seriesId: string) {
  const params = new URLSearchParams();
  params.set('seriesId', seriesId);
  return getActivityFeed(ctx, params);
}

describe.skipIf(skip)('activity log wiring (#153)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspace: string;
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspace = `org_act_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspace,
      name: 'Activity wiring',
      slug: `actw-${workspace.slice(8, 18)}`,
      createdAt: new Date(),
    });
    await db.insert(schema.user).values({
      id: ACTOR,
      name: 'Scorer',
      email: 'scorer@sailscoring.test',
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

  test('series create then edit logs created + (coalesced) updated', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));
    await series.putSeries(ctx, id, { ...sampleSeries(id), name: 'Renamed' });
    await series.putSeries(ctx, id, { ...sampleSeries(id), name: 'Renamed twice' });

    const { items } = await feed(ctx, id);
    const actions = items.map((i) => i.action);
    expect(actions).toContain('series.created');
    // The two edits coalesce into a single series.updated entry.
    expect(actions.filter((a) => a === 'series.updated')).toHaveLength(1);
    const created = items.find((i) => i.action === 'series.created');
    expect(created?.actor).toMatchObject({ id: ACTOR, displayName: 'Scorer' });

    await series.setSeriesArchived(ctx, id, { archived: true });
    await series.deleteSeries(ctx, id);
  });

  test('per-row finish writes coalesce into one finishes.recorded entry', async () => {
    const seriesId = uuid();
    await series.putSeries(ctx, seriesId, sampleSeries(seriesId));
    const raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId,
      seriesId,
      raceNumber: 1,
      date: '2026-04-01',
      createdAt: Date.now(),
    });

    for (let i = 0; i < 3; i++) {
      const finishId = uuid();
      await finishes.putFinish(ctx, raceId, finishId, {
        id: finishId,
        raceId,
        competitorId: null,
        unknownSailNumber: `IRL${100 + i}`,
        sortOrder: i,
        tiedWithPrevious: false,
        resultCode: null,
        startPresent: true,
        penaltyCode: null,
        penaltyOverride: null,
        redressMethod: null,
        redressExcludeRaceIds: null,
        redressIncludeRaceIds: null,
        redressIncludeAllLater: false,
        redressPoints: null,
        version: 1,
      });
    }

    const { items } = await feed(ctx, seriesId);
    const recorded = items.filter((i) => i.action === 'finishes.recorded');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].count).toBe(3);
    expect(recorded[0].summary).toBe('Recorded finishes for Race 1');
    expect(items.some((i) => i.action === 'race.added')).toBe(true);

    // Recency: the most recent entry for this series is the finish recording.
    const { items: recent } = await getRecentActivity(ctx);
    const latest = recent.find((e) => e.seriesId === seriesId);
    expect(latest?.action).toBe('finishes.recorded');

    await series.setSeriesArchived(ctx, seriesId, { archived: true });
    await series.deleteSeries(ctx, seriesId);
  });

  test('reordering races renumbers them and logs races.reordered', async () => {
    const seriesId = uuid();
    await series.putSeries(ctx, seriesId, sampleSeries(seriesId));
    const r1 = uuid();
    const r2 = uuid();
    for (const [id, n, date] of [[r1, 1, '2026-04-01'], [r2, 2, '2026-04-08']] as const) {
      await races.putRace(ctx, seriesId, id, { id, seriesId, raceNumber: n, date, createdAt: Date.now() });
    }

    const reordered = await races.reorderRaces(ctx, seriesId, { orderedIds: [r2, r1] });
    expect(reordered.map((r) => [r.id, r.raceNumber])).toEqual([[r2, 1], [r1, 2]]);

    const { items } = await feed(ctx, seriesId);
    expect(items.some((i) => i.action === 'races.reordered')).toBe(true);

    await series.setSeriesArchived(ctx, seriesId, { archived: true });
    await series.deleteSeries(ctx, seriesId);
  });
});
