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
  SaveOpts,
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

  save(s: Series, opts?: SaveOpts): Promise<Series> {
    return apiFetch<Series>(`/api/v1/series/${s.id}`, {
      method: 'PUT',
      body: s,
      expectedVersion: opts?.expectedVersion,
    });
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

  save(fleet: Fleet, opts?: SaveOpts): Promise<Fleet> {
    return apiFetch<Fleet>(`/api/v1/series/${fleet.seriesId}/fleets/${fleet.id}`, {
      method: 'PUT',
      body: fleet,
      expectedVersion: opts?.expectedVersion,
    });
  }

  async saveMany(fleets: Fleet[]): Promise<void> {
    if (fleets.length === 0) return;
    const seriesIds = new Set(fleets.map((f) => f.seriesId));
    if (seriesIds.size !== 1) {
      throw new Error('saveMany: all fleets must share a seriesId');
    }
    const [seriesId] = seriesIds;
    await apiFetch(`/api/v1/series/${seriesId}/fleets`, {
      method: 'POST',
      body: { fleets },
    });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/fleets/${id}`, { method: 'DELETE' });
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
    return apiFetch<Competitor | undefined>(`/api/v1/competitors/${id}`, { allow404: true });
  }

  save(c: Competitor, opts?: SaveOpts): Promise<Competitor> {
    return apiFetch<Competitor>(
      `/api/v1/series/${c.seriesId}/competitors/${c.id}`,
      { method: 'PUT', body: c, expectedVersion: opts?.expectedVersion },
    );
  }

  async saveMany(competitors: Competitor[]): Promise<void> {
    if (competitors.length === 0) return;
    const seriesIds = new Set(competitors.map((c) => c.seriesId));
    if (seriesIds.size !== 1) {
      throw new Error('saveMany: all competitors must share a seriesId');
    }
    const [seriesId] = seriesIds;
    await apiFetch(`/api/v1/series/${seriesId}/competitors`, {
      method: 'POST',
      body: { competitors },
    });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/competitors/${id}`, { method: 'DELETE' });
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
    return apiFetch<Race | undefined>(`/api/v1/races/${id}`, { allow404: true });
  }

  save(r: Race, opts?: SaveOpts): Promise<Race> {
    return apiFetch<Race>(`/api/v1/series/${r.seriesId}/races/${r.id}`, {
      method: 'PUT',
      body: r,
      expectedVersion: opts?.expectedVersion,
    });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/races/${id}`, { method: 'DELETE' });
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

  save(s: RaceStart, opts?: SaveOpts): Promise<RaceStart> {
    return apiFetch<RaceStart>(`/api/v1/races/${s.raceId}/starts/${s.id}`, {
      method: 'PUT',
      body: s,
      expectedVersion: opts?.expectedVersion,
    });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/race-starts/${id}`, { method: 'DELETE' });
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

  save(f: Finish, opts?: SaveOpts): Promise<Finish> {
    return apiFetch<Finish>(`/api/v1/races/${f.raceId}/finishes/${f.id}`, {
      method: 'PUT',
      body: f,
      expectedVersion: opts?.expectedVersion,
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
    await apiFetch(`/api/v1/finishes/${id}`, { method: 'DELETE' });
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

  save(server: FtpServer, opts?: SaveOpts): Promise<FtpServer> {
    return apiFetch<FtpServer>(`/api/v1/ftp-servers/${server.id}`, {
      method: 'PUT',
      body: server,
      expectedVersion: opts?.expectedVersion,
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

/**
 * Mirror of `listSeriesNames` from `lib/dexie-repository.ts`. Used by the
 * "new series" / "rename series" duplicate-name check. Workspaces are
 * small, so projecting names from the full series list is acceptable.
 * If list sizes ever justify it, add a `?fields=names` projection on
 * `/api/v1/series` and switch this helper.
 */
export async function listSeriesNames(
  opts: { excludeId?: string } = {},
): Promise<string[]> {
  const all = await seriesRepo.list();
  return all.filter((s) => s.id !== opts.excludeId).map((s) => s.name);
}

/**
 * Delete every child row (fleets, competitors, races, plus their FK-
 * cascaded descendants: race-starts, finishes, nhc-tcf-records) but
 * leave the series row itself in place. Mirror of the Dexie helper used
 * by `lib/series-file.ts`'s "update from file" flow.
 *
 * Server-side FK constraints handle race-starts/finishes/nhc-tcf-records
 * — deleting races cascades to all of them. We only need to clear the
 * three top-level child collections.
 */
export async function deleteSeriesChildren(seriesId: string): Promise<void> {
  await raceRepo.deleteBySeries(seriesId);
  await competitorRepo.deleteBySeries(seriesId);
  await fleetRepo.deleteBySeries(seriesId);
}

/**
 * Delete a series and every child row. Mirror of the Dexie helper.
 * The Postgres schema's `onDelete: 'cascade'` on every child series_id
 * FK does the work; this wrapper exists so callers don't need to know.
 */
export async function deleteSeriesCascade(seriesId: string): Promise<void> {
  await seriesRepo.delete(seriesId);
}

/**
 * Delete a fleet only if no competitor in the series references it.
 * Mirror of the Dexie helper used by the fleets-card "remove fleet" flow.
 * Implemented client-side as list-then-delete; concurrent edits in the
 * same workspace would surface as a 409 in Phase 4 once `version` is
 * wired into the delete path.
 */
export async function pruneFleet(seriesId: string, fleetId: string): Promise<void> {
  const competitors = await competitorRepo.listBySeries(seriesId);
  const inUse = competitors.some((c) => c.fleetIds.includes(fleetId));
  if (inUse) return;
  await apiFetch(`/api/v1/series/${seriesId}/fleets/${fleetId}`, {
    method: 'DELETE',
  });
}

/**
 * ADR-008 Phase 7 — copy a series into another workspace the caller is
 * a member of. Server-only feature; there's no Dexie equivalent because
 * local-first mode has only the implicit "this device" workspace.
 *
 * Returns the new series id in the target workspace. After success,
 * callers typically need to call `authClient.organization.setActive()`
 * to switch the session into the target workspace before navigating
 * to `/series/{newId}/...`.
 */
export async function copySeriesToWorkspace(
  sourceSeriesId: string,
  body: { targetWorkspaceId: string; name?: string },
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/v1/series/${sourceSeriesId}/copy`, {
    method: 'POST',
    body,
  });
}

/**
 * Find or create a fleet by case-insensitive name. Mirror of the Dexie
 * helper used by the CSV competitor importer. The server endpoint wraps
 * the lookup-then-insert in a Postgres transaction guarded by an
 * advisory lock keyed on series id, so concurrent imports never produce
 * duplicate fleets.
 *
 * `scoringSystem` and the alpha defaults apply only when *creating* a
 * new fleet.
 */
export async function ensureFleet(
  seriesId: string,
  name: string,
  options?: {
    scoringSystem?: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo';
    echoAlpha?: number;
  },
): Promise<string> {
  const { fleetId } = await apiFetch<{ fleetId: string }>(
    `/api/v1/series/${seriesId}/fleets/ensure`,
    { method: 'POST', body: { name, ...options } },
  );
  return fleetId;
}
