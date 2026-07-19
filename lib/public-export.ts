import type {
  ResultCode,
  PenaltyCode,
  DiscardThreshold,
  DnfScoring,
  CompetitorFieldKey,
  MultiPersonFieldKey,
  PrimaryPersonLabel,
  Finish,
  SubdivisionAxis,
  LogoDefaults,
  Series,
  Prize,
} from './types';
import type {
  CompetitorRepository,
  FinishRepository,
  FleetRepository,
  RaceRepository,
  RaceStartRepository,
  RaceRatingOverrideRepository,
  SeriesRepository,
  SubSeriesRepository,
} from './repository';
import { calculateFleetStandings, calculateRaceScores, buildRaceFleetExclusionMap } from './scoring';
import { loadSeriesSnapshot, type SeriesSnapshot } from './series-snapshot';
import {
  defaultEnabledCompetitorFields,
  formatPrimaryNames,
  DEFAULT_PRIMARY_PERSON_LABEL,
} from './competitor-fields';
import { disambiguateSeriesName } from './series-name';

// ---- Public export type ----
//
// A stripped-down, public-facing snapshot of a series. Intentionally excludes all
// scorer-private fields: ftpHost, ftpPath, ftpPaths, and all internal UUIDs
// (competitors are keyed by sailNumber instead).

/** Start sequence group as it appears in the public export. Refers to fleets
 *  by name rather than by internal UUID (mirroring how `races[].starts` does).
 *  Unlike the internal `StartGroup`, the public schema carries cumulative
 *  minutes from the first start — unambiguous in JSON-as-data, and stable for
 *  downstream consumers (e.g. bilge). The export converts intervals → cumulative
 *  on the way out, and the importer converts cumulative → intervals on the way in. */
export interface ExportStartGroup {
  fleetNames: string[];
  offsetMinutes: number;
}

/** A prize clause as it appears in the public export (#240). Fleet clauses
 *  refer to the fleet by name (fleet UUIDs are not carried in the export);
 *  axis ids are series-local opaque keys carried verbatim, like
 *  `subdivisionAxes`. */
export type ExportPrizeClause =
  | { kind: 'fleet'; fleetName: string }
  | { kind: 'axis'; axisId: string; value: string }
  | { kind: 'rank'; max: number }
  | { kind: 'gender'; value: 'M' | 'F' }
  | { kind: 'nationality'; value: string }
  | { kind: 'club'; value: string };

/** A prize as it appears in the public export (#240). No id — prize ids are
 *  series-local; importers mint fresh ones. */
export interface ExportPrize {
  name: string;
  recipientCount: number;
  clauses: ExportPrizeClause[];
}

export interface PublicSeriesExport {
  version: 1;
  exportedAt: string;
  series: {
    name: string;
    venue: string;
    startDate: string;
    endDate: string;
    venueLogoUrl?: string;
    eventLogoUrl?: string;
    venueUrl?: string;
    eventUrl?: string;
    discardThresholds: DiscardThreshold[];
    dnfScoring: DnfScoring;
    /** Whole-series per-fleet race exclusions — a race struck from one fleet's
     *  scoring. Keyed by the export's portable identity (race number + fleet
     *  name), like the sub-series `raceExclusions`. Sparse — omitted when empty.
     *  Carried so a re-import re-scores identically. */
    raceFleetExclusions?: { raceNumber: number; fleetName: string }[];
    /** Which optional competitor fields the scorer has chosen to show.
     *  Display hint for re-renderers; competitor data is still exported in
     *  full regardless of this setting. */
    displayFields: CompetitorFieldKey[];
    /** Person fields opened to multiple names per entry (#316). Display/entry
     *  hint like `displayFields`; sparse — absent means all single. */
    multiPersonFields?: MultiPersonFieldKey[];
    /** Label for the primary person slot (`Competitor.name`). Display hint —
     *  "competitor" / "entrant" / "helm" / "owner". Absent in exports produced
     *  by older builds; importers default to "competitor". */
    primaryPersonLabel?: PrimaryPersonLabel;
    /** Named subdivision axes, e.g. a "Division" and an "Age category"
     *  axis. Each `competitors[].subdivisions` entry is keyed by an axis id here.
     *  Absent in exports from older builds (importers default to none). */
    subdivisionAxes?: SubdivisionAxis[];
    scoringMode: 'scratch' | 'handicap';
    /** NHC publish-rating-calculations toggle (display hint). */
    publishRatingCalculations?: boolean;
    /** NHC/ECHO summary per-race rating toggle (display hint). */
    showPerRaceRatingsInSummary?: boolean;
    /** Default start sequence used when new races are created. */
    defaultStartSequence?: ExportStartGroup[];
    /** Prize list (#240). Absent in exports from older builds and when the
     *  series has no prizes. */
    prizes?: ExportPrize[];
    /** Results lifecycle. Present only when the scorer has marked the series
     *  final; absent = provisional (and on exports from older builds). */
    resultsStatus?: 'final';
    /** Epoch ms when the series was marked final. */
    finalisedAt?: number;
    /** Protest / redress time limit from the SIs. Carried so a re-import
     *  keeps computing per-race limit times. */
    protestTimeLimit?: { minutes: number; basis: 'race' | 'day' };
  };
  fleets: {
    name: string;
    displayOrder: number;
    scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo' | 'vprs';
    /** ECHO blend rate α (present iff scoringSystem === 'echo'). */
    echoAlpha?: number;
    /** Inline NHC profile (present iff scoringSystem === 'nhc' and parameters differ from SWNHC2015 defaults). */
    nhcProfile?: import('./types').NhcProfile;
  }[];
  competitors: {
    sailNumber: string;
    /** Bow number, when it differs from the registered sail number. */
    bowNumber?: string;
    boatName?: string;
    boatClass?: string;
    /** Primary person(s), min one; several for co-owned/co-helmed entries. */
    names: string[];
    /** Legacy single primary from pre-list exports; folds into `names`. */
    name?: string;
    /** Owner(s), when recorded separately from the primary (helm-primary series). */
    owners?: string[];
    /** Legacy single owner; folds into `owners`. */
    owner?: string;
    /** Helm(s), when recorded separately from the primary (owner-primary series). */
    helms?: string[];
    /** Legacy single helm; folds into `helms`. */
    helm?: string;
    /** Crew names in listed order — one for a two-person dinghy, several for a
     *  keelboat crew. */
    crewNames?: string[];
    /** Legacy single crew name, written by pre-crew-list exports; the importer
     *  folds it into a one-element `crewNames`. Never written by current builds. */
    crewName?: string;
    club: string;
    /** 3-letter national-letters code (RRS Appendix G / IOC), e.g. "IRL". */
    nationality?: string;
    gender: 'M' | 'F' | '';
    age: number | null;
    /** Per-axis subdivision values (e.g. {<divisionAxisId>: "Silver"}), keyed by
     *  `series.subdivisionAxes[].id`. */
    subdivisions?: Record<string, string>;
    fleetNames: string[];
    ircTcc?: number;
    /** VPRS Time Correction Coefficient. */
    vprsTcc?: number;
    pyNumber?: number;
    /** NHC starting TCF (race-1 input). */
    nhcStartingTcf?: number;
    /** ECHO starting handicap (race-1 input). */
    echoStartingTcf?: number;
  }[];
  races: {
    raceNumber: number;
    name?: string | null; // optional human label, distinct from the number
    date: string;
    /** Sub-series this race belongs to, by name (many-to-many; a race may be
     *  in several). Importers rebuild the sub-series from these. */
    subSeries?: string[];
    /** Manually recorded last-finisher clock time ("HH:MM:SS") for races with
     *  untimed finishes — the anchor for protest time limits. When finishes
     *  carry times the sheet itself is authoritative and this is absent. */
    lastFinisherTime?: string;
    starts: {
      fleetNames: string[];
      startTime?: string;  // absent for a membership-only start (fleets, no gun time)
    }[];
    finishes: {
      sailNumber: string;
      /** Set when the finish is unresolved (scorer recorded a crossing
       *  but no matching competitor). When present, `sailNumber` is empty. */
      unknownSailNumber?: string;
      /** Marks a row entered by typing the competitor's bow number. */
      matchedOnBowNumber?: boolean;
      sortOrder: number | null;
      /** Marks the finisher as tied with the prior row (RRS A8.1). Optional
       *  in the export; older exports default to false on import. */
      tiedWithPrevious?: boolean;
      finishTime?: string;
      resultCode: ResultCode | null;
      startPresent: boolean | null;
      /** Additive penalty applied on top of the finish (ZFP/SCP/DPI). */
      penaltyCode?: PenaltyCode | null;
      /** SCP %, DPI points, or null to use code default. */
      penaltyOverride?: number | null;
      /** Per-fleet DPI points (fleetId → points) for multi-fleet boats. */
      penaltyOverrideByFleet?: Record<string, number>;
      /** Redress (RDG) configuration — all fields together reproduce
       *  the A9 average. Present iff resultCode === 'RDG'. */
      redressMethod?: 'all_races' | 'all_races_excl_dnc' | 'races_before' | 'stated' | null;
      redressExcludeRaces?: number[] | null;
      redressIncludeRaces?: number[] | null;
      redressIncludeAllLater?: boolean;
      redressPoints?: number | null;
      /** Per-fleet stated redress points (fleetId → points) for multi-fleet boats. */
      redressPointsByFleet?: Record<string, number>;
    }[];
    /** NHC per-fleet scoring intermediates for this race (one entry per NHC
     *  fleet, keyed by fleet name). Carries the fleet-race aggregates used in
     *  the explainability fleet header line, plus the per-boat intermediate
     *  calculations needed to reproduce New TCF. */
    nhcByFleet?: Record<string, NhcRaceFleetExport>;
    /** ECHO per-fleet scoring intermediates for this race (one entry per
     *  ECHO fleet, keyed by fleet name). Carries the IS-formula fleet
     *  inputs (ΣH_S, Σ(1/T_E)) so a downstream consumer can reproduce
     *  PI = ΣH_S / (T_E × Σ(1/T_E)) directly. */
    echoByFleet?: Record<string, EchoRaceFleetExport>;
  }[];
  standings: {
    fleetName: string;
    rows: {
      rank: number;
      sailNumber: string;
      name: string;
      racePoints: number[];
      raceCodes: (ResultCode | null)[];
      raceDiscards: boolean[];
      racePenaltyCodes: (PenaltyCode | null)[];
      racePenaltyOverrides: (number | null)[];
      raceNonDiscardable: boolean[];
      raceRedressFlags: boolean[];
      raceExcluded: boolean[];
      totalPoints: number;
      netPoints: number;
    }[];
  }[];
  /** Sub-series scoping metadata. Membership stays on `races[*].subSeries`
   *  (by name); this carries the extra per-sub-series scoping for the blocks
   *  that have it — a fleet subset (by name) and per-fleet race exclusions
   *  (race number + fleet name). Sub-series with neither are omitted; absent
   *  entirely on exports from older builds. */
  subSeries?: {
    name: string;
    fleetNames?: string[];
    raceExclusions?: { raceNumber: number; fleetName: string }[];
    excludeDncOnlyCompetitors?: boolean;
  }[];
}

/** Per-(race, fleet) NHC scoring details for the public export.
 *  Mirrors the SWNHC2015 spreadsheet output — every per-finisher
 *  intermediate the algorithm uses, plus the fleet-level constants
 *  (P50, W51, σ(S), thresholds, realignment factor). A consumer with
 *  this data can reproduce every NewTcf to 3 dp. */
export interface NhcRaceFleetExport {
  finisherCount: number;
  ctAvgSecs: number;
  meanTcf: number;
  p50: number;
  w51: number | null;
  sMean: number;
  sStdev: number;
  sHi: number;
  sLo: number;
  extremeCount: number;
  realignmentFactor: number;
  updateSuppressed: boolean;
  rows: {
    sailNumber: string;
    tcfApplied: number;
    newTcf: number;
    /** Intermediates present iff the boat finished this race. */
    fairTcf?: number;
    compScore?: number;
    isExtreme?: boolean;
    extremeDirection?: 'fast' | 'slow';
    alphaApplied?: number;
    provisionalTcf?: number;
    adjustment?: number;
  }[];
}

/** Per-(race, fleet) ECHO scoring details for the public export.
 *  Same per-row shape as NHC; the fleet-level header carries the
 *  IS-formula inputs (sumH, sumReciprocalEt) and the suppression flag. */
export interface EchoRaceFleetExport {
  alpha: number;
  finisherCount: number;
  ctAvgSecs: number;
  meanTcf: number;
  /** ΣH_S — sum of starting handicaps across finishers. */
  sumH: number;
  /** Σ(1/T_E) — sum of reciprocals of elapsed times across finishers. */
  sumReciprocalEt: number;
  /** True when the IS guide's ≤2-finisher gate fired (no rating update). */
  updateSuppressed: boolean;
  rows: {
    sailNumber: string;
    tcfApplied: number;
    newTcf: number;
    /** Intermediates present iff the boat finished this race. */
    ctRatio?: number;
    fairTcf?: number;        // = PI_i in IS notation
    adjustment?: number;
    /** 1/T_E_i in seconds⁻¹ — present iff the boat finished. Lets a
     *  consumer verify Σ(1/T_E) by summing the column. */
    reciprocalEt?: number;
  }[];
}

// ---- Builder ----

/** Repository surface needed to read a series for export. */
/** The slice of a logo repository that publishing needs: the workspace's
 *  default venue/event logo URLs. */
export interface LogoDefaultsReader {
  getDefaults(): Promise<LogoDefaults>;
}

export interface ExportRepos {
  seriesRepo: SeriesRepository;
  competitorRepo: CompetitorRepository;
  raceRepo: RaceRepository;
  fleetRepo: FleetRepository;
  subSeriesRepo: SubSeriesRepository;
  finishRepo: FinishRepository;
  raceStartRepo: RaceStartRepository;
  raceRatingOverrideRepo: RaceRatingOverrideRepository;
  /** Optional workspace logo-defaults reader. When present, the publish/export
   *  builders fill a series' empty venue/event logo slots from the workspace
   *  defaults (see `applyWorkspaceLogoDefaults`). Absent on the `.sailscoring`
   *  file path, which must serialise the series exactly as stored. */
  logoRepo?: LogoDefaultsReader;
}

/**
 * Publish-time fallback for workspace default logos. A series whose venue or
 * event logo slot is empty inherits the workspace default for that slot.
 *
 * Copy-at-creation (`lib/api-handlers/series.ts`) only catches series created
 * *after* the defaults were set (and after `logo-library` was enabled), so the
 * defaults are resolved again here — every publish/export then reflects the
 * current workspace defaults rather than whatever happened to be baked in at
 * creation. The companion website URLs (`venueUrl`/`eventUrl`) have no
 * workspace default, so they're left untouched. Returns the same series object
 * when nothing changes.
 */
export function applyWorkspaceLogoDefaults(
  series: Series,
  defaults: LogoDefaults,
): Series {
  const venueLogoUrl = series.venueLogoUrl || defaults.venueLogoUrl;
  const eventLogoUrl = series.eventLogoUrl || defaults.eventLogoUrl;
  if (
    venueLogoUrl === series.venueLogoUrl &&
    eventLogoUrl === series.eventLogoUrl
  ) {
    return series;
  }
  return { ...series, venueLogoUrl, eventLogoUrl };
}

/** Resolve workspace logo defaults into a series via a repo reader, a no-op
 *  when no reader is supplied (e.g. the file-serialisation path). A failed
 *  read is treated as "no defaults" rather than aborting the export: defaults
 *  are an optional enhancement, and the client reader hits a `logo-library`
 *  feature-gated endpoint that 403s when the feature is off (where there are no
 *  defaults to apply anyway). */
export async function resolveSeriesLogoDefaults(
  series: Series,
  logoRepo: LogoDefaultsReader | undefined,
): Promise<Series> {
  if (!logoRepo) return series;
  let defaults: LogoDefaults;
  try {
    defaults = await logoRepo.getDefaults();
  } catch {
    return series;
  }
  return applyWorkspaceLogoDefaults(series, defaults);
}

/**
 * Repository surface for the public-JSON import path. Adds the
 * `listSeriesNames` helper used to disambiguate the new series name.
 */
export interface ImportRepos extends ExportRepos {
  listSeriesNames(opts?: { excludeId?: string }): Promise<string[]>;
}

export async function buildPublicExport(
  seriesId: string,
  repos: ExportRepos,
): Promise<PublicSeriesExport | null> {
  const snapshot = await loadSeriesSnapshot(repos, seriesId);
  if (!snapshot) return null;
  snapshot.series = await resolveSeriesLogoDefaults(snapshot.series, repos.logoRepo);
  return buildPublicExportFromSnapshot(snapshot);
}

/**
 * Pure half of `buildPublicExport`: build the export from an
 * already-loaded snapshot. Callers that have both the snapshot and the
 * fleet standings in hand (the per-fleet HTML builder) pass the standings
 * in so one publish/preview/FTP/download runs the scoring engine once.
 */
export function buildPublicExportFromSnapshot(
  snapshot: SeriesSnapshot,
  opts?: {
    fleetStandings?: ReturnType<typeof calculateFleetStandings>['fleetStandings'];
  },
): PublicSeriesExport | null {
  const {
    series,
    competitors,
    fleets,
    races,
    subSeries,
    finishes: allFinishes,
    raceStarts: allRaceStarts,
    ratingOverrides: allRatingOverrides,
  } = snapshot;
  if (competitors.length === 0 || races.length === 0) return null;
  const subSeriesNamesByRaceId = new Map<string, string[]>();
  for (const ss of subSeries) {
    for (const rid of ss.raceIds) {
      const list = subSeriesNamesByRaceId.get(rid) ?? [];
      list.push(ss.name);
      subSeriesNamesByRaceId.set(rid, list);
    }
  }

  const fleetStandings =
    opts?.fleetStandings ??
    calculateFleetStandings(
      fleets,
      competitors,
      races,
      allFinishes,
      series.discardThresholds,
      series.dnfScoring,
      allRaceStarts,
      allRatingOverrides,
      undefined,
      buildRaceFleetExclusionMap(series.raceFleetExclusions),
    ).fleetStandings;

  // Build fleet name lookup
  const fleetNameById = new Map(fleets.map((f) => [f.id, f.name]));
  const sailNumberById = new Map(competitors.map((c) => [c.id, c.sailNumber]));

  // Per-fleet point maps (per-fleet RDG / DPI) are stored internally keyed by
  // fleetId, but the export's portable identity is the fleet name — so re-key
  // them to names here. importPublicExport reverses this against freshly-minted
  // fleet ids.
  const perFleetByName = (m: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(m).map(([fleetId, v]) => [fleetNameById.get(fleetId) ?? fleetId, v]),
    );

  const isSingleDefault = fleets.length <= 1 && fleets[0]?.name === 'Default';

  // For each NHC fleet, index per-race scores + aggregates by raceId for fast lookup below.
  const nhcByFleetByRaceId = new Map<string, Map<string, NhcRaceFleetExport>>();
  for (const fr of fleetStandings) {
    if (!fr.nhcRaceScoresByRaceId || !fr.nhcAggregatesByRaceId) continue;
    const fleetName = isSingleDefault ? 'Default' : fr.fleet.name;
    for (const [raceId, scores] of fr.nhcRaceScoresByRaceId) {
      const agg = fr.nhcAggregatesByRaceId.get(raceId);
      if (!agg) continue;
      const rows = [...scores.entries()]
        .filter(([, s]) => s.tcfApplied != null && s.newTcf != null)
        .map(([cid, s]) => ({
          sailNumber: sailNumberById.get(cid) ?? cid,
          tcfApplied: s.tcfApplied!,
          newTcf: s.newTcf!,
          ...(s.nhc ? {
            fairTcf: s.nhc.fairTcf,
            compScore: s.nhc.compScore,
            isExtreme: s.nhc.isExtreme,
            ...(s.nhc.extremeDirection ? { extremeDirection: s.nhc.extremeDirection } : {}),
            alphaApplied: s.nhc.alphaApplied,
            provisionalTcf: s.nhc.provisionalTcf,
            adjustment: s.nhc.adjustment,
          } : {}),
        }));
      const entry: NhcRaceFleetExport = {
        finisherCount: agg.finisherCount,
        ctAvgSecs: agg.ctAvg,
        meanTcf: agg.meanTcf,
        p50: agg.p50,
        w51: agg.w51,
        sMean: agg.sMean,
        sStdev: agg.sStdev,
        sHi: agg.sHi,
        sLo: agg.sLo,
        extremeCount: agg.extremeCount,
        realignmentFactor: agg.realignmentFactor,
        updateSuppressed: agg.updateSuppressed,
        rows,
      };
      const byFleet = nhcByFleetByRaceId.get(raceId) ?? new Map();
      byFleet.set(fleetName, entry);
      nhcByFleetByRaceId.set(raceId, byFleet);
    }
  }

  // Same indexing for ECHO fleets.
  const echoByFleetByRaceId = new Map<string, Map<string, EchoRaceFleetExport>>();
  for (const fr of fleetStandings) {
    if (!fr.echoRaceScoresByRaceId || !fr.echoAggregatesByRaceId) continue;
    const fleetName = isSingleDefault ? 'Default' : fr.fleet.name;
    for (const [raceId, scores] of fr.echoRaceScoresByRaceId) {
      const agg = fr.echoAggregatesByRaceId.get(raceId);
      if (!agg) continue;
      const rows = [...scores.entries()]
        .filter(([, s]) => s.tcfApplied != null && s.newTcf != null)
        .map(([cid, s]) => ({
          sailNumber: sailNumberById.get(cid) ?? cid,
          tcfApplied: s.tcfApplied!,
          newTcf: s.newTcf!,
          ...(s.echo ? { ctRatio: s.echo.ctRatio, fairTcf: s.echo.fairTcf, adjustment: s.echo.adjustment } : {}),
          ...(s.elapsedTime != null && s.elapsedTime > 0 && s.resultCode == null ? { reciprocalEt: 1 / s.elapsedTime } : {}),
        }));
      const entry: EchoRaceFleetExport = {
        alpha: agg.alpha,
        finisherCount: agg.finisherCount,
        ctAvgSecs: agg.ctAvg,
        meanTcf: agg.meanTcf,
        sumH: agg.sumH,
        sumReciprocalEt: agg.sumReciprocalEt,
        updateSuppressed: agg.updateSuppressed,
        rows,
      };
      const byFleet = echoByFleetByRaceId.get(raceId) ?? new Map();
      byFleet.set(fleetName, entry);
      echoByFleetByRaceId.set(raceId, byFleet);
    }
  }

  // Redress race references are held internally by race id but exported
  // positionally (by race number) so the public JSON carries no internal
  // UUIDs and stays portable. Translate id → number on export.
  const raceNumberById = new Map(races.map((r) => [r.id, r.raceNumber]));
  const toRaceNumbers = (ids: string[] | null | undefined): number[] =>
    (ids ?? []).map((id) => raceNumberById.get(id)).filter((n): n is number => n != null);

  const exportedRaces = races.map((race) => {
    const finishesForRace = allFinishes.filter((f) => f.raceId === race.id);
    const raceScores = calculateRaceScores(finishesForRace, competitors, series.dnfScoring);
    const finishes = [...raceScores.entries()].map(([competitorId, score]) => {
      const finish = finishesForRace.find((f) => f.competitorId === competitorId);
      return {
        sailNumber: sailNumberById.get(competitorId) ?? competitorId,
        ...(finish?.matchedOnBowNumber ? { matchedOnBowNumber: true } : {}),
        sortOrder: finish?.sortOrder ?? null,
        ...(finish?.tiedWithPrevious ? { tiedWithPrevious: true } : {}),
        ...(finish?.finishTime ? { finishTime: finish.finishTime } : {}),
        resultCode: score.resultCode,
        startPresent: finish?.startPresent ?? null,
        ...(finish?.penaltyCode ? { penaltyCode: finish.penaltyCode } : {}),
        ...(finish?.penaltyOverride != null ? { penaltyOverride: finish.penaltyOverride } : {}),
        ...(finish?.penaltyOverrideByFleet && Object.keys(finish.penaltyOverrideByFleet).length ? { penaltyOverrideByFleet: perFleetByName(finish.penaltyOverrideByFleet) } : {}),
        ...(finish?.resultCode === 'RDG' ? {
          redressMethod: finish.redressMethod,
          ...(finish.redressExcludeRaceIds?.length ? { redressExcludeRaces: toRaceNumbers(finish.redressExcludeRaceIds) } : {}),
          ...(finish.redressIncludeRaceIds?.length ? { redressIncludeRaces: toRaceNumbers(finish.redressIncludeRaceIds) } : {}),
          ...(finish.redressIncludeAllLater ? { redressIncludeAllLater: true } : {}),
          ...(finish.redressPoints != null ? { redressPoints: finish.redressPoints } : {}),
          ...(finish.redressPointsByFleet && Object.keys(finish.redressPointsByFleet).length ? { redressPointsByFleet: perFleetByName(finish.redressPointsByFleet) } : {}),
        } : {}),
      };
    });
    // Unresolved finishes — not in raceScores (no competitor to key on) — are
    // appended separately so a round-trip preserves them as unknown crossings.
    for (const f of finishesForRace) {
      if (f.competitorId != null) continue;
      finishes.push({
        sailNumber: '',
        ...(f.unknownSailNumber ? { unknownSailNumber: f.unknownSailNumber } : {}),
        sortOrder: f.sortOrder ?? null,
        ...(f.tiedWithPrevious ? { tiedWithPrevious: true } : {}),
        ...(f.finishTime ? { finishTime: f.finishTime } : {}),
        resultCode: f.resultCode,
        startPresent: f.startPresent ?? null,
      } as (typeof finishes)[number]);
    }
    const starts = allRaceStarts
      .filter((rs) => rs.raceId === race.id)
      .map((rs) => ({
        fleetNames: rs.fleetIds.map((id) => fleetNameById.get(id) ?? id),
        startTime: rs.startTime,
      }));
    const nhcByFleetMap = nhcByFleetByRaceId.get(race.id);
    const nhcByFleet = nhcByFleetMap && nhcByFleetMap.size > 0
      ? Object.fromEntries(nhcByFleetMap)
      : undefined;
    const echoByFleetMap = echoByFleetByRaceId.get(race.id);
    const echoByFleet = echoByFleetMap && echoByFleetMap.size > 0
      ? Object.fromEntries(echoByFleetMap)
      : undefined;
    const subSeriesNames = subSeriesNamesByRaceId.get(race.id);
    return {
      raceNumber: race.raceNumber,
      ...(race.name ? { name: race.name } : {}),
      date: race.date,
      ...(subSeriesNames?.length ? { subSeries: subSeriesNames } : {}),
      ...(race.lastFinisherTime ? { lastFinisherTime: race.lastFinisherTime } : {}),
      starts,
      finishes,
      ...(nhcByFleet ? { nhcByFleet } : {}),
      ...(echoByFleet ? { echoByFleet } : {}),
    };
  });

  const exportedStandings = fleetStandings.map(({ fleet, standings }) => ({
    fleetName: isSingleDefault ? 'Default' : fleet.name,
    rows: standings.map((s) => ({
      rank: s.rank,
      sailNumber: s.competitor.sailNumber,
      name: formatPrimaryNames(s.competitor.names),
      racePoints: s.racePoints,
      raceCodes: s.raceCodes,
      raceDiscards: s.raceDiscards,
      racePenaltyCodes: s.racePenaltyCodes,
      racePenaltyOverrides: s.racePenaltyOverrides,
      raceNonDiscardable: s.raceNonDiscardable,
      raceRedressFlags: s.raceRedressFlags,
      raceExcluded: s.raceExcluded,
      totalPoints: s.totalPoints,
      netPoints: s.netPoints,
    })),
  }));

  let cumulativeOffset = 0;
  const exportedDefaultStartSequence: ExportStartGroup[] | undefined = series.defaultStartSequence?.length
    ? series.defaultStartSequence.map((g, i) => {
        if (i > 0) cumulativeOffset += g.intervalMinutes;
        return {
          fleetNames: g.fleetIds.map((id) => fleetNameById.get(id) ?? id),
          offsetMinutes: cumulativeOffset,
        };
      })
    : undefined;

  return {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    series: {
      name: series.name,
      venue: series.venue,
      startDate: series.startDate,
      endDate: series.endDate,
      ...(series.venueLogoUrl ? { venueLogoUrl: series.venueLogoUrl } : {}),
      ...(series.eventLogoUrl ? { eventLogoUrl: series.eventLogoUrl } : {}),
      ...(series.venueUrl ? { venueUrl: series.venueUrl } : {}),
      ...(series.eventUrl ? { eventUrl: series.eventUrl } : {}),
      discardThresholds: series.discardThresholds,
      dnfScoring: series.dnfScoring,
      ...(() => {
        // Whole-series exclusions, re-keyed to the export's portable identity
        // (race number + fleet name), like the sub-series `raceExclusions`.
        const raceFleetExclusions = (series.raceFleetExclusions ?? [])
          .map((ex) => ({
            raceNumber: raceNumberById.get(ex.raceId),
            fleetName: fleetNameById.get(ex.fleetId),
          }))
          .filter((ex): ex is { raceNumber: number; fleetName: string } =>
            ex.raceNumber != null && ex.fleetName != null,
          );
        return raceFleetExclusions.length > 0 ? { raceFleetExclusions } : {};
      })(),
      displayFields: series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
      ...(series.multiPersonFields?.length ? { multiPersonFields: series.multiPersonFields } : {}),
      primaryPersonLabel: series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
      ...(series.subdivisionAxes?.length ? { subdivisionAxes: series.subdivisionAxes } : {}),
      scoringMode: series.scoringMode ?? 'scratch',
      ...(series.publishRatingCalculations != null ? { publishRatingCalculations: series.publishRatingCalculations } : {}),
      ...(series.showPerRaceRatingsInSummary != null ? { showPerRaceRatingsInSummary: series.showPerRaceRatingsInSummary } : {}),
      ...(exportedDefaultStartSequence ? { defaultStartSequence: exportedDefaultStartSequence } : {}),
      ...(() => {
        // Prizes (#240): fleet clauses go out by fleet name; a prize whose
        // fleet can't resolve is dropped whole rather than silently widened.
        const prizes = (series.prizes ?? [])
          .map((p): ExportPrize | null => {
            const clauses: ExportPrizeClause[] = [];
            for (const c of p.clauses) {
              if (c.kind !== 'fleet') {
                clauses.push(c);
                continue;
              }
              const fleetName = fleetNameById.get(c.fleetId);
              if (fleetName == null) return null;
              clauses.push({ kind: 'fleet', fleetName });
            }
            return { name: p.name, recipientCount: p.recipientCount, clauses };
          })
          .filter((p): p is ExportPrize => p !== null);
        return prizes.length > 0 ? { prizes } : {};
      })(),
      ...(series.resultsStatus === 'final' ? { resultsStatus: 'final' as const } : {}),
      ...(series.resultsStatus === 'final' && series.finalisedAt != null
        ? { finalisedAt: series.finalisedAt }
        : {}),
      ...(series.protestTimeLimit ? { protestTimeLimit: series.protestTimeLimit } : {}),
      // NB: `categoryId`/`archived` (#154) and `previousSeriesId` are
      // deliberately not exported — workspace-local organisation and
      // lineage, not series data.
    },
    fleets: fleets.map((f) => ({
      name: f.name,
      displayOrder: f.displayOrder,
      scoringSystem: f.scoringSystem,
      ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
      ...(f.nhcProfile != null ? { nhcProfile: f.nhcProfile } : {}),
    })),
    competitors: competitors.map((c) => ({
      sailNumber: c.sailNumber,
      ...(c.bowNumber ? { bowNumber: c.bowNumber } : {}),
      ...(c.boatName ? { boatName: c.boatName } : {}),
      ...(c.boatClass ? { boatClass: c.boatClass } : {}),
      names: c.names,
      ...(c.owners?.length ? { owners: c.owners } : {}),
      ...(c.helms?.length ? { helms: c.helms } : {}),
      ...(c.crewNames?.length ? { crewNames: c.crewNames } : {}),
      club: c.club,
      ...(c.nationality ? { nationality: c.nationality } : {}),
      gender: c.gender,
      age: c.age,
      ...(c.subdivisions && Object.keys(c.subdivisions).length > 0
        ? { subdivisions: c.subdivisions }
        : {}),
      fleetNames: c.fleetIds.map((id) => fleetNameById.get(id) ?? id),
      ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
      ...(c.vprsTcc != null ? { vprsTcc: c.vprsTcc } : {}),
      ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
      ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
      ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
    })),
    races: exportedRaces,
    standings: exportedStandings,
    ...(() => {
      // Sub-series scoping (fleet subset + per-fleet exclusions), by name.
      const scoped = subSeries
        .map((ss) => {
          const fleetNames = ss.fleetIds
            ?.map((id) => fleetNameById.get(id))
            .filter((n): n is string => n != null);
          const raceExclusions = (ss.raceFleetExclusions ?? [])
            .map((ex) => ({
              raceNumber: raceNumberById.get(ex.raceId),
              fleetName: fleetNameById.get(ex.fleetId),
            }))
            .filter((ex): ex is { raceNumber: number; fleetName: string } =>
              ex.raceNumber != null && ex.fleetName != null,
            );
          return {
            name: ss.name,
            ...(fleetNames && fleetNames.length > 0 ? { fleetNames } : {}),
            ...(raceExclusions.length > 0 ? { raceExclusions } : {}),
            ...(ss.excludeDncOnlyCompetitors ? { excludeDncOnlyCompetitors: true } : {}),
          };
        })
        .filter((s) => s.fleetNames || s.raceExclusions || s.excludeDncOnlyCompetitors);
      return scoped.length > 0 ? { subSeries: scoped } : {};
    })(),
  };
}

// ---- Importer ----

/**
 * Create a new series from a PublicSeriesExport. Fresh UUIDs are assigned to all
 * entities — the imported series has no file history and no publishing config.
 * Returns the new seriesId.
 *
 * NHC/ECHO TCF history is *not* persisted — the engine recomputes it from
 * finishes + starting TCFs on next render, matching what the file-export
 * path now does.
 */
export async function importPublicExport(
  data: PublicSeriesExport,
  repos: ImportRepos,
): Promise<string> {
  const newSeriesId = crypto.randomUUID();
  const now = Date.now();
  const seriesName = disambiguateSeriesName(data.series.name, await repos.listSeriesNames());

  // Each competitor gets a unique UUID. Key by (sailNumber, fleetNames) to handle
  // collisions where different-fleet boats share a sail number.
  const competitorIdBySailFleet = new Map<string, string>();
  // Secondary sail-only multi-map for finish remapping (finishes lack fleet info).
  const competitorIdsBySail = new Map<string, string[]>();
  for (const c of data.competitors) {
    const key = `${c.sailNumber}\0${[...c.fleetNames].sort().join('\0')}`;
    const id = crypto.randomUUID();
    competitorIdBySailFleet.set(key, id);
    const arr = competitorIdsBySail.get(c.sailNumber);
    if (arr) arr.push(id);
    else competitorIdsBySail.set(c.sailNumber, [id]);
  }
  function competitorKey(sailNumber: string, fleetNames: string[]): string {
    return `${sailNumber}\0${[...fleetNames].sort().join('\0')}`;
  }

  // Build fleet name → new fleet ID map
  const fleetIdByName = new Map<string, string>();
  for (const f of data.fleets) {
    fleetIdByName.set(f.name, crypto.randomUUID());
  }

  // Race number → new race ID map. Races are written further below, but the map
  // is built up-front so series-level references (whole-series exclusions)
  // resolve at save time.
  const newRaceIdByNumber = new Map(data.races.map((r) => [r.raceNumber, crypto.randomUUID()]));

  // Resolve whole-series per-fleet exclusions (race number + fleet name) back to
  // the freshly minted ids; drop any whose race or fleet no longer resolves.
  const importedRaceFleetExclusions = (data.series.raceFleetExclusions ?? [])
    .map((ex) => ({
      raceId: newRaceIdByNumber.get(ex.raceNumber),
      fleetId: fleetIdByName.get(ex.fleetName),
    }))
    .filter((ex): ex is { raceId: string; fleetId: string } => !!ex.raceId && !!ex.fleetId);

  // Re-key a per-fleet point map (exported by fleet name) onto the freshly
  // minted fleet ids. Entries whose fleet name no longer resolves are dropped
  // (the scoring engine then treats that fleet as a gap).
  const perFleetToNewIds = (m: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(m).flatMap(([name, v]) => {
        const id = fleetIdByName.get(name);
        return id ? [[id, v] as [string, number]] : [];
      }),
    );

  // Rebuild sub-series from the per-race names, in first-appearance order.
  const subSeriesIdByName = new Map<string, string>();
  for (const race of data.races) {
    for (const name of race.subSeries ?? []) {
      if (!subSeriesIdByName.has(name)) subSeriesIdByName.set(name, crypto.randomUUID());
    }
  }

  // Resolve exported defaultStartSequence (fleetNames) → internal fleetIds,
  // and convert cumulative offsets back to per-step intervals.
  const importedDefaultStartSequence = data.series.defaultStartSequence?.length
    ? (() => {
        const resolved = data.series.defaultStartSequence!
          .map((g) => ({
            fleetIds: g.fleetNames.map((n) => fleetIdByName.get(n)).filter((id): id is string => id != null),
            offsetMinutes: g.offsetMinutes,
          }))
          .filter((g) => g.fleetIds.length > 0);
        return resolved.map((g, i) => ({
          fleetIds: g.fleetIds,
          intervalMinutes: i === 0 ? 0 : Math.max(0, g.offsetMinutes - resolved[i - 1].offsetMinutes),
        }));
      })()
    : undefined;

  await repos.seriesRepo.save({
    id: newSeriesId,
    name: seriesName,
    venue: data.series.venue,
    startDate: data.series.startDate,
    endDate: data.series.endDate,
    venueLogoUrl: data.series.venueLogoUrl ?? '',
    eventLogoUrl: data.series.eventLogoUrl ?? '',
    venueUrl: data.series.venueUrl ?? '',
    eventUrl: data.series.eventUrl ?? '',
    createdAt: now,
    lastSavedAt: null,
    lastModifiedAt: now,
    scoringMode: data.series.scoringMode,
    ...(importedDefaultStartSequence?.length ? { defaultStartSequence: importedDefaultStartSequence } : {}),
    discardThresholds: data.series.discardThresholds,
    dnfScoring: data.series.dnfScoring,
    ...(importedRaceFleetExclusions.length ? { raceFleetExclusions: importedRaceFleetExclusions } : {}),
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    ...(data.series.publishRatingCalculations != null ? { publishRatingCalculations: data.series.publishRatingCalculations } : {}),
    ...(data.series.showPerRaceRatingsInSummary != null ? { showPerRaceRatingsInSummary: data.series.showPerRaceRatingsInSummary } : {}),
    enabledCompetitorFields: data.series.displayFields ?? defaultEnabledCompetitorFields(),
    ...(data.series.multiPersonFields?.length ? { multiPersonFields: data.series.multiPersonFields } : {}),
    primaryPersonLabel: data.series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
    ...(data.series.resultsStatus === 'final' ? { resultsStatus: 'final' as const } : {}),
    ...(data.series.resultsStatus === 'final' && data.series.finalisedAt != null
      ? { finalisedAt: data.series.finalisedAt }
      : {}),
    ...(data.series.protestTimeLimit ? { protestTimeLimit: data.series.protestTimeLimit } : {}),
    // Axis ids are series-local opaque keys; carried verbatim so the imported
    // competitors' `subdivisions` maps still resolve.
    subdivisionAxes: data.series.subdivisionAxes ?? [],
    // Prizes (#240): fleet clauses come back over the name bridge, with fresh
    // prize ids; a prize whose fleet name is unknown is dropped whole.
    prizes: (data.series.prizes ?? [])
      .map((p): Prize | null => {
        const clauses: Prize['clauses'] = [];
        for (const c of p.clauses) {
          if (c.kind !== 'fleet') {
            clauses.push(c);
            continue;
          }
          const fleetId = fleetIdByName.get(c.fleetName);
          if (fleetId == null) return null;
          clauses.push({ kind: 'fleet', fleetId });
        }
        return {
          id: crypto.randomUUID(),
          name: p.name,
          recipientCount: p.recipientCount,
          clauses,
        };
      })
      .filter((p): p is Prize => p !== null),
  });

  await Promise.all(
    data.fleets.map((f) =>
      repos.fleetRepo.save({
        id: fleetIdByName.get(f.name)!,
        seriesId: newSeriesId,
        name: f.name,
        displayOrder: f.displayOrder,
        scoringSystem: f.scoringSystem,
        ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
        ...(f.nhcProfile != null ? { nhcProfile: f.nhcProfile } : {}),
      }),
    ),
  );

  // Sub-series are saved after races (membership FKs to race rows); collect
  // each one's race ids during the race loop below.
  const subSeriesRaceIdsByName = new Map<string, string[]>(
    [...subSeriesIdByName.keys()].map((name) => [name, []]),
  );

  await Promise.all(
    data.competitors.map((c) => {
      const fleetIds = c.fleetNames
        .map((n) => fleetIdByName.get(n))
        .filter((id): id is string => id != null);
      return repos.competitorRepo.save({
        id: competitorIdBySailFleet.get(competitorKey(c.sailNumber, c.fleetNames))!,
        seriesId: newSeriesId,
        fleetIds,
        sailNumber: c.sailNumber,
        ...(c.bowNumber ? { bowNumber: c.bowNumber } : {}),
        ...(c.boatName ? { boatName: c.boatName } : {}),
        ...(c.boatClass ? { boatClass: c.boatClass } : {}),
        names: c.names?.length ? c.names : [c.name ?? ''],
        ...((): { owners?: string[] } => {
          const owners = c.owners?.length ? c.owners : c.owner ? [c.owner] : [];
          return owners.length ? { owners } : {};
        })(),
        ...((): { helms?: string[] } => {
          const helms = c.helms?.length ? c.helms : c.helm ? [c.helm] : [];
          return helms.length ? { helms } : {};
        })(),
        ...((): { crewNames?: string[] } => {
          const crew = c.crewNames?.length ? c.crewNames : c.crewName ? [c.crewName] : [];
          return crew.length ? { crewNames: crew } : {};
        })(),
        club: c.club,
        ...(c.nationality ? { nationality: c.nationality } : {}),
        gender: c.gender,
        age: c.age,
        ...(c.subdivisions && Object.keys(c.subdivisions).length > 0
          ? { subdivisions: c.subdivisions }
          : {}),
        createdAt: now,
        ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
        ...(c.vprsTcc != null ? { vprsTcc: c.vprsTcc } : {}),
        ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
        ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
        ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
      });
    }),
  );

  // Race ids were assigned up front (redress pools reference races by number
  // and may point forward, so all ids must be known before any finish is
  // built). Translate the exported positional numbers back to ids.
  const toRaceIds = (numbers: number[] | null | undefined): string[] | null => {
    const ids = (numbers ?? [])
      .map((n) => newRaceIdByNumber.get(n))
      .filter((id): id is string => id != null);
    return ids.length > 0 ? ids : null;
  };

  // Races sequentially because their starts and finishes FK back to the
  // race row that has to exist first. Inside each race we batch.
  for (const race of data.races) {
    const raceId = newRaceIdByNumber.get(race.raceNumber)!;
    await repos.raceRepo.save({
      id: raceId,
      seriesId: newSeriesId,
      raceNumber: race.raceNumber,
      name: race.name ?? null,
      date: race.date,
      ...(race.lastFinisherTime ? { lastFinisherTime: race.lastFinisherTime } : {}),
      createdAt: now,
    });
    for (const name of race.subSeries ?? []) {
      subSeriesRaceIdsByName.get(name)?.push(raceId);
    }

    await Promise.all(
      race.starts
        .map((start) => ({
          ...start,
          startFleetIds: start.fleetNames
            .map((n) => fleetIdByName.get(n))
            .filter((id): id is string => id != null),
        }))
        .filter((s) => s.startFleetIds.length > 0)
        .map((s) =>
          repos.raceStartRepo.save({
            id: crypto.randomUUID(),
            raceId,
            fleetIds: s.startFleetIds,
            startTime: s.startTime,
          }),
        ),
    );

    const usedIds = new Set<string>();
    const finishes: Finish[] = [];
    for (const finish of race.finishes) {
      // A finish with unknownSailNumber set (and typically empty sailNumber)
      // represents an unresolved crossing — store it with competitorId: null
      // so it survives the round trip.
      const exportedUnknownSail = finish.unknownSailNumber;
      const candidates = finish.sailNumber
        ? competitorIdsBySail.get(finish.sailNumber) ?? []
        : [];
      const competitorId = candidates.find((id) => !usedIds.has(id)) ?? candidates[0];
      if (!competitorId && !exportedUnknownSail) continue;
      if (competitorId) usedIds.add(competitorId);
      finishes.push({
        id: crypto.randomUUID(),
        raceId,
        competitorId: competitorId ?? null,
        ...(!competitorId && exportedUnknownSail ? { unknownSailNumber: exportedUnknownSail } : {}),
        ...(competitorId && finish.matchedOnBowNumber ? { matchedOnBowNumber: true } : {}),
        sortOrder: finish.sortOrder,
        tiedWithPrevious: finish.tiedWithPrevious ?? false,
        ...(finish.finishTime ? { finishTime: finish.finishTime } : {}),
        resultCode: finish.resultCode,
        startPresent: finish.startPresent,
        penaltyCode: finish.penaltyCode ?? null,
        penaltyOverride: finish.penaltyOverride ?? null,
        ...(finish.penaltyOverrideByFleet ? { penaltyOverrideByFleet: perFleetToNewIds(finish.penaltyOverrideByFleet) } : {}),
        redressMethod: finish.redressMethod ?? null,
        redressExcludeRaceIds: toRaceIds(finish.redressExcludeRaces),
        redressIncludeRaceIds: toRaceIds(finish.redressIncludeRaces),
        redressIncludeAllLater: finish.redressIncludeAllLater ?? false,
        redressPoints: finish.redressPoints ?? null,
        ...(finish.redressPointsByFleet ? { redressPointsByFleet: perFleetToNewIds(finish.redressPointsByFleet) } : {}),
      });
    }
    if (finishes.length > 0) {
      // Phase 7 audit: authoritative-by-construction. `newSeriesId`,
      // every fleet/competitor/race id, and every finish id were freshly
      // minted earlier in this function — there is no existing row this
      // bulk insert could race against.
      await repos.finishRepo.saveMany(finishes);
    }
  }

  if (subSeriesIdByName.size > 0) {
    // Resolve the by-name scoping metadata back to fresh fleet/race ids.
    const scopeByName = new Map(
      (data.subSeries ?? []).map((s) => {
        const fleetIds = s.fleetNames
          ?.map((n) => fleetIdByName.get(n))
          .filter((id): id is string => id != null);
        const raceFleetExclusions = (s.raceExclusions ?? [])
          .map((ex) => ({
            raceId: newRaceIdByNumber.get(ex.raceNumber),
            fleetId: fleetIdByName.get(ex.fleetName),
          }))
          .filter((ex): ex is { raceId: string; fleetId: string } =>
            ex.raceId != null && ex.fleetId != null,
          );
        return [s.name, { fleetIds, raceFleetExclusions, excludeDncOnlyCompetitors: s.excludeDncOnlyCompetitors }] as const;
      }),
    );
    let displayOrder = 0;
    await repos.subSeriesRepo.saveMany(
      [...subSeriesIdByName.entries()].map(([name, id]) => {
        const scope = scopeByName.get(name);
        return {
          id,
          seriesId: newSeriesId,
          name,
          displayOrder: displayOrder++,
          raceIds: subSeriesRaceIdsByName.get(name) ?? [],
          ...(scope?.fleetIds && scope.fleetIds.length > 0 ? { fleetIds: scope.fleetIds } : {}),
          ...(scope?.raceFleetExclusions && scope.raceFleetExclusions.length > 0
            ? { raceFleetExclusions: scope.raceFleetExclusions }
            : {}),
          ...(scope?.excludeDncOnlyCompetitors ? { excludeDncOnlyCompetitors: true } : {}),
        };
      }),
    );
  }

  return newSeriesId;
}
