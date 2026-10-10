// @vitest-environment node

/**
 * Integration tests for the two functions that write a round's stage races:
 * `commitSplitRound` — the assignment ceremony, which creates the round's
 * fleets, memberships and first races — and `addStageRaces`, which adds a
 * race to a round that already exists.
 *
 * The shape those races take is their finish-sheet layout: the fleets of one
 * stage race either share a race (they cross one line onto one handwritten
 * sheet) or get a race each (their finishes come back separately, as
 * electronic timing records them). A request can say which; otherwise a race
 * takes the layout the championship's races have used so far. Scoring can't tell the
 * difference — `tests/split-fleets.test.ts` proves that — so these tests are
 * about the rows the ceremony writes.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';

vi.mock('@/lib/auth/require-workspace', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/auth/require-workspace')>();
  return { ...original, requireWorkspace: vi.fn() };
});

import * as competitors from '@/lib/api-handlers/competitors';
import * as finishes from '@/lib/api-handlers/finishes';
import * as series from '@/lib/api-handlers/series';
import {
  addStageRaces,
  applySplitOverride,
  commitSplitRound,
  deleteSplitFleetConfig,
  getSplitFleetState,
  putSplitFleetConfig,
  putSplitFleetState,
  setSplitFleetBoats,
} from '@/lib/api-handlers/split-fleets';
import { defaultSplitFleetConfig } from '@/lib/split-fleets';
import { requireWorkspace } from '@/lib/auth/require-workspace';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

const uuid = () => crypto.randomUUID();

const FLEETS = [
  { label: 'Yellow', color: '#f5c518' },
  { label: 'Blue', color: '#1e6fd9' },
  { label: 'Red', color: '#d93025' },
];

describe.skipIf(skip)('commitSplitRound race shape', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_qfr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Split rounds',
      slug: `qfr-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'test-user',
      email: 'test@sailscoring.test',
      workspaceId,
      workspaceSlug: 'qfr-ws',
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

  /** A series with no split-fleet format and nothing else in it. */
  async function seedPlainSeries(name: string) {
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
    return seriesId;
  }

  /** A nine-boat series configured for three fleets, ready to be split. */
  async function seedSeries(name = 'Worlds') {
    const seriesId = await seedPlainSeries(name);

    const competitorIds: string[] = [];
    for (let i = 1; i <= 9; i++) {
      const competitorId = uuid();
      await competitors.putCompetitor(ctx, seriesId, competitorId, {
        id: competitorId, seriesId, fleetIds: [],
        sailNumber: `IRL ${i}`, names: [`Helm ${i}`], clubs: [],
        gender: '' as const, age: null, createdAt: Date.now(),
      });
      competitorIds.push(competitorId);
    }

    await putSplitFleetState(ctx, seriesId, {
      config: defaultSplitFleetConfig(3),
      rounds: [],
    });
    return { seriesId, competitorIds };
  }

  /** Commit a qualifying round covering the given stage race numbers. */
  async function commit(
    seriesId: string,
    competitorIds: string[],
    stageRaceNumbers: number[],
    deleteFleetIds: string[] = [],
    finishSheets?: 'combined' | 'per-fleet',
  ) {
    return commitSplitRound(ctx, seriesId, {
      stage: 'qualifying',
      fromStageRace: 1,
      method: 'rank-pattern',
      basis: null,
      fleets: FLEETS,
      assignments: Object.fromEntries(competitorIds.map((id, i) => [id, i % 3])),
      overrideCompetitorIds: [],
      stageRaceNumbers,
      ...(finishSheets ? { finishSheets } : {}),
      date: '2026-08-24',
      deleteFleetIds,
    });
  }

  /** A pre-ceremony fleet every competitor belongs to — what an entry-list
   *  CSV import leaves behind as "Default". */
  async function addLeftoverFleet(
    seriesId: string,
    competitorIds: string[],
    name = 'Default',
  ) {
    const fleetId = uuid();
    await db.insert(schema.fleets).values({
      id: fleetId,
      seriesId,
      workspaceId,
      name,
      displayOrder: 0,
      scoringSystem: 'scratch',
    });
    await db
      .update(schema.competitors)
      .set({ fleetIds: [fleetId] })
      .where(inArray(schema.competitors.id, competitorIds));
    return fleetId;
  }

  /** The races the ceremony wrote, each with its starts' fleets. */
  async function racesWithStarts(seriesId: string) {
    const races = await db
      .select({ id: schema.races.id, name: schema.races.name, raceNumber: schema.races.raceNumber })
      .from(schema.races)
      .where(eq(schema.races.seriesId, seriesId))
      .orderBy(schema.races.raceNumber);
    if (races.length === 0) return [];
    const starts = await db
      .select({
        raceId: schema.raceStarts.raceId,
        fleetIds: schema.raceStarts.fleetIds,
        stageRaceNumber: schema.raceStarts.stageRaceNumber,
      })
      .from(schema.raceStarts)
      .where(inArray(schema.raceStarts.raceId, races.map((r) => r.id)));
    return races.map((r) => ({
      ...r,
      starts: starts.filter((s) => s.raceId === r.id),
    }));
  }

  test('combined: one race per stage race number, a start per fleet', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    await commit(seriesId, competitorIds, [1, 2]);

    const races = await racesWithStarts(seriesId);
    expect(races).toHaveLength(2);
    for (const race of races) {
      expect(race.starts).toHaveLength(3);
      // Every start names exactly one fleet; together they are the round's three.
      expect(race.starts.every((s) => s.fleetIds.length === 1)).toBe(true);
      expect(new Set(race.starts.map((s) => s.stageRaceNumber)).size).toBe(1);
    }
    // One race covers all three fleets, so its name doesn't single one out.
    expect(races[0].name).not.toContain('Yellow');
  });

  test('records each fleet in the colour the ceremony gave it', async () => {
    // The colour is the fleet's own from here on: a medal fleet's is named in
    // no config list, so dropping it here leaves the published page untinted.
    const { seriesId, competitorIds } = await seedSeries();
    await commit(seriesId, competitorIds, [1]);

    const rows = await db
      .select({ name: schema.fleets.name, color: schema.fleets.color })
      .from(schema.fleets)
      .where(eq(schema.fleets.seriesId, seriesId))
      .orderBy(schema.fleets.displayOrder);
    expect(rows).toEqual(FLEETS.map((f) => ({ name: f.label, color: f.color })));
  });

  test('per-fleet: a race each, named for its fleet, sharing the stage race number', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    await commit(seriesId, competitorIds, [1, 2], [], 'per-fleet');

    const races = await racesWithStarts(seriesId);
    expect(races).toHaveLength(6);
    expect(races.every((r) => r.starts.length === 1)).toBe(true);

    // Two stage races, each held by the three fleets — which is what makes a
    // logical race complete, however many race rows it took.
    const byNumber = new Map<number, string[]>();
    for (const race of races) {
      const n = race.starts[0].stageRaceNumber!;
      byNumber.set(n, [...(byNumber.get(n) ?? []), race.name ?? '']);
    }
    expect([...byNumber.keys()].sort()).toEqual([1, 2]);
    for (const names of byNumber.values()) {
      expect(names).toHaveLength(3);
      expect(names.some((n) => n.includes('Yellow'))).toBe(true);
      expect(names.some((n) => n.includes('Blue'))).toBe(true);
      expect(names.some((n) => n.includes('Red'))).toBe(true);
    }
  });

  test('with nothing said, a championship\'s first races share a sheet', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    await commit(seriesId, competitorIds, [1]);
    const races = await racesWithStarts(seriesId);
    expect(races).toHaveLength(1);
    expect(races[0].starts).toHaveLength(3);
  });

  // A race added with nothing said takes the layout the championship's races
  // have used so far.

  test('per-fleet: a race added later is a race per fleet too', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const round = await commit(seriesId, competitorIds, [1], [], 'per-fleet');

    await addStageRaces(ctx, seriesId, round.id, {
      stageRaceNumbers: [2],
      date: '2026-08-25',
    });

    const races = await racesWithStarts(seriesId);
    expect(races).toHaveLength(6);
    expect(races.every((r) => r.starts.length === 1)).toBe(true);
    expect(races.filter((r) => r.starts[0].stageRaceNumber === 2)).toHaveLength(3);
  });

  test('combined: a race added later still carries every fleet', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const round = await commit(seriesId, competitorIds, [1]);

    await addStageRaces(ctx, seriesId, round.id, {
      stageRaceNumbers: [2],
      date: '2026-08-25',
    });

    const races = await racesWithStarts(seriesId);
    expect(races).toHaveLength(2);
    expect(races[1].starts).toHaveLength(3);
  });

  test('per-fleet: a whole sequence added at once becomes a race per start', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const round = await commit(seriesId, competitorIds, [1], [], 'per-fleet');

    // The final stage's "next race for every fleet" button: explicit starts,
    // each fleet at its own next number.
    await addStageRaces(ctx, seriesId, round.id, {
      starts: round.fleetIds.map((fleetId) => ({ fleetId, stageRaceNumber: 2 })),
      date: '2026-08-25',
    });

    const races = await racesWithStarts(seriesId);
    expect(races.filter((r) => r.starts[0].stageRaceNumber === 2)).toHaveLength(3);
  });

  // The ceremony can also shed non-round fleets the scorer agreed to delete
  // (deleteFleetIds): the leftover "Default" from an entry-list import, or a
  // converted series' pre-championship fleets. Memberships are stripped and
  // the rows deleted in the same transaction; anything unsafe is refused
  // whole rather than skipped.

  test('ceremony deletes the agreed non-round fleets, memberships and all', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const leftoverId = await addLeftoverFleet(seriesId, competitorIds);

    const round = await commit(seriesId, competitorIds, [1], [leftoverId]);

    const fleets = await db
      .select({ id: schema.fleets.id })
      .from(schema.fleets)
      .where(eq(schema.fleets.seriesId, seriesId));
    expect(fleets.map((f) => f.id)).not.toContain(leftoverId);
    expect(fleets).toHaveLength(3);

    // Every boat now belongs to exactly her round fleet — no dangling ids.
    const comps = await db
      .select({ fleetIds: schema.competitors.fleetIds })
      .from(schema.competitors)
      .where(eq(schema.competitors.seriesId, seriesId));
    expect(comps).toHaveLength(9);
    for (const c of comps) {
      expect(c.fleetIds).toHaveLength(1);
      expect(round.fleetIds).toContain(c.fleetIds[0]);
    }
  });

  test('refuses to delete a round-owned fleet, and the whole commit rolls back', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const round1 = await commit(seriesId, competitorIds, [1]);

    await expect(
      commitSplitRound(ctx, seriesId, {
        stage: 'final',
        fromStageRace: 1,
        method: 'split',
        basis: null,
        fleets: FLEETS,
        assignments: Object.fromEntries(competitorIds.map((id, i) => [id, i % 3])),
        overrideCompetitorIds: [],
        stageRaceNumbers: [],
        date: '2026-08-27',
        deleteFleetIds: [round1.fleetIds[0]],
      }),
    ).rejects.toThrow('round-owned');

    // Rolled back: still just round 1's three fleets, no final fleets.
    const fleets = await db
      .select({ id: schema.fleets.id })
      .from(schema.fleets)
      .where(eq(schema.fleets.seriesId, seriesId));
    expect(fleets).toHaveLength(3);
  });

  test('refuses to delete a fleet a race start references', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const leftoverId = await addLeftoverFleet(seriesId, competitorIds);
    // A race sailed before the series became a championship.
    const raceId = uuid();
    await db.insert(schema.races).values({
      id: raceId,
      seriesId,
      workspaceId,
      raceNumber: 1,
      name: 'Race 1',
      date: '2026-08-20',
    });
    await db.insert(schema.raceStarts).values({
      id: uuid(),
      raceId,
      fleetIds: [leftoverId],
    });

    await expect(commit(seriesId, competitorIds, [1], [leftoverId])).rejects.toThrow(
      'race start',
    );
  });

  test('refuses a fleet the series does not have', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    await expect(commit(seriesId, competitorIds, [1], [uuid()])).rejects.toThrow();
  });

  test('a race can take the other layout from the races before it', async () => {
    // One stage can hold both: the first races sailed onto a handwritten
    // sheet, and the rest came back from electronic timing a fleet at a time.
    const { seriesId, competitorIds } = await seedSeries();
    const round = await commit(seriesId, competitorIds, [1]);
    await addStageRaces(ctx, seriesId, round.id, {
      stageRaceNumbers: [2],
      finishSheets: 'per-fleet',
      date: '2026-08-25',
    });

    const races = await racesWithStarts(seriesId);
    expect(races.filter((r) => r.starts[0].stageRaceNumber === 1)).toHaveLength(1);
    expect(races.filter((r) => r.starts[0].stageRaceNumber === 2)).toHaveLength(3);
  });

  // A series is a split-fleet championship from creation or not at all: the
  // format can be added only before any race exists, and taken off again
  // only before any round has been built on it.
  test('refuses the format on a series that has raced', async () => {
    const seriesId = await seedPlainSeries('Raced already');
    await db.insert(schema.races).values({
      id: uuid(),
      seriesId,
      workspaceId,
      raceNumber: 1,
      date: '2026-08-24',
    });
    await expect(putSplitFleetConfig(ctx, seriesId, defaultSplitFleetConfig(2))).rejects.toThrow(
      /has raced/,
    );
    expect((await getSplitFleetState(ctx, seriesId)).config).toBeNull();
  });

  // A championship nobody is cut from: no medal block, and so no medal
  // fleet to select.
  test('a championship with no medal stage selects no medal fleet', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const { medal: _medal, ...config } = defaultSplitFleetConfig(3);
    await putSplitFleetConfig(ctx, seriesId, config);
    expect((await getSplitFleetState(ctx, seriesId)).config).not.toHaveProperty('medal');
    await expect(
      commitSplitRound(ctx, seriesId, {
        stage: 'medal',
        fromStageRace: 1,
        method: 'medal-select',
        basis: null,
        fleets: [{ label: 'Medal', color: '#000' }],
        assignments: { [competitorIds[0]]: 0 },
        overrideCompetitorIds: [],
        stageRaceNumbers: [],
        date: '2026-08-24',
        deleteFleetIds: [],
      }),
    ).rejects.toThrow(/no medal stage/);
  });

  // Locks follow what has been sailed, not a global switch.
  test('the words settle once a race exists', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const config = defaultSplitFleetConfig(3);
    await putSplitFleetConfig(ctx, seriesId, { ...config, vocabulary: 'qualification-final' });
    await commit(seriesId, competitorIds, [1]);
    await expect(
      putSplitFleetConfig(ctx, seriesId, { ...config, vocabulary: 'opening-medal' }),
    ).rejects.toThrow(/words are settled/);
  });

  test('the fleet count settles with the first round, the rest stays live', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const config = defaultSplitFleetConfig(3);
    await commit(seriesId, competitorIds, []);
    await expect(
      putSplitFleetConfig(ctx, seriesId, { ...config, qualifyingFleets: config.qualifyingFleets.slice(0, 2) }),
    ).rejects.toThrow(/fleet count is settled/);
    // The discards and the medal stage are what an amended sailing
    // instruction changes mid-week.
    await putSplitFleetConfig(ctx, seriesId, {
      ...config,
      discardThresholds: [{ minRaces: 2, discardCount: 1 }],
      medal: { ...config.medal, multiplier: 1 },
    });
    expect((await getSplitFleetState(ctx, seriesId)).config?.medal?.multiplier).toBe(1);
  });

  test('dividing and undividing stay open until the split is committed', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const config = defaultSplitFleetConfig(3);
    await commit(seriesId, competitorIds, [1]);
    await putSplitFleetConfig(ctx, seriesId, { ...config, split: { kind: 'none' }, finalFleets: [] });
    await putSplitFleetConfig(ctx, seriesId, config);
  });

  test('the format comes off again until a round is committed', async () => {
    const { seriesId, competitorIds } = await seedSeries();
    const removed = await deleteSplitFleetConfig(ctx, seriesId);
    expect(removed.config).toBeNull();
    // Removing what isn't there is not an error: the wizard's radio can be
    // flipped back and forth.
    expect((await deleteSplitFleetConfig(ctx, seriesId)).config).toBeNull();

    await putSplitFleetConfig(ctx, seriesId, defaultSplitFleetConfig(3));
    await commit(seriesId, competitorIds, [1]);
    await expect(deleteSplitFleetConfig(ctx, seriesId)).rejects.toThrow(/fleets have been assigned/);
    expect((await getSplitFleetState(ctx, seriesId)).config).not.toBeNull();
  });

  /** Each entry's boats drawn per fleet, in the order given. */
  async function boatsOf(ids: string[]) {
    const rows = await db
      .select({ id: schema.competitors.id, boats: schema.competitors.fleetSailNumbers })
      .from(schema.competitors)
      .where(inArray(schema.competitors.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r.boats]));
    return ids.map((id) => byId.get(id) ?? null);
  }

  /** Each entry's fleet memberships, in the order given. */
  async function fleetsOf(ids: string[]) {
    const rows = await db
      .select({ id: schema.competitors.id, fleetIds: schema.competitors.fleetIds })
      .from(schema.competitors)
      .where(inArray(schema.competitors.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r.fleetIds]));
    return ids.map((id) => byId.get(id) ?? null);
  }

  describe('placing an entry by hand after the commit', () => {
    test('a move to another fleet of a qualifying round is recorded on the round', async () => {
      const { seriesId, competitorIds } = await seedSeries();
      const round = await commit(seriesId, competitorIds, []);
      const [yellow, blue] = round.fleetIds;
      // Entry 0 was dealt into Yellow.
      await applySplitOverride(ctx, seriesId, round.id, { competitorId: competitorIds[0], toFleetId: blue });
      expect(await fleetsOf([competitorIds[0]])).toEqual([[blue]]);
      const state = await getSplitFleetState(ctx, seriesId);
      expect(state.rounds[0].overrides).toEqual({ [competitorIds[0]]: blue });
      expect(yellow).not.toBe(blue);
    });

    test('an entry in no fleet of the round is placed in one', async () => {
      const { seriesId, competitorIds } = await seedSeries();
      const round = await commit(seriesId, competitorIds, []);
      const lateId = uuid();
      await competitors.putCompetitor(ctx, seriesId, lateId, {
        id: lateId, seriesId, fleetIds: [],
        sailNumber: 'IRL 10', names: ['Late Entry'], clubs: [],
        gender: '' as const, age: null, createdAt: Date.now(),
      });
      await applySplitOverride(ctx, seriesId, round.id, { competitorId: lateId, toFleetId: round.fleetIds[2] });
      expect(await fleetsOf([lateId])).toEqual([[round.fleetIds[2]]]);
    });

    test('refuses an entry the series does not have', async () => {
      const { seriesId, competitorIds } = await seedSeries();
      const round = await commit(seriesId, competitorIds, []);
      await expect(
        applySplitOverride(ctx, seriesId, round.id, { competitorId: uuid(), toFleetId: round.fleetIds[0] }),
      ).rejects.toThrow(/competitor/);
    });

    /** Finishes in crossing order on a race's sheet. */
    async function finish(raceId: string, competitorIds: string[]) {
      for (const [i, competitorId] of competitorIds.entries()) {
        const id = uuid();
        await finishes.putFinish(ctx, raceId, id, {
          id, raceId, competitorId, sortOrder: i + 1,
          tiedWithPrevious: false, resultCode: null, startPresent: null,
          penaltyCode: null, penaltyOverride: null, redressMethod: null,
          redressExcludeRaceIds: null, redressIncludeRaceIds: null,
          redressIncludeAllLater: false, redressPoints: null,
        });
      }
    }

    test('before anything is sailed a move carries no warning', async () => {
      const { seriesId, competitorIds } = await seedSeries();
      const round = await commit(seriesId, competitorIds, [1]);
      const res = await applySplitOverride(ctx, seriesId, round.id, {
        competitorId: competitorIds[0],
        toFleetId: round.fleetIds[1],
      });
      expect(res.warning).toBeNull();
    });

    test('on one combined sheet, a move after racing re-ranks her result in her new fleet', async () => {
      const { seriesId, competitorIds } = await seedSeries();
      const round = await commit(seriesId, competitorIds, [1], [], 'combined');
      const [q1] = await racesWithStarts(seriesId);
      await finish(q1.id, competitorIds.slice(0, 6));
      const res = await applySplitOverride(ctx, seriesId, round.id, {
        competitorId: competitorIds[0],
        toFleetId: round.fleetIds[1],
      });
      expect(res.warning).toBe(
        'Racing in this round has started, and the change applies to the qualifying races ' +
          'it has already sailed. IRL 1 is now scored in Blue.',
      );
    });

    test("with a sheet per fleet, a move after racing names the results it strands and the DNCs it makes", async () => {
      const { seriesId, competitorIds } = await seedSeries();
      const round = await commit(seriesId, competitorIds, [1, 2], [], 'per-fleet');
      const [yellow, blue] = round.fleetIds;
      const races = await racesWithStarts(seriesId);
      const raceOf = (fleetId: string, n: number) =>
        races.find((r) => r.starts.some((st) => st.fleetIds.includes(fleetId) && st.stageRaceNumber === n))!;
      // Q1 sailed by both fleets, IRL 1 in Yellow's; Q2 by Blue only so far.
      await finish(raceOf(yellow, 1).id, [competitorIds[0], competitorIds[3]]);
      await finish(raceOf(blue, 1).id, [competitorIds[1], competitorIds[4]]);
      await finish(raceOf(blue, 2).id, [competitorIds[4], competitorIds[1]]);
      const res = await applySplitOverride(ctx, seriesId, round.id, {
        competitorId: competitorIds[0],
        toFleetId: blue,
      });
      expect(res.warning).toBe(
        'Racing in this round has started, and the change applies to the qualifying races ' +
          "it has already sailed. IRL 1 is now scored in Blue. Her result in Q1 is on another " +
          "fleet's sheet and no longer counts. She is not on Blue's sheet in Q1, Q2, so scores " +
          'DNC there until she is added.',
      );
    });

    test('a boat is refused where the championship does not draw them', async () => {
      const { seriesId, competitorIds } = await seedSeries();
      const round = await commit(seriesId, competitorIds, []);
      await expect(
        applySplitOverride(ctx, seriesId, round.id, {
          competitorId: competitorIds[0],
          toFleetId: round.fleetIds[1],
          boat: '401',
        }),
      ).rejects.toThrow(/does not draw boats/);
    });
  });

  describe('boats drawn per fleet', () => {
    test('a commit draws boats for the fleet each entry is placed in, shared across fleets', async () => {
      const { seriesId, competitorIds } = await seedSeries();
      await putSplitFleetConfig(ctx, seriesId, { ...defaultSplitFleetConfig(3), boatAssignments: true });
      const round = await commitSplitRound(ctx, seriesId, {
        stage: 'qualifying',
        fromStageRace: 1,
        method: 'rank-pattern',
        fleets: FLEETS,
        assignments: Object.fromEntries(competitorIds.map((id, i) => [id, i % 3])),
        // Entries 0, 1, 2 are in Yellow, Blue and Red: all three sail boat 401.
        boats: { [competitorIds[0]]: '401', [competitorIds[1]]: '401', [competitorIds[2]]: ' 401 ' },
      });
      const [yellow, blue, red] = round.fleetIds;
      expect(await boatsOf(competitorIds.slice(0, 4))).toEqual([
        { [yellow]: '401' },
        { [blue]: '401' },
        { [red]: '401' },
        null,
      ]);
      expect((await getSplitFleetState(ctx, seriesId)).config?.boatAssignments).toBe(true);
    });

    test('fleets sharing drawn boats race apart, whatever sheet layout is asked for', async () => {
      const { seriesId, competitorIds } = await seedSeries();
      await putSplitFleetConfig(ctx, seriesId, { ...defaultSplitFleetConfig(3), boatAssignments: true });
      const round = await commit(seriesId, competitorIds, [1], [], 'combined');
      await addStageRaces(ctx, seriesId, round.id, { stageRaceNumbers: [2], finishSheets: 'combined' });
      const races = await racesWithStarts(seriesId);
      // Three fleets, two stage races: a race each.
      expect(races).toHaveLength(6);
      expect(races.every((r) => r.starts.length === 1)).toBe(true);
    });

    test('a commit refuses one boat drawn twice within a fleet', async () => {
      const { seriesId, competitorIds } = await seedSeries();
      await expect(
        commitSplitRound(ctx, seriesId, {
          stage: 'qualifying',
          fromStageRace: 1,
          method: 'rank-pattern',
          fleets: FLEETS,
          assignments: Object.fromEntries(competitorIds.map((id, i) => [id, i % 3])),
          boats: { [competitorIds[0]]: '401', [competitorIds[3]]: '401' },
        }),
      ).rejects.toThrow(/Yellow: boat 401 is drawn for more than one entry/);
    });

    test("a fleet's boats are drawn, changed and cleared after the commit", async () => {
      const { seriesId, competitorIds } = await seedSeries();
      const round = await commit(seriesId, competitorIds, []);
      const [yellow] = round.fleetIds;
      // Yellow holds entries 0, 3 and 6.
      await setSplitFleetBoats(ctx, seriesId, round.id, {
        fleetId: yellow,
        boats: { [competitorIds[0]]: '401', [competitorIds[3]]: '402', [competitorIds[6]]: '403' },
      });
      // A spare replaces 403, and entry 0's boat is cleared.
      await setSplitFleetBoats(ctx, seriesId, round.id, {
        fleetId: yellow,
        boats: { [competitorIds[6]]: '409', [competitorIds[0]]: null },
      });
      expect(await boatsOf([competitorIds[0], competitorIds[3], competitorIds[6]])).toEqual([
        null,
        { [yellow]: '402' },
        { [yellow]: '409' },
      ]);
    });

    test("a fleet's boats refuse a duplicate and an entry from another fleet", async () => {
      const { seriesId, competitorIds } = await seedSeries();
      const round = await commit(seriesId, competitorIds, []);
      const [yellow] = round.fleetIds;
      await setSplitFleetBoats(ctx, seriesId, round.id, {
        fleetId: yellow,
        boats: { [competitorIds[0]]: '401' },
      });
      await expect(
        setSplitFleetBoats(ctx, seriesId, round.id, {
          fleetId: yellow,
          boats: { [competitorIds[3]]: '401' },
        }),
      ).rejects.toThrow(/boat 401 is drawn for more than one entry/);
      await expect(
        setSplitFleetBoats(ctx, seriesId, round.id, {
          fleetId: yellow,
          boats: { [competitorIds[1]]: '405' },
        }),
      ).rejects.toThrow(/not in this fleet/);
    });

    /** A three-fleet round with boats drawn: entries 0, 3, 6 in Yellow on
     *  401–403; 1, 4, 7 in Blue and 2, 5, 8 in Red, on the same boats. */
    async function drawnRound() {
      const { seriesId, competitorIds } = await seedSeries();
      await putSplitFleetConfig(ctx, seriesId, { ...defaultSplitFleetConfig(3), boatAssignments: true });
      const round = await commitSplitRound(ctx, seriesId, {
        stage: 'qualifying',
        fromStageRace: 1,
        method: 'manual',
        fleets: FLEETS,
        assignments: Object.fromEntries(competitorIds.map((id, i) => [id, i % 3])),
        boats: Object.fromEntries(competitorIds.map((id, i) => [id, String(401 + Math.floor(i / 3))])),
      });
      return { seriesId, competitorIds, round };
    }

    test('a move leaves her boat behind and draws the one given in the fleet she joins', async () => {
      const { seriesId, competitorIds, round } = await drawnRound();
      const [yellow, blue] = round.fleetIds;
      await applySplitOverride(ctx, seriesId, round.id, {
        competitorId: competitorIds[0],
        toFleetId: blue,
        boat: ' 409 ',
      });
      expect(await fleetsOf([competitorIds[0]])).toEqual([[blue]]);
      expect(await boatsOf([competitorIds[0]])).toEqual([{ [blue]: '409' }]);
      // Moved back with no boat given, she has none drawn there yet: the
      // Yellow boat she left does not come back with her.
      await applySplitOverride(ctx, seriesId, round.id, { competitorId: competitorIds[0], toFleetId: yellow });
      expect(await boatsOf([competitorIds[0]])).toEqual([null]);
    });

    test("a move refuses a boat another entry of the fleet holds, and changes nothing", async () => {
      const { seriesId, competitorIds, round } = await drawnRound();
      const [yellow, blue] = round.fleetIds;
      await expect(
        applySplitOverride(ctx, seriesId, round.id, {
          competitorId: competitorIds[0],
          toFleetId: blue,
          boat: '401',
        }),
      ).rejects.toThrow(/Blue: boat 401 is already drawn for IRL 2/);
      expect(await fleetsOf([competitorIds[0]])).toEqual([[yellow]]);
      expect(await boatsOf([competitorIds[0]])).toEqual([{ [yellow]: '401' }]);
    });

    test('placing her in the fleet she is in redraws her boat there, and keeps it when none is given', async () => {
      const { seriesId, competitorIds, round } = await drawnRound();
      const [yellow] = round.fleetIds;
      await applySplitOverride(ctx, seriesId, round.id, { competitorId: competitorIds[0], toFleetId: yellow });
      expect(await boatsOf([competitorIds[0]])).toEqual([{ [yellow]: '401' }]);
      await applySplitOverride(ctx, seriesId, round.id, {
        competitorId: competitorIds[0],
        toFleetId: yellow,
        boat: '410',
      });
      expect(await boatsOf([competitorIds[0]])).toEqual([{ [yellow]: '410' }]);
      await applySplitOverride(ctx, seriesId, round.id, {
        competitorId: competitorIds[0],
        toFleetId: yellow,
        boat: null,
      });
      expect(await boatsOf([competitorIds[0]])).toEqual([null]);
    });
  });
});
