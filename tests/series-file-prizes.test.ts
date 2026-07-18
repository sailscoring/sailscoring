/**
 * Prize-list serialization (#240): the v17 `.sailscoring` file carries
 * `series.prizes` (sparse — written only when non-empty), and the import
 * paths remap fleet references inside prize clauses onto the freshly-minted
 * fleet ids — axis ids are stable and travel verbatim.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  FORMAT_VERSION,
  openSeriesFromFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import {
  buildPublicExportFromSnapshot,
  importPublicExport,
} from '@/lib/public-export';
import type {
  Competitor,
  Finish,
  Fleet,
  Prize,
  Race,
  RaceStart,
  Series,
  SubSeries,
} from '@/lib/types';
import type { SeriesSnapshot } from '@/lib/series-snapshot';

const PRIZES: Prize[] = [
  {
    id: 'p-gold',
    name: 'Gold Fleet 1st, 2nd, 3rd',
    recipientCount: 3,
    clauses: [{ kind: 'axis', axisId: 'axis-div', value: 'Gold' }],
  },
  {
    id: 'p-overall',
    name: 'Overall 1st',
    recipientCount: 1,
    clauses: [
      { kind: 'fleet', fleetId: 'fl-1' },
      { kind: 'rank', max: 1 },
    ],
  },
];

function makeSeries(id: string): Series {
  return {
    id,
    name: 'ILCA Leinsters',
    venue: 'Sligo YC',
    startDate: '2026-07-04',
    endDate: '2026-07-05',
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
    enabledCompetitorFields: ['club', 'subdivision'],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [{ id: 'axis-div', label: 'Division' }],
    prizes: PRIZES,
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'ILCA 6', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [sail], club: '', gender: '', age: null, createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null };
}

const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [makeCompetitor('c1', '218401'), makeCompetitor('c2', '218402')],
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-07-04', createdAt: 0 }],
  subSeries: [],
  finishes: [makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2)],
  raceStarts: [],
  ratingOverrides: [],
};

function makeRecordingRepos(read?: SeriesSnapshot) {
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
      saveMany: async () => {},
    },
    competitorRepo: {
      listBySeries: async () => read?.competitors ?? [],
      save: async (c: Competitor) => c,
      saveMany: async () => {},
    },
    raceRepo: {
      listBySeries: async () => read?.races ?? [],
      save: async (r: Race) => r,
    },
    subSeriesRepo: {
      listBySeries: async () => read?.subSeries ?? [],
      saveMany: async (_: SubSeries[]) => {},
    },
    finishRepo: {
      listBySeries: async () => read?.finishes ?? [],
      save: async (f: Finish) => f,
      saveMany: async () => {},
    },
    raceStartRepo: {
      listBySeries: async () => read?.raceStarts ?? [],
      save: async (rs: RaceStart) => rs,
      saveMany: async (_: RaceStart[]) => {},
    },
    raceRatingOverrideRepo: {
      listBySeries: async () => read?.ratingOverrides ?? [],
      listByRaces: async () => [],
      saveMany: async () => {},
    },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos;
  return { repos, savedSeries, savedFleets };
}

describe('.sailscoring v17 prizes round-trip', () => {
  it('buildSeriesFile carries the prize list when non-empty', async () => {
    const { repos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', repos);
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(file.series.prizes).toEqual(PRIZES);
  });

  it('a series with no prizes writes no prizes key', async () => {
    const bare: SeriesSnapshot = { ...snapshot, series: { ...snapshot.series, prizes: [] } };
    const { repos } = makeRecordingRepos(bare);
    const file = await buildSeriesFile('s1', repos);
    expect('prizes' in file.series).toBe(false);
  });

  it('openSeriesFromFile restores prizes with fleet clauses remapped and axis clauses verbatim', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);
    const { repos, savedSeries } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    const saved = savedSeries.at(-1)!;
    expect(saved.prizes).toHaveLength(2);
    expect(saved.prizes![0]).toEqual(PRIZES[0]); // axis clause untouched
    const fleetClause = saved.prizes![1].clauses.find((c) => c.kind === 'fleet');
    expect(fleetClause).toBeDefined();
    if (fleetClause?.kind === 'fleet') {
      // The fleet id was re-minted on import; the clause must follow it.
      expect(fleetClause.fleetId).not.toBe('fl-1');
    }
    expect(saved.prizes![1].clauses).toContainEqual({ kind: 'rank', max: 1 });
  });

  it('a prize whose fleet clause cannot resolve is dropped whole, not widened', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file: SeriesFile = await buildSeriesFile('s1', buildRepos);
    // The built file aliases the series' own prizes array — clone before
    // mutating so the shared fixture stays intact for the other tests.
    file.series.prizes = structuredClone(file.series.prizes);
    const clause = file.series.prizes![1].clauses[0];
    if (clause.kind === 'fleet') clause.fleetId = 'fl-unknown';
    const { repos, savedSeries } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    const saved = savedSeries.at(-1)!;
    expect(saved.prizes!.map((p) => p.id)).toEqual(['p-gold']);
  });

  it('a pre-v17 file loads with no prizes', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file: SeriesFile = await buildSeriesFile('s1', buildRepos);
    file.formatVersion = 16;
    delete file.series.prizes;
    const { repos, savedSeries } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    expect(savedSeries.at(-1)!.prizes).toEqual([]);
  });
});

describe('public JSON export prizes round-trip', () => {
  it('exports fleet clauses by name, no prize ids; import re-keys onto fresh fleets', async () => {
    const data = buildPublicExportFromSnapshot(snapshot);
    expect(data).not.toBeNull();
    expect(data!.series.prizes).toEqual([
      {
        name: 'Gold Fleet 1st, 2nd, 3rd',
        recipientCount: 3,
        clauses: [{ kind: 'axis', axisId: 'axis-div', value: 'Gold' }],
      },
      {
        name: 'Overall 1st',
        recipientCount: 1,
        clauses: [
          { kind: 'fleet', fleetName: 'ILCA 6' },
          { kind: 'rank', max: 1 },
        ],
      },
    ]);
    expect(JSON.stringify(data)).not.toContain('p-gold');

    const { repos, savedSeries, savedFleets } = makeRecordingRepos();
    await importPublicExport(data!, repos);
    const saved = savedSeries.at(-1)!;
    expect(saved.prizes).toHaveLength(2);
    const fleetClause = saved.prizes![1].clauses.find((c) => c.kind === 'fleet');
    const importedFleet = savedFleets.find((f) => f.name === 'ILCA 6');
    expect(importedFleet).toBeDefined();
    if (fleetClause?.kind === 'fleet') {
      expect(fleetClause.fleetId).toBe(importedFleet!.id);
    } else {
      expect.unreachable('fleet clause missing after import');
    }
  });

  it('a series with no prizes exports no prizes key', () => {
    const bare: SeriesSnapshot = { ...snapshot, series: { ...snapshot.series, prizes: [] } };
    const data = buildPublicExportFromSnapshot(bare);
    expect('prizes' in data!.series).toBe(false);
  });
});
