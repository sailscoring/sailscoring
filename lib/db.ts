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
    // v3: ADR-008 Phase 3 parity. Convert ftpServers' auto-incrementing number
    // primary key to a string UUID, matching the server-side schema. Dexie
    // does not allow changing a primary key in place, so we read all rows,
    // clear the table, and re-insert with fresh UUIDs.
    this.version(3).stores({ ftpServers: 'id' }).upgrade(async (tx) => {
      const ftpTable = tx.table('ftpServers');
      const existing = (await ftpTable.toArray()) as Array<{
        host: string;
        port: number;
        username: string;
        password: string;
        ftps: boolean;
      }>;
      await ftpTable.clear();
      if (existing.length > 0) {
        await ftpTable.bulkAdd(
          existing.map((row) => ({
            id: crypto.randomUUID(),
            host: row.host,
            port: row.port,
            username: row.username,
            password: row.password,
            ftps: row.ftps,
          })),
        );
      }
    });
  }
}

export const db = new SailScoringDb();
