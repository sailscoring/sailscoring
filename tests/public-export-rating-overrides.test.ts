/**
 * A race's rating overrides, and a boat's secondary IRC certificate, carried
 * through the public export (v20) and read back by every reader that
 * re-scores it — the spectator viewer and Import Series — so the race scores
 * on the rating the published page scored it on, not the boat's base rating.
 */
import { describe, expect, it } from 'vitest';

import {
  buildPublicExportFromSnapshot,
  importPublicExport,
  parsePublicExport,
  type ImportRepos,
} from '@/lib/public-export';
import { calculateFleetStandings } from '@/lib/scoring';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import { buildSpectatorSeries } from '@/lib/spectator/seed';
import type { Competitor, Finish, Fleet, Race, RaceRatingOverride, RaceStart, Series } from '@/lib/types';

const series: Series = {
  id: 's1', name: 'Coastal Series', venue: 'Howth',
  startDate: '2026-05-01', endDate: '2026-09-30',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
  createdAt: 0, lastSavedAt: null, lastModifiedAt: 0,
  scoringMode: 'handicap', discardThresholds: [], dnfScoring: 'seriesEntries',
  ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
  enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
};
const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'IRC', displayOrder: 0, scoringSystem: 'irc' };

// Hijacker's base TCC loses it both races; the TCC each race is actually
// scored on wins it both.
const hijacker: Competitor = {
  id: 'c1', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: 'IRL1', names: ['Hijacker'],
  clubs: [], gender: '', age: null, createdAt: 0,
  ircTcc: 1.029,
  ircCert: { certNumber: '1001', tcc: 1.029, appliedAt: 0, source: 'ircrating.org', sourceUpdatedAt: '2026-04-01' },
  ircSecondaryTcc: 1.0,
  ircSecondaryCert: { certNumber: '1002', tcc: 1.0, appliedAt: 0, source: 'ircrating.org', sourceUpdatedAt: '2026-04-01' },
};
const loinnir: Competitor = {
  id: 'c2', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: 'IRL2', names: ['Loinnir'],
  clubs: [], gender: '', age: null, createdAt: 0, ircTcc: 1.0,
};

const races: Race[] = [1, 2].map((n) => ({
  id: `r${n}`, seriesId: 's1', raceNumber: n, name: null, date: `2026-06-0${n}`, createdAt: 0,
}));
const raceStarts: RaceStart[] = races.map((r) => ({
  id: `st-${r.id}`, raceId: r.id, fleetIds: ['fl-1'], startTime: '11:00:00',
}));
const finishDefaults = {
  tiedWithPrevious: false, resultCode: null, startPresent: null,
  penaltyCode: null, penaltyOverride: null,
  redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
  redressIncludeAllLater: false, redressPoints: null,
} as const;
// Hijacker 3600s elapsed, Loinnir 3630s: corrected on 1.029 Hijacker takes
// 3704s and is second; on 1.000 it is first.
const finishes: Finish[] = races.flatMap((r) => [
  { id: `${r.id}-a`, raceId: r.id, competitorId: 'c1', sortOrder: 1, finishTime: '12:00:00', ...finishDefaults },
  { id: `${r.id}-b`, raceId: r.id, competitorId: 'c2', sortOrder: 2, finishTime: '12:00:30', ...finishDefaults },
]);
const ratingOverrides: RaceRatingOverride[] = [
  // Race 1: a TCC typed for the race.
  { id: 'o1', raceId: 'r1', competitorId: 'c1', field: 'ircTcc', value: 1.0 },
  // Race 2: declared on the boat's secondary certificate.
  { id: 'o2', raceId: 'r2', competitorId: 'c1', field: 'ircTcc', value: 1.0, certificate: 'secondary' },
];

const snapshot: SeriesSnapshot = {
  series, competitors: [hijacker, loinnir], fleets: [fleet], races,
  subSeries: [], finishes, raceStarts, ratingOverrides,
};

function exported() {
  // Through text, as every reader meets it.
  return parsePublicExport(JSON.stringify(buildPublicExportFromSnapshot(snapshot)));
}

/** Race points per boat, by sail number. */
function racePoints(data: {
  fleets: Fleet[]; competitors: Competitor[]; races: Race[]; finishes: Finish[];
  raceStarts: RaceStart[]; ratingOverrides: RaceRatingOverride[];
}): Record<string, number[]> {
  const { fleetStandings } = calculateFleetStandings(
    data.fleets, data.competitors, data.races, data.finishes, [], 'seriesEntries',
    data.raceStarts, data.ratingOverrides,
  );
  return Object.fromEntries(
    fleetStandings[0].standings.map((s) => [s.competitor.sailNumber, s.racePoints]),
  );
}

describe('rating overrides in the public export', () => {
  it('writes each race its overrides, and the boat its secondary certificate', () => {
    const data = exported();
    expect(data.version).toBe(20);
    expect(data.races[0].ratingOverrides).toEqual([
      { competitorRef: '1', sailNumber: 'IRL1', field: 'ircTcc', value: 1.0 },
    ]);
    expect(data.races[1].ratingOverrides).toEqual([
      { competitorRef: '1', sailNumber: 'IRL1', field: 'ircTcc', value: 1.0, certificate: 'secondary' },
    ]);
    const boat = data.competitors.find((c) => c.sailNumber === 'IRL1')!;
    expect(boat.ircSecondaryTcc).toBe(1.0);
    // Where the figure came from, and no more: the stored record's TCC and
    // applied date stay in the app, as for the primary certificate.
    expect(boat.ircSecondaryCert).toEqual({
      certNumber: '1002', source: 'ircrating.org', sourceUpdatedAt: '2026-04-01',
    });
  });

  it('writes no overrides key on a race without any', () => {
    const data = parsePublicExport(JSON.stringify(
      buildPublicExportFromSnapshot({ ...snapshot, ratingOverrides: [] }),
    ));
    expect(data.races.every((r) => !('ratingOverrides' in r))).toBe(true);
  });

  it('the spectator viewer scores each race on the rating the page did', async () => {
    const view = await buildSpectatorSeries(exported(), '/p/isora/2026/coastal.sailscoring.json');
    expect(view.ratingOverrides).toHaveLength(2);
    const hijackerId = view.competitors.find((c) => c.sailNumber === 'IRL1')!.id;
    expect(view.ratingOverrides.every((o) => o.competitorId === hijackerId)).toBe(true);
    expect(view.ratingOverrides.map((o) => o.certificate)).toEqual([undefined, 'secondary']);
    expect(view.competitors.find((c) => c.id === hijackerId)!.ircSecondaryTcc).toBe(1.0);

    expect(racePoints(snapshot)).toEqual({ IRL1: [1, 1], IRL2: [2, 2] });
    expect(racePoints(view)).toEqual(racePoints(snapshot));
  });

  it('an export written before v20 reads as having no overrides', async () => {
    const data = exported();
    const older = {
      ...data,
      version: 19 as const,
      races: data.races.map((r) => {
        const copy = { ...r };
        delete copy.ratingOverrides;
        return copy;
      }),
    };
    const view = await buildSpectatorSeries(older, '/p/isora/2026/coastal.sailscoring.json');
    expect(view.ratingOverrides).toEqual([]);
    expect(racePoints(view)).toEqual({ IRL1: [2, 2], IRL2: [1, 1] });
  });

  it('drops an override for a boat or a rating the file does not resolve', async () => {
    const data = exported();
    data.races[0].ratingOverrides = [
      { competitorRef: '99', sailNumber: 'GHOST', field: 'ircTcc', value: 1.0 },
      { competitorRef: '1', sailNumber: 'IRL1', field: 'notARating' as 'ircTcc', value: 1.0 },
      // The secondary certificate is IRC's alone.
      { competitorRef: '1', sailNumber: 'IRL1', field: 'pyNumber', value: 1000, certificate: 'secondary' },
    ];
    const saved: RaceRatingOverride[] = [];
    const repos = {
      listSeriesNames: async () => [],
      seriesRepo: { save: async (s: unknown) => s },
      fleetRepo: { save: async (f: unknown) => f },
      competitorRepo: { save: async (c: unknown) => c },
      raceRepo: { save: async (r: unknown) => r },
      raceStartRepo: { save: async (s: unknown) => s },
      finishRepo: { saveMany: async () => {} },
      subSeriesRepo: { saveMany: async () => {} },
      splitFleets: { get: async () => null, replace: async () => {} },
      raceRatingOverrideRepo: { saveMany: async (list: RaceRatingOverride[]) => { saved.push(...list); } },
    } as unknown as ImportRepos;
    await importPublicExport(data, repos);
    // Race 1 keeps only the PY number, as a typed one; race 2 its declaration.
    expect(saved.map((o) => [o.field, o.certificate])).toEqual([
      ['pyNumber', undefined],
      ['ircTcc', 'secondary'],
    ]);
  });
});
