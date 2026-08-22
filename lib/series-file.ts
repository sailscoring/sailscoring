import type {
  Series,
  Fleet,
  ResultCode,
  PenaltyCode,
  DiscardThreshold,
  ProportionalDiscard,
  DnfScoring,
  Finish,
  CompetitorFieldKey,
  PrimaryPersonLabel,
  StartGroup,
  NhcProfile,
  TcfRecord,
  SubdivisionAxis,
  RaceConditions,
  RaceDiscardPolicy,
  RaceFleetExclusion,
  RaceOfficial,
  PublishingGroup,
  ProtestTimeLimit,
  RrsOrgPushConfig,
  Prize,
  MultiPersonFieldKey,
} from './types';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
  upgradeSubdivisionAxes,
} from './competitor-fields';
import { hasConditions } from './race-conditions';
import { calculateFleetStandings, buildRaceFleetExclusionMap } from './scoring';
import { loadSeriesSnapshot } from './series-snapshot';
import { disambiguateSeriesName, seriesSlug } from './series-name';
import type { LogoDefaultsReader } from './public-export';
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

/**
 * Repository surface needed to save / open / update a series file.
 * `lib/api-repository.ts` exports this exact shape.
 */
export interface SeriesFileRepos {
  seriesRepo: SeriesRepository;
  competitorRepo: CompetitorRepository;
  fleetRepo: FleetRepository;
  raceRepo: RaceRepository;
  subSeriesRepo: SubSeriesRepository;
  raceStartRepo: RaceStartRepository;
  raceRatingOverrideRepo: RaceRatingOverrideRepository;
  finishRepo: FinishRepository;
  /** Split-fleet state (v23+). Optional: bundles that lack it simply don't
   *  carry split-fleet data through files/revisions. `replace` rewrites the
   *  series' rounds + config wholesale (ids freshly minted by the caller);
   *  a null config with no rounds clears the series' split-fleet state. */
  splitFleets?: {
    get(seriesId: string): Promise<SeriesFileSplitFleets | null>;
    replace?(seriesId: string, data: SeriesFileSplitFleetsWrite): Promise<void>;
  };
  listSeriesNames(opts?: { excludeId?: string }): Promise<string[]>;
  deleteSeriesChildren(seriesId: string): Promise<void>;
  /** Run `fn` against transaction-scoped repos, rolling back everything it
   *  wrote if it throws. The file replays below delete a series' children
   *  before rewriting them, so without this a mid-replay failure leaves the
   *  series empty with no way back. Optional: implementations that can't
   *  offer one (the client repository, seed, tests) omit it and the replay
   *  runs unwrapped, exactly as before. */
  runInTransaction?<T>(fn: (repos: SeriesFileRepos) => Promise<T>): Promise<T>;
  /** Optional workspace logo-defaults reader. Structurally satisfies the
   *  `ExportRepos.logoRepo` slot so this same bundle drives the public-export
   *  publish path (`buildPublicExport`); the file builder itself ignores it. */
  logoRepo?: LogoDefaultsReader;
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
 *  still load — the parser ignores the now-unused keys.
 *
 *  v9 adds sub-series: a top-level `subSeries` list (named blocks of races,
 *  each scored independently) and `races[*].subSeriesId` membership.
 *  Additive; older files load blockless.
 *
 *  v10 adds optional `races[*].name` (a human label distinct from the race
 *  number). Additive; older files load with the field absent (name null).
 *
 *  v11 generalises sub-series: optional `subSeries[*].fleetIds` (scope a block
 *  to a fleet subset; absent = all fleets) and `subSeries[*].raceFleetExclusions`
 *  (a member race struck for one fleet). Additive; older files load with both
 *  absent (all fleets, no exclusions).
 *
 *  v12 adds optional `subSeries[*].excludeDncOnlyCompetitors` (rank only boats
 *  that took part in the sub-series). Additive; older files load with it absent
 *  (false — all-DNC competitors scored, like a plain series).
 *
 *  v13 generalises subdivisions to multiple named axes: `Series.subdivisionAxes`
 *  (replacing the single `subdivisionLabel`) and `Competitor.subdivisions` (a map keyed
 *  by axis id, replacing the single `subdivision`). v6–v12 files upgrade on load — the
 *  old label becomes one axis and each competitor's value is keyed onto it.
 *
 *  v14 adds optional `series.raceFleetExclusions` (a race struck for one fleet
 *  across the whole-series standings — the series-scoped counterpart of the
 *  sub-series field). Additive and sparse (written only when non-empty); older
 *  files load with it absent (no exclusions).
 *
 *  v15 adds optional `series.publishingGroups` (combined published pages —
 *  several fleets rendered as sections of one page) and optional
 *  `series.publishIndividualFleetPages` (whether fleets also publish
 *  standalone pages alongside them; written only when false). Both are
 *  additive and sparse; older files load with them absent (no combined
 *  pages, fleet pages published).
 *
 *  v16 adds optional `series.rrsOrgPush` (the rrs.org competitor-push event
 *  UUID + division source remembered from the last push). Additive and sparse
 *  (written only when set); older files load with it absent. The UUID is a
 *  write-credential for the rrs.org event — carried here so the config
 *  follows the series between workspaces, but excluded from the public JSON
 *  export.
 *
 *  v17 adds optional `series.prizes` (the prize list — named awards with an
 *  eligibility predicate and recipient count, #240). Additive and sparse
 *  (written only when non-empty); older files load with it absent. Fleet ids
 *  inside prize clauses are remapped on import like every other fleet
 *  reference; subdivision-axis ids are stable and travel verbatim.
 *
 *  v18 widens the prize-clause union with intrinsic competitor-field tests:
 *  `gender` ("Lady 1st, 2nd, 3rd"), `nationality` (restricted titles) and
 *  `club`. The bump exists so a file carrying the new kinds fails loudly in
 *  a build that predates them instead of importing prizes that silently
 *  award nobody. v17 files load unchanged.
 *
 *  v19 adds optional `competitor.bowNumber` (a bow number that differs from the
 *  registered sail number, for finish-entry matching) and `finish.matchedOnBowNumber`
 *  (marks a row entered by bow number rather than sail number). Both additive and
 *  sparse (written only when set); older files load with them absent.
 *
 *  v20 adds the results lifecycle: optional `series.resultsStatus` ('final';
 *  provisional is the absent default) with `series.finalisedAt`, optional
 *  `series.protestTimeLimit` ({minutes, basis} from the SIs), and optional
 *  `races[*].lastFinisherTime` (manual last-finisher clock time for races with
 *  untimed finishes). All additive and sparse; older files load provisional
 *  with nothing tracked.
 *
 *  v21 replaces `competitors[*].crewName` (a single crew name) with
 *  `crewNames` (an ordered list, for keelboat crews of any size). The parser
 *  folds a legacy `crewName` into a one-element list on read.
 *
 *  v22 does the same for the remaining person fields: `name` → `names`
 *  (required, min one — co-owned/co-helmed entries), `owner` → `owners`,
 *  `helm` → `helms`. The parser folds the legacy singulars into one-element
 *  lists on read. Also adds optional `series.multiPersonFields` — the person
 *  fields whose entry affordances are opened to multiple names (gated by the
 *  `multi-person-fields` feature). Sparse; absent means all single.
 *
 *  v23 adds split-fleet series (#328): a top-level `splitFleets` block
 *  (config + assignment rounds), `races[*].stage` / `stageRaceNumber` /
 *  `firstPlaceOffset`, and `competitors[*].entryNumber` / `seed`. All sparse
 *  — absent on ordinary series.
 *
 *  v24 moves the split-fleet stage identity onto the starts (#346: a race is
 *  one start sequence; its starts may span stage race numbers):
 *  `races[*].starts[*].stage` / `stageRaceNumber` / `firstPlaceOffset`. The
 *  race-level v23 fields are still read — the parser copies them onto the
 *  race's starts when the starts don't carry their own.
 *
 *  v25 adds the per-race scoring options (#342): `races[*].discardPolicy`
 *  ('mustCount' / 'discardFirst') and `races[*].pointsMultiplier`. Both
 *  additive and sparse — written only when set, and absent means an ordinary
 *  discardable race counting once. The bump exists so a file carrying them
 *  fails loudly in a build that predates the engine support rather than
 *  loading a series whose standings would silently differ.
 *
 *  v26 adds `series.proportionalDiscard` (#341): a discard allowance stated as
 *  a proportion ("one discard for every three races sailed") in place of the
 *  threshold list. Additive and sparse — written only when set. The bump is for
 *  the same reason as v25: a build that predates the engine support must fail
 *  loudly rather than load the series and score it with the thresholds the rule
 *  replaced.
 *
 *  v27 adds the race record (#338/#339): `races[*].conditions` (wind range,
 *  direction, and a free-text course/tide note), `races[*].officials` and
 *  `series.officials` (race management teams at the two independent levels),
 *  and `series.publishOfficials`. All additive and sparse. The file carries
 *  the teams unconditionally, `publishOfficials` and all — round-tripping a
 *  series losslessly is what this format is for, and the publish decision
 *  travels with the data it governs. The public JSON export is where that
 *  decision is *applied*.
 *
 *  v28 adds `series.publishDetail` (#347): 'races' publishes the per-race
 *  tables alone — the single-race-event presentation. Additive and sparse,
 *  written only when set; older files load with it absent (full detail).
 *  Purely presentational, so a build that predates it loads the series and
 *  scores it identically — unlike v25/v26, nothing here can change a score.
 *
 *  v29 adds `competitors[*].worldSailingId` (#362): the primary sailor's World
 *  Sailing Sailor ID, the join key an organising authority's seed ranking is
 *  matched on. Additive and sparse. Nothing scores off it, so an older build
 *  reading a v29 file would lose only the identifier — the bump is so that
 *  loss is visible rather than silent, which is the whole reason this format
 *  is versioned.
 *
 *  v30 adds optional `series.publishingGroups[*].recentRaces` (#372): publish
 *  a combined page's per-race detail for the last N races only. Additive and
 *  sparse, and purely presentational — the standings a group publishes are
 *  the full series either way, so an older build reading a v30 file renders
 *  the same results with more race tables than the scorer asked for.
 *
 *  v31 adds optional `competitor.alternativeSailNumbers` (other sail numbers a
 *  boat may show, matched during finish entry) and replaces v19's
 *  `finish.matchedOnBowNumber` boolean with `finish.matchedOn` ('bow' |
 *  'alternative') plus `finish.enteredSailNumber` (the text that matched).
 *  The parser still reads the old boolean, folding true into `matchedOn:
 *  'bow'`, so v19–v30 files load unchanged; writers emit only the new fields.
 *  The bump exists because an older build reading a v31 file would drop the
 *  alternatives — losing which number a boat actually raced under.
 *
 *  v32 adds optional `series.publishingGroups[*].sectionAxisId` (#390): a page
 *  whose sections are one subdivision axis's values rather than its member
 *  fleets — per-division standings beside the overall ones. Additive, sparse
 *  and purely presentational: axis ids are stable across round-trips, and an
 *  older build reading a v32 file publishes the same page sectioned by fleet
 *  instead.
 *
 *  v33 adds four optional split-fleet config fields: `minimumRaces` and
 *  `stageNaming` (both superseded by v34), and on the medal block
 *  `carryTransform` (the compressed carry) and `tieBreak`.
 *  `splitFleets.config` travels verbatim, so no parser change — but an older
 *  build reading a v33 file would drop them, and dropping `carryTransform`
 *  silently re-scores the championship rather than mislabelling it, which is
 *  what the bump makes visible.
 *
 *  v34 drops v33's `minimumRaces` — the race committee declares a
 *  championship invalid, not the scoring software — and adds
 *  `medal.companionRace`, which says whether the boats who miss the medal
 *  fleet sail a race of their own scored below it or one more ordinary
 *  final-series race. It also replaces v33's `stageNaming` — three authored
 *  stage labels, three race prefixes and a numbering flag — with `vocabulary`, one
 *  choice between the tabulated wordings, plus an engine-only
 *  `vocabularyOverride` for anything they don't cover. v33's block is still
 *  read: `normalizeSplitFleetConfig` matches it against the table, and keeps
 *  hand-edited wording as an override. The bump is for the other direction —
 *  an older build reading v34 finds no `stageNaming` and falls back to the
 *  generic wording, silently relabelling a championship's every stage and
 *  race.
 *
 *  v35 adds `competitors[*].initialFleet` — the qualifying fleet a seeding
 *  committee assigned the boat to, imported on the entry list. Additive and
 *  sparse. An older build reading a v35 file would drop it, and with it the
 *  only record of why Round 1 was dealt the way it was: the assignment is a
 *  human judgment (equal size *and ability*), so nothing else in the file
 *  reconstructs it.
 *
 *  v36 adds `competitors[*].tallyNumber` — the safety tally token issued at
 *  registration. Additive and sparse. An older build reading a v36 file would
 *  drop it; nothing is scored from it, so the loss is of a roster detail
 *  rather than of anything that changes results.
 *
 *  v37 adds `finishes[*].penaltyLabel` — what a DPI was given for, in the
 *  scorer's own words. Additive and sparse, and a label only: the points come
 *  from `penaltyOverride`, so an older build reading a v37 file scores every
 *  race identically and loses only the reason shown beside the penalty. */
export const FORMAT_VERSION = 37;
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37];
export const FILE_EXTENSION = '.sailscoring';

// ---- File format types ----

// Split-fleet series (v23+): the series' scoring configuration and the
// assignment rounds (docs/design/split-fleets.md). `publishedAt` is
// workspace-local publishing state and is not carried.
export interface SeriesFileSplitRound {
  id: string;
  stage: 'qualifying' | 'final' | 'medal';
  fromStageRace: number;
  fleetIds: string[];
  method: string;
  basis?: { throughStageRace: number; capturedAt: number } | null;
  overrides?: Record<string, string>;
  createdAt: number;
}
export interface SeriesFileSplitFleets {
  config: import('./split-fleets').SplitFleetConfig;
  rounds: SeriesFileSplitRound[];
}

/** What a replay writes. A file carrying no split-fleet block replays as a
 *  null config with no rounds — i.e. it clears whatever the series had, which
 *  a plain `SeriesFileSplitFleets` can't express. */
export interface SeriesFileSplitFleetsWrite {
  config: import('./split-fleets').SplitFleetConfig | null;
  rounds: SeriesFileSplitRound[];
}


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
  proportionalDiscard?: ProportionalDiscard;  // v26+; replaces the thresholds when set
  dnfScoring: DnfScoring;
  raceFleetExclusions?: RaceFleetExclusion[];  // v14+; whole-series per-fleet race strikes
  ftpHost: string;
  ftpPath: string;
  ftpPaths?: Record<string, string>;  // v4+; absent in older files
  publishMode?: 'sailscoring' | 'ftp';  // additive; which Publish destination this series last used (absent = 'sailscoring')
  ftpLastUploadedAt?: number;  // additive; epoch ms of the last FTP upload
  ftpUploadedVersion?: number;  // additive; series version reflected by that upload
  // Bilge publishing state was removed in ADR-008 Phase 9. The field is no
  // longer written; older files that still carry it are simply ignored on read.
  includeJsonExport: boolean;
  enabledCompetitorFields: CompetitorFieldKey[];
  multiPersonFields?: MultiPersonFieldKey[];  // v22+; person fields opened to multiple names (sparse)
  primaryPersonLabel?: PrimaryPersonLabel;  // v2+; absent in v1 files, defaults to 'competitor'
  subdivisionAxes?: SubdivisionAxis[];  // v13+; named subdivision axes
  subdivisionLabel?: string;  // v6–v12 (read-only legacy): single axis label, upgraded to subdivisionAxes on load
  scoringMode: 'scratch' | 'handicap';
  defaultStartSequence?: StartGroup[];
  publishRatingCalculations?: boolean;
  showPerRaceRatingsInSummary?: boolean;
  publishingGroups?: PublishingGroup[];  // v15+; extra published pages (v30+ carries recentRaces, v32+ sectionAxisId)
  publishIndividualFleetPages?: boolean;  // v15+; absent = true
  publishDetail?: 'races';  // v28+; written only when set; absent = full detail
  rrsOrgPush?: RrsOrgPushConfig;  // v16+; rrs.org competitor-push settings
  prizes?: Prize[];  // v17+; prize list (#240)
  resultsStatus?: 'provisional' | 'final';  // v20+; written only when final
  finalisedAt?: number;  // v20+; epoch ms when marked final
  protestTimeLimit?: ProtestTimeLimit;  // v20+; SI time-limit config
  officials?: RaceOfficial[];  // v27+; the standing race management team
  publishOfficials?: boolean;  // v27+; absent = not published
}

interface SeriesFileCompetitor {
  id: string;
  fleetIds: string[];
  sailNumber: string;
  bowNumber?: string;  // v19+
  alternativeSailNumbers?: string[];  // v31+
  entryNumber?: string;  // v23+; OA registration number (split-fleet events)
  tallyNumber?: string;  // v36+; safety tally token issued at registration
  seed?: number;  // v23+; OA seeding rank
  initialFleet?: string;  // v35+; the qualifying fleet the seeding committee assigned
  worldSailingId?: string;  // v29+; World Sailing Sailor ID of the primary sailor
  boatName?: string;
  boatClass?: string;
  names: string[];    // v22+; primary person(s), min one
  name?: string;      // ≤v21 legacy single primary; the parser folds it into `names`
  owners?: string[];  // v22+
  owner?: string;     // v2–v21 legacy; folds into `owners`
  helms?: string[];   // v22+
  helm?: string;      // v2–v21 legacy; folds into `helms`
  crewNames?: string[];  // v21+; ordered crew list
  crewName?: string;     // ≤v20 legacy single crew; the parser folds it into `crewNames`
  club: string;
  nationality?: string;  // v5+
  gender: 'M' | 'F' | '';
  age: number | null;
  subdivisions?: Record<string, string>;  // v13+; per-axis values keyed by SubdivisionAxis.id
  subdivision?: string;  // v6–v12 (read-only legacy): single subdivision value, upgraded into subdivisions on load
  ircTcc?: number;
  vprsTcc?: number;
  pyNumber?: number;
  nhcStartingTcf?: number;
  echoStartingTcf?: number;
}

/** v19–v30 recorded only "this row was entered by bow number"; v31 records
 *  which identifier matched. Fold the old boolean forward on read. */
function fileFinishMatchedOn(f: SeriesFileFinish): 'bow' | 'alternative' | undefined {
  return f.matchedOn ?? (f.matchedOnBowNumber ? 'bow' : undefined);
}

interface SeriesFileFinish {
  id: string;
  competitorId: string | null;
  unknownSailNumber?: string;
  /** v19–v30; read for back-compat, folded into `matchedOn`. Never written. */
  matchedOnBowNumber?: boolean;
  matchedOn?: 'bow' | 'alternative';  // v31+
  enteredSailNumber?: string;  // v31+
  sortOrder: number | null;
  /** Optional in the file format — older files default to `false` on import. */
  tiedWithPrevious?: boolean;
  finishTime?: string;
  resultCode: ResultCode | null;
  startPresent: boolean | null;
  penaltyCode: PenaltyCode | null;
  penaltyOverride: number | null;
  penaltyOverrideByFleet?: Record<string, number>;
  penaltyLabel?: string;  // v37+; scorer's label for a DPI
  redressMethod?: 'all_races' | 'all_races_excl_dnc' | 'races_before' | 'stated';
  redressExcludeRaces?: number[];
  redressIncludeRaces?: number[];
  redressIncludeAllLater?: boolean;
  redressPoints?: number;
  redressPointsByFleet?: Record<string, number>;
}

interface SeriesFileRaceStart {
  id: string;
  fleetIds: string[];
  startTime?: string;  // absent for a membership-only start (fleets, no gun time)
  stage?: 'qualifying' | 'final' | 'medal';  // v24+; split-fleet stage, per start
  stageRaceNumber?: number;  // v24+; logical race number this start's fleets sail
  firstPlaceOffset?: number;  // v24+; companion race: first finisher scores offset + 1
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
  name?: string | null; // optional label; absent in files written before v10
  date: string;
  lastFinisherTime?: string;  // v20+; manual last-finisher clock time
  // v25+; per-race scoring options, absent on an ordinary race.
  discardPolicy?: RaceDiscardPolicy;
  pointsMultiplier?: number;
  // v27+; what the race was sailed in, and who ran it. Both sparse.
  conditions?: RaceConditions;
  officials?: RaceOfficial[];
  /** @deprecated v23 split-fleet stage identity on the race; v24 carries it
   *  per start. Read for back-compat (copied onto the starts), not written. */
  stage?: 'qualifying' | 'final' | 'medal';
  /** @deprecated see `stage`. */
  stageRaceNumber?: number;
  /** @deprecated see `stage`. */
  firstPlaceOffset?: number;
  /** @deprecated pre-reshape v9 partition membership; read for back-compat,
   *  no longer written (membership now lives in `subSeries[*].raceIds`). */
  subSeriesId?: string;
  starts: SeriesFileRaceStart[];
  finishes: SeriesFileFinish[];
  ratingOverrides?: SeriesFileRatingOverride[]; // additive; absent in older files
}

interface SeriesFileSubSeries {
  id: string;
  name: string;
  displayOrder: number;
  // Race membership. New shape; absent on pre-reshape v9 files, where it is
  // derived from `races[*].subSeriesId` on load.
  raceIds?: string[];
  // v11: fleet scoping (absent = all fleets) and per-fleet race exclusions.
  fleetIds?: string[];
  raceFleetExclusions?: { raceId: string; fleetId: string }[];
  startingHandicapSource?: 'base' | 'continue';
  continueFromSubSeriesId?: string;
  // v12: rank only boats that took part in the sub-series (absent = false).
  excludeDncOnlyCompetitors?: boolean;
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
  /** Sub-series (v9+): named blocks of races, each scored independently.
   *  Absent or empty when the series has none. */
  subSeries?: SeriesFileSubSeries[];
  splitFleets?: SeriesFileSplitFleets;  // v23+; split-fleet config + rounds
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
    subSeries,
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
    undefined,
    buildRaceFleetExclusionMap(series.raceFleetExclusions),
    series.proportionalDiscard,
  );
  const allTcfHistory: TcfRecord[] = fleetStandings.flatMap(
    (fr) => fr.tcfHistory ?? [],
  );

  // Redress race references are stored internally by race id but written to
  // the file positionally (by race number), so files stay portable and
  // human-readable. Translate id → number on the way out.
  const raceNumberById = new Map(races.map((r) => [r.id, r.raceNumber]));
  const toRaceNumbers = (ids: string[] | null | undefined): number[] =>
    (ids ?? []).map((id) => raceNumberById.get(id)).filter((n): n is number => n != null);

  const finishesByRace = new Map<string, SeriesFileFinish[]>();
  for (const f of allFinishes) {
    if (!finishesByRace.has(f.raceId)) finishesByRace.set(f.raceId, []);
    const excludeNumbers = toRaceNumbers(f.redressExcludeRaceIds);
    const includeNumbers = toRaceNumbers(f.redressIncludeRaceIds);
    finishesByRace.get(f.raceId)!.push({
      id: f.id,
      competitorId: f.competitorId,
      unknownSailNumber: f.unknownSailNumber,
      ...(f.matchedOn ? { matchedOn: f.matchedOn } : {}),
      ...(f.enteredSailNumber ? { enteredSailNumber: f.enteredSailNumber } : {}),
      sortOrder: f.sortOrder,
      ...(f.tiedWithPrevious ? { tiedWithPrevious: true } : {}),
      ...(f.finishTime ? { finishTime: f.finishTime } : {}),
      resultCode: f.resultCode,
      startPresent: f.startPresent,
      penaltyCode: f.penaltyCode ?? null,
      penaltyOverride: f.penaltyOverride ?? null,
      ...(f.penaltyOverrideByFleet && Object.keys(f.penaltyOverrideByFleet).length ? { penaltyOverrideByFleet: f.penaltyOverrideByFleet } : {}),
      ...(f.penaltyLabel ? { penaltyLabel: f.penaltyLabel } : {}),
      ...(f.redressMethod ? { redressMethod: f.redressMethod } : {}),
      ...(excludeNumbers.length ? { redressExcludeRaces: excludeNumbers } : {}),
      ...(includeNumbers.length ? { redressIncludeRaces: includeNumbers } : {}),
      ...(f.redressIncludeAllLater ? { redressIncludeAllLater: f.redressIncludeAllLater } : {}),
      ...(f.redressPoints != null ? { redressPoints: f.redressPoints } : {}),
      ...(f.redressPointsByFleet && Object.keys(f.redressPointsByFleet).length ? { redressPointsByFleet: f.redressPointsByFleet } : {}),
    });
  }

  const startsByRace = new Map<string, SeriesFileRaceStart[]>();
  for (const s of allRaceStarts) {
    if (!startsByRace.has(s.raceId)) startsByRace.set(s.raceId, []);
    startsByRace.get(s.raceId)!.push({
      id: s.id,
      fleetIds: s.fleetIds,
      startTime: s.startTime,
      ...(s.stage ? { stage: s.stage } : {}),
      ...(s.stageRaceNumber != null ? { stageRaceNumber: s.stageRaceNumber } : {}),
      ...(s.firstPlaceOffset != null ? { firstPlaceOffset: s.firstPlaceOffset } : {}),
    });
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
      ...(series.proportionalDiscard ? { proportionalDiscard: series.proportionalDiscard } : {}),
      dnfScoring: series.dnfScoring,
      ...(series.raceFleetExclusions && series.raceFleetExclusions.length > 0
        ? { raceFleetExclusions: series.raceFleetExclusions }
        : {}),
      ftpHost: series.ftpHost ?? '',
      ftpPath: series.ftpPath ?? '',
      ...(series.ftpPaths && Object.keys(series.ftpPaths).length > 0
        ? { ftpPaths: series.ftpPaths }
        : {}),
      ...(series.publishMode ? { publishMode: series.publishMode } : {}),
      ...(series.ftpLastUploadedAt != null ? { ftpLastUploadedAt: series.ftpLastUploadedAt } : {}),
      ...(series.ftpUploadedVersion != null ? { ftpUploadedVersion: series.ftpUploadedVersion } : {}),
      includeJsonExport: series.includeJsonExport ?? true,
      enabledCompetitorFields: series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
      ...(series.multiPersonFields?.length ? { multiPersonFields: series.multiPersonFields } : {}),
      primaryPersonLabel: series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
      subdivisionAxes: series.subdivisionAxes ?? [],
      scoringMode: series.scoringMode ?? 'scratch',
      ...(series.defaultStartSequence?.length ? { defaultStartSequence: series.defaultStartSequence } : {}),
      ...(series.publishRatingCalculations != null ? { publishRatingCalculations: series.publishRatingCalculations } : {}),
      ...(series.showPerRaceRatingsInSummary != null ? { showPerRaceRatingsInSummary: series.showPerRaceRatingsInSummary } : {}),
      ...(series.publishingGroups && series.publishingGroups.length > 0
        ? { publishingGroups: series.publishingGroups }
        : {}),
      ...(series.publishIndividualFleetPages === false
        ? { publishIndividualFleetPages: false }
        : {}),
      ...(series.publishDetail === 'races' ? { publishDetail: 'races' as const } : {}),
      ...(series.rrsOrgPush ? { rrsOrgPush: series.rrsOrgPush } : {}),
      ...(series.prizes && series.prizes.length > 0 ? { prizes: series.prizes } : {}),
      ...(series.resultsStatus === 'final' ? { resultsStatus: 'final' as const } : {}),
      ...(series.finalisedAt != null ? { finalisedAt: series.finalisedAt } : {}),
      ...(series.protestTimeLimit ? { protestTimeLimit: series.protestTimeLimit } : {}),
      ...(series.officials?.length ? { officials: series.officials } : {}),
      ...(series.publishOfficials ? { publishOfficials: true } : {}),
    },
    competitors: competitors.map((c) => ({
      id: c.id,
      fleetIds: c.fleetIds,
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
      ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
      ...(c.vprsTcc != null ? { vprsTcc: c.vprsTcc } : {}),
      ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
      ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
      ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
    })),
    races: races.map((r) => ({
      id: r.id,
      raceNumber: r.raceNumber,
      ...(r.name ? { name: r.name } : {}),
      date: r.date,
      ...(r.lastFinisherTime ? { lastFinisherTime: r.lastFinisherTime } : {}),
      ...(r.discardPolicy && r.discardPolicy !== 'normal' ? { discardPolicy: r.discardPolicy } : {}),
      ...(r.pointsMultiplier != null && r.pointsMultiplier !== 1 ? { pointsMultiplier: r.pointsMultiplier } : {}),
      ...(hasConditions(r.conditions) ? { conditions: r.conditions } : {}),
      ...(r.officials?.length ? { officials: r.officials } : {}),
      starts: startsByRace.get(r.id) ?? [],
      finishes: finishesByRace.get(r.id) ?? [],
      ...(overridesByRace.get(r.id)?.length ? { ratingOverrides: overridesByRace.get(r.id) } : {}),
    })),
    ...(subSeries.length > 0
      ? {
          subSeries: subSeries.map((ss) => ({
            id: ss.id,
            name: ss.name,
            displayOrder: ss.displayOrder,
            raceIds: ss.raceIds,
            ...(ss.fleetIds ? { fleetIds: ss.fleetIds } : {}),
            ...(ss.raceFleetExclusions && ss.raceFleetExclusions.length > 0
              ? { raceFleetExclusions: ss.raceFleetExclusions }
              : {}),
            ...(ss.startingHandicapSource && ss.startingHandicapSource !== 'base'
              ? { startingHandicapSource: ss.startingHandicapSource }
              : {}),
            ...(ss.continueFromSubSeriesId
              ? { continueFromSubSeriesId: ss.continueFromSubSeriesId }
              : {}),
            ...(ss.excludeDncOnlyCompetitors
              ? { excludeDncOnlyCompetitors: true }
              : {}),
          })),
        }
      : {}),
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

  if (repos.splitFleets) {
    const sf = await repos.splitFleets.get(seriesId);
    if (sf) file.splitFleets = sf;
  }

  return file;
}

export async function saveSeriesFile(
  seriesId: string,
  repos: SeriesFileRepos,
  opts?: {
    /** Skip the post-download bookkeeping writes (`lastSavedAt` + the saved
     *  milestone) — for callers whose workspace role can't write them. The
     *  download itself is a pure read available to every role. */
    recordSave?: boolean;
  },
): Promise<void> {
  const file = await buildSeriesFile(seriesId, repos);
  const series = await repos.seriesRepo.get(seriesId);
  if (!series) throw new Error(`Series ${seriesId} not found`);

  // Embed the revision history (#166), so the file is a complete, restorable
  // backup: readable metadata + one compressed snapshot blob. Implementations
  // without revision support omit it.
  if (repos.exportRevisions) {
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
  a.download = seriesSlug(series.name) + FILE_EXTENSION;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // The download above is a pure read. An archived series is read-only
  // (#154), so we stop here: recording the save would write file-tracking
  // fields back through the API and hit the read-only guard (423). Archived
  // series intentionally don't accrue file-lineage updates. Callers without
  // write permission opt out the same way (recordSave: false).
  if (series.archived || opts?.recordSave === false) return;

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
  if (obj.subSeries !== undefined && !Array.isArray(obj.subSeries))
    throw new Error('Invalid file: subSeries must be a list');

  migrateSeriesFileObject(obj);

  return data as SeriesFile;
}

/**
 * Bring a parsed series-file object up to the current format version, mutating
 * in place. Split out of `parseSeriesFile` because not every consumer arrives
 * via a file: revision snapshots are stored as raw JSON at the format version
 * current when they were captured, and replaying one without migrating it
 * feeds the writers fields that were renamed since (v22's `name` → `names`),
 * which the schema then rejects.
 */
export function migrateSeriesFileObject(obj: Record<string, unknown>): void {
  if (typeof obj.formatVersion !== 'number') return;
  if (obj.formatVersion < 3) migrateStartSequenceCumulativeToIntervals(obj.series);
  if (obj.formatVersion < 4 && obj.nhcTcfHistory !== undefined && obj.tcfHistory === undefined) {
    obj.tcfHistory = obj.nhcTcfHistory;
  }
  if (obj.formatVersion < 21) migrateCrewNameToList(obj.competitors);
  if (obj.formatVersion < 22) migratePersonFieldsToLists(obj.competitors);
}

/** ≤v20 → v21: a single `crewName` becomes a one-element `crewNames` list.
 *  Mutates in place. */
function migrateCrewNameToList(competitors: unknown): void {
  if (!Array.isArray(competitors)) return;
  for (const c of competitors as { crewName?: unknown; crewNames?: string[] }[]) {
    if (typeof c !== 'object' || c === null) continue;
    if (c.crewNames === undefined && typeof c.crewName === 'string' && c.crewName.trim()) {
      c.crewNames = [c.crewName.trim()];
    }
    delete c.crewName;
  }
}

/** ≤v21 → v22: the single `name`/`owner`/`helm` person fields become
 *  one-element lists (`names` is required and keeps an empty name as ['']).
 *  Mutates in place. */
function migratePersonFieldsToLists(competitors: unknown): void {
  if (!Array.isArray(competitors)) return;
  for (const c of competitors as {
    name?: unknown; names?: string[];
    owner?: unknown; owners?: string[];
    helm?: unknown; helms?: string[];
  }[]) {
    if (typeof c !== 'object' || c === null) continue;
    if (c.names === undefined) {
      c.names = [typeof c.name === 'string' ? c.name : ''];
    }
    delete c.name;
    if (c.owners === undefined && typeof c.owner === 'string' && c.owner.trim()) {
      c.owners = [c.owner.trim()];
    }
    delete c.owner;
    if (c.helms === undefined && typeof c.helm === 'string' && c.helm.trim()) {
      c.helms = [c.helm.trim()];
    }
    delete c.helm;
  }
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

/** Rewrite a per-fleet point map (per-fleet RDG / DPI, keyed by fleetId)
 *  through a fleet-id remap. Like every other fleet reference, the keys must
 *  follow the freshly minted ids; entries for fleets dropped from the remap
 *  are removed (the engine then treats that fleet as a gap). */
function remapPerFleetPoints(
  byFleet: Record<string, number> | undefined,
  fleetIdMap: Map<string, string>,
): Record<string, number> | undefined {
  if (!byFleet) return undefined;
  const out: Record<string, number> = {};
  for (const [oldId, value] of Object.entries(byFleet)) {
    const newId = fleetIdMap.get(oldId);
    if (newId) out[newId] = value;
  }
  return Object.keys(out).length ? out : undefined;
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

/** Rewrite publishing groups' member-fleet ids through a fleet-id remap.
 *  Unmapped ids are dropped; the group itself is kept even when a 'chosen'
 *  group loses every member — the scorer's configured page stays visible in
 *  the editor to fix, rather than silently disappearing. Group ids are
 *  embedded config (like subdivision-axis ids) and carry over verbatim. */
function remapPublishingGroups(
  groups: PublishingGroup[] | undefined,
  fleetIdMap: Map<string, string>,
): PublishingGroup[] {
  if (!groups) return [];
  return groups.map((g) => ({
    ...g,
    fleetIds: g.fleetIds
      .map((id) => fleetIdMap.get(id))
      .filter((id): id is string => !!id),
  }));
}

/** Re-key fleet references inside prize clauses onto the freshly-minted fleet
 *  ids. A prize whose fleet clause can't resolve is dropped whole — silently
 *  removing the clause would *widen* its eligibility, which is worse than
 *  losing the prize (the scorer re-adds it in the editor). Axis ids are stable
 *  across round-trips, so axis clauses travel verbatim. */
function remapPrizes(
  prizes: Prize[] | undefined,
  fleetIdMap: Map<string, string>,
): Prize[] {
  if (!prizes) return [];
  const out: Prize[] = [];
  for (const prize of prizes) {
    const clauses: Prize['clauses'] = [];
    let dropped = false;
    for (const clause of prize.clauses) {
      if (clause.kind !== 'fleet') {
        clauses.push(clause);
        continue;
      }
      const newId = fleetIdMap.get(clause.fleetId);
      if (!newId) {
        dropped = true;
        break;
      }
      clauses.push({ ...clause, fleetId: newId });
    }
    if (!dropped) out.push({ ...prize, clauses });
  }
  return out;
}

/** Rewrite whole-series per-fleet race exclusions through the id remaps applied
 *  on import. Both the race and the fleet get fresh ids, so an unmapped
 *  reference (a race or fleet dropped from the file) means the strike no longer
 *  applies and the entry is dropped — the same drop-on-missing rule the start
 *  sequence and ftpPaths remaps follow. */
function remapRaceFleetExclusions(
  exclusions: RaceFleetExclusion[] | undefined,
  raceIdMap: Map<string, string>,
  fleetIdMap: Map<string, string>,
): RaceFleetExclusion[] {
  if (!exclusions) return [];
  return exclusions
    .map((ex) => ({ raceId: raceIdMap.get(ex.raceId), fleetId: fleetIdMap.get(ex.fleetId) }))
    .filter((ex): ex is RaceFleetExclusion => !!ex.raceId && !!ex.fleetId);
}

/**
 * Resolve the subdivision axes for a file on read, upgrading legacy single-axis
 * files (v6–v12) to the multi-axis shape. v13+ files carry
 * `subdivisionAxes` directly; older files synthesise one axis from
 * `subdivisionLabel` and report its id so each competitor's legacy `subdivision`
 * value can be keyed onto it. `legacyAxisId` is null for v13+ files (their
 * competitors already carry `subdivisions`).
 */
function resolveFileSubdivisions(file: SeriesFile): {
  axes: SubdivisionAxis[];
  legacyAxisId: string | null;
} {
  if (file.series.subdivisionAxes !== undefined) {
    return { axes: file.series.subdivisionAxes, legacyAxisId: null };
  }
  const hasAnyValue = file.competitors.some((c) => c.subdivision?.trim());
  const fieldEnabled = file.series.enabledCompetitorFields?.includes('subdivision') ?? false;
  const { axes, axisId } = upgradeSubdivisionAxes({
    legacyLabel: file.series.subdivisionLabel,
    fieldEnabled,
    hasAnyValue,
  });
  return { axes, legacyAxisId: axisId };
}

/** A competitor's `subdivisions` map for the write path: the v13 map verbatim,
 *  or a legacy value keyed onto the synthesised axis. Empty (undefined) when the
 *  competitor carries no value. */
function competitorSubdivisionsForWrite(
  c: SeriesFileCompetitor,
  legacyAxisId: string | null,
): Record<string, string> | undefined {
  if (c.subdivisions && Object.keys(c.subdivisions).length > 0) return c.subdivisions;
  if (legacyAxisId && c.subdivision?.trim()) return { [legacyAxisId]: c.subdivision };
  return undefined;
}

// ---- Open as new series ----

export async function openSeriesFromFile(
  file: SeriesFile,
  repos: SeriesFileRepos,
  opts?: {
    categoryId?: string | null;
    source?: Series['source'];
    /**
     * Create under this id instead of a fresh one. For a caller that owns the
     * identity — an archive repo whose ids are derived from stable keys, so a
     * re-run replays over the same series rather than adding another copy. The
     * name is then kept verbatim too: disambiguating it would rename the series
     * on every re-import, which is the churn the pinned id exists to avoid.
     */
    seriesId?: string;
  },
): Promise<string> {
  const newSeriesId = opts?.seriesId ?? crypto.randomUUID();
  const now = Date.now();
  const name = opts?.seriesId
    ? file.series.name
    : disambiguateSeriesName(file.series.name, await repos.listSeriesNames());

  // Remap IDs to avoid conflicts with existing DB records.
  const fleetIdMap = new Map(file.fleets.map((f) => [f.id, crypto.randomUUID()]));
  const competitorIdMap = new Map(file.competitors.map((c) => [c.id, crypto.randomUUID()]));
  const raceIdMap = new Map(file.races.map((r) => [r.id, crypto.randomUUID()]));

  // Resolve subdivision axes once: legacy files synthesise an axis with a fresh
  // random id, so the series and the competitors must share this single result.
  const subdivisions = resolveFileSubdivisions(file);

  // Series first (FK target for everything below). No expectedVersion —
  // fresh row, authoritative write per `SaveOpts` doc-comment.
  // `categoryId` isn't carried in the file format (it's workspace-local), so it
  // defaults to null unless the caller picks one in the import dialog (#154).
  // `archived` is likewise absent — a freshly opened file always lands active.
  // `previousSeriesId` (follow-on lineage) is workspace-local too and stays
  // out of the file; an opened file has no predecessor in this workspace.
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
    proportionalDiscard: file.series.proportionalDiscard,
    dnfScoring: file.series.dnfScoring,
    raceFleetExclusions: remapRaceFleetExclusions(file.series.raceFleetExclusions, raceIdMap, fleetIdMap),
    ftpHost: file.series.ftpHost,
    ftpPath: file.series.ftpPath,
    ftpPaths: remapFtpPaths(file.series.ftpPaths, fleetIdMap),
    publishMode: file.series.publishMode,
    ftpLastUploadedAt: file.series.ftpLastUploadedAt,
    ftpUploadedVersion: file.series.ftpUploadedVersion,
    includeJsonExport: file.series.includeJsonExport,
    publishRatingCalculations: file.series.publishRatingCalculations ?? true,
    showPerRaceRatingsInSummary: file.series.showPerRaceRatingsInSummary ?? true,
    publishingGroups: remapPublishingGroups(file.series.publishingGroups, fleetIdMap),
    publishIndividualFleetPages: file.series.publishIndividualFleetPages ?? true,
    publishDetail: file.series.publishDetail ?? 'full',
    rrsOrgPush: file.series.rrsOrgPush,
    prizes: remapPrizes(file.series.prizes, fleetIdMap),
    resultsStatus: file.series.resultsStatus,
    finalisedAt: file.series.finalisedAt,
    protestTimeLimit: file.series.protestTimeLimit,
    officials: file.series.officials,
    publishOfficials: file.series.publishOfficials,
    enabledCompetitorFields: file.series.enabledCompetitorFields,
    ...(file.series.multiPersonFields?.length ? { multiPersonFields: file.series.multiPersonFields } : {}),
    primaryPersonLabel: file.series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
    subdivisionAxes: subdivisions.axes,
    categoryId: opts?.categoryId ?? null,
    // Provenance is caller-supplied, not carried in the file: the Sailwave
    // wizard passes 'sailwave'; a .sailscoring open leaves it unset.
    source: opts?.source,
  });

  await writeFleetsCompetitorsRaces(repos, file, newSeriesId, now, fleetIdMap, competitorIdMap, raceIdMap, subdivisions.legacyAxisId);

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

// ---- Restore a soft-deleted series from its tombstone snapshot ----

/**
 * Re-create a deleted series from its tombstone snapshot ("Recover a deleted
 * series"). Unlike {@link openSeriesFromFile}, this is a *restore*, not an
 * import: the series comes back under its **original** `series_id` (so its
 * identity is stable) and keeps its name verbatim — no fresh id, no name
 * disambiguation. It lands `archived` (delete is archive-gated, so the series
 * was archived when it was trashed) and uncategorised (`categoryId` and
 * `source` are workspace-local, not carried in the file, so they reset).
 *
 * The live rows were hard-deleted when the series was trashed, so the series
 * `save` here is a plain insert; ids carried in the snapshot are remapped to
 * fresh ones exactly as on import.
 */
export async function restoreSeriesFromFile(
  seriesId: string,
  file: SeriesFile,
  repos: SeriesFileRepos,
): Promise<void> {
  const now = Date.now();

  const fleetIdMap = new Map(file.fleets.map((f) => [f.id, crypto.randomUUID()]));
  const competitorIdMap = new Map(file.competitors.map((c) => [c.id, crypto.randomUUID()]));
  const raceIdMap = new Map(file.races.map((r) => [r.id, crypto.randomUUID()]));

  // Resolve subdivision axes once so the series and its competitors share the
  // same (possibly synthesised) axis id — see openSeriesFromFile.
  const subdivisions = resolveFileSubdivisions(file);

  await repos.seriesRepo.save({
    id: seriesId,
    name: file.series.name,
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
    proportionalDiscard: file.series.proportionalDiscard,
    dnfScoring: file.series.dnfScoring,
    raceFleetExclusions: remapRaceFleetExclusions(file.series.raceFleetExclusions, raceIdMap, fleetIdMap),
    ftpHost: file.series.ftpHost,
    ftpPath: file.series.ftpPath,
    ftpPaths: remapFtpPaths(file.series.ftpPaths, fleetIdMap),
    publishMode: file.series.publishMode,
    ftpLastUploadedAt: file.series.ftpLastUploadedAt,
    ftpUploadedVersion: file.series.ftpUploadedVersion,
    includeJsonExport: file.series.includeJsonExport,
    publishRatingCalculations: file.series.publishRatingCalculations ?? true,
    showPerRaceRatingsInSummary: file.series.showPerRaceRatingsInSummary ?? true,
    publishingGroups: remapPublishingGroups(file.series.publishingGroups, fleetIdMap),
    publishIndividualFleetPages: file.series.publishIndividualFleetPages ?? true,
    publishDetail: file.series.publishDetail ?? 'full',
    rrsOrgPush: file.series.rrsOrgPush,
    prizes: remapPrizes(file.series.prizes, fleetIdMap),
    resultsStatus: file.series.resultsStatus,
    finalisedAt: file.series.finalisedAt,
    protestTimeLimit: file.series.protestTimeLimit,
    officials: file.series.officials,
    publishOfficials: file.series.publishOfficials,
    enabledCompetitorFields: file.series.enabledCompetitorFields,
    ...(file.series.multiPersonFields?.length ? { multiPersonFields: file.series.multiPersonFields } : {}),
    primaryPersonLabel: file.series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
    subdivisionAxes: subdivisions.axes,
    categoryId: null,
    archived: true,
  });

  await writeFleetsCompetitorsRaces(repos, file, seriesId, now, fleetIdMap, competitorIdMap, raceIdMap, subdivisions.legacyAxisId);

  // Bring the revision history back with the series, if the snapshot carries it.
  if (file.revisions?.length && file.revisionSnapshots && repos.importRevisions) {
    await repos.importRevisions(seriesId, {
      revisions: file.revisions,
      revisionSnapshots: file.revisionSnapshots,
    });
  }
}

// ---- Update existing series from file ----

export async function updateSeriesFromFile(
  seriesId: string,
  file: SeriesFile,
  repos: SeriesFileRepos,
): Promise<void> {
  return replayAtomically(repos, (r) => updateSeriesFromFileInner(seriesId, file, r));
}

/** Run a destructive replay inside a transaction where the repositories offer
 *  one, so a failure part-way through rolls the delete back instead of
 *  stranding the series with no children. */
function replayAtomically<T>(
  repos: SeriesFileRepos,
  fn: (repos: SeriesFileRepos) => Promise<T>,
): Promise<T> {
  return repos.runInTransaction ? repos.runInTransaction(fn) : fn(repos);
}

async function updateSeriesFromFileInner(
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

  // Resolve subdivision axes once so the series and its competitors share the
  // same (possibly synthesised) axis id — see openSeriesFromFile.
  const subdivisions = resolveFileSubdivisions(file);

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
    proportionalDiscard: file.series.proportionalDiscard,
    dnfScoring: file.series.dnfScoring,
    raceFleetExclusions: remapRaceFleetExclusions(file.series.raceFleetExclusions, raceIdMap, fleetIdMap),
    ftpHost: file.series.ftpHost,
    ftpPath: file.series.ftpPath,
    ftpPaths: remapFtpPaths(file.series.ftpPaths, fleetIdMap),
    publishMode: file.series.publishMode,
    ftpLastUploadedAt: file.series.ftpLastUploadedAt,
    ftpUploadedVersion: file.series.ftpUploadedVersion,
    includeJsonExport: file.series.includeJsonExport,
    publishRatingCalculations: file.series.publishRatingCalculations ?? true,
    showPerRaceRatingsInSummary: file.series.showPerRaceRatingsInSummary ?? true,
    publishingGroups: remapPublishingGroups(file.series.publishingGroups, fleetIdMap),
    publishIndividualFleetPages: file.series.publishIndividualFleetPages ?? true,
    publishDetail: file.series.publishDetail ?? 'full',
    rrsOrgPush: file.series.rrsOrgPush,
    prizes: remapPrizes(file.series.prizes, fleetIdMap),
    resultsStatus: file.series.resultsStatus,
    finalisedAt: file.series.finalisedAt,
    protestTimeLimit: file.series.protestTimeLimit,
    officials: file.series.officials,
    publishOfficials: file.series.publishOfficials,
    enabledCompetitorFields: file.series.enabledCompetitorFields,
    ...(file.series.multiPersonFields?.length ? { multiPersonFields: file.series.multiPersonFields } : {}),
    primaryPersonLabel: file.series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
    subdivisionAxes: subdivisions.axes,
  });

  await writeFleetsCompetitorsRaces(repos, file, seriesId, now, fleetIdMap, competitorIdMap, raceIdMap, subdivisions.legacyAxisId, true);
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

/** Re-key the saved publishing groups' member fleets onto the freshly-imported
 *  fleets, over the same name bridge as {@link remapFtpPathsByFleetName}:
 *  current id → name → new id. A member fleet renamed in Sailwave between
 *  exports drops out of its group (the scorer re-adds it in the editor);
 *  'all'-mode groups carry no ids and are untouched. */
function remapPublishingGroupsByFleetName(
  groups: PublishingGroup[] | undefined,
  currentFleets: Fleet[],
  file: SeriesFile,
  fleetIdMap: Map<string, string>,
): PublishingGroup[] {
  if (!groups) return [];
  const nameByCurrentId = new Map(currentFleets.map((f) => [f.id, f.name]));
  const newIdByName = new Map<string, string>();
  for (const f of file.fleets) {
    const newId = fleetIdMap.get(f.id);
    if (newId) newIdByName.set(f.name, newId);
  }
  return groups.map((g) => ({
    ...g,
    fleetIds: g.fleetIds
      .map((oldId) => {
        const name = nameByCurrentId.get(oldId);
        return name != null ? newIdByName.get(name) : undefined;
      })
      .filter((id): id is string => !!id),
  }));
}

/** Re-key the saved prizes' fleet clauses onto the freshly-imported fleets,
 *  over the same name bridge as {@link remapPublishingGroupsByFleetName}. A
 *  prize whose fleet was renamed in Sailwave between exports is dropped whole
 *  — see {@link remapPrizes} for why a widened predicate would be worse. */
function remapPrizesByFleetName(
  prizes: Prize[] | undefined,
  currentFleets: Fleet[],
  file: SeriesFile,
  fleetIdMap: Map<string, string>,
): Prize[] {
  if (!prizes) return [];
  const nameByCurrentId = new Map(currentFleets.map((f) => [f.id, f.name]));
  const newIdByName = new Map<string, string>();
  for (const f of file.fleets) {
    const newId = fleetIdMap.get(f.id);
    if (newId) newIdByName.set(f.name, newId);
  }
  const bridge = new Map<string, string>();
  for (const [oldId, name] of nameByCurrentId) {
    const newId = newIdByName.get(name);
    if (newId) bridge.set(oldId, newId);
  }
  return remapPrizes(prizes, bridge);
}

/**
 * Replace a Sailwave-born series' competition data in place from a freshly
 * re-imported Sailwave file, **preserving the scorer's series identity and
 * publishing setup**. Only offered for series with `source === 'sailwave'`.
 *
 * Retained from the existing series (`...current`): name, venue, logos/links,
 * FTP destination + per-fleet paths, publish toggles, competitor-field
 * config, primary-person label, subdivision axes, category, archived, and
 * `source` itself. Prizes are retained too when the series has any; a series
 * with none adopts the file's.
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
  return replayAtomically(repos, (r) => updateSeriesFromSailwaveInner(seriesId, file, r));
}

async function updateSeriesFromSailwaveInner(
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
  const publishingGroups = remapPublishingGroupsByFleetName(current.publishingGroups, currentFleets, file, fleetIdMap);
  // In-app-edited prizes win on a re-import; a series that has none yet adopts
  // the file's (first re-import of a prize-carrying .blw).
  const prizes = current.prizes?.length
    ? remapPrizesByFleetName(current.prizes, currentFleets, file, fleetIdMap)
    : remapPrizes(file.series.prizes, fleetIdMap);

  await repos.deleteSeriesChildren(seriesId);

  // Authoritative file-replay write — no `expectedVersion`. The user has
  // already confirmed the destructive-replace dialog.
  await repos.seriesRepo.save({
    ...current,
    discardThresholds: file.series.discardThresholds,
    proportionalDiscard: file.series.proportionalDiscard,
    dnfScoring: file.series.dnfScoring,
    raceFleetExclusions: remapRaceFleetExclusions(file.series.raceFleetExclusions, raceIdMap, fleetIdMap),
    defaultStartSequence: undefined,
    ftpPaths,
    publishingGroups,
    prizes,
    // The standing team is series content, so the file's copy replaces the
    // current one. `publishOfficials` follows it: the decision belongs with
    // the team it governs, and a file written without either leaves the series
    // with no team to publish.
    officials: file.series.officials,
    publishOfficials: file.series.publishOfficials,
    lastModifiedAt: now,
  });

  // Subdivision axes are retained from `current` (not taken from the file), so
  // the competitors key onto whatever the file resolves to — matching the
  // behaviour before `legacyAxisId` was threaded through.
  await writeFleetsCompetitorsRaces(repos, file, seriesId, now, fleetIdMap, competitorIdMap, raceIdMap, resolveFileSubdivisions(file).legacyAxisId, true);
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
  legacyAxisId: string | null,
  /** In-place replays (update-from-file, update-from-Sailwave) pass true so a
   *  file with no split-fleet block clears the series' existing state. The
   *  open/restore paths write into a series with no split-fleet rows to begin
   *  with, so they leave it alone rather than spending a write on a no-op. */
  clearAbsentSplitFleets = false,
): Promise<void> {
  // Redress race references are stored in the file positionally (by race
  // number) but held internally by id. Map each file race number to its
  // freshly-minted race id so redress pools survive the import.
  const newRaceIdByNumber = new Map(
    file.races.map((r) => [r.raceNumber, raceIdMap.get(r.id)!]),
  );
  const toRaceIds = (numbers: number[] | null | undefined): string[] | null => {
    const ids = (numbers ?? [])
      .map((n) => newRaceIdByNumber.get(n))
      .filter((id): id is string => id != null);
    return ids.length > 0 ? ids : null;
  };

  // `legacyAxisId` is the id of the axis synthesised for a legacy (v6–v12)
  // single-axis file, passed in by the caller so it's the *same* id the caller
  // used for the series' `subdivisionAxes`. Resolving it here independently
  // would mint a fresh id and silently orphan every competitor's value.

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
        ...(c.bowNumber ? { bowNumber: c.bowNumber } : {}),
      ...(c.alternativeSailNumbers?.length
        ? { alternativeSailNumbers: c.alternativeSailNumbers }
        : {}),
        ...(c.boatName ? { boatName: c.boatName } : {}),
        ...(c.boatClass ? { boatClass: c.boatClass } : {}),
        names: c.names,
        ...(c.owners?.length ? { owners: c.owners } : {}),
        ...(c.helms?.length ? { helms: c.helms } : {}),
        ...(c.crewNames?.length ? { crewNames: c.crewNames } : {}),
        club: c.club,
        ...(c.entryNumber ? { entryNumber: c.entryNumber } : {}),
        ...(c.tallyNumber ? { tallyNumber: c.tallyNumber } : {}),
        ...(c.seed != null ? { seed: c.seed } : {}),
        ...(c.initialFleet ? { initialFleet: c.initialFleet } : {}),
        ...(c.worldSailingId ? { worldSailingId: c.worldSailingId } : {}),
        ...(c.nationality ? { nationality: c.nationality } : {}),
        gender: c.gender,
        age: c.age,
        ...((): { subdivisions?: Record<string, string> } => {
          const subs = competitorSubdivisionsForWrite(c, legacyAxisId);
          return subs ? { subdivisions: subs } : {};
        })(),
        createdAt: now,
        ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
        ...(c.vprsTcc != null ? { vprsTcc: c.vprsTcc } : {}),
        ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
        ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
        ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
      };
    }),
  );

  // Sub-series id remapping (saved after races: membership FKs to races).
  const subSeriesIdMap = new Map(
    (file.subSeries ?? []).map((ss) => [ss.id, crypto.randomUUID()]),
  );

  // Races sequentially because their starts and finishes FK back to the
  // race row that has to exist first. Inside each race we batch.
  for (const r of file.races) {
    const newRaceId = raceIdMap.get(r.id)!;
    await repos.raceRepo.save({
      id: newRaceId,
      seriesId,
      raceNumber: r.raceNumber,
      name: r.name ?? null,
      date: r.date,
      ...(r.lastFinisherTime ? { lastFinisherTime: r.lastFinisherTime } : {}),
      ...(r.discardPolicy ? { discardPolicy: r.discardPolicy } : {}),
      ...(r.pointsMultiplier != null ? { pointsMultiplier: r.pointsMultiplier } : {}),
      ...(hasConditions(r.conditions) ? { conditions: r.conditions } : {}),
      ...(r.officials?.length ? { officials: r.officials } : {}),
      createdAt: now,
    });

    await repos.raceStartRepo.saveMany(
      r.starts.map((s) => ({
        id: crypto.randomUUID(),
        raceId: newRaceId,
        fleetIds: s.fleetIds.map((id) => fleetIdMap.get(id) ?? id),
        startTime: s.startTime,
        // v24 carries stage identity per start; a v23 file carries it on the
        // race — inherit so old split-fleet files land on the new model.
        ...((s.stage ?? r.stage) ? { stage: s.stage ?? r.stage } : {}),
        ...((s.stageRaceNumber ?? r.stageRaceNumber) != null
          ? { stageRaceNumber: s.stageRaceNumber ?? r.stageRaceNumber }
          : {}),
        ...((s.firstPlaceOffset ?? r.firstPlaceOffset) != null
          ? { firstPlaceOffset: s.firstPlaceOffset ?? r.firstPlaceOffset }
          : {}),
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
          ...(fileFinishMatchedOn(f) ? { matchedOn: fileFinishMatchedOn(f)! } : {}),
          ...(f.enteredSailNumber ? { enteredSailNumber: f.enteredSailNumber } : {}),
          sortOrder: f.sortOrder,
          tiedWithPrevious: f.tiedWithPrevious ?? false,
          ...(f.finishTime ? { finishTime: f.finishTime } : {}),
          resultCode: f.resultCode,
          startPresent: f.startPresent,
          penaltyCode: f.penaltyCode,
          penaltyOverride: f.penaltyOverride,
          ...(f.penaltyLabel ? { penaltyLabel: f.penaltyLabel } : {}),
          ...(() => {
            const m = remapPerFleetPoints(f.penaltyOverrideByFleet, fleetIdMap);
            return m ? { penaltyOverrideByFleet: m } : {};
          })(),
          redressMethod: f.redressMethod ?? null,
          redressExcludeRaceIds: toRaceIds(f.redressExcludeRaces),
          redressIncludeRaceIds: toRaceIds(f.redressIncludeRaces),
          redressIncludeAllLater: f.redressIncludeAllLater ?? false,
          redressPoints: f.redressPoints ?? null,
          ...(() => {
            const m = remapPerFleetPoints(f.redressPointsByFleet, fleetIdMap);
            return m ? { redressPointsByFleet: m } : {};
          })(),
        };
      });
      await repos.finishRepo.saveMany(finishes);
    }
  }

  // Sub-series after races: membership (raceIds) FKs to the race rows. New
  // files carry `subSeries[*].raceIds`; pre-reshape v9 files derive membership
  // from `races[*].subSeriesId`. continueFrom is patched in a second pass so a
  // 'continue' source is guaranteed to exist when referenced.
  if (file.subSeries?.length) {
    const mapRaceIds = (ss: SeriesFileSubSeries): string[] => {
      const oldIds = ss.raceIds ?? file.races
        .filter((r) => r.subSeriesId === ss.id)
        .map((r) => r.id);
      return oldIds
        .map((rid) => raceIdMap.get(rid))
        .filter((rid): rid is string => rid !== undefined);
    };
    // Remap scoping FKs to the freshly-minted fleet/race ids; drop any that
    // didn't survive the import.
    const mapFleetIds = (ss: SeriesFileSubSeries): string[] | undefined => {
      if (!ss.fleetIds) return undefined;
      return ss.fleetIds
        .map((fid) => fleetIdMap.get(fid))
        .filter((fid): fid is string => fid !== undefined);
    };
    const mapExclusions = (ss: SeriesFileSubSeries) =>
      (ss.raceFleetExclusions ?? [])
        .map((ex) => ({
          raceId: raceIdMap.get(ex.raceId),
          fleetId: fleetIdMap.get(ex.fleetId),
        }))
        .filter((ex): ex is { raceId: string; fleetId: string } =>
          ex.raceId !== undefined && ex.fleetId !== undefined,
        );
    const toRow = (ss: SeriesFileSubSeries) => {
      const exclusions = mapExclusions(ss);
      const fleetIds = mapFleetIds(ss);
      return {
        id: subSeriesIdMap.get(ss.id)!,
        seriesId,
        name: ss.name,
        displayOrder: ss.displayOrder,
        raceIds: mapRaceIds(ss),
        ...(fleetIds ? { fleetIds } : {}),
        ...(exclusions.length > 0 ? { raceFleetExclusions: exclusions } : {}),
        startingHandicapSource: ss.startingHandicapSource,
        excludeDncOnlyCompetitors: ss.excludeDncOnlyCompetitors ?? false,
      };
    };
    await repos.subSeriesRepo.saveMany(file.subSeries.map(toRow));
    const withCarry = file.subSeries.filter(
      (ss) => ss.startingHandicapSource === 'continue' && ss.continueFromSubSeriesId,
    );
    if (withCarry.length > 0) {
      await repos.subSeriesRepo.saveMany(
        withCarry.map((ss) => ({
          ...toRow(ss),
          continueFromSubSeriesId: subSeriesIdMap.get(ss.continueFromSubSeriesId!) ?? null,
        })),
      );
    }
  }

  // Split-fleet rounds + config (v23+): replayed last, with fleet and
  // competitor ids remapped onto the freshly-minted rows. References that
  // didn't survive the remap are dropped rather than written dangling.
  // A blockless file clears the series' split-fleet state on an in-place
  // replay (`clearAbsentSplitFleets`): `deleteSeriesChildren` doesn't reach
  // split rounds — they cascade from the series row, which survives — so
  // without this the old rounds would linger pointing at deleted fleets.
  if (repos.splitFleets?.replace && (file.splitFleets || clearAbsentSplitFleets)) {
    await repos.splitFleets.replace(seriesId, {
      config: file.splitFleets?.config ?? null,
      rounds: (file.splitFleets?.rounds ?? []).map((r) => ({
        ...r,
        id: crypto.randomUUID(),
        fleetIds: r.fleetIds
          .map((id) => fleetIdMap.get(id))
          .filter((id): id is string => !!id),
        ...(r.overrides
          ? {
              overrides: Object.fromEntries(
                Object.entries(r.overrides)
                  .map(([cid, fid]) => [
                    competitorIdMap.get(cid),
                    fleetIdMap.get(fid),
                  ])
                  .filter(([a, b]) => a && b) as [string, string][],
              ),
            }
          : {}),
      })),
    });
  }

  // NHC tcf history is no longer persisted — the only consumer was the
  // file-export path, which now recomputes via calculateFleetStandings.
}

