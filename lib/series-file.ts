import type { Series, ResultCode, DiscardThreshold } from './types';
import { db } from './db';

export const FORMAT_VERSION = 3;
export const FILE_EXTENSION = '.sailscoring';

// ---- File format types ----

interface SeriesFileBilgeBundle {
  uuid: string;
  prefix: string;
  slug: string;
  status: 'unpublished' | 'pending' | 'published';
  publishedUrl: string | null;
  lastPublishedAt: number | null;
}

interface SeriesFileSeries {
  id: string;
  name: string;
  venue: string;
  startDate: string;
  endDate: string;
  venueLogoUrl: string;
  eventLogoUrl: string;
  discardThresholds: DiscardThreshold[];
  dnfScoring: 'seriesEntries' | 'startingArea';
  ftpHost: string;
  ftpPath: string;
  bilgeBundle: SeriesFileBilgeBundle | null;
  includeJsonExport: boolean;
}

interface SeriesFileCompetitor {
  id: string;
  sailNumber: string;
  name: string;
  club: string;
  gender: 'M' | 'F' | '';
  age: number | null;
}

interface SeriesFileFinish {
  id: string;
  competitorId: string;
  finishPosition: number | null;
  resultCode: ResultCode | null;
  startPresent: boolean | null;
}

interface SeriesFileRace {
  id: string;
  raceNumber: number;
  date: string;
  finishes: SeriesFileFinish[];
}

export interface SeriesFile {
  formatVersion: number;
  seriesId: string;
  snapshotId: string;
  snapshotHistory: string[];
  exportedAt: string;
  series: SeriesFileSeries;
  competitors: SeriesFileCompetitor[];
  races: SeriesFileRace[];
}

export type LineageStatus = 'clean' | 'identical' | 'diverged';

export function checkLineage(localSeries: Series, file: SeriesFile): LineageStatus {
  if (!localSeries.lastSnapshotId) return 'diverged';
  if (file.snapshotId === localSeries.lastSnapshotId) return 'identical';
  if (file.snapshotHistory.includes(localSeries.lastSnapshotId)) return 'clean';
  return 'diverged';
}

// ---- Build and save ----

export async function saveSeriesFile(seriesId: string): Promise<void> {
  const series = await db.series.get(seriesId);
  if (!series) throw new Error(`Series ${seriesId} not found`);

  const competitors = await db.competitors
    .where('seriesId')
    .equals(seriesId)
    .sortBy('sailNumber');
  const races = await db.races
    .where('seriesId')
    .equals(seriesId)
    .sortBy('raceNumber');
  const raceIds = races.map((r) => r.id);
  const allFinishes =
    raceIds.length > 0
      ? await db.finishes.where('raceId').anyOf(raceIds).toArray()
      : [];

  const finishesByRace = new Map<string, SeriesFileFinish[]>();
  for (const f of allFinishes) {
    if (!finishesByRace.has(f.raceId)) finishesByRace.set(f.raceId, []);
    finishesByRace.get(f.raceId)!.push({
      id: f.id,
      competitorId: f.competitorId,
      finishPosition: f.finishPosition,
      resultCode: f.resultCode,
      startPresent: f.startPresent,
    });
  }

  const snapshotId = crypto.randomUUID();
  const snapshotHistory = [...series.snapshotHistory, snapshotId];

  const file: SeriesFile = {
    formatVersion: FORMAT_VERSION,
    seriesId: series.id,
    snapshotId,
    snapshotHistory,
    exportedAt: new Date().toISOString(),
    series: {
      id: series.id,
      name: series.name,
      venue: series.venue,
      startDate: series.startDate,
      endDate: series.endDate,
      venueLogoUrl: series.venueLogoUrl,
      eventLogoUrl: series.eventLogoUrl,
      discardThresholds: series.discardThresholds,
      dnfScoring: series.dnfScoring,
      ftpHost: series.ftpHost ?? '',
      ftpPath: series.ftpPath ?? '',
      bilgeBundle: series.bilgeBundle ? {
        uuid: series.bilgeBundle.uuid,
        prefix: series.bilgeBundle.prefix,
        slug: series.bilgeBundle.slug,
        status: series.bilgeBundle.status,
        publishedUrl: series.bilgeBundle.publishedUrl,
        lastPublishedAt: series.bilgeBundle.lastPublishedAt,
      } : null,
      includeJsonExport: series.includeJsonExport ?? true,
    },
    competitors: competitors.map((c) => ({
      id: c.id,
      sailNumber: c.sailNumber,
      name: c.name,
      club: c.club,
      gender: c.gender,
      age: c.age,
    })),
    races: races.map((r) => ({
      id: r.id,
      raceNumber: r.raceNumber,
      date: r.date,
      finishes: finishesByRace.get(r.id) ?? [],
    })),
  };

  // Trigger download
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slugify(series.name) + FILE_EXTENSION;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Record the save
  const now = Date.now();
  await db.series.update(seriesId, {
    lastSnapshotId: snapshotId,
    lastSavedAt: now,
    snapshotHistory,
  });
}

// ---- Parse ----

export function parseSeriesFile(content: string): SeriesFile {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('Invalid file: not valid JSON');
  }
  if (typeof data !== 'object' || data === null) throw new Error('Invalid file format');
  const obj = data as Record<string, unknown>;
  if (typeof obj.formatVersion !== 'number' || obj.formatVersion < 1 || obj.formatVersion > FORMAT_VERSION)
    throw new Error(`Unsupported file format version: ${obj.formatVersion}`);
  if (typeof obj.seriesId !== 'string') throw new Error('Invalid file: missing seriesId');
  if (typeof obj.snapshotId !== 'string') throw new Error('Invalid file: missing snapshotId');
  if (!Array.isArray(obj.snapshotHistory)) throw new Error('Invalid file: missing snapshotHistory');
  if (typeof obj.exportedAt !== 'string') throw new Error('Invalid file: missing exportedAt');
  if (typeof obj.series !== 'object' || obj.series === null)
    throw new Error('Invalid file: missing series');
  if (!Array.isArray(obj.competitors)) throw new Error('Invalid file: missing competitors');
  if (!Array.isArray(obj.races)) throw new Error('Invalid file: missing races');
  return data as SeriesFile;
}

// ---- Open as new series ----

async function uniqueSeriesName(baseName: string): Promise<string> {
  const existing = await db.series.toArray();
  const names = new Set(existing.map((s) => s.name));
  if (!names.has(baseName)) return baseName;
  let n = 2;
  while (names.has(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

export async function openSeriesFromFile(file: SeriesFile): Promise<string> {
  const newSeriesId = crypto.randomUUID();
  const now = Date.now();
  const name = await uniqueSeriesName(file.series.name);

  // Remap IDs to avoid conflicts with existing DB records
  const competitorIdMap = new Map(file.competitors.map((c) => [c.id, crypto.randomUUID()]));
  const raceIdMap = new Map(file.races.map((r) => [r.id, crypto.randomUUID()]));

  await db.transaction('rw', [db.series, db.competitors, db.races, db.finishes], async () => {
    await db.series.add({
      id: newSeriesId,
      name,
      venue: file.series.venue,
      startDate: file.series.startDate ?? '',
      endDate: file.series.endDate ?? '',
      venueLogoUrl: file.series.venueLogoUrl ?? '',
      eventLogoUrl: file.series.eventLogoUrl ?? '',
      createdAt: now,
      lastSnapshotId: file.snapshotId,
      lastSavedAt: null,
      lastModifiedAt: now,
      snapshotHistory: [...file.snapshotHistory],
      discardThresholds: file.series.discardThresholds ?? [],
      dnfScoring: file.series.dnfScoring ?? 'seriesEntries',
      ftpHost: file.series.ftpHost ?? '',
      ftpPath: file.series.ftpPath ?? '',
      bilgeBundle: file.series.bilgeBundle ?? null,
      includeJsonExport: file.series.includeJsonExport ?? true,
    });

    for (const c of file.competitors) {
      await db.competitors.add({
        id: competitorIdMap.get(c.id)!,
        seriesId: newSeriesId,
        sailNumber: c.sailNumber,
        name: c.name,
        club: c.club,
        gender: c.gender,
        age: c.age,
        createdAt: now,
      });
    }

    for (const r of file.races) {
      const newRaceId = raceIdMap.get(r.id)!;
      await db.races.add({
        id: newRaceId,
        seriesId: newSeriesId,
        raceNumber: r.raceNumber,
        date: r.date,
        createdAt: now,
      });
      for (const f of r.finishes) {
        await db.finishes.add({
          id: crypto.randomUUID(),
          raceId: newRaceId,
          competitorId: competitorIdMap.get(f.competitorId)!,
          finishPosition: f.finishPosition,
          resultCode: f.resultCode,
          startPresent: f.startPresent ?? null,
        });
      }
    }
  });

  return newSeriesId;
}

// ---- Update existing series from file ----

export async function updateSeriesFromFile(seriesId: string, file: SeriesFile): Promise<void> {
  const now = Date.now();

  const competitorIdMap = new Map(file.competitors.map((c) => [c.id, crypto.randomUUID()]));
  const raceIdMap = new Map(file.races.map((r) => [r.id, crypto.randomUUID()]));

  await db.transaction('rw', [db.series, db.competitors, db.races, db.finishes], async () => {
    const existingRaces = await db.races.where('seriesId').equals(seriesId).toArray();
    if (existingRaces.length > 0) {
      await db.finishes.where('raceId').anyOf(existingRaces.map((r) => r.id)).delete();
    }
    await db.races.where('seriesId').equals(seriesId).delete();
    await db.competitors.where('seriesId').equals(seriesId).delete();

    await db.series.update(seriesId, {
      name: file.series.name,
      venue: file.series.venue,
      startDate: file.series.startDate ?? '',
      endDate: file.series.endDate ?? '',
      venueLogoUrl: file.series.venueLogoUrl ?? '',
      eventLogoUrl: file.series.eventLogoUrl ?? '',
      lastSnapshotId: file.snapshotId,
      lastModifiedAt: now,
      snapshotHistory: [...file.snapshotHistory],
      discardThresholds: file.series.discardThresholds ?? [],
      dnfScoring: file.series.dnfScoring ?? 'seriesEntries',
      ftpHost: file.series.ftpHost ?? '',
      ftpPath: file.series.ftpPath ?? '',
      bilgeBundle: file.series.bilgeBundle ?? null,
      includeJsonExport: file.series.includeJsonExport ?? true,
    });

    for (const c of file.competitors) {
      await db.competitors.add({
        id: competitorIdMap.get(c.id)!,
        seriesId,
        sailNumber: c.sailNumber,
        name: c.name,
        club: c.club,
        gender: c.gender,
        age: c.age,
        createdAt: now,
      });
    }

    for (const r of file.races) {
      const newRaceId = raceIdMap.get(r.id)!;
      await db.races.add({
        id: newRaceId,
        seriesId,
        raceNumber: r.raceNumber,
        date: r.date,
        createdAt: now,
      });
      for (const f of r.finishes) {
        await db.finishes.add({
          id: crypto.randomUUID(),
          raceId: newRaceId,
          competitorId: competitorIdMap.get(f.competitorId)!,
          finishPosition: f.finishPosition,
          resultCode: f.resultCode,
          startPresent: f.startPresent ?? null,
        });
      }
    }
  });
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'series'
  );
}
