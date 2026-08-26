/**
 * The split-fleet per-race results page through the shared build: emitted
 * between the championship and the fleet assignments once a stage race has
 * sheet rows, and the championship deep-links into it only when the caller
 * says where it will be served — the publish path does; preview, download
 * and FTP do not.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';
import { defaultSplitFleetConfig } from '@/lib/split-fleets';

const SERIES: Series = {
  id: 's1',
  name: 'Worlds',
  venue: 'Dun Laoghaire',
  startDate: '2026-08-23',
  endDate: '2026-08-30',
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
  includeJsonExport: false,
  primaryPersonLabel: 'helm',
  subdivisionAxes: [],
  publishingGroups: [],
  publishIndividualFleetPages: true,
};

const FLEETS: Fleet[] = [
  { id: 'f-red', seriesId: 's1', name: 'Red', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-blue', seriesId: 's1', name: 'Blue', displayOrder: 1, scoringSystem: 'scratch' },
];

function competitor(id: string, sail: string, fleetIds: string[]): Competitor {
  return {
    id,
    seriesId: 's1',
    fleetIds,
    sailNumber: sail,
    names: [`Helm ${sail}`],
    club: '',
    gender: '',
    age: null,
    createdAt: 0,
  };
}

const COMPETITORS = [
  competitor('c1', '101', ['f-red']),
  competitor('c2', '102', ['f-red']),
  competitor('c3', '201', ['f-blue']),
  competitor('c4', '202', ['f-blue']),
];

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-08-24', createdAt: 0 },
];

// One start sequence, both fleets, one combined interleaved sheet.
const RACE_STARTS: RaceStart[] = [
  {
    id: 'rs1',
    raceId: 'r1',
    fleetIds: ['f-red', 'f-blue'],
    startTime: '10:00:00',
    stage: 'qualifying',
    stageRaceNumber: 1,
  },
];

function finish(id: string, competitorId: string, sortOrder: number): Finish {
  return {
    id,
    raceId: 'r1',
    competitorId,
    sortOrder,
    tiedWithPrevious: false,
    resultCode: null,
    startPresent: null,
    penaltyCode: null,
    penaltyOverride: null,
    redressMethod: null,
    redressExcludeRaceIds: null,
    redressIncludeRaceIds: null,
    redressIncludeAllLater: false,
    redressPoints: null,
  };
}

const FINISHES = [
  finish('f1', 'c1', 1),
  finish('f2', 'c3', 2),
  finish('f3', 'c2', 3),
  finish('f4', 'c4', 4),
];

function makeRepos(raceStarts: RaceStart[], finishes: Finish[]): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => finishes },
    raceStartRepo: { listBySeries: async () => raceStarts },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
    splitFleets: {
      get: async () => ({
        config: defaultSplitFleetConfig(2),
        rounds: [
          {
            id: 'round1', seriesId: 's1', stage: 'qualifying', roundNumber: 1,
            fromStageRace: 1, fleetIds: ['f-red', 'f-blue'], method: 'seeded',
            basis: null, overrides: {}, createdAt: 0,
          },
        ],
      }),
    },
  } as unknown as ExportRepos;
}

describe('buildFleetHtmlFiles — split-fleet per-race results', () => {
  it('emits the page between the championship and the assignments', async () => {
    const files = await buildFleetHtmlFiles(makeRepos(RACE_STARTS, FINISHES), 's1');
    expect(files!.map((f) => f.fleetName)).toEqual([
      'Championship',
      'Race results',
      'Fleet assignments',
    ]);
    const racePage = files!.find((f) => f.fleetName === 'Race results')!;
    // A results page with a name of its own — never relabelled by listings,
    // never mistaken for the publication's standings page.
    expect(racePage.isNamedPage).toBe(true);
    expect(racePage.isDefault).toBeFalsy();
    expect(racePage.isAuxiliary).toBeFalsy();
    expect(racePage.html).toContain('id="q1"');
    expect(racePage.html).toContain('Red fleet');
    expect(racePage.html).toContain('Blue fleet');
  });

  it('deep-links the championship only when told where the page will live', async () => {
    const linked = await buildFleetHtmlFiles(makeRepos(RACE_STARTS, FINISHES), 's1', undefined, {
      raceResultsHref: 'race-results',
    });
    expect(linked![0].html).toContain('href="race-results#q1"');

    // Preview, download and FTP pass no location: plain headers.
    const plain = await buildFleetHtmlFiles(makeRepos(RACE_STARTS, FINISHES), 's1');
    expect(plain![0].html).not.toContain('race-results#q1');
  });

  it('emits no page — and no dangling links — before any stage race has sheet rows', async () => {
    const files = await buildFleetHtmlFiles(makeRepos(RACE_STARTS, []), 's1', undefined, {
      raceResultsHref: 'race-results',
    });
    expect(files!.map((f) => f.fleetName)).toEqual(['Championship', 'Fleet assignments']);
    expect(files![0].html).not.toContain('race-results#');
  });
});
