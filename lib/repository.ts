import type { Series, Competitor, Race, Finish } from './types';

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
  deleteByRace(raceId: string): Promise<void>;
  deleteByRaces(raceIds: string[]): Promise<void>;
}
