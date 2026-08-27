/**
 * RaceSense capture serialization: the `.sailscoring` file carries
 * `finishes[*].elapsedSecs` and `finishes[*].trackData` verbatim and
 * `series.publishTrackData` sparsely, and the import path restores all
 * three. v39 and v40 files stored the elapsed time inside `trackData`; a
 * read lifts it onto the finish row.
 *
 * The public JSON export is published output, so it carries a finish's
 * track data only when the series has opted into publishing it — and then
 * carries the opt-in itself, so a re-import keeps the decision. The elapsed
 * time travels either way: it is a scoring input, and withholding it would
 * make a re-import score the race differently.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  openSeriesFromFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import { buildPublicExportFromSnapshot } from '@/lib/public-export';
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
    name: 'Autumn League',
    venue: 'Howth Yacht Club',
    startDate: '2026-09-05',
    endDate: '',
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
    publishTrackData: true,
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'ILCA 7', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [sail], club: '', gender: '', age: null, createdAt: 0 };
}

const trackData = { dtlAtStartM: 4.36, distanceKm: 5.809, maxSpeedKts: 14.6 };
const elapsedSecs = 2840.45;

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null };
}

const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [makeCompetitor('c1', '1234'), makeCompetitor('c2', '5678')],
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-05', createdAt: 0 }],
  subSeries: [],
  finishes: [
    { ...makeFinish('r1', 'c1', 1), finishTime: '11:45:20', elapsedSecs, trackData },
    makeFinish('r1', 'c2', 2),
  ],
  raceStarts: [],
  ratingOverrides: [],
};

/** Fake repos backed by the snapshot for reads, recording writes. */
function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedSeries: Series[] = [];
  const savedFinishes: Finish[] = [];
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
    finishRepo: {
      listBySeries: async () => read?.finishes ?? [],
      saveMany: async (fs: Finish[]) => {
        savedFinishes.push(...fs);
      },
    },
    raceStartRepo: { listBySeries: async () => read?.raceStarts ?? [], saveMany: async (_: RaceStart[]) => {} },
    raceRatingOverrideRepo: {
      listBySeries: async () => read?.ratingOverrides ?? [],
      listByRaces: async () => [],
      saveMany: async () => {},
    },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos;
  return { repos, savedSeries, savedFinishes };
}

describe('.sailscoring capture round-trip', () => {
  it('buildSeriesFile writes the capture and the publish opt-in, sparsely', async () => {
    const { repos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', repos);
    expect(file.series.publishTrackData).toBe(true);
    const finishes = file.races[0].finishes;
    const tracked = finishes.find((f) => f.competitorId === 'c1')!;
    expect(tracked.elapsedSecs).toBe(elapsedSecs);
    expect(tracked.trackData).toEqual(trackData);
    const bare = finishes.find((f) => f.competitorId === 'c2')!;
    expect('trackData' in bare).toBe(false);
    expect('elapsedSecs' in bare).toBe(false);
  });

  it('a series without either writes neither key', async () => {
    const bare: SeriesSnapshot = {
      ...snapshot,
      series: { ...snapshot.series, publishTrackData: undefined },
      finishes: [makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2)],
    };
    const { repos } = makeRecordingRepos(bare);
    const file = await buildSeriesFile('s1', repos);
    expect('publishTrackData' in file.series).toBe(false);
    expect(file.races[0].finishes.some((f) => 'trackData' in f)).toBe(false);
    expect(file.races[0].finishes.some((f) => 'elapsedSecs' in f)).toBe(false);
  });

  it('openSeriesFromFile restores all three', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);
    const { repos, savedSeries, savedFinishes } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    expect(savedSeries.at(-1)!.publishTrackData).toBe(true);
    const withData = savedFinishes.filter((f) => f.trackData);
    expect(withData).toHaveLength(1);
    expect(withData[0].trackData).toEqual(trackData);
    expect(withData[0].elapsedSecs).toBe(elapsedSecs);
  });

  it('lifts a v39 file’s elapsed time out of trackData onto the finish row', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);
    // Rewrite the file the way v39 and v40 wrote it: elapsed inside the
    // track data, nothing on the row.
    const asV39 = {
      ...file,
      formatVersion: 39,
      races: file.races.map((r) => ({
        ...r,
        finishes: r.finishes.map(({ elapsedSecs: e, ...f }) =>
          e != null ? { ...f, trackData: { ...f.trackData, elapsedSecs: e } } : f,
        ),
      })),
    };
    const { repos, savedFinishes } = makeRecordingRepos();
    await openSeriesFromFile(asV39, repos);
    const restored = savedFinishes.find((f) => f.elapsedSecs != null)!;
    expect(restored.elapsedSecs).toBe(elapsedSecs);
    expect(restored.trackData).toEqual(trackData);
  });

  it('a v39 row whose only capture was the elapsed time keeps no empty trackData', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);
    const asV39 = {
      ...file,
      formatVersion: 39,
      races: file.races.map((r) => ({
        ...r,
        finishes: r.finishes.map(({ elapsedSecs: e, trackData: _t, ...f }) =>
          e != null ? { ...f, trackData: { elapsedSecs: e } } : f,
        ),
      })),
    };
    const { repos, savedFinishes } = makeRecordingRepos();
    await openSeriesFromFile(asV39, repos);
    const restored = savedFinishes.find((f) => f.elapsedSecs != null)!;
    expect(restored.elapsedSecs).toBe(elapsedSecs);
    expect(restored.trackData).toBeUndefined();
  });

  it('the public JSON export carries track data only when published', async () => {
    const published = await buildPublicExportFromSnapshot(snapshot, {});
    expect(published?.series.publishTrackData).toBe(true);
    const exported = published!.races[0].finishes.find((f) => f.sailNumber === '1234');
    expect(exported?.trackData).toEqual(trackData);
    expect(exported?.elapsedSecs).toBe(elapsedSecs);

    const unpublished: SeriesSnapshot = {
      ...snapshot,
      series: { ...snapshot.series, publishTrackData: undefined },
    };
    const withheld = await buildPublicExportFromSnapshot(unpublished, {});
    expect('publishTrackData' in withheld!.series).toBe(false);
    expect(withheld!.races[0].finishes.some((f) => f.trackData)).toBe(false);
    // The elapsed time is not withheld: it is what the race was scored from.
    expect(withheld!.races[0].finishes.find((f) => f.sailNumber === '1234')?.elapsedSecs)
      .toBe(elapsedSecs);
  });
});
