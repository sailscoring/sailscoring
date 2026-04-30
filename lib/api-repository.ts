/**
 * ADR-008 Phase 2 client-side repository. Mirrors lib/dexie-repository.ts
 * symbol-for-symbol so Phase 3's UI swap is a near-mechanical import
 * change. Implementations forward through fetch() to /api/v1.
 *
 * Phase 3 will introduce TanStack Query around these calls; Phase 2
 * just builds the surface.
 */
import { apiFetch } from './api-client';
import type {
  CompetitorRepository,
  FinishRepository,
  FleetRepository,
  FtpServerRepository,
  RaceRepository,
  RaceStartRepository,
  SeriesRepository,
} from './repository';
import type {
  Competitor,
  Finish,
  Fleet,
  FtpServer,
  Race,
  RaceStart,
  Series,
} from './types';

export const DEFAULT_FLEET_NAME = 'Default';

class ApiSeriesRepository implements SeriesRepository {
  async list(): Promise<Series[]> {
    const { items } = await apiFetch<{ items: Series[] }>('/api/v1/series');
    return items;
  }

  get(id: string): Promise<Series | undefined> {
    return apiFetch<Series | undefined>(`/api/v1/series/${id}`, { allow404: true });
  }

  save(s: Series): Promise<Series> {
    return apiFetch<Series>(`/api/v1/series/${s.id}`, { method: 'PUT', body: s });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/series/${id}`, { method: 'DELETE' });
  }

  async touch(id: string): Promise<void> {
    await apiFetch(`/api/v1/series/${id}/touch`, { method: 'POST' });
  }
}

class ApiFleetRepository implements FleetRepository {
  listBySeries(seriesId: string): Promise<Fleet[]> {
    return apiFetch<Fleet[]>(`/api/v1/series/${seriesId}/fleets`);
  }

  get(id: string): Promise<Fleet | undefined> {
    // The /api/v1 surface routes fleets under /series/:id/fleets/:fleetId,
    // but the repository interface here only has the fleet id. Two options:
    // (a) carry seriesId on the call sites in Phase 3; (b) add a
    // fleet-by-id endpoint on the server. Phase 2 picks (a) — `get(id)` is
    // currently unused outside the dexie repo's own internals; if Phase 3
    // turns out to need it, we'll add a flat endpoint.
    return Promise.reject(
      new Error('ApiFleetRepository.get(id) requires seriesId; use listBySeries'),
    ).catch(() => undefined);
  }

  save(fleet: Fleet): Promise<Fleet> {
    return apiFetch<Fleet>(`/api/v1/series/${fleet.seriesId}/fleets/${fleet.id}`, {
      method: 'PUT',
      body: fleet,
    });
  }

  async delete(id: string): Promise<void> {
    // Same caveat as get — see above.
    void id;
    throw new Error('ApiFleetRepository.delete(id) requires seriesId; use saveAll/list');
  }

  async deleteBySeries(seriesId: string): Promise<void> {
    // No collection-delete endpoint today — fan out one per fleet.
    const fleets = await this.listBySeries(seriesId);
    await Promise.all(
      fleets.map((f) =>
        apiFetch(`/api/v1/series/${seriesId}/fleets/${f.id}`, { method: 'DELETE' }),
      ),
    );
  }
}

class ApiCompetitorRepository implements CompetitorRepository {
  listBySeries(seriesId: string): Promise<Competitor[]> {
    return apiFetch<Competitor[]>(`/api/v1/series/${seriesId}/competitors`);
  }

  get(id: string): Promise<Competitor | undefined> {
    void id;
    return Promise.resolve(undefined);
  }

  save(c: Competitor): Promise<Competitor> {
    return apiFetch<Competitor>(
      `/api/v1/series/${c.seriesId}/competitors/${c.id}`,
      { method: 'PUT', body: c },
    );
  }

  async delete(id: string): Promise<void> {
    void id;
    throw new Error('ApiCompetitorRepository.delete(id) requires seriesId');
  }

  async deleteBySeries(seriesId: string): Promise<void> {
    const competitors = await this.listBySeries(seriesId);
    await Promise.all(
      competitors.map((c) =>
        apiFetch(`/api/v1/series/${seriesId}/competitors/${c.id}`, { method: 'DELETE' }),
      ),
    );
  }
}

class ApiRaceRepository implements RaceRepository {
  listBySeries(seriesId: string): Promise<Race[]> {
    return apiFetch<Race[]>(`/api/v1/series/${seriesId}/races`);
  }

  get(id: string): Promise<Race | undefined> {
    void id;
    return Promise.resolve(undefined);
  }

  save(r: Race): Promise<Race> {
    return apiFetch<Race>(`/api/v1/series/${r.seriesId}/races/${r.id}`, {
      method: 'PUT',
      body: r,
    });
  }

  async delete(id: string): Promise<void> {
    void id;
    throw new Error('ApiRaceRepository.delete(id) requires seriesId');
  }

  async deleteBySeries(seriesId: string): Promise<void> {
    const races = await this.listBySeries(seriesId);
    await Promise.all(
      races.map((r) =>
        apiFetch(`/api/v1/series/${seriesId}/races/${r.id}`, { method: 'DELETE' }),
      ),
    );
  }
}

class ApiRaceStartRepository implements RaceStartRepository {
  listByRace(raceId: string): Promise<RaceStart[]> {
    return apiFetch<RaceStart[]>(`/api/v1/races/${raceId}/starts`);
  }

  async listByRaces(raceIds: string[]): Promise<RaceStart[]> {
    const lists = await Promise.all(raceIds.map((id) => this.listByRace(id)));
    return lists.flat();
  }

  save(s: RaceStart): Promise<RaceStart> {
    return apiFetch<RaceStart>(`/api/v1/races/${s.raceId}/starts/${s.id}`, {
      method: 'PUT',
      body: s,
    });
  }

  async delete(id: string): Promise<void> {
    void id;
    throw new Error('ApiRaceStartRepository.delete(id) requires raceId');
  }

  async deleteByRace(raceId: string): Promise<void> {
    const starts = await this.listByRace(raceId);
    await Promise.all(
      starts.map((s) =>
        apiFetch(`/api/v1/races/${raceId}/starts/${s.id}`, { method: 'DELETE' }),
      ),
    );
  }

  async deleteByRaces(raceIds: string[]): Promise<void> {
    await Promise.all(raceIds.map((r) => this.deleteByRace(r)));
  }
}

class ApiFinishRepository implements FinishRepository {
  listByRace(raceId: string): Promise<Finish[]> {
    return apiFetch<Finish[]>(`/api/v1/races/${raceId}/finishes`);
  }

  async listBySeries(seriesId: string, _competitorIds: string[]): Promise<Finish[]> {
    void _competitorIds;
    // Server side filters by series automatically; fan-out via races.
    const races = await apiFetch<Race[]>(`/api/v1/series/${seriesId}/races`);
    const lists = await Promise.all(races.map((r) => this.listByRace(r.id)));
    return lists.flat();
  }

  save(f: Finish): Promise<Finish> {
    return apiFetch<Finish>(`/api/v1/races/${f.raceId}/finishes/${f.id}`, {
      method: 'PUT',
      body: f,
    });
  }

  async saveMany(finishes: Finish[]): Promise<void> {
    if (finishes.length === 0) return;
    // All finishes must share a single race id for the bulk endpoint.
    const byRace = new Map<string, Finish[]>();
    for (const f of finishes) {
      const list = byRace.get(f.raceId) ?? [];
      list.push(f);
      byRace.set(f.raceId, list);
    }
    await Promise.all(
      [...byRace.entries()].map(([raceId, list]) =>
        apiFetch(`/api/v1/races/${raceId}/finishes`, {
          method: 'POST',
          body: { finishes: list },
        }),
      ),
    );
  }

  async delete(id: string): Promise<void> {
    void id;
    throw new Error('ApiFinishRepository.delete(id) requires raceId');
  }

  async deleteByRace(raceId: string): Promise<void> {
    const finishes = await this.listByRace(raceId);
    await Promise.all(
      finishes.map((f) =>
        apiFetch(`/api/v1/races/${raceId}/finishes/${f.id}`, { method: 'DELETE' }),
      ),
    );
  }

  async deleteByRaces(raceIds: string[]): Promise<void> {
    await Promise.all(raceIds.map((r) => this.deleteByRace(r)));
  }
}

class ApiFtpServerRepository implements FtpServerRepository {
  list(): Promise<FtpServer[]> {
    return apiFetch<FtpServer[]>('/api/v1/ftp-servers');
  }

  save(server: FtpServer): Promise<FtpServer> {
    return apiFetch<FtpServer>(`/api/v1/ftp-servers/${server.id}`, {
      method: 'PUT',
      body: server,
    });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/ftp-servers/${id}`, { method: 'DELETE' });
  }
}

export const seriesRepo: SeriesRepository = new ApiSeriesRepository();
export const fleetRepo: FleetRepository = new ApiFleetRepository();
export const competitorRepo: CompetitorRepository = new ApiCompetitorRepository();
export const raceRepo: RaceRepository = new ApiRaceRepository();
export const raceStartRepo: RaceStartRepository = new ApiRaceStartRepository();
export const finishRepo: FinishRepository = new ApiFinishRepository();
export const ftpServerRepo: FtpServerRepository = new ApiFtpServerRepository();
