/**
 * The spectator viewer's in-memory series and its read-only transport
 * (#475, ADR-012): a published data file read into the shapes the series
 * tabs consume, answered without a network call, and refusing every write.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { buildPublicExportFromSnapshot, type PublicSeriesExport } from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';
import {
  buildSpectatorSeries,
  isSpectatorSource,
  spectatorSeriesId,
} from '@/lib/spectator/seed';
import {
  clearSpectatorSeries,
  isSpectatorSeriesId,
  putSpectatorSeries,
} from '@/lib/spectator/store';
import {
  spectatorRequest,
  SpectatorTransportError,
} from '@/lib/spectator/transport';

const SOURCE = '/p/hyc/2026/autumn-league.sailscoring.json';

const series: Series = {
  id: 's1', name: 'Autumn League', venue: 'HYC',
  startDate: '2026-09-01', endDate: '2026-10-31',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
  createdAt: 0, lastSavedAt: null, lastModifiedAt: 0,
  scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries',
  ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
  enabledCompetitorFields: ['club'], primaryPersonLabel: 'helm', subdivisionAxes: [],
};
const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' };
const competitors: Competitor[] = [
  { id: 'c1', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: '101', names: ['Alice'], club: 'HYC', gender: '', age: null, createdAt: 0 },
  { id: 'c2', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: '102', names: ['Bob'], club: 'HYC', gender: '', age: null, createdAt: 0 },
];
const races: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-05', createdAt: 0 },
  { id: 'r2', seriesId: 's1', raceNumber: 2, name: null, date: '2026-09-12', createdAt: 0 },
];
const finishDefaults = {
  tiedWithPrevious: false, resultCode: null, startPresent: null,
  penaltyCode: null, penaltyOverride: null,
  redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
  redressIncludeAllLater: false, redressPoints: null,
} as const;
const finishes: Finish[] = [
  { id: 'f1', raceId: 'r1', competitorId: 'c1', sortOrder: 1, ...finishDefaults },
  { id: 'f2', raceId: 'r1', competitorId: 'c2', sortOrder: 2, ...finishDefaults },
  { id: 'f3', raceId: 'r2', competitorId: 'c2', sortOrder: 1, ...finishDefaults },
];
const raceStarts: RaceStart[] = [
  { id: 'rs1', raceId: 'r1', fleetIds: ['fl-1'], startTime: '11:00:00' },
];
const snapshot: SeriesSnapshot = {
  series, competitors, fleets: [fleet], races,
  subSeries: [], finishes, raceStarts, ratingOverrides: [],
};

function exported(): PublicSeriesExport {
  return buildPublicExportFromSnapshot(snapshot)!;
}

async function open(): Promise<string> {
  const view = await buildSpectatorSeries(exported(), SOURCE);
  putSpectatorSeries(view);
  return view.seriesId;
}

afterEach(() => clearSpectatorSeries());

describe('spectator source paths', () => {
  it('accepts a published data-file path and rejects anything else', () => {
    expect(isSpectatorSource(SOURCE)).toBe(true);
    expect(isSpectatorSource('/p/hyc/2026/x.sailscoring.json')).toBe(true);
    expect(isSpectatorSource('https://evil.example/p/x.json')).toBe(false);
    expect(isSpectatorSource('//evil.example/p/x.json')).toBe(false);
    expect(isSpectatorSource('/api/v1/series')).toBe(false);
    expect(isSpectatorSource('/p/../api/v1/series')).toBe(false);
    expect(isSpectatorSource('/p/hyc/x.json?a=1')).toBe(false);
  });

  it('derives a prefixed series id that is stable per source', () => {
    const id = spectatorSeriesId(SOURCE);
    expect(isSpectatorSeriesId(id)).toBe(true);
    expect(spectatorSeriesId(SOURCE)).toBe(id);
    expect(spectatorSeriesId('/p/hyc/2026/other.sailscoring.json')).not.toBe(id);
  });
});

describe('reading a data file into a view', () => {
  it('rebuilds the series, its boats, races and finishes', async () => {
    const view = await buildSpectatorSeries(exported(), SOURCE);
    expect(view.seriesId).toBe(spectatorSeriesId(SOURCE));
    expect(view.series.name).toBe('Autumn League');
    expect(view.series.id).toBe(view.seriesId);
    expect(view.competitors.map((c) => c.sailNumber).sort()).toEqual(['101', '102']);
    expect(view.races).toHaveLength(2);
    // Four rows, not the three that were entered: the export scores every
    // boat in every race, so the boat that missed race 2 travels as an
    // explicit DNC and comes back as one.
    expect(view.finishes).toHaveLength(4);
    expect(view.finishes.filter((f) => f.resultCode === 'DNC')).toHaveLength(1);
    expect(view.raceStarts).toHaveLength(1);
    expect(view.fleets.map((f) => f.name)).toEqual(['Default']);
  });

  it('is deterministic, so a reload rebuilds identical ids', async () => {
    const first = await buildSpectatorSeries(exported(), SOURCE);
    const second = await buildSpectatorSeries(exported(), SOURCE);
    expect(second.seriesId).toBe(first.seriesId);
    expect(second.competitors.map((c) => c.id)).toEqual(first.competitors.map((c) => c.id));
    expect(second.races.map((r) => r.id)).toEqual(first.races.map((r) => r.id));
    expect(second.finishes.map((f) => f.id)).toEqual(first.finishes.map((f) => f.id));
  });
});

describe('the read-only transport', () => {
  it('answers the series-scoped reads a tab makes', async () => {
    const id = await open();
    const get = (p: string) => spectatorRequest(p, 'GET')?.body;

    expect((get(`/api/v1/series/${id}`) as Series).name).toBe('Autumn League');
    expect((get(`/api/v1/series/${id}/competitors`) as Competitor[]).length).toBe(2);
    expect((get(`/api/v1/series/${id}/fleets`) as Fleet[]).length).toBe(1);
    expect((get(`/api/v1/series/${id}/races`) as Race[]).length).toBe(2);
    expect((get(`/api/v1/series/${id}/finishes`) as Finish[]).length).toBe(4);
    expect((get(`/api/v1/series/${id}/race-starts`) as RaceStart[]).length).toBe(1);
    expect(get(`/api/v1/series/${id}/sub-series`)).toEqual([]);
    expect(get(`/api/v1/series/${id}/rating-overrides`)).toEqual([]);
    expect(get(`/api/v1/series/${id}/tcf-history`)).toEqual([]);
    expect(get(`/api/v1/series/${id}/split-fleets`)).toEqual({ config: null, rounds: [] });
    expect((get(`/api/v1/series/${id}/publish`) as { published: null }).published).toBeNull();
  });

  it('answers race-scoped reads, which carry no series id', async () => {
    const id = await open();
    const raceId = (spectatorRequest(`/api/v1/series/${id}/races`, 'GET')!.body as Race[])
      .find((r) => r.raceNumber === 1)!.id;

    expect((spectatorRequest(`/api/v1/races/${raceId}`, 'GET')!.body as Race).raceNumber).toBe(1);
    expect((spectatorRequest(`/api/v1/races/${raceId}/finishes`, 'GET')!.body as Finish[])).toHaveLength(2);
    expect((spectatorRequest(`/api/v1/races/${raceId}/starts`, 'GET')!.body as RaceStart[])).toHaveLength(1);
    expect(spectatorRequest(`/api/v1/races/${raceId}/rating-overrides`, 'GET')!.body).toEqual([]);
  });

  it('answers a competitor read by its own id', async () => {
    const id = await open();
    const c = (spectatorRequest(`/api/v1/series/${id}/competitors`, 'GET')!.body as Competitor[])[0];
    expect((spectatorRequest(`/api/v1/competitors/${c.id}`, 'GET')!.body as Competitor).sailNumber)
      .toBe(c.sailNumber);
    expect(spectatorRequest(`/api/v1/competitors/${c.id}/audit`, 'GET')!.body).toBeNull();
  });

  it('lets every other request through to the network', async () => {
    await open();
    expect(spectatorRequest('/api/v1/series', 'GET')).toBeNull();
    expect(spectatorRequest('/api/v1/logos', 'GET')).toBeNull();
    expect(spectatorRequest('/api/v1/series/1f0e4a2c-0000-4000-8000-000000000000', 'GET')).toBeNull();
    // A spectator-shaped id that was never opened is not ours to answer.
    expect(spectatorRequest('/api/v1/series/spectator-deadbeef/races', 'GET')).toBeNull();
  });

  it('refuses to write', async () => {
    const id = await open();
    expect(() => spectatorRequest(`/api/v1/series/${id}`, 'PUT')).toThrow(SpectatorTransportError);
    expect(() => spectatorRequest(`/api/v1/series/${id}/competitors`, 'POST')).toThrow(/read-only/);
    expect(() => spectatorRequest(`/api/v1/series/${id}`, 'DELETE')).toThrow(/read-only/);
  });

  it('refuses a read it does not know rather than answering emptily', async () => {
    const id = await open();
    expect(() => spectatorRequest(`/api/v1/series/${id}/activity`, 'GET'))
      .toThrow(SpectatorTransportError);
  });
});
