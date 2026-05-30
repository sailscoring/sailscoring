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
  | 'nationality'
  | 'gender'
  | 'age'
  | 'subdivision';

/** How the primary person slot (`Competitor.name`) is labelled throughout the
 *  UI and exports. "competitor" and "entrant" are generic; "helm" and "owner"
 *  are roles. This is a display concept only — it does not change which slot
 *  stores the primary name. Optional fields `helm` and `owner` let scorers
 *  record the other role separately; the matching role is disabled here when
 *  the primary label already carries it. */
export type PrimaryPersonLabel = 'competitor' | 'entrant' | 'helm' | 'owner';

export interface StartGroup {
  fleetIds: string[];       // fleets sharing this starting signal
  intervalMinutes: number;  // minutes after the previous start (0 for the first group)
}

/**
 * Scorer-defined series category (#154). Per-workspace, scorer-editable.
 * Workspace scope is implicit in the API surface, so it isn't carried here.
 * The synthetic "Uncategorized" bucket is *not* a Category — it's
 * `Series.categoryId == null`.
 */
export interface Category {
  id: string;
  name: string;
  displayOrder: number;
}

export interface Series {
  id: string;
  name: string;
  venue: string;
  startDate: string;   // ISO date string, e.g. "2025-06-14"
  endDate: string;     // ISO date string; empty string if single-day or unknown
  venueLogoUrl: string;
  eventLogoUrl: string;
  venueUrl: string;    // website the venue logo/name links to in exports (empty if unset)
  eventUrl: string;    // website the event logo/name links to in exports (empty if unset)
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
  ftpPath: string;   // legacy single path; falls back here when ftpPaths has no entry for a fleet (series uploaded before per-fleet paths landed)
  ftpPaths: Record<string, string>;  // last-uploaded remote path per fleet, keyed by fleetId
  includeJsonExport: boolean;  // embed public JSON export in exported HTML (default true)
  publishRatingCalculations?: boolean;  // NHC/ECHO progressive rating-calculation explainability columns/header (default true)
  showPerRaceRatingsInSummary?: boolean;  // NHC/ECHO: render applied rating beneath each score in the summary table and add a seed-rating column (default true)
  // Display
  enabledCompetitorFields: CompetitorFieldKey[];  // which optional competitor fields are shown
  primaryPersonLabel: PrimaryPersonLabel;  // label for Competitor.name (display only)
  subdivisionLabel: string;  // label for the Competitor.subdivision field, e.g. "Division", "Category" (display only); defaults to "Division"
  // Series-list organisation (#154). Workspace-local: excluded from the
  // .sailscoring file format and public JSON export, and reset by copySeries.
  categoryId?: string | null;  // category assignment; null/absent = synthetic "Uncategorized" bucket
  archived?: boolean;          // read-only + collapsed out of the active list; subsumes the horizon "lock" concept
  // Server-side concurrency token (ADR-008 Phase 4). Populated by the
  // Postgres-backed read path; absent in local-mode (Dexie) and stripped
  // from the .sailscoring file format and public JSON export.
  version?: number;
}

export interface Fleet {
  id: string;
  seriesId: string;
  name: string;
  displayOrder: number;
  scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo';
  echoAlpha?: number; // present iff scoringSystem === 'echo'; default 0.25 (75/25 club racing)
  // Inline (unshared) NHC profile override. Present iff scoringSystem === 'nhc'
  // AND the scorer has customised the parameters away from the SWNHC2015
  // defaults. Absent means "use DEFAULT_NHC_PROFILE", which is the stock
  // SWNHC2015 / Sailwave behaviour every existing NHC fleet relies on. A future
  // milestone will hoist these into a named `Series.nhcProfiles[]` registry
  // (see docs/design/horizon.md); the inline shape is forward-compatible with
  // that migration.
  nhcProfile?: NhcProfile;
  version?: number;   // server-side concurrency token (see Series.version)
}

export interface RaceStart {
  id: string;
  raceId: string;
  fleetIds: string[];   // all fleets sharing this gun time
  startTime: string;    // "HH:MM:SS"
  version?: number;     // server-side concurrency token (see Series.version)
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
  nationality?: string;  // 3-letter national-letters code (RRS Appendix G / IOC), e.g. "IRL"
  gender: 'M' | 'F' | '';
  age: number | null;
  subdivision?: string;  // subdivision within a Fleet for prize-giving/filtering, not scoring (e.g. "Gold"/"Silver"/"Bronze", or age categories like "Grand Master"). Labelled per Series.subdivisionLabel
  createdAt: number;
  ircTcc?: number;    // IRC Time Correction Coefficient, e.g. 0.972
  pyNumber?: number;  // RYA Portsmouth Yardstick number, e.g. 1034
  nhcStartingTcf?: number;  // initial TCF for NHC fleets; required for NHC competitors
  echoStartingTcf?: number; // initial TCF for ECHO fleets; required for ECHO competitors
  version?: number;         // server-side concurrency token (see Series.version)
}

export interface Race {
  id: string;
  seriesId: string;
  raceNumber: number;
  date: string;        // ISO date string
  createdAt: number;
  version?: number;    // server-side concurrency token (see Series.version)
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
  // Per ADR-008 Phase 6 (#111): explicit tie marker. The scoring engine
  // treats a finisher with `tiedWithPrevious === true` as sharing the
  // immediately-prior row's place (RRS A8.1 averaged ranks). Stored
  // separately from sortOrder so the visible row order stays stable —
  // sortOrders remain monotonically increasing per race.
  tiedWithPrevious: boolean;
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
  version?: number;                     // server-side concurrency token (see Series.version)
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
  correctedTime: number | null;  // integer seconds, rounded half-up; null for coded finishes or missing rating
  tcfApplied: number | null;     // TCF used this race (TCC, 1000/PY, or NHC race-N TCF); null if no rating
  newTcf: number | null;         // TCF for race N+1; null for static systems (IRC/PY) or no rating
  nhc?: NhcRaceCalc;             // present iff fleet.scoringSystem === 'nhc' AND finisher
  echo?: EchoRaceCalc;           // present iff fleet.scoringSystem === 'echo' AND finisher
}

// NHC per-finisher intermediate calculations (for explainability).
// Surfaces the SWNHC2015 intermediates a competitor needs to verify their
// rating update: Q_i (fair TCF), S_i (comparative score), extreme flag, the
// per-boat α actually applied, the pre-realignment blend Z_i, and the
// final signed adjustment.
export interface NhcRaceCalc {
  fairTcf: number;          // Q_i = O_i × P50    (Family-B / IS-PI form)
  compScore: number;        // S_i = Q_i / TCF_i
  isExtreme: boolean;       // S_i outside [μ(S)−1·σ, μ(S)+1.5·σ]
  extremeDirection?: 'fast' | 'slow';  // populated iff isExtreme
  alphaApplied: number;     // one of alphaP / alphaN / alphaPX / alphaNX
  provisionalTcf: number;   // Z_i — blended, pre-realignment
  adjustment: number;       // signed: newTcf − tcfApplied (post-realign)
}

// NHC fleet-race-level aggregates (for the explainability fleet header).
// Exposes every fleet-level constant the SWNHC2015 algorithm uses so a
// scorer with the published table can reproduce every finisher's New TCF.
export interface NhcRaceAggregates {
  finisherCount: number;
  ctAvg: number;             // seconds — mean of corrected times across finishers
  meanTcf: number;           // mean of tcfApplied across finishers
  p50: number;               // mean(L) / mean(O)
  w51: number | null;        // mean(L_non-ext) / mean(O_non-ext); null if non-ext is empty (falls back to p50)
  sMean: number;             // μ(S) across finishers
  sStdev: number;            // σ(S) — population
  sHi: number;               // sMean + sdOver·sStdev   (default sdOver = 1.5)
  sLo: number;               // sMean − sdUnder·sStdev  (default sdUnder = 1.0)
  extremeCount: number;
  realignmentFactor: number; // Z51 = ΣL / ΣZ over finishers
  updateSuppressed: boolean; // true when finisherCount < minFin
}

// ECHO per-finisher intermediate calculations (for explainability).
// Same shape as NhcRaceCalc — kept as a separate type so the renderer
// dispatches on the populated field, and so future ECHO-specific fields
// (e.g. Standard TCF clamp markers) can be added without disturbing NHC.
export interface EchoRaceCalc {
  ctRatio: number;       // CT_avg / CT_i  (= PI_i / H_i)
  fairTcf: number;       // PI_i  (= ΣH_S / (T_E_i × Σ(1/T_E)))
  adjustment: number;    // signed: α × (PI_i − H_i)
  alphaApplied: number;  // α actually used this race
}

// ECHO fleet-race-level aggregates (for the IS-notation fleet header).
// Adds sumH (ΣH_S) and sumReciprocalEt (Σ(1/T_E)) so a scorer can
// reproduce PI_i = ΣH_S / (T_E_i × Σ(1/T_E)) directly from the
// published table — no algebraic substitutions required.
export interface EchoRaceAggregates {
  alpha: number;
  finisherCount: number;
  ctAvg: number;            // seconds — mean of corrected times across finishers
  meanTcf: number;          // mean of tcfApplied across finishers (== ΣH_S / N)
  sumH: number;             // ΣH_S — sum of starting handicaps across finishers
  sumReciprocalEt: number;  // Σ(1/T_E) — seconds⁻¹
  updateSuppressed: boolean; // true when finisherCount < minFinishers (≤2 for ECHO)
}

// Per-finisher intermediates produced by the handicap-adjustment phase.
// Engine-internal union: NHC and ECHO emit structurally-different shapes.
// The orchestrator dispatches by `isNhc`/`isEcho` (derived from the same
// config) and stores the result on the per-system display field.
export type ProgressiveRaceCalc = NhcRaceCalc | EchoRaceCalc;

// Fleet-race-level aggregates from the handicap-adjustment phase.
// Engine-internal union — see ProgressiveRaceCalc.
export type ProgressiveRaceAggregates = NhcRaceAggregates | EchoRaceAggregates;

// Configuration profile that drives the handicap-adjustment phase. One profile
// per progressive system (NHC1, ECHO, SWNHC2015, RYA NHC 2015). See
// docs/design/handicap-scoring.md for the per-system parameter table.
export interface ProgressiveHandicapConfig {
  // Blend rates. Setting alphaUp === alphaDown gives symmetric adjustment.
  alphaUp: number;                 // applied when Q_i > H_i (boat over-performed)
  alphaDown: number;               // applied when Q_i ≤ H_i

  outlier:
    | { strategy: 'none' }
    | {
        // RYA NHC 2015: clamp the boat's effective corrected time to ±k SDs
        // of fleet T_C, then recompute Q_i from the clamped value.
        strategy: 'cap-input';
        sdThresholdFast: number;
        sdThresholdSlow: number;
      }
    | {
        // SWNHC2015: keep T_E, but reduce α for boats whose Q/H ratio is far
        // from fleet mean. The non-extreme branch optionally recomputes P50
        // from the non-extreme subset (W51) before blending.
        strategy: 'reduce-alpha';
        sdThresholdUp: number;
        sdThresholdDown: number;
        alphaUpReduced: number;
        alphaDownReduced: number;
        recomputeP50ForNonExtreme: boolean;  // SWNHC2015 sets true
      };

  realignment:
    | { target: 'none' }
    | { target: 'prior-mean';   minFinishers: number; includeDNC: boolean }
    | { target: 'base-numbers'; includeDNC: boolean };

  minFinishers: number;            // skip the update entirely if fewer than this finished

  // How to compute the per-boat fair handicap Q_i. Algebraically equivalent
  // for tightly-clustered fleets; diverges for diverse fleets. ECHO and
  // NHC1 (= SWNHC2015) both use 'is-pi' (the IS 2022 guide / P50 form) so
  // the published intermediates reproduce Q_i exactly.
  formulaForm: 'ct-mean' | 'is-pi';
}

// User-facing NHC parameter set. Stored inline on `Fleet.nhcProfile` when the
// scorer customises away from the SWNHC2015 defaults; absent means "use
// DEFAULT_NHC_PROFILE". A future milestone will surface these as named
// profiles per series and per workspace (see docs/design/horizon.md); the
// inline shape is forward-compatible with that migration.
export interface NhcProfile {
  name: string;
  alphaP: number;    // non-extreme over-performer blend rate
  alphaN: number;    // non-extreme under-performer blend rate
  alphaPX: number;   // extreme over-performer blend rate
  alphaNX: number;   // extreme under-performer blend rate
  sdOver: number;    // extreme threshold above μ(S), in SDs
  sdUnder: number;   // extreme threshold below μ(S), in SDs
  minFin: number;    // minimum finishers; below this no rating updates
}

// Persistent per-(race, competitor, fleet) TCF snapshot. Derived state — rebuilt
// by the scoring engine on every recompute, persisted so file/JSON imports render
// without re-scoring and so non-finishers (no Finish row) still carry a record.
export interface TcfRecord {
  id: string;
  raceId: string;
  competitorId: string;
  fleetId: string;
  tcfApplied: number;    // TCF used to compute CT in this race
  newTcf: number;        // TCF for race N+1 (== tcfApplied if non-finisher)
}

/**
 * ADR-008 Phase 9/10 — the in-app publishing path that replaces bilge (#153).
 *
 * A published page is identified by `(workspaceId, slug)` and lives at
 * `/p/{workspaceSlug}/{slug}/...`. The slug is `kebab(series name)` by default,
 * editable at first publish and frozen after. `pages` holds one HTML blob per
 * fleet; the bare `/p/{ws}/{slug}` is reserved for the listing (#162), so every
 * fleet is a sub-page. This is server/workspace state and never travels in the
 * portable `.sailscoring` file or the public JSON export.
 *
 * `seriesId` is nullable: deleting a series orphans the publication (the page
 * stays live) rather than removing it — see the `published_series` schema.
 */
export interface PublishedSeriesPage {
  fleetName: string;   // fleet name as scored ("Default" for a single-fleet series)
  // Sub-path under the slug: `standings` for a single (default) fleet, or
  // `kebab(fleetName)` for a named fleet. Never empty (the bare slug is the
  // future listing). The full path is `/p/{workspaceSlug}/{slug}/{subPath}`.
  subPath: string;
  blobUrl: string;     // storage locator (Vercel Blob URL, or `db:` key in dev)
}

export interface PublishedSeries {
  id: string;
  workspaceId: string;
  seriesId: string | null;       // null = orphaned (the series was deleted)
  slug: string;                  // public slug within the workspace
  pages: PublishedSeriesPage[];
  contentHash: string;           // hash over all page HTML; unchanged ⇒ skip re-upload
  publishedAt: number;           // Unix ms of the last publish
  publishedVersion: number;      // series.version captured at publish (drives "X edits since")
}

/**
 * Result of a publish (the per-fleet public URLs + metadata). Lives here (not
 * in the `server-only` handler) so the client can import it.
 */
export interface PublishResult {
  slug: string;
  publishedAt: number;
  publishedVersion: number;
  pages: { fleetName: string; url: string }[]; // per-fleet public URLs
}

/**
 * The publish dialog's view of a series on open: the workspace's slug (for the
 * URL preview), the default slug to offer on first publish, and the current
 * publication if any.
 */
export interface PublicationStatus {
  workspaceSlug: string;
  suggestedSlug: string;          // kebab(series name) — default for first publish
  published: PublishResult | null;
}

/**
 * One row of the workspace "Published" management page (#164) — the authoring
 * mirror of the public `/p/{ws}` index, and the only surface that lists
 * orphaned snapshots (their series deleted). `id` is the unpublish handle.
 */
export interface PublishedListItem {
  id: string;                     // publication id — the unpublish path param
  slug: string;
  title: string;                  // live series name, or the slug for an orphan
  url: string;                    // public series-index URL: {APP_URL}/p/{ws}/{slug}
  orphaned: boolean;              // the series was deleted (the snapshot lives on)
  publishedAt: number;            // Unix ms of the last publish
  editsSincePublish: number;      // series edits since the snapshot (0 if orphaned)
  sharedWith: string[];           // titles of other publications sharing this slug
}

export interface FtpServer {
  id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  ftps: boolean;
  version?: number;  // server-side concurrency token (see Series.version)
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
  raceExcluded: boolean[];               // true = nobody finished this race; it scores 0 and does not count toward discards
}

export type ScoringRejectionReason = 'no_rating' | 'no_starting_tcf';

export interface ScoringRejection {
  competitorId: string;
  reason: ScoringRejectionReason;
}

/**
 * Activity log entry (#153). The shape returned by the `/api/v1/activity`
 * endpoints and rendered by the Activity tab + series-list recency strips.
 * Defined here so the server query (`lib/activity-log.ts`) and the client
 * mirror (`lib/api-repository.ts`) share one definition.
 */
export interface ActivityEntry {
  id: string;
  seriesId: string | null;
  action: string;
  summary: string;
  /** Coalesced occurrence count; 1 for ordinary entries. */
  count: number;
  /** ISO-8601 timestamp of the (most recent) occurrence. */
  createdAt: string;
  actor: { id: string; email?: string; displayName?: string } | null;
}

/**
 * Read-only "who last touched this record" stamp (#153), derived from the
 * row's server-managed `updated_at` / `updated_by`. Surfaced in the competitor
 * edit dialog. Isolated from the resource DTOs on purpose: it's server
 * metadata, not user-authored content, so it never enters file/CSV/JSON
 * round-trips.
 */
export interface AuditStamp {
  updatedAt: string | null;
  actor: { id: string; email?: string; displayName?: string } | null;
}

/**
 * Self-service org-creation request (#153). The shape returned by the
 * `/api/v1/org-requests` endpoints and shown on the account page.
 */
export interface OrgRequest {
  id: string;
  requestedName: string;
  note: string | null;
  status: 'pending' | 'fulfilled' | 'declined';
  createdAt: string;
}
