import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  competitorRepo,
  finishRepo,
  fleetRepo,
  raceRepo,
  raceStartRepo,
  seriesRepo,
} from '@/lib/api-repository';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';

const fetchMock = vi.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
});

afterEach(() => {
  fetchMock.mockReset();
});

function jsonResponse(status: number, body?: unknown): Response {
  if (body === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const stubSeries: Series = {
  id: 'a1b2c3d4-1111-4222-8333-444444444444',
  name: 'Stub',
  venue: '',
  startDate: '',
  endDate: '',
  venueLogoUrl: '',
  eventLogoUrl: '',
  createdAt: 0,
  lastSnapshotId: null,
  lastSavedAt: null,
  lastModifiedAt: 0,
  snapshotHistory: [],
  scoringMode: 'scratch',
  discardThresholds: [],
  dnfScoring: 'seriesEntries',
  ftpHost: '',
  ftpPath: '',
  bilgeBundle: null,
  includeJsonExport: true,
  publishRatingCalculations: true,
  enabledCompetitorFields: [],
  primaryPersonLabel: 'competitor',
};

describe('api-repository routing', () => {
  test('seriesRepo.list unwraps { items } from /api/v1/series', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [stubSeries] }));
    const list = await seriesRepo.list();
    expect(list).toEqual([stubSeries]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/series');
  });

  test('seriesRepo.get returns undefined on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'not-found' }));
    const got = await seriesRepo.get(stubSeries.id);
    expect(got).toBeUndefined();
  });

  test('seriesRepo.save PUTs to /api/v1/series/:id with body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, stubSeries));
    const saved = await seriesRepo.save(stubSeries);
    expect(saved).toEqual(stubSeries);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/v1/series/${stubSeries.id}`);
    expect(init.method).toBe('PUT');
  });

  test('seriesRepo.delete DELETEs and returns void', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await seriesRepo.delete(stubSeries.id);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  test('seriesRepo.touch POSTs to /touch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await seriesRepo.touch(stubSeries.id);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/series/${stubSeries.id}/touch`);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  test('fleetRepo.listBySeries hits the nested route', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    const seriesId = 'b1b2c3d4-1111-4222-8333-444444444444';
    await fleetRepo.listBySeries(seriesId);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/series/${seriesId}/fleets`);
  });

  test('fleetRepo.save uses the nested PUT path', async () => {
    const fleet: Fleet = {
      id: 'c1c2c3c4-1111-4222-8333-555555555555',
      seriesId: 'd1d2d3d4-1111-4222-8333-666666666666',
      name: 'F',
      displayOrder: 0,
      scoringSystem: 'irc',
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, fleet));
    await fleetRepo.save(fleet);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/series/${fleet.seriesId}/fleets/${fleet.id}`);
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
  });

  test('competitorRepo.save uses the nested PUT path', async () => {
    const c: Competitor = {
      id: 'e1e2e3e4-1111-4222-8333-777777777777',
      seriesId: 'f1f2f3f4-1111-4222-8333-888888888888',
      fleetIds: [],
      sailNumber: '1',
      name: 'X',
      club: '', gender: '', age: null, createdAt: 0,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, c));
    await competitorRepo.save(c);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/v1/series/${c.seriesId}/competitors/${c.id}`,
    );
  });

  test('raceRepo.save uses the nested PUT path', async () => {
    const r: Race = {
      id: '11111111-1111-4222-8333-aaaaaaaaaaaa',
      seriesId: '22222222-1111-4222-8333-bbbbbbbbbbbb',
      raceNumber: 1,
      date: '',
      createdAt: 0,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, r));
    await raceRepo.save(r);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/series/${r.seriesId}/races/${r.id}`);
  });

  test('raceStartRepo.save uses the flat /races/:id/starts path', async () => {
    const s: RaceStart = {
      id: '33333333-1111-4222-8333-cccccccccccc',
      raceId: '44444444-1111-4222-8333-dddddddddddd',
      fleetIds: [],
      startTime: '11:00:00',
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, s));
    await raceStartRepo.save(s);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/v1/races/${s.raceId}/starts/${s.id}`,
    );
  });

  test('finishRepo.save uses the flat /races/:id/finishes path', async () => {
    const f: Finish = {
      id: '55555555-1111-4222-8333-eeeeeeeeeeee',
      raceId: '66666666-1111-4222-8333-ffffffffffff',
      competitorId: null,
      sortOrder: null,
      resultCode: 'DNC',
      startPresent: null,
      penaltyCode: null,
      penaltyOverride: null,
      redressMethod: null,
      redressExcludeRaces: null,
      redressIncludeRaces: null,
      redressIncludeAllLater: false,
      redressPoints: null,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, f));
    await finishRepo.save(f);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/v1/races/${f.raceId}/finishes/${f.id}`,
    );
  });

  test('finishRepo.saveMany batches by raceId and uses the bulk endpoint', async () => {
    const raceA = '77777777-1111-4222-8333-aaaaaaaaaaaa';
    const raceB = '88888888-1111-4222-8333-bbbbbbbbbbbb';
    const mk = (raceId: string, id: string): Finish => ({
      id, raceId, competitorId: null, sortOrder: null,
      resultCode: 'DNC', startPresent: null,
      penaltyCode: null, penaltyOverride: null,
      redressMethod: null, redressExcludeRaces: null,
      redressIncludeRaces: null,
      redressIncludeAllLater: false, redressPoints: null,
    });
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { count: 2 })));
    await finishRepo.saveMany([
      mk(raceA, '99999999-1111-4222-8333-cccccccccccc'),
      mk(raceA, 'aaaaaaaa-1111-4222-8333-dddddddddddd'),
      mk(raceB, 'bbbbbbbb-1111-4222-8333-eeeeeeeeeeee'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((call) => call[0]).sort();
    expect(urls).toEqual([
      `/api/v1/races/${raceA}/finishes`,
      `/api/v1/races/${raceB}/finishes`,
    ]);
    for (const call of fetchMock.mock.calls) {
      expect(call[1].method).toBe('POST');
    }
  });
});
