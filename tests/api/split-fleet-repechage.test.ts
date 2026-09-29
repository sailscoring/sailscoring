// @vitest-environment node

/**
 * Integration tests for the repêchage: the round that holds it, who may sail
 * it, promotions from it (or from the ranking the boats were cut from) into
 * the medal fleet, and the guards that keep the three consistent.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';

vi.mock('@/lib/auth/require-workspace', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/auth/require-workspace')>();
  return { ...original, requireWorkspace: vi.fn() };
});

import * as competitors from '@/lib/api-handlers/competitors';
import * as series from '@/lib/api-handlers/series';
import {
  addStageRaces,
  applySplitOverride,
  commitSplitRound,
  deleteSplitRound,
  getSplitFleetState,
  promoteIntoMedalFleet,
  putSplitFleetConfig,
  putSplitFleetState,
  withdrawPromotion,
} from '@/lib/api-handlers/split-fleets';
import { defaultSplitFleetConfig, type SplitFleetConfig } from '@/lib/split-fleets';
import { requireWorkspace } from '@/lib/auth/require-workspace';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

const uuid = () => crypto.randomUUID();

/** Two qualifying flights, never divided, a four-boat Final Series that
 *  carries nothing: the Champions' Cups in miniature. */
const CHAMPIONS_CUP: SplitFleetConfig = {
  ...defaultSplitFleetConfig(2),
  finalFleets: [],
  split: { kind: 'none' },
  discardThresholds: [],
  medal: { size: 4, multiplier: 1, carry: 'nothing', tieBreak: 'medal-race-then-a8' },
};

describe.skipIf(skip)('the repêchage', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_qfp_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Repechage',
      slug: `qfp-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'test-user',
      email: 'test@sailscoring.test',
      workspaceId,
      workspaceSlug: 'qfp-ws',
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

  async function seedSeries(config: SplitFleetConfig) {
    const seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId,
      name: 'Champions Cup',
      venue: 'Dun Laoghaire',
      startDate: '2026-10-03',
      endDate: '2026-10-04',
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
    const ids: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const competitorId = uuid();
      await competitors.putCompetitor(ctx, seriesId, competitorId, {
        id: competitorId, seriesId, fleetIds: [],
        sailNumber: `IRL ${i}`, names: [`Helm ${i}`], clubs: [],
        gender: '' as const, age: null, createdAt: Date.now() + i,
      });
      ids.push(competitorId);
    }
    await putSplitFleetState(ctx, seriesId, { config, rounds: [] });
    return { seriesId, ids };
  }

  function round(
    stage: 'qualifying' | 'final' | 'medal' | 'repechage',
    fleets: string[],
    assignments: Record<string, number>,
    stageRaceNumbers: number[] = [],
  ) {
    return {
      stage,
      fromStageRace: 1,
      method: stage === 'qualifying' ? 'seeded' : stage === 'final' ? 'split' : stage === 'medal' ? 'medal-select' : 'manual',
      basis: null,
      fleets: fleets.map((label) => ({ label, color: '#000' })),
      assignments,
      overrideCompetitorIds: [],
      stageRaceNumbers,
      finishSheets: 'combined' as const,
      date: '2026-10-04',
      deleteFleetIds: [],
    };
  }

  /** Flights A (boats 1-4) and B (5-8); boats 1 and 5 selected directly. */
  async function selected() {
    const { seriesId, ids } = await seedSeries(CHAMPIONS_CUP);
    await commitSplitRound(
      ctx,
      seriesId,
      round('qualifying', ['A', 'B'], Object.fromEntries(ids.map((id, i) => [id, i < 4 ? 0 : 1]))),
    );
    const medal = await commitSplitRound(ctx, seriesId, round('medal', ['Final'], { [ids[0]]: 0, [ids[4]]: 0 }));
    return { seriesId, ids, medal };
  }

  async function fleetIdsOf(id: string) {
    const [row] = await db
      .select({ fleetIds: schema.competitors.fleetIds })
      .from(schema.competitors)
      .where(eq(schema.competitors.id, id));
    return row.fleetIds;
  }

  test('comes after the medal fleet is selected, and only once', async () => {
    const { seriesId, ids } = await seedSeries(CHAMPIONS_CUP);
    await commitSplitRound(
      ctx,
      seriesId,
      round('qualifying', ['A', 'B'], Object.fromEntries(ids.map((id, i) => [id, i < 4 ? 0 : 1]))),
    );
    await expect(
      commitSplitRound(ctx, seriesId, round('repechage', ['Repêchage'], { [ids[1]]: 0 })),
    ).rejects.toThrow(/select the medal fleet before the repêchage/);

    await commitSplitRound(ctx, seriesId, round('medal', ['Final'], { [ids[0]]: 0, [ids[4]]: 0 }));
    await commitSplitRound(ctx, seriesId, round('repechage', ['Repêchage'], { [ids[1]]: 0 }));
    await expect(
      commitSplitRound(ctx, seriesId, round('repechage', ['Repêchage'], { [ids[2]]: 0 })),
    ).rejects.toThrow(/already has a repêchage/);
  });

  test('refuses a boat already in the medal fleet', async () => {
    const { seriesId, ids } = await selected();
    await expect(
      commitSplitRound(ctx, seriesId, round('repechage', ['Repêchage'], { [ids[0]]: 0, [ids[1]]: 0 })),
    ).rejects.toThrow(/IRL 1 is already in the medal fleet/);
  });

  test('sails its fleets on one sheet, labelled R, with no companion offset after a promotion', async () => {
    const { seriesId, ids } = await selected();
    const rep = await commitSplitRound(
      ctx,
      seriesId,
      round('repechage', ['Rep A', 'Rep B'], { [ids[1]]: 0, [ids[2]]: 0, [ids[5]]: 1, [ids[6]]: 1 }, [1]),
    );
    await promoteIntoMedalFleet(ctx, seriesId, { competitorIds: [ids[1]], reason: 'repechage' });
    await addStageRaces(ctx, seriesId, rep.id, { stageRaceNumbers: [2], date: '2026-10-04' });

    const starts = await db
      .select({
        name: schema.races.name,
        stage: schema.raceStarts.stage,
        n: schema.raceStarts.stageRaceNumber,
        offset: schema.raceStarts.firstPlaceOffset,
      })
      .from(schema.raceStarts)
      .innerJoin(schema.races, eq(schema.races.id, schema.raceStarts.raceId))
      .where(eq(schema.races.seriesId, seriesId));
    expect(starts).toHaveLength(4);
    expect(new Set(starts.map((s) => s.stage))).toEqual(new Set(['repechage']));
    expect(new Set(starts.map((s) => s.name?.split(' ')[0]))).toEqual(new Set(['R1', 'R2']));
    expect(starts.every((s) => !s.offset)).toBe(true);
  });

  test('keeps its membership by hand until a boat is promoted from it', async () => {
    const { seriesId, ids } = await selected();
    const rep = await commitSplitRound(ctx, seriesId, round('repechage', ['Repêchage'], { [ids[1]]: 0 }));
    const [fleetId] = rep.fleetIds;

    await applySplitOverride(ctx, seriesId, rep.id, { competitorId: ids[5], toFleetId: fleetId });
    expect(await fleetIdsOf(ids[5])).toContain(fleetId);
    await applySplitOverride(ctx, seriesId, rep.id, { competitorId: ids[5], toFleetId: null });
    expect(await fleetIdsOf(ids[5])).not.toContain(fleetId);
    await expect(
      applySplitOverride(ctx, seriesId, rep.id, { competitorId: ids[0], toFleetId: fleetId }),
    ).rejects.toThrow(/already in the medal fleet/);
    // A hand-kept list, not an override on a computed assignment.
    expect((await getSplitFleetState(ctx, seriesId)).rounds.find((r) => r.id === rep.id)!.overrides).toBeUndefined();

    await promoteIntoMedalFleet(ctx, seriesId, { competitorIds: [ids[1]], reason: 'repechage' });
    await expect(
      applySplitOverride(ctx, seriesId, rep.id, { competitorId: ids[6], toFleetId: fleetId }),
    ).rejects.toThrow(/promoted from the repêchage/);
  });

  test('promotes into the medal fleet with the reason, and takes a promotion back', async () => {
    const { seriesId, ids, medal } = await selected();
    const [medalFleetId] = medal.fleetIds;
    await commitSplitRound(ctx, seriesId, round('repechage', ['Repêchage'], { [ids[1]]: 0, [ids[5]]: 0 }));

    await expect(
      promoteIntoMedalFleet(ctx, seriesId, { competitorIds: [ids[2]], reason: 'repechage' }),
    ).rejects.toThrow(/IRL 3 did not sail the repêchage/);
    await expect(
      promoteIntoMedalFleet(ctx, seriesId, { competitorIds: [ids[0]], reason: 'cut-ranking' }),
    ).rejects.toThrow(/already in the medal fleet/);

    const res = await promoteIntoMedalFleet(ctx, seriesId, { competitorIds: [ids[1], ids[5]], reason: 'repechage' });
    expect(res.warning).toBeNull();
    await promoteIntoMedalFleet(ctx, seriesId, { competitorIds: [ids[2]], reason: 'cut-ranking' });
    const state = await getSplitFleetState(ctx, seriesId);
    const medalRound = state.rounds.find((r) => r.stage === 'medal')!;
    expect(medalRound.overrideReasons).toEqual({
      [ids[1]]: 'repechage',
      [ids[5]]: 'repechage',
      [ids[2]]: 'cut-ranking',
    });
    expect(await fleetIdsOf(ids[1])).toContain(medalFleetId);

    await withdrawPromotion(ctx, seriesId, ids[5]);
    expect(await fleetIdsOf(ids[5])).not.toContain(medalFleetId);
    const after = (await getSplitFleetState(ctx, seriesId)).rounds.find((r) => r.stage === 'medal')!;
    expect(after.overrideReasons).toEqual({ [ids[1]]: 'repechage', [ids[2]]: 'cut-ranking' });
    await expect(withdrawPromotion(ctx, seriesId, ids[0])).rejects.toThrow(/was not promoted/);
  });

  test('warns on a promotion once a companion race exists', async () => {
    const { seriesId, ids } = await selected();
    const qualifying = (await getSplitFleetState(ctx, seriesId)).rounds.find((r) => r.stage === 'qualifying')!;
    await addStageRaces(ctx, seriesId, qualifying.id, { stageRaceNumbers: [1], date: '2026-10-04' });
    const res = await promoteIntoMedalFleet(ctx, seriesId, { competitorIds: [ids[2]], reason: 'cut-ranking' });
    expect(res.warning).toMatch(/companion race/);
  });

  test('is deleted before the medal fleet, and not once a boat has been promoted from it', async () => {
    const { seriesId, ids, medal } = await selected();
    const rep = await commitSplitRound(ctx, seriesId, round('repechage', ['Repêchage'], { [ids[1]]: 0 }));
    await expect(deleteSplitRound(ctx, seriesId, medal.id)).rejects.toThrow(/delete the repêchage before/);
    await promoteIntoMedalFleet(ctx, seriesId, { competitorIds: [ids[1]], reason: 'repechage' });
    await expect(deleteSplitRound(ctx, seriesId, rep.id)).rejects.toThrow(/promoted from the repêchage/);

    await withdrawPromotion(ctx, seriesId, ids[1]);
    await deleteSplitRound(ctx, seriesId, rep.id);
    await deleteSplitRound(ctx, seriesId, medal.id);
    expect((await getSplitFleetState(ctx, seriesId)).rounds.map((r) => r.stage)).toEqual(['qualifying']);
  });

  describe('after Gold and Silver', () => {
    const GOLD_SILVER: SplitFleetConfig = {
      ...defaultSplitFleetConfig(2),
      qualifyingFleets: [{ label: 'Fleet', color: '#000' }],
      discardThresholds: [],
      medal: { size: 3, multiplier: 1, carry: 'nothing', tieBreak: 'medal-race-then-a8' },
    };

    /** Gold 1-4, Silver 5-8; boats 1 and 2 selected for the medal fleet. */
    async function split(config: SplitFleetConfig) {
      const { seriesId, ids } = await seedSeries(config);
      await commitSplitRound(ctx, seriesId, round('qualifying', ['Fleet'], Object.fromEntries(ids.map((id) => [id, 0]))));
      await commitSplitRound(
        ctx,
        seriesId,
        round('final', ['Gold', 'Silver'], Object.fromEntries(ids.map((id, i) => [id, i < 4 ? 0 : 1]))),
      );
      await commitSplitRound(ctx, seriesId, round('medal', ['Medal'], { [ids[0]]: 0, [ids[1]]: 0 }));
      return { seriesId, ids };
    }

    test('takes a Silver boat while the medal races carry nothing, then refuses a carry', async () => {
      const { seriesId, ids } = await split(GOLD_SILVER);
      await commitSplitRound(ctx, seriesId, round('repechage', ['Repêchage'], { [ids[2]]: 0, [ids[4]]: 0 }));
      await expect(
        putSplitFleetConfig(ctx, seriesId, { ...GOLD_SILVER, medal: { ...GOLD_SILVER.medal!, carry: 'halved' } }),
      ).rejects.toThrow(/cannot carry a score while IRL 5 is in the repêchage/);
    });

    test('refuses a Silver boat where the medal races carry a score', async () => {
      const halved = { ...GOLD_SILVER, medal: { ...GOLD_SILVER.medal!, carry: 'halved' as const } };
      const { seriesId, ids } = await split(halved);
      await expect(
        commitSplitRound(ctx, seriesId, round('repechage', ['Repêchage'], { [ids[2]]: 0, [ids[4]]: 0 })),
      ).rejects.toThrow(/IRL 5 cannot join the medal fleet/);
      await expect(
        promoteIntoMedalFleet(ctx, seriesId, { competitorIds: [ids[5]], reason: 'cut-ranking' }),
      ).rejects.toThrow(/IRL 6 cannot join the medal fleet/);
      await commitSplitRound(ctx, seriesId, round('repechage', ['Repêchage'], { [ids[2]]: 0, [ids[3]]: 0 }));
    });
  });
});
