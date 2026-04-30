import type { Series, Competitor, Fleet, Race, Finish, FtpServer, RaceStart } from './types';

export interface FleetRepository {
  listBySeries(seriesId: string): Promise<Fleet[]>;
  get(id: string): Promise<Fleet | undefined>;
  save(fleet: Fleet): Promise<Fleet>;
  delete(id: string): Promise<void>;
  deleteBySeries(seriesId: string): Promise<void>;
}

export interface SeriesRepository {
  list(): Promise<Series[]>;
  get(id: string): Promise<Series | undefined>;
  save(series: Series): Promise<Series>;
  delete(id: string): Promise<void>;
  touch(id: string): Promise<void>;
}

export interface CompetitorRepository {
  listBySeries(seriesId: string): Promise<Competitor[]>;
  get(id: string): Promise<Competitor | undefined>;
  save(competitor: Competitor): Promise<Competitor>;
  delete(id: string): Promise<void>;
  deleteBySeries(seriesId: string): Promise<void>;
}

export interface RaceRepository {
  listBySeries(seriesId: string): Promise<Race[]>;
  get(id: string): Promise<Race | undefined>;
  save(race: Race): Promise<Race>;
  delete(id: string): Promise<void>;
  deleteBySeries(seriesId: string): Promise<void>;
}

export interface FinishRepository {
  listByRace(raceId: string): Promise<Finish[]>;
  listBySeries(seriesId: string, competitorIds: string[]): Promise<Finish[]>;
  save(finish: Finish): Promise<Finish>;
  saveMany(finishes: Finish[]): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByRace(raceId: string): Promise<void>;
  deleteByRaces(raceIds: string[]): Promise<void>;
}

export interface RaceStartRepository {
  listByRace(raceId: string): Promise<RaceStart[]>;
  listByRaces(raceIds: string[]): Promise<RaceStart[]>;
  save(raceStart: RaceStart): Promise<RaceStart>;
  delete(id: string): Promise<void>;
  deleteByRace(raceId: string): Promise<void>;
  deleteByRaces(raceIds: string[]): Promise<void>;
}

/**
 * Workspace-scoped FTP server credentials. Local Dexie store and remote
 * Postgres store both implement this interface; the Postgres backend
 * encrypts the password column at the application layer (lib/crypto.ts)
 * per ADR-008's sustainability posture.
 */
export interface FtpServerRepository {
  list(): Promise<FtpServer[]>;
  save(server: FtpServer): Promise<FtpServer>;
  delete(id: string): Promise<void>;
}
