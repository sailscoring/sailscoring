import { describe, it, expect } from 'vitest';
import {
  buildPublicExportFromSnapshot,
  importPublicExport,
  parsePublicExport,
  type ImportRepos,
} from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';

// The v2 carry contract: the export holds everything needed to re-score the
// published results, and beyond that nothing the published HTML does not
// show. A hidden competitor column travels only when a prize clause selects
// on it or (for the seeding record) the series is split-fleet.

function makeSeries(id: string, overrides?: Partial<Series>): Series {
  return {
    id,
    name: 'Autumn League',
    venue: 'HYC',
    startDate: '2026-09-01',
    endDate: '2026-10-31',
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
    ...overrides,
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string, overrides?: Partial<Competitor>): Competitor {
  return {
    id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [`Helm ${sail}`],
    club: '', gender: '', age: null, createdAt: 0,
    ...overrides,
  };
}

const fullCompetitor = makeCompetitor('c1', '101', {
  bowNumber: '7',
  alternativeSailNumbers: ['9101'],
  entryNumber: 'E-12',
  tallyNumber: 'T44',
  seed: 3,
  initialFleet: 'Yellow',
  worldSailingId: 'IRLMM1',
  boatName: 'Windshift',
  boatClass: 'ILCA 7',
  owners: ['O. Owner'],
  helms: ['H. Helm'],
  crewNames: ['C. Crew'],
  club: 'HYC',
  nationality: 'IRL',
  gender: 'F',
  age: 34,
  subdivisions: { 'axis-1': 'Silver' },
  pyNumber: 1100,
});

function makeRace(id: string, n: number): Race {
  return { id, seriesId: 's1', raceNumber: n, name: null, date: '2026-09-05', createdAt: 0 };
}

function makeSnapshot(series: Series, extra?: Partial<SeriesSnapshot>): SeriesSnapshot {
  return {
    series,
    competitors: [fullCompetitor, makeCompetitor('c2', '102')],
    fleets: [fleet],
    races: [makeRace('r1', 1)],
    subSeries: [],
    finishes: [],
    raceStarts: [],
    ratingOverrides: [],
    ...extra,
  };
}

function makeRecordingRepos() {
  const savedCompetitors: Competitor[] = [];
  const savedFinishes: Finish[] = [];
  const repos = {
    seriesRepo: { get: async () => undefined, save: async (s: Series) => s },
    fleetRepo: { listBySeries: async () => [], save: async (f: Fleet) => f, saveMany: async () => {} },
    competitorRepo: {
      listBySeries: async () => [],
      save: async (c: Competitor) => { savedCompetitors.push(c); return c; },
      saveMany: async (list: Competitor[]) => { savedCompetitors.push(...list); },
    },
    raceRepo: { listBySeries: async () => [], save: async (r: Race) => r },
    subSeriesRepo: { listBySeries: async () => [], saveMany: async () => {} },
    raceStartRepo: { listBySeries: async () => [], saveMany: async () => {} },
    finishRepo: {
      listByRace: async () => [],
      saveMany: async (list: Finish[]) => { savedFinishes.push(...list); },
    },
    ratingOverrideRepo: { listBySeries: async () => [], saveMany: async () => {} },
    listSeriesNames: async () => [],
  } as unknown as ImportRepos;
  return { repos, savedCompetitors, savedFinishes };
}

describe('public export v2 — hidden competitor columns', () => {
  it('drops every hidden non-scoring field and keeps identity + rating inputs', () => {
    const data = buildPublicExportFromSnapshot(makeSnapshot(makeSeries('s1')))!;
    expect(data.version).toBe(2);
    const c = data.competitors.find((x) => x.sailNumber === '101')!;
    // Identity and scoring inputs stay.
    expect(c.names).toEqual(['Helm 101']);
    expect(c.fleetNames).toEqual(['Default']);
    expect(c.pyNumber).toBe(1100);
    // Hidden columns go.
    expect(c.bowNumber).toBeUndefined();
    expect(c.alternativeSailNumbers).toBeUndefined();
    expect(c.entryNumber).toBeUndefined();
    expect(c.tallyNumber).toBeUndefined();
    expect(c.seed).toBeUndefined();
    expect(c.initialFleet).toBeUndefined();
    expect(c.worldSailingId).toBeUndefined();
    expect(c.boatName).toBeUndefined();
    expect(c.boatClass).toBeUndefined();
    expect(c.owners).toBeUndefined();
    expect(c.helms).toBeUndefined();
    expect(c.crewNames).toBeUndefined();
    expect(c.club).toBeUndefined();
    expect(c.nationality).toBeUndefined();
    expect(c.gender).toBeUndefined();
    expect(c.age).toBeUndefined();
    expect(c.subdivisions).toBeUndefined();
  });

  it('carries a field the series displays', () => {
    const series = makeSeries('s1', { enabledCompetitorFields: ['boatName', 'club', 'crewName'] });
    const data = buildPublicExportFromSnapshot(makeSnapshot(series))!;
    const c = data.competitors.find((x) => x.sailNumber === '101')!;
    expect(c.boatName).toBe('Windshift');
    expect(c.club).toBe('HYC');
    expect(c.crewNames).toEqual(['C. Crew']);
    expect(c.gender).toBeUndefined();
  });

  it('carries a hidden field a prize clause selects on', () => {
    const series = makeSeries('s1', {
      prizes: [
        { id: 'p1', name: 'Top Lady Helm', recipientCount: 1, clauses: [{ kind: 'gender', value: 'F' }] },
        { id: 'p2', name: 'Silver fleet', recipientCount: 1, clauses: [{ kind: 'axis', axisId: 'axis-1', value: 'Silver' }] },
      ],
    });
    const data = buildPublicExportFromSnapshot(makeSnapshot(series))!;
    const c = data.competitors.find((x) => x.sailNumber === '101')!;
    expect(c.gender).toBe('F');
    expect(c.subdivisions).toEqual({ 'axis-1': 'Silver' });
    // No clause reads club or nationality, and neither is displayed.
    expect(c.club).toBeUndefined();
    expect(c.nationality).toBeUndefined();
  });

  it('carries the seeding record on a split-fleet series', () => {
    const start: RaceStart = {
      id: 'rs-1', raceId: 'r1', fleetIds: ['fl-1'], startTime: '11:00:00', stage: 'qualifying',
    };
    const data = buildPublicExportFromSnapshot(makeSnapshot(makeSeries('s1'), { raceStarts: [start] }))!;
    const c = data.competitors.find((x) => x.sailNumber === '101')!;
    expect(c.seed).toBe(3);
    expect(c.initialFleet).toBe('Yellow');
  });

  it('always carries an excluded boat with its flag, and import restores it', async () => {
    const reserve = makeCompetitor('c9', '909', { excluded: true });
    const series = makeSeries('s1');
    const data = buildPublicExportFromSnapshot(
      makeSnapshot(series, { competitors: [fullCompetitor, reserve] }),
    )!;
    const exported = data.competitors.find((x) => x.sailNumber === '909')!;
    expect(exported.excluded).toBe(true);
    // An entered boat carries no flag at all — absent means entered.
    expect(data.competitors.find((x) => x.sailNumber === '101')!.excluded).toBeUndefined();
    // A non-entrant is on no standings table.
    for (const fleet of data.standings) {
      expect(fleet.rows.map((r) => r.sailNumber)).not.toContain('909');
    }
    const { repos, savedCompetitors } = makeRecordingRepos();
    await importPublicExport(data, repos);
    expect(savedCompetitors.find((c) => c.sailNumber === '909')!.excluded).toBe(true);
    expect(savedCompetitors.find((c) => c.sailNumber === '101')!.excluded).toBeUndefined();
  });

  it('defaults absent club/gender/age on import', async () => {
    const data = buildPublicExportFromSnapshot(makeSnapshot(makeSeries('s1')))!;
    const { repos, savedCompetitors } = makeRecordingRepos();
    await importPublicExport(data, repos);
    const imported = savedCompetitors.find((c) => c.sailNumber === '101')!;
    expect(imported.club).toBe('');
    expect(imported.gender).toBe('');
    expect(imported.age).toBeNull();
  });
});

describe('public export v2 — unresolved finishes', () => {
  const finishDefaults = {
    tiedWithPrevious: false, resultCode: null, startPresent: null,
    penaltyCode: null, penaltyOverride: null,
    redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
    redressIncludeAllLater: false, redressPoints: null,
  } as const;
  const unresolved: Finish = {
    id: 'f-x', raceId: 'r1', competitorId: null, unknownSailNumber: '999',
    sortOrder: 1, ...finishDefaults,
  };
  const resolved: Finish = {
    id: 'f-1', raceId: 'r1', competitorId: 'c1',
    sortOrder: 2, ...finishDefaults,
  };

  it('does not export unresolved rows', () => {
    const data = buildPublicExportFromSnapshot(
      makeSnapshot(makeSeries('s1'), { finishes: [unresolved, resolved] }),
    )!;
    const rows = data.races[0].finishes;
    expect(rows.some((f) => f.unknownSailNumber != null || f.sailNumber === '')).toBe(false);
    expect(rows.find((f) => f.sailNumber === '101')?.sortOrder).toBe(2);
  });

  it('still imports a v1 payload that carries one', async () => {
    const data = buildPublicExportFromSnapshot(
      makeSnapshot(makeSeries('s1'), { finishes: [resolved] }),
    )!;
    const v1 = {
      ...data,
      version: 1 as const,
      races: data.races.map((r) => ({
        ...r,
        finishes: [
          ...r.finishes,
          { sailNumber: '', unknownSailNumber: '999', sortOrder: 1, resultCode: null, startPresent: null },
        ],
      })),
    };
    const { repos, savedFinishes } = makeRecordingRepos();
    await importPublicExport(v1, repos);
    const unknown = savedFinishes.find((f) => f.competitorId === null);
    expect(unknown?.unknownSailNumber).toBe('999');
  });
});

describe('importPublicExport — id overrides (#475)', () => {
  it('uses the given series id and mints every other id from the factory', async () => {
    const data = buildPublicExportFromSnapshot(makeSnapshot(makeSeries('s1')))!;
    let n = 0;
    const { repos, savedCompetitors } = makeRecordingRepos();
    const id = await importPublicExport(data, repos, {
      seriesId: 'spectator-fixed',
      newId: () => `id-${++n}`,
    });
    expect(id).toBe('spectator-fixed');
    expect(savedCompetitors.every((c) => c.seriesId === 'spectator-fixed')).toBe(true);
    expect(savedCompetitors.every((c) => /^id-\d+$/.test(c.id))).toBe(true);
  });

  it('is deterministic — the same file read twice yields identical ids', async () => {
    const data = buildPublicExportFromSnapshot(makeSnapshot(makeSeries('s1')))!;
    const run = async () => {
      let n = 0;
      const { repos, savedCompetitors } = makeRecordingRepos();
      await importPublicExport(data, repos, {
        seriesId: 'spectator-fixed',
        newId: () => `id-${++n}`,
      });
      return savedCompetitors.map((c) => `${c.id}:${c.sailNumber}`);
    };
    expect(await run()).toEqual(await run());
  });

  it('still mints fresh UUIDs when no overrides are given', async () => {
    const data = buildPublicExportFromSnapshot(makeSnapshot(makeSeries('s1')))!;
    const { repos, savedCompetitors } = makeRecordingRepos();
    const first = await importPublicExport(data, repos);
    const { repos: repos2, savedCompetitors: second } = makeRecordingRepos();
    const secondId = await importPublicExport(data, repos2);
    expect(first).not.toBe(secondId);
    expect(savedCompetitors[0].id).not.toBe(second[0].id);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });
});

/**
 * The parser at the import boundary. Structural only — the envelope, the
 * version, and that the collections are there — like `parseSeriesFile` on the
 * file side. It runs on text someone was handed, so what it throws is meant
 * to be read.
 */
describe('parsePublicExport', () => {
  const valid = () => JSON.stringify(buildPublicExportFromSnapshot(makeSnapshot(makeSeries('s1')))!);

  it('accepts an export this build wrote', () => {
    expect(parsePublicExport(valid()).series.name).toBe('Autumn League');
  });

  it('rejects text that is not the format', () => {
    expect(() => parsePublicExport('not json')).toThrow(/not valid JSON/);
    expect(() => parsePublicExport('null')).toThrow(/format/);
    expect(() => parsePublicExport('{"version":2}')).toThrow(/missing series/);
  });

  it('refuses a version this build cannot read, rather than half-reading it', () => {
    const future = { ...JSON.parse(valid()), version: 99 };
    expect(() => parsePublicExport(JSON.stringify(future))).toThrow(/version: 99/);
    const none = { ...JSON.parse(valid()) };
    delete none.version;
    expect(() => parsePublicExport(JSON.stringify(none))).toThrow(/version: unknown/);
  });

  it('names the collection a truncated file is missing', () => {
    for (const key of ['fleets', 'competitors', 'races'] as const) {
      const missing = { ...JSON.parse(valid()) };
      delete missing[key];
      expect(() => parsePublicExport(JSON.stringify(missing))).toThrow(new RegExp(key));
    }
    const unnamed = JSON.parse(valid());
    unnamed.series.name = 42;
    expect(() => parsePublicExport(JSON.stringify(unnamed))).toThrow(/series name/);
  });
});
