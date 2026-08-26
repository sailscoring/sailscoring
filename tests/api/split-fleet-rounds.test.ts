// @vitest-environment node

/**
 * Integration tests for the two functions that write a round's stage races:
 * `commitSplitRound` — the assignment ceremony, which creates the round's
 * fleets, memberships and first races — and `addStageRaces`, which adds a
 * race to a round that already exists.
 *
 * The shape those races take is `SplitFleetConfig.finishSheets`: the fleets
 * of one stage race either share a race (they cross one line onto one
 * handwritten sheet) or get a race each (their finishes come back
 * separately, as electronic timing records them). Scoring can't tell the
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
import * as series from '@/lib/api-handlers/series';
import {
  addStageRaces,
  commitSplitRound,
  putSplitFleetConfig,
  putSplitFleetState,
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

  /** A nine-boat series configured for three fleets, ready to be split. */
  async function seedSeries(finishSheets: 'combined' | 'per-fleet') {
    const seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId,
      name: `Worlds ${finishSheets}`,
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

    const competitorIds: string[] = [];
    for (let i = 1; i <= 9; i++) {
      const competitorId = uuid();
      await competitors.putCompetitor(ctx, seriesId, competitorId, {
        id: competitorId, seriesId, fleetIds: [],
        sailNumber: `IRL ${i}`, names: [`Helm ${i}`], club: '',
        gender: '' as const, age: null, createdAt: Date.now(),
      });
      competitorIds.push(competitorId);
    }

    await putSplitFleetState(ctx, seriesId, {
      config: { ...defaultSplitFleetConfig(3), finishSheets },
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
    const { seriesId, competitorIds } = await seedSeries('combined');
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

  test('per-fleet: a race each, named for its fleet, sharing the stage race number', async () => {
    const { seriesId, competitorIds } = await seedSeries('per-fleet');
    await commit(seriesId, competitorIds, [1, 2]);

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

  test('a config written before per-fleet races existed still means combined', async () => {
    const { seriesId, competitorIds } = await seedSeries('combined');
    // Overwrite the stored config with what an older build would have
    // written: the same settings, with no finishSheets field at all.
    const older = { ...defaultSplitFleetConfig(3) } as Record<string, unknown>;
    delete older.finishSheets;
    await db
      .update(schema.series)
      .set({ qfConfig: older as never })
      .where(eq(schema.series.id, seriesId));

    await commit(seriesId, competitorIds, [1]);
    const races = await racesWithStarts(seriesId);
    expect(races).toHaveLength(1);
    expect(races[0].starts).toHaveLength(3);
  });

  // A race added to a round that already exists has to take the same shape the
  // ceremony gave that round — the scorer chose the shape once, in the config.

  test('per-fleet: a race added later is a race per fleet too', async () => {
    const { seriesId, competitorIds } = await seedSeries('per-fleet');
    const round = await commit(seriesId, competitorIds, [1]);

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
    const { seriesId, competitorIds } = await seedSeries('combined');
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
    const { seriesId, competitorIds } = await seedSeries('per-fleet');
    const round = await commit(seriesId, competitorIds, [1]);

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
    const { seriesId, competitorIds } = await seedSeries('combined');
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
    const { seriesId, competitorIds } = await seedSeries('combined');
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
    const { seriesId, competitorIds } = await seedSeries('combined');
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
    const { seriesId, competitorIds } = await seedSeries('combined');
    await expect(commit(seriesId, competitorIds, [1], [uuid()])).rejects.toThrow();
  });

  test('switching to per-fleet before racing changes the shape of the next race', async () => {
    // The reported path: fleets assigned while the sheets were combined, the
    // races that produced deleted, the setting changed, the races re-added.
    const { seriesId, competitorIds } = await seedSeries('combined');
    const round = await commit(seriesId, competitorIds, [1, 2]);
    await db.delete(schema.races).where(eq(schema.races.seriesId, seriesId));

    await putSplitFleetConfig(ctx, seriesId, {
      ...defaultSplitFleetConfig(3),
      finishSheets: 'per-fleet',
    });
    await addStageRaces(ctx, seriesId, round.id, {
      stageRaceNumbers: [1, 2],
      date: '2026-08-24',
    });

    const races = await racesWithStarts(seriesId);
    expect(races).toHaveLength(6);
    expect(races.every((r) => r.starts.length === 1)).toBe(true);
  });
});
