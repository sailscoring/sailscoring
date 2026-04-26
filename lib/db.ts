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
    // v2: convert `Series.defaultStartSequence[*].offsetMinutes` (cumulative
    // minutes from the first start) to `intervalMinutes` (gap to the previous
    // start). See #95.
    this.version(2).stores({}).upgrade(async (tx) => {
      const seriesTable = tx.table<Series>('series');
      await seriesTable.toCollection().modify((s) => {
        const legacy = (s as unknown as { defaultStartSequence?: { fleetIds: string[]; offsetMinutes: number }[] }).defaultStartSequence;
        if (!Array.isArray(legacy) || legacy.length === 0) return;
        s.defaultStartSequence = legacy.map((g, i) => ({
          fleetIds: g.fleetIds,
          intervalMinutes: i === 0 ? 0 : Math.max(0, g.offsetMinutes - legacy[i - 1].offsetMinutes),
        }));
      });
    });
  }
}

export const db = new SailScoringDb();
