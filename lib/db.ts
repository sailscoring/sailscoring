import Dexie, { type Table } from 'dexie';
import type { Series, Competitor, Race, Finish } from './types';

export class SailScoringDb extends Dexie {
  series!: Table<Series>;
  competitors!: Table<Competitor>;
  races!: Table<Race>;
  finishes!: Table<Finish>;

  constructor() {
    super('sailscoring');
    this.version(1).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, createdAt',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
    });
  }
}

export const db = new SailScoringDb();
