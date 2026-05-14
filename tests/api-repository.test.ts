import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  competitorRepo,
  deleteSeriesCascade,
  deleteSeriesChildren,
  ensureFleet,
  finishRepo,
  fleetRepo,
  ftpServerRepo,
  listSeriesNames,
  pruneFleet,
  raceRepo,
  raceStartRepo,
  seriesRepo,
} from '@/lib/api-repository';
import type {
  Competitor,
  Finish,
  Fleet,
  FtpServer,
  Race,
  RaceStart,
  Series,
} from '@/lib/types';

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
  ftpPaths: {},
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

  test('raceStartRepo.saveMany batches by raceId and uses the bulk endpoint', async () => {
    const raceA = 'a1a1a1a1-1111-4222-8333-aaaaaaaaaaaa';
    const raceB = 'b2b2b2b2-1111-4222-8333-bbbbbbbbbbbb';
    const mk = (raceId: string, id: string): RaceStart => ({
      id, raceId, fleetIds: [], startTime: '11:00:00',
    });
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { count: 1 })));
    await raceStartRepo.saveMany([
      mk(raceA, 'c3c3c3c3-1111-4222-8333-cccccccccccc'),
      mk(raceA, 'd4d4d4d4-1111-4222-8333-dddddddddddd'),
      mk(raceB, 'e5e5e5e5-1111-4222-8333-eeeeeeeeeeee'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((call) => call[0]).sort();
    expect(urls).toEqual([
      `/api/v1/races/${raceA}/starts`,
      `/api/v1/races/${raceB}/starts`,
    ]);
    for (const call of fetchMock.mock.calls) {
      expect(call[1].method).toBe('POST');
    }
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
      tiedWithPrevious: false, redressIncludeAllLater: false,
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
      tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
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

  test('ftpServerRepo.list hits /api/v1/ftp-servers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await ftpServerRepo.list();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/ftp-servers');
  });

  test('ftpServerRepo.save PUTs to /api/v1/ftp-servers/:id', async () => {
    const server: FtpServer = {
      id: 'cccccccc-1111-4222-8333-cccccccccccc',
      host: 'ftp.example.com',
      port: 21,
      username: 'u',
      password: 'p',
      ftps: false,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, server));
    await ftpServerRepo.save(server);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/ftp-servers/${server.id}`);
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
  });

  test('ftpServerRepo.delete DELETEs to /api/v1/ftp-servers/:id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await ftpServerRepo.delete('dddddddd-1111-4222-8333-dddddddddddd');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  test('listSeriesNames projects names from the series list', async () => {
    const a: Series = { ...stubSeries, id: 'aaaaaaaa-1111-4222-8333-aaaaaaaaaaaa', name: 'Spring' };
    const b: Series = { ...stubSeries, id: 'bbbbbbbb-1111-4222-8333-bbbbbbbbbbbb', name: 'Autumn' };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [a, b] }));
    expect(await listSeriesNames()).toEqual(['Spring', 'Autumn']);
  });

  test('listSeriesNames excludes the given id', async () => {
    const a: Series = { ...stubSeries, id: 'aaaaaaaa-1111-4222-8333-aaaaaaaaaaaa', name: 'Spring' };
    const b: Series = { ...stubSeries, id: 'bbbbbbbb-1111-4222-8333-bbbbbbbbbbbb', name: 'Autumn' };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [a, b] }));
    expect(await listSeriesNames({ excludeId: a.id })).toEqual(['Autumn']);
  });

  test('deleteSeriesCascade DELETEs the series; children cascade server-side', async () => {
    const id = 'eeeeeeee-1111-4222-8333-eeeeeeeeeeee';
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await deleteSeriesCascade(id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/series/${id}`);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  test('deleteSeriesChildren clears races, competitors, and fleets', async () => {
    const id = 'ffffffff-1111-4222-8333-ffffffffffff';
    // Each deleteBySeries lists-then-fans-out; respond fresh per call (Response
    // bodies are single-use, so mockResolvedValue with one Response would
    // throw on the second read).
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, [])));
    await deleteSeriesChildren(id);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain(`/api/v1/series/${id}/races`);
    expect(urls).toContain(`/api/v1/series/${id}/competitors`);
    expect(urls).toContain(`/api/v1/series/${id}/fleets`);
  });

  test('fleetRepo.delete DELETEs the flat /api/v1/fleets/:id route', async () => {
    const id = 'aaaa1111-1111-4222-8333-aaaaaaaaaaaa';
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await fleetRepo.delete(id);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/fleets/${id}`);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  test('competitorRepo.delete DELETEs the flat /api/v1/competitors/:id route', async () => {
    const id = 'bbbb1111-1111-4222-8333-bbbbbbbbbbbb';
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await competitorRepo.delete(id);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/competitors/${id}`);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  test('raceRepo.delete DELETEs the flat /api/v1/races/:id route', async () => {
    const id = 'cccc1111-1111-4222-8333-cccccccccccc';
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await raceRepo.delete(id);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/races/${id}`);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  test('raceStartRepo.delete DELETEs the flat /api/v1/race-starts/:id route', async () => {
    const id = 'dddd1111-1111-4222-8333-dddddddddddd';
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await raceStartRepo.delete(id);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/race-starts/${id}`);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  test('finishRepo.delete DELETEs the flat /api/v1/finishes/:id route', async () => {
    const id = 'eeee1111-1111-4222-8333-eeeeeeeeeeee';
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await finishRepo.delete(id);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/finishes/${id}`);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  test('competitorRepo.get hits the flat /api/v1/competitors/:id route', async () => {
    const id = 'e1e1e1e1-1111-4222-8333-eeeeeeeeeeee';
    const competitor: Competitor = {
      id, seriesId: 'fafafafa-1111-4222-8333-ffffffffffff',
      fleetIds: [], sailNumber: '1', name: 'X',
      club: '', gender: '', age: null, createdAt: 0,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, competitor));
    const got = await competitorRepo.get(id);
    expect(got).toEqual(competitor);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/competitors/${id}`);
  });

  test('competitorRepo.get returns undefined on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'not-found' }));
    expect(await competitorRepo.get('e2e2e2e2-1111-4222-8333-eeeeeeeeeeee')).toBeUndefined();
  });

  test('raceRepo.get hits the flat /api/v1/races/:id route', async () => {
    const id = 'a3a3a3a3-1111-4222-8333-aaaaaaaaaaaa';
    const race: Race = { id, seriesId: 'b3b3b3b3-1111-4222-8333-bbbbbbbbbbbb', raceNumber: 1, date: '', createdAt: 0 };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, race));
    const got = await raceRepo.get(id);
    expect(got).toEqual(race);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/races/${id}`);
  });

  test('raceRepo.get returns undefined on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'not-found' }));
    expect(await raceRepo.get('a4a4a4a4-1111-4222-8333-aaaaaaaaaaaa')).toBeUndefined();
  });

  test('pruneFleet deletes when no competitor references the fleet', async () => {
    const seriesId = 'c0c0c0c0-1111-4222-8333-cccccccccccc';
    const fleetId = 'd0d0d0d0-1111-4222-8333-dddddddddddd';
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Promise.resolve(jsonResponse(204));
      return Promise.resolve(jsonResponse(200, [])); // empty competitor list
    });
    await pruneFleet(seriesId, fleetId);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain(`/api/v1/series/${seriesId}/competitors`);
    expect(urls).toContain(`/api/v1/series/${seriesId}/fleets/${fleetId}`);
    const deleteCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'DELETE');
    expect(deleteCall).toBeTruthy();
  });

  test('pruneFleet skips delete when a competitor still references the fleet', async () => {
    const seriesId = 'c1c1c1c1-1111-4222-8333-cccccccccccc';
    const fleetId = 'd1d1d1d1-1111-4222-8333-dddddddddddd';
    const competitor: Competitor = {
      id: 'c2c2c2c2-1111-4222-8333-cccccccccccc',
      seriesId,
      fleetIds: [fleetId],
      sailNumber: '1',
      name: 'X',
      club: '',
      gender: '',
      age: null,
      createdAt: 0,
    };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Promise.resolve(jsonResponse(204));
      return Promise.resolve(jsonResponse(200, [competitor]));
    });
    await pruneFleet(seriesId, fleetId);
    const deleteCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });

  test('ensureFleet POSTs name + options and returns the fleetId', async () => {
    const seriesId = 'a0a0a0a0-1111-4222-8333-aaaaaaaaaaaa';
    const fleetId = 'b0b0b0b0-1111-4222-8333-bbbbbbbbbbbb';
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { fleetId }));
    const result = await ensureFleet(seriesId, 'Cruisers', {
      scoringSystem: 'irc',
    });
    expect(result).toBe(fleetId);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/v1/series/${seriesId}/fleets/ensure`,
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'Cruisers',
      scoringSystem: 'irc',
    });
  });
});
