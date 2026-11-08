/**
 * A boat's secondary IRC certificate, and a race declared on it, round-trip
 * through the .sailscoring file (v81): the certificate travels with the
 * boat, the declaration with the race, both onto the new ids.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  openSeriesFromFile,
  parseSeriesFile,
  FORMAT_VERSION,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { ImportRepos } from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type {
  Competitor,
  Fleet,
  Race,
  RaceRatingOverride,
  RaceStart,
  Series,
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

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'IRC Class 1', displayOrder: 0, scoringSystem: 'irc' };

const crackajack: Competitor = {
  id: 'c1', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: 'GBR7664T', names: ['Crackajack'], clubs: [], gender: '', age: null, createdAt: 0,
  ircTcc: 1.013,
  ircSecondaryTcc: 1.014,
  ircSecondaryCert: { certNumber: '50719', tcc: 1.014 },
};

const snapshot: SeriesSnapshot = {
  series: { ...makeSeries('s1'), scoringMode: 'handicap' },
  competitors: [crackajack],
  fleets: [fleet],
  races: [1, 2].map((n) => ({ id: `r${n}`, seriesId: 's1', raceNumber: n, name: null, date: '2026-04-05', createdAt: 0 })),
  subSeries: [],
  finishes: [],
  raceStarts: [],
  ratingOverrides: [
    { id: 'o1', raceId: 'r2', competitorId: 'c1', field: 'ircTcc', value: 1.014, certificate: 'secondary' },
  ],
};

/** Fake repos backed by the snapshot for reads, recording writes. */
function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedSubSeries: SubSeries[] = [];
  const savedRaces: Race[] = [];
  const savedSeries: Series[] = [];
  const savedFleets: Fleet[] = [];
  const savedCompetitors: Competitor[] = [];
  const savedOverrides: RaceRatingOverride[] = [];
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
      saveMany: async (list: RaceRatingOverride[]) => {
        savedOverrides.push(...list);
      },
    },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos & ImportRepos;
  return { repos, savedSubSeries, savedRaces, savedSeries, savedFleets, savedCompetitors, savedOverrides };
}

describe('.sailscoring v81 secondary IRC certificate', () => {
  it('carries the secondary certificate and a race declared on it', async () => {
    const file = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(file.competitors[0]).toMatchObject({ ircTcc: 1.013, ircSecondaryTcc: 1.014, ircSecondaryCert: { certNumber: '50719' } });
    expect(file.races[1].ratingOverrides).toEqual([
      { id: 'o1', competitorId: 'c1', field: 'ircTcc', value: 1.014, certificate: 'secondary' },
    ]);

    const { repos, savedCompetitors, savedOverrides, savedRaces } = makeRecordingRepos();
    await openSeriesFromFile(parseSeriesFile(JSON.stringify(file)), repos);
    expect(savedCompetitors[0]).toMatchObject({ ircTcc: 1.013, ircSecondaryTcc: 1.014 });
    expect(savedOverrides).toEqual([
      expect.objectContaining({
        raceId: savedRaces.find((r) => r.raceNumber === 2)!.id,
        competitorId: savedCompetitors[0].id,
        value: 1.014,
        certificate: 'secondary',
      }),
    ]);
  });
});
