import { db } from './db';
import type {
  SeriesRepository,
  CompetitorRepository,
  RaceRepository,
  FinishRepository,
} from './repository';
import type { Series, Competitor, Race, Finish, FtpServer } from './types';

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

export const seriesRepo: SeriesRepository = new DexieSeriesRepository();
export const competitorRepo: CompetitorRepository = new DexieCompetitorRepository();
export const raceRepo: RaceRepository = new DexieRaceRepository();
export const finishRepo: FinishRepository = new DexieFinishRepository();
export const ftpServerRepo = new DexieFtpServerRepository();
