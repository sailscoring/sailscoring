/**
 * Mixed laps on a published page: a fleet whose boats sailed different
 * numbers of laps publishes a Laps column on that race's table, beside the
 * elapsed time as sailed and the corrected time on the full course. A race
 * in which everyone sailed the same course gets no column.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';

const SERIES: Series = {
  id: 's1', name: 'Winter Series', venue: 'Bray', startDate: '2024-11-03', endDate: '',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null, lastModifiedAt: 0,
  scoringMode: 'handicap', discardThresholds: [], dnfScoring: 'seriesEntries', ftpHost: '', ftpPath: '', ftpPaths: {},
  includeJsonExport: false, enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
};

const FLEETS: Fleet[] = [{ id: 'py', seriesId: 's1', name: 'Mixed PY', displayOrder: 0, scoringSystem: 'py' }];

const boat = (sail: string, pyNumber: number): Competitor => ({
  id: `c${sail}`, seriesId: 's1', fleetIds: ['py'], sailNumber: sail, names: [`Helm ${sail}`],
  clubs: [], gender: '', age: null, createdAt: 0, pyNumber,
});

const COMPETITORS = [boat('3639', 1026), boat('1888', 1434)];
const RACES: Race[] = [1, 2].map((n) => ({ id: `r${n}`, seriesId: 's1', raceNumber: n, name: null, date: '2024-11-03', createdAt: 0 }));
const STARTS: RaceStart[] = RACES.map((r) => ({ id: `st-${r.id}`, raceId: r.id, fleetIds: ['py'], startTime: '10:00:00' }));

function finish(raceId: string, competitorId: string, sortOrder: number, finishTime: string, laps?: number): Finish {
  return {
    id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, finishTime,
    ...(laps != null ? { laps } : {}),
    resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
    redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
  };
}

const FINISHES: Finish[] = [
  finish('r1', 'c1888', 1, '10:23:41', 1), finish('r1', 'c3639', 2, '10:26:15', 2),
  finish('r2', 'c3639', 1, '10:30:00'), finish('r2', 'c1888', 2, '10:40:00'),
];

const repos = {
  seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
  competitorRepo: { listBySeries: async () => COMPETITORS },
  raceRepo: { listBySeries: async () => RACES },
  fleetRepo: { listBySeries: async () => FLEETS },
  subSeriesRepo: { listBySeries: async () => [] },
  finishRepo: { listBySeries: async () => FINISHES },
  raceStartRepo: { listBySeries: async () => STARTS },
  raceRatingOverrideRepo: { listBySeries: async () => [] },
} as unknown as ExportRepos;

/** One race's table, from its heading to the end of the table. */
function raceTable(html: string, n: number): string {
  const at = html.indexOf(`id="r${n}"`);
  return html.slice(at, html.indexOf('</table>', at));
}

describe('a mixed-laps race on the published page', () => {
  it('shows the laps beside the elapsed time as sailed and the full-course corrected time', async () => {
    const build = await buildFleetHtmlFiles(repos, 's1');
    const table = raceTable(build!.files[0].html, 1);
    expect(table).toContain('>Laps</th>');
    const row = table.slice(table.indexOf('>1888<'), table.indexOf('</tr>', table.indexOf('>1888<')));
    // 1421 s sailed over one lap of two: × 2 × 1000/1434 = 1982 = 33:02.
    expect(row).toMatch(/<td class="mono">1<\/td>\s*<td class="mono">10:23:41<\/td>\s*<td class="mono">23:41<\/td>/);
    expect(row).toContain('>33:02<');
  });

  it('shows no Laps column on a race everyone sailed the same', async () => {
    const build = await buildFleetHtmlFiles(repos, 's1');
    expect(raceTable(build!.files[0].html, 2)).not.toContain('>Laps</th>');
  });
});
