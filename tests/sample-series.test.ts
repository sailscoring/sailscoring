import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { parseSeriesFile, openSeriesFromFile, type SeriesFile, type SeriesFileRepos } from '@/lib/series-file';
import { calculateFleetStandings } from '@/lib/scoring';
import { seriesInputSchema } from '@/lib/validation/series';
import { fleetSchema } from '@/lib/validation/fleet';
import { competitorSchema } from '@/lib/validation/competitor';
import { raceSchema } from '@/lib/validation/race';
import { raceStartSchema } from '@/lib/validation/race-start';
import { finishSchema } from '@/lib/validation/finish';
import type { Series, Competitor, Fleet, Race, Finish, RaceStart } from '@/lib/types';

/**
 * Guards the two synthetic sample series that new workspaces are seeded with
 * (`scripts/generate-sample-series.ts`). Re-run `pnpm generate:sample-series`
 * if these fail after intentionally changing the generator.
 */

const SAMPLE_DIR = join(__dirname, '..', 'lib', 'sample-series');

function load(name: string) {
  const raw = readFileSync(join(SAMPLE_DIR, name), 'utf8');
  const file = parseSeriesFile(raw) as unknown as SeriesFile;

  const fleets: Fleet[] = file.fleets.map((f) => ({
    id: f.id,
    seriesId: file.seriesId,
    name: f.name,
    displayOrder: f.displayOrder,
    scoringSystem: f.scoringSystem,
    ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
  }));

  const competitors: Competitor[] = file.competitors.map((c) => ({
    ...c,
    seriesId: file.seriesId,
    createdAt: 0,
  })) as Competitor[];

  const races: Race[] = file.races.map((r) => ({
    id: r.id,
    seriesId: file.seriesId,
    raceNumber: r.raceNumber,
    date: r.date,
    createdAt: 0,
  }));

  const raceStarts: RaceStart[] = file.races.flatMap((r) =>
    r.starts.map((s) => ({ id: s.id, raceId: r.id, fleetIds: s.fleetIds, startTime: s.startTime })),
  );

  const finishes: Finish[] = file.races.flatMap((r) =>
    r.finishes.map((f) => ({
      id: f.id,
      raceId: r.id,
      competitorId: f.competitorId,
      unknownSailNumber: f.unknownSailNumber,
      sortOrder: f.sortOrder,
      tiedWithPrevious: f.tiedWithPrevious ?? false,
      finishTime: f.finishTime,
      resultCode: f.resultCode,
      startPresent: f.startPresent,
      penaltyCode: f.penaltyCode,
      penaltyOverride: f.penaltyOverride,
      redressMethod: null,
      redressExcludeRaces: null,
      redressIncludeRaces: null,
      redressIncludeAllLater: false,
      redressPoints: null,
    })),
  );

  return { file, fleets, competitors, races, raceStarts, finishes };
}

/**
 * A `SeriesFileRepos` that validates every payload against the real `/api/v1`
 * Zod input schemas — the exact boundary that returns 400 on import. Driving
 * `openSeriesFromFile` through it reproduces a manual "Open from File" without a
 * DB, so a schema violation fails the test instead of only surfacing as a
 * runtime 400.
 */
function makeValidatingRepos(): SeriesFileRepos {
  const noop = async () => {};
  return {
    seriesRepo: {
      get: async () => undefined,
      save: async (s: Series) => {
        seriesInputSchema.parse(s);
        return s;
      },
    } as unknown as SeriesFileRepos['seriesRepo'],
    fleetRepo: {
      saveMany: async (fleets: Fleet[]) => {
        for (const f of fleets) fleetSchema.parse(f);
      },
    } as unknown as SeriesFileRepos['fleetRepo'],
    competitorRepo: {
      saveMany: async (cs: Competitor[]) => {
        for (const c of cs) competitorSchema.parse(c);
      },
    } as unknown as SeriesFileRepos['competitorRepo'],
    raceRepo: {
      save: async (r: Race) => {
        raceSchema.parse(r);
        return r;
      },
    } as unknown as SeriesFileRepos['raceRepo'],
    subSeriesRepo: {
      listBySeries: async () => [],
      saveMany: async () => {},
      deleteBySeries: async () => {},
    } as unknown as SeriesFileRepos['subSeriesRepo'],
    raceStartRepo: {
      saveMany: async (ss: RaceStart[]) => {
        for (const s of ss) raceStartSchema.parse(s);
      },
    } as unknown as SeriesFileRepos['raceStartRepo'],
    raceRatingOverrideRepo: { listByRaces: async () => [], saveMany: async () => {}, delete: async () => {}, deleteByRaces: async () => {} } as unknown as SeriesFileRepos['raceRatingOverrideRepo'],
    finishRepo: {
      saveMany: async (fs: Finish[]) => {
        for (const f of fs) finishSchema.parse(f);
      },
    } as unknown as SeriesFileRepos['finishRepo'],
    listSeriesNames: async () => [],
    deleteSeriesChildren: noop,
  };
}

describe('sample series files', () => {
  it.each(['regatta.sailscoring', 'club-racing.sailscoring'])(
    '%s imports through the /api/v1 schemas without a validation error',
    async (name) => {
      const file = parseSeriesFile(readFileSync(join(SAMPLE_DIR, name), 'utf8'));
      // Throws (failing the test) if any remapped payload violates its schema —
      // the same check the server runs before a 400.
      await expect(openSeriesFromFile(file, makeValidatingRepos())).resolves.toBeTruthy();
    },
  );

  it('regatta: 6 scratch fleets, full results, no orphans or rejections', () => {
    const { file, fleets, competitors, races, raceStarts, finishes } = load('regatta.sailscoring');

    expect(file.formatVersion).toBe(8);
    expect(file.series.scoringMode).toBe('scratch');
    expect(fleets).toHaveLength(6);
    expect(fleets.every((f) => f.scoringSystem === 'scratch')).toBe(true);
    expect(competitors.length).toBeGreaterThan(100);
    // Exactly one NZL sailor, plus a foreign smattering.
    expect(competitors.filter((c) => c.nationality === 'NZL')).toHaveLength(1);
    expect(competitors.filter((c) => c.nationality && c.nationality !== 'IRL').length).toBeGreaterThan(5);
    // Every competitor carries a Gold/Silver/Bronze division.
    expect(competitors.every((c) => ['Gold', 'Silver', 'Bronze'].includes(c.subdivision ?? ''))).toBe(true);

    const { fleetStandings } = calculateFleetStandings(
      fleets, competitors, races, finishes, file.series.discardThresholds, file.series.dnfScoring, raceStarts,
    );

    // No "Unknown" orphan fleet (every competitor mapped to a real fleet).
    expect(fleetStandings.some((fs) => fs.fleet.id === '__unknown__')).toBe(false);
    // Scratch racing has no rating rejections; every competitor is ranked.
    const ranked = fleetStandings.reduce((n, fs) => n + fs.standings.length, 0);
    expect(ranked).toBe(competitors.length);
    expect(fleetStandings.every((fs) => fs.rejections.length === 0)).toBe(true);
  });

  it('club racing: 6 IRC+ECHO fleets score cleanly with no rating rejections', () => {
    const { file, fleets, competitors, races, raceStarts, finishes } = load('club-racing.sailscoring');

    expect(file.series.scoringMode).toBe('handicap');
    expect(fleets.filter((f) => f.scoringSystem === 'irc')).toHaveLength(3);
    expect(fleets.filter((f) => f.scoringSystem === 'echo')).toHaveLength(3);
    // Every boat is in exactly two fleets (its class's IRC and ECHO) and dual-rated.
    expect(competitors.every((c) => c.fleetIds.length === 2)).toBe(true);
    expect(competitors.every((c) => c.ircTcc != null && c.echoStartingTcf != null)).toBe(true);

    const { fleetStandings } = calculateFleetStandings(
      fleets, competitors, races, finishes, file.series.discardThresholds, file.series.dnfScoring, raceStarts,
    );

    expect(fleetStandings.some((fs) => fs.fleet.id === '__unknown__')).toBe(false);
    // No boat is rejected for a missing rating in any fleet.
    expect(fleetStandings.every((fs) => fs.rejections.length === 0)).toBe(true);
    // Each fleet ranks its 15 boats, and the winner has a real net score.
    for (const fs of fleetStandings) {
      expect(fs.standings).toHaveLength(15);
      expect(fs.standings[0].netPoints).toBeGreaterThan(0);
    }
  });
});
