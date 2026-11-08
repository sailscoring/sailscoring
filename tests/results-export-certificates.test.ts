/**
 * Publishing a race a boat declared on its secondary IRC certificate: the
 * rating cell names the secondary's certificate rather than marking a typed
 * override, and the Certificate column — off unless the series turns it on —
 * prints P or S.
 */
import { describe, expect, it } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, RaceRatingOverride, RaceStart, ResultsColumn, Series } from '@/lib/types';

function makeSeries(resultsColumns?: ResultsColumn[]): Series {
  return {
    id: 's1', name: 'Welsh Coastal', venue: '', startDate: '2026-04-05', endDate: '2026-08-08',
    venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null,
    lastModifiedAt: 0, scoringMode: 'handicap', discardThresholds: [], dnfScoring: 'seriesEntries',
    ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false, enabledCompetitorFields: ['boatName'],
    primaryPersonLabel: 'helm', subdivisionAxes: [],
    ...(resultsColumns ? { resultsColumns } : {}),
  };
}

const fleet: Fleet = { id: 'f1', seriesId: 's1', name: 'IRC Class 1', displayOrder: 0, scoringSystem: 'irc' };
const boat = (id: string, sail: string, boatName: string, extra: Partial<Competitor>): Competitor => ({
  id, seriesId: 's1', fleetIds: ['f1'], sailNumber: sail, boatName, names: [boatName], clubs: [], gender: '', age: null, createdAt: 0, ...extra,
});
const competitors = [
  boat('c1', 'GBR7664T', 'Crackajack', {
    ircTcc: 1.013, ircCert: { certNumber: '50718', appliedAt: 0 },
    ircSecondaryTcc: 1.014, ircSecondaryCert: { certNumber: '50719', appliedAt: 0 },
  }),
  boat('c2', 'GBR 6939R', 'Finally', { ircTcc: 1.019 }),
];
const races: Race[] = [1, 2].map((n) => ({ id: `r${n}`, seriesId: 's1', raceNumber: n, name: null, date: '2026-04-05', createdAt: 0 }));
const starts: RaceStart[] = races.map((r) => ({ id: `s-${r.id}`, raceId: r.id, fleetIds: ['f1'], startTime: '10:00:00' }));
const finish = (raceId: string, competitorId: string, finishTime: string, sortOrder: number): Finish => ({
  id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, finishTime, tiedWithPrevious: false, resultCode: null, startPresent: null,
  penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
  redressIncludeAllLater: false, redressPoints: null,
});
const finishes = races.flatMap((r) => [finish(r.id, 'c1', '12:00:00', 1), finish(r.id, 'c2', '12:01:00', 2)]);
// Race 2 is declared on the secondary.
const overrides: RaceRatingOverride[] = [
  { id: 'o1', raceId: 'r2', competitorId: 'c1', field: 'ircTcc', value: 1.014, certificate: 'secondary' },
];

const repos = (series: Series) => ({
  seriesRepo: { get: async () => series },
  competitorRepo: { listBySeries: async () => competitors },
  raceRepo: { listBySeries: async () => races },
  fleetRepo: { listBySeries: async () => [fleet] },
  subSeriesRepo: { listBySeries: async () => [] },
  finishRepo: { listBySeries: async () => finishes },
  raceStartRepo: { listBySeries: async () => starts },
  raceRatingOverrideRepo: { listBySeries: async () => overrides },
}) as unknown as ExportRepos;

const raceTable = (html: string, anchor: string) => {
  const at = html.indexOf(`id="${anchor}"`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</table>', at));
};

describe('a race declared on the secondary IRC certificate, published', () => {
  it("names the secondary's certificate on the rating, not a typed override", async () => {
    const html = (await buildFleetHtmlFiles(repos(makeSeries()), 's1'))!.files[0].html;
    expect(raceTable(html, 'r2')).toContain('title="IRC certificate 50719">1.014<');
    expect(raceTable(html, 'r1')).toContain('title="IRC certificate 50718">1.013<');
    expect(raceTable(html, 'r2')).not.toContain('Per-race rating override');
    // Off unless the series turns it on.
    expect(html).not.toContain('<col class="cert" />');
  });

  it('prints P or S in the Certificate column when the series shows it', async () => {
    const html = (await buildFleetHtmlFiles(repos(makeSeries([{ key: 'certificate' }])), 's1'))!.files[0].html;
    expect(raceTable(html, 'r1')).toMatch(/<td class="mono">P<\/td>/);
    expect(raceTable(html, 'r2')).toMatch(/<td class="mono">S<\/td>/);
  });
});
