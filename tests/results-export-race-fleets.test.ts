/**
 * Publishing a fleet a boat was out of for one race: the fleet's page leaves
 * the boat out of that race's table, and its summary shows the race as not
 * sailed in the fleet — the points, a dash where a code would be, and a line
 * under the table saying what the dash means.
 */
import { describe, expect, it } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, Series } from '@/lib/types';

const series: Series = {
  id: 's1', name: 'Offshore', venue: '', startDate: '2026-05-01', endDate: '2026-05-31',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null,
  lastModifiedAt: 0, scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries',
  ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false, enabledCompetitorFields: ['boatName'],
  primaryPersonLabel: 'helm', subdivisionAxes: [],
};

const fleets: Fleet[] = [
  { id: 'ov', seriesId: 's1', name: 'Overall', displayOrder: 0, scoringSystem: 'scratch' },
  { id: '2h', seriesId: 's1', name: 'Two-Handed', displayOrder: 1, scoringSystem: 'scratch' },
];

const boat = (id: string, sail: string, boatName: string): Competitor => ({
  id, seriesId: 's1', fleetIds: ['ov', '2h'], sailNumber: sail, boatName, names: [boatName], clubs: [], gender: '', age: null, createdAt: 0,
});
const competitors = [boat('c1', '53308', 'Loinnir'), boat('c2', 'SWE041', 'No Xcuse'), boat('c3', 'IRL 31310', 'Katanca')];

const races: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-05-02', createdAt: 0 },
  { id: 'r2', seriesId: 's1', raceNumber: 2, name: null, date: '2026-05-23', createdAt: 0, fleetChanges: [{ competitorId: 'c1', drop: ['2h'] }] },
];

const finish = (raceId: string, competitorId: string, sortOrder: number): Finish => ({
  id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null,
  penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
  redressIncludeAllLater: false, redressPoints: null,
});
const finishes = ['r1', 'r2'].flatMap((r) => [finish(r, 'c1', 1), finish(r, 'c2', 2), finish(r, 'c3', 3)]);

const repos = {
  seriesRepo: { get: async () => series },
  competitorRepo: { listBySeries: async () => competitors },
  raceRepo: { listBySeries: async () => races },
  fleetRepo: { listBySeries: async () => fleets },
  subSeriesRepo: { listBySeries: async () => [] },
  finishRepo: { listBySeries: async () => finishes },
  raceStartRepo: { listBySeries: async () => [] },
  raceRatingOverrideRepo: { listBySeries: async () => [] },
} as unknown as ExportRepos;

/** The part of a page from one race's heading to the end of its table. */
function raceTable(html: string, anchor: string): string {
  const at = html.indexOf(`id="${anchor}"`);
  expect(at, `no ${anchor} table`).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</table>', at));
}

describe('a fleet a boat was out of for one race', () => {
  it("leaves the boat out of that race's table and dashes its summary cell", async () => {
    const files = (await buildFleetHtmlFiles(repos, 's1'))!.files;
    const twoHanded = files.find((f) => f.fleetName === 'Two-Handed')!.html;
    const overall = files.find((f) => f.fleetName === 'Overall')!.html;

    expect(raceTable(twoHanded, 'r2')).not.toContain('Loinnir');
    expect(raceTable(twoHanded, 'r1')).toContain('Loinnir');
    expect(raceTable(overall, 'r2')).toContain('Loinnir');

    // Three entries, so a race not sailed in the fleet scores 4.
    expect(twoHanded).toContain('title="Did not race in this fleet">4.0 —</td>');
    expect(twoHanded).toContain('— did not race in this fleet');
    expect(overall).not.toContain('did not race in this fleet');
  });
});
