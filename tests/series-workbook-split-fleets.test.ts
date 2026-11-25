/**
 * A split-fleet championship in the spreadsheet: the results and standings
 * are the championship's, not the per-round fleets' own.
 */
import { describe, it, expect } from 'vitest';

import { buildSeriesWorkbook } from '@/lib/series-workbook';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';
import { defaultSplitFleetConfig } from '@/lib/split-fleets';

const SERIES: Series = {
  id: 's1', name: 'Worlds', venue: 'Dun Laoghaire', startDate: '2026-08-23', endDate: '2026-08-30',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null, lastModifiedAt: 0,
  scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries', ftpHost: '', ftpPath: '', ftpPaths: {},
  includeJsonExport: false, enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
};

const FLEETS: Fleet[] = [
  { id: 'f-red', seriesId: 's1', name: 'Red', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-blue', seriesId: 's1', name: 'Blue', displayOrder: 1, scoringSystem: 'scratch' },
];
const competitor = (id: string, sail: string, fleetIds: string[]): Competitor => ({
  id, seriesId: 's1', fleetIds, sailNumber: sail, names: [`Helm ${sail}`], clubs: [], gender: '', age: null, createdAt: 0,
});
const COMPETITORS = [
  competitor('c1', '101', ['f-red']), competitor('c2', '102', ['f-red']),
  competitor('c3', '201', ['f-blue']), competitor('c4', '202', ['f-blue']),
];
const RACES: Race[] = [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-08-24', createdAt: 0 }];
const STARTS: RaceStart[] = [
  { id: 'rs1', raceId: 'r1', fleetIds: ['f-red', 'f-blue'], startTime: '10:00:00', stage: 'qualifying', stageRaceNumber: 1 },
];
const finish = (id: string, competitorId: string, sortOrder: number): Finish => ({
  id, raceId: 'r1', competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null,
  penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null,
  redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
});
const FINISHES = [finish('f1', 'c1', 1), finish('f2', 'c3', 2), finish('f3', 'c2', 3), finish('f4', 'c4', 4)];

const repos = {
  seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
  competitorRepo: { listBySeries: async () => COMPETITORS },
  raceRepo: { listBySeries: async () => RACES },
  fleetRepo: { listBySeries: async () => FLEETS },
  subSeriesRepo: { listBySeries: async () => [] },
  finishRepo: { listBySeries: async () => FINISHES },
  raceStartRepo: { listBySeries: async () => STARTS },
  raceRatingOverrideRepo: { listBySeries: async () => [] },
  splitFleets: {
    get: async () => ({
      config: defaultSplitFleetConfig(2),
      rounds: [{
        id: 'round1', seriesId: 's1', stage: 'qualifying', roundNumber: 1, fromStageRace: 1,
        fleetIds: ['f-red', 'f-blue'], method: 'seeded', basis: null, overrides: {}, createdAt: 0,
      }],
    }),
  },
} as unknown as ExportRepos;

describe('buildSeriesWorkbook — a split-fleet championship', () => {
  it('takes its results and standings from the championship', async () => {
    const wb = (await buildSeriesWorkbook(repos, 's1'))!;
    const results = wb.sheets.find((s) => s.name === 'Results')!;
    const col = (name: string) => results.columns.findIndex((c) => c.header === name);
    const rows = results.rows.map((r) => [r[col('Fleet')]?.value, r[col('Sail number')]?.value, r[col('Points')]?.value]);
    expect(rows).toEqual(expect.arrayContaining([['Red', '101', 1], ['Red', '102', 2], ['Blue', '201', 1], ['Blue', '202', 2]]));

    const standings = wb.sheets.find((s) => s.name === 'Standings')!;
    // No Fleet column yet: a boat has a championship fleet only once the
    // fleet has split.
    expect(standings.columns.map((c) => c.header)).toEqual(['Rank', 'Sail number', 'Competitor', 'Total', 'Net', 'Q1', 'Competitor ID']);
    expect(standings.rows).toHaveLength(4);
  });
});
