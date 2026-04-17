import Dexie, { type Table } from 'dexie';
import type { Series, Competitor, Fleet, Race, Finish, FtpServer, RaceStart, NhcTcfRecord } from './types';

export class SailScoringDb extends Dexie {
  series!: Table<Series>;
  competitors!: Table<Competitor>;
  fleets!: Table<Fleet>;
  races!: Table<Race>;
  finishes!: Table<Finish>;
  raceStarts!: Table<RaceStart>;
  ftpServers!: Table<FtpServer>;
  nhcTcfHistory!: Table<NhcTcfRecord>;

  constructor() {
    super('sailscoring-v1');
    this.version(1).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, *fleetIds, createdAt',
      fleets: 'id, seriesId, displayOrder',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
      raceStarts: 'id, raceId',
      ftpServers: '++id',
      nhcTcfHistory: 'id, raceId, [raceId+fleetId], [raceId+competitorId+fleetId]',
    });
  }
}

export const db = new SailScoringDb();
