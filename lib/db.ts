import Dexie, { type Table } from 'dexie';
import type { Series, Competitor, Race, Finish, FtpServer } from './types';

export class SailScoringDb extends Dexie {
  series!: Table<Series>;
  competitors!: Table<Competitor>;
  races!: Table<Race>;
  finishes!: Table<Finish>;
  ftpServers!: Table<FtpServer>;

  constructor() {
    super('sailscoring');
    this.version(1).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, createdAt',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
    });
    this.version(2).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, createdAt',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
    }).upgrade(async (tx) => {
      await tx.table('series').toCollection().modify((series) => {
        series.lastSnapshotId = null;
        series.lastSavedAt = null;
        series.lastModifiedAt = series.createdAt;
        series.snapshotHistory = [];
      });
    });
    this.version(3).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, createdAt',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
    }).upgrade(async (tx) => {
      await tx.table('series').toCollection().modify((series) => {
        series.startDate = series.date ?? '';
        series.endDate = '';
        series.venueLogoUrl = '';
        series.eventLogoUrl = '';
        delete series.date;
      });
    });
    this.version(4).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, createdAt',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
    }).upgrade(async (tx) => {
      await tx.table('series').toCollection().modify((series) => {
        series.discardThresholds = [];
      });
    });
    this.version(5).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, createdAt',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
    }).upgrade(async (tx) => {
      await tx.table('series').toCollection().modify((series) => {
        series.dnfScoring = 'seriesEntries';
      });
      await tx.table('finishes').toCollection().modify((finish) => {
        finish.startPresent = null;
      });
    });
    this.version(6).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, createdAt',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
      ftpServers: '++id',
    });
    this.version(7).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, createdAt',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
      ftpServers: '++id',
    }).upgrade(async (tx) => {
      await tx.table('series').toCollection().modify((series) => {
        series.ftpHost = '';
        series.ftpPath = '';
      });
    });
    this.version(8).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, createdAt',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
      ftpServers: '++id',
    }).upgrade(async (tx) => {
      await tx.table('series').toCollection().modify((series) => {
        series.bilgeBundle = null;
      });
    });
  }
}

export const db = new SailScoringDb();
