export interface DiscardThreshold {
  minRaces: number;     // apply this rule when races.length >= minRaces
  discardCount: number; // number of worst scores to drop
}

/** A discard allowance stated as a proportion — "one third of the results are
 *  discarded", "one discard for every three races sailed" — rather than as a
 *  table of step-ups. Club long-series sailing instructions word it this way;
 *  hand-expanding it into thresholds produces a list of numbers that no longer
 *  resembles the rule it came from.
 *
 *  Resolves to `sailed < firstAt ? 0 : 1 + floor((sailed - firstAt) / everyRaces)`,
 *  rounded down, counted against races *sailed* (excluded races earn no credit,
 *  as for thresholds). With `firstAt === everyRaces` that is exactly
 *  `floor(sailed / everyRaces)`. */
export interface ProportionalDiscard {
  firstAt: number;      // races sailed at which the first discard applies
  everyRaces: number;   // one further discard per this many races after that
}

/** Optional competitor fields that can be shown or hidden per series.
 *  Sail number and the primary person slot (`Competitor.name`, labelled per
 *  `Series.primaryPersonLabel`) are always shown and are not configurable.
 *  `helm` and `owner` are optional *role* fields: when the primary label is a
 *  role, the matching key is disabled to avoid duplication with the primary. */
export type CompetitorFieldKey =
  | 'bowNumber'
  | 'alternativeSailNumbers'
  | 'entryNumber'
  | 'tallyNumber'
  | 'seed'
  | 'initialFleet'
  | 'worldSailingId'
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

/** Person fields whose entry affordances can be opened to multiple names per
 *  entry (`Series.multiPersonFields`, gated by the `multi-person-fields`
 *  feature). `primary` is the primary slot; the rest match their
 *  `CompetitorFieldKey`. Entry-side only — stored lists render regardless. */
export type MultiPersonFieldKey = 'primary' | 'owner' | 'helm' | 'crewName';

export interface StartGroup {
  fleetIds: string[];       // fleets sharing this starting signal
  intervalMinutes: number;  // minutes after the previous start (0 for the first group)
}

/**
 * A named subdivision axis: one independent way of sub-grouping competitors for
 * prize-giving/filtering (not scoring), e.g. a "Division" axis (Gold/Silver) and
 * an "Age category" axis (Youth/Master) coexisting on the same series. A
 * competitor carries at most one value per axis, keyed by `id` in
 * `Competitor.subdivisions`. Array position in `Series.subdivisionAxes` is the
 * display order. `id` is stable so renaming `label` never orphans values.
 */
export interface SubdivisionAxis {
  id: string;
  label: string;  // display, e.g. "Division", "Age category"; bounded by SUBDIVISION_LABEL_MAX_LENGTH
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

/** Where a series originally came from. Currently only Sailwave imports are
 *  tagged; `.sailscoring` opens and hand-built series leave `source` unset. */
export type SeriesSource = 'sailwave';

/**
 * An extra published page assembled from sections. Two section sources:
 *
 *  - **Fleets** (the default): several fleets' results rendered as sections of
 *    one page instead of (or as well as) their standalone per-fleet pages.
 *    Covers both the "Overall" page (every fleet's standings on one page,
 *    typically without the per-race detail) and the multi-method class page
 *    (e.g. one "Puppeteer" page carrying the Scratch and HPH fleets in full,
 *    with no individual pages — see `Series.publishIndividualFleetPages`).
 *  - **A subdivision axis** (`sectionAxisId`): one section per value of that
 *    axis — a Gold/Silver/Bronze page beside the overall standings, which is
 *    the same racing presented the way a division prize-giving reads it.
 *
 * Either way the sections are declared groupings, never ad-hoc competitor
 * filters.
 */
export interface PublishingGroup {
  id: string;
  /** Page title and the published sub-path seed (`kebab(name)`). Pages are
   *  keyed by name alongside fleet pages, so a group name may not equal a
   *  fleet name (enforced in the editor). */
  name: string;
  /** 'all' includes every fleet — a live mode, not a snapshot, so a fleet
   *  added later joins the page automatically. 'chosen' uses `fleetIds`. */
  fleetMode: 'all' | 'chosen';
  /** Member fleets when `fleetMode === 'chosen'`; ignored (and kept empty)
   *  for 'all'. Sections render in fleet displayOrder either way. With
   *  `sectionAxisId` set these still choose the page's competitor pool — the
   *  sections are then cut from within each member fleet. */
  fleetIds: string[];
  /** A `SubdivisionAxis.id`: section the page by that axis's values rather
   *  than by fleet. Absent = fleet sections, the original behaviour. Each
   *  section renumbers 1..n from its fleet's standings order (so overall ties
   *  stay tied), and competitors carrying no value for the axis appear in no
   *  section. Standings only — see `detail`. */
  sectionAxisId?: string;
  /** 'full' keeps each section's per-race detail tables; 'standings' renders
   *  only the summary standings tables. Ignored on an axis-sectioned page:
   *  its sections share one race set, so full detail would print the same
   *  race tables once per division. */
  detail: 'standings' | 'full';
  /** Publish per-race detail for the last N races only; absent means all of
   *  them. For pages embedded in a fixed-height frame, where a long series
   *  overruns the space — the race tables are where the height is. The
   *  standings are always the full series: a summary trimmed to match would
   *  publish totals that visibly don't add up. Only meaningful at
   *  `detail: 'full'`. */
  recentRaces?: number;
}

/**
 * One conjunct of a prize's eligibility predicate: prizes AND together a small
 * set of typed clauses rather than a string DSL. All but `rank` are equality
 * tests; `rank` is the one ordering test the NoR shapes need ("Overall 1st,
 * 2nd, 3rd" = rank ≤ 3). Fleet ids are remapped on file import like every
 * other fleet reference; axis ids are stable and travel verbatim; the
 * remaining kinds compare intrinsic competitor fields — gender for "Lady 1st,
 * 2nd, 3rd", nationality for restricted titles ("first IRL is national
 * champion"), club for the local-boat variant.
 */
export type PrizeClause =
  | { kind: 'fleet'; fleetId: string }
  | { kind: 'axis'; axisId: string; value: string }
  | { kind: 'rank'; max: number }
  | { kind: 'gender'; value: 'M' | 'F' }
  | { kind: 'nationality'; value: string }
  | { kind: 'club'; value: string };

/**
 * A named award: the top `recipientCount` eligible competitors ranked by
 * series standing (the only ranking rule so far — a `ranking` field can join
 * additively if a derived-metric rule ever lands). Eligibility is the AND of
 * `clauses`; an empty list means every scored competitor is eligible.
 * Array position in `Series.prizes` is the prize-list display order.
 */
export interface Prize {
  id: string;
  name: string;           // display, e.g. "Gold Fleet 1st, 2nd, 3rd"; bounded by PRIZE_NAME_MAX_LENGTH
  recipientCount: number; // how many places this award covers (1 = winner only)
  clauses: PrizeClause[];
}

/**
 * Pushing the competitor list to a racingrulesofsailing.org event via its
 * competitor-import API: the settings remembered from the last push so a
 * re-push needs no re-configuration. The event UUID doubles as the write
 * credential for the rrs.org event, so this is carried in the `.sailscoring`
 * file but excluded from the public JSON export.
 */
export interface RrsOrgPushConfig {
  /** The rrs.org event UUID, from the Event Panel. */
  eventUuid: string;
  /** What feeds rrs.org's single `division` slot: nothing, the competitor's
   *  fleet name, or one subdivision axis's value. */
  divisionSource: 'none' | 'fleet' | 'axis';
  /** The subdivision axis feeding `division`; set iff divisionSource is
   *  'axis'. Axis ids are stable across file round-trips (unlike fleet ids),
   *  so no remap is needed on import. */
  divisionAxisId?: string;
}

/** How boats that did not finish are scored (RRS Appendix A5).
 *  - `seriesEntries` — A5.2: penalty = series entries + 1.
 *  - `startingArea` — A5.3: came-but-didn't-finish codes (DNF/RET/OCS/…) =
 *    boats that came to the start + 1; DNC stays at entries + 1.
 *  - `startingAreaInclDnc` — A5.3 as changed by DBSC SI A13.2: DNC is *also*
 *    scored from the boats that came to the start (came + 1). */
export type DnfScoring = 'seriesEntries' | 'startingArea' | 'startingAreaInclDnc';

/** The protest / request-for-redress time limit stated in the SIs, used to
 *  compute a concrete limit time from a race's last finisher. `basis` picks
 *  what the clock runs from: each race's own last finisher (the RRS 60.3(b)
 *  default — two hours after the last boat in the race finishes) or the last
 *  finisher across all races sharing the race's date (the common club SI:
 *  "N minutes after the last boat finishes the last race of the day"). */
export interface ProtestTimeLimit {
  minutes: number;
  basis: 'race' | 'day';
}

/**
 * A race management role, in World Sailing's terms.
 *
 * The vocabulary is the Race Management Manual's, not the rulebook's: the RRS
 * names only bodies (race committee, protest committee), never individuals, so
 * the individual titles have to come from the manual. Deliberately fixed
 * rather than workspace-configurable — a club saying "OOD" means a Race
 * Officer, and one list makes two names for one job unrepresentable instead of
 * merely discouraged.
 *
 * Race management only. The jury and protest-committee titles (Umpire, Judge,
 * Classifier) are a different body and are not modelled here.
 */
export type OfficialRole =
  | 'principalRaceOfficer'
  | 'raceOfficer'
  | 'deputyRaceOfficer'
  | 'assistantRaceOfficer'
  | 'recorder'
  | 'timekeeper'
  | 'markLayer'
  | 'safetyOfficer'
  | 'equipmentInspector'
  | 'eventMeasurer'
  | 'technicalDelegate';

/** One named member of a race management team. Array position is the display
 *  order; `id` keeps a row stable while the list is edited. */
export interface RaceOfficial {
  id: string;
  role: OfficialRole;
  name: string;
}

/** A point of the compass, 16-point. Wind direction is recorded as a point
 *  rather than degrees because that is what a race officer reports. */
export type CompassPoint =
  | 'N' | 'NNE' | 'NE' | 'ENE'
  | 'E' | 'ESE' | 'SE' | 'SSE'
  | 'S' | 'SSW' | 'SW' | 'WSW'
  | 'W' | 'WNW' | 'NW' | 'NNW';

/**
 * The conditions a race was sailed in, and the course used.
 *
 * More than provenance: wind speed and course are required inputs for ORC
 * performance-curve scoring, which picks a boat's rating from the conditions
 * on the course sailed. Recorded as a *range* because that is what a race
 * officer stipulates, and because ORC's triple-number scheme keys off the
 * average of the two.
 *
 * Every field is optional and the whole block is sparse — a race carries it
 * only once someone records something.
 */
export interface RaceConditions {
  windSpeedMin?: number;          // knots
  windSpeedMax?: number;          // knots
  windDirection?: CompassPoint;
  /** Free text: the course sailed, the tide, anything else worth the record.
   *  Bounded by RACE_NOTES_MAX_LENGTH. */
  notes?: string;
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
  lastSavedAt: number | null;     // Date.now() of last Save to File
  lastModifiedAt: number;         // Date.now() of last data change
  // Scoring configuration
  scoringMode: 'scratch' | 'handicap';  // series-level fork; locked after first race has finishes
  defaultStartSequence?: StartGroup[];  // default start groups and offsets for race creation
  // Scoring rules
  discardThresholds: DiscardThreshold[];
  // A proportional discard allowance. When set it *replaces* discardThresholds
  // for scoring; the thresholds are kept so switching back in the editor loses
  // nothing. Absent is the common case.
  proportionalDiscard?: ProportionalDiscard;
  dnfScoring: DnfScoring;  // A5.2, A5.3, or A5.3-with-DNC-from-starting-area
  // Treat a boat with no result other than DNC across the series as not
  // entered: off the standings and out of the A5.2 entry count, exactly as
  // if the scorer had excluded it (Sailwave's "mark all un-sailed competitors
  // as excluded", HalSail's "exclude boats with only DNC"). Also the default a
  // new sub-series' own flag starts from. Sparse; absent means off.
  excludeDncOnlyCompetitors?: boolean;
  // Per-fleet race exclusions applied to the whole-series standings (see
  // RaceFleetExclusion). Sparse — present only for the rare heat struck for one
  // fleet (e.g. a single-boat race). A struck race scores nothing for that
  // fleet and earns no discard credit, exactly as within a sub-series, but
  // still counts for every other fleet. Absent/empty is the common case.
  raceFleetExclusions?: RaceFleetExclusion[];
  // Publishing
  ftpHost: string;   // saved FTP server host for this series (empty if not yet published)
  ftpPath: string;   // legacy single path; falls back here when ftpPaths has no entry for a fleet (series uploaded before per-fleet paths landed)
  ftpPaths: Record<string, string>;  // last-uploaded remote path per fleet, keyed by fleetId
  publishMode?: 'sailscoring' | 'ftp';  // which destination the Publish dialog opens in (default 'sailscoring'); 'ftp' only takes effect when the ftp-upload feature is enabled
  ftpLastUploadedAt?: number;   // epoch ms of the last successful FTP upload (absent = never uploaded)
  ftpUploadedVersion?: number;  // series version reflected by that upload; drives the "N edits since" indicator, mirroring the in-app publishedVersion
  includeJsonExport: boolean;  // embed public JSON export in exported HTML (default true)
  publishRatingCalculations?: boolean;  // NHC/ECHO progressive rating-calculation explainability columns/header (default true)
  showPerRaceRatingsInSummary?: boolean;  // NHC/ECHO: render applied rating beneath each score in the summary table and add a seed-rating column (default true)
  // Combined published pages (#255). Sparse — absent/empty is the common
  // case. On a block series each sub-series gets its own combined page per
  // group. Gated by the `combined-pages` feature.
  publishingGroups?: PublishingGroup[];
  // Whether fleets also publish their own standalone pages (default true).
  // When false, the published output is exactly the combined pages: no
  // per-fleet pages are built, and previously-published ones are retracted
  // once a combined page is live in their view. Only meaningful while at
  // least one combined page is configured — with none, fleet pages always
  // publish (a page-less publication is never constructed).
  publishIndividualFleetPages?: boolean;
  // How much of each published page to render (#347). 'races' publishes the
  // per-race tables alone — the single-race-event presentation, where a series
  // summary would be one race column, a total equal to that race's score, and
  // discard columns that mean nothing. Absent = 'full' (summary + race
  // tables); an explicit setting, never inferred from race count, since a
  // league in its first week legitimately has one race and is still a series.
  publishDetail?: 'full' | 'races';
  // rrs.org competitor push: remembered from the last push. Sparse — absent
  // until the series is first pushed. Carried in the .sailscoring file (the
  // config should follow the series between workspaces) but excluded from the
  // public JSON export (the UUID is a write-credential).
  rrsOrgPush?: RrsOrgPushConfig;
  // Prize list (#240). Sparse — absent/empty is the common case. Array order
  // is the prize-sheet display order. Gated by the `prizes` feature.
  prizes?: Prize[];
  // Results lifecycle. Provisional until the scorer marks the series final —
  // an RRS-grounded assertion that the scores are settled (RRS 90.3(e)'s
  // window for score changes runs from the last race of the event). While
  // final the write surface rejects edits, until the series is reopened as
  // provisional. Absent = provisional.
  resultsStatus?: 'provisional' | 'final';
  finalisedAt?: number;  // Date.now() when marked final; cleared on reopen
  // Protest time limit per the SIs; feeds each race's computed limit time and
  // the finalise checklist. Absent = no stated limit tracked — finality is
  // scorer judgement once the protest committee is silent.
  protestTimeLimit?: ProtestTimeLimit;
  // The standing race management team for the event — what a regatta fills in.
  // Kept separate from each race's own team (Race.officials): neither inherits
  // from nor overrides the other, so a series that fills in both shows both.
  // Sparse — absent/empty is the common case.
  officials?: RaceOfficial[];
  // Whether the race management team appears on published pages. Officials are
  // named non-competitors, so publication is opt-in: absent = not published.
  // Governs the public JSON export too, which is embedded in every published
  // page and is therefore published output itself.
  publishOfficials?: boolean;
  // Whether RaceSense track data (finish and elapsed times, distance sailed,
  // speeds, distance to line) appears as columns on published per-race
  // tables. Opt-in, absent = not published: the data is captured for race
  // management, so putting it on public pages is a deliberate choice. Governs
  // the public JSON export too, same as publishOfficials.
  publishTrackData?: boolean;
  // Display
  enabledCompetitorFields: CompetitorFieldKey[];  // which optional competitor fields are shown
  multiPersonFields?: MultiPersonFieldKey[];  // person fields opened to multiple names per entry (gated by the multi-person-fields feature); sparse — absent = all single
  primaryPersonLabel: PrimaryPersonLabel;  // label for Competitor.name (display only)
  subdivisionAxes: SubdivisionAxis[];  // independent subdivision/category axes; each labels a Competitor.subdivisions entry. Empty = no axes configured. Shown only when 'subdivision' is in enabledCompetitorFields.
  // Series-list organisation (#154). Workspace-local: excluded from the
  // .sailscoring file format and public JSON export, and reset by copySeries.
  categoryId?: string | null;  // category assignment; null/absent = synthetic "Uncategorized" bucket
  archived?: boolean;          // read-only + collapsed out of the active list; subsumes the horizon "lock" concept
  asPublished?: boolean;       // ADR-010: results ingested as originally published; display-only, archive-ingest-managed. Server-set; excluded from the .sailscoring file format
  // Import provenance. Set when the series originated from a Sailwave import;
  // gates the "Update from Sailwave file" affordance (only a Sailwave-born
  // series can be re-imported in place). Workspace-local like categoryId: not
  // carried in the .sailscoring file format or public JSON export.
  source?: SeriesSource;
  // Lineage: the series this one was created as a follow-on of (competitors
  // and starting handicaps carried forward). Workspace-local like categoryId;
  // set once at creation and immutable thereafter. Null/absent for series
  // with no predecessor or whose predecessor was permanently deleted.
  previousSeriesId?: string | null;
  // Manual sort position within the active list. Server-seeded (new
  // series append to the end) and rewritten by drag-reorder; always present on
  // the server read path, optional in the type like `version` so file-built
  // Series objects needn't carry it.
  displayOrder?: number;
  // Server-side concurrency token (ADR-008 Phase 4). Populated by the
  // Postgres-backed read path; absent in local-mode (Dexie) and stripped
  // from the .sailscoring file format and public JSON export.
  version?: number;
}

/**
 * One ORC certificate's `rms` record as served by the ORC database, stored
 * verbatim — the certificate is the rating, and modelling every field would
 * only lose information. Only the identity and headline-rating fields the
 * app reads are typed; the rest (hull data, the ~250 national scoring-option
 * fields, the time-allowance matrix) rides along untouched and is read by
 * field name where needed (see lib/orc-certificate.ts).
 */
export interface OrcRmsRecord {
  RefNo?: string;
  NatAuth?: string;
  CertNo?: string;
  SailNo?: string;
  YachtName?: string;
  Class?: string;
  Builder?: string;
  Designer?: string;
  /** Certificate type: INTL / CLUB (standard), NSIN / NSCL, DHIN / DHCL. */
  C_Type?: string;
  /** Certificate family: 'ORC' (standard), 'NS', or 'DH'. */
  Family?: string;
  IssueDate?: string;
  LOA?: number;
  CDL?: number;
  GPH?: number;
  APHD?: number;
  APHT?: number;
  OSN?: number;
  ILCWA?: number;
  TMF_Inshore?: number;
  TMF_Offshore?: number;
  Allowances?: OrcAllowances;
  [key: string]: unknown;
}

/**
 * The certificate's time-allowance matrix: seconds per nautical mile at each
 * tabulated true wind speed, per true wind angle column (`R52` … `R150`),
 * plus optimum beat/run VMG allowances and their angles, and the
 * pre-composed course rows (windward/leeward, circular random, ocean).
 * Every array is indexed by `WindSpeeds`.
 */
export interface OrcAllowances {
  WindSpeeds?: number[];
  WindAngles?: number[];
  Beat?: number[];
  Run?: number[];
  BeatAngle?: number[];
  GybeAngle?: number[];
  WL?: number[];
  CR?: number[];
  OC?: number[];
  [key: string]: unknown;
}

/** An ORC certificate as stored on a competitor: the verbatim record plus
 *  the index fields only the database's `activecerts` feed carries. */
export interface OrcCertData {
  record: OrcRmsRecord;
  /** ISO date the certificate expires (normally 31 Dec of the VPP year). */
  expiryDate?: string;
  vppYear?: number;
  /** When the scorer imported it (epoch ms). */
  importedAt: number;
}

/**
 * How an ORC fleet is scored: which certificate-published rating field
 * applies (by its JSON field name, e.g. 'APHT' or 'IRL_5B_WL_M_TOT') and
 * how — time-on-time (CT = rating × ET) or time-on-distance
 * (CT = ET − Δrating × distance). Absent means the default: 'APHT'
 * time-on-time, the all-purpose single number.
 *
 * kind 'pcs' is Performance Curve Scoring (rule 402): `option` then names
 * the course model — 'WL', 'CR' (all-purpose), or 'OC' (coastal) — and the
 * per-race allowance is computed from the certificate's matrix at the
 * race's scoring wind rather than read from a field.
 */
export interface OrcProfile {
  option: string;
  kind: 'tot' | 'tod' | 'pcs';
}

/**
 * Per-boat ORC scoring audit for one race — the transparency payload behind
 * a PCS (or ToD) corrected time: what allowance was applied, against which
 * scratch allowance, over what distance, and — for PCS — the boat's implied
 * wind and the race's scoring wind (with its source).
 */
export interface OrcRaceCalc {
  /** The certificate rating field applied this race — set when it isn't the
   *  fleet's default (a per-start wind-band selection), and always for ToD. */
  option?: string;
  /** ToD/PCS: the applied allowance in s/NM (equals tcfApplied). */
  todApplied?: number;
  /** ToD/PCS: the scratch boat's allowance the fleet corrected against. */
  scratchTod?: number;
  /** ToD/PCS: the course length corrected over. */
  distanceNm?: number;
  /** PCS only: this boat's implied wind (finishers). */
  impliedWind?: number;
  /** PCS only: the wind corrected times were computed at. */
  scoringWind?: number;
  /** PCS only: true when the race committee overrode the scoring wind. */
  scoringWindOverridden?: boolean;
  /** PCS only: the course model the curves were built over. */
  courseModel?: string;
}

export interface Fleet {
  id: string;
  seriesId: string;
  name: string;
  displayOrder: number;
  scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo' | 'vprs' | 'orc';
  echoAlpha?: number; // present iff scoringSystem === 'echo'; default 0.25 (75/25 club racing)
  // Inline (unshared) NHC profile override. Present iff scoringSystem === 'nhc'
  // AND the scorer has customised the parameters away from the SWNHC2015
  // defaults. Absent means "use DEFAULT_NHC_PROFILE", which is the stock
  // SWNHC2015 / Sailwave behaviour every existing NHC fleet relies on. A future
  // milestone will hoist these into a named `Series.nhcProfiles[]` registry
  // (see docs/design/horizon.md); the inline shape is forward-compatible with
  // that migration.
  nhcProfile?: NhcProfile;
  // ORC scoring configuration. Present iff scoringSystem === 'orc' AND the
  // scorer has picked a rating option other than the default (APHT
  // time-on-time). See OrcProfile.
  orcProfile?: OrcProfile;
  // The split round that created this fleet (round-scoped identity: a
  // round-1 "Yellow" is a different fleet from a round-2 "Yellow").
  // Round-owned fleets are filtered from general-purpose fleet pickers —
  // their membership is managed by the Split Fleets ceremonies.
  splitRoundId?: string;
  // The colour the fleet is drawn in — CSS hex, as the ceremony that created
  // it chose. Set by the split-fleet round commit; absent on every other
  // fleet, which nothing tints.
  color?: string;
  version?: number;   // server-side concurrency token (see Series.version)
}

/**
 * One leg of a constructed course (ORC rule 402.5): its length, compass
 * bearing, and the wind direction on the leg — a leg is split into sub-legs
 * by entering separate rows when the wind shifts mid-leg. Current is
 * optional per leg.
 */
export interface OrcCourseLeg {
  distanceNm: number;
  bearingDeg: number;
  windDirectionDeg: number;
  currentSpeedKts?: number;
  currentDirectionDeg?: number;
}

export interface RaceStart {
  id: string;
  raceId: string;
  fleetIds: string[];   // all fleets sharing this gun time
  // Gun time, "HH:MM:SS". Optional: a start may declare fleet participation
  // with no time — a membership-only start that scopes which fleets (and thus
  // competitors) are in the race without providing a gun. Handicap scoring
  // needs a time, so a timeless start falls back to scratch for that race.
  startTime?: string;
  // Split-fleet series: which stage race this start's fleets are sailing.
  // Per start, not per race — a race is one start sequence, and the fleets in
  // a sequence may be a race out of step (Gold F2 + Silver F2 + Bronze F1).
  // Absent on standard series.
  stage?: 'qualifying' | 'final' | 'medal';
  stageRaceNumber?: number;
  // Companion "last race": this start's first finisher scores offset + 1
  // (e.g. the non-medal race scored from 11 when the medal fleet is 10).
  firstPlaceOffset?: number;
  // Course length in nautical miles for this start's fleets — a required
  // scoring input for time-on-distance correction (ORC records it to
  // 0.01 NM), not descriptive metadata. Per start, not per race: fleets
  // sharing a gun but sailing different courses split into two same-time
  // starts. A ToD-scored race with no distance falls back to scratch, the
  // way a timeless start does.
  distanceNm?: number;
  // ORC PCS: the race committee's scoring wind (kt), replacing the winner's
  // implied wind when the implied value doesn't fairly represent the race
  // (rule 402.12). Per start, like the distance, so each fleet group carries
  // its own. Sparse — normally unset.
  orcScoringWind?: number;
  // The constructed course this start's fleets sailed (ORC rule 402.5): one
  // entry per leg, in sailing order. When present, the course distance is
  // the legs' sum and `distanceNm` is ignored for PCS. Course facts are
  // published — this is the record competitors check their tracks against.
  courseLegs?: OrcCourseLeg[];
  // ORC wind-band selection: a certificate rating field overriding the
  // fleet's configured option for this start's races — the race committee's
  // per-race band choice (announced by VHF in the DBSC pattern, changeable
  // if conditions materially changed). Must apply the same way (ToT/ToD) as
  // the fleet's option; a mismatched field is ignored. Sparse.
  orcOption?: string;
  version?: number;     // server-side concurrency token (see Series.version)
}

/** A static-rating field that can be overridden per race. */
export type RatingField = 'ircTcc' | 'pyNumber' | 'vprsTcc';

/**
 * Per-race override of a competitor's static rating (mid-series rating change,
 * e.g. a new IRC certificate). The competitor keeps its *current* rating; an
 * override pins a *past* race to the value in effect then. Sparse — present
 * only for re-rated boats. Applies to static fleets only (irc/py); progressive
 * systems (nhc/echo) recompute ratings per race and ignore overrides. See
 * docs/design/horizon.md.
 */
export interface RaceRatingOverride {
  id: string;
  raceId: string;
  competitorId: string;
  field: RatingField;
  value: number;     // in the field's own units (IRC TCC, or PY number)
  version?: number;  // server-side concurrency token (see Series.version)
}

export interface Competitor {
  id: string;
  seriesId: string;
  fleetIds: string[];
  sailNumber: string;
  bowNumber?: string; // bow number, when it differs from the registered sail number (e.g. a borrowed hull); optional, used for finish-entry matching
  alternativeSailNumbers?: string[]; // other sail numbers this boat may show — a replacement or borrowed sail mid-event. Lookup keys for finish entry only: the boat is still identified, displayed, and published under `sailNumber`. Sparse.
  entryNumber?: string; // the OA's registration/admin number on the entry list (split-fleet championships); distinct from bowNumber, often coincident — leave unset when they match
  tallyNumber?: string; // the safety tally token issued at registration and handed over when launching (e.g. "T0001", or a bare "17"); free text, stored verbatim
  seed?: number;      // OA seeding rank for split-fleet initial assignment (Sailwave's "Seeding" column); not derivable from entry order/sail/nationality
  initialFleet?: string; // the qualifying fleet the seeding committee assigned this boat to, as they wrote it ("Yellow"); matched against the split-fleet config's labels when Round 1 is assigned from it. Distinct from `seed`: an assignment already made, not an order to deal
  worldSailingId?: string; // World Sailing Sailor ID of the primary sailor (see lib/world-sailing.ts); the join key for an OA's seed ranking
  boatName?: string;  // name of the vessel, e.g. "The Big Picture"
  boatClass?: string; // boat class, e.g. "Laser", "Firefly" — relevant for PY fleets
  names: string[];    // primary identifying person(s), min one (labelled per Series.primaryPersonLabel); several for co-owned/co-helmed entries, joined " & " in one-line contexts
  owners?: string[];  // owner(s), when recorded separately from the primary (e.g. helm-primary series); sparse
  helms?: string[];   // helm(s), when recorded separately from the primary (e.g. owner-primary series); sparse
  crewNames?: string[]; // crew names in listed order — one for a two-person dinghy, several for a keelboat crew; sparse (absent when no crew recorded)
  club: string;
  nationality?: string;  // 3-letter national-letters code (RRS Appendix G / IOC), e.g. "IRL"
  gender: 'M' | 'F' | '';
  age: number | null;
  subdivisions?: Record<string, string>;  // subdivision/category values for prize-giving/filtering, not scoring (e.g. {<divisionAxisId>: "Silver", <categoryAxisId>: "Master"}). Keyed by Series.subdivisionAxes[].id; sparse
  createdAt: number;
  ircTcc?: number;    // IRC Time Correction Coefficient, e.g. 0.972
  vprsTcc?: number;   // VPRS Time Correction Coefficient, e.g. 0.992 (single applied value; the spin/non-spin pair lives in the rating-source layer, like IRC)
  pyNumber?: number;  // RYA Portsmouth Yardstick number, e.g. 1034
  nhcStartingTcf?: number;  // initial TCF for NHC fleets; required for NHC competitors
  echoStartingTcf?: number; // initial TCF for ECHO fleets; required for ECHO competitors
  // The boat's ORC certificate, stored verbatim as imported from the ORC
  // database; required for ORC competitors. Scoring reads rating fields off
  // the record per the fleet's OrcProfile. Kept out of the public JSON
  // export (only a summary travels — see lib/public-export.ts).
  orcCert?: OrcCertData;
  // Excluded from the series: the boat is on the list but is not an entrant.
  // It is scored nowhere, counts toward no entry total (so DNC/DNF points are
  // based on the boats that are entered), and appears on no published page or
  // finish sheet — the record exists; the entry does not. Sailwave's per-
  // competitor "Exclude" flag, kept for a roster of potential entries most of
  // which never turn up. Sparse: absent means entered.
  excluded?: boolean;
  version?: number;         // server-side concurrency token (see Series.version)
}

/**
 * A scorer's per-boat answer to "is this competitor entered here?", pinned
 * against one scope (today a sub-series). It beats both the competitor's own
 * `excluded` flag and the automatic all-DNC rule: 'included' keeps a boat that
 * never sailed the block on its table and in its entry count (it entered, so
 * everyone else's DNC counts it); 'excluded' drops a boat from this block
 * alone while it is scored normally everywhere else.
 */
export interface CompetitorEntryOverride {
  competitorId: string;
  status: 'included' | 'excluded';
}

/**
 * Cross-series competitor identity (#212): the workspace-scoped recurring
 * competitor that per-series Competitor rows link up to via the DB-only
 * `competitors.identity_id` column (deliberately not a field on Competitor —
 * it's workspace-local and excluded from the file format and public export).
 * For IODAI the recurring identity is a person; the fields mirror a
 * Competitor's so a boat-centric campaign reads correctly too. Denormalised
 * fields are a display snapshot; `label` is the canonical display name.
 */
export interface CompetitorIdentity {
  id: string;
  workspaceId: string;
  label: string;           // canonical display name, editable; seeds from first-linked competitor
  slug?: string;           // vanity slug — public URL handle + manifest key (#217); minted once, stable across rename
  sailNumber: string;      // representative sail number (denormalised display/match snapshot)
  boatName?: string;
  club?: string;
  nationality?: string;    // 3-letter national-letters code
  createdAt: number;
  version?: number;        // server-side concurrency token (see Series.version)
}

/**
 * Where a sub-series' progressive-handicap (NHC/ECHO) chain seeds from when it
 * is scored: 'base' (class / series-start numbers) or 'continue' (the
 * end-of-chain handicaps of `continueFromSubSeriesId`). See the handicap-scoring
 * design doc, "Shared progressive chain across overlapping series".
 */
export type StartingHandicapSource = 'base' | 'continue';

/**
 * One race struck from one fleet's scoring within a scope — "race R doesn't
 * count for fleet F here". Scope-neutral: the same shape strikes a race for a
 * fleet across a whole series (`Series.raceFleetExclusions`) or within one
 * sub-series (`SubSeries.raceFleetExclusions`), where the race stays a member
 * for every other fleet and counts normally in any other sub-series it belongs
 * to. Models a single-competitor heat struck for one fleet, or an abandoned
 * heat dropped from one fleet's Overall (DBSC CLARIFICATIONS Q1/Q3/Q5).
 */
export interface RaceFleetExclusion {
  raceId: string;
  fleetId: string;
}

/**
 * A named selection of races inside a series, scored independently over those
 * races: its own standings, discards, and (for NHC/ECHO) its own progressive
 * handicap chain. It is HalSail's "tandem series". Sub-series may overlap and a
 * race may belong to several; continuity between them is the explicit
 * `startingHandicapSource` carry.
 */
export interface SubSeries {
  id: string;
  seriesId: string;
  name: string;
  displayOrder: number;
  // The races this sub-series selects (many-to-many; races may belong to
  // several sub-series). Scoring orders them by raceNumber regardless.
  raceIds: string[];
  // The fleets this sub-series scores. Absent (the common case) means all the
  // series' fleets — ordinary blocks stay fleet-agnostic and one-gesture. When
  // present, only these fleets get standings and a published page for this
  // sub-series; competitors outside them are not scored here.
  fleetIds?: string[];
  // Per-fleet race exclusions (see RaceFleetExclusion). Sparse — present
  // only for the rare struck/abandoned heats.
  raceFleetExclusions?: RaceFleetExclusion[];
  // Seed source for this sub-series' progressive chain (default 'base').
  startingHandicapSource?: StartingHandicapSource;
  continueFromSubSeriesId?: string | null;
  // Whether to drop competitors that are all-DNC across this sub-series (and
  // exclude them from the entry count its DNC penalty is based on). Overrides
  // the series-level default passed to scoring. A whole-season "Overall" tandem
  // lists the full entry list (false); a race-subset block typically ranks only
  // boats that took part (true). See calculateSubSeriesFleetStandings.
  excludeDncOnlyCompetitors?: boolean;
  // The scorer's per-boat answers for this sub-series alone — a boat included
  // although it never sailed the block (it entered, so it counts), or excluded
  // from this block while scored everywhere else. Beat both the competitor's
  // own `excluded` flag and `excludeDncOnlyCompetitors`. Sparse.
  competitorOverrides?: CompetitorEntryOverride[];
  version?: number;    // server-side concurrency token (see Series.version)
}

/** How a race's finishes were taken down. See `Race.finishRecording`. */
export type FinishRecording = 'clock' | 'elapsed';

export interface Race {
  id: string;
  seriesId: string;
  raceNumber: number;
  name: string | null; // optional human label distinct from the number ("Round the Island")
  date: string;        // ISO date string
  // How this race's finishes were recorded. Absent means 'clock' — a time of
  // day per boat, the way a committee boat working off the ship's clock takes
  // them. 'elapsed' is the stopwatch sheet: a duration per boat and no time of
  // day at all. Per race because it is a property of the piece of paper being
  // transcribed (ADR-007), not of a fleet or a series — the same committee can
  // work off the clock one weekend and a stopwatch the next.
  finishRecording?: FinishRecording;
  // Time of day the last boat finished, "HH:MM:SS" — the anchor for protest /
  // redress time limits. Manual fallback for races whose finishes carry no
  // times: when any finish has a `finishTime` the sheet is authoritative and
  // this field is ignored (see effectiveLastFinisherTime in lib/race-status.ts).
  lastFinisherTime?: string;
  // How this race behaves when the series allows discards. Absent means
  // 'normal'. A single field rather than two flags because "must count" and
  // "discard first" are contradictory — one field makes that unrepresentable.
  // Distinct from StandingsRow.raceNonDiscardable, which is the *code*-level
  // protection (a DNE cannot be excluded whatever race it was scored in).
  discardPolicy?: RaceDiscardPolicy;
  // Points multiplier for this race — a NoR making one race count for more
  // than the others ("2" doubles it: 1st scores 2, 2nd 4). Absent means 1.
  // Applied to the final race score, penalties and redress included, and the
  // weighted score is what discard selection and the A8 tie-break compare.
  // Weighting a race up does not on its own protect it from discard; an SI
  // that wants both states both, and so does the scorer.
  pointsMultiplier?: number;
  // What this race was sailed in, and the course used. Sparse — absent until
  // recorded. A prerequisite for ORC performance-curve scoring, which reads
  // the wind off the race rather than treating it as a display note.
  conditions?: RaceConditions;
  // Who ran this particular race — what a club series with a rotating duty
  // fills in. Independent of the series-level standing team
  // (Series.officials): no inheritance, no override. Sparse.
  officials?: RaceOfficial[];
  createdAt: number;
  version?: number;    // server-side concurrency token (see Series.version)
}

/**
 * Per-race discard behaviour.
 * - `normal` — discarded if it is a competitor's worst (the default).
 * - `mustCount` — never discarded, even when it is the worst. A series NoR
 *   designating its centrepiece race this way is common.
 * - `discardFirst` — taken before any other race when discards are selected,
 *   whatever the points. Reorders the selection; it does not guarantee the
 *   race is dropped, since the series allowance may not reach it.
 */
export type RaceDiscardPolicy = 'normal' | 'mustCount' | 'discardFirst';

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

/** How a boat sailed one race, as captured by electronic race management
 *  (the RaceSense import). Import-only and display-only: nothing here is
 *  scored or hand-entered, and a boat the device didn't capture simply has
 *  none. Every field is sparse — the export omits each race by race.
 *
 *  Elapsed time is deliberately not here: it is a recording of the finish,
 *  hand-enterable and scored, so it lives on the finish row itself. Average
 *  speed is derived from that and `distanceKm` at render, never stored. */
export interface FinishTrackData {
  /** Distance to the line at the starting signal, metres. Sign convention is
   *  the device's own; stored verbatim. */
  dtlAtStartM?: number;
  /** Distance sailed over the race, km — the unit the export uses. */
  distanceKm?: number;
  maxSpeedKts?: number;
}

export interface Finish {
  id: string;
  raceId: string;
  competitorId: string | null;    // null for unresolved unknown finishes
  unknownSailNumber?: string;     // set when competitorId is null
  // How this row was identified, when it was not by the competitor's
  // registered sail number: `bow` for a bow number, `alternative` for one of
  // the competitor's alternative sail numbers. `enteredSailNumber` is the text
  // that actually matched — so a boat that raced under a replacement sail is
  // recorded as having done so, even though the row displays the registered
  // number. Both record how the row was entered, not a current fact: they may
  // go stale if the competitor's numbers are later edited.
  matchedOn?: 'bow' | 'alternative';
  enteredSailNumber?: string;
  sortOrder: number | null;       // crossing-order index in the unified finish sheet; null for coded finishes (except RDG: may be set alongside RDG)
  // Per ADR-008 Phase 6 (#111): explicit tie marker. The scoring engine
  // treats a finisher with `tiedWithPrevious === true` as sharing the
  // immediately-prior row's place (RRS A8.1 averaged ranks). Stored
  // separately from sortOrder so the visible row order stays stable —
  // sortOrders remain monotonically increasing per race.
  tiedWithPrevious: boolean;
  finishTime?: string;            // "HH:MM:SS" — time of day the boat crossed the line; ET = finishTime − startTime
  // The boat's elapsed time in seconds, when that is what was recorded: a
  // stopwatch on the finish boat, or an electronic export whose elapsed
  // figure is the measurement and whose time of day is a rendering of it.
  // The fractional part is kept as recorded; the engine rounds half-up to
  // whole seconds, the convention it applies to every other elapsed time.
  // When a row carries both this and `finishTime`, this wins — it is the
  // measurement, and the time of day is derived from it.
  elapsedSecs?: number;
  trackData?: FinishTrackData;    // how the boat sailed the race (RaceSense import); display-only, never scored
  resultCode: ResultCode | null;  // null if sortOrder is set (RDG may coexist with sortOrder)
  startPresent: boolean | null;   // true if observed in starting area; null if not recorded
  penaltyCode: PenaltyCode | null;    // additive penalty (ZFP/SCP/DPI); only for finishers
  penaltyOverride: number | null;     // SCP: explicit %; DPI: explicit points; null = use default
  // What a DPI was given for, in the scorer's own words ("TPO", "Safety
  // briefing"). Published in place of the code, with a legend beneath the
  // table saying it is a discretionary points penalty. Purely a label: the
  // points come from penaltyOverride and nothing here reaches the engine.
  // DPI only — ZFP and SCP are RRS codes whose meaning is already fixed.
  penaltyLabel?: string;
  // Per-fleet DPI points for a boat scored in more than one fleet. When present
  // (non-empty) the boat is in per-fleet mode: each key is a fleetId → added
  // points for that fleet, and a fleet absent from the map is a gap (no penalty
  // applied, surfaced via a scoring rejection). `penaltyOverride` is the uniform
  // value used when this map is absent (and the SCP percentage either way).
  penaltyOverrideByFleet?: Record<string, number>;
  // Redress (RDG) — all null unless resultCode === 'RDG'.
  //   all_races          — RRS A9(a): mean of all other races (incl. DNC etc.)
  //   all_races_excl_dnc — mean of all other races, excluding DNC results up to
  //                        the series discard allowance (HalSail RDG type 2)
  //   races_before       — mean of races before this one
  //   stated             — scorer-entered points
  redressMethod: 'all_races' | 'all_races_excl_dnc' | 'races_before' | 'stated' | null;
  redressExcludeRaceIds: string[] | null; // exclude-mode: remove these races (by id) from method-default pool
  redressIncludeRaceIds: string[] | null; // include-mode: use only these races (by id; overrides method default)
  redressIncludeAllLater: boolean;      // include-mode: also include all races sailed after the latest included race
  redressPoints: number | null;         // stated-method: scorer-entered points value
  // Per-fleet stated points for a boat scored in more than one fleet. When
  // present (non-empty) the boat is in per-fleet mode: each key is a fleetId →
  // stated points for that fleet, and a fleet absent from the map is a gap
  // (scored as the A9(a) average pending a value, surfaced via a scoring
  // rejection). `redressPoints` is the uniform value used when this map is
  // absent. Only meaningful when redressMethod === 'stated'.
  redressPointsByFleet?: Record<string, number>;
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
  orc?: OrcRaceCalc;             // present on ORC time-on-distance/PCS fleets
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
  // Sub-series (block) the page covers, by name. Absent for whole-series
  // pages; a series with sub-series publishes one page per (block, fleet).
  subSeriesName?: string;
  // The prize sheet (#240) — `fleetName` is then "Prizes". Lets the listing
  // label the page as prizes rather than as a fleet's standings.
  isPrizes?: boolean;
  // The competitor list (#423) — `fleetName` is then "Entries". Like the prize
  // sheet, it is labelled by its own name and never counts as a results page.
  isEntryList?: boolean;
  // The publication's lone default page. Recorded so a re-publish that skips
  // it can recognise it: its fleet name may be the synthetic "Default" or
  // "Unknown", so the name is not a reliable handle.
  isDefault?: boolean;
  // A supporting page that is not a fleet's results — a split-fleet series'
  // fleet assignments. Listings label it by its own name and never count it
  // when deciding whether a publication has a lone results page.
  isAuxiliary?: boolean;
  // The page's name is its own rather than a fleet's, so listings show it
  // verbatim — a championship's standings page is called "Championship". It
  // still counts as the publication's results page, unlike an auxiliary one.
  isNamedPage?: boolean;
  // Published at race-results detail (#347). Lets a listing call a lone page
  // "Results" rather than "Standings"; the page itself carries no summary.
  // Sparse — absent on every full-detail page, and on prize sheets.
  isRaceResults?: boolean;
  // Sub-path under the slug: `standings` for a single (default) fleet, or
  // `kebab(fleetName)` for a named fleet — prefixed `kebab(block)/` for a
  // sub-series page. Never empty (the bare slug is the listing). The full
  // path is `/p/{workspaceSlug}/{slug}/{subPath}`.
  subPath: string;
  blobUrl: string;     // storage locator (Vercel Blob URL, or `db:` key in dev)
}

export interface PublishedSeries {
  id: string;
  workspaceId: string;
  seriesId: string | null;       // null = orphaned (the series was deleted)
  slug: string;                  // public slug within the workspace
  pages: PublishedSeriesPage[];
  // The public data file (ADR-012): the sanitized export served beside the
  // pages at `/p/{ws}/{slug}/{dataSubPath}`. Absent/null when the series
  // opts out of the JSON export or builds none (split-fleet championships).
  dataSubPath?: string | null;
  dataBlobUrl?: string | null;
  contentHash: string;           // hash over all page HTML + the data file; unchanged ⇒ skip re-upload
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
  // One entry per page: per fleet, or per (sub-series, fleet) when the
  // series has blocks.
  pages: { fleetName: string; subSeriesName?: string; url: string }[];
  // Public URL of the publication's `.sailscoring.json` data file (ADR-012),
  // when it published one.
  dataUrl?: string;
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
  /** The workspace's seasons for the dialog's Season control (ADR-011):
   *  defined + derived, newest first; the series' own start-date season is
   *  always among them. */
  seasons: { label: string; current: boolean }[];
  /** The season the dialog defaults to: the series' start-date year, or the
   *  current year for an undated series. */
  suggestedSeason: string;
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
  seriesId: string | null;        // authoring link target; null for an orphan
  orphaned: boolean;              // the series was deleted (the snapshot lives on)
  publishedAt: number;            // Unix ms of the last publish
  editsSincePublish: number;      // series edits since the snapshot (0 if orphaned)
  sharedWith: string[];           // titles of other publications sharing this slug
  fleetCount: number;             // published fleet pages under the slug's entry
  // Placement on the management page's sections (ListingPlacement) — this
  // publication's own series, unlike the public listing's per-slug
  // representative. All null-ish for an orphan.
  archived: boolean;
  categoryName: string | null;
  categoryOrder: number | null;
  seriesOrder: number | null;
  year: number | null;
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

/** How a logo is grouped in the flag locker (the per-workspace logo library).
 *  The same vocabulary the canonical tier will use (see
 *  docs/notes/canonical-logo-library.md §3); purely organisational here. */
export type LogoClass =
  | 'governing-body'
  | 'sailing-club'
  | 'class-assoc'
  | 'sponsor'
  | 'venue';

/** A logo in a workspace's flag locker. Metadata only — the asset bytes are
 *  served from `/api/v1/logos/{id}/raw` (and, in a later phase, a public
 *  indirection URL the renderer links to). */
export interface Logo {
  id: string;
  displayName: string;
  logoClass: LogoClass;
  contentType: string;
  byteSize: number;
  sha256: string;
  sourceUrl: string;  // '' if unset, mirroring Series.venueUrl/eventUrl
}

/** A workspace's default venue/event logo URLs. A newly-created series inherits
 *  these into its empty burgee slots (copy-at-creation). Stored as URLs (like a
 *  series slot), so a default can be a workspace logo, a built-in canonical
 *  logo, or any URL. '' = no default. */
export interface LogoDefaults {
  venueLogoUrl: string;
  eventLogoUrl: string;
}

export interface Standing {
  rank: number;
  competitor: Competitor;
  racePoints: number[];                  // points per race, in race order, after any Race.pointsMultiplier — the scores that sum to totalPoints
  raceRanks: (number | null)[];          // within-fleet finish rank per race (1/2/3… for clean finishers); null for coded/penalty/redress/excluded/not-yet-sailed
  raceCodes: (ResultCode | null)[];      // result code per race (null = normal finish)
  racePenaltyCodes: (PenaltyCode | null)[];        // additive penalty per race (null = no penalty)
  racePenaltyOverrides: (number | null)[];          // override value per race (SCP %  or DPI pts; null = no override / no penalty)
  // Scorer's label for a DPI per race (null in a slot with none, or a
  // non-DPI penalty). Optional: sparse, and a Standing built outside the
  // engine has nothing to say about labels.
  racePenaltyLabels?: (string | null)[];
  totalPoints: number;
  netPoints: number;                     // totalPoints minus discarded points
  raceDiscards: boolean[];               // true = this race is discarded from series total
  raceNonDiscardable: boolean[];         // true = this code cannot be excluded by discard rules (DNE)
  raceRedressFlags: boolean[];           // true = this race score was calculated via RDG (A9 average)
  raceExcluded: boolean[];               // true = nobody finished this race; it scores 0 and does not count toward discards
}

export type ScoringRejectionReason =
  | 'no_rating'
  | 'no_starting_tcf'
  // A multi-fleet boat has per-fleet stated redress points but none set for
  // this fleet — scored as the A9(a) average until the scorer enters one.
  | 'rdg_missing_fleet_points'
  // A multi-fleet boat has a per-fleet DPI penalty but none set for this fleet
  // — no penalty applied until the scorer enters one.
  | 'dpi_missing_fleet_points';

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
  /** The revision whose snapshot covers this change (#354), or null when no
   *  revision captured it — a workspace-organisation action that stores no
   *  recoverable state, or a change that predates the attribution column. */
  revisionId: string | null;
}

/** A single revision in a series' history (#166). Metadata only — the full
 *  point-in-time snapshot blob is fetched separately when viewing or reverting. */
export interface RevisionEntry {
  id: string;
  seriesId: string;
  /** `auto` = session-coalesced autosave; `named` = pinned checkpoint;
   *  `revert` = a restore of an earlier revision; `publish` / `saved` =
   *  milestones captured when results are published or saved to a file. */
  kind: 'auto' | 'named' | 'revert' | 'publish' | 'saved';
  /** User-supplied name for a `named` checkpoint; null otherwise. */
  label: string | null;
  /** Short human description of what the revision captured, if any. */
  summary: string | null;
  /** ISO-8601 timestamp of the revision (end of its editing session). */
  createdAt: string;
  actor: { id: string; email?: string; displayName?: string } | null;
  /** Whether the snapshot blob is still stored. Old auto revisions are thinned
   *  (#166) — the row stays for the timeline/audit but can no longer be restored. */
  hasSnapshot: boolean;
}

/** A soft-deleted series in the workspace Trash ("Recover a deleted series").
 *  Metadata only — the whole-series snapshot blob stays server-side and is
 *  decoded only when the entry is recovered. */
export interface DeletedSeriesEntry {
  /** The tombstone id (what recover / permanent-delete address). */
  id: string;
  /** The original series id, preserved so recovery restores it unchanged. */
  seriesId: string;
  name: string;
  /** ISO-8601 timestamp of the deletion. */
  deletedAt: string;
  actor: { id: string; email?: string; displayName?: string } | null;
  /** The series had a live published results page when deleted — left orphaned
   *  (still online, disconnected), so the Trash view notes it. */
  hadPublication: boolean;
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
