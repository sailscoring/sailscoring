/**
 * A race's fleet changes round-trip through the .sailscoring file (v80) and
 * the public JSON export (v18): both carry them, both imports put them back
 * on the new ids, and a change for a boat or fleet that is gone is dropped.
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

const overall: Fleet = { id: 'fl-o', seriesId: 's1', name: 'Overall', displayOrder: 0, scoringSystem: 'scratch' };
const twoHanded: Fleet = { id: 'fl-2', seriesId: 's1', name: 'Two-Handed', displayOrder: 1, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string, fleetIds: string[]): Competitor {
  return { id, seriesId: 's1', fleetIds, sailNumber: sail, names: [sail], clubs: [], gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, n: number, fleetChanges?: Race['fleetChanges']): Race {
  return { id, seriesId: 's1', raceNumber: n, name: null, date: '2026-05-23', createdAt: 0, ...(fleetChanges ? { fleetChanges } : {}) };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null };
}

// Loinnir sails race 2 crewed; Paradox sails it two-handed. A third entry is
// left behind by a deleted boat.
const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [makeCompetitor('c1', '53308', ['fl-o', 'fl-2']), makeCompetitor('c2', 'GBR 8593R', ['fl-o'])],
  fleets: [overall, twoHanded],
  races: [
    makeRace('r1', 1),
    makeRace('r2', 2, [
      { competitorId: 'c1', drop: ['fl-2'] },
      { competitorId: 'c2', add: ['fl-2'] },
      { competitorId: 'deleted', drop: ['fl-o'] },
    ]),
  ],
  subSeries: [],
  finishes: [makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2), makeFinish('r2', 'c2', 1), makeFinish('r2', 'c1', 2)],
  raceStarts: [],
  ratingOverrides: [],
};

/** Fake repos backed by the snapshot for reads, recording writes. */
function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedSubSeries: SubSeries[] = [];
  const savedRaces: Race[] = [];
  const savedSeries: Series[] = [];
  const savedFleets: Fleet[] = [];
  const savedCompetitors: Competitor[] = [];
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
      save: async (c: Competitor) => {
        savedCompetitors.push(c);
        return c;
      },
      saveMany: async (list: Competitor[]) => {
        savedCompetitors.push(...list);
      },
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
  return { repos, savedSubSeries, savedRaces, savedSeries, savedFleets, savedCompetitors };
}

describe('.sailscoring v80 fleet changes', () => {
  it('writes the live changes and reads them back onto the new ids', async () => {
    const file = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(file.races[0].fleetChanges).toBeUndefined();
    expect(file.races[1].fleetChanges).toEqual([
      { competitorId: 'c1', drop: ['fl-2'] },
      { competitorId: 'c2', add: ['fl-2'] },
    ]);

    const { repos, savedRaces, savedCompetitors, savedFleets } = makeRecordingRepos();
    await openSeriesFromFile(parseSeriesFile(JSON.stringify(file)), repos);
    const idOfSail = new Map(savedCompetitors.map((c) => [c.sailNumber, c.id]));
    const idOfFleet = new Map(savedFleets.map((f) => [f.name, f.id]));
    const race2 = savedRaces.find((r) => r.raceNumber === 2)!;
    expect(race2.fleetChanges).toEqual([
      { competitorId: idOfSail.get('53308'), drop: [idOfFleet.get('Two-Handed')] },
      { competitorId: idOfSail.get('GBR 8593R'), add: [idOfFleet.get('Two-Handed')] },
    ]);
    expect(savedRaces.find((r) => r.raceNumber === 1)!.fleetChanges).toBeUndefined();
  });
});

describe('public JSON export v18 fleet changes', () => {
  it('names boats by ref and fleets by name, and import puts them back', async () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    expect(data.version).toBe(20);
    expect(data.races[1].fleetChanges).toEqual([
      { competitorRef: '1', sailNumber: '53308', drop: ['Two-Handed'] },
      { competitorRef: '2', sailNumber: 'GBR 8593R', add: ['Two-Handed'] },
    ]);
    expect(data.races[0].fleetChanges).toBeUndefined();

    const { repos, savedRaces, savedCompetitors, savedFleets } = makeRecordingRepos();
    await importPublicExport(data, repos);
    const idOfSail = new Map(savedCompetitors.map((c) => [c.sailNumber, c.id]));
    const idOfFleet = new Map(savedFleets.map((f) => [f.name, f.id]));
    expect(savedRaces.find((r) => r.raceNumber === 2)!.fleetChanges).toEqual([
      { competitorId: idOfSail.get('53308'), drop: [idOfFleet.get('Two-Handed')] },
      { competitorId: idOfSail.get('GBR 8593R'), add: [idOfFleet.get('Two-Handed')] },
    ]);
  });
});
