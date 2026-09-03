import type {
  FinishRecording,
  ResultCode,
  PenaltyCode,
  DiscardThreshold,
  ProportionalDiscard,
  DnfScoring,
  CompetitorFieldKey,
  MultiPersonFieldKey,
  PrimaryPersonLabel,
  Finish,
  FinishTrackData,
  Fleet,
  SubdivisionAxis,
  LogoDefaults,
  Series,
  Prize,
  OfficialRole,
  RaceConditions,
  RaceDiscardPolicy,
  RaceOfficial,
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
import { orcCertFromSummary, orcCertSummary } from './orc-certificate';
import { hasConditions } from './race-conditions';
import { isOfficialRole, namedOfficials } from './race-officials';
import { calculateFleetStandings, calculateRaceScores, buildRaceFleetExclusionMap } from './scoring';
import { loadSeriesSnapshot, type SeriesSnapshot } from './series-snapshot';
import type { SeriesFileSplitRound } from './series-file';
import type { SplitFleetConfig } from './split-fleets';
import type { RenderSplitRound } from './split-fleets-render';
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

/** A member of a race management team as it appears in the public export
 *  (#339). No id — official ids are series-local, and importers mint fresh
 *  ones, exactly as for prizes. */
export interface ExportOfficial {
  role: OfficialRole;
  name: string;
}

/**
 * A team as the export carries it, or nothing at all.
 *
 * Returns a spreadable fragment rather than an array so that "not published"
 * and "nobody named" produce the same output: an absent key. Unnamed rows are
 * dropped, and ids with them — the export's identity is portable, and an
 * importer mints fresh ones.
 */
function exportOfficials(
  officials: RaceOfficial[] | undefined,
  publish: boolean,
): { officials?: ExportOfficial[] } {
  if (!publish) return {};
  const named = namedOfficials(officials).map((o) => ({ role: o.role, name: o.name.trim() }));
  return named.length > 0 ? { officials: named } : {};
}

/**
 * A team read back off an export, with fresh ids.
 *
 * An unrecognised role is dropped rather than coerced: the vocabulary is
 * fixed, so a role this build doesn't know is either a newer build's or
 * corrupt, and inventing a substitute would misattribute a real person's job.
 */
function importOfficials(
  officials: ExportOfficial[] | undefined,
  newId: () => string,
): { officials?: RaceOfficial[] } {
  const rebuilt = (officials ?? [])
    .filter((o) => isOfficialRole(o.role) && o.name.trim() !== '')
    .map((o) => ({ id: newId(), role: o.role, name: o.name }));
  return rebuilt.length > 0 ? { officials: rebuilt } : {};
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
  /** Format version. v1 carried every competitor field regardless of the
   *  series' displayed columns and appended unresolved finish rows; v2
   *  carries a hidden competitor column only when scoring or a prize
   *  clause reads it, and drops unresolved rows (they are the scorer's
   *  unfinished business — unpublished, and score-neutral: scoring filters
   *  to resolved rows before assigning places). Readers accept both. */
  version: 1 | 2;
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
    /** A proportional discard allowance in place of the thresholds. Sparse —
     *  omitted unless the series uses one. */
    proportionalDiscard?: ProportionalDiscard;
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
    /** Published-page detail (#347). Present only as 'races' — the
     *  single-race-event presentation, where a re-renderer should show the
     *  race tables alone. Absent = full detail. Display hint: the standings
     *  are exported in full regardless. */
    publishDetail?: 'races';
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
    /** The standing race management team. Present only when the series has
     *  opted into publishing officials — this export is embedded in every
     *  published page, so it is published output, not a private file. */
    officials?: ExportOfficial[];
    /** The opt-in itself, carried so a re-import keeps the decision rather
     *  than silently reverting a publishing series to unpublished. */
    publishOfficials?: boolean;
    /** Whether RaceSense track data is published. Same contract as
     *  `publishOfficials`: the per-finish `trackData` appears only when this
     *  is set, and the flag itself is carried so a re-import keeps it. */
    publishTrackData?: boolean;
  };
  fleets: {
    /** How the export refers to this fleet: its name, or — where a series
     *  holds several fleets of one name, as a championship that reassigns
     *  between rounds does — that name suffixed "(2)", "(3)" … Every by-name
     *  reference in the export uses this, so each resolves to one fleet. */
    name: string;
    /** The fleet's real name, when the line above had to disambiguate it.
     *  Absent when the two are the same, which is every ordinary series. */
    label?: string;
    displayOrder: number;
    scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo' | 'vprs' | 'orc';
    /** ECHO blend rate α (present iff scoringSystem === 'echo'). */
    echoAlpha?: number;
    /** Inline NHC profile (present iff scoringSystem === 'nhc' and parameters differ from SWNHC2015 defaults). */
    nhcProfile?: import('./types').NhcProfile;
    /** ORC rating option (present iff scoringSystem === 'orc' and not the APHT default). */
    orcProfile?: import('./types').OrcProfile;
    /** The colour the fleet is drawn in (present iff a split-fleet round created it). */
    color?: string;
  }[];
  /** One entry per competitor. From v2, a field the series does not display
   *  is carried only when something published still reads it: scoring and
   *  rating inputs always travel (a re-import must score the race the same
   *  way), a prize clause keeps the field it selects on (club / gender /
   *  nationality / axis), and a split-fleet series keeps `seed` and
   *  `initialFleet` (its assignments are unexplainable without them).
   *  Everything else follows `series.displayFields`. */
  competitors: {
    sailNumber: string;
    /** Bow number, when it differs from the registered sail number. */
    bowNumber?: string;
    /** Other sail numbers the boat may show; finish-entry lookup keys only. */
    alternativeSailNumbers?: string[];
    /** OA registration number (split-fleet championships). */
    entryNumber?: string;
    /** Safety tally token issued at registration; free text, verbatim. */
    tallyNumber?: string;
    /** The OA's seeding rank. Carried so a reader can reproduce a split-fleet
     *  series' initial assignment, which is unexplainable without it. */
    seed?: number;
    /** The qualifying fleet the seeding committee assigned the boat to, when
     *  it supplied the assignment rather than an order to deal from. Carried
     *  for the same reason as `seed`, and it is the stronger record of the
     *  two: the committee's judgment is not reconstructible from anything. */
    initialFleet?: string;
    /** World Sailing Sailor ID of the primary sailor. */
    worldSailingId?: string;
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
    club?: string;
    /** 3-letter national-letters code (RRS Appendix G / IOC), e.g. "IRL". */
    nationality?: string;
    gender?: 'M' | 'F' | '';
    age?: number | null;
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
    /** ORC certificate summary. The full certificate deliberately stays out
     *  of the export (published pages embed this JSON); re-import rebuilds a
     *  partial certificate from the summary. */
    orc?: import('./orc-certificate').OrcCertSummary;
  }[];
  races: {
    raceNumber: number;
    name?: string | null; // optional human label, distinct from the number
    date: string;
    /** Sub-series this race belongs to, by name (many-to-many; a race may be
     *  in several). Importers rebuild the sub-series from these. */
    subSeries?: string[];
    /** How the race's finish sheet was taken down — off the clock (absent, or
     *  'clock') or off a stopwatch ('elapsed'). Presentation only: it says
     *  which column an editor should offer, and nothing is scored from it. */
    finishRecording?: FinishRecording;
    /** Manually recorded last-finisher clock time ("HH:MM:SS") for races with
     *  untimed finishes — the anchor for protest time limits. When finishes
     *  carry times the sheet itself is authoritative and this is absent. */
    lastFinisherTime?: string;
    /** Per-race scoring options: how the race behaves when discards are
     *  selected, and what its scores are multiplied by. Absent on an
     *  ordinary race — discardable, counting once. */
    discardPolicy?: RaceDiscardPolicy;
    pointsMultiplier?: number;
    /** What the race was sailed in, and the course used. Always carried —
     *  conditions are a fact about the racing, not personal data, and they
     *  are a scoring input for ORC performance-curve work. */
    conditions?: RaceConditions;
    /** Who ran this race. Gated by the series' `publishOfficials`, like the
     *  standing team above. */
    officials?: ExportOfficial[];
    /** @deprecated split-fleet stage identity on the race (older exports).
     *  Read for back-compat (copied onto the starts), not written; the
     *  per-start fields below are authoritative. */
    stage?: 'qualifying' | 'final' | 'medal';
    stageRaceNumber?: number;
    firstPlaceOffset?: number;
    starts: {
      fleetNames: string[];
      startTime?: string;  // absent for a membership-only start (fleets, no gun time)
      /** Split-fleet series: the stage race these fleets sail in this
       *  sequence, and the companion-race offset. Per start — a sequence may
       *  span stage race numbers. */
      stage?: 'qualifying' | 'final' | 'medal';
      stageRaceNumber?: number;
      firstPlaceOffset?: number;
      /** Course length in NM — carried because it is a scoring input for
       *  time-on-distance fleets, and course facts belong in public results. */
      distanceNm?: number;
      /** RC PCS scoring-wind override in kt (ORC 402.12) — a scoring input. */
      orcScoringWind?: number;
      /** Constructed-course legs (ORC 402.5) — the course record competitors
       *  check their tracks against, so it belongs in public results. */
      courseLegs?: import('./types').OrcCourseLeg[];
      /** ORC wind-band field selection for this start — a scoring input. */
      orcOption?: string;
    }[];
    finishes: {
      sailNumber: string;
      /** Set when the finish is unresolved (scorer recorded a crossing
       *  but no matching competitor). When present, `sailNumber` is empty.
       *  Written by v1 exports only — still read on import, but v2 stops
       *  writing unresolved rows: they are unpublished scorer work in
       *  progress, and scoring ignores them when assigning places. */
      unknownSailNumber?: string;
      /** Marks a row entered by typing the competitor's bow number. Written
       *  by builds before alternative sail numbers; still read on import. */
      matchedOnBowNumber?: boolean;
      /** Which identifier matched, when it was not the registered sail
       *  number, and the text that matched. */
      matchedOn?: 'bow' | 'alternative';
      enteredSailNumber?: string;
      sortOrder: number | null;
      /** Marks the finisher as tied with the prior row (RRS A8.1). Optional
       *  in the export; older exports default to false on import. */
      tiedWithPrevious?: boolean;
      finishTime?: string;
      /** Elapsed time in seconds, as recorded. Carried unconditionally, not
       *  under `publishTrackData`: it is a scoring input, and gating it on a
       *  display opt-in would make a re-import score the race differently.
       *  Whether the *column* is shown stays the opt-in's decision. */
      elapsedSecs?: number;
      /** RaceSense track data. Present only when the series publishes it
       *  (`series.publishTrackData`) — this export is published output. */
      trackData?: FinishTrackData;
      resultCode: ResultCode | null;
      startPresent: boolean | null;
      /** Additive penalty applied on top of the finish (ZFP/SCP/DPI). */
      penaltyCode?: PenaltyCode | null;
      /** SCP %, DPI points, or null to use code default. */
      penaltyOverride?: number | null;
      /** Per-fleet DPI points (fleetId → points) for multi-fleet boats. */
      penaltyOverrideByFleet?: Record<string, number>;
      /** What a DPI was given for, in the scorer's words. */
      penaltyLabel?: string;
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
  /** Split-fleet championship state: the series' configuration and the
   *  assignment rounds behind its published pages. Absent on an ordinary
   *  series, and on exports from builds before championships published a
   *  data file at all. Fleet assignments are public information — they are
   *  printed on every one of those pages — and without them a re-import has
   *  stage-tagged starts and no rounds, so its standings cannot be rebuilt. */
  splitFleets?: ExportSplitFleets;
}

/** The split-fleet block as the export carries it. `config` travels verbatim:
 *  it names fleets by label and colour, and holds no ids. The rounds travel on
 *  the export's portable identities — fleets by name, boats by sail number —
 *  and carry no id of their own, like prizes and officials; an importer mints
 *  fresh ones and re-stamps round ownership onto the fleets from `fleetNames`. */
export interface ExportSplitFleets {
  config: SplitFleetConfig;
  rounds: ExportSplitRound[];
}

/** One assignment round in the export. `createdAt` is what orders the rounds,
 *  so it travels; `publishedAt` does not — it is workspace-local publishing
 *  state, on the same grounds the series file omits it. */
export interface ExportSplitRound {
  stage: 'qualifying' | 'final' | 'medal';
  fromStageRace: number;
  /** The round's fleets in SI/tier order, by name. */
  fleetNames: string[];
  method: string;
  basis?: { throughStageRace: number; capturedAt: number } | null;
  /** Boats placed by hand over the computed assignment: sail number → fleet
   *  name. The memberships already reflect these; the map is what lets a
   *  round card tell a hand placement from a computed one. */
  overrides?: Record<string, string>;
  createdAt: number;
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
  /** Optional split-fleet reader. When present and the series carries a
   *  split-fleet config with at least one round, `buildFleetHtmlFiles` emits
   *  the championship standings page + the fleet-assignments page instead of
   *  per-fleet pages, and the export carries the block behind them. */
  splitFleets?: {
    get(seriesId: string): Promise<{ config: SplitFleetConfig; rounds: RenderSplitRound[] } | null>;
    /** Rewrites the series' config + rounds wholesale, with ids the caller
     *  has already minted — the same writer the `.sailscoring` file replay
     *  uses, so the fleet round-ownership re-stamping is shared rather than
     *  written twice. Needed only on the import side; a read-only bundle
     *  (the publish path) omits it. */
    replace?(
      seriesId: string,
      data: { config: SplitFleetConfig | null; rounds: SeriesFileSplitRound[] },
    ): Promise<void>;
  };
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

/**
 * Fleet id → the name the export refers to it by: the fleet's own, suffixed
 * "(2)", "(3)" … where a series holds more than one fleet of that name. The
 * suffix is an export-local disambiguation, never the scorer's name for the
 * fleet — `fleets[].label` carries that whenever the two differ.
 */
function uniqueFleetNames(fleets: Fleet[]): Map<string, string> {
  const taken = new Set<string>();
  const byId = new Map<string, string>();
  for (const fleet of fleets) {
    let name = fleet.name;
    for (let n = 2; taken.has(name); n++) name = `${fleet.name} (${n})`;
    taken.add(name);
    byId.set(fleet.id, name);
  }
  return byId;
}

export async function buildPublicExport(
  seriesId: string,
  repos: ExportRepos,
): Promise<PublicSeriesExport | null> {
  const snapshot = await loadSeriesSnapshot(repos, seriesId);
  if (!snapshot) return null;
  snapshot.series = await resolveSeriesLogoDefaults(snapshot.series, repos.logoRepo);
  const splitFleets = (await repos.splitFleets?.get(seriesId)) ?? undefined;
  return buildPublicExportFromSnapshot(snapshot, { splitFleets });
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
    /** The export's `exportedAt`; now, unless the caller is re-rendering an
     *  earlier publish and wants the data file to say when that was. */
    exportedAt?: Date;
    /** The series' split-fleet state, for a championship. Passed in rather
     *  than read here: the snapshot fan-in doesn't carry it, and this half of
     *  the build is synchronous. Absent on an ordinary series. */
    splitFleets?: { config: SplitFleetConfig; rounds: RenderSplitRound[] } | null;
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
  // The single place the officials opt-in is read. This export is embedded in
  // every published page, so leaving officials out of it is what "not
  // published" actually means for named non-competitors.
  const publishOfficials = series.publishOfficials === true;
  // Same shape of opt-in for track data: leaving it out of the embedded
  // export is what "not published" means for the captured record.
  const publishTrackData = series.publishTrackData === true;
  // v2 carry rule for competitor fields: a column the series does not
  // display travels only when something published still reads it. Scoring
  // and rating inputs always travel — a re-import must score the race the
  // same way — a prize clause keeps the field it selects on, and a
  // split-fleet series keeps its seeding record (`seed`/`initialFleet`),
  // without which its assignments are unexplainable.
  const enabledFields = new Set<CompetitorFieldKey>(
    series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
  );
  const prizeClauseKinds = new Set(
    (series.prizes ?? []).flatMap((p) => p.clauses.map((c) => c.kind)),
  );
  const splitFleet = allRaceStarts.some((rs) => rs.stage != null);
  const carry = (field: CompetitorFieldKey) => enabledFields.has(field);
  const carryClub = carry('club') || prizeClauseKinds.has('club');
  const carryGender = carry('gender') || prizeClauseKinds.has('gender');
  const carryNationality = carry('nationality') || prizeClauseKinds.has('nationality');
  const carrySubdivisions = carry('subdivision') || prizeClauseKinds.has('axis');
  const carrySeed = carry('seed') || splitFleet;
  const carryInitialFleet = carry('initialFleet') || splitFleet;
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
      series.proportionalDiscard,
    ).fleetStandings;

  // Fleets are referred to by name throughout the export — the portable
  // identity, since internal UUIDs are not carried. A split-fleet
  // championship breaks the assumption that a name names one fleet: it mints
  // a fresh set of fleets each assignment round and reuses the labels, so a
  // series can hold two fleets called Yellow, with different boats in them.
  // Collapsing those on import destroys the reassignment, and with it the
  // standings. So names are made unique within the export and the fleet
  // carries its real one alongside, for an importer to restore.
  const fleetNameById = uniqueFleetNames(fleets);
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
    // The implicit DNC an absent boat scores is materialised here, so that a
    // reader sees the same rows the results page does. On a championship it
    // is not the export's to invent: a boat sails the stage races of her own
    // fleet and no others, and the split engine materialises the absentees
    // itself on the read side — where it also knows the case that is not a
    // DNC at all, a boat selected into the medal fleet being absent from her
    // old fleet's remaining races rather than scored for missing them. So
    // only recorded rows travel.
    const recordedIds = splitFleet
      ? new Set(finishesForRace.map((f) => f.competitorId))
      : null;
    const finishes = [...raceScores.entries()]
      .filter(([competitorId]) => recordedIds === null || recordedIds.has(competitorId))
      .map(([competitorId, score]) => {
        const finish = finishesForRace.find((f) => f.competitorId === competitorId);
        return {
          sailNumber: sailNumberById.get(competitorId) ?? competitorId,
          ...(finish?.matchedOn ? { matchedOn: finish.matchedOn } : {}),
          ...(finish?.enteredSailNumber ? { enteredSailNumber: finish.enteredSailNumber } : {}),
          sortOrder: finish?.sortOrder ?? null,
          ...(finish?.tiedWithPrevious ? { tiedWithPrevious: true } : {}),
          ...(finish?.finishTime ? { finishTime: finish.finishTime } : {}),
          ...(finish?.elapsedSecs != null ? { elapsedSecs: finish.elapsedSecs } : {}),
          ...(publishTrackData && finish?.trackData ? { trackData: finish.trackData } : {}),
          resultCode: score.resultCode,
          startPresent: finish?.startPresent ?? null,
          ...(finish?.penaltyCode ? { penaltyCode: finish.penaltyCode } : {}),
          ...(finish?.penaltyOverride != null ? { penaltyOverride: finish.penaltyOverride } : {}),
          ...(finish?.penaltyOverrideByFleet && Object.keys(finish.penaltyOverrideByFleet).length ? { penaltyOverrideByFleet: perFleetByName(finish.penaltyOverrideByFleet) } : {}),
          ...(finish?.penaltyLabel ? { penaltyLabel: finish.penaltyLabel } : {}),
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
    // Unresolved finishes (no competitor matched) are deliberately not
    // exported: they are the scorer's unfinished business, never rendered on
    // a published page, and score-neutral — scoring filters to resolved rows
    // before assigning places. v1 exports carried them; import still reads
    // them for those.
    const starts = allRaceStarts
      .filter((rs) => rs.raceId === race.id)
      .map((rs) => ({
        fleetNames: rs.fleetIds.map((id) => fleetNameById.get(id) ?? id),
        startTime: rs.startTime,
        ...(rs.stage ? { stage: rs.stage } : {}),
        ...(rs.stageRaceNumber != null ? { stageRaceNumber: rs.stageRaceNumber } : {}),
        ...(rs.firstPlaceOffset != null ? { firstPlaceOffset: rs.firstPlaceOffset } : {}),
        ...(rs.distanceNm != null ? { distanceNm: rs.distanceNm } : {}),
        ...(rs.orcScoringWind != null ? { orcScoringWind: rs.orcScoringWind } : {}),
        ...(rs.courseLegs?.length ? { courseLegs: rs.courseLegs } : {}),
        ...(rs.orcOption ? { orcOption: rs.orcOption } : {}),
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
      ...(race.finishRecording ? { finishRecording: race.finishRecording } : {}),
      ...(race.lastFinisherTime ? { lastFinisherTime: race.lastFinisherTime } : {}),
      ...(race.discardPolicy && race.discardPolicy !== 'normal' ? { discardPolicy: race.discardPolicy } : {}),
      ...(race.pointsMultiplier != null && race.pointsMultiplier !== 1 ? { pointsMultiplier: race.pointsMultiplier } : {}),
      ...(hasConditions(race.conditions) ? { conditions: race.conditions } : {}),
      ...(exportOfficials(race.officials, publishOfficials)),
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
    version: 2 as const,
    exportedAt: (opts?.exportedAt ?? new Date()).toISOString(),
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
      ...(series.proportionalDiscard ? { proportionalDiscard: series.proportionalDiscard } : {}),
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
      ...(series.publishDetail === 'races' ? { publishDetail: 'races' as const } : {}),
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
      ...(exportOfficials(series.officials, publishOfficials)),
      ...(publishOfficials ? { publishOfficials: true } : {}),
      ...(publishTrackData ? { publishTrackData: true } : {}),
      // NB: `categoryId`/`archived` (#154) and `previousSeriesId` are
      // deliberately not exported — workspace-local organisation and
      // lineage, not series data.
    },
    fleets: fleets.map((f) => ({
      name: fleetNameById.get(f.id) ?? f.name,
      ...(fleetNameById.get(f.id) !== f.name ? { label: f.name } : {}),
      displayOrder: f.displayOrder,
      scoringSystem: f.scoringSystem,
      ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
      ...(f.nhcProfile != null ? { nhcProfile: f.nhcProfile } : {}),
      ...(f.orcProfile != null ? { orcProfile: f.orcProfile } : {}),
      ...(f.color ? { color: f.color } : {}),
    })),
    competitors: competitors.map((c) => ({
      sailNumber: c.sailNumber,
      ...(carry('bowNumber') && c.bowNumber ? { bowNumber: c.bowNumber } : {}),
      ...(carry('alternativeSailNumbers') && c.alternativeSailNumbers?.length
        ? { alternativeSailNumbers: c.alternativeSailNumbers }
        : {}),
      ...(carry('entryNumber') && c.entryNumber ? { entryNumber: c.entryNumber } : {}),
      ...(carry('tallyNumber') && c.tallyNumber ? { tallyNumber: c.tallyNumber } : {}),
      ...(carrySeed && c.seed != null ? { seed: c.seed } : {}),
      ...(carryInitialFleet && c.initialFleet ? { initialFleet: c.initialFleet } : {}),
      ...(carry('worldSailingId') && c.worldSailingId ? { worldSailingId: c.worldSailingId } : {}),
      ...(carry('boatName') && c.boatName ? { boatName: c.boatName } : {}),
      ...(carry('boatClass') && c.boatClass ? { boatClass: c.boatClass } : {}),
      names: c.names,
      ...(carry('owner') && c.owners?.length ? { owners: c.owners } : {}),
      ...(carry('helm') && c.helms?.length ? { helms: c.helms } : {}),
      ...(carry('crewName') && c.crewNames?.length ? { crewNames: c.crewNames } : {}),
      ...(carryClub && c.club ? { club: c.club } : {}),
      ...(carryNationality && c.nationality ? { nationality: c.nationality } : {}),
      ...(carryGender && c.gender ? { gender: c.gender } : {}),
      ...(carry('age') && c.age != null ? { age: c.age } : {}),
      ...(carrySubdivisions && c.subdivisions && Object.keys(c.subdivisions).length > 0
        ? { subdivisions: c.subdivisions }
        : {}),
      fleetNames: c.fleetIds.map((id) => fleetNameById.get(id) ?? id),
      ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
      ...(c.vprsTcc != null ? { vprsTcc: c.vprsTcc } : {}),
      ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
      ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
      ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
      ...(c.orcCert != null ? { orc: orcCertSummary(c.orcCert) } : {}),
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
    ...(() => {
      // The split-fleet block. A config with no rounds yet says nothing a
      // reader could act on — no boat has been assigned — so it travels only
      // once the championship has dealt its first round, which is also the
      // point at which its pages start being published.
      const sf = opts?.splitFleets;
      if (!sf || sf.rounds.length === 0) return {};
      const rounds: ExportSplitRound[] = sf.rounds.map((r) => ({
        stage: r.stage,
        fromStageRace: r.fromStageRace,
        fleetNames: r.fleetIds.map((id) => fleetNameById.get(id) ?? id),
        method: r.method,
        ...(r.basis ? { basis: r.basis } : {}),
        ...(r.overrides && Object.keys(r.overrides).length > 0
          ? {
              overrides: Object.fromEntries(
                Object.entries(r.overrides).flatMap(([cid, fid]) => {
                  const sail = sailNumberById.get(cid);
                  const fleetName = fleetNameById.get(fid);
                  return sail && fleetName ? [[sail, fleetName] as [string, string]] : [];
                }),
              ),
            }
          : {}),
        createdAt: r.createdAt,
      }));
      return { splitFleets: { config: sf.config, rounds } };
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
/** Exports written before alternative sail numbers carried only a
 *  "matched on bow" flag; fold it forward on import. */
function exportedMatchedOn(finish: {
  matchedOn?: 'bow' | 'alternative';
  matchedOnBowNumber?: boolean;
}): 'bow' | 'alternative' | undefined {
  return finish.matchedOn ?? (finish.matchedOnBowNumber ? 'bow' : undefined);
}

/**
 * Overrides for the ids an import mints.
 *
 * Both exist for the spectator viewer (#475), which reads an export into an
 * in-memory series rather than a workspace: it needs a known series id to
 * route to, and ids that come out the same every time the same file is read,
 * so a reload rebuilds the identical series and links into it keep working.
 * A workspace import passes neither and gets fresh UUIDs throughout.
 */
export interface ImportIdOptions {
  /** Id for the new series. Default: a fresh UUID. */
  seriesId?: string;
  /** Factory for every other minted id — competitors, fleets, races, starts,
   *  finishes, sub-series, prizes, officials. Default: `crypto.randomUUID`. */
  newId?: () => string;
}

export async function importPublicExport(
  data: PublicSeriesExport,
  repos: ImportRepos,
  ids?: ImportIdOptions,
): Promise<string> {
  const newId = ids?.newId ?? (() => crypto.randomUUID());
  const newSeriesId = ids?.seriesId ?? newId();
  const now = Date.now();
  const seriesName = disambiguateSeriesName(data.series.name, await repos.listSeriesNames());

  // Each competitor gets a unique UUID. Key by (sailNumber, fleetNames) to handle
  // collisions where different-fleet boats share a sail number.
  const competitorIdBySailFleet = new Map<string, string>();
  // Secondary sail-only multi-map for finish remapping (finishes lack fleet info).
  const competitorIdsBySail = new Map<string, string[]>();
  for (const c of data.competitors) {
    const key = `${c.sailNumber}\0${[...c.fleetNames].sort().join('\0')}`;
    const id = newId();
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
    fleetIdByName.set(f.name, newId());
  }

  // Race number → new race ID map. Races are written further below, but the map
  // is built up-front so series-level references (whole-series exclusions)
  // resolve at save time.
  const newRaceIdByNumber = new Map(data.races.map((r) => [r.raceNumber, newId()]));

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
      if (!subSeriesIdByName.has(name)) subSeriesIdByName.set(name, newId());
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
    ...(data.series.proportionalDiscard ? { proportionalDiscard: data.series.proportionalDiscard } : {}),
    dnfScoring: data.series.dnfScoring,
    ...(importedRaceFleetExclusions.length ? { raceFleetExclusions: importedRaceFleetExclusions } : {}),
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    ...(data.series.publishRatingCalculations != null ? { publishRatingCalculations: data.series.publishRatingCalculations } : {}),
    ...(data.series.showPerRaceRatingsInSummary != null ? { showPerRaceRatingsInSummary: data.series.showPerRaceRatingsInSummary } : {}),
    ...(data.series.publishDetail === 'races' ? { publishDetail: 'races' as const } : {}),
    enabledCompetitorFields: data.series.displayFields ?? defaultEnabledCompetitorFields(),
    ...(data.series.multiPersonFields?.length ? { multiPersonFields: data.series.multiPersonFields } : {}),
    primaryPersonLabel: data.series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
    ...(data.series.resultsStatus === 'final' ? { resultsStatus: 'final' as const } : {}),
    ...(data.series.resultsStatus === 'final' && data.series.finalisedAt != null
      ? { finalisedAt: data.series.finalisedAt }
      : {}),
    ...(data.series.protestTimeLimit ? { protestTimeLimit: data.series.protestTimeLimit } : {}),
    ...(importOfficials(data.series.officials, newId)),
    // A published export only carries officials when the source series opted
    // in, so the flag comes back with them rather than quietly resetting a
    // publishing series to unpublished on re-import.
    ...(data.series.publishOfficials ? { publishOfficials: true } : {}),
    // Likewise for track data: the export only carries it when the source
    // series published it, so the flag comes back with the data.
    ...(data.series.publishTrackData ? { publishTrackData: true } : {}),
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
          id: newId(),
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
        name: f.label ?? f.name,
        displayOrder: f.displayOrder,
        scoringSystem: f.scoringSystem,
        ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
        ...(f.nhcProfile != null ? { nhcProfile: f.nhcProfile } : {}),
        ...(f.orcProfile != null ? { orcProfile: f.orcProfile } : {}),
        ...(f.color ? { color: f.color } : {}),
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
        ...(c.alternativeSailNumbers?.length
          ? { alternativeSailNumbers: c.alternativeSailNumbers }
          : {}),
        ...(c.entryNumber ? { entryNumber: c.entryNumber } : {}),
        ...(c.tallyNumber ? { tallyNumber: c.tallyNumber } : {}),
        ...(c.seed != null ? { seed: c.seed } : {}),
        ...(c.initialFleet ? { initialFleet: c.initialFleet } : {}),
        ...(c.worldSailingId ? { worldSailingId: c.worldSailingId } : {}),
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
        club: c.club ?? '',
        ...(c.nationality ? { nationality: c.nationality } : {}),
        gender: c.gender ?? '',
        age: c.age ?? null,
        ...(c.subdivisions && Object.keys(c.subdivisions).length > 0
          ? { subdivisions: c.subdivisions }
          : {}),
        createdAt: now,
        ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
        ...(c.vprsTcc != null ? { vprsTcc: c.vprsTcc } : {}),
        ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
        ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
        ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
        ...(c.orc != null ? { orcCert: orcCertFromSummary(c.orc, now) } : {}),
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
      ...(race.finishRecording ? { finishRecording: race.finishRecording } : {}),
      ...(race.lastFinisherTime ? { lastFinisherTime: race.lastFinisherTime } : {}),
      ...(race.discardPolicy ? { discardPolicy: race.discardPolicy } : {}),
      ...(race.pointsMultiplier != null ? { pointsMultiplier: race.pointsMultiplier } : {}),
      ...(hasConditions(race.conditions) ? { conditions: race.conditions } : {}),
      ...(importOfficials(race.officials, newId)),
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
            id: newId(),
            raceId,
            fleetIds: s.startFleetIds,
            startTime: s.startTime,
            // Per-start stage identity; older exports carry it on the race —
            // inherit so they land on the new model.
            ...((s.stage ?? race.stage) ? { stage: s.stage ?? race.stage } : {}),
            ...((s.stageRaceNumber ?? race.stageRaceNumber) != null
              ? { stageRaceNumber: s.stageRaceNumber ?? race.stageRaceNumber }
              : {}),
            ...((s.firstPlaceOffset ?? race.firstPlaceOffset) != null
              ? { firstPlaceOffset: s.firstPlaceOffset ?? race.firstPlaceOffset }
              : {}),
            ...(s.distanceNm != null ? { distanceNm: s.distanceNm } : {}),
            ...(s.orcScoringWind != null ? { orcScoringWind: s.orcScoringWind } : {}),
            ...(s.courseLegs?.length ? { courseLegs: s.courseLegs } : {}),
            ...(s.orcOption ? { orcOption: s.orcOption } : {}),
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
        id: newId(),
        raceId,
        competitorId: competitorId ?? null,
        ...(!competitorId && exportedUnknownSail ? { unknownSailNumber: exportedUnknownSail } : {}),
        ...(competitorId && exportedMatchedOn(finish)
          ? { matchedOn: exportedMatchedOn(finish)! }
          : {}),
        ...(competitorId && finish.enteredSailNumber
          ? { enteredSailNumber: finish.enteredSailNumber }
          : {}),
        sortOrder: finish.sortOrder,
        tiedWithPrevious: finish.tiedWithPrevious ?? false,
        ...(finish.finishTime ? { finishTime: finish.finishTime } : {}),
        ...(finish.elapsedSecs != null ? { elapsedSecs: finish.elapsedSecs } : {}),
        ...(finish.trackData ? { trackData: finish.trackData } : {}),
        resultCode: finish.resultCode,
        startPresent: finish.startPresent,
        penaltyCode: finish.penaltyCode ?? null,
        penaltyOverride: finish.penaltyOverride ?? null,
        ...(finish.penaltyLabel ? { penaltyLabel: finish.penaltyLabel } : {}),
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

  // Split-fleet config + rounds, replayed last on the freshly minted ids.
  // Round ids are minted here; the writer re-stamps round ownership onto the
  // fleets from each round's list, which is why the fleets themselves carry
  // no marker through the export. References that no longer resolve are
  // dropped rather than written dangling, as everywhere else in this import.
  if (data.splitFleets && repos.splitFleets?.replace) {
    await repos.splitFleets.replace(newSeriesId, {
      config: data.splitFleets.config,
      rounds: data.splitFleets.rounds.map((r) => ({
        id: newId(),
        stage: r.stage,
        fromStageRace: r.fromStageRace,
        fleetIds: r.fleetNames
          .map((n) => fleetIdByName.get(n))
          .filter((id): id is string => id != null),
        method: r.method,
        basis: r.basis ?? null,
        ...(r.overrides
          ? {
              overrides: Object.fromEntries(
                Object.entries(r.overrides).flatMap(([sail, fleetName]) => {
                  const competitorId = competitorIdsBySail.get(sail)?.[0];
                  const fleetId = fleetIdByName.get(fleetName);
                  return competitorId && fleetId
                    ? [[competitorId, fleetId] as [string, string]]
                    : [];
                }),
              ),
            }
          : {}),
        createdAt: r.createdAt,
      })),
    });
  }

  return newSeriesId;
}
