/**
 * Sub-series serialization round-trips (#203): the v9 `.sailscoring` file
 * format and the public JSON export both carry blocks, and both import
 * paths rebuild them (with fresh ids) and keep race membership attached.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  openSeriesFromFile,
  parseSeriesFile,
  FORMAT_VERSION,
  type SeriesFileRepos,
} from '@/lib/series-file';
import {
  buildPublicExportFromSnapshot,
  importPublicExport,
  type ImportRepos,
} from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type {
  Competitor,
  Finish,
  Fleet,
  Race,
  RaceStart,
  Series,
  SubSeries,
} from '@/lib/types';

function makeSeries(id: string): Series {
  return {
    id,
    name: 'Frostbites',
    venue: 'HYC',
    startDate: '2026-11-01',
    endDate: '2027-03-31',
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
    enabledCompetitorFields: ['club'],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, name: sail, club: '', gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, n: number): Race {
  return { id, seriesId: 's1', raceNumber: n, name: null, date: '2026-11-01', createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null };
}

const winter: SubSeries = { id: 'ss-w', seriesId: 's1', name: 'Winter', displayOrder: 0, raceIds: ['r1', 'r2'] };
const spring: SubSeries = { id: 'ss-s', seriesId: 's1', name: 'Spring', displayOrder: 1, raceIds: ['r3'] };

const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [makeCompetitor('c1', '101'), makeCompetitor('c2', '102')],
  fleets: [fleet],
  races: [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)],
  subSeries: [winter, spring],
  finishes: [
    makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2),
    makeFinish('r2', 'c2', 1), makeFinish('r2', 'c1', 2),
    makeFinish('r3', 'c1', 1), makeFinish('r3', 'c2', 2),
  ],
  raceStarts: [],
  ratingOverrides: [],
};

/** Fake repos backed by the snapshot for reads, recording writes. */
function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedSubSeries: SubSeries[] = [];
  const savedRaces: Race[] = [];
  const savedSeries: Series[] = [];
  const savedFleets: Fleet[] = [];
  const repos = {
    seriesRepo: {
      get: async (id: string) => (read && id === read.series.id ? read.series : undefined),
      save: async (s: Series) => {
        savedSeries.push(s);
        return s;
      },
    },
    fleetRepo: {
      listBySeries: async () => read?.fleets ?? [],
      save: async (f: Fleet) => {
        savedFleets.push(f);
        return f;
      },
      saveMany: async (list: Fleet[]) => {
        savedFleets.push(...list);
      },
    },
    competitorRepo: {
      listBySeries: async () => read?.competitors ?? [],
      save: async (c: Competitor) => c,
      saveMany: async () => {},
    },
    raceRepo: {
      listBySeries: async () => read?.races ?? [],
      save: async (r: Race) => {
        savedRaces.push(r);
        return r;
      },
    },
    subSeriesRepo: {
      listBySeries: async () => read?.subSeries ?? [],
      saveMany: async (list: SubSeries[]) => {
        savedSubSeries.push(...list);
      },
    },
    finishRepo: {
      listBySeries: async () => read?.finishes ?? [],
      saveMany: async () => {},
    },
    raceStartRepo: {
      listBySeries: async () => read?.raceStarts ?? [],
      save: async (rs: RaceStart) => rs,
      saveMany: async () => {},
    },
    raceRatingOverrideRepo: {
      listBySeries: async () => read?.ratingOverrides ?? [],
      listByRaces: async () => [],
      saveMany: async () => {},
    },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos & ImportRepos;
  return { repos, savedSubSeries, savedRaces, savedSeries, savedFleets };
}

describe('.sailscoring v9 sub-series round-trip', () => {
  it('buildSeriesFile carries sub-series with race membership', async () => {
    const { repos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', repos);

    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(file.subSeries).toEqual([
      { id: 'ss-w', name: 'Winter', displayOrder: 0, raceIds: ['r1', 'r2'] },
      { id: 'ss-s', name: 'Spring', displayOrder: 1, raceIds: ['r3'] },
    ]);
    expect(file.races.every((r) => !('subSeriesId' in r))).toBe(true);

    // The serialized file parses back without loss.
    const reparsed = parseSeriesFile(JSON.stringify(file));
    expect(reparsed.subSeries).toEqual(file.subSeries);
  });

  it('a series with no sub-series writes no subSeries key', async () => {
    const { repos } = makeRecordingRepos({ ...snapshot, subSeries: [] });
    const file = await buildSeriesFile('s1', repos);
    expect(file.subSeries).toBeUndefined();
  });

  it('openSeriesFromFile rebuilds sub-series with fresh ids and remapped membership', async () => {
    const built = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    const { repos, savedSubSeries, savedRaces } = makeRecordingRepos();
    await openSeriesFromFile(built, repos);

    expect(savedSubSeries.map((ss) => ss.name)).toEqual(['Winter', 'Spring']);
    expect(savedSubSeries.every((ss) => ss.id !== 'ss-w' && ss.id !== 'ss-s')).toBe(true);

    // Membership references the freshly-minted race ids, in race order.
    const raceIdByNumber = new Map(savedRaces.map((r) => [r.raceNumber, r.id]));
    const newWinter = savedSubSeries.find((ss) => ss.name === 'Winter')!;
    const newSpring = savedSubSeries.find((ss) => ss.name === 'Spring')!;
    expect(newWinter.raceIds).toEqual([raceIdByNumber.get(1), raceIdByNumber.get(2)]);
    expect(newSpring.raceIds).toEqual([raceIdByNumber.get(3)]);
  });

  it('parseSeriesFile rejects a non-list subSeries', () => {
    const built = { formatVersion: 9, seriesId: 's1', exportedAt: 'x', series: {}, fleets: [], competitors: [], races: [], subSeries: 'nope' };
    expect(() => parseSeriesFile(JSON.stringify(built))).toThrow(/subSeries/);
  });
});

describe('.sailscoring v10 race name round-trip', () => {
  const named: SeriesSnapshot = {
    ...snapshot,
    races: [
      { id: 'r1', seriesId: 's1', raceNumber: 1, name: "New Year's Day Race", date: '2026-11-01', createdAt: 0 },
      makeRace('r2', 2),
      { id: 'r3', seriesId: 's1', raceNumber: 3, name: 'Round the Island', date: '2026-11-01', createdAt: 0 },
    ],
  };

  it('buildSeriesFile writes a name only for named races, and parses back without loss', async () => {
    const { repos } = makeRecordingRepos(named);
    const file = await buildSeriesFile('s1', repos);

    expect(file.races.map((r) => r.name)).toEqual(["New Year's Day Race", undefined, 'Round the Island']);

    const reparsed = parseSeriesFile(JSON.stringify(file));
    expect(reparsed.races.map((r) => r.name)).toEqual(["New Year's Day Race", undefined, 'Round the Island']);
  });

  it('openSeriesFromFile restores race names (and defaults unnamed to null)', async () => {
    const built = await buildSeriesFile('s1', makeRecordingRepos(named).repos);
    const { repos, savedRaces } = makeRecordingRepos();
    await openSeriesFromFile(built, repos);

    const nameByNumber = new Map(savedRaces.map((r) => [r.raceNumber, r.name]));
    expect(nameByNumber.get(1)).toBe("New Year's Day Race");
    expect(nameByNumber.get(2)).toBeNull();
    expect(nameByNumber.get(3)).toBe('Round the Island');
  });

  it('public JSON export carries the race name and import restores it', async () => {
    const data = buildPublicExportFromSnapshot(named);
    expect(data!.races.map((r) => r.name)).toEqual(["New Year's Day Race", undefined, 'Round the Island']);

    const { repos, savedRaces } = makeRecordingRepos();
    await importPublicExport(data!, repos);
    const nameByNumber = new Map(savedRaces.map((r) => [r.raceNumber, r.name]));
    expect(nameByNumber.get(1)).toBe("New Year's Day Race");
    expect(nameByNumber.get(2)).toBeNull();
    expect(nameByNumber.get(3)).toBe('Round the Island');
  });
});

describe('public JSON export sub-series round-trip', () => {
  it('export names each race\'s sub-series; import rebuilds them with membership', async () => {
    const data = buildPublicExportFromSnapshot(snapshot);
    expect(data).not.toBeNull();
    expect(data!.races.map((r) => r.subSeries)).toEqual([['Winter'], ['Winter'], ['Spring']]);

    const { repos, savedSubSeries, savedRaces } = makeRecordingRepos();
    await importPublicExport(data!, repos);

    expect(savedSubSeries.map((ss) => ss.name)).toEqual(['Winter', 'Spring']);
    expect(savedSubSeries.map((ss) => ss.displayOrder)).toEqual([0, 1]);
    const raceIdByNumber = new Map(savedRaces.map((r) => [r.raceNumber, r.id]));
    const newWinter = savedSubSeries.find((ss) => ss.name === 'Winter')!;
    const newSpring = savedSubSeries.find((ss) => ss.name === 'Spring')!;
    expect(newWinter.raceIds).toEqual([raceIdByNumber.get(1), raceIdByNumber.get(2)]);
    expect(newSpring.raceIds).toEqual([raceIdByNumber.get(3)]);
  });

  it('an export with no sub-series carries no subSeries keys', () => {
    const data = buildPublicExportFromSnapshot({ ...snapshot, subSeries: [] });
    expect(data!.races.every((r) => r.subSeries === undefined)).toBe(true);
  });
});

describe('sub-series fleet-scoping + per-fleet exclusion round-trip', () => {
  const fleet2: Fleet = { id: 'fl-2', seriesId: 's1', name: 'Whitesails', displayOrder: 1, scoringSystem: 'scratch' };
  // 'Champ' is scoped to fleet 1 and strikes race 2 for fleet 1.
  const champ: SubSeries = {
    id: 'ss-champ', seriesId: 's1', name: 'Champ', displayOrder: 2,
    raceIds: ['r1', 'r2', 'r3'],
    fleetIds: ['fl-1'],
    raceFleetExclusions: [{ raceId: 'r2', fleetId: 'fl-1' }],
    excludeDncOnlyCompetitors: true,
  };
  const scopedSnapshot: SeriesSnapshot = {
    ...snapshot,
    fleets: [fleet, fleet2],
    subSeries: [winter, spring, champ],
  };

  it('.sailscoring carries fleetIds + exclusions and parses back without loss', async () => {
    const { repos } = makeRecordingRepos(scopedSnapshot);
    const file = await buildSeriesFile('s1', repos);
    const champFile = file.subSeries!.find((s) => s.name === 'Champ')!;
    expect(champFile.fleetIds).toEqual(['fl-1']);
    expect(champFile.raceFleetExclusions).toEqual([{ raceId: 'r2', fleetId: 'fl-1' }]);
    expect(champFile.excludeDncOnlyCompetitors).toBe(true);

    const reparsed = parseSeriesFile(JSON.stringify(file));
    expect(reparsed.subSeries).toEqual(file.subSeries);
  });

  it('.sailscoring import remaps fleetIds + exclusions consistently', async () => {
    const built = await buildSeriesFile('s1', makeRecordingRepos(scopedSnapshot).repos);
    const { repos, savedSubSeries, savedRaces } = makeRecordingRepos();
    await openSeriesFromFile(built, repos);

    const champ = savedSubSeries.find((ss) => ss.name === 'Champ')!;
    const race2Id = savedRaces.find((r) => r.raceNumber === 2)!.id;
    expect(champ.fleetIds).toHaveLength(1);
    expect(champ.raceFleetExclusions).toHaveLength(1);
    expect(champ.excludeDncOnlyCompetitors).toBe(true);
    // The remapped exclusion points at the same (remapped) fleet the block is
    // scoped to, and at the freshly-minted race-2 id.
    expect(champ.raceFleetExclusions![0].fleetId).toBe(champ.fleetIds![0]);
    expect(champ.raceFleetExclusions![0].raceId).toBe(race2Id);
  });

  it('public JSON export carries scoping by name; import rebuilds it', async () => {
    const data = buildPublicExportFromSnapshot(scopedSnapshot);
    expect(data!.subSeries).toEqual([
      { name: 'Champ', fleetNames: ['Default'], raceExclusions: [{ raceNumber: 2, fleetName: 'Default' }], excludeDncOnlyCompetitors: true },
    ]);

    const { repos, savedSubSeries, savedRaces } = makeRecordingRepos();
    await importPublicExport(data!, repos);
    const champ = savedSubSeries.find((ss) => ss.name === 'Champ')!;
    const race2Id = savedRaces.find((r) => r.raceNumber === 2)!.id;
    expect(champ.fleetIds).toHaveLength(1);
    expect(champ.raceFleetExclusions).toEqual([{ raceId: race2Id, fleetId: champ.fleetIds![0] }]);
    expect(champ.excludeDncOnlyCompetitors).toBe(true);
  });
});

describe('series-scoped per-fleet exclusion round-trip', () => {
  const fleet2: Fleet = { id: 'fl-2', seriesId: 's1', name: 'Whitesails', displayOrder: 1, scoringSystem: 'scratch' };
  // Whole-series (no sub-series): race 2 struck for the Whitesails fleet.
  const exclSnapshot: SeriesSnapshot = {
    ...snapshot,
    fleets: [fleet, fleet2],
    subSeries: [],
    series: { ...makeSeries('s1'), raceFleetExclusions: [{ raceId: 'r2', fleetId: 'fl-2' }] },
  };

  it('.sailscoring (v14) carries series.raceFleetExclusions and parses back without loss', async () => {
    const { repos } = makeRecordingRepos(exclSnapshot);
    const file = await buildSeriesFile('s1', repos);
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(file.series.raceFleetExclusions).toEqual([{ raceId: 'r2', fleetId: 'fl-2' }]);

    const reparsed = parseSeriesFile(JSON.stringify(file));
    expect(reparsed.series.raceFleetExclusions).toEqual([{ raceId: 'r2', fleetId: 'fl-2' }]);
  });

  it('a series with no exclusions writes no raceFleetExclusions key', async () => {
    const { repos } = makeRecordingRepos({ ...snapshot, subSeries: [] });
    const file = await buildSeriesFile('s1', repos);
    expect(file.series.raceFleetExclusions).toBeUndefined();
  });

  it('.sailscoring import remaps the exclusion onto the fresh race + fleet ids', async () => {
    const built = await buildSeriesFile('s1', makeRecordingRepos(exclSnapshot).repos);
    const { repos, savedSeries, savedRaces, savedFleets } = makeRecordingRepos();
    await openSeriesFromFile(built, repos);

    const saved = savedSeries.at(-1)!;
    const race2Id = savedRaces.find((r) => r.raceNumber === 2)!.id;
    const whitesailsId = savedFleets.find((f) => f.name === 'Whitesails')!.id;
    expect(saved.raceFleetExclusions).toEqual([{ raceId: race2Id, fleetId: whitesailsId }]);
  });

  it('public JSON export carries the exclusion by name; import rebuilds it', async () => {
    const data = buildPublicExportFromSnapshot(exclSnapshot);
    expect(data!.series.raceFleetExclusions).toEqual([{ raceNumber: 2, fleetName: 'Whitesails' }]);

    const { repos, savedSeries, savedRaces, savedFleets } = makeRecordingRepos();
    await importPublicExport(data!, repos);
    const saved = savedSeries.at(-1)!;
    const race2Id = savedRaces.find((r) => r.raceNumber === 2)!.id;
    const whitesailsId = savedFleets.find((f) => f.name === 'Whitesails')!.id;
    expect(saved.raceFleetExclusions).toEqual([{ raceId: race2Id, fleetId: whitesailsId }]);
  });
});

describe('buildFleetHtmlFiles with sub-series', () => {
  it('renders one page per (block, fleet) with block-local race numbers', async () => {
    const { buildFleetHtmlFiles } = await import('@/lib/results-export');
    const { repos } = makeRecordingRepos(snapshot);
    const files = await buildFleetHtmlFiles(repos, 's1');
    expect(files).not.toBeNull();
    expect(files!.map((f) => f.subSeriesName)).toEqual(['Winter', 'Spring']);

    const winterPage = files![0];
    expect(winterPage.html).toContain('Frostbites — Winter');
    // Two Winter races, numbered within the block.
    expect(winterPage.html).toContain('R1');
    expect(winterPage.html).toContain('R2');

    const springPage = files![1];
    expect(springPage.html).toContain('Frostbites — Spring');
    // The lone Spring race is R1 in its block, not series-wide R3.
    expect(springPage.html).not.toContain('>R3<');
  });

  it('a series with no sub-series still renders one page per fleet', async () => {
    const { buildFleetHtmlFiles } = await import('@/lib/results-export');
    const blockless: SeriesSnapshot = { ...snapshot, subSeries: [] };
    const { repos } = makeRecordingRepos(blockless);
    const files = await buildFleetHtmlFiles(repos, 's1');
    expect(files).toHaveLength(1);
    expect(files![0].subSeriesName).toBeUndefined();
  });

  it('a fleet-scoped block publishes a page only for its scoped fleets', async () => {
    const { buildFleetHtmlFiles } = await import('@/lib/results-export');
    const fleetA: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Cruisers', displayOrder: 0, scoringSystem: 'scratch' };
    const fleetB: Fleet = { id: 'fl-2', seriesId: 's1', name: 'Whitesails', displayOrder: 1, scoringSystem: 'scratch' };
    const inA = (id: string, sail: string): Competitor => ({ ...makeCompetitor(id, sail), fleetIds: ['fl-1'] });
    const inB = (id: string, sail: string): Competitor => ({ ...makeCompetitor(id, sail), fleetIds: ['fl-2'] });
    const scopedSnap: SeriesSnapshot = {
      series: makeSeries('s1'),
      fleets: [fleetA, fleetB],
      competitors: [inA('a1', '1'), inA('a2', '2'), inB('b1', '11'), inB('b2', '12')],
      races: [makeRace('r1', 1), makeRace('r2', 2)],
      subSeries: [
        { id: 'all', seriesId: 's1', name: 'Overall', displayOrder: 0, raceIds: ['r1', 'r2'] },
        { id: 'champ', seriesId: 's1', name: 'Cruiser Champ', displayOrder: 1, raceIds: ['r1', 'r2'], fleetIds: ['fl-1'] },
      ],
      finishes: [
        makeFinish('r1', 'a1', 1), makeFinish('r1', 'a2', 2), makeFinish('r1', 'b1', 3), makeFinish('r1', 'b2', 4),
        makeFinish('r2', 'a1', 1), makeFinish('r2', 'a2', 2), makeFinish('r2', 'b1', 3), makeFinish('r2', 'b2', 4),
      ],
      raceStarts: [],
      ratingOverrides: [],
    };
    const { repos } = makeRecordingRepos(scopedSnap);
    const files = await buildFleetHtmlFiles(repos, 's1');
    const pages = files!.map((f) => `${f.subSeriesName}/${f.fleetName}`);
    // Overall publishes both fleets; the scoped block only its one fleet.
    expect(pages).toEqual(['Overall/Cruisers', 'Overall/Whitesails', 'Cruiser Champ/Cruisers']);
  });
});
