/**
 * A high-point series on its published page: each race table shows the
 * score as it counts, weighted and rounded, under a caption giving the fleet
 * size and weight; the standings run highest first; and a note under the
 * results says how points were scored.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, Series } from '@/lib/types';

const SERIES: Series = {
  id: 's1', name: 'Wolf’s Head', venue: 'Irish Sea', startDate: '2026-04-05', endDate: '',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null, lastModifiedAt: 0,
  scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries', ftpHost: '', ftpPath: '', ftpPaths: {},
  includeJsonExport: false, enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
  pointsSystem: 'highPoint', highPointFormula: 'chips3',
  scoringCodes: [{ code: 'DTP', description: 'Declared to race, did not race', kind: 'replace', rule: { type: 'fixedPoints', points: 8 }, discardable: true, countsInFleetSize: true }],
};

const FLEETS: Fleet[] = [{ id: 'f', seriesId: 's1', name: 'IRC', displayOrder: 0, scoringSystem: 'scratch' }];
const boat = (sail: string): Competitor => ({
  id: `c${sail}`, seriesId: 's1', fleetIds: ['f'], sailNumber: sail, names: [`Helm ${sail}`], clubs: [], gender: '', age: null, createdAt: 0,
});
const COMPETITORS = ['1', '2', '3', '4', '5', '6', '7'].map(boat);
const RACES: Race[] = [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-04-05', createdAt: 0, pointsMultiplier: 0.7 }];

function finish(competitorId: string, opts: { place?: number; code?: string }): Finish {
  return {
    id: `r1-${competitorId}`, raceId: 'r1', competitorId, sortOrder: opts.place ?? null, tiedWithPrevious: false,
    resultCode: opts.code ?? null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
    redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
  };
}

// ISORA 2026 race 01CW1's shape: five finishers and two DTPs, n = 7.
const FINISHES: Finish[] = [
  ...['1', '2', '3', '4', '5'].map((s, i) => finish(`c${s}`, { place: i + 1 })),
  finish('c6', { code: 'DTP' }), finish('c7', { code: 'DTP' }),
];

const repos = {
  seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
  competitorRepo: { listBySeries: async () => COMPETITORS },
  raceRepo: { listBySeries: async () => RACES },
  fleetRepo: { listBySeries: async () => FLEETS },
  subSeriesRepo: { listBySeries: async () => [] },
  finishRepo: { listBySeries: async () => FINISHES },
  raceStartRepo: { listBySeries: async () => [] },
  raceRatingOverrideRepo: { listBySeries: async () => [] },
} as unknown as ExportRepos;

describe('a high-point series, published', () => {
  it('captions each race with its fleet size and weight, and shows the weighted score', async () => {
    const html = (await buildFleetHtmlFiles(repos, 's1'))!.files[0].html;
    const at = html.indexOf('id="r1"');
    const race = html.slice(at, html.indexOf('</table>', at));
    expect(race).toContain('High point · 7 boats in the race · weight 0.7');
    // CHIPS3(1, 7) = 94.75, × 0.7 = 66.3; a DTP 8 × 0.7 = 5.6.
    expect(race).toContain('66.3');
    expect(race).toContain('5.6');
    // The weight is in the caption, not restated as a multiplier legend.
    expect(race).not.toContain('counts ×0.7');
  });

  it('says how points were scored under the results', async () => {
    const html = (await buildFleetHtmlFiles(repos, 's1'))!.files[0].html;
    expect(html).toContain('High point: each race scores CHIPS3 for the boats in it, × the race’s weighting; highest total wins.');
    expect(html).toContain('Scoring codes that differ from the high-point defaults');
  });
});
