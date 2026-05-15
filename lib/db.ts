import Dexie, { type Table } from 'dexie';
import type { Series, Competitor, Fleet, Race, Finish, FtpServer, RaceStart, TcfRecord } from './types';

export class SailScoringDb extends Dexie {
  series!: Table<Series>;
  competitors!: Table<Competitor>;
  fleets!: Table<Fleet>;
  races!: Table<Race>;
  finishes!: Table<Finish>;
  raceStarts!: Table<RaceStart>;
  ftpServers!: Table<FtpServer>;
  tcfHistory!: Table<TcfRecord>;

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
    // v3–v6: ADR-008 Phase 3 parity. Convert ftpServers' primary key from
    // auto-incrementing number to UUID string, matching the server-side
    // schema. Dexie cannot change a primary key in place ("Not yet support
    // for changing primary key"), so the swap is staged across four
    // versions: stash existing rows (v3), drop the old table (v4), recreate
    // with the new PK and restore (v5), drop the stash (v6).
    this.version(3)
      .stores({ ftpServersStashV3: '++stashId' })
      .upgrade(async (tx) => {
        const rows = await tx.table('ftpServers').toArray();
        if (rows.length > 0) {
          await tx.table('ftpServersStashV3').bulkAdd(rows);
        }
      });
    this.version(4).stores({ ftpServers: null });
    this.version(5)
      .stores({ ftpServers: 'id', ftpServersStashV3: '++stashId' })
      .upgrade(async (tx) => {
        const stashed = (await tx.table('ftpServersStashV3').toArray()) as Array<{
          host: string;
          port: number;
          username: string;
          password: string;
          ftps: boolean;
        }>;
        if (stashed.length > 0) {
          await tx.table('ftpServers').bulkAdd(
            stashed.map((row) => ({
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
    this.version(6).stores({ ftpServersStashV3: null });
    // v7–v8: rename `nhcTcfHistory` to `tcfHistory` (the store holds records
    // for both NHC and ECHO, despite the legacy name). Dexie has no in-place
    // rename, so v7 creates the new store and copies rows over, v8 drops the
    // old store.
    this.version(7)
      .stores({
        tcfHistory: 'id, raceId, [raceId+fleetId], [raceId+competitorId+fleetId]',
      })
      .upgrade(async (tx) => {
        const rows = await tx.table('nhcTcfHistory').toArray();
        if (rows.length > 0) {
          await tx.table('tcfHistory').bulkAdd(rows);
        }
      });
    this.version(8).stores({ nhcTcfHistory: null });
  }
}

export const db = new SailScoringDb();
