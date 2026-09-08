/**
 * Published-page notes in the `.sailscoring` file (v46, #511). Both fields
 * are sparse and travel verbatim: a note is keyed by the page name, which the
 * file carries as-is, so nothing has to be remapped the way a prize's fleet
 * clause does.
 */
import { describe, it, expect } from 'vitest';
import {
  FORMAT_VERSION,
  buildSeriesFile,
  openSeriesFromFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import { buildPublicExportFromSnapshot } from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Fleet, Race, RaceStart, Series, SubSeries } from '@/lib/types';

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Yellow', displayOrder: 0, scoringSystem: 'scratch' };

function makeSeries(): Series {
  return {
    id: 's1',
    name: 'ILCA 6 Women’s Worlds',
    venue: 'Dún Laoghaire',
    startDate: '2026-09-05',
    endDate: '2026-09-12',
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
    seriesNote: 'Corrected 16:40 — Q1 finish order revised.',
    pageNotes: [
      {
        page: 'Fleet assignments',
        text: 'Assigned from Q1 as posted, before Sui 214’s retirement was applied.',
        updatedAt: 1_700_000_000_000,
      },
    ],
  };
}

const competitor: Competitor = {
  id: 'c1', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: '214',
  names: ['A Sailor'], club: '', gender: '', age: null, createdAt: 0,
};

const snapshot: SeriesSnapshot = {
  series: makeSeries(),
  competitors: [competitor],
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-05', createdAt: 0 }],
  subSeries: [],
  finishes: [],
  raceStarts: [],
  ratingOverrides: [],
};

function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedSeries: Series[] = [];
  const repos = {
    seriesRepo: {
      get: async (id: string) => (read && id === read.series.id ? read.series : undefined),
      save: async (s: Series) => {
        savedSeries.push(s);
        return s;
      },
    },
    fleetRepo: { listBySeries: async () => read?.fleets ?? [], saveMany: async () => {} },
    competitorRepo: { listBySeries: async () => read?.competitors ?? [], saveMany: async () => {} },
    raceRepo: { listBySeries: async () => read?.races ?? [], save: async (r: Race) => r },
    subSeriesRepo: { listBySeries: async () => read?.subSeries ?? [], saveMany: async (_: SubSeries[]) => {} },
    finishRepo: { listBySeries: async () => read?.finishes ?? [], saveMany: async () => {} },
    raceStartRepo: { listBySeries: async () => read?.raceStarts ?? [], saveMany: async (_: RaceStart[]) => {} },
    raceRatingOverrideRepo: {
      listBySeries: async () => read?.ratingOverrides ?? [],
      listByRaces: async () => [],
      saveMany: async () => {},
    },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos;
  return { repos, savedSeries };
}

describe('.sailscoring page notes', () => {
  it('writes both notes at v46', async () => {
    const { repos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', repos);
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(FORMAT_VERSION).toBeGreaterThanOrEqual(46);
    expect(file.series.seriesNote).toBe('Corrected 16:40 — Q1 finish order revised.');
    expect(file.series.pageNotes).toEqual(snapshot.series.pageNotes);
  });

  it('writes neither key for a series with nothing to say', async () => {
    const bare = {
      ...snapshot,
      series: { ...snapshot.series, seriesNote: '   ', pageNotes: [] },
    };
    const { repos } = makeRecordingRepos(bare);
    const file = await buildSeriesFile('s1', repos);
    expect('seriesNote' in file.series).toBe(false);
    expect('pageNotes' in file.series).toBe(false);
  });

  it('restores both on open', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);
    const { repos, savedSeries } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    const restored = savedSeries.at(-1)!;
    expect(restored.seriesNote).toBe(snapshot.series.seriesNote);
    expect(restored.pageNotes).toEqual(snapshot.series.pageNotes);
  });

  it('travels in the public export, which is what the pages print', async () => {
    const exported = buildPublicExportFromSnapshot(snapshot, { exportedAt: new Date(0) })!;
    expect(exported.series.seriesNote).toBe(snapshot.series.seriesNote);
    expect(exported.series.pageNotes).toEqual(snapshot.series.pageNotes);
  });

  it('reads a file written before the field existed', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);
    const { seriesNote: _n, pageNotes: _p, ...series } = file.series;
    const { repos, savedSeries } = makeRecordingRepos();
    await openSeriesFromFile({ ...file, formatVersion: 45, series }, repos);
    expect(savedSeries.at(-1)!.seriesNote).toBeUndefined();
    expect(savedSeries.at(-1)!.pageNotes).toBeUndefined();
  });
});
