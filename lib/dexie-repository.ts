import { db } from './db';
import type {
  SeriesRepository,
  CompetitorRepository,
  FleetRepository,
  RaceRepository,
  FinishRepository,
  RaceStartRepository,
} from './repository';
import type { Series, Competitor, Fleet, Race, Finish, FtpServer, RaceStart } from './types';

export const DEFAULT_FLEET_NAME = 'Default';

class DexieSeriesRepository implements SeriesRepository {
  list(): Promise<Series[]> {
    return db.series.orderBy('createdAt').reverse().toArray();
  }

  get(id: string): Promise<Series | undefined> {
    return db.series.get(id);
  }

  async save(series: Series): Promise<Series> {
    await db.series.put(series);
    return series;
  }

  delete(id: string): Promise<void> {
    return db.series.delete(id);
  }

  async touch(id: string): Promise<void> {
    await db.series.update(id, { lastModifiedAt: Date.now() });
  }
}

class DexieCompetitorRepository implements CompetitorRepository {
  listBySeries(seriesId: string): Promise<Competitor[]> {
    return db.competitors
      .where('seriesId')
      .equals(seriesId)
      .sortBy('sailNumber');
  }

  get(id: string): Promise<Competitor | undefined> {
    return db.competitors.get(id);
  }

  async save(competitor: Competitor): Promise<Competitor> {
    await db.competitors.put(competitor);
    return competitor;
  }

  delete(id: string): Promise<void> {
    return db.competitors.delete(id);
  }

  deleteBySeries(seriesId: string): Promise<void> {
    return db.competitors.where('seriesId').equals(seriesId).delete().then(() => undefined);
  }
}

class DexieRaceRepository implements RaceRepository {
  listBySeries(seriesId: string): Promise<Race[]> {
    return db.races
      .where('seriesId')
      .equals(seriesId)
      .sortBy('raceNumber');
  }

  get(id: string): Promise<Race | undefined> {
    return db.races.get(id);
  }

  async save(race: Race): Promise<Race> {
    await db.races.put(race);
    return race;
  }

  delete(id: string): Promise<void> {
    return db.races.delete(id);
  }

  deleteBySeries(seriesId: string): Promise<void> {
    return db.races.where('seriesId').equals(seriesId).delete().then(() => undefined);
  }
}

class DexieFinishRepository implements FinishRepository {
  listByRace(raceId: string): Promise<Finish[]> {
    return db.finishes.where('raceId').equals(raceId).toArray();
  }

  async listBySeries(seriesId: string, competitorIds: string[]): Promise<Finish[]> {
    if (competitorIds.length === 0) return [];
    return db.finishes
      .where('competitorId')
      .anyOf(competitorIds)
      .toArray();
  }

  async save(finish: Finish): Promise<Finish> {
    await db.finishes.put(finish);
    return finish;
  }

  async saveMany(finishes: Finish[]): Promise<void> {
    await db.finishes.bulkPut(finishes);
  }

  delete(id: string): Promise<void> {
    return db.finishes.delete(id);
  }

  deleteByRace(raceId: string): Promise<void> {
    return db.finishes.where('raceId').equals(raceId).delete().then(() => undefined);
  }

  deleteByRaces(raceIds: string[]): Promise<void> {
    if (raceIds.length === 0) return Promise.resolve();
    return db.finishes.where('raceId').anyOf(raceIds).delete().then(() => undefined);
  }
}

class DexieRaceStartRepository implements RaceStartRepository {
  listByRace(raceId: string): Promise<RaceStart[]> {
    return db.raceStarts.where('raceId').equals(raceId).toArray();
  }

  listByRaces(raceIds: string[]): Promise<RaceStart[]> {
    if (raceIds.length === 0) return Promise.resolve([]);
    return db.raceStarts.where('raceId').anyOf(raceIds).toArray();
  }

  async save(raceStart: RaceStart): Promise<RaceStart> {
    await db.raceStarts.put(raceStart);
    return raceStart;
  }

  delete(id: string): Promise<void> {
    return db.raceStarts.delete(id);
  }

  deleteByRace(raceId: string): Promise<void> {
    return db.raceStarts.where('raceId').equals(raceId).delete().then(() => undefined);
  }

  deleteByRaces(raceIds: string[]): Promise<void> {
    if (raceIds.length === 0) return Promise.resolve();
    return db.raceStarts.where('raceId').anyOf(raceIds).delete().then(() => undefined);
  }
}

class DexieFtpServerRepository {
  list(): Promise<FtpServer[]> {
    return db.ftpServers.toArray();
  }

  async save(server: FtpServer): Promise<FtpServer> {
    const id = await db.ftpServers.put(server);
    return { ...server, id: id as number };
  }

  delete(id: number): Promise<void> {
    return db.ftpServers.delete(id);
  }
}

class DexieFleetRepository implements FleetRepository {
  listBySeries(seriesId: string): Promise<Fleet[]> {
    return db.fleets
      .where('seriesId')
      .equals(seriesId)
      .sortBy('displayOrder');
  }

  get(id: string): Promise<Fleet | undefined> {
    return db.fleets.get(id);
  }

  async save(fleet: Fleet): Promise<Fleet> {
    await db.fleets.put(fleet);
    return fleet;
  }

  delete(id: string): Promise<void> {
    return db.fleets.delete(id);
  }

  deleteBySeries(seriesId: string): Promise<void> {
    return db.fleets.where('seriesId').equals(seriesId).delete().then(() => undefined);
  }
}

export const seriesRepo: SeriesRepository = new DexieSeriesRepository();
export const competitorRepo: CompetitorRepository = new DexieCompetitorRepository();
export const fleetRepo: FleetRepository = new DexieFleetRepository();
export const raceRepo: RaceRepository = new DexieRaceRepository();
export const finishRepo: FinishRepository = new DexieFinishRepository();
export const raceStartRepo: RaceStartRepository = new DexieRaceStartRepository();
export const ftpServerRepo = new DexieFtpServerRepository();

/**
 * Delete every child row that belongs (directly or via race) to the given series.
 * Caller is responsible for running inside a transaction that includes all
 * tables touched here — see `deleteSeriesCascade` for the top-level entry point.
 */
export async function deleteSeriesChildren(seriesId: string): Promise<void> {
  const raceIds = (await db.races.where('seriesId').equals(seriesId).toArray()).map((r) => r.id);
  if (raceIds.length > 0) {
    await db.finishes.where('raceId').anyOf(raceIds).delete();
    await db.raceStarts.where('raceId').anyOf(raceIds).delete();
    await db.nhcTcfHistory.where('raceId').anyOf(raceIds).delete();
  }
  await db.races.where('seriesId').equals(seriesId).delete();
  await db.competitors.where('seriesId').equals(seriesId).delete();
  await db.fleets.where('seriesId').equals(seriesId).delete();
}

export async function deleteSeriesCascade(seriesId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.series, db.fleets, db.competitors, db.races, db.finishes, db.raceStarts, db.nhcTcfHistory],
    async () => {
      await deleteSeriesChildren(seriesId);
      await db.series.delete(seriesId);
    },
  );
}

/**
 * Find a fleet by name (case-insensitive) or create it.
 * Blank name → "Default".
 * Returns the fleetId.
 */
export async function ensureFleet(seriesId: string, name: string): Promise<string> {
  const fleetName = name.trim() || DEFAULT_FLEET_NAME;
  const existing = await db.fleets
    .where('seriesId')
    .equals(seriesId)
    .toArray();
  const match = existing.find((f) => f.name.toLowerCase() === fleetName.toLowerCase());
  if (match) return match.id;

  const maxOrder = existing.reduce((max, f) => Math.max(max, f.displayOrder), -1);
  const newFleet: Fleet = {
    id: crypto.randomUUID(),
    seriesId,
    name: fleetName,
    displayOrder: maxOrder + 1,
    scoringSystem: 'scratch',
  };
  await db.fleets.add(newFleet);
  return newFleet.id;
}

/**
 * Delete a fleet if no competitors remain in it.
 */
export async function pruneFleet(seriesId: string, fleetId: string): Promise<void> {
  const count = await db.competitors
    .where('seriesId')
    .equals(seriesId)
    .filter((c) => c.fleetIds.includes(fleetId))
    .count();
  if (count === 0) {
    await db.fleets.delete(fleetId);
  }
}
