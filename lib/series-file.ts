import type { Series, ResultCode, PenaltyCode, DiscardThreshold, RaceStart, CompetitorFieldKey, StartGroup, NhcTcfRecord } from './types';
import { db } from './db';
import { defaultEnabledCompetitorFields } from './competitor-fields';
import { recomputeNhcHistoryForSeries } from './nhc-persistence';

export const FORMAT_VERSION = 11;
export const FILE_EXTENSION = '.sailscoring';

// ---- File format types ----

interface SeriesFileFleet {
  id: string;
  name: string;
  displayOrder: number;
  scoringSystem?: 'scratch' | 'irc' | 'py' | 'nhc';  // 'nhc' added in v11
  nhcAlpha?: number;  // v11+; present iff scoringSystem === 'nhc'
}

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
  enabledCompetitorFields?: CompetitorFieldKey[];  // v8+; defaulted on read for older files
  scoringMode?: 'scratch' | 'handicap';            // v9+; defaults to 'scratch' for older files
  defaultStartSequence?: StartGroup[];              // v9+; undefined for older files
  publishRatingCalculations?: boolean;              // v11+; default true on read
}

interface SeriesFileCompetitor {
  id: string;
  fleetIds?: string[];   // v7+
  fleetId?: string;      // pre-v7 back-compat; prefer fleetIds when present
  sailNumber: string;
  boatName?: string;
  boatClass?: string;    // v10+
  name: string;
  crewName?: string;     // v8+
  club: string;
  gender: 'M' | 'F' | '';
  age: number | null;
  ircTcc?: number;
  pyNumber?: number;
  nhcStartingTcf?: number;  // v11+
}

interface SeriesFileFinish {
  id: string;
  competitorId: string | null;
  unknownSailNumber?: string;
  sortOrder?: number | null;        // v8+ — crossing-order index in the finish sheet
  finishPosition?: number | null;   // pre-v8 — mapped to sortOrder on import
  finishTime?: string;
  resultCode: ResultCode | null;
  startPresent: boolean | null;
  penaltyCode?: PenaltyCode | null;
  penaltyOverride?: number | null;
  redressMethod?: 'all_races' | 'races_before' | 'stated';
  redressExcludeRaces?: number[];
  redressIncludeRaces?: number[];
  redressIncludeAllLater?: boolean;
  redressPoints?: number;
}

interface SeriesFileRaceStart {
  id: string;
  fleetIds: string[];
  startTime: string;
}

interface SeriesFileRace {
  id: string;
  raceNumber: number;
  date: string;
  starts?: SeriesFileRaceStart[];
  finishes: SeriesFileFinish[];
}

// v11+: persisted NHC per-race per-competitor TCF snapshots
interface SeriesFileNhcTcfRecord {
  raceId: string;
  competitorId: string;
  fleetId: string;
  tcfApplied: number;
  newTcf: number;
}

export interface SeriesFile {
  formatVersion: number;
  seriesId: string;
  snapshotId: string;
  snapshotHistory: string[];
  exportedAt: string;
  series: SeriesFileSeries;
  fleets: SeriesFileFleet[];
  competitors: SeriesFileCompetitor[];
  races: SeriesFileRace[];
  nhcTcfHistory?: SeriesFileNhcTcfRecord[];  // v11+; absent in older files
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

  // Refresh NHC TCF history before reading from DB so the file carries the
  // current scoring engine's view, not whatever was last persisted.
  await recomputeNhcHistoryForSeries(seriesId);

  const competitors = await db.competitors
    .where('seriesId')
    .equals(seriesId)
    .sortBy('sailNumber');
  const fleets = await db.fleets
    .where('seriesId')
    .equals(seriesId)
    .sortBy('displayOrder');
  const races = await db.races
    .where('seriesId')
    .equals(seriesId)
    .sortBy('raceNumber');
  const raceIds = races.map((r) => r.id);
  const allFinishes =
    raceIds.length > 0
      ? await db.finishes.where('raceId').anyOf(raceIds).toArray()
      : [];
  const allRaceStarts: RaceStart[] =
    raceIds.length > 0
      ? await db.raceStarts.where('raceId').anyOf(raceIds).toArray()
      : [];
  const allNhcTcfHistory: NhcTcfRecord[] =
    raceIds.length > 0
      ? await db.nhcTcfHistory.where('raceId').anyOf(raceIds).toArray()
      : [];

  const finishesByRace = new Map<string, SeriesFileFinish[]>();
  for (const f of allFinishes) {
    if (!finishesByRace.has(f.raceId)) finishesByRace.set(f.raceId, []);
    finishesByRace.get(f.raceId)!.push({
      id: f.id,
      competitorId: f.competitorId,
      unknownSailNumber: f.unknownSailNumber,
      sortOrder: f.sortOrder,
      ...(f.finishTime ? { finishTime: f.finishTime } : {}),
      resultCode: f.resultCode,
      startPresent: f.startPresent,
      penaltyCode: f.penaltyCode ?? null,
      penaltyOverride: f.penaltyOverride ?? null,
      ...(f.redressMethod ? { redressMethod: f.redressMethod } : {}),
      ...(f.redressExcludeRaces?.length ? { redressExcludeRaces: f.redressExcludeRaces } : {}),
      ...(f.redressIncludeRaces?.length ? { redressIncludeRaces: f.redressIncludeRaces } : {}),
      ...(f.redressIncludeAllLater ? { redressIncludeAllLater: f.redressIncludeAllLater } : {}),
      ...(f.redressPoints != null ? { redressPoints: f.redressPoints } : {}),
    });
  }

  const startsByRace = new Map<string, SeriesFileRaceStart[]>();
  for (const s of allRaceStarts) {
    if (!startsByRace.has(s.raceId)) startsByRace.set(s.raceId, []);
    startsByRace.get(s.raceId)!.push({ id: s.id, fleetIds: s.fleetIds, startTime: s.startTime });
  }

  const snapshotId = crypto.randomUUID();
  const snapshotHistory = [...series.snapshotHistory, snapshotId];

  const file: SeriesFile = {
    formatVersion: FORMAT_VERSION,
    seriesId: series.id,
    snapshotId,
    snapshotHistory,
    exportedAt: new Date().toISOString(),
    fleets: fleets.map((f) => ({
      id: f.id,
      name: f.name,
      displayOrder: f.displayOrder,
      scoringSystem: f.scoringSystem,
      ...(f.nhcAlpha != null ? { nhcAlpha: f.nhcAlpha } : {}),
    })),
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
      enabledCompetitorFields: series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
      scoringMode: series.scoringMode ?? 'scratch',
      ...(series.defaultStartSequence?.length ? { defaultStartSequence: series.defaultStartSequence } : {}),
      ...(series.publishRatingCalculations != null ? { publishRatingCalculations: series.publishRatingCalculations } : {}),
    },
    competitors: competitors.map((c) => ({
      id: c.id,
      fleetIds: c.fleetIds,
      sailNumber: c.sailNumber,
      ...(c.boatName ? { boatName: c.boatName } : {}),
      ...(c.boatClass ? { boatClass: c.boatClass } : {}),
      name: c.name,
      ...(c.crewName ? { crewName: c.crewName } : {}),
      club: c.club,
      gender: c.gender,
      age: c.age,
      ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
      ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
      ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
    })),
    races: races.map((r) => ({
      id: r.id,
      raceNumber: r.raceNumber,
      date: r.date,
      ...(startsByRace.has(r.id) ? { starts: startsByRace.get(r.id) } : {}),
      finishes: finishesByRace.get(r.id) ?? [],
    })),
    ...(allNhcTcfHistory.length > 0
      ? {
          nhcTcfHistory: allNhcTcfHistory.map((h) => ({
            raceId: h.raceId,
            competitorId: h.competitorId,
            fleetId: h.fleetId,
            tcfApplied: h.tcfApplied,
            newTcf: h.newTcf,
          })),
        }
      : {}),
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
    throw new Error(`Unsupported file format version: ${obj.formatVersion ?? 'unknown'}`);
  // Normalise: v1–3 files have no fleets array
  if (!Array.isArray(obj.fleets)) obj.fleets = [];
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
  const fileFleets = file.fleets ?? [];
  const fleetIdMap = new Map(fileFleets.map((f) => [f.id, crypto.randomUUID()]));
  const competitorIdMap = new Map(file.competitors.map((c) => [c.id, crypto.randomUUID()]));
  const raceIdMap = new Map(file.races.map((r) => [r.id, crypto.randomUUID()]));

  // For v1–3 files with no fleets, synthesize a Default fleet
  let defaultFleetId: string | undefined;
  if (fileFleets.length === 0) {
    defaultFleetId = crypto.randomUUID();
  }

  await db.transaction('rw', [db.series, db.fleets, db.competitors, db.races, db.finishes, db.raceStarts, db.nhcTcfHistory], async () => {
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
      scoringMode: file.series.scoringMode ?? 'scratch',
      defaultStartSequence: file.series.defaultStartSequence,
      discardThresholds: file.series.discardThresholds ?? [],
      dnfScoring: file.series.dnfScoring ?? 'seriesEntries',
      ftpHost: file.series.ftpHost ?? '',
      ftpPath: file.series.ftpPath ?? '',
      bilgeBundle: file.series.bilgeBundle ?? null,
      includeJsonExport: file.series.includeJsonExport ?? true,
      publishRatingCalculations: file.series.publishRatingCalculations ?? true,
      enabledCompetitorFields: file.series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
    });

    if (defaultFleetId) {
      await db.fleets.add({ id: defaultFleetId, seriesId: newSeriesId, name: 'Default', displayOrder: 0, scoringSystem: 'scratch' });
    } else {
      for (const f of fileFleets) {
        await db.fleets.add({
          id: fleetIdMap.get(f.id)!,
          seriesId: newSeriesId,
          name: f.name,
          displayOrder: f.displayOrder,
          scoringSystem: f.scoringSystem ?? 'scratch',
          ...(f.nhcAlpha != null ? { nhcAlpha: f.nhcAlpha } : {}),
        });
      }
    }

    for (const c of file.competitors) {
      const fleetIds = resolveCompetitorFleetIds(c, fleetIdMap, defaultFleetId);
      await db.competitors.add({
        id: competitorIdMap.get(c.id)!,
        seriesId: newSeriesId,
        fleetIds,
        sailNumber: c.sailNumber,
        ...(c.boatName ? { boatName: c.boatName } : {}),
        ...(c.boatClass ? { boatClass: c.boatClass } : {}),
        name: c.name,
        ...(c.crewName ? { crewName: c.crewName } : {}),
        club: c.club,
        gender: c.gender,
        age: c.age,
        createdAt: now,
        ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
        ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
        ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
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
      for (const s of r.starts ?? []) {
        await db.raceStarts.add({
          id: crypto.randomUUID(),
          raceId: newRaceId,
          fleetIds: s.fleetIds.map((id) => fleetIdMap.get(id) ?? id),
          startTime: s.startTime,
        });
      }
      for (const f of r.finishes) {
        const mappedCompetitorId = f.competitorId
          ? (competitorIdMap.get(f.competitorId) ?? null)
          : null;
        await db.finishes.add({
          id: crypto.randomUUID(),
          raceId: newRaceId,
          competitorId: mappedCompetitorId,
          unknownSailNumber: f.unknownSailNumber,
          sortOrder: f.sortOrder ?? f.finishPosition ?? null,
          ...(f.finishTime ? { finishTime: f.finishTime } : {}),
          resultCode: f.resultCode,
          startPresent: f.startPresent ?? null,
          penaltyCode: f.penaltyCode ?? null,
          penaltyOverride: f.penaltyOverride ?? null,
          redressMethod: f.redressMethod ?? null,
          redressExcludeRaces: f.redressExcludeRaces ?? null,
          redressIncludeRaces: f.redressIncludeRaces ?? null,
          redressIncludeAllLater: f.redressIncludeAllLater ?? false,
          redressPoints: f.redressPoints ?? null,
        });
      }
    }

    for (const h of file.nhcTcfHistory ?? []) {
      const raceId = raceIdMap.get(h.raceId);
      const competitorId = competitorIdMap.get(h.competitorId);
      const fleetId = fleetIdMap.get(h.fleetId) ?? defaultFleetId;
      if (!raceId || !competitorId || !fleetId) continue;
      await db.nhcTcfHistory.add({
        id: crypto.randomUUID(),
        raceId,
        competitorId,
        fleetId,
        tcfApplied: h.tcfApplied,
        newTcf: h.newTcf,
      });
    }
  });

  return newSeriesId;
}

// ---- Update existing series from file ----

export async function updateSeriesFromFile(seriesId: string, file: SeriesFile): Promise<void> {
  const now = Date.now();

  const fileFleets = file.fleets ?? [];
  const fleetIdMap = new Map(fileFleets.map((f) => [f.id, crypto.randomUUID()]));
  const competitorIdMap = new Map(file.competitors.map((c) => [c.id, crypto.randomUUID()]));
  const raceIdMap = new Map(file.races.map((r) => [r.id, crypto.randomUUID()]));

  let defaultFleetId: string | undefined;
  if (fileFleets.length === 0) {
    defaultFleetId = crypto.randomUUID();
  }

  await db.transaction('rw', [db.series, db.fleets, db.competitors, db.races, db.finishes, db.raceStarts, db.nhcTcfHistory], async () => {
    const existingRaces = await db.races.where('seriesId').equals(seriesId).toArray();
    if (existingRaces.length > 0) {
      const existingRaceIds = existingRaces.map((r) => r.id);
      await db.finishes.where('raceId').anyOf(existingRaceIds).delete();
      await db.raceStarts.where('raceId').anyOf(existingRaceIds).delete();
      await db.nhcTcfHistory.where('raceId').anyOf(existingRaceIds).delete();
    }
    await db.races.where('seriesId').equals(seriesId).delete();
    await db.competitors.where('seriesId').equals(seriesId).delete();
    await db.fleets.where('seriesId').equals(seriesId).delete();

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
      scoringMode: file.series.scoringMode ?? 'scratch',
      defaultStartSequence: file.series.defaultStartSequence,
      discardThresholds: file.series.discardThresholds ?? [],
      dnfScoring: file.series.dnfScoring ?? 'seriesEntries',
      ftpHost: file.series.ftpHost ?? '',
      ftpPath: file.series.ftpPath ?? '',
      bilgeBundle: file.series.bilgeBundle ?? null,
      includeJsonExport: file.series.includeJsonExport ?? true,
      publishRatingCalculations: file.series.publishRatingCalculations ?? true,
      enabledCompetitorFields: file.series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
    });

    if (defaultFleetId) {
      await db.fleets.add({ id: defaultFleetId, seriesId, name: 'Default', displayOrder: 0, scoringSystem: 'scratch' });
    } else {
      for (const f of fileFleets) {
        await db.fleets.add({
          id: fleetIdMap.get(f.id)!,
          seriesId,
          name: f.name,
          displayOrder: f.displayOrder,
          scoringSystem: f.scoringSystem ?? 'scratch',
          ...(f.nhcAlpha != null ? { nhcAlpha: f.nhcAlpha } : {}),
        });
      }
    }

    for (const c of file.competitors) {
      const fleetIds = resolveCompetitorFleetIds(c, fleetIdMap, defaultFleetId);
      await db.competitors.add({
        id: competitorIdMap.get(c.id)!,
        seriesId,
        fleetIds,
        sailNumber: c.sailNumber,
        ...(c.boatName ? { boatName: c.boatName } : {}),
        ...(c.boatClass ? { boatClass: c.boatClass } : {}),
        name: c.name,
        ...(c.crewName ? { crewName: c.crewName } : {}),
        club: c.club,
        gender: c.gender,
        age: c.age,
        createdAt: now,
        ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
        ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
        ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
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
      for (const s of r.starts ?? []) {
        await db.raceStarts.add({
          id: crypto.randomUUID(),
          raceId: newRaceId,
          fleetIds: s.fleetIds.map((id) => fleetIdMap.get(id) ?? id),
          startTime: s.startTime,
        });
      }
      for (const f of r.finishes) {
        const mappedCompetitorId = f.competitorId
          ? (competitorIdMap.get(f.competitorId) ?? null)
          : null;
        await db.finishes.add({
          id: crypto.randomUUID(),
          raceId: newRaceId,
          competitorId: mappedCompetitorId,
          unknownSailNumber: f.unknownSailNumber,
          sortOrder: f.sortOrder ?? f.finishPosition ?? null,
          ...(f.finishTime ? { finishTime: f.finishTime } : {}),
          resultCode: f.resultCode,
          startPresent: f.startPresent ?? null,
          penaltyCode: f.penaltyCode ?? null,
          penaltyOverride: f.penaltyOverride ?? null,
          redressMethod: f.redressMethod ?? null,
          redressExcludeRaces: f.redressExcludeRaces ?? null,
          redressIncludeRaces: f.redressIncludeRaces ?? null,
          redressIncludeAllLater: f.redressIncludeAllLater ?? false,
          redressPoints: f.redressPoints ?? null,
        });
      }
    }

    for (const h of file.nhcTcfHistory ?? []) {
      const raceId = raceIdMap.get(h.raceId);
      const competitorId = competitorIdMap.get(h.competitorId);
      const fleetId = fleetIdMap.get(h.fleetId) ?? defaultFleetId;
      if (!raceId || !competitorId || !fleetId) continue;
      await db.nhcTcfHistory.add({
        id: crypto.randomUUID(),
        raceId,
        competitorId,
        fleetId,
        tcfApplied: h.tcfApplied,
        newTcf: h.newTcf,
      });
    }
  });
}

/**
 * Resolve fleet IDs for a competitor from the file format.
 * Handles both the new fleetIds (v7+) and legacy fleetId (pre-v7) formats.
 */
function resolveCompetitorFleetIds(
  c: SeriesFileCompetitor,
  fleetIdMap: Map<string, string>,
  defaultFleetId: string | undefined,
): string[] {
  if (Array.isArray(c.fleetIds) && c.fleetIds.length > 0) {
    return c.fleetIds.map((id) => fleetIdMap.get(id) ?? defaultFleetId!).filter(Boolean);
  }
  const fleetId = defaultFleetId ?? fleetIdMap.get(c.fleetId ?? '') ?? defaultFleetId!;
  return [fleetId];
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'series'
  );
}
