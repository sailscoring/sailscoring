import Dexie, { type Table } from 'dexie';
import type { Series, Competitor, Fleet, Race, Finish, FtpServer, RaceStart } from './types';

export class SailScoringDb extends Dexie {
  series!: Table<Series>;
  competitors!: Table<Competitor>;
  fleets!: Table<Fleet>;
  races!: Table<Race>;
  finishes!: Table<Finish>;
  raceStarts!: Table<RaceStart>;
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
    this.version(9).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, createdAt',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
      ftpServers: '++id',
    }).upgrade(async (tx) => {
      await tx.table('series').toCollection().modify((series) => {
        series.includeJsonExport = true;
      });
    });
    this.version(10).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, fleetId, createdAt',
      fleets: 'id, seriesId, displayOrder',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
      ftpServers: '++id',
    }).upgrade(async (tx) => {
      const allSeries = await tx.table('series').toArray();
      for (const s of allSeries) {
        const fleetId = crypto.randomUUID();
        await tx.table('fleets').add({ id: fleetId, seriesId: s.id, name: 'Default', displayOrder: 0, scoringSystem: 'scratch' });
        await tx.table('competitors').where('seriesId').equals(s.id).modify({ fleetId });
      }
    });
    this.version(11).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, fleetId, createdAt',
      fleets: 'id, seriesId, displayOrder',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
      ftpServers: '++id',
    });
    this.version(12).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, fleetId, createdAt',
      fleets: 'id, seriesId, displayOrder',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
      ftpServers: '++id',
    }).upgrade(async (tx) => {
      await tx.table('finishes').toCollection().modify((finish) => {
        finish.penaltyCode = null;
        finish.penaltyOverride = null;
      });
    });
    this.version(13).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, fleetId, createdAt',
      fleets: 'id, seriesId, displayOrder',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
      ftpServers: '++id',
    }).upgrade(async (tx) => {
      await tx.table('finishes').toCollection().modify((finish) => {
        finish.redressMethod = null;
        finish.redressExcludeRaces = null;
        finish.redressIncludeRaces = null;
        finish.redressIncludeAllLater = false;
        finish.redressPoints = null;
      });
    });
    this.version(14).stores({
      series: 'id, createdAt',
      competitors: 'id, seriesId, *fleetIds, createdAt',
      fleets: 'id, seriesId, displayOrder',
      races: 'id, seriesId, raceNumber',
      finishes: 'id, raceId, competitorId',
      raceStarts: 'id, raceId',
      ftpServers: '++id',
    }).upgrade(async (tx) => {
      await tx.table('competitors').toCollection().modify((competitor) => {
        competitor.fleetIds = [competitor.fleetId];
        delete competitor.fleetId;
      });
      await tx.table('fleets').toCollection().modify((fleet) => {
        fleet.scoringSystem = 'scratch';
      });
    });
  }
}

export const db = new SailScoringDb();
