// @vitest-environment node

/**
 * Integration tests for `putSplitFleetState` / `PUT
 * /api/v1/series/:id/split-fleets/state` (#365) — the endpoint the in-app
 * file open/update replays a `.sailscoring` file's split-fleet block through,
 * because that replay runs in the browser.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';

vi.mock('@/lib/auth/require-workspace', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/auth/require-workspace')>();
  return { ...original, requireWorkspace: vi.fn() };
});

import * as competitors from '@/lib/api-handlers/competitors';
import * as fleets from '@/lib/api-handlers/fleets';
import * as series from '@/lib/api-handlers/series';
import { getSplitFleetState, putSplitFleetState } from '@/lib/api-handlers/split-fleets';
import { ArchivedError, NotFoundError } from '@/app/api/v1/_lib/handler';
import { defaultSplitFleetConfig } from '@/lib/split-fleets';
import { requireWorkspace } from '@/lib/auth/require-workspace';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

function uuid() {
  return crypto.randomUUID();
}

const CONFIG = defaultSplitFleetConfig(2);

describe.skipIf(skip)('split-fleet state replay (#365)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_qfs_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Split state',
      slug: `qfs-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'test-user',
      email: 'test@sailscoring.test',
      workspaceId,
      workspaceSlug: 'qfs-ws',
      role: 'owner',
      features: [],
    };
    mockedRequire.mockResolvedValue(ctx);
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  /** A two-fleet, two-boat series — the shape a championship file replays as
   *  once its fleets and competitors have been written. */
  async function seedSeries(name: string) {
    const seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId,
      name,
      venue: 'Dun Laoghaire',
      startDate: '2026-08-23',
      endDate: '2026-08-30',
      venueLogoUrl: '',
      eventLogoUrl: '',
      venueUrl: '',
      eventUrl: '',
      createdAt: Date.now(),
      lastSavedAt: null,
      lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [],
      dnfScoring: 'startingArea' as const,
      ftpHost: '',
      ftpPath: '',
      ftpPaths: {},
      includeJsonExport: true,
      publishRatingCalculations: true,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const,
      subdivisionAxes: [],
    });
    const fleetIds: string[] = [];
    for (const [i, fleetName] of ['Yellow', 'Blue'].entries()) {
      const fleetId = uuid();
      await fleets.putFleet(ctx, seriesId, fleetId, {
        id: fleetId, seriesId, name: fleetName, displayOrder: i,
        scoringSystem: 'scratch' as const,
      });
      fleetIds.push(fleetId);
    }
    const competitorIds: string[] = [];
    for (const sail of ['IRL1', 'IRL2']) {
      const competitorId = uuid();
      await competitors.putCompetitor(ctx, seriesId, competitorId, {
        id: competitorId, seriesId, fleetIds: [fleetIds[0]],
        sailNumber: sail, names: [`Helm ${sail}`], club: '',
        gender: '' as const, age: null, createdAt: Date.now(),
      });
      competitorIds.push(competitorId);
    }
    return { seriesId, fleetIds, competitorIds };
  }

  function round(fleetIds: string[], overrides?: Record<string, string>) {
    return {
      id: uuid(),
      stage: 'qualifying' as const,
      fromStageRace: 1,
      fleetIds,
      method: 'seeded',
      basis: null,
      ...(overrides ? { overrides } : {}),
      createdAt: Date.now(),
    };
  }

  test('writes the config and rounds, and stamps round ownership on the fleets', async () => {
    const { seriesId, fleetIds, competitorIds } = await seedSeries('Worlds');
    const r = round(fleetIds, { [competitorIds[0]]: fleetIds[1] });

    await putSplitFleetState(ctx, seriesId, { config: CONFIG, rounds: [r] });

    const state = await getSplitFleetState(ctx, seriesId);
    expect(state.config).toEqual(CONFIG);
    expect(state.rounds).toHaveLength(1);
    expect(state.rounds[0].id).toBe(r.id);
    expect(state.rounds[0].fleetIds).toEqual(fleetIds);

    const [row] = await db
      .select({ overrides: schema.splitRounds.overrides })
      .from(schema.splitRounds)
      .where(eq(schema.splitRounds.id, r.id));
    expect(row.overrides).toEqual({ [competitorIds[0]]: fleetIds[1] });

    // The file's fleets carry no round marker — it's derived from the round's
    // fleet list, or the Split Fleets tab has nothing to group by.
    const stamped = await db
      .select({ id: schema.fleets.id, splitRoundId: schema.fleets.splitRoundId })
      .from(schema.fleets)
      .where(eq(schema.fleets.seriesId, seriesId));
    expect(stamped.every((f) => f.splitRoundId === r.id)).toBe(true);
  });

  test('replaces the previous rounds wholesale, and clears on an empty replay', async () => {
    const { seriesId, fleetIds } = await seedSeries('Nationals');
    const first = round(fleetIds);
    await putSplitFleetState(ctx, seriesId, { config: CONFIG, rounds: [first] });

    const second = round(fleetIds);
    await putSplitFleetState(ctx, seriesId, { config: CONFIG, rounds: [second] });
    const replaced = await getSplitFleetState(ctx, seriesId);
    expect(replaced.rounds.map((x) => x.id)).toEqual([second.id]);

    // What a file carrying no split-fleet block replays as.
    await putSplitFleetState(ctx, seriesId, { config: null, rounds: [] });
    const cleared = await getSplitFleetState(ctx, seriesId);
    expect(cleared.config).toBeNull();
    expect(cleared.rounds).toEqual([]);
  });

  test('drops ids that are not in the series, and rounds left with no fleets', async () => {
    const { seriesId, fleetIds, competitorIds } = await seedSeries('Regionals');
    const kept = round([fleetIds[0], uuid()], {
      // kept; moved to a fleet outside the round's own list, which is legal
      [competitorIds[0]]: fleetIds[1],
      // dropped: fleet not in the series
      [competitorIds[1]]: uuid(),
      // dropped: competitor not in the series
      [uuid()]: fleetIds[1],
    });
    const dropped = round([uuid()]);

    await putSplitFleetState(ctx, seriesId, { config: CONFIG, rounds: [kept, dropped] });

    const state = await getSplitFleetState(ctx, seriesId);
    expect(state.rounds.map((r) => r.id)).toEqual([kept.id]);
    expect(state.rounds[0].fleetIds).toEqual([fleetIds[0]]);

    const [row] = await db
      .select({ overrides: schema.splitRounds.overrides })
      .from(schema.splitRounds)
      .where(eq(schema.splitRounds.id, kept.id));
    expect(row.overrides).toEqual({ [competitorIds[0]]: fleetIds[1] });
  });

  test('the published stamp on a round can be set and cleared', async () => {
    // The Split Fleets page badges a round "Published" from this column, and
    // unpublishing has to take the badge down with the pages — otherwise a
    // round reads Published with nothing behind it.
    const { seriesId, fleetIds } = await seedSeries('Stamp');
    const r = round(fleetIds);
    await putSplitFleetState(ctx, seriesId, { config: CONFIG, rounds: [r] });

    const { createRepos } = await import('@/lib/postgres-repository');
    const rounds = createRepos({ workspaceId: ctx.workspaceId }).splitRounds;

    await rounds.setPublishedAt(r.id, Date.now());
    expect((await rounds.listBySeries(seriesId))[0].publishedAt).toBeTruthy();

    await rounds.setPublishedAt(r.id, null);
    expect((await rounds.listBySeries(seriesId))[0].publishedAt).toBeFalsy();
  });

  test('refuses a series in another workspace and an archived one', async () => {
    await expect(
      putSplitFleetState(ctx, uuid(), { config: CONFIG, rounds: [] }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const { seriesId, fleetIds } = await seedSeries('Frostbite');
    await db
      .update(schema.series)
      .set({ archived: true })
      .where(and(eq(schema.series.id, seriesId), eq(schema.series.workspaceId, workspaceId)));
    await expect(
      putSplitFleetState(ctx, seriesId, { config: CONFIG, rounds: [round(fleetIds)] }),
    ).rejects.toBeInstanceOf(ArchivedError);
  });
});
