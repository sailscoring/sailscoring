import type {
  Series,
  Fleet,
  ResultCode,
  PenaltyCode,
  DiscardThreshold,
  DnfScoring,
  Finish,
  CompetitorFieldKey,
  PrimaryPersonLabel,
  StartGroup,
  NhcProfile,
  TcfRecord,
} from './types';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
} from './competitor-fields';
import { calculateFleetStandings } from './scoring';
import { loadSeriesSnapshot } from './series-snapshot';
import { disambiguateSeriesName } from './series-name';
import type {
  CompetitorRepository,
  FinishRepository,
  FleetRepository,
  RaceRepository,
  RaceStartRepository,
  RaceRatingOverrideRepository,
  SeriesRepository,
} from './repository';

/**
 * Repository surface needed to save / open / update a series file.
 * `lib/api-repository.ts` exports this exact shape.
 */
export interface SeriesFileRepos {
  seriesRepo: SeriesRepository;
  competitorRepo: CompetitorRepository;
  fleetRepo: FleetRepository;
  raceRepo: RaceRepository;
  raceStartRepo: RaceStartRepository;
  raceRatingOverrideRepo: RaceRatingOverrideRepository;
  finishRepo: FinishRepository;
  listSeriesNames(opts?: { excludeId?: string }): Promise<string[]>;
  deleteSeriesChildren(seriesId: string): Promise<void>;
  /** Embedded revision history (#166). Optional: implementations that don't
   *  support it (seed, tests) simply omit them, and the file is saved without
   *  a history block / imported without restoring history. Compression lives
   *  server-side, so callers treat `revisionSnapshots` as an opaque blob. */
  exportRevisions?(seriesId: string): Promise<{
    revisions: SeriesFileRevision[];
    revisionSnapshots: string;
  }>;
  importRevisions?(
    seriesId: string,
    payload: { revisions: SeriesFileRevision[]; revisionSnapshots: string },
  ): Promise<void>;
  /** Record a "Saved to file" milestone revision (#166). */
  recordSaveMilestone?(seriesId: string): Promise<void>;
}

/** File format version. v2 adds `Competitor.owner` and `Series.primaryPersonLabel`.
 *  v1 files load cleanly — the parser defaults the new primary label to
 *  "competitor" (the pre-v2 behaviour was effectively helm-labelled but
 *  tolerating a generic label loses nothing).
 *
 *  v3 changes `Series.defaultStartSequence[*]` from `offsetMinutes` (cumulative
 *  minutes from the first start) to `intervalMinutes` (gap to the previous
 *  start). The parser converts v1/v2 sequences on read so callers always see
 *  the v3 shape — see #95 for why the data model changed.
 *
 *  v4 renames the progressive-handicap TCF history key from `nhcTcfHistory`
 *  to `tcfHistory` (the records cover both NHC and ECHO; the legacy name
 *  predated ECHO). The parser accepts either key.
 *
 *  v5 adds optional `Competitor.nationality` (3-letter national-letters code,
 *  RRS Appendix G / IOC). Additive; older files load with the field absent.
 *
 *  v6 adds optional `Competitor.subdivision` (Gold/Silver/Bronze or age
 *  categories) and `Series.subdivisionLabel` (its display label). Additive;
 *  older files load with the field absent and the label defaulting to
 *  "Division".
 *
 *  v7 adds the `vprs` fleet scoring system and the optional
 *  `Competitor.vprsTcc` rating (with `vprsTcc` as a per-race rating-override
 *  field). Additive; older files load with the field absent.
 *
 *  v8 drops the snapshot-lineage fields (`snapshotId`, `snapshotHistory`):
 *  file-exchange is no longer the collaboration mechanism, so a re-import is
 *  always an authoritative overwrite matched by `seriesId` alone. v1–v7 files
 *  still load — the parser ignores the now-unused keys. */
export const FORMAT_VERSION = 8;
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];
export const FILE_EXTENSION = '.sailscoring';

// ---- File format types ----

interface SeriesFileFleet {
  id: string;
  name: string;
  displayOrder: number;
  scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo' | 'vprs';
  echoAlpha?: number; // present iff scoringSystem === 'echo'
  // Inline NHC profile override (per-fleet). Present iff scoringSystem === 'nhc'
  // AND parameters differ from the SWNHC2015 defaults; absent means "use
  // DEFAULT_NHC_PROFILE". Additive optional field — older parsers ignore it.
  nhcProfile?: NhcProfile;
}

interface SeriesFileSeries {
  id: string;
  name: string;
  venue: string;
  startDate: string;
  endDate: string;
  venueLogoUrl: string;
  eventLogoUrl: string;
  venueUrl?: string;   // additive; absent in files written before logo/event links landed
  eventUrl?: string;
  discardThresholds: DiscardThreshold[];
  dnfScoring: DnfScoring;
  ftpHost: string;
  ftpPath: string;
  ftpPaths?: Record<string, string>;  // v4+; absent in older files
  // Bilge publishing state was removed in ADR-008 Phase 9. The field is no
  // longer written; older files that still carry it are simply ignored on read.
  includeJsonExport: boolean;
  enabledCompetitorFields: CompetitorFieldKey[];
  primaryPersonLabel?: PrimaryPersonLabel;  // v2+; absent in v1 files, defaults to 'competitor'
  subdivisionLabel?: string;  // v6+; absent in older files, defaults to 'Division'
  scoringMode: 'scratch' | 'handicap';
  defaultStartSequence?: StartGroup[];
  publishRatingCalculations?: boolean;
  showPerRaceRatingsInSummary?: boolean;
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
  nationality?: string;  // v5+
  gender: 'M' | 'F' | '';
  age: number | null;
  subdivision?: string;  // v6+
  ircTcc?: number;
  vprsTcc?: number;
  pyNumber?: number;
  nhcStartingTcf?: number;
  echoStartingTcf?: number;
}

interface SeriesFileFinish {
  id: string;
  competitorId: string | null;
  unknownSailNumber?: string;
  sortOrder: number | null;
  /** Optional in the file format — older files default to `false` on import. */
  tiedWithPrevious?: boolean;
  finishTime?: string;
  resultCode: ResultCode | null;
  startPresent: boolean | null;
  penaltyCode: PenaltyCode | null;
  penaltyOverride: number | null;
  redressMethod?: 'all_races' | 'all_races_excl_dnc' | 'races_before' | 'stated';
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

interface SeriesFileRatingOverride {
  id: string;
  competitorId: string;
  field: 'ircTcc' | 'pyNumber' | 'vprsTcc';
  value: number;
}

interface SeriesFileRace {
  id: string;
  raceNumber: number;
  date: string;
  starts: SeriesFileRaceStart[];
  finishes: SeriesFileFinish[];
  ratingOverrides?: SeriesFileRatingOverride[]; // additive; absent in older files
}

interface SeriesFileTcfRecord {
  raceId: string;
  competitorId: string;
  fleetId: string;
  tcfApplied: number;
  newTcf: number;
}

/** Readable metadata for one entry of the embedded revision history (#166).
 *  The point-in-time snapshots themselves live, compressed, in the file's
 *  `revisionSnapshots` blob (index-aligned to this array) so they don't bloat
 *  the file. The actor is display-only — user ids don't cross workspaces. */
export interface SeriesFileRevision {
  kind: 'auto' | 'named' | 'revert' | 'publish' | 'saved';
  label: string | null;
  summary: string | null;
  createdAt: string;
  actor: { displayName?: string; email?: string } | null;
}

export interface SeriesFile {
  formatVersion: number;
  seriesId: string;
  exportedAt: string;
  series: SeriesFileSeries;
  fleets: SeriesFileFleet[];
  competitors: SeriesFileCompetitor[];
  races: SeriesFileRace[];
  tcfHistory?: SeriesFileTcfRecord[];
  /** Pre-v4 alias for `tcfHistory`. Loader accepts either key; writer emits
   *  the new key only. Kept on the type so v1–v3 files parse without a cast. */
  nhcTcfHistory?: SeriesFileTcfRecord[];
  /** Embedded revision history (#166), included on save by default — readable
   *  metadata, newest concerns aside it's just an ordered list. */
  revisions?: SeriesFileRevision[];
  /** Base64 whole-array zstd of `[snapshot|null, …]`, index-aligned to
   *  `revisions` (null = a thinned revision). Opaque to the client; the server
   *  produces it on export and consumes it on import. */
  revisionSnapshots?: string;
}

// ---- Build and save ----

/** Build the in-memory SeriesFile for a series without side effects.
 *  Used by `saveSeriesFile` (which then downloads + records the save)
 *  and by the Phase 5 migration flow (which builds from Dexie repos and
 *  then writes via API repos through `openSeriesFromFile`). */
export async function buildSeriesFile(
  seriesId: string,
  repos: SeriesFileRepos,
): Promise<SeriesFile> {
  const snapshot = await loadSeriesSnapshot(repos, seriesId);
  if (!snapshot) throw new Error(`Series ${seriesId} not found`);
  const {
    series,
    competitors,
    fleets,
    races,
    finishes: allFinishes,
    raceStarts: allRaceStarts,
    ratingOverrides: allRatingOverrides,
  } = snapshot;

  // Compute progressive-handicap (NHC/ECHO) TCF history from the engine
  // rather than reading it from a persisted table. The history is purely
  // derived state; computing on demand removes the only consumer of the
  // tcfHistory table.
  const { fleetStandings } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    series.discardThresholds ?? [],
    series.dnfScoring ?? 'seriesEntries',
    allRaceStarts,
    allRatingOverrides,
  );
  const allTcfHistory: TcfRecord[] = fleetStandings.flatMap(
    (fr) => fr.tcfHistory ?? [],
  );

  const finishesByRace = new Map<string, SeriesFileFinish[]>();
  for (const f of allFinishes) {
    if (!finishesByRace.has(f.raceId)) finishesByRace.set(f.raceId, []);
    finishesByRace.get(f.raceId)!.push({
      id: f.id,
      competitorId: f.competitorId,
      unknownSailNumber: f.unknownSailNumber,
      sortOrder: f.sortOrder,
      ...(f.tiedWithPrevious ? { tiedWithPrevious: true } : {}),
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

  const overridesByRace = new Map<string, SeriesFileRatingOverride[]>();
  for (const o of allRatingOverrides) {
    if (!overridesByRace.has(o.raceId)) overridesByRace.set(o.raceId, []);
    overridesByRace.get(o.raceId)!.push({ id: o.id, competitorId: o.competitorId, field: o.field, value: o.value });
  }

  const file: SeriesFile = {
    formatVersion: FORMAT_VERSION,
    seriesId: series.id,
    exportedAt: new Date().toISOString(),
    fleets: fleets.map((f) => ({
      id: f.id,
      name: f.name,
      displayOrder: f.displayOrder,
      scoringSystem: f.scoringSystem,
      ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
      ...(f.nhcProfile != null ? { nhcProfile: f.nhcProfile } : {}),
    })),
    series: {
      id: series.id,
      name: series.name,
      venue: series.venue,
      startDate: series.startDate,
      endDate: series.endDate,
      venueLogoUrl: series.venueLogoUrl,
      eventLogoUrl: series.eventLogoUrl,
      venueUrl: series.venueUrl,
      eventUrl: series.eventUrl,
      discardThresholds: series.discardThresholds,
      dnfScoring: series.dnfScoring,
      ftpHost: series.ftpHost ?? '',
      ftpPath: series.ftpPath ?? '',
      ...(series.ftpPaths && Object.keys(series.ftpPaths).length > 0
        ? { ftpPaths: series.ftpPaths }
        : {}),
      includeJsonExport: series.includeJsonExport ?? true,
      enabledCompetitorFields: series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
      primaryPersonLabel: series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
      subdivisionLabel: series.subdivisionLabel ?? DEFAULT_SUBDIVISION_LABEL,
      scoringMode: series.scoringMode ?? 'scratch',
      ...(series.defaultStartSequence?.length ? { defaultStartSequence: series.defaultStartSequence } : {}),
      ...(series.publishRatingCalculations != null ? { publishRatingCalculations: series.publishRatingCalculations } : {}),
      ...(series.showPerRaceRatingsInSummary != null ? { showPerRaceRatingsInSummary: series.showPerRaceRatingsInSummary } : {}),
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
      ...(c.nationality ? { nationality: c.nationality } : {}),
      gender: c.gender,
      age: c.age,
      ...(c.subdivision ? { subdivision: c.subdivision } : {}),
      ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
      ...(c.vprsTcc != null ? { vprsTcc: c.vprsTcc } : {}),
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
      ...(overridesByRace.get(r.id)?.length ? { ratingOverrides: overridesByRace.get(r.id) } : {}),
    })),
    ...(allTcfHistory.length > 0
      ? {
          tcfHistory: allTcfHistory.map((h) => ({
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
  opts: { includeRevisions?: boolean } = {},
): Promise<void> {
  const file = await buildSeriesFile(seriesId, repos);
  const series = await repos.seriesRepo.get(seriesId);
  if (!series) throw new Error(`Series ${seriesId} not found`);

  // Embed the revision history by default (#166), so the file is a complete,
  // restorable backup: readable metadata + one compressed snapshot blob. The
  // scorer can opt out for a lean file, and implementations without revision
  // support omit it regardless.
  if (opts.includeRevisions !== false && repos.exportRevisions) {
    const { revisions, revisionSnapshots } = await repos.exportRevisions(seriesId);
    if (revisions.length > 0) {
      file.revisions = revisions;
      file.revisionSnapshots = revisionSnapshots;
    }
  }

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

  // The download above is a pure read. An archived series is read-only
  // (#154), so we stop here: recording the save would write file-tracking
  // fields back through the API and hit the read-only guard (423). Archived
  // series intentionally don't accrue file-lineage updates.
  if (series.archived) return;

  // Record the save. CAS via `expectedVersion` so a concurrent edit in
  // another tab surfaces as 409 → refresh-and-retry rather than silently
  // overwriting the other tab's `lastSavedAt`.
  const now = Date.now();
  await repos.seriesRepo.save(
    {
      ...series,
      lastSavedAt: now,
    },
    { expectedVersion: series.version },
  );

  // Pin a "Saved to file" milestone revision (#166), if the backend supports it.
  await repos.recordSaveMilestone?.(seriesId);
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
  if (typeof obj.exportedAt !== 'string') throw new Error('Invalid file: missing exportedAt');
  if (typeof obj.series !== 'object' || obj.series === null)
    throw new Error('Invalid file: missing series');
  if (!Array.isArray(obj.fleets)) throw new Error('Invalid file: missing fleets');
  if (!Array.isArray(obj.competitors)) throw new Error('Invalid file: missing competitors');
  if (!Array.isArray(obj.races)) throw new Error('Invalid file: missing races');

  if (obj.formatVersion < 3) migrateStartSequenceCumulativeToIntervals(obj.series);
  if (obj.formatVersion < 4 && obj.nhcTcfHistory !== undefined && obj.tcfHistory === undefined) {
    obj.tcfHistory = obj.nhcTcfHistory;
  }

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

/** Rewrite ftpPaths keys through a fleet-id remap. Entries pointing at fleets
 *  that aren't in the remap are dropped (the file referenced a fleet that no
 *  longer exists in the export). */
function remapFtpPaths(
  ftpPaths: Record<string, string> | undefined,
  fleetIdMap: Map<string, string>,
): Record<string, string> {
  if (!ftpPaths) return {};
  const out: Record<string, string> = {};
  for (const [oldId, path] of Object.entries(ftpPaths)) {
    const newId = fleetIdMap.get(oldId);
    if (newId) out[newId] = path;
  }
  return out;
}

/** Remap the fleet ids referenced by `defaultStartSequence` through a fleet-id
 *  remap. Like every other entity, fleets get fresh ids on import; the start
 *  sequence must follow them or it ends up pointing at fleets that don't exist
 *  in the imported series. Refs to fleets absent from the remap are dropped,
 *  and any group left with no fleets is removed. */
function remapStartSequence(
  startSequence: StartGroup[] | undefined,
  fleetIdMap: Map<string, string>,
): StartGroup[] | undefined {
  if (!startSequence) return undefined;
  return startSequence
    .map((g) => ({
      ...g,
      fleetIds: g.fleetIds.map((id) => fleetIdMap.get(id)).filter((id): id is string => !!id),
    }))
    .filter((g) => g.fleetIds.length > 0);
}

// ---- Open as new series ----

export async function openSeriesFromFile(
  file: SeriesFile,
  repos: SeriesFileRepos,
  opts?: { categoryId?: string | null; source?: Series['source'] },
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
  // `categoryId` isn't carried in the file format (it's workspace-local), so it
  // defaults to null unless the caller picks one in the import dialog (#154).
  // `archived` is likewise absent — a freshly opened file always lands active.
  await repos.seriesRepo.save({
    id: newSeriesId,
    name,
    venue: file.series.venue,
    startDate: file.series.startDate,
    endDate: file.series.endDate,
    venueLogoUrl: file.series.venueLogoUrl,
    eventLogoUrl: file.series.eventLogoUrl,
    venueUrl: file.series.venueUrl ?? '',
    eventUrl: file.series.eventUrl ?? '',
    createdAt: now,
    lastSavedAt: null,
    lastModifiedAt: now,
    scoringMode: file.series.scoringMode,
    defaultStartSequence: remapStartSequence(file.series.defaultStartSequence, fleetIdMap),
    discardThresholds: file.series.discardThresholds,
    dnfScoring: file.series.dnfScoring,
    ftpHost: file.series.ftpHost,
    ftpPath: file.series.ftpPath,
    ftpPaths: remapFtpPaths(file.series.ftpPaths, fleetIdMap),
    includeJsonExport: file.series.includeJsonExport,
    publishRatingCalculations: file.series.publishRatingCalculations ?? true,
    showPerRaceRatingsInSummary: file.series.showPerRaceRatingsInSummary ?? true,
    enabledCompetitorFields: file.series.enabledCompetitorFields,
    primaryPersonLabel: file.series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
    subdivisionLabel: file.series.subdivisionLabel ?? DEFAULT_SUBDIVISION_LABEL,
    categoryId: opts?.categoryId ?? null,
    // Provenance is caller-supplied, not carried in the file: the Sailwave
    // wizard passes 'sailwave'; a .sailscoring open leaves it unset.
    source: opts?.source,
  });

  await writeFleetsCompetitorsRaces(repos, file, newSeriesId, now, fleetIdMap, competitorIdMap, raceIdMap);

  // Restore embedded revision history (#166) into the fresh series, if the file
  // carries it and the backend supports it. Only on a brand-new open: an
  // in-place update keeps the series' existing server-side history.
  if (file.revisions?.length && file.revisionSnapshots && repos.importRevisions) {
    await repos.importRevisions(newSeriesId, {
      revisions: file.revisions,
      revisionSnapshots: file.revisionSnapshots,
    });
  }

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
  // already confirmed the overwrite ("Update" or "Open as a new copy").
  // Spreading `...current` preserves `categoryId`/`archived` (#154): the file
  // doesn't carry them, and an update must not silently re-file or un-archive
  // the existing series.
  await repos.seriesRepo.save({
    ...current,
    name: file.series.name,
    venue: file.series.venue,
    startDate: file.series.startDate,
    endDate: file.series.endDate,
    venueLogoUrl: file.series.venueLogoUrl,
    eventLogoUrl: file.series.eventLogoUrl,
    venueUrl: file.series.venueUrl ?? '',
    eventUrl: file.series.eventUrl ?? '',
    lastModifiedAt: now,
    scoringMode: file.series.scoringMode,
    defaultStartSequence: remapStartSequence(file.series.defaultStartSequence, fleetIdMap),
    discardThresholds: file.series.discardThresholds,
    dnfScoring: file.series.dnfScoring,
    ftpHost: file.series.ftpHost,
    ftpPath: file.series.ftpPath,
    ftpPaths: remapFtpPaths(file.series.ftpPaths, fleetIdMap),
    includeJsonExport: file.series.includeJsonExport,
    publishRatingCalculations: file.series.publishRatingCalculations ?? true,
    showPerRaceRatingsInSummary: file.series.showPerRaceRatingsInSummary ?? true,
    enabledCompetitorFields: file.series.enabledCompetitorFields,
    primaryPersonLabel: file.series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
    subdivisionLabel: file.series.subdivisionLabel ?? DEFAULT_SUBDIVISION_LABEL,
  });

  await writeFleetsCompetitorsRaces(repos, file, seriesId, now, fleetIdMap, competitorIdMap, raceIdMap);
}

// ---- Update existing series from a re-imported Sailwave file ----

/** Re-key the saved per-fleet publish destinations onto the freshly-imported
 *  fleets. `ftpPaths` is keyed by the *current* (about-to-be-deleted) fleet
 *  ids; every re-imported fleet gets a brand-new id, so the only stable bridge
 *  is the fleet **name**: current id → name → new id. A fleet renamed in
 *  Sailwave between exports therefore loses its saved destination (acceptable —
 *  the scorer re-points it on next publish). */
function remapFtpPathsByFleetName(
  ftpPaths: Record<string, string> | undefined,
  currentFleets: Fleet[],
  file: SeriesFile,
  fleetIdMap: Map<string, string>,
): Record<string, string> {
  if (!ftpPaths) return {};
  const nameByCurrentId = new Map(currentFleets.map((f) => [f.id, f.name]));
  const newIdByName = new Map<string, string>();
  for (const f of file.fleets) {
    const newId = fleetIdMap.get(f.id);
    if (newId) newIdByName.set(f.name, newId);
  }
  const out: Record<string, string> = {};
  for (const [oldId, path] of Object.entries(ftpPaths)) {
    const name = nameByCurrentId.get(oldId);
    if (name == null) continue;
    const newId = newIdByName.get(name);
    if (newId) out[newId] = path;
  }
  return out;
}

/**
 * Replace a Sailwave-born series' competition data in place from a freshly
 * re-imported Sailwave file, **preserving the scorer's series identity and
 * publishing setup**. Only offered for series with `source === 'sailwave'`.
 *
 * Retained from the existing series (`...current`): name, venue, logos/links,
 * FTP destination + per-fleet paths, publish toggles, competitor-field config,
 * primary/subdivision labels, category, archived, and `source` itself.
 *
 * Replaced from the file: fleets, competitors, races, starts, finishes — and
 * the scoring rules derived from them (`discardThresholds`, `dnfScoring`).
 * `defaultStartSequence` is dropped because it keys fleet ids that no longer
 * exist after the re-import.
 *
 * File-tracking (`lastSavedAt`) is left untouched — no `.sailscoring` file was
 * involved — so the series correctly reads as "modified since last save"
 * afterwards.
 */
export async function updateSeriesFromSailwave(
  seriesId: string,
  file: SeriesFile,
  repos: SeriesFileRepos,
): Promise<void> {
  const now = Date.now();

  const current = await repos.seriesRepo.get(seriesId);
  if (!current) throw new Error(`Series ${seriesId} not found`);

  // Snapshot the current fleets *before* deleting children — their names are
  // the bridge used to re-attach the saved publish destinations below.
  const currentFleets = await repos.fleetRepo.listBySeries(seriesId);

  const fleetIdMap = new Map(file.fleets.map((f) => [f.id, crypto.randomUUID()]));
  const competitorIdMap = new Map(file.competitors.map((c) => [c.id, crypto.randomUUID()]));
  const raceIdMap = new Map(file.races.map((r) => [r.id, crypto.randomUUID()]));

  const ftpPaths = remapFtpPathsByFleetName(current.ftpPaths, currentFleets, file, fleetIdMap);

  await repos.deleteSeriesChildren(seriesId);

  // Authoritative file-replay write — no `expectedVersion`. The user has
  // already confirmed the destructive-replace dialog.
  await repos.seriesRepo.save({
    ...current,
    discardThresholds: file.series.discardThresholds,
    dnfScoring: file.series.dnfScoring,
    defaultStartSequence: undefined,
    ftpPaths,
    lastModifiedAt: now,
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
  // Phase 7 audit: every `saveMany`/`save` below is authoritative-by-
  // construction. Either we just minted `seriesId` (open-as-new) or
  // `deleteSeriesChildren` cleared the prior child rows (update-from-
  // file). All ids are freshly generated; no concurrent writer can
  // race against rows that don't exist yet.
  await repos.fleetRepo.saveMany(
    file.fleets.map((f) => ({
      id: fleetIdMap.get(f.id)!,
      seriesId,
      name: f.name,
      displayOrder: f.displayOrder,
      scoringSystem: f.scoringSystem,
      ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
      ...(f.nhcProfile != null ? { nhcProfile: f.nhcProfile } : {}),
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
        ...(c.nationality ? { nationality: c.nationality } : {}),
        gender: c.gender,
        age: c.age,
        ...(c.subdivision ? { subdivision: c.subdivision } : {}),
        createdAt: now,
        ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
        ...(c.vprsTcc != null ? { vprsTcc: c.vprsTcc } : {}),
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

    await repos.raceStartRepo.saveMany(
      r.starts.map((s) => ({
        id: crypto.randomUUID(),
        raceId: newRaceId,
        fleetIds: s.fleetIds.map((id) => fleetIdMap.get(id) ?? id),
        startTime: s.startTime,
      })),
    );

    if (r.ratingOverrides?.length) {
      await repos.raceRatingOverrideRepo.saveMany(
        r.ratingOverrides
          .map((o) => ({
            id: crypto.randomUUID(),
            raceId: newRaceId,
            competitorId: competitorIdMap.get(o.competitorId) ?? '',
            field: o.field,
            value: o.value,
          }))
          .filter((o) => o.competitorId), // drop overrides for unknown competitors
      );
    }

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
          tiedWithPrevious: f.tiedWithPrevious ?? false,
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
