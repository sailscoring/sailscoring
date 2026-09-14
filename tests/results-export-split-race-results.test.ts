/**
 * The split-fleet per-race results page through the shared build: emitted
 * between the championship and the fleet assignments once a stage race has
 * sheet rows, and the championship deep-links into it only when the caller
 * says where it will be served — the publish path does; preview, download
 * and FTP do not.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';

// buildFleetHtmlFiles returns { files, exportJson? }; these tests assert on
// the pages, so unwrap to the file list (null stays null).
const buildFleetFiles = async (...args: Parameters<typeof buildFleetHtmlFiles>) =>
  (await buildFleetHtmlFiles(...args))?.files ?? null;
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
  enabledCompetitorFields: [],
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
    clubs: [],
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
    const files = await buildFleetFiles(makeRepos(RACE_STARTS, FINISHES), 's1');
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
    const linked = await buildFleetFiles(makeRepos(RACE_STARTS, FINISHES), 's1', undefined, {
      raceResultsHref: 'race-results',
    });
    expect(linked![0].html).toContain('href="race-results#q1"');

    // Preview, download and FTP pass no location: plain headers.
    const plain = await buildFleetFiles(makeRepos(RACE_STARTS, FINISHES), 's1');
    expect(plain![0].html).not.toContain('race-results#q1');
  });

  it('publishes nothing before any stage race has sheet rows (#556)', async () => {
    // The stage races have their guns and not one boat row, so they are not
    // published (#513, #556) — which leaves the championship with no race at
    // all, the same window as a series before race one. No page, and so no
    // championship page to dangle a race-results link off.
    const files = await buildFleetFiles(makeRepos(RACE_STARTS, []), 's1', undefined, {
      raceResultsHref: 'race-results',
    });
    expect(files).toBeNull();
  });
});

/**
 * The race record through the same build (#338/#339). The championship pages
 * assemble their own chrome, which is how they came to publish none of it:
 * the data file beside the page carried the officials and the page did not.
 */
describe('buildFleetHtmlFiles — the race record on championship pages', () => {
  const TEAM = [
    { id: 'o1', role: 'raceOfficer' as const, name: 'Jane Smith' },
    { id: 'o2', role: 'other' as const, name: 'Sam Doyle', customRole: 'Beach Master' },
  ];
  const RACE_TEAM = [{ id: 'o3', role: 'recorder' as const, name: 'Tom Byrne' }];

  /** The standard repos with the series and its one race patched. */
  function reposWith(series: Partial<Series>, race: Partial<Race> = {}): ExportRepos {
    const base = makeRepos(RACE_STARTS, FINISHES);
    return {
      ...base,
      seriesRepo: { get: async (id: string) => (id === 's1' ? { ...SERIES, ...series } : undefined) },
      raceRepo: { listBySeries: async () => RACES.map((r) => ({ ...r, ...race })) },
    } as unknown as ExportRepos;
  }

  it('names the standing team on every page once the series opts in', async () => {
    const files = await buildFleetFiles(
      reposWith({ officials: TEAM, publishOfficials: true }),
      's1',
    );
    expect(files!.map((f) => f.fleetName)).toEqual([
      'Championship',
      'Race results',
      'Fleet assignments',
    ]);
    for (const f of files!) {
      expect(f.html).toContain('class="seriesofficials"');
      expect(f.html).toContain('Race Officer: Jane Smith · Beach Master: Sam Doyle');
    }
  });

  it('publishes no team while the series has not opted in', async () => {
    const files = await buildFleetFiles(reposWith({ officials: TEAM }), 's1');
    for (const f of files!) {
      expect(f.html).not.toContain('seriesofficials');
      expect(f.html).not.toContain('Jane Smith');
    }
  });

  it('carries a race’s own conditions and team onto the race-results page', async () => {
    const files = await buildFleetFiles(
      reposWith(
        { publishOfficials: true },
        {
          conditions: { windSpeedMin: 8, windSpeedMax: 14, windDirection: 'SW' },
          officials: RACE_TEAM,
        },
      ),
      's1',
    );
    const racePage = files!.find((f) => f.fleetName === 'Race results')!;
    expect(racePage.html).toContain('Wind 8–14 kt SW');
    expect(racePage.html).toContain('Recorder: Tom Byrne');
    // Both fleets sailed the one race, so the record is stated once for it
    // rather than repeated under each fleet's table.
    expect(racePage.html.split('class="raceconditions"').length - 1).toBe(1);
    expect(racePage.html.split('class="raceofficials"').length - 1).toBe(1);
  });

  it('carries the conditions but not the team when the series has not opted in', async () => {
    const files = await buildFleetFiles(
      reposWith(
        {},
        {
          conditions: { windSpeedMin: 8, windSpeedMax: 14, windDirection: 'SW' },
          officials: RACE_TEAM,
        },
      ),
      's1',
    );
    const racePage = files!.find((f) => f.fleetName === 'Race results')!;
    expect(racePage.html).toContain('Wind 8–14 kt SW');
    expect(racePage.html).not.toContain('Tom Byrne');
  });
});
