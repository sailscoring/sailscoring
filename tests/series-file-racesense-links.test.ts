/**
 * The RaceSense links on a race survive a .sailscoring round-trip (v64), with
 * their fleets following the fleets' fresh ids. A link that lost its fleet
 * would point the next import at the wrong races, so one is dropped instead.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  openSeriesFromFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series, SubSeries } from '@/lib/types';
import type { SeriesSnapshot } from '@/lib/series-snapshot';

const series: Series = {
  id: 's1', name: 'Worlds', venue: '', startDate: '2026-08-23', endDate: '2026-08-30',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
  createdAt: 0, lastSavedAt: null, lastModifiedAt: 0, scoringMode: 'scratch',
  discardThresholds: [], dnfScoring: 'seriesEntries', ftpHost: '', ftpPath: '', ftpPaths: {},
  includeJsonExport: true, enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
};

const fleets: Fleet[] = [
  { id: 'fl-gold', seriesId: 's1', name: 'Gold', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'fl-silver', seriesId: 's1', name: 'Silver', displayOrder: 1, scoringSystem: 'scratch' },
];

const race: Race = {
  id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-08-27', createdAt: 0,
  raceSenseLinks: [
    { regattaId: 'FinalsRegatta1234567', regatta: 'ILCA 7 Finals', division: 'Gold', raceNumber: 1, fleetId: 'fl-gold' },
    { regattaId: 'FinalsRegatta1234567', regatta: 'ILCA 7 Finals', division: 'Silver', raceNumber: 1, fleetId: 'fl-silver' },
    // A fleet the file doesn't carry.
    { regattaId: 'FinalsRegatta1234567', regatta: 'ILCA 7 Finals', division: 'Bronze', raceNumber: 1, fleetId: 'fl-gone' },
  ],
};

const snapshot: SeriesSnapshot = {
  series, fleets, competitors: [], races: [race], subSeries: [], finishes: [], raceStarts: [], ratingOverrides: [],
};

function repos(read?: SeriesSnapshot) {
  const savedRaces: Race[] = [];
  const savedFleets: Fleet[] = [];
  const r = {
    seriesRepo: { get: async () => read?.series, save: async (s: Series) => s },
    fleetRepo: {
      listBySeries: async () => read?.fleets ?? [],
      save: async (f: Fleet) => { savedFleets.push(f); return f; },
      saveMany: async (fs: Fleet[]) => { savedFleets.push(...fs); },
    },
    competitorRepo: { listBySeries: async () => [], save: async (c: Competitor) => c, saveMany: async () => {} },
    raceRepo: { listBySeries: async () => read?.races ?? [], save: async (x: Race) => { savedRaces.push(x); return x; } },
    subSeriesRepo: { listBySeries: async () => [], saveMany: async (_: SubSeries[]) => {} },
    finishRepo: { listBySeries: async () => [], save: async (f: Finish) => f, saveMany: async () => {} },
    raceStartRepo: { listBySeries: async () => [], save: async (s: RaceStart) => s, saveMany: async () => {} },
    raceRatingOverrideRepo: { listBySeries: async () => [], listByRaces: async () => [], saveMany: async () => {} },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos;
  return { repos: r, savedRaces, savedFleets };
}

describe('.sailscoring v64 RaceSense links', () => {
  it('writes the links, and nothing for a race with none', async () => {
    const file = await buildSeriesFile('s1', repos({
      ...snapshot,
      races: [race, { ...race, id: 'r2', raceNumber: 2, raceSenseLinks: undefined }],
    }).repos);
    expect(file.races[0].raceSenseLinks).toHaveLength(3);
    expect('raceSenseLinks' in file.races[1]).toBe(false);
  });

  it('restores them onto the new fleets, dropping one whose fleet is gone', async () => {
    const file = await buildSeriesFile('s1', repos(snapshot).repos);
    const { repos: into, savedRaces, savedFleets } = repos();
    await openSeriesFromFile(file, into);

    const idOf = (name: string) => savedFleets.find((f) => f.name === name)!.id;
    expect(savedRaces[0].raceSenseLinks).toEqual([
      { regattaId: 'FinalsRegatta1234567', regatta: 'ILCA 7 Finals', division: 'Gold', raceNumber: 1, fleetId: idOf('Gold') },
      { regattaId: 'FinalsRegatta1234567', regatta: 'ILCA 7 Finals', division: 'Silver', raceNumber: 1, fleetId: idOf('Silver') },
    ]);
  });

  it('keeps a link with no fleet, from a series with no fleets', async () => {
    const link = { regattaId: null, regatta: 'Wednesday League', division: 'ILCA 6', raceNumber: 3, fleetId: null };
    const file = await buildSeriesFile('s1', repos({
      ...snapshot, fleets: [], races: [{ ...race, raceSenseLinks: [link] }],
    }).repos);
    const { repos: into, savedRaces } = repos();
    await openSeriesFromFile(file, into);
    expect(savedRaces[0].raceSenseLinks).toEqual([link]);
  });
});
