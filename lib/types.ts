export interface DiscardThreshold {
  minRaces: number;     // apply this rule when races.length >= minRaces
  discardCount: number; // number of worst scores to drop
}

/** Optional competitor fields that can be shown or hidden per series.
 *  Sail number and the primary person slot (`Competitor.name`, labelled per
 *  `Series.primaryPersonLabel`) are always shown and are not configurable.
 *  `helm` and `owner` are optional *role* fields: when the primary label is a
 *  role, the matching key is disabled to avoid duplication with the primary. */
export type CompetitorFieldKey =
  | 'boatName'
  | 'boatClass'
  | 'helm'
  | 'owner'
  | 'crewName'
  | 'club'
  | 'gender'
  | 'age';

/** How the primary person slot (`Competitor.name`) is labelled throughout the
 *  UI and exports. "competitor" and "entrant" are generic; "helm" and "owner"
 *  are roles. This is a display concept only — it does not change which slot
 *  stores the primary name. Optional fields `helm` and `owner` let scorers
 *  record the other role separately; the matching role is disabled here when
 *  the primary label already carries it. */
export type PrimaryPersonLabel = 'competitor' | 'entrant' | 'helm' | 'owner';

export interface StartGroup {
  fleetIds: string[];       // fleets sharing this starting signal
  offsetMinutes: number;    // minutes after the first start (0 for the first group)
}

export interface Series {
  id: string;
  name: string;
  venue: string;
  startDate: string;   // ISO date string, e.g. "2025-06-14"
  endDate: string;     // ISO date string; empty string if single-day or unknown
  venueLogoUrl: string;
  eventLogoUrl: string;
  createdAt: number;   // Date.now()
  // File tracking
  lastSnapshotId: string | null;  // snapshotId of last Save to File or Open from File
  lastSavedAt: number | null;     // Date.now() of last Save to File
  lastModifiedAt: number;         // Date.now() of last data change
  snapshotHistory: string[];      // ordered lineage of all snapshot IDs
  // Scoring configuration
  scoringMode: 'scratch' | 'handicap';  // series-level fork; locked after first race has finishes
  defaultStartSequence?: StartGroup[];  // default start groups and offsets for race creation
  // Scoring rules
  discardThresholds: DiscardThreshold[];
  dnfScoring: 'seriesEntries' | 'startingArea';  // A5.2 (default) or A5.3
  // Publishing
  ftpHost: string;   // saved FTP server host for this series (empty if not yet published)
  ftpPath: string;   // saved remote path for this series (empty if not yet published)
  bilgeBundle: BilgeBundle | null;
  includeJsonExport: boolean;  // embed public JSON export in exported HTML (default true)
  publishRatingCalculations?: boolean;  // NHC rating-calculation explainability columns/header (default true)
  // Display
  enabledCompetitorFields: CompetitorFieldKey[];  // which optional competitor fields are shown
  primaryPersonLabel: PrimaryPersonLabel;  // label for Competitor.name (display only)
}

export interface Fleet {
  id: string;
  seriesId: string;
  name: string;
  displayOrder: number;
  scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc';
  nhcAlpha?: number;  // present iff scoringSystem === 'nhc'; default 0.15
}

export interface RaceStart {
  id: string;
  raceId: string;
  fleetIds: string[];   // all fleets sharing this gun time
  startTime: string;    // "HH:MM:SS"
}

export interface Competitor {
  id: string;
  seriesId: string;
  fleetIds: string[];
  sailNumber: string;
  boatName?: string;  // name of the vessel, e.g. "The Big Picture"
  boatClass?: string; // boat class, e.g. "Laser", "Firefly" — relevant for PY fleets
  name: string;       // primary identifying person (labelled per Series.primaryPersonLabel)
  owner?: string;     // owner, when recorded separately from the primary (e.g. helm-primary series)
  helm?: string;      // helm, when recorded separately from the primary (e.g. owner-primary series)
  crewName?: string;  // crew name, for two-person dinghy classes
  club: string;
  gender: 'M' | 'F' | '';
  age: number | null;
  createdAt: number;
  ircTcc?: number;    // IRC Time Correction Coefficient, e.g. 0.972
  pyNumber?: number;  // RYA Portsmouth Yardstick number, e.g. 1034
  nhcStartingTcf?: number;  // initial TCF for NHC fleets; required for NHC competitors
}

export interface Race {
  id: string;
  seriesId: string;
  raceNumber: number;
  date: string;        // ISO date string
  createdAt: number;
}

export type ResultCode =
  // Position-replacing codes (replace finish; boat receives penalty score)
  | 'DNC'   // Did Not Come to start area — always entries+1
  | 'DNS'   // Did Not Start
  | 'OCS'   // On Course Side
  | 'NSC'   // Did Not Sail the Course
  | 'DNF'   // Did Not Finish
  | 'RET'   // Retired
  | 'DSQ'   // Disqualified (excludable)
  | 'DNE'   // Disqualification Not Excludable — cannot be discarded
  | 'UFD'   // U Flag Disqualification (rule 30.3) — discardable
  | 'BFD'   // Black Flag Disqualification (rule 30.4) — cannot be discarded
  // Redress (replaces score with A9 average; Phase 3)
  | 'RDG';  // Redress Given — score replaced by A9 average

export type PenaltyCode =
  // Additive penalty codes (applied on top of finish; A6.2: other scores unchanged)
  | 'ZFP'   // Z Flag Penalty (rule 30.2) — adds 20% of DNF score (formula per 44.3(c))
  | 'SCP'   // Scoring Penalty — adds specified % of DNF score (default 20%)
  | 'DPI';  // Discretionary Points Increase — adds stated number of points

export interface Finish {
  id: string;
  raceId: string;
  competitorId: string | null;    // null for unresolved unknown finishes
  unknownSailNumber?: string;     // set when competitorId is null
  sortOrder: number | null;       // crossing-order index in the unified finish sheet; null for coded finishes (except RDG: may be set alongside RDG)
  finishTime?: string;            // "HH:MM:SS" — time of day the boat crossed the line; ET = finishTime − startTime
  resultCode: ResultCode | null;  // null if sortOrder is set (RDG may coexist with sortOrder)
  startPresent: boolean | null;   // true if observed in starting area; null if not recorded
  penaltyCode: PenaltyCode | null;    // additive penalty (ZFP/SCP/DPI); only for finishers
  penaltyOverride: number | null;     // SCP: explicit %; DPI: explicit points; null = use default
  // Redress (RDG) — all null unless resultCode === 'RDG'
  redressMethod: 'all_races' | 'races_before' | 'stated' | null;
  redressExcludeRaces: number[] | null; // exclude-mode: remove these races from method-default pool
  redressIncludeRaces: number[] | null; // include-mode: use only these races (overrides method default)
  redressIncludeAllLater: boolean;      // include-mode: also include all races after max(redressIncludeRaces)
  redressPoints: number | null;         // stated-method: scorer-entered points value
}

// Calculated, not stored
export interface RaceScore {
  competitorId: string;
  points: number;
  place: number | null;   // raw cross-fleet finish position; null for coded finishes
  rank: number | null;    // within-fleet finish rank (base, before averaging); null for coded finishes
  resultCode: ResultCode | null;
}

// Calculated, not stored — extends RaceScore with handicap time fields
export interface HandicapRaceScore extends RaceScore {
  elapsedTime: number | null;    // seconds; null for coded finishes or missing start time
  correctedTime: number | null;  // seconds; null for coded finishes or missing rating
  tcfApplied: number | null;     // TCF used this race (TCC, 1000/PY, or NHC race-N TCF); null if no rating
  newTcf: number | null;         // TCF for race N+1; null for static systems (IRC/PY) or no rating
  nhc?: NhcRaceCalc;             // present iff fleet.scoringSystem === 'nhc' AND finisher
}

// NHC per-finisher intermediate calculations (for explainability)
export interface NhcRaceCalc {
  ctRatio: number;       // CT_avg / CT_i
  fairTcf: number;       // TCF_i × ctRatio  (≡ Q_i)
  adjustment: number;    // signed: α × (fairTcf − TCF_i)
  alphaApplied: number;  // α actually used this race
}

// NHC fleet-race-level aggregates (for the explainability fleet header)
export interface NhcRaceAggregates {
  alpha: number;
  finisherCount: number;
  ctAvg: number;     // seconds — mean of corrected times across finishers
  meanTcf: number;   // mean of tcfApplied across finishers
}

// Persistent per-(race, competitor, fleet) TCF snapshot. Derived state — rebuilt
// by the scoring engine on every recompute, persisted so file/JSON imports render
// without re-scoring and so non-finishers (no Finish row) still carry a record.
export interface NhcTcfRecord {
  id: string;
  raceId: string;
  competitorId: string;
  fleetId: string;
  tcfApplied: number;    // TCF used to compute CT in this race
  newTcf: number;        // TCF for race N+1 (== tcfApplied if non-finisher)
}

export interface BilgeBundle {
  uuid: string;                 // bilge namespace owner token (travels in series file)
  prefix: string;               // e.g. "hyc-autumn-league-2026"
  slug: string;                 // primary slug, e.g. "hyc-autumn-league-2026/standings"
  email?: string;               // scorer email — local only, NOT written to series file
  status: 'unpublished' | 'pending' | 'published';
  publishedUrl: string | null;  // primary (first fleet) published URL
  lastPublishedAt: number | null;
  // Multi-fleet: per-fleet published URLs. Absent for single-fleet bundles.
  fleets?: { name: string; url: string | null }[];
}

export interface FtpServer {
  id?: number;   // auto-increment primary key; undefined before first save
  host: string;
  port: number;
  username: string;
  password: string;
  ftps: boolean;
}

export interface Standing {
  rank: number;
  competitor: Competitor;
  racePoints: number[];                  // points per race, in race order
  raceCodes: (ResultCode | null)[];      // result code per race (null = normal finish)
  racePenaltyCodes: (PenaltyCode | null)[];        // additive penalty per race (null = no penalty)
  racePenaltyOverrides: (number | null)[];          // override value per race (SCP %  or DPI pts; null = no override / no penalty)
  totalPoints: number;
  netPoints: number;                     // totalPoints minus discarded points
  raceDiscards: boolean[];               // true = this race is discarded from series total
  raceNonDiscardable: boolean[];         // true = this code cannot be excluded by discard rules (DNE, BFD)
  raceRedressFlags: boolean[];           // true = this race score was calculated via RDG (A9 average)
}

export type ScoringRejectionReason = 'no_rating' | 'no_starting_tcf';

export interface ScoringRejection {
  competitorId: string;
  reason: ScoringRejectionReason;
}
