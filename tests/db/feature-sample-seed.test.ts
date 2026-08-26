// @vitest-environment node

/**
 * Integration test for `seedFeatureSample` — the on-enable feature demo seeding
 * (see `setWorkspaceFeature`). Focuses on the sub-series sample, since it is the
 * one that exercises the seed adapter's full sub-series persistence (fleet
 * scoping, per-fleet race exclusions, DNC handling, and the two-pass
 * `continueFrom` write). Skipped when DATABASE_URL is unset; runs against the
 * local/CI Postgres.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, inArray } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { seedFeatureSample } from '@/lib/sample-series/seed';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('seedFeatureSample', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_fsseed_${crypto.randomUUID().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Feature Sample Seed Test',
      slug: `f-${workspaceId.slice(11, 21)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('seeds the sub-series demo, grouped under a "Samples" category', async () => {
    const seeded = await seedFeatureSample('sub-series', workspaceId, db);
    expect(seeded).toBe(true);

    const [series] = await db
      .select()
      .from(schema.series)
      .where(
        and(
          eq(schema.series.workspaceId, workspaceId),
          eq(schema.series.name, 'Sample Club League 2026'),
        ),
      );
    expect(series).toBeDefined();

    const [cat] = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.workspaceId, workspaceId));
    expect(cat.name).toBe('Samples');
    expect(series.categoryId).toBe(cat.id);
  });

  test('persists the full sub-series shape the adapter used to drop', async () => {
    const [series] = await db
      .select({ id: schema.series.id })
      .from(schema.series)
      .where(
        and(
          eq(schema.series.workspaceId, workspaceId),
          eq(schema.series.name, 'Sample Club League 2026'),
        ),
      );

    const rows = await db
      .select()
      .from(schema.subSeries)
      .where(eq(schema.subSeries.seriesId, series.id))
      .orderBy(schema.subSeries.displayOrder);
    expect(rows.map((r) => r.name)).toEqual([
      'Season Overall',
      'Spring Series',
      'Summer Series',
      'Cruisers 1 Championship',
    ]);

    const spring = rows.find((r) => r.name === 'Spring Series')!;
    const summer = rows.find((r) => r.name === 'Summer Series')!;
    const champ = rows.find((r) => r.name === 'Cruisers 1 Championship')!;

    // Fleet scoping round-trips (one fleet id) on the championship only.
    expect(champ.fleetIds).toHaveLength(1);
    expect(summer.fleetIds).toBeNull();
    // excludeDncOnlyCompetitors round-trips: true on the blocks, false on Overall.
    expect(spring.excludeDncOnlyCompetitors).toBe(true);
    expect(rows.find((r) => r.name === 'Season Overall')!.excludeDncOnlyCompetitors).toBe(false);
    // The two-pass write patched continueFrom to Spring's *minted* id.
    expect(summer.startingHandicapSource).toBe('continue');
    expect(summer.continueFromSubSeriesId).toBe(spring.id);

    // The per-fleet race exclusion lands on the join row's excludedFleetIds.
    const membership = await db
      .select()
      .from(schema.subSeriesRaces)
      .where(inArray(schema.subSeriesRaces.subSeriesId, rows.map((r) => r.id)));
    const withExclusion = membership.filter((m) => (m.excludedFleetIds ?? []).length > 0);
    expect(withExclusion).toHaveLength(1);
    expect(withExclusion[0].subSeriesId).toBe(champ.id);
    expect(withExclusion[0].excludedFleetIds).toEqual(champ.fleetIds);
  });

  test('seeds the ORC demo with verbatim certificates and per-start options', async () => {
    const seeded = await seedFeatureSample('orc', workspaceId, db);
    expect(seeded).toBe(true);

    const [series] = await db
      .select()
      .from(schema.series)
      .where(
        and(
          eq(schema.series.workspaceId, workspaceId),
          eq(schema.series.name, 'Sample ORC Series 2026'),
        ),
      );
    expect(series).toBeDefined();

    // Every boat's certificate survives the jsonb round-trip whole — the
    // allowance matrix is what performance-curve scoring runs on.
    const compRows = await db
      .select()
      .from(schema.competitors)
      .where(eq(schema.competitors.seriesId, series.id));
    expect(compRows).toHaveLength(8);
    for (const c of compRows) {
      const allowances = c.orcCert?.record?.Allowances as { WindSpeeds?: unknown[] } | undefined;
      expect(Array.isArray(allowances?.WindSpeeds)).toBe(true);
    }

    // The per-race scoring options land on the starts: the fleet-default
    // race, the band, the constructed course (with its legs), and the W/L
    // curves race with the RC scoring wind.
    const raceRows = await db
      .select()
      .from(schema.races)
      .where(eq(schema.races.seriesId, series.id));
    expect(raceRows).toHaveLength(4);
    const startRows = await db
      .select()
      .from(schema.raceStarts)
      .where(inArray(schema.raceStarts.raceId, raceRows.map((r) => r.id)));
    expect(startRows).toHaveLength(4);
    const options = startRows.map((s) => s.orcOption);
    expect(options.filter((o) => o != null).sort()).toEqual(['CC', 'IRL_5B_WL_M_TOT', 'WL']);
    expect(options.filter((o) => o == null)).toHaveLength(1);
    const cc = startRows.find((s) => s.orcOption === 'CC')!;
    expect(cc.courseLegs).toHaveLength(7);
    const wl = startRows.find((s) => s.orcOption === 'WL')!;
    expect(wl.orcScoringWind).toBe(12);
  });

  test('returns false for a feature with no demo sample', async () => {
    const seeded = await seedFeatureSample('prizes', workspaceId, db);
    expect(seeded).toBe(false);
  });

  test('seeds the split-fleets championship demo with config, rounds, and round-owned fleets', async () => {
    const seeded = await seedFeatureSample('split-fleets', workspaceId, db);
    expect(seeded).toBe(true);

    const [series] = await db
      .select()
      .from(schema.series)
      .where(
        and(
          eq(schema.series.workspaceId, workspaceId),
          eq(schema.series.name, 'Sample Championship 2026'),
        ),
      );
    expect(series).toBeDefined();
    expect(series.qfConfig).toBeTruthy();
    expect(series.qfConfig!.qualifyingFleets.map((f) => f.label)).toEqual(['Yellow', 'Blue']);
    expect(series.qfConfig!.medal).toMatchObject({ size: 6, multiplier: 2 });

    // Four frozen rounds: seed, reassign, split, medal — with fresh fleet ids.
    const rounds = await db
      .select()
      .from(schema.splitRounds)
      .where(eq(schema.splitRounds.seriesId, series.id))
      .orderBy(schema.splitRounds.createdAt);
    expect(rounds.map((r) => r.stage)).toEqual(['qualifying', 'qualifying', 'final', 'medal']);
    expect(rounds.map((r) => r.method)).toEqual(['seeded', 'rank-pattern', 'split', 'medal-select']);

    // Every fleet is round-owned and stamped with its minted round id.
    const fleetRows = await db
      .select()
      .from(schema.fleets)
      .where(eq(schema.fleets.seriesId, series.id));
    // 2 qualifying + 2 reassigned + 2 final + the medal fleet, which the
    // ceremony deals on its own — nobody else moves.
    expect(fleetRows).toHaveLength(7);
    const roundIds = new Set(rounds.map((r) => r.id));
    for (const f of fleetRows) {
      expect(f.splitRoundId).toBeTruthy();
      expect(roundIds.has(f.splitRoundId!)).toBe(true);
    }
    for (const r of rounds) {
      const owned = fleetRows.filter((f) => f.splitRoundId === r.id).map((f) => f.id);
      expect(new Set(r.fleetIds)).toEqual(new Set(owned));
    }

    // A race is one start sequence: qualifying and final fleets share a race
    // per stage race number; the medal race runs on its own. The starts carry
    // the stage identity, and F3 — the one more race the boats who missed the
    // medal fleet sail — carries on its Gold start the offset that scores
    // that fleet below them.
    const raceRows = await db
      .select()
      .from(schema.races)
      .where(eq(schema.races.seriesId, series.id));
    expect(raceRows).toHaveLength(8); // Q1–Q4, F1–F3 combined; M1 alone
    const startRows = await db
      .select()
      .from(schema.raceStarts)
      .where(inArray(schema.raceStarts.raceId, raceRows.map((r) => r.id)));
    expect(startRows).toHaveLength(15); // 2 per Q/F sequence, 1 for the medal race
    expect(startRows.every((s) => s.stage !== null && s.stageRaceNumber !== null)).toBe(true);
    expect(startRows.filter((s) => s.stage === 'medal')).toHaveLength(1);
    // Only Gold's start: all six medal boats came from Gold, so Silver's F3
    // is scored from 1.
    expect(startRows.filter((s) => s.firstPlaceOffset === 6)).toHaveLength(1);
    // Sequenced guns, five minutes apart within a combined race.
    expect(startRows.every((s) => /^\d\d:\d\d:\d\d$/.test(s.startTime ?? ''))).toBe(true);
    // Every race carries a name and a last-finisher clock time (the
    // protest-time-limit input).
    expect(raceRows.every((r) => /^[QFM]\d+/.test(r.name ?? ''))).toBe(true);
    expect(raceRows.every((r) => /^\d\d:\d\d:\d\d$/.test(r.lastFinisherTime ?? ''))).toBe(true);
  });
});
