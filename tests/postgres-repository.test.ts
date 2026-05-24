// @vitest-environment node

/**
 * Integration tests for ADR-008 Phase 2 PR #3.
 *
 * Verifies that every method of `lib/postgres-repository.ts` round-trips
 * through Postgres with full fidelity, that workspace tenancy is enforced,
 * and that saves bump the version column. Skipped when DATABASE_URL is
 * unset; runs against the service container in integration-tests.yml.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import type {
  Competitor,
  Finish,
  Fleet,
  Race,
  RaceStart,
  Series,
} from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid(): string {
  return crypto.randomUUID();
}

function makeSeries(id: string = uuid()): Series {
  const now = Date.now();
  return {
    id,
    name: `Series ${id.slice(0, 8)}`,
    venue: 'HYC',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: now,
    lastSnapshotId: null,
    lastSavedAt: null,
    lastModifiedAt: now,
    snapshotHistory: [],
    scoringMode: 'handicap',
    discardThresholds: [{ minRaces: 4, discardCount: 1 }],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    bilgeBundle: null,
    includeJsonExport: true,
    publishRatingCalculations: true,
    enabledCompetitorFields: ['boatName', 'club'],
    primaryPersonLabel: 'helm',
    subdivisionLabel: 'Division',
  };
}

describe.skipIf(skip)('postgres repositories', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceA: string;
  let workspaceB: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceA = `org_a_${uuid().replace(/-/g, '')}`;
    workspaceB = `org_b_${uuid().replace(/-/g, '')}`;
    const now = new Date();
    await db.insert(schema.organization).values([
      { id: workspaceA, name: 'A', slug: `a-${workspaceA.slice(6, 16)}`, createdAt: now },
      { id: workspaceB, name: 'B', slug: `b-${workspaceB.slice(6, 16)}`, createdAt: now },
    ]);
  });

  afterAll(async () => {
    if (workspaceA)
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceA));
    if (workspaceB)
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceB));
    await sql?.end();
  });

  // ─── SeriesRepository ──────────────────────────────────────────────────────

  test('SeriesRepository.save inserts then updates and bumps version', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();

    const created = await repos.series.save(s);
    expect(created.id).toBe(s.id);
    const [row1] = await db
      .select()
      .from(schema.series)
      .where(eq(schema.series.id, s.id));
    expect(row1.version).toBe(1);

    // Mutate and save again — version should bump.
    await repos.series.save({ ...s, name: 'updated' });
    const [row2] = await db
      .select()
      .from(schema.series)
      .where(eq(schema.series.id, s.id));
    expect(row2.version).toBe(2);
    expect(row2.name).toBe('updated');

    await repos.series.delete(s.id);
  });

  test('SeriesRepository.list filters by workspace and is ordered newest-first', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const older = makeSeries();
    older.createdAt = Date.now() - 10_000;
    const newer = makeSeries();
    newer.createdAt = Date.now();
    await repos.series.save(older);
    await repos.series.save(newer);

    const list = await repos.series.list();
    const ids = list.map((s) => s.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));

    await repos.series.delete(older.id);
    await repos.series.delete(newer.id);
  });

  test('SeriesRepository.touch advances lastModifiedAt and bumps version', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();
    s.lastModifiedAt = Date.now() - 60_000;
    await repos.series.save(s);

    await repos.series.touch(s.id);

    const refreshed = await repos.series.get(s.id);
    expect(refreshed!.lastModifiedAt).toBeGreaterThan(s.lastModifiedAt);
    const [row] = await db
      .select({ version: schema.series.version })
      .from(schema.series)
      .where(eq(schema.series.id, s.id));
    expect(row.version).toBe(2);

    await repos.series.delete(s.id);
  });

  test('SeriesRepository: cross-workspace get returns undefined; list returns empty', async () => {
    const reposA = createRepos({ db, workspaceId: workspaceA });
    const reposB = createRepos({ db, workspaceId: workspaceB });
    const s = makeSeries();
    await reposA.series.save(s);

    expect(await reposB.series.get(s.id)).toBeUndefined();
    expect(await reposB.series.list()).toEqual([]);

    await reposA.series.delete(s.id);
  });

  test('SeriesRepository.delete in another workspace is a no-op', async () => {
    const reposA = createRepos({ db, workspaceId: workspaceA });
    const reposB = createRepos({ db, workspaceId: workspaceB });
    const s = makeSeries();
    await reposA.series.save(s);

    await reposB.series.delete(s.id);
    expect(await reposA.series.get(s.id)).toBeDefined();

    await reposA.series.delete(s.id);
  });

  // ─── FleetRepository ───────────────────────────────────────────────────────

  test('FleetRepository: round-trips echoAlpha for ECHO', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();
    await repos.series.save(s);

    const fleets: Fleet[] = [
      { id: uuid(), seriesId: s.id, name: 'Scratch', displayOrder: 0, scoringSystem: 'scratch' },
      { id: uuid(), seriesId: s.id, name: 'NHC', displayOrder: 1, scoringSystem: 'nhc' },
      { id: uuid(), seriesId: s.id, name: 'ECHO', displayOrder: 2, scoringSystem: 'echo', echoAlpha: 0.30 },
    ];
    for (const f of fleets) await repos.fleets.save(f);

    const list = await repos.fleets.listBySeries(s.id);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ name: 'Scratch', scoringSystem: 'scratch' });
    expect(list[1]).toMatchObject({ name: 'NHC', scoringSystem: 'nhc' });
    expect(list[1]).not.toHaveProperty('echoAlpha');
    expect(list[2]).toMatchObject({ name: 'ECHO', scoringSystem: 'echo', echoAlpha: 0.30 });

    await repos.fleets.deleteBySeries(s.id);
    expect(await repos.fleets.listBySeries(s.id)).toEqual([]);
    await repos.series.delete(s.id);
  });

  // ─── CompetitorRepository ──────────────────────────────────────────────────

  test('CompetitorRepository: optional fields, fleetIds[] round-trip; sorted by sail number', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();
    await repos.series.save(s);
    const fleetA = uuid();
    const fleetB = uuid();
    await repos.fleets.save({ id: fleetA, seriesId: s.id, name: 'A', displayOrder: 0, scoringSystem: 'irc' });
    await repos.fleets.save({ id: fleetB, seriesId: s.id, name: 'B', displayOrder: 1, scoringSystem: 'py' });

    const c1: Competitor = {
      id: uuid(), seriesId: s.id, fleetIds: [fleetA, fleetB],
      sailNumber: '1234',
      boatName: 'Big', boatClass: 'Half-Tonner',
      name: 'Helm', owner: 'Owner', helm: 'Helm',
      crewName: 'Crew', club: 'HYC', nationality: 'IRL', gender: 'M', age: 42,
      createdAt: Date.now(),
      ircTcc: 0.972, pyNumber: 1034,
      nhcStartingTcf: 0.95, echoStartingTcf: 0.97,
    };
    const c2: Competitor = {
      id: uuid(), seriesId: s.id, fleetIds: [fleetA],
      sailNumber: '0001', name: 'Other', club: '', gender: '', age: null,
      createdAt: Date.now(),
    };
    await repos.competitors.save(c1);
    await repos.competitors.save(c2);

    const list = await repos.competitors.listBySeries(s.id);
    expect(list.map((c) => c.sailNumber)).toEqual(['0001', '1234']);
    const c1Read = list.find((c) => c.id === c1.id)!;
    expect(c1Read).toMatchObject({
      fleetIds: [fleetA, fleetB],
      sailNumber: '1234',
      boatName: 'Big', boatClass: 'Half-Tonner',
      name: 'Helm', owner: 'Owner', helm: 'Helm',
      crewName: 'Crew', club: 'HYC', nationality: 'IRL', gender: 'M', age: 42,
      ircTcc: 0.972, pyNumber: 1034,
      nhcStartingTcf: 0.95, echoStartingTcf: 0.97,
    });
    // Optional fields absent on c2 should not appear as nulls in the typed shape.
    const c2Read = list.find((c) => c.id === c2.id)!;
    expect(c2Read.boatName).toBeUndefined();
    expect(c2Read.ircTcc).toBeUndefined();
    expect(c2Read.nationality).toBeUndefined();

    await repos.series.delete(s.id);
  });

  // ─── RaceRepository ────────────────────────────────────────────────────────

  test('RaceRepository: listBySeries is ordered by raceNumber', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();
    await repos.series.save(s);
    const r2: Race = { id: uuid(), seriesId: s.id, raceNumber: 2, date: '2026-04-08', createdAt: Date.now() };
    const r1: Race = { id: uuid(), seriesId: s.id, raceNumber: 1, date: '2026-04-01', createdAt: Date.now() };
    await repos.races.save(r2);
    await repos.races.save(r1);

    const list = await repos.races.listBySeries(s.id);
    expect(list.map((r) => r.raceNumber)).toEqual([1, 2]);

    await repos.series.delete(s.id);
  });

  // ─── RaceStartRepository / FinishRepository ────────────────────────────────

  test('RaceStart and Finish round-trip via parent-race tenancy check', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();
    await repos.series.save(s);
    const fleet = uuid();
    await repos.fleets.save({ id: fleet, seriesId: s.id, name: 'F', displayOrder: 0, scoringSystem: 'irc' });
    const competitor: Competitor = {
      id: uuid(), seriesId: s.id, fleetIds: [fleet],
      sailNumber: '1', name: 'Boat',
      club: '', gender: '', age: null, createdAt: Date.now(),
    };
    await repos.competitors.save(competitor);
    const race: Race = { id: uuid(), seriesId: s.id, raceNumber: 1, date: '2026-04-01', createdAt: Date.now() };
    await repos.races.save(race);

    const start: RaceStart = { id: uuid(), raceId: race.id, fleetIds: [fleet], startTime: '11:00:00' };
    await repos.raceStarts.save(start);

    expect(await repos.raceStarts.listByRace(race.id)).toEqual([{ ...start, version: 1 }]);
    expect((await repos.raceStarts.listByRaces([race.id]))[0]).toEqual({ ...start, version: 1 });

    const finish: Finish = {
      id: uuid(), raceId: race.id, competitorId: competitor.id,
      sortOrder: 1, finishTime: '12:00:00',
      resultCode: null, startPresent: true,
      penaltyCode: null, penaltyOverride: null,
      redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null,
      tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
    };
    await repos.finishes.save(finish);

    const byRace = await repos.finishes.listByRace(race.id);
    expect(byRace).toHaveLength(1);
    expect(byRace[0]).toMatchObject({ id: finish.id, sortOrder: 1, startPresent: true });
    const bySeries = await repos.finishes.listBySeries(s.id, [competitor.id]);
    expect(bySeries).toHaveLength(1);

    await repos.series.delete(s.id);
  });

  test('FinishRepository.saveMany upserts a batch in one round-trip', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();
    await repos.series.save(s);
    const fleet = uuid();
    await repos.fleets.save({ id: fleet, seriesId: s.id, name: 'F', displayOrder: 0, scoringSystem: 'scratch' });
    const competitors: Competitor[] = [];
    for (let i = 0; i < 30; i++) {
      const c: Competitor = {
        id: uuid(), seriesId: s.id, fleetIds: [fleet],
        sailNumber: String(100 + i), name: `Boat ${i}`,
        club: '', gender: '', age: null, createdAt: Date.now(),
      };
      competitors.push(c);
      await repos.competitors.save(c);
    }
    const race: Race = { id: uuid(), seriesId: s.id, raceNumber: 1, date: '2026-04-01', createdAt: Date.now() };
    await repos.races.save(race);

    const finishes: Finish[] = competitors.map((c, i) => ({
      id: uuid(), raceId: race.id, competitorId: c.id,
      sortOrder: i + 1,
      resultCode: null, startPresent: null,
      penaltyCode: null, penaltyOverride: null,
      redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null,
      tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
    }));

    await repos.finishes.saveMany(finishes);

    const byRace = await repos.finishes.listByRace(race.id);
    expect(byRace).toHaveLength(30);
    expect(new Set(byRace.map((f) => f.id))).toEqual(new Set(finishes.map((f) => f.id)));

    // Re-running saveMany with mutated rows updates them in place.
    const updated = finishes.map((f) => ({ ...f, sortOrder: (f.sortOrder ?? 0) + 100 }));
    await repos.finishes.saveMany(updated);
    const reread = await repos.finishes.listByRace(race.id);
    expect(reread.every((f) => (f.sortOrder ?? 0) > 100)).toBe(true);

    await repos.series.delete(s.id);
  });

  test('Finish.save against a race in another workspace is rejected', async () => {
    const reposA = createRepos({ db, workspaceId: workspaceA });
    const reposB = createRepos({ db, workspaceId: workspaceB });

    const s = makeSeries();
    await reposA.series.save(s);
    const fleet = uuid();
    await reposA.fleets.save({ id: fleet, seriesId: s.id, name: 'F', displayOrder: 0, scoringSystem: 'scratch' });
    const competitor: Competitor = {
      id: uuid(), seriesId: s.id, fleetIds: [fleet],
      sailNumber: '1', name: 'Boat', club: '', gender: '', age: null,
      createdAt: Date.now(),
    };
    await reposA.competitors.save(competitor);
    const race: Race = { id: uuid(), seriesId: s.id, raceNumber: 1, date: '2026-04-01', createdAt: Date.now() };
    await reposA.races.save(race);

    await expect(
      reposB.finishes.save({
        id: uuid(), raceId: race.id, competitorId: competitor.id,
        sortOrder: 1, resultCode: null, startPresent: null,
        penaltyCode: null, penaltyOverride: null,
        redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null,
        tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
      }),
    ).rejects.toThrow();

    expect(await reposB.finishes.listByRace(race.id)).toEqual([]);

    await reposA.series.delete(s.id);
  });

  test('deleteByRaces is restricted to races in the workspace', async () => {
    const reposA = createRepos({ db, workspaceId: workspaceA });
    const reposB = createRepos({ db, workspaceId: workspaceB });

    const sA = makeSeries();
    const sB = makeSeries();
    await reposA.series.save(sA);
    await reposB.series.save(sB);
    const raceA: Race = { id: uuid(), seriesId: sA.id, raceNumber: 1, date: '2026-04-01', createdAt: Date.now() };
    const raceB: Race = { id: uuid(), seriesId: sB.id, raceNumber: 1, date: '2026-04-01', createdAt: Date.now() };
    await reposA.races.save(raceA);
    await reposB.races.save(raceB);

    const startA: RaceStart = { id: uuid(), raceId: raceA.id, fleetIds: [], startTime: '11:00:00' };
    const startB: RaceStart = { id: uuid(), raceId: raceB.id, fleetIds: [], startTime: '11:00:00' };
    await reposA.raceStarts.save(startA);
    await reposB.raceStarts.save(startB);

    // workspaceA tries to delete starts for both races: only its own goes.
    await reposA.raceStarts.deleteByRaces([raceA.id, raceB.id]);

    expect(await reposA.raceStarts.listByRace(raceA.id)).toEqual([]);
    expect(await reposB.raceStarts.listByRace(raceB.id)).toEqual([{ ...startB, version: 1 }]);

    await reposA.series.delete(sA.id);
    await reposB.series.delete(sB.id);
  });

  test('RaceStartRepository.saveMany upserts a batch in one round-trip', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();
    await repos.series.save(s);
    const fleet = uuid();
    await repos.fleets.save({ id: fleet, seriesId: s.id, name: 'F', displayOrder: 0, scoringSystem: 'irc' });
    const race: Race = { id: uuid(), seriesId: s.id, raceNumber: 1, date: '2026-04-01', createdAt: Date.now() };
    await repos.races.save(race);

    const starts: RaceStart[] = Array.from({ length: 4 }, (_, i) => ({
      id: uuid(), raceId: race.id, fleetIds: [fleet], startTime: `11:0${i}:00`,
    }));
    await repos.raceStarts.saveMany(starts);

    const byRace = await repos.raceStarts.listByRace(race.id);
    expect(byRace).toHaveLength(4);
    expect(new Set(byRace.map((rs) => rs.id))).toEqual(new Set(starts.map((rs) => rs.id)));

    // Re-running saveMany with mutated rows updates them in place.
    const updated = starts.map((rs) => ({ ...rs, startTime: '12:00:00' }));
    await repos.raceStarts.saveMany(updated);
    const reread = await repos.raceStarts.listByRace(race.id);
    expect(reread.every((rs) => rs.startTime === '12:00:00')).toBe(true);

    await repos.series.delete(s.id);
  });

  test('RaceStartRepository.saveMany rejects a race in another workspace', async () => {
    const reposA = createRepos({ db, workspaceId: workspaceA });
    const reposB = createRepos({ db, workspaceId: workspaceB });

    const s = makeSeries();
    await reposA.series.save(s);
    const race: Race = { id: uuid(), seriesId: s.id, raceNumber: 1, date: '2026-04-01', createdAt: Date.now() };
    await reposA.races.save(race);

    await expect(
      reposB.raceStarts.saveMany([
        { id: uuid(), raceId: race.id, fleetIds: [], startTime: '11:00:00' },
      ]),
    ).rejects.toThrow();

    expect(await reposA.raceStarts.listByRace(race.id)).toEqual([]);

    await reposA.series.delete(s.id);
  });

  test('RaceStartRepository.saveMany with empty array is a no-op', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    await expect(repos.raceStarts.saveMany([])).resolves.toBeUndefined();
  });

  // ─── FleetRepository.saveMany ──────────────────────────────────────────────

  test('FleetRepository.saveMany inserts a batch and upserts on re-run', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();
    await repos.series.save(s);

    const fleets: Fleet[] = [
      { id: uuid(), seriesId: s.id, name: 'IRC 1', displayOrder: 0, scoringSystem: 'irc' },
      { id: uuid(), seriesId: s.id, name: 'PY', displayOrder: 1, scoringSystem: 'py' },
      { id: uuid(), seriesId: s.id, name: 'NHC', displayOrder: 2, scoringSystem: 'nhc' },
    ];
    await repos.fleets.saveMany(fleets);

    const list = await repos.fleets.listBySeries(s.id);
    expect(list.map((f) => f.name)).toEqual(['IRC 1', 'PY', 'NHC']);
    expect(list.find((f) => f.name === 'NHC')!.scoringSystem).toBe('nhc');

    // Mutate one row and re-run; the other rows are unchanged.
    const updated = fleets.map((f) =>
      f.name === 'IRC 1' ? { ...f, name: 'IRC Class 1' } : f,
    );
    await repos.fleets.saveMany(updated);
    const reread = await repos.fleets.listBySeries(s.id);
    expect(reread.find((f) => f.id === fleets[0].id)!.name).toBe('IRC Class 1');
    expect(reread.find((f) => f.id === fleets[0].id)!.version).toBe(2);
    expect(reread.find((f) => f.id === fleets[1].id)!.version).toBe(2);

    await repos.series.delete(s.id);
  });

  test('FleetRepository.saveMany rejects a series in another workspace', async () => {
    const reposA = createRepos({ db, workspaceId: workspaceA });
    const reposB = createRepos({ db, workspaceId: workspaceB });
    const s = makeSeries();
    await reposA.series.save(s);

    await expect(
      reposB.fleets.saveMany([
        { id: uuid(), seriesId: s.id, name: 'X', displayOrder: 0, scoringSystem: 'scratch' },
      ]),
    ).rejects.toThrow(/not in workspace/);

    expect(await reposB.fleets.listBySeries(s.id)).toEqual([]);
    await reposA.series.delete(s.id);
  });

  test('FleetRepository.saveMany with empty array is a no-op', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    await expect(repos.fleets.saveMany([])).resolves.toBeUndefined();
  });

  // ─── CompetitorRepository.saveMany ─────────────────────────────────────────

  test('CompetitorRepository.saveMany inserts and upserts a batch', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();
    await repos.series.save(s);
    const fleet = uuid();
    await repos.fleets.save({ id: fleet, seriesId: s.id, name: 'F', displayOrder: 0, scoringSystem: 'irc' });

    const competitors: Competitor[] = [];
    for (let i = 0; i < 25; i++) {
      competitors.push({
        id: uuid(), seriesId: s.id, fleetIds: [fleet],
        sailNumber: String(1000 + i),
        name: `Helm ${i}`,
        club: 'HYC', gender: '', age: null, createdAt: Date.now(),
      });
    }
    await repos.competitors.saveMany(competitors);

    const list = await repos.competitors.listBySeries(s.id);
    expect(list).toHaveLength(25);
    expect(new Set(list.map((c) => c.id))).toEqual(new Set(competitors.map((c) => c.id)));

    // Re-run with mutated names; rows are upserted in place.
    const renamed = competitors.map((c) => ({ ...c, name: `Renamed ${c.sailNumber}` }));
    await repos.competitors.saveMany(renamed);
    const reread = await repos.competitors.listBySeries(s.id);
    expect(reread.every((c) => c.name.startsWith('Renamed '))).toBe(true);
    expect(reread.every((c) => (c.version ?? 0) === 2)).toBe(true);

    await repos.series.delete(s.id);
  });

  test('CompetitorRepository.saveMany rejects a series in another workspace', async () => {
    const reposA = createRepos({ db, workspaceId: workspaceA });
    const reposB = createRepos({ db, workspaceId: workspaceB });
    const s = makeSeries();
    await reposA.series.save(s);

    await expect(
      reposB.competitors.saveMany([
        {
          id: uuid(), seriesId: s.id, fleetIds: [],
          sailNumber: '1', name: 'X', club: '', gender: '', age: null,
          createdAt: Date.now(),
        },
      ]),
    ).rejects.toThrow(/not in workspace/);

    expect(await reposB.competitors.listBySeries(s.id)).toEqual([]);
    await reposA.series.delete(s.id);
  });

  test('CompetitorRepository.saveMany with empty array is a no-op', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    await expect(repos.competitors.saveMany([])).resolves.toBeUndefined();
  });

  // ─── FleetRepository.ensureFleet ───────────────────────────────────────────

  test('FleetRepository.ensureFleet returns existing id, then creates idempotently', async () => {
    const repos = createRepos({ db, workspaceId: workspaceA });
    const s = makeSeries();
    await repos.series.save(s);

    const idA = await repos.fleets.ensureFleet(s.id, 'Cruisers', {
      scoringSystem: 'irc',
    });
    const idAagain = await repos.fleets.ensureFleet(s.id, 'cruisers'); // case-insensitive
    expect(idAagain).toBe(idA);

    const idB = await repos.fleets.ensureFleet(s.id, 'Echo', {
      scoringSystem: 'echo',
    });
    expect(idB).not.toBe(idA);

    const list = await repos.fleets.listBySeries(s.id);
    expect(list.map((f) => f.name).sort()).toEqual(['Cruisers', 'Echo']);
    const echo = list.find((f) => f.name === 'Echo');
    expect(echo).toMatchObject({ scoringSystem: 'echo' });
    expect(echo!.echoAlpha).toBeGreaterThan(0);
    // displayOrder is assigned monotonically.
    expect(list.map((f) => f.displayOrder).sort()).toEqual([0, 1]);

    await repos.series.delete(s.id);
  });

  test('FleetRepository.ensureFleet rejects a series in another workspace', async () => {
    const reposA = createRepos({ db, workspaceId: workspaceA });
    const reposB = createRepos({ db, workspaceId: workspaceB });
    const s = makeSeries();
    await reposA.series.save(s);

    await expect(reposB.fleets.ensureFleet(s.id, 'Cruisers')).rejects.toThrow(
      /not in workspace/,
    );

    await reposA.series.delete(s.id);
  });

  // ─── FtpServerRepository ───────────────────────────────────────────────────

  test('FtpServerRepository: round-trips, encrypts at rest, isolates by workspace', async () => {
    process.env.CREDENTIAL_KEY = 'a'.repeat(64);
    const { _resetKeyCache } = await import('@/lib/crypto');
    _resetKeyCache();

    const reposA = createRepos({ db, workspaceId: workspaceA });
    const reposB = createRepos({ db, workspaceId: workspaceB });
    const id = uuid();
    const server = {
      id,
      host: 'ftp.example.com',
      port: 21,
      username: 'sailor',
      password: 'super-secret',
      ftps: true,
    };
    await reposA.ftpServers.save(server);

    const fromA = await reposA.ftpServers.list();
    expect(fromA).toHaveLength(1);
    expect(fromA[0].password).toBe('super-secret');

    const fromB = await reposB.ftpServers.list();
    expect(fromB).toEqual([]);

    const [row] = await db
      .select()
      .from(schema.ftpServers)
      .where(eq(schema.ftpServers.id, id));
    expect(row.encryptedPassword).not.toContain('super-secret');
    expect(row.version).toBe(1);

    await reposA.ftpServers.save({ ...server, password: 'rotated' });
    const [row2] = await db
      .select()
      .from(schema.ftpServers)
      .where(eq(schema.ftpServers.id, id));
    expect(row2.version).toBe(2);
    expect(row2.encryptedPassword).not.toBe(row.encryptedPassword);

    await reposB.ftpServers.delete(id);
    expect((await reposA.ftpServers.list())).toHaveLength(1);

    await reposA.ftpServers.delete(id);
    expect((await reposA.ftpServers.list())).toEqual([]);
  });

  // ─── ADR-008 Phase 7 actor attribution ─────────────────────────────────────

  test('ConflictError carries actor info from the row that beat us to the write', async () => {
    const { ConflictError } = await import('@/lib/repository');
    const reposA = createRepos({ db, workspaceId: workspaceA });

    // Seed a user and stamp the row with their id.
    const userId = `usr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.user).values({
      id: userId,
      name: 'Sarah Scorer',
      email: `sarah-${userId}@sailscoring.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const seeded = await reposA.series.save(makeSeries(), { updatedBy: userId });
    // Bump server-side so the next save's expectedVersion is stale.
    await reposA.series.save(seeded, {
      expectedVersion: seeded.version,
      updatedBy: userId,
    });

    const err = await reposA.series
      .save(seeded, { expectedVersion: seeded.version, updatedBy: userId })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    const detail = (err as InstanceType<typeof ConflictError>).detail;
    expect(detail?.currentVersion).toBe(seeded.version! + 1);
    expect(detail?.actor).toEqual({
      id: userId,
      email: `sarah-${userId}@sailscoring.test`,
      displayName: 'Sarah Scorer',
    });

    await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  test('ConflictError leaves actor undefined for pre-Phase-7 rows (no updatedBy)', async () => {
    const { ConflictError } = await import('@/lib/repository');
    const reposA = createRepos({ db, workspaceId: workspaceA });

    // Seed without updatedBy (pre-Phase-7 simulation).
    const seeded = await reposA.series.save(makeSeries());
    await reposA.series.save(seeded, { expectedVersion: seeded.version });

    const err = await reposA.series
      .save(seeded, { expectedVersion: seeded.version })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as InstanceType<typeof ConflictError>).detail?.actor).toBeUndefined();
  });

});
