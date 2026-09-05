/**
 * The published competitor list (#423): the entry list, which is the one page
 * a series can publish before any race has been sailed. Opt-in via
 * `includeEntryList`, so the FTP path — whose per-fleet path mapping has no
 * slot for a non-fleet page — never sees it.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';

// buildFleetHtmlFiles returns { files, exportJson? }; these tests assert on
// the pages, so unwrap to the file list (null stays null).
const buildFleetFiles = async (...args: Parameters<typeof buildFleetHtmlFiles>) =>
  (await buildFleetHtmlFiles(...args))?.files ?? null;
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, Series } from '@/lib/types';
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
  enabledCompetitorFields: ['tallyNumber'],
  primaryPersonLabel: 'helm',
  subdivisionAxes: [],
  publishingGroups: [],
  publishIndividualFleetPages: true,
};

const FLEETS: Fleet[] = [
  { id: 'f-red', seriesId: 's1', name: 'Red', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-blue', seriesId: 's1', name: 'Blue', displayOrder: 1, scoringSystem: 'scratch' },
];

function competitor(id: string, sail: string, fleetIds: string[], tallyNumber?: string): Competitor {
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
    ...(tallyNumber ? { tallyNumber } : {}),
  };
}

// Deliberately listed blue-first so the fleet ordering is actually exercised.
const COMPETITORS = [
  competitor('c1', '101', ['f-blue'], 'T0002'),
  competitor('c2', '201', ['f-red'], 'T0001'),
];

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-08-24', createdAt: 0 },
];

const FINISHES: Finish[] = [
  { id: 'r1-c1', raceId: 'r1', competitorId: 'c1', sortOrder: 1, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null },
];

function makeRepos(races: Race[], finishes: Finish[]): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => races },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => finishes },
    raceStartRepo: { listBySeries: async () => [] },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

/** The stock two-fleet championship; the shape of its pages is
 *  `split-fleets-render`'s business, not this test's. */
const SPLIT_CONFIG = defaultSplitFleetConfig(2);

describe('buildFleetHtmlFiles — the competitor list', () => {
  it('publishes the entry list for a series with no races yet', async () => {
    const files = await buildFleetFiles(makeRepos([], []), 's1', undefined, {
      includeEntryList: true,
    });
    expect(files).not.toBeNull();
    expect(files!.map((f) => f.fleetName)).toEqual(['Entries']);
    expect(files![0].isEntryList).toBe(true);
    expect(files![0].html).toContain('Competitor List');
    expect(files![0].html).toContain('T0001');
  });

  it('still publishes nothing for a raceless series when not asked for it', async () => {
    // The FTP path relies on this: its per-fleet path mapping has no slot for
    // a page that isn't a fleet's.
    expect(await buildFleetFiles(makeRepos([], []), 's1')).toBeNull();
  });

  it('appends the entry list after the results pages once racing starts', async () => {
    const files = await buildFleetFiles(makeRepos(RACES, FINISHES), 's1', undefined, {
      includeEntryList: true,
    });
    expect(files!.map((f) => f.fleetName)).toContain('Entries');
    // Last, after the fleet pages — supplementary to the results, not ahead of them.
    expect(files![files!.length - 1].fleetName).toBe('Entries');
  });

  it('leaves the entry list out of an ordinary export', async () => {
    const files = await buildFleetFiles(makeRepos(RACES, FINISHES), 's1');
    expect(files!.map((f) => f.fleetName)).not.toContain('Entries');
  });

  it('orders entries by fleet display order, then sail number', async () => {
    const files = await buildFleetFiles(makeRepos([], []), 's1', undefined, {
      includeEntryList: true,
    });
    const html = files![0].html;
    // Red is displayOrder 0, so 201 (Red) precedes 101 (Blue) despite the
    // sail-number order and the order the competitors were listed in.
    expect(html.indexOf('201')).toBeLessThan(html.indexOf('101'));
    expect(html).toContain('<th>Fleet</th>');
  });

  it('carries the starters checklist, one table per fleet-as-start', async () => {
    const files = await buildFleetFiles(makeRepos([], []), 's1', undefined, {
      includeEntryList: true,
    });
    const html = files![0].html;
    // Red and Blue share no boat, so each is its own start and its own table.
    expect(html).toContain('<h3>Red</h3>');
    expect(html).toContain('<h3>Blue</h3>');
    expect(html).toContain('<td class="sail">201</td><td class="tick"></td>');
    expect(html).toContain('Print starters checklist');
  });

  it('publishes the entry list for a split-fleet series with no races', async () => {
    // A split-fleet series has no Standings tab, so the Split Fleets page is
    // the only place publishing is reachable — and before race one the entry
    // list is the only page there is. The no-races path runs ahead of the
    // split-fleet branch, which needs races to produce anything.
    const repos = {
      ...makeRepos([], []),
      splitFleets: {
        get: async () => ({
          config: { qualifying: {}, finalFleets: [] },
          rounds: [{ id: 'r1', roundNumber: 1, fleetIds: [] }],
        }),
      },
    } as unknown as ExportRepos;
    const files = await buildFleetFiles(repos, 's1', undefined, { includeEntryList: true });
    expect(files!.map((f) => f.fleetName)).toEqual(['Entries']);
    expect(files![0].html).toContain('Competitor List');
  });

  it('appends the entry list to a split-fleet series that has raced', async () => {
    // The split-fleet branch returns its own pages and never reaches the
    // append at the end of the per-fleet path, so it has to carry the entry
    // list itself. Without this the publish dialog offers an Entries page the
    // build never produces: ticking it publishes the championship pages and
    // leaves Entries permanently unpublished.
    const repos = {
      ...makeRepos(RACES, FINISHES),
      splitFleets: {
        get: async () => ({
          config: SPLIT_CONFIG,
          rounds: [
            {
              id: 'r1', seriesId: 's1', stage: 'qualifying', roundNumber: 1,
              fromStageRace: 1, fleetIds: ['f-red', 'f-blue'], method: 'seeded',
              basis: null, overrides: {}, createdAt: 0,
            },
          ],
        }),
      },
    } as unknown as ExportRepos;
    const files = await buildFleetFiles(repos, 's1', undefined, { includeEntryList: true });
    const names = files!.map((f) => f.fleetName);
    expect(names).toContain('Championship');
    expect(names).toContain('Entries');
    expect(files!.find((f) => f.fleetName === 'Entries')!.isEntryList).toBe(true);
  });

  it('leaves a split-fleet series alone when the entry list is not asked for', async () => {
    const repos = {
      ...makeRepos(RACES, FINISHES),
      splitFleets: {
        get: async () => ({
          config: SPLIT_CONFIG,
          rounds: [
            {
              id: 'r1', seriesId: 's1', stage: 'qualifying', roundNumber: 1,
              fromStageRace: 1, fleetIds: ['f-red', 'f-blue'], method: 'seeded',
              basis: null, overrides: {}, createdAt: 0,
            },
          ],
        }),
      },
    } as unknown as ExportRepos;
    const files = await buildFleetFiles(repos, 's1');
    expect(files!.map((f) => f.fleetName)).not.toContain('Entries');
  });

  it('never shows the app\'s own fleet names to a reader', async () => {
    // A split-fleet assignment appends the round fleet and leaves the
    // series-creation "Default" membership in place, so a boat carries both.
    // The page must read "Yellow", not "Default, Yellow".
    const fleets: Fleet[] = [
      { id: 'f-default', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' },
      ...FLEETS,
    ];
    const repos = {
      ...makeRepos([], []),
      fleetRepo: { listBySeries: async () => fleets },
      competitorRepo: {
        listBySeries: async () => [
          competitor('c1', '101', ['f-default', 'f-blue']),
          competitor('c2', '201', ['f-default', 'f-red']),
        ],
      },
    } as unknown as ExportRepos;
    const html = (await buildFleetFiles(repos, 's1', undefined, { includeEntryList: true }))![0].html;
    // Cell-scoped: the page's own script legitimately says "preventDefault".
    expect(html).not.toContain('<td>Default');
    expect(html).toContain('<td>Blue</td>');
    expect(html).toContain('<td>Red</td>');
  });

  it('names the round a boat is racing in now, not every round it has been in', async () => {
    // Each assignment round mints its own fleets, reusing the labels, and
    // membership is appended — so two rounds in, a boat is in Yellow *and*
    // Blue. The page should say Blue: the fleet it is in now.
    const fleets: Fleet[] = [
      { id: 'f-default', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' },
      { id: 'r1-yellow', seriesId: 's1', name: 'Yellow', displayOrder: 1, scoringSystem: 'scratch', splitRoundId: 'round-1' },
      { id: 'r1-blue', seriesId: 's1', name: 'Blue', displayOrder: 2, scoringSystem: 'scratch', splitRoundId: 'round-1' },
      { id: 'r2-yellow', seriesId: 's1', name: 'Yellow', displayOrder: 3, scoringSystem: 'scratch', splitRoundId: 'round-2' },
      { id: 'r2-blue', seriesId: 's1', name: 'Blue', displayOrder: 4, scoringSystem: 'scratch', splitRoundId: 'round-2' },
    ];
    const repos = {
      ...makeRepos([], []),
      fleetRepo: { listBySeries: async () => fleets },
      competitorRepo: {
        listBySeries: async () => [
          // Yellow in round 1, moved to Blue for round 2.
          competitor('c1', '101', ['f-default', 'r1-yellow', 'r2-blue']),
          // Yellow throughout — still one name, not "Yellow, Yellow".
          competitor('c2', '201', ['f-default', 'r1-yellow', 'r2-yellow']),
        ],
      },
    } as unknown as ExportRepos;
    const html = (await buildFleetFiles(repos, 's1', undefined, { includeEntryList: true }))![0].html;
    expect(html).toContain('<td>Blue</td>');
    expect(html).toContain('<td>Yellow</td>');
    expect(html).not.toContain('Yellow, Blue');
    expect(html).not.toContain('Yellow, Yellow');
    expect(html).not.toContain('<td>Default');
  });

  it('drops the Fleet column when only the synthetic fleet would fill it', async () => {
    const repos = {
      ...makeRepos([], []),
      fleetRepo: {
        listBySeries: async () => [
          { id: 'f-default', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' },
        ],
      },
      competitorRepo: {
        listBySeries: async () => [competitor('c1', '101', ['f-default'])],
      },
    } as unknown as ExportRepos;
    const html = (await buildFleetFiles(repos, 's1', undefined, { includeEntryList: true }))![0].html;
    expect(html).not.toContain('<th>Fleet</th>');
  });

  it('publishes nothing at all for a series with no competitors', async () => {
    const repos = {
      ...makeRepos([], []),
      competitorRepo: { listBySeries: async () => [] },
    } as unknown as ExportRepos;
    expect(await buildFleetFiles(repos, 's1', undefined, { includeEntryList: true })).toBeNull();
  });
});
