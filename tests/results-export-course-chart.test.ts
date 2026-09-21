/**
 * The charts a published page's courses are drawn on. The build does not go
 * looking for them: it is handed a loader — the dialogs fetch from the app's
 * origin, the publish route reads off disk — and asks it for the data sets
 * this series' own starts name, once each. What the renderer then does with
 * a chart is tests/orc-render.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series, SeriesMark } from '@/lib/types';

const SERIES: Series = {
  id: 's1',
  name: 'Autumn League',
  venue: 'HYC',
  startDate: '2026-09-01',
  endDate: '2026-09-30',
  venueLogoUrl: '',
  eventLogoUrl: '',
  venueUrl: '',
  eventUrl: '',
  createdAt: 0,
  lastSavedAt: null,
  lastModifiedAt: 0,
  scoringMode: 'scratch',
  discardThresholds: [],
  dnfScoring: 'seriesEntries',
  ftpHost: '',
  ftpPath: '',
  ftpPaths: {},
  includeJsonExport: true,
  enabledCompetitorFields: [],
  primaryPersonLabel: 'helm',
  subdivisionAxes: [],
};

const FLEET: Fleet = { id: 'f1', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' };
const COMPETITORS: Competitor[] = [
  { id: 'c1', seriesId: 's1', fleetIds: ['f1'], sailNumber: '101', names: ['Helm 101'], clubs: [], gender: '', age: null, createdAt: 0 },
];
const RACES: Race[] = [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-12', createdAt: 0 }];
const FINISHES: Finish[] = [
  { id: 'r1-c1', raceId: 'r1', competitorId: 'c1', sortOrder: 1, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null },
];

/** One start, over marks adopted from two clubs' sets — the rare case, and
 *  the one that proves the sets come off the waypoints rather than a guess. */
const START: RaceStart = {
  id: 'st1',
  raceId: 'r1',
  fleetIds: ['f1'],
  startTime: '14:00:00',
  course: {
    name: 'W/L — 12 Sep R1',
    waypoints: [
      { label: 'Start', lat: 53.4055, lng: -6.0675 },
      { label: 'Z', lat: 53.3967, lng: -6.0702, fixed: true, set: 'hyc/al-2026' },
      { label: 'I', lat: 53.4117, lng: -6.0727, fixed: true, set: 'hyc/al-2026' },
      { label: 'H', lat: 53.399, lng: -6.0505, fixed: true, set: 'dbsc/summer-2026' },
    ],
  },
};

function makeRepos(starts: RaceStart[], marks: SeriesMark[] = []): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => [FLEET] },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => FINISHES },
    raceStartRepo: { listBySeries: async () => starts },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
    seriesMarkRepo: { listBySeries: async () => marks },
    seriesCourseRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

describe('buildFleetHtmlFiles — the charts its courses are drawn on', () => {
  it('asks for each data set its starts name, once', async () => {
    const asked: string[] = [];
    await buildFleetHtmlFiles(makeRepos([START]), 's1', undefined, {
      loadCourseBackground: async (set) => {
        asked.push(set);
        return undefined;
      },
    });
    expect(asked.sort()).toEqual(['dbsc/summer-2026', 'hyc/al-2026']);
  });

  it('asks for nothing when no course came off a card', async () => {
    const asked: string[] = [];
    const laid: RaceStart = {
      ...START,
      course: { name: 'W/L', waypoints: START.course!.waypoints.map(({ set: _set, ...w }) => w) },
    };
    await buildFleetHtmlFiles(makeRepos([laid]), 's1', undefined, {
      loadCourseBackground: async (set) => {
        asked.push(set);
        return undefined;
      },
    });
    expect(asked).toEqual([]);
  });

  it('falls back to the series’ own set for a snapshot taken before they carried one', async () => {
    // Every course picked before this shipped is such a snapshot, and its
    // marks came off the club's card all the same.
    const asked: string[] = [];
    const older: RaceStart = {
      ...START,
      course: { name: 'W/L', waypoints: START.course!.waypoints.map(({ set: _set, ...w }) => w) },
    };
    const library: SeriesMark[] = [
      { id: 'm1', seriesId: 's1', name: 'Z', lat: 53.3967, lng: -6.0702, card: { set: 'hyc/al-2026', markId: 'Z', release: '0.8.0' }, createdAt: 0 },
      { id: 'm2', seriesId: 's1', name: 'Start', lat: 53.4055, lng: -6.0675, createdAt: 1 },
    ];
    await buildFleetHtmlFiles(makeRepos([older], library), 's1', undefined, {
      loadCourseBackground: async (set) => {
        asked.push(set);
        return undefined;
      },
    });
    expect(asked).toEqual(['hyc/al-2026']);
  });

  it('builds the pages with no loader at all', async () => {
    const build = await buildFleetHtmlFiles(makeRepos([START]), 's1');
    expect(build?.files.length).toBeGreaterThan(0);
    expect(build!.files[0].html).not.toContain('<image');
  });
});
