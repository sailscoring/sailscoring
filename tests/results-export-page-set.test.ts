/**
 * The build renders the page set `resolvePublishPages` declares (#541). This
 * is the seam that keeps the publish destinations honest: both list their
 * rows from the manifest, so anything the build emits beyond it lands
 * nowhere, and anything the manifest lists that the build never renders is a
 * row for a page that will not appear.
 *
 * The two are allowed to differ in exactly the ways the manifest documents:
 * it cannot see a data-empty page coming (nothing to score for it yet), and
 * it cannot see the synthetic "Unknown" fleet a series with orphan
 * competitors grows. Both are asserted here rather than assumed.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import { resolvePublishPages } from '@/lib/publish-pages';
import type { ExportRepos } from '@/lib/public-export';
import { defaultSplitFleetConfig } from '@/lib/split-fleets';
import type {
  Competitor,
  Finish,
  Fleet,
  PublishingGroup,
  Race,
  RaceStart,
  Series,
  SubSeries,
} from '@/lib/types';

const FLEETS: Fleet[] = [
  { id: 'f-scratch', seriesId: 's1', name: 'Scratch', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-hph', seriesId: 's1', name: 'HPH', displayOrder: 1, scoringSystem: 'scratch' },
];

const OVERALL: PublishingGroup = {
  id: 'g-overall',
  name: 'Overall',
  fleetMode: 'all',
  fleetIds: [],
  detail: 'standings',
};

function makeSeries(overrides: Partial<Series> = {}): Series {
  return {
    id: 's1',
    name: 'Autumn League',
    venue: 'HYC',
    startDate: '2026-09-01',
    endDate: '2026-10-30',
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
    ...overrides,
  } as Series;
}

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

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-05', createdAt: 0 },
  { id: 'r2', seriesId: 's1', raceNumber: 2, name: null, date: '2026-09-12', createdAt: 0 },
];

function finish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return {
    id: `${raceId}-${competitorId}`,
    raceId,
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

interface Shape {
  series: Series;
  fleets: Fleet[];
  competitors: Competitor[];
  subSeries?: SubSeries[];
  raceStarts?: RaceStart[];
  splitFleets?: boolean;
}

function makeRepos(shape: Shape): ExportRepos {
  const finishes = shape.competitors.flatMap((c, i) =>
    RACES.map((r) => finish(r.id, c.id, i + 1)),
  );
  return {
    seriesRepo: { get: async (id: string) => (id === 's1' ? shape.series : undefined) },
    competitorRepo: { listBySeries: async () => shape.competitors },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => shape.fleets },
    subSeriesRepo: { listBySeries: async () => shape.subSeries ?? [] },
    finishRepo: { listBySeries: async () => finishes },
    raceStartRepo: { listBySeries: async () => shape.raceStarts ?? [] },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
    ...(shape.splitFleets
      ? {
          splitFleets: {
            get: async () => ({
              config: defaultSplitFleetConfig(2),
              rounds: [
                {
                  id: 'round1',
                  seriesId: 's1',
                  stage: 'qualifying',
                  roundNumber: 1,
                  fromStageRace: 1,
                  fleetIds: shape.fleets.map((f) => f.id),
                  method: 'seeded',
                  basis: null,
                  overrides: {},
                  createdAt: 0,
                },
              ],
            }),
          },
        }
      : {}),
  } as unknown as ExportRepos;
}

const TWO_FLEET_COMPETITORS = [
  competitor('c1', '101', ['f-scratch']),
  competitor('c2', '102', ['f-scratch']),
  competitor('c3', '201', ['f-hph']),
  competitor('c4', '202', ['f-hph']),
];

// Every page the build renders, each named once — a block series renders one
// page per (block, page), which the manifest covers with a single entry.
async function builtPageNames(shape: Shape): Promise<string[]> {
  const build = await buildFleetHtmlFiles(makeRepos(shape), 's1', undefined, {
    includePrizes: true,
    includeEntryList: true,
  });
  return [...new Set((build?.files ?? []).map((f) => f.fleetName))];
}

function declaredPageNames(shape: Shape): string[] {
  return resolvePublishPages({
    series: shape.series,
    fleets: shape.fleets,
    ...(shape.splitFleets ? { splitFleets: true } : {}),
    features: { prizes: true, entryList: true },
  }).map((p) => p.name);
}

const PRIZES = [
  { id: 'p1', name: 'Overall winner', recipientCount: 1, clauses: [] },
] as Series['prizes'];

const SHAPES: Record<string, Shape> = {
  'several fleets': {
    series: makeSeries(),
    fleets: FLEETS,
    competitors: TWO_FLEET_COMPETITORS,
  },
  'one fleet': {
    series: makeSeries(),
    fleets: [FLEETS[0]],
    competitors: [competitor('c1', '101', ['f-scratch']), competitor('c2', '102', ['f-scratch'])],
  },
  'no fleets at all': {
    series: makeSeries(),
    fleets: [],
    competitors: [competitor('c1', '101', []), competitor('c2', '102', [])],
  },
  'a combined page': {
    series: makeSeries({ publishingGroups: [OVERALL] }),
    fleets: FLEETS,
    competitors: TWO_FLEET_COMPETITORS,
  },
  'a combined page with individual fleet pages off': {
    series: makeSeries({ publishingGroups: [OVERALL], publishIndividualFleetPages: false }),
    fleets: FLEETS,
    competitors: TWO_FLEET_COMPETITORS,
  },
  'prizes': {
    series: makeSeries({ prizes: PRIZES }),
    fleets: FLEETS,
    competitors: TWO_FLEET_COMPETITORS,
  },
  'sub-series blocks': {
    series: makeSeries(),
    fleets: FLEETS,
    competitors: TWO_FLEET_COMPETITORS,
    subSeries: [
      { id: 'b1', seriesId: 's1', name: 'Spring', displayOrder: 0, raceIds: ['r1'] },
      { id: 'b2', seriesId: 's1', name: 'Autumn', displayOrder: 1, raceIds: ['r2'] },
    ],
  },
  'a championship': {
    series: makeSeries(),
    fleets: FLEETS,
    competitors: TWO_FLEET_COMPETITORS,
    splitFleets: true,
    raceStarts: [
      {
        id: 'rs1',
        raceId: 'r1',
        fleetIds: ['f-scratch', 'f-hph'],
        startTime: '10:00:00',
        stage: 'qualifying',
        stageRaceNumber: 1,
      },
    ],
  },
};

describe('the build renders the declared page set', () => {
  for (const [label, shape] of Object.entries(SHAPES)) {
    it(`agrees with the manifest for a series with ${label}`, async () => {
      expect(await builtPageNames(shape)).toEqual(declaredPageNames(shape));
    });
  }
});

describe('where the manifest is knowingly approximate', () => {
  it('lists a championship race-results page the build drops until a stage race is sailed', async () => {
    const shape = { ...SHAPES['a championship'], raceStarts: [] };
    expect(declaredPageNames(shape)).toContain('Race results');
    expect(await builtPageNames(shape)).not.toContain('Race results');
  });

  it('lists results pages the build drops before the first race', async () => {
    const shape = SHAPES['several fleets'];
    const repos = {
      ...makeRepos(shape),
      raceRepo: { listBySeries: async () => [] },
      finishRepo: { listBySeries: async () => [] },
    } as unknown as ExportRepos;
    const build = await buildFleetHtmlFiles(repos, 's1', undefined, {
      includePrizes: true,
      includeEntryList: true,
    });
    expect(build!.files.map((f) => f.fleetName)).toEqual(['Entries']);
    expect(declaredPageNames(shape)).toContain('Scratch');
  });

  it('grows an Unknown page for competitors in no fleet, which the manifest cannot see', async () => {
    const shape: Shape = {
      series: makeSeries(),
      fleets: FLEETS,
      competitors: [...TWO_FLEET_COMPETITORS, competitor('c9', '909', [])],
    };
    const built = await builtPageNames(shape);
    expect(built).toContain('Unknown');
    // It renders where a fleet page renders — among them, not appended.
    expect(built.filter((name) => name !== 'Unknown')).toEqual(declaredPageNames(shape));
  });
});
