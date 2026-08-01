/**
 * The race record (#338/#339) across both formats: the `.sailscoring` v27
 * round-trip and the public JSON export.
 *
 * The two formats deliberately differ, and that difference is the point of
 * most of these assertions. The file is a lossless round-trip and carries the
 * race management team unconditionally. The public export is embedded in every
 * published page, so it carries officials only when the series has opted in —
 * these are named non-competitors, and "not published" has to mean absent from
 * the payload, not merely unrendered.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  FORMAT_VERSION,
  openSeriesFromFile,
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
  Race,
  RaceStart,
  Series,
  SubSeries,
} from '@/lib/types';
import type { SeriesSnapshot } from '@/lib/series-snapshot';

function makeSeries(extra: Partial<Series> = {}): Series {
  return {
    id: 's1',
    name: 'Wave Regatta',
    venue: 'HYC',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: 0,
    lastSavedAt: null,
    lastModifiedAt: 0,
    scoringMode: 'scratch',
    discardThresholds: [{ minRaces: 3, discardCount: 1 }],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    enabledCompetitorFields: [],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
    ...extra,
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Cruisers 1', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [sail], club: '', gender: '', age: null, createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null };
}

function makeRace(id: string, raceNumber: number, extra: Partial<Race> = {}): Race {
  return { id, seriesId: 's1', raceNumber, name: null, date: '2026-06-01', createdAt: 0, ...extra };
}

const SERIES_TEAM = [
  { id: 'o-pro', role: 'principalRaceOfficer' as const, name: 'Ann Kelly' },
];

// Race 1 bare, race 2 conditions only, race 3 both — the club-series shape
// where the duty rotates and the standing team is also filled in.
function makeSnapshot(seriesExtra: Partial<Series> = {}): SeriesSnapshot {
  return {
    series: makeSeries(seriesExtra),
    competitors: [makeCompetitor('c1', '1401'), makeCompetitor('c2', '1402')],
    fleets: [fleet],
    races: [
      makeRace('r1', 1),
      makeRace('r2', 2, {
        conditions: { windSpeedMin: 8, windSpeedMax: 14, windDirection: 'SW', notes: 'Course 2, ebb tide' },
      }),
      makeRace('r3', 3, {
        conditions: { windSpeedMin: 20, windSpeedMax: 25, windDirection: 'NNW' },
        officials: [
          { id: 'o-ro', role: 'raceOfficer', name: 'Jane Smith' },
          { id: 'o-rec', role: 'recorder', name: 'Tom Byrne' },
        ],
      }),
    ],
    subSeries: [],
    finishes: [
      makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2),
      makeFinish('r2', 'c1', 1), makeFinish('r2', 'c2', 2),
      makeFinish('r3', 'c1', 1), makeFinish('r3', 'c2', 2),
    ],
    raceStarts: [],
    ratingOverrides: [],
  };
}

function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedRaces: Race[] = [];
  const savedSeries: Series[] = [];
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
      save: async (f: Fleet) => f,
      saveMany: async () => {},
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
  return { repos, savedRaces, savedSeries };
}

describe('.sailscoring v27 race record', () => {
  it('writes conditions and both teams, and nothing for a bare race', async () => {
    const { repos } = makeRecordingRepos(makeSnapshot({ officials: SERIES_TEAM }));
    const file = await buildSeriesFile('s1', repos);

    expect(file.formatVersion).toBe(FORMAT_VERSION);
    // The race record landed in v27; later fields have moved the version on.
    expect(FORMAT_VERSION).toBeGreaterThanOrEqual(27);
    expect('conditions' in file.races[0]).toBe(false);
    expect('officials' in file.races[0]).toBe(false);
    expect(file.races[1].conditions).toEqual({
      windSpeedMin: 8, windSpeedMax: 14, windDirection: 'SW', notes: 'Course 2, ebb tide',
    });
    expect(file.races[2].officials?.map((o) => o.name)).toEqual(['Jane Smith', 'Tom Byrne']);
    expect(file.series.officials?.[0]?.name).toBe('Ann Kelly');
  });

  it('carries the standing team whether or not it is published', async () => {
    // The file is the lossless round-trip; withholding the team here would
    // lose data on save, which is a different thing from not publishing it.
    const { repos } = makeRecordingRepos(makeSnapshot({ officials: SERIES_TEAM }));
    const file = await buildSeriesFile('s1', repos);
    expect(file.series.officials).toHaveLength(1);
    expect('publishOfficials' in file.series).toBe(false);

    const { repos: optedIn } = makeRecordingRepos(
      makeSnapshot({ officials: SERIES_TEAM, publishOfficials: true }),
    );
    const published = await buildSeriesFile('s1', optedIn);
    expect(published.series.officials).toHaveLength(1);
    expect(published.series.publishOfficials).toBe(true);
  });

  it('omits an empty conditions block rather than writing an empty object', async () => {
    const { repos } = makeRecordingRepos({
      ...makeSnapshot(),
      races: [makeRace('r1', 1, { conditions: {}, officials: [] })],
      finishes: [makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2)],
    });
    const file = await buildSeriesFile('s1', repos);
    expect('conditions' in file.races[0]).toBe(false);
    expect('officials' in file.races[0]).toBe(false);
  });

  it('restores everything on import', async () => {
    const { repos: buildRepos } = makeRecordingRepos(
      makeSnapshot({ officials: SERIES_TEAM, publishOfficials: true }),
    );
    const file = await buildSeriesFile('s1', buildRepos);

    const { repos, savedRaces, savedSeries } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);

    expect(savedRaces).toHaveLength(3);
    expect(savedRaces[0].conditions).toBeUndefined();
    expect(savedRaces[1].conditions?.windDirection).toBe('SW');
    expect(savedRaces[2].officials?.map((o) => o.role)).toEqual(['raceOfficer', 'recorder']);
    expect(savedSeries[0]?.officials?.[0]?.name).toBe('Ann Kelly');
    expect(savedSeries[0]?.publishOfficials).toBe(true);
  });

  it('loads a v26 file, which carries none of this', async () => {
    const { repos: buildRepos } = makeRecordingRepos(makeSnapshot());
    const file = await buildSeriesFile('s1', buildRepos);
    const legacy = {
      ...file,
      formatVersion: 26,
      races: file.races.map(({ conditions: _c, officials: _o, ...rest }) => rest),
    };

    const { repos, savedRaces } = makeRecordingRepos();
    await openSeriesFromFile(legacy, repos);
    expect(savedRaces).toHaveLength(3);
    expect(savedRaces.every((r) => r.conditions === undefined)).toBe(true);
    expect(savedRaces.every((r) => r.officials === undefined)).toBe(true);
  });
});

describe('public JSON export: conditions', () => {
  it('carries conditions regardless of the officials opt-in', async () => {
    // Conditions are a fact about the racing, not personal data — and a future
    // ORC scoring input, so withholding them would break re-scoring.
    const data = buildPublicExportFromSnapshot(makeSnapshot());
    expect(data).not.toBeNull();
    expect('conditions' in data!.races[0]).toBe(false);
    expect(data!.races[1].conditions?.windSpeedMin).toBe(8);
    expect(data!.races[1].conditions?.notes).toBe('Course 2, ebb tide');

    const { repos, savedRaces } = makeRecordingRepos();
    await importPublicExport(data!, repos);
    expect(savedRaces[1].conditions?.windDirection).toBe('SW');
    expect(savedRaces[2].conditions?.windSpeedMax).toBe(25);
  });
});

describe('public JSON export: the officials opt-in', () => {
  it('omits every team when the series has not opted in', async () => {
    const data = buildPublicExportFromSnapshot(makeSnapshot({ officials: SERIES_TEAM }));
    expect(data).not.toBeNull();
    expect('officials' in data!.series).toBe(false);
    expect('publishOfficials' in data!.series).toBe(false);
    expect(data!.races.every((r) => !('officials' in r))).toBe(true);

    // Not merely unrendered — no name appears anywhere in the payload.
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain('Ann Kelly');
    expect(serialised).not.toContain('Jane Smith');
  });

  it('carries both teams, without ids, once the series opts in', async () => {
    const data = buildPublicExportFromSnapshot(
      makeSnapshot({ officials: SERIES_TEAM, publishOfficials: true }),
    );
    expect(data!.series.publishOfficials).toBe(true);
    expect(data!.series.officials).toEqual([
      { role: 'principalRaceOfficer', name: 'Ann Kelly' },
    ]);
    expect(data!.races[2].officials).toEqual([
      { role: 'raceOfficer', name: 'Jane Smith' },
      { role: 'recorder', name: 'Tom Byrne' },
    ]);
    // Our ids are series-local and never leave the workspace.
    expect(JSON.stringify(data)).not.toContain('o-ro');
  });

  it('re-imports the teams with fresh ids and keeps the opt-in', async () => {
    const data = buildPublicExportFromSnapshot(
      makeSnapshot({ officials: SERIES_TEAM, publishOfficials: true }),
    );

    const { repos, savedRaces, savedSeries } = makeRecordingRepos();
    await importPublicExport(data!, repos);

    expect(savedSeries[0]?.publishOfficials).toBe(true);
    expect(savedSeries[0]?.officials?.[0]?.name).toBe('Ann Kelly');
    expect(savedSeries[0]?.officials?.[0]?.id).not.toBe('o-pro');
    expect(savedRaces[2].officials?.map((o) => o.name)).toEqual(['Jane Smith', 'Tom Byrne']);
    expect(savedRaces[0].officials).toBeUndefined();
  });

  it('drops a role this build does not recognise rather than guessing one', async () => {
    const data = buildPublicExportFromSnapshot(
      makeSnapshot({ officials: SERIES_TEAM, publishOfficials: true }),
    )!;
    data.series.officials = [
      { role: 'chiefUmpire' as never, name: 'Someone Else' },
      { role: 'raceOfficer', name: 'Jane Smith' },
    ];

    const { repos, savedSeries } = makeRecordingRepos();
    await importPublicExport(data, repos);

    expect(savedSeries[0]?.officials?.map((o) => o.name)).toEqual(['Jane Smith']);
  });
});
