import type {
  Series,
  ResultCode,
  PenaltyCode,
  DiscardThreshold,
  Finish,
  CompetitorFieldKey,
  PrimaryPersonLabel,
  StartGroup,
  NhcTcfRecord,
} from './types';
import { defaultEnabledCompetitorFields, DEFAULT_PRIMARY_PERSON_LABEL } from './competitor-fields';
import { calculateFleetStandings } from './scoring';
import { disambiguateSeriesName } from './series-name';
import type {
  CompetitorRepository,
  FinishRepository,
  FleetRepository,
  RaceRepository,
  RaceStartRepository,
  SeriesRepository,
} from './repository';

/**
 * Repository surface needed to save / open / update a series file. Both
 * `lib/api-repository.ts` and `lib/dexie-repository.ts` export this exact
 * shape, so callers pass the runtime-selected backend via `useRepos()`.
 */
export interface SeriesFileRepos {
  seriesRepo: SeriesRepository;
  competitorRepo: CompetitorRepository;
  fleetRepo: FleetRepository;
  raceRepo: RaceRepository;
  raceStartRepo: RaceStartRepository;
  finishRepo: FinishRepository;
  listSeriesNames(opts?: { excludeId?: string }): Promise<string[]>;
  deleteSeriesChildren(seriesId: string): Promise<void>;
}

/** File format version. v2 adds `Competitor.owner` and `Series.primaryPersonLabel`.
 *  v1 files load cleanly — the parser defaults the new primary label to
 *  "competitor" (the pre-v2 behaviour was effectively helm-labelled but
 *  tolerating a generic label loses nothing).
 *
 *  v3 changes `Series.defaultStartSequence[*]` from `offsetMinutes` (cumulative
 *  minutes from the first start) to `intervalMinutes` (gap to the previous
 *  start). The parser converts v1/v2 sequences on read so callers always see
 *  the v3 shape — see #95 for why the data model changed. */
export const FORMAT_VERSION = 3;
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = [1, 2, 3];
export const FILE_EXTENSION = '.sailscoring';

// ---- File format types ----

interface SeriesFileFleet {
  id: string;
  name: string;
  displayOrder: number;
  scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo';
  nhcAlpha?: number;  // present iff scoringSystem === 'nhc'
  echoAlpha?: number; // present iff scoringSystem === 'echo'
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
  enabledCompetitorFields: CompetitorFieldKey[];
  primaryPersonLabel?: PrimaryPersonLabel;  // v2+; absent in v1 files, defaults to 'competitor'
  scoringMode: 'scratch' | 'handicap';
  defaultStartSequence?: StartGroup[];
  publishRatingCalculations?: boolean;
}

interface SeriesFileCompetitor {
  id: string;
  fleetIds: string[];
  sailNumber: string;
  boatName?: string;
  boatClass?: string;
  name: string;
  owner?: string;  // v2+
  helm?: string;   // v2+
  crewName?: string;
  club: string;
  gender: 'M' | 'F' | '';
  age: number | null;
  ircTcc?: number;
  pyNumber?: number;
  nhcStartingTcf?: number;
  echoStartingTcf?: number;
}

interface SeriesFileFinish {
  id: string;
  competitorId: string | null;
  unknownSailNumber?: string;
  sortOrder: number | null;
  finishTime?: string;
  resultCode: ResultCode | null;
  startPresent: boolean | null;
  penaltyCode: PenaltyCode | null;
  penaltyOverride: number | null;
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
  starts: SeriesFileRaceStart[];
  finishes: SeriesFileFinish[];
}

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
  nhcTcfHistory?: SeriesFileNhcTcfRecord[];
}

export type LineageStatus = 'clean' | 'identical' | 'diverged';

export function checkLineage(localSeries: Series, file: SeriesFile): LineageStatus {
  if (!localSeries.lastSnapshotId) return 'diverged';
  if (file.snapshotId === localSeries.lastSnapshotId) return 'identical';
  if (file.snapshotHistory.includes(localSeries.lastSnapshotId)) return 'clean';
  return 'diverged';
}

// ---- Build and save ----

/** Build the in-memory SeriesFile for a series without side effects.
 *  Used by `saveSeriesFile` (which then downloads + bumps the snapshot)
 *  and by the Phase 5 migration flow (which builds from Dexie repos and
 *  then writes via API repos through `openSeriesFromFile`). */
export async function buildSeriesFile(
  seriesId: string,
  repos: SeriesFileRepos,
): Promise<SeriesFile> {
  const series = await repos.seriesRepo.get(seriesId);
  if (!series) throw new Error(`Series ${seriesId} not found`);

  const [competitorsUnsorted, fleetsUnsorted, racesUnsorted] = await Promise.all([
    repos.competitorRepo.listBySeries(seriesId),
    repos.fleetRepo.listBySeries(seriesId),
    repos.raceRepo.listBySeries(seriesId),
  ]);
  // Both repository implementations sort by these keys already; sort
  // defensively so the file is deterministic regardless of backend.
  const competitors = [...competitorsUnsorted].sort((a, b) =>
    a.sailNumber.localeCompare(b.sailNumber),
  );
  const fleets = [...fleetsUnsorted].sort((a, b) => a.displayOrder - b.displayOrder);
  const races = [...racesUnsorted].sort((a, b) => a.raceNumber - b.raceNumber);

  const raceIds = races.map((r) => r.id);
  const competitorIds = competitors.map((c) => c.id);

  const [allFinishes, allRaceStarts] = await Promise.all([
    repos.finishRepo.listBySeries(seriesId, competitorIds),
    repos.raceStartRepo.listByRaces(raceIds),
  ]);

  // Compute progressive-handicap (NHC/ECHO) TCF history from the engine
  // rather than reading it from a persisted table. The history is purely
  // derived state; computing on demand removes the only consumer of the
  // nhcTcfHistory table.
  const { fleetStandings } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    series.discardThresholds ?? [],
    series.dnfScoring ?? 'seriesEntries',
    allRaceStarts,
  );
  const allNhcTcfHistory: NhcTcfRecord[] = fleetStandings.flatMap(
    (fr) => fr.nhcTcfHistory ?? [],
  );

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
      ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
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
      primaryPersonLabel: series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
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
      ...(c.owner ? { owner: c.owner } : {}),
      ...(c.helm ? { helm: c.helm } : {}),
      ...(c.crewName ? { crewName: c.crewName } : {}),
      club: c.club,
      gender: c.gender,
      age: c.age,
      ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
      ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
      ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
      ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
    })),
    races: races.map((r) => ({
      id: r.id,
      raceNumber: r.raceNumber,
      date: r.date,
      starts: startsByRace.get(r.id) ?? [],
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

  return file;
}

export async function saveSeriesFile(
  seriesId: string,
  repos: SeriesFileRepos,
): Promise<void> {
  const file = await buildSeriesFile(seriesId, repos);
  const series = await repos.seriesRepo.get(seriesId);
  if (!series) throw new Error(`Series ${seriesId} not found`);

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

  // Record the save. CAS via `expectedVersion` so a concurrent edit in
  // another tab surfaces as 409 → refresh-and-retry rather than silently
  // overwriting the other tab's snapshot lineage.
  const now = Date.now();
  await repos.seriesRepo.save(
    {
      ...series,
      lastSnapshotId: file.snapshotId,
      lastSavedAt: now,
      snapshotHistory: file.snapshotHistory,
    },
    { expectedVersion: series.version },
  );
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
  if (typeof obj.formatVersion !== 'number' || !SUPPORTED_FORMAT_VERSIONS.includes(obj.formatVersion))
    throw new Error(`Unsupported file format version: ${obj.formatVersion ?? 'unknown'}`);
  if (typeof obj.seriesId !== 'string') throw new Error('Invalid file: missing seriesId');
  if (typeof obj.snapshotId !== 'string') throw new Error('Invalid file: missing snapshotId');
  if (!Array.isArray(obj.snapshotHistory)) throw new Error('Invalid file: missing snapshotHistory');
  if (typeof obj.exportedAt !== 'string') throw new Error('Invalid file: missing exportedAt');
  if (typeof obj.series !== 'object' || obj.series === null)
    throw new Error('Invalid file: missing series');
  if (!Array.isArray(obj.fleets)) throw new Error('Invalid file: missing fleets');
  if (!Array.isArray(obj.competitors)) throw new Error('Invalid file: missing competitors');
  if (!Array.isArray(obj.races)) throw new Error('Invalid file: missing races');

  if (obj.formatVersion < 3) migrateStartSequenceCumulativeToIntervals(obj.series);

  return data as SeriesFile;
}

/** v1/v2 → v3: `defaultStartSequence[i].offsetMinutes` (cumulative from first
 *  start) becomes `intervalMinutes` (gap to previous start). Mutates in place. */
function migrateStartSequenceCumulativeToIntervals(series: unknown): void {
  if (typeof series !== 'object' || series === null) return;
  const s = series as { defaultStartSequence?: unknown };
  if (!Array.isArray(s.defaultStartSequence) || s.defaultStartSequence.length === 0) return;
  const legacy = s.defaultStartSequence as { fleetIds: string[]; offsetMinutes: number }[];
  const intervals: StartGroup[] = legacy.map((g, i) => ({
    fleetIds: g.fleetIds,
    intervalMinutes: i === 0 ? 0 : Math.max(0, g.offsetMinutes - legacy[i - 1].offsetMinutes),
  }));
  s.defaultStartSequence = intervals;
}

// ---- Open as new series ----

export async function openSeriesFromFile(
  file: SeriesFile,
  repos: SeriesFileRepos,
): Promise<string> {
  const newSeriesId = crypto.randomUUID();
  const now = Date.now();
  const name = disambiguateSeriesName(file.series.name, await repos.listSeriesNames());

  // Remap IDs to avoid conflicts with existing DB records.
  const fleetIdMap = new Map(file.fleets.map((f) => [f.id, crypto.randomUUID()]));
  const competitorIdMap = new Map(file.competitors.map((c) => [c.id, crypto.randomUUID()]));
  const raceIdMap = new Map(file.races.map((r) => [r.id, crypto.randomUUID()]));

  // Series first (FK target for everything below). No expectedVersion —
  // fresh row, authoritative write per `SaveOpts` doc-comment.
  await repos.seriesRepo.save({
    id: newSeriesId,
    name,
    venue: file.series.venue,
    startDate: file.series.startDate,
    endDate: file.series.endDate,
    venueLogoUrl: file.series.venueLogoUrl,
    eventLogoUrl: file.series.eventLogoUrl,
    createdAt: now,
    lastSnapshotId: file.snapshotId,
    lastSavedAt: null,
    lastModifiedAt: now,
    snapshotHistory: [...file.snapshotHistory],
    scoringMode: file.series.scoringMode,
    defaultStartSequence: file.series.defaultStartSequence,
    discardThresholds: file.series.discardThresholds,
    dnfScoring: file.series.dnfScoring,
    ftpHost: file.series.ftpHost,
    ftpPath: file.series.ftpPath,
    bilgeBundle: file.series.bilgeBundle,
    includeJsonExport: file.series.includeJsonExport,
    publishRatingCalculations: file.series.publishRatingCalculations ?? true,
    enabledCompetitorFields: file.series.enabledCompetitorFields,
    primaryPersonLabel: file.series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
  });

  await writeFleetsCompetitorsRaces(repos, file, newSeriesId, now, fleetIdMap, competitorIdMap, raceIdMap);

  return newSeriesId;
}

// ---- Update existing series from file ----

export async function updateSeriesFromFile(
  seriesId: string,
  file: SeriesFile,
  repos: SeriesFileRepos,
): Promise<void> {
  const now = Date.now();

  const current = await repos.seriesRepo.get(seriesId);
  if (!current) throw new Error(`Series ${seriesId} not found`);

  const fleetIdMap = new Map(file.fleets.map((f) => [f.id, crypto.randomUUID()]));
  const competitorIdMap = new Map(file.competitors.map((c) => [c.id, crypto.randomUUID()]));
  const raceIdMap = new Map(file.races.map((r) => [r.id, crypto.randomUUID()]));

  // Children first; the series row stays so its createdAt and any
  // workspace-side bookkeeping survive the replay.
  await repos.deleteSeriesChildren(seriesId);

  // Authoritative file-replay write — no `expectedVersion`. The user has
  // already confirmed the lineage dialog ("Update" or "Replace local copy").
  await repos.seriesRepo.save({
    ...current,
    name: file.series.name,
    venue: file.series.venue,
    startDate: file.series.startDate,
    endDate: file.series.endDate,
    venueLogoUrl: file.series.venueLogoUrl,
    eventLogoUrl: file.series.eventLogoUrl,
    lastSnapshotId: file.snapshotId,
    lastModifiedAt: now,
    snapshotHistory: [...file.snapshotHistory],
    scoringMode: file.series.scoringMode,
    defaultStartSequence: file.series.defaultStartSequence,
    discardThresholds: file.series.discardThresholds,
    dnfScoring: file.series.dnfScoring,
    ftpHost: file.series.ftpHost,
    ftpPath: file.series.ftpPath,
    bilgeBundle: file.series.bilgeBundle,
    includeJsonExport: file.series.includeJsonExport,
    publishRatingCalculations: file.series.publishRatingCalculations ?? true,
    enabledCompetitorFields: file.series.enabledCompetitorFields,
    primaryPersonLabel: file.series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
  });

  await writeFleetsCompetitorsRaces(repos, file, seriesId, now, fleetIdMap, competitorIdMap, raceIdMap);
}

// ---- Internal: shared body for open and update ----

async function writeFleetsCompetitorsRaces(
  repos: SeriesFileRepos,
  file: SeriesFile,
  seriesId: string,
  now: number,
  fleetIdMap: Map<string, string>,
  competitorIdMap: Map<string, string>,
  raceIdMap: Map<string, string>,
): Promise<void> {
  await repos.fleetRepo.saveMany(
    file.fleets.map((f) => ({
      id: fleetIdMap.get(f.id)!,
      seriesId,
      name: f.name,
      displayOrder: f.displayOrder,
      scoringSystem: f.scoringSystem,
      ...(f.nhcAlpha != null ? { nhcAlpha: f.nhcAlpha } : {}),
      ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
    })),
  );

  await repos.competitorRepo.saveMany(
    file.competitors.map((c) => {
      const fleetIds = c.fleetIds.map((id) => fleetIdMap.get(id)!).filter(Boolean);
      return {
        id: competitorIdMap.get(c.id)!,
        seriesId,
        fleetIds,
        sailNumber: c.sailNumber,
        ...(c.boatName ? { boatName: c.boatName } : {}),
        ...(c.boatClass ? { boatClass: c.boatClass } : {}),
        name: c.name,
        ...(c.owner ? { owner: c.owner } : {}),
        ...(c.helm ? { helm: c.helm } : {}),
        ...(c.crewName ? { crewName: c.crewName } : {}),
        club: c.club,
        gender: c.gender,
        age: c.age,
        createdAt: now,
        ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
        ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
        ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
        ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
      };
    }),
  );

  // Races sequentially because their starts and finishes FK back to the
  // race row that has to exist first. Inside each race we batch.
  for (const r of file.races) {
    const newRaceId = raceIdMap.get(r.id)!;
    await repos.raceRepo.save({
      id: newRaceId,
      seriesId,
      raceNumber: r.raceNumber,
      date: r.date,
      createdAt: now,
    });

    await Promise.all(
      r.starts.map((s) =>
        repos.raceStartRepo.save({
          id: crypto.randomUUID(),
          raceId: newRaceId,
          fleetIds: s.fleetIds.map((id) => fleetIdMap.get(id) ?? id),
          startTime: s.startTime,
        }),
      ),
    );

    if (r.finishes.length > 0) {
      const finishes: Finish[] = r.finishes.map((f) => {
        const mappedCompetitorId = f.competitorId
          ? (competitorIdMap.get(f.competitorId) ?? null)
          : null;
        return {
          id: crypto.randomUUID(),
          raceId: newRaceId,
          competitorId: mappedCompetitorId,
          unknownSailNumber: f.unknownSailNumber,
          sortOrder: f.sortOrder,
          ...(f.finishTime ? { finishTime: f.finishTime } : {}),
          resultCode: f.resultCode,
          startPresent: f.startPresent,
          penaltyCode: f.penaltyCode,
          penaltyOverride: f.penaltyOverride,
          redressMethod: f.redressMethod ?? null,
          redressExcludeRaces: f.redressExcludeRaces ?? null,
          redressIncludeRaces: f.redressIncludeRaces ?? null,
          redressIncludeAllLater: f.redressIncludeAllLater ?? false,
          redressPoints: f.redressPoints ?? null,
        };
      });
      await repos.finishRepo.saveMany(finishes);
    }
  }

  // NHC tcf history is no longer persisted — the only consumer was the
  // file-export path, which now recomputes via calculateFleetStandings.
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'series'
  );
}
