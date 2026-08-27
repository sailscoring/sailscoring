import type { FinishTrackData, Fleet, ResultCode, PenaltyCode, CompetitorFieldKey, MultiPersonFieldKey, OrcCourseLeg, OrcRaceCalc, PrimaryPersonLabel, RaceConditions, RaceDiscardPolicy, RaceOfficial, SubdivisionAxis } from './types';
import { escapeHtml as esc } from './html';
import { elapsedSecondsOf } from './elapsed-time';
import { parseHmsToSeconds } from './time-parse';
import {
  avgSpeedKnText,
  distanceKmText,
  dtlAtStartText,
  elapsedText,
  finishTimeText,
  maxSpeedKtsText,
  type TrackDataCell,
} from './track-data';
import {
  PRIMARY_PERSON_LABEL_TEXT,
  formatPrimaryNames,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  isFieldDisabledByPrimary,
  personFieldHeader,
  primaryPersonHeader,
} from './competitor-fields';
import { formatConditions, hasConditions } from './race-conditions';
import { formatOfficials, hasOfficials } from './race-officials';
import { compareSailNumbers } from './sail-number-sort';
import { roundCorrectedSecs } from './scoring';
import { seriesSlug } from './series-name';
import { worldSailingProfileUrl } from './world-sailing';
import { ordinal } from './ordinal';
import { describePrizeClauses, type PrizeAllocation } from './prizes';
import {
  formatMultiplier,
  hasScoringOptions,
  raceMultiplier,
  racePolicy,
  scoringOptionsLegend,
} from './race-scoring-options';

/** Column heading for a subdivision axis, falling back to the default label when
 *  the axis label is blank. */
function axisHeader(axis: SubdivisionAxis): string {
  return axis.label?.trim() || DEFAULT_SUBDIVISION_LABEL;
}

// ---- Input types ----

export interface SeriesResultsData {
  series: {
    name: string;
    venue: string;
  };
  /** When set, adds a fleet heading to the page title and above the summary table. */
  fleetName?: string;
  leftLogoUrl?: string;
  rightLogoUrl?: string;
  /** Website the left (venue) header logo / footer link points to. */
  leftUrl?: string;
  /** Website the right (event) header logo / footer link points to. */
  rightUrl?: string;
  /** If set, renders "Results are provisional as of HH:MM on Month D, YYYY" */
  generatedAt?: Date;
  /** Results marked final: the stamp reads "Results are final …" instead of
   *  the provisional-as-of line. */
  resultsFinal?: boolean;
  /** When the results were marked final; dates the final stamp. */
  finalisedAt?: Date;
  /** Which optional competitor fields the scorer has enabled for this series.
   *  Drives column visibility in the summary and race tables. The Boat column
   *  is shown iff this list contains 'boatName'; the helm cell includes the
   *  crew name iff this list contains 'crewName'. */
  enabledCompetitorFields: CompetitorFieldKey[];
  /** Label for the primary person slot (`Competitor.name`). Drives the
   *  summary and race table column heading that corresponds to the primary
   *  name. Defaults to "Competitor" if not set (matching v1 files). */
  primaryPersonLabel?: PrimaryPersonLabel;
  /** Person fields the series has opened to multiple names (#316). Their
   *  column headers read plural, so a reader meeting two names stacked in a
   *  cell isn't left wondering. Absent/empty = all single. */
  multiPersonFields?: MultiPersonFieldKey[];
  /** Named subdivision axes, e.g. a "Division" and an "Age category"
   *  axis. Each becomes a prize-giving column (one per axis) in the summary and
   *  race tables, headed by its label, suppressed when no competitor has a value
   *  on it. Absent/empty = no subdivision columns. */
  subdivisionAxes?: SubdivisionAxis[];
  /** Races in series order */
  races: RaceData[];
  /** Standings sorted by rank ascending */
  standings: StandingRowData[];
  /** Full import URL, e.g. https://app.sailscoring.ie/?import=<base64url>. When set,
   *  adds an "Open in Sail Scoring" link to the footer. */
  openInAppUrl?: string;
  /** Series-index URL (`/p/{ws}/{slug}`) of the publication this page belongs to.
   *  Set only on the in-app publish path, where the page lives under a known
   *  slug; when set, a `← {series name}` breadcrumb links up to that listing.
   *  Left unset for standalone HTML downloads, FTP uploads, and previews, whose
   *  output has no `/p/` parent to point at. */
  seriesIndexUrl?: string;
  /** Progressive scoring system for the rendered fleet, if any. Drives the
   *  seed-rating column header label ("NHC1" / "ECHO") and is paired with
   *  `showPerRaceRatings` to decide whether the summary surfaces per-race
   *  applied ratings. Unset for static or non-handicap fleets. */
  progressiveScoringSystem?: 'nhc' | 'echo';
  /** When true and `progressiveScoringSystem` is set, the summary table
   *  gains a seed-rating column and prints the applied rating in small text
   *  beneath each score from R2 onwards. R1 is suppressed since the seed
   *  column carries it. */
  showPerRaceRatings?: boolean;
  /** Optional flag-SVG payload, keyed by canonical 3-letter code. When set,
   *  the renderer emits one `<defs><symbol id="flag-XXX">` per code at the
   *  top of `<body>` and references it via `<use>` in the Nat column. Codes
   *  not present here fall back to text-only. Kept opt-in so client bundles
   *  that pull `results-renderer` don't drag in the ~2.5 MB flag dataset —
   *  the export flow imports `lib/nationality/flags` dynamically and slices
   *  it down to the codes actually referenced. */
  flagSvgByCode?: Readonly<Record<string, { viewBox: string; inner: string }>>;
  /** The event's standing race management team (#339). Set by the caller only
   *  when the series has opted into publishing officials. */
  officials?: RaceOfficial[];
}

export interface RaceData {
  raceNumber: number;
  date: string; // ISO date string
  name?: string | null; // optional race label, shown in the section heading + column tooltip
  label: string; // column header, e.g. "R1" or "R3 Jul 23"
  anchorId: string; // in-page anchor, e.g. "r1"
  /** Per-race scoring options (#342). The summary table marks the column
   *  ("R4 ×2 *") and names it in a legend beneath; the race's own section
   *  states it in words. Absent on an ordinary race. */
  discardPolicy?: RaceDiscardPolicy;
  pointsMultiplier?: number;
  /** What the race was sailed in, and the course used (#338). Stated in words
   *  above the race table. */
  conditions?: RaceConditions;
  /** Who ran this race (#339). Set only when the series has opted into
   *  publishing officials. */
  officials?: RaceOfficial[];
  startTime?: string; // "HH:MM:SS" gun time for this fleet (handicap fleets only)
  results: RaceResultData[];
  /** True when the fleet uses NHC scoring. Drives the "TCF" rating column
   *  label (vs. "TCC") and, when nhcHeader is also set, the explainability
   *  columns that hide under the viewer toggle. Decoupled from nhcHeader so
   *  the base rating/finish/elapsed/corrected columns still render when the
   *  scorer has opted out of publishing rating calculations. */
  isNhc?: boolean;
  /** True when the fleet uses ECHO scoring. Drives the "Starting H" rating
   *  column label and, when echoHeader is also set, the IS-notation
   *  explainability columns (1/T_E, PI, Adjustment, New H) hidden under
   *  the ECHO viewer toggle. */
  isEcho?: boolean;
  /** True for an ORC race scored time-on-distance (the option resolves per
   *  race): the rating column holds allowances in s/NM (labelled "ToD",
   *  printed to 1 dp) and corrected times come from the engine rather than
   *  an ET × TCF recompute. Also set for PCS races — their applied rating
   *  is a ToD at the scoring wind. */
  isOrcTod?: boolean;
  /** True for an ORC race scored by performance curves: adds the implied
   *  wind column so competitors can check the scoring wind derivation. */
  isOrcPcs?: boolean;
  /** ORC fleet-race header: the option the race was scored on and the
   *  correction ingredients — and, for PCS, the scoring wind with its
   *  source and the course record. Always rendered when present: the audit
   *  trail is the point. */
  orcHeader?: OrcHeaderData;
  /** NHC fleet-race-level aggregates. When set, renders the rating-calculation
   *  fleet header line above the race table and extra explainability columns
   *  (CT ratio, Fair TCF, Adjustment, New TCF) under the viewer toggle. */
  nhcHeader?: NhcHeaderData;
  /** ECHO fleet-race-level aggregates. When set, renders the IS-notation
   *  fleet header line (α · Finishers · ΣH_S · Σ(1/T_E)) above the race
   *  table and the ECHO explainability columns (1/T_E, PI, Adjustment,
   *  New H) under the ECHO viewer toggle. */
  echoHeader?: EchoHeaderData;
}

export interface OrcHeaderData {
  /** The scoring option the race resolved to — names the certificate
   *  rating field on a single-number or band-scored race. */
  option?: string;
  /** ToD/PCS: the scratch boat's allowance (s/NM) the fleet corrected
   *  against. Absent on a ToT band race, which has no correction header
   *  beyond the field name. */
  scratchTod?: number;
  distanceNm?: number;
  /** PCS: the wind corrected times were computed at. */
  scoringWind?: number;
  /** PCS: the scoring wind was set by the race committee (rule 402.12). */
  scoringWindOverridden?: boolean;
  /** PCS: 'WL' | 'CR' | 'OC' | 'CC'. */
  courseModel?: string;
  /** Constructed-course legs, published as the course record. */
  legs?: OrcCourseLeg[];
}

export interface NhcHeaderData {
  finisherCount: number;
  ctAvgSecs: number;
  meanTcf: number;
  /** Fleet-wide P50 = mean(L) / mean(O). */
  p50: number;
  /** Non-extreme W51 = mean(L_non-ext) / mean(O_non-ext); null when the
   *  recompute didn't run (no non-extreme subset, or strategy disabled). */
  w51: number | null;
  /** μ(S) — fleet mean of comparative scores S = Q/L. */
  sMean: number;
  /** σ(S) — population standard deviation of S. */
  sStdev: number;
  /** Upper extreme threshold: sMean + sdOver·sStdev. */
  sHi: number;
  /** Lower extreme threshold: sMean − sdUnder·sStdev. */
  sLo: number;
  /** Count of boats classified as extreme this race. */
  extremeCount: number;
  /** Z51 = ΣL / ΣZ over finishers — fleet-sum realignment factor. */
  realignmentFactor: number;
  /** True when finisherCount < MinFin (3 by default); no rating update. */
  updateSuppressed: boolean;
}

export interface EchoHeaderData {
  alpha: number;
  finisherCount: number;
  /** ΣH_S — sum of starting handicaps across finishers (Irish Sailing 2022 guide). */
  sumH: number;
  /** Σ(1/T_E) — sum of reciprocals of elapsed times across finishers. */
  sumReciprocalEt: number;
  /** True when the IS guide's ≤2-finisher gate fired (no rating update). */
  updateSuppressed: boolean;
}

export interface RaceResultData {
  sailNumber: string;
  /** Bow number, when the boat carries one distinct from its sail number. */
  bowNumber?: string;
  /** The OA's registration number for the entry. */
  entryNumber?: string;
  /** The safety tally token issued at registration. */
  tallyNumber?: string;
  boatName?: string;
  boatClass?: string;
  /** Primary person(s) — labelled per `SeriesResultsData.primaryPersonLabel`. */
  helm: string[];
  /** Owner(s) when recorded separately from the primary (helm-primary series). */
  owner?: string[];
  /** Helm(s) when recorded separately from the primary (owner-primary series). */
  helmRole?: string[];
  crewNames?: string[];
  /** Sailing club affiliation. */
  club?: string;
  /** 3-letter national-letters code (RRS Appendix G / IOC). */
  nationality?: string;
  /** World Sailing Sailor ID, linked to the sailor's biography. */
  worldSailingId?: string;
  /** Per-axis subdivision values, keyed by `SubdivisionAxis.id`. */
  subdivisions?: Record<string, string>;
  /** Competitor gender, rendered as the raw "M"/"F" code. */
  gender?: 'M' | 'F' | '';
  /** Competitor age in years. */
  age?: number;
  place: number | null;   // internal sort key for display order; null for coded finishes
  rank: number | null;    // within-fleet finish rank; null for coded finishes
  points: number;
  resultCode: ResultCode | null;
  penaltyCode: PenaltyCode | null;
  penaltyOverride: number | null;
  /** DPI only: the scorer's own name for the penalty (#424). */
  penaltyLabel?: string;
  // Handicap fields — only set for IRC/PY fleets
  tcc?: number;              // Time Correction Factor (TCC for IRC, 1000/PY for PY)
  tccOverride?: boolean;     // true when tcc is a per-race override (mid-series rating change)
  impliedWind?: number;      // ORC PCS: the boat's implied wind (kt)
  finishTime?: string;       // "HH:MM:SS"; also set for scratch fleets when track data is published
  /** The elapsed time as recorded, fractional part kept. Distinct from
   *  `elapsedTimeSecs`: that is the whole-second ET the engine scored from,
   *  this is what the finish sheet or the device actually wrote down. */
  elapsedSecs?: number;
  elapsedTimeSecs?: number;  // integer seconds (finishTime − startTime)
  correctedTimeSecs?: number; // integer seconds, rounded half-up (elapsedTimeSecs × tcc)
  /** RaceSense track data (published only on the series' opt-in). */
  trackData?: FinishTrackData;
  // NHC fields — only set for NHC fleets when explainability is enabled
  nhc?: NhcCellData;
  // ECHO fields — only set for ECHO fleets when explainability is enabled
  echo?: EchoCellData;
}

/** NHC per-finisher intermediates for the SWNHC2015 explainability columns.
 *  Set on every NHC competitor (including non-finishers — for non-finishers
 *  the cell renderer leaves intermediate columns blank and shows "unchanged"
 *  in the New TCF column). */
export interface NhcCellData {
  tcfApplied: number;
  newTcf: number;
  /** Q_i = O_i × P50 — fair TCF (4 dp). */
  fairTcf?: number;
  /** S_i = Q_i / tcfApplied — comparative score (4 dp). */
  compScore?: number;
  /** True iff S_i fell outside [sLo, sHi]. */
  isExtreme?: boolean;
  /** Direction of extreme classification; absent for non-extreme rows. */
  extremeDirection?: 'fast' | 'slow';
  /** Per-boat α actually used (one of alphaP/alphaN/alphaPX/alphaNX). */
  alphaApplied?: number;
  /** Z_i — blended pre-realignment value. New TCF = Z_i × Z51, rounded. */
  provisionalTcf?: number;
  /** Signed: newTcf − tcfApplied (post-realignment). */
  adjustment?: number;
  isFinisher: boolean;
}

/** ECHO per-finisher intermediates for the IS-notation explainability
 *  columns. Set on every ECHO competitor (including non-finishers — for
 *  non-finishers the cell renderer leaves intermediate columns blank and
 *  shows "unchanged" in the New H column). */
export interface EchoCellData {
  /** Starting handicap H entering this race (= rrat snapshot). */
  startingH: number;
  /** Handicap to apply in race N+1. */
  newH: number;
  /** 1/T_E in seconds⁻¹ — finishers only. Lets a verifier sum the column
   *  to recover Σ(1/T_E) shown in the fleet header. */
  reciprocalEt?: number;
  /** Performance Index = ΣH_S / (T_E_i × Σ(1/T_E)) — finishers only. */
  pi?: number;
  /** α × (PI − H), signed — finishers only. */
  adjustment?: number;
  isFinisher: boolean;
}

export interface StandingRowData {
  rank: number;
  sailNumber: string;
  /** Bow number, when the boat carries one distinct from its sail number. */
  bowNumber?: string;
  /** The OA's registration number for the entry. */
  entryNumber?: string;
  /** The safety tally token issued at registration. */
  tallyNumber?: string;
  boatName?: string;
  boatClass?: string;
  /** Primary person(s) — labelled per `SeriesResultsData.primaryPersonLabel`. */
  helm: string[];
  /** Owner(s) when recorded separately (helm-primary series). */
  owner?: string[];
  /** Helm(s) when recorded separately (owner-primary series). */
  helmRole?: string[];
  crewNames?: string[];
  /** Sailing club affiliation. */
  club?: string;
  /** 3-letter national-letters code (RRS Appendix G / IOC). */
  nationality?: string;
  /** World Sailing Sailor ID, linked to the sailor's biography. */
  worldSailingId?: string;
  /** Per-axis subdivision values for the prize-giving columns, keyed by
   *  `SubdivisionAxis.id`. */
  subdivisions?: Record<string, string>;
  /** Competitor gender, rendered as the raw "M"/"F" code. */
  gender?: 'M' | 'F' | '';
  /** Competitor age in years. */
  age?: number;
  /** Initial rating for NHC/ECHO competitors (TCF or H). Rendered in the
   *  seed-rating column when the summary surfaces per-race ratings. */
  seedRating?: number;
  raceScores: RaceScoreData[];
  totalPoints: number;
  netPoints: number;
}

export interface RaceScoreData {
  points: number;
  resultCode: ResultCode | null;
  penaltyCode: PenaltyCode | null;
  penaltyOverride: number | null;
  /** DPI only: the scorer's own name for the penalty, shown instead of the
   *  code, with a legend beneath the table explaining it. */
  penaltyLabel?: string;
  isDiscard: boolean;
  isRedress: boolean;
  /** True when the race had no finishers and was excluded from scoring (issue #129). */
  isExcluded?: boolean;
  podiumRank: 1 | 2 | 3 | null;
  /** Applied rating for this competitor in this race (NHC TCF / ECHO H).
   *  Surfaced beneath the score when the summary table is rendering per-race
   *  ratings; left undefined for R1 (the seed column carries it) and for
   *  non-progressive fleets. */
  appliedRating?: number;
}

// ---- Renderer ----

/** Per-section display state derived from one fleet's SeriesResultsData:
 *  which optional columns are visible, the primary-name column header, and
 *  whether the summary carries a seed-rating column. Computed once per
 *  section and shared by the summary and race tables; a combined document
 *  computes one per fleet section, so each fleet keeps its own column set. */
interface SectionView {
  hasDiscards: boolean;
  showBowNumber: boolean;
  showEntryNumber: boolean;
  showTallyNumber: boolean;
  showBoatName: boolean;
  showBoatClass: boolean;
  showHelm: boolean;
  showOwner: boolean;
  showCrewName: boolean;
  showClub: boolean;
  showNationality: boolean;
  showWorldSailingId: boolean;
  visibleSubdivisionAxes: SubdivisionAxis[];
  showAge: boolean;
  showGender: boolean;
  primaryHeader: string;
  helmHeader: string;
  ownerHeader: string;
  crewHeader: string;
  summaryRatingSystem: 'nhc' | 'echo' | null;
}

function computeSectionView(data: SeriesResultsData): SectionView {
  const { enabledCompetitorFields, primaryPersonLabel, multiPersonFields, races, standings, progressiveScoringSystem, showPerRaceRatings } = data;
  const summaryRatingSystem = showPerRaceRatings && progressiveScoringSystem ? progressiveScoringSystem : null;

  const primaryLabel = primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const primaryHeader = primaryPersonHeader(primaryLabel, multiPersonFields);
  const helmHeader = personFieldHeader('helm', multiPersonFields);
  const ownerHeader = personFieldHeader('owner', multiPersonFields);
  const crewHeader = personFieldHeader('crewName', multiPersonFields);
  const hasDiscards = standings.some((s) => s.netPoints !== s.totalPoints);
  // The identifier numbers a boat carries besides its sail number. Each is
  // suppressed when no competitor has one, the same rule the Club and Nat
  // columns follow — enabling a field shouldn't publish a dead column.
  const identifierShown = (
    key: 'bowNumber' | 'entryNumber' | 'tallyNumber',
    of: (row: { bowNumber?: string; entryNumber?: string; tallyNumber?: string }) => string | undefined,
  ): boolean =>
    enabledCompetitorFields.includes(key) &&
    (standings.some((s) => !!of(s)) || races.some((r) => r.results.some((x) => !!of(x))));
  const showBowNumber = identifierShown('bowNumber', (r) => r.bowNumber);
  const showEntryNumber = identifierShown('entryNumber', (r) => r.entryNumber);
  const showTallyNumber = identifierShown('tallyNumber', (r) => r.tallyNumber);
  const showBoatName = enabledCompetitorFields.includes('boatName');
  const showBoatClass = enabledCompetitorFields.includes('boatClass');
  const showHelm = enabledCompetitorFields.includes('helm') && !isFieldDisabledByPrimary('helm', primaryLabel);
  const showOwner = enabledCompetitorFields.includes('owner') && !isFieldDisabledByPrimary('owner', primaryLabel);
  const showCrewName = enabledCompetitorFields.includes('crewName');
  // Suppress the Club column if nothing references it \u2014 a single-club event
  // shouldn't get a dead column just because the field is enabled. Mirrors the
  // Nat-column behaviour and checks both summary and race tables.
  const showClub =
    enabledCompetitorFields.includes('club') &&
    (standings.some((s) => !!s.club) || races.some((r) => r.results.some((x) => !!x.club)));
  // Suppress the Nat column if nothing references it \u2014 the toggle being on
  // shouldn't add an empty column when no competitor has a nationality.
  const showNationality =
    enabledCompetitorFields.includes('nationality') &&
    (standings.some((s) => !!s.nationality) || races.some((r) => r.results.some((x) => !!x.nationality)));
  // Sailor IDs, linked to World Sailing biographies. Suppressed when nothing
  // references one, like the Club and Nat columns.
  const showWorldSailingId =
    enabledCompetitorFields.includes('worldSailingId') &&
    (standings.some((s) => !!s.worldSailingId) ||
      races.some((r) => r.results.some((x) => !!x.worldSailingId)));
  // One prize-giving column per subdivision axis; suppress an axis if no
  // competitor has a value on it, mirroring the Nat-column behaviour.
  const visibleSubdivisionAxes = enabledCompetitorFields.includes('subdivision')
    ? (data.subdivisionAxes ?? []).filter((axis) =>
        standings.some((s) => !!s.subdivisions?.[axis.id]),
      )
    : [];
  // Age and Gender columns, suppressed when no competitor has a value — same
  // treatment as the Club/Nat columns.
  const showAge =
    enabledCompetitorFields.includes('age') &&
    (standings.some((s) => s.age != null) || races.some((r) => r.results.some((x) => x.age != null)));
  const showGender =
    enabledCompetitorFields.includes('gender') &&
    (standings.some((s) => !!s.gender) || races.some((r) => r.results.some((x) => !!x.gender)));

  return {
    hasDiscards,
    showBowNumber,
    showEntryNumber,
    showTallyNumber,
    showBoatName,
    showBoatClass,
    showHelm,
    showOwner,
    showCrewName,
    showClub,
    showNationality,
    showWorldSailingId,
    visibleSubdivisionAxes,
    showAge,
    showGender,
    primaryHeader,
    helmHeader,
    ownerHeader,
    crewHeader,
    summaryRatingSystem,
  };
}

/** Every nationality code referenced across the given sections, sorted for
 *  deterministic output. Codes the caller supplied a flag for get a single
 *  `<symbol>` definition; codes without flags fall back to text rendering. */
function collectReferencedCodes(sections: SeriesResultsData[]): string[] {
  const set = new Set<string>();
  for (const data of sections) {
    for (const s of data.standings) if (s.nationality) set.add(s.nationality);
    for (const r of data.races) for (const x of r.results) if (x.nationality) set.add(x.nationality);
  }
  return [...set].sort();
}

/**
 * How much of a section to render:
 *   - `full` — the summary standings table, then the per-race detail tables.
 *   - `standings` — the summary alone (a combined page's standings view, #255).
 *   - `races` — the per-race tables alone (#347): a single-race event publishes
 *     its race result, not a one-race series table whose total is the race
 *     score and whose discard columns mean nothing.
 */
export type SectionDetail = 'full' | 'standings' | 'races';

/**
 * The races whose detail tables a section publishes: those with finishers,
 * trimmed to the last `recentRaces` when the page sets a limit (#372). The
 * standings are never trimmed — the limit is about how tall the page is, and
 * that is the race tables.
 */
function detailedRaces(data: SeriesResultsData, recentRaces?: number): RaceData[] {
  const scored = data.races.filter((race) => race.results.length > 0);
  return recentRaces != null && recentRaces > 0 && recentRaces < scored.length
    ? scored.slice(-recentRaces)
    : scored;
}

/** One fleet section's summary standings table. A race column header links to
 *  its detail table only when that table is on the page — so the headers go
 *  plain on a standings-only page, and on the races a `recentRaces` limit
 *  trimmed away. */
function renderSectionSummary(
  data: SeriesResultsData,
  view: SectionView,
  linkedAnchorIds: ReadonlySet<string>,
): string {
  return renderSummaryTable(data.standings, data.races, view, linkedAnchorIds, data.flagSvgByCode);
}

/** One fleet section's per-race detail tables, empty when no race has
 *  finishers. */
function renderSectionRaceTables(
  data: SeriesResultsData,
  view: SectionView,
  detail: SectionDetail,
  recentRaces?: number,
): string {
  const shown = detailedRaces(data, recentRaces);
  // A race-results section with a single race drops the "Race 1" prefix: it is
  // the event's result, and the numbering distinguishes nothing.
  const suppressRaceLabel = detail === 'races' && shown.length === 1;
  return shown
    .map((race) => renderRaceTable(race, view, data.flagSvgByCode, { suppressLabel: suppressRaceLabel }))
    .join('\n');
}

/** Anchor ids of the detail tables a section is publishing — what the summary
 *  is allowed to link to. */
function linkableAnchorIds(data: SeriesResultsData, recentRaces?: number): ReadonlySet<string> {
  return new Set(detailedRaces(data, recentRaces).map((r) => r.anchorId));
}

/** No detail tables on the page, so no race column links. */
const NO_LINKS: ReadonlySet<string> = new Set<string>();

/** One fleet section's tables, per `detail`: the summary followed by the
 *  per-race detail. This is the per-fleet page's whole body; combined pages
 *  assemble the two halves separately (see `renderCombinedSeriesHtml`). */
function renderSectionTables(
  data: SeriesResultsData,
  view: SectionView,
  opts: { detail: SectionDetail; linkRaceLabels: boolean },
): string {
  const linked = opts.linkRaceLabels ? linkableAnchorIds(data) : NO_LINKS;
  if (opts.detail === 'standings') return renderSectionSummary(data, view, linked);
  const raceTables = renderSectionRaceTables(data, view, opts.detail);
  // Never publish blank chrome: a section whose races have no finishers falls
  // back to the summary even when asked for race results alone.
  if (opts.detail === 'races' && raceTables) return raceTables;
  return `${renderSectionSummary(data, view, linked)}\n${raceTables}`;
}

/** Document-level fields shared by the single-fleet and combined renders:
 *  the page chrome (header logos, title, breadcrumb, footer links) around
 *  whatever section content the caller assembled. Exported for the renderers
 *  that assemble their own section content in the same chrome — the prize
 *  sheet (#240) and the as-published archive pages (ADR-010). */
export interface DocumentChrome {
  series: { name: string; venue: string };
  /** Page heading under the series title: the fleet name for a per-fleet
   *  page, the combined page's name for a multi-fleet one. */
  fleetName?: string;
  leftLogoUrl?: string;
  rightLogoUrl?: string;
  leftUrl?: string;
  rightUrl?: string;
  generatedAt?: Date;
  resultsFinal?: boolean;
  finalisedAt?: Date;
  seriesIndexUrl?: string;
  openInAppUrl?: string;
  /** The event's standing race management team, rendered under the results
   *  stamp. The caller has already applied the series' publish opt-in — the
   *  renderer never decides whether officials may be shown. */
  officials?: RaceOfficial[];
}

export function renderSeriesHtml(
  data: SeriesResultsData,
  options?: { fontPercent?: number; detail?: SectionDetail },
): string {
  const fontPercent = options?.fontPercent ?? 72;
  const detail = options?.detail ?? 'full';
  const view = computeSectionView(data);
  const hasNhcDetail = data.races.some((r) => r.nhcHeader != null);
  const hasEchoDetail = data.races.some((r) => r.echoHeader != null);
  const flagDefs = renderFlagDefs(collectReferencedCodes([data]), data.flagSvgByCode);

  const content = [
    hasNhcDetail ? renderNhcToggle() + '\n' + renderNhcExplainer() : '',
    hasEchoDetail ? renderEchoToggle() + '\n' + renderEchoExplainer() : '',
    renderSectionTables(data, view, { detail, linkRaceLabels: detail === 'full' }),
  ].join('\n');

  return renderHtmlDocument(data, content, { fontPercent, hasNhcDetail, hasEchoDetail, flagDefs });
}

/**
 * Render several fleets' results as one document: a combined page. Each
 * section keeps its own column set and (for full detail) its own race
 * tables; the chrome (header, provisional stamp, breadcrumb, footer) comes
 * from the first section, whose fields are identical across sections since
 * they're assembled from the same series. `pageName` is the combined page's
 * title/heading, taking the slot a fleet name occupies on a per-fleet page;
 * each section is headed by its own fleet name.
 *
 * At full detail the page reads standings-first: every fleet's summary table,
 * then every fleet's race detail, each set of races in its own delineated
 * section. That is the shape club results readers know from Sailwave-published
 * pages. The cost is that a fleet name now heads two different blocks, so the
 * race block carries a qualifier and a rule above it — without them it is hard
 * to see where one fleet's races end and the next fleet's begin.
 *
 * With `detail: 'standings'` the
 * per-race detail tables are dropped and each summary's race columns stop
 * linking (their targets aren't rendered); the NHC/ECHO calculation toggles
 * go with them, since the explainability columns live on the detail tables
 * and there is nothing left to toggle. With `detail: 'races'` it is the
 * summaries that go and the toggles stay.
 */
export function renderCombinedSeriesHtml(
  sections: SeriesResultsData[],
  options: {
    pageName: string;
    detail?: SectionDetail;
    fontPercent?: number;
    /** Publish per-race detail for the last N races only (#372). Applies at
     *  full detail; the standings stay the whole series either way. */
    recentRaces?: number;
  },
): string {
  if (sections.length === 0) {
    throw new Error('renderCombinedSeriesHtml requires at least one section');
  }
  const detail = options.detail ?? 'full';
  const standingsOnly = detail === 'standings';
  const fontPercent = options.fontPercent ?? 72;
  const first = sections[0];
  const hasNhcDetail = !standingsOnly && sections.some((s) => s.races.some((r) => r.nhcHeader != null));
  const hasEchoDetail = !standingsOnly && sections.some((s) => s.races.some((r) => r.echoHeader != null));
  // One deduped flag-symbol block for the whole document; the assembly path
  // sets the same payload on every section.
  const flagSvgByCode = sections.find((s) => s.flagSvgByCode)?.flagSvgByCode;
  const flagDefs = renderFlagDefs(collectReferencedCodes(sections), flagSvgByCode);

  const viewed = sections.map((data) => ({ data, view: computeSectionView(data) }));
  const fleetHeading = (data: SeriesResultsData) =>
    data.fleetName ? `<h2>${esc(data.fleetName)}</h2>\n` : '';

  // Applies to the race tables only, and only where they're rendered.
  const recentRaces = detail === 'full' ? options.recentRaces : undefined;
  const trimmed =
    recentRaces != null &&
    sections.some((data) => detailedRaces(data).length > detailedRaces(data, recentRaces).length);

  let sectionHtml: string;
  if (detail === 'full') {
    const standingsHtml = viewed
      .map(
        ({ data, view }) =>
          fleetHeading(data) + renderSectionSummary(data, view, linkableAnchorIds(data, recentRaces)),
      )
      .join('\n');
    const racesHtml = viewed
      .map(({ data, view }) => {
        const tables = renderSectionRaceTables(data, view, 'full', recentRaces);
        if (!tables) return '';
        const heading = data.fleetName
          ? `${esc(data.fleetName)} &mdash; race results`
          : 'Race results';
        // The id gives the races block a stable link target, matching the
        // per-section anchor prefix the assembly path puts on the race
        // anchors themselves.
        const id = data.fleetName ? ` id="${esc(seriesSlug(data.fleetName))}-races"` : '';
        return `<section class="fleetraces"${id}>\n<h2>${heading}</h2>\n${tables}\n</section>`;
      })
      .filter(Boolean)
      .join('\n');
    sectionHtml = racesHtml ? `${standingsHtml}\n${racesHtml}` : standingsHtml;
  } else {
    sectionHtml = viewed
      .map(({ data, view }) => fleetHeading(data) + renderSectionTables(data, view, { detail, linkRaceLabels: false }))
      .join('\n');
  }

  // Say the page is trimmed. Without it a shortened page reads as results
  // gone missing, which is the last thing a results page should suggest.
  const limitNote = trimmed
    ? `<p class="racelimitnote">Race results shown for the ${
        recentRaces === 1 ? 'last race' : `last ${recentRaces} races`
      } &mdash; the standings cover the whole series.</p>`
    : '';

  const content = [
    limitNote,
    hasNhcDetail ? renderNhcToggle() + '\n' + renderNhcExplainer() : '',
    hasEchoDetail ? renderEchoToggle() + '\n' + renderEchoExplainer() : '',
    sectionHtml,
  ].join('\n');

  const chrome: DocumentChrome = {
    series: first.series,
    fleetName: options.pageName,
    leftLogoUrl: first.leftLogoUrl,
    rightLogoUrl: first.rightLogoUrl,
    leftUrl: first.leftUrl,
    rightUrl: first.rightUrl,
    generatedAt: first.generatedAt,
    resultsFinal: first.resultsFinal,
    finalisedAt: first.finalisedAt,
    seriesIndexUrl: first.seriesIndexUrl,
    openInAppUrl: first.openInAppUrl,
    officials: first.officials,
  };
  return renderHtmlDocument(chrome, content, { fontPercent, hasNhcDetail, hasEchoDetail, flagDefs });
}

/** Chrome for the prize-sheet page (#240): the shared document fields without
 *  any per-fleet results data behind them. */
export type PrizesPageChrome = DocumentChrome;

/**
 * Render the prize sheet as one document (#240): each prize is a section —
 * name, eligibility summary, and its recipients table. Follows the SWPrize
 * precedent of a standalone prizes page rather than a table at the foot of
 * the results. Allocation warnings are deliberately NOT rendered: they are
 * authoring concerns (the Prizes tab shows them); the published sheet just
 * shows the places that could be awarded.
 */
export function renderPrizesHtml(
  chrome: PrizesPageChrome,
  allocations: PrizeAllocation[],
  context: {
    fleets: Pick<Fleet, 'id' | 'name'>[];
    axes: SubdivisionAxis[];
    /** Show a Fleet column on recipient rows (multi-fleet series). */
    multiFleet: boolean;
    primaryPersonLabel?: PrimaryPersonLabel;
  },
  options?: { fontPercent?: number },
): string {
  const fontPercent = options?.fontPercent ?? 72;
  const nameHeader = PRIMARY_PERSON_LABEL_TEXT[context.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL];

  const sections = allocations.map(({ prize, recipients }) => {
    const rows = recipients.map((r, i) => {
      const cells = [
        `<td class="${r.position <= 3 ? `rank${r.position}` : ''}">${esc(ordinal(r.position))}</td>`,
        `<td>${esc(r.standing.competitor.sailNumber)}</td>`,
        `<td>${esc(formatPrimaryNames(r.standing.competitor.names))}</td>`,
        ...(context.multiFleet ? [`<td>${esc(r.fleet.name)}</td>`] : []),
        `<td>${r.standing.rank}</td>`,
      ].join('');
      return `<tr class="${i % 2 === 0 ? 'odd' : 'even'}">${cells}</tr>`;
    });
    const header = [
      '<th>Place</th>',
      '<th>SailNo</th>',
      `<th>${esc(nameHeader)}</th>`,
      ...(context.multiFleet ? ['<th>Fleet</th>'] : []),
      '<th>Series rank</th>',
    ].join('');
    const table = recipients.length > 0
      ? `<div class="tablewrap"><table class="summarytable">
<thead><tr>${header}</tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table></div>`
      : '<p>Not yet awarded.</p>';
    return `<h3>${esc(prize.name)}</h3>
<p class="prize-eligibility">${esc(describePrizeClauses(prize.clauses, context.fleets, context.axes))}</p>
${table}`;
  });

  const content = sections.join('\n');
  return renderHtmlDocument(
    { ...chrome, fleetName: 'Prizes' },
    `<style>.prize-eligibility { color: #555; margin: -4px 0 10px 0; }</style>\n${content}`,
    { fontPercent, hasNhcDetail: false, hasEchoDetail: false, flagDefs: '' },
  );
}

/** Chrome for the competitor-list page: the shared document fields, with no
 *  results data behind them. */
export type CompetitorListPageChrome = DocumentChrome;

/** One entry on the competitor list. Deliberately the competitor's own fields
 *  and nothing derived from racing — this page exists to be published before
 *  race one, when no result exists to derive anything from. */
export interface CompetitorListRow {
  sailNumber: string;
  bowNumber?: string;
  entryNumber?: string;
  tallyNumber?: string;
  boatName?: string;
  boatClass?: string;
  /** Primary person(s), labelled per `primaryPersonLabel`. */
  names: string[];
  owners?: string[];
  helms?: string[];
  crewNames?: string[];
  club?: string;
  nationality?: string;
  worldSailingId?: string;
  subdivisions?: Record<string, string>;
  gender?: 'M' | 'F' | '';
  age?: number | null;
  /** Names of every fleet the boat is entered in, joined for display. */
  fleetNames: string[];
}

/**
 * Render the competitor list — the entry list, publishable before any race has
 * been sailed (#423). Sailwave publishes the same thing as a "Competitor List"
 * report, and it is what competitors and their families read in the run-up to
 * an event.
 *
 * Every column except sail number and the primary person is optional: the set
 * comes from the series' `enabledCompetitorFields`, and each is suppressed
 * when no entry fills it, exactly as the results tables treat Club and Nat. A
 * Fleet column leads on a multi-fleet series, since the rows are grouped by
 * fleet.
 *
 * Nothing here is derived from results. No rank, no points, no discards, and
 * none of the standings caption's "Sailed: 0" framing, which reads as a
 * failure rather than as a list of who is coming.
 */
export function renderCompetitorListHtml(
  chrome: CompetitorListPageChrome,
  rows: CompetitorListRow[],
  context: {
    enabledCompetitorFields: CompetitorFieldKey[];
    subdivisionAxes?: SubdivisionAxis[];
    primaryPersonLabel?: PrimaryPersonLabel;
    multiPersonFields?: MultiPersonFieldKey[];
    /** Show the Fleet column; set when the series has more than one fleet. */
    multiFleet: boolean;
    flagSvgByCode?: Readonly<Record<string, { viewBox: string; inner: string }>>;
  },
  options?: { fontPercent?: number },
): string {
  const fontPercent = options?.fontPercent ?? 72;
  const { enabledCompetitorFields: enabled, multiFleet, flagSvgByCode } = context;
  const primaryLabel = context.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const primaryHeader = primaryPersonHeader(primaryLabel, context.multiPersonFields);
  const helmHeader = personFieldHeader('helm', context.multiPersonFields);
  const ownerHeader = personFieldHeader('owner', context.multiPersonFields);
  const crewHeader = personFieldHeader('crewName', context.multiPersonFields);

  // A column shows when the series enables it *and* some entry fills it —
  // the results tables' rule, for the same reason: a field switched on but
  // left blank should not publish a dead column.
  const shown = (key: CompetitorFieldKey, of: (r: CompetitorListRow) => unknown): boolean =>
    enabled.includes(key) && rows.some((r) => {
      const v = of(r);
      return Array.isArray(v) ? v.length > 0 : v != null && v !== '';
    });

  const showBowNumber = shown('bowNumber', (r) => r.bowNumber);
  const showEntryNumber = shown('entryNumber', (r) => r.entryNumber);
  const showTallyNumber = shown('tallyNumber', (r) => r.tallyNumber);
  const showBoatName = shown('boatName', (r) => r.boatName);
  const showBoatClass = shown('boatClass', (r) => r.boatClass);
  const showCrewName = shown('crewName', (r) => r.crewNames);
  const showHelm = !isFieldDisabledByPrimary('helm', primaryLabel) && shown('helm', (r) => r.helms);
  const showOwner = !isFieldDisabledByPrimary('owner', primaryLabel) && shown('owner', (r) => r.owners);
  const showClub = shown('club', (r) => r.club);
  const showNationality = shown('nationality', (r) => r.nationality);
  const showWorldSailingId = shown('worldSailingId', (r) => r.worldSailingId);
  const showAge = shown('age', (r) => r.age);
  const showGender = shown('gender', (r) => r.gender);
  const axes = enabled.includes('subdivision')
    ? (context.subdivisionAxes ?? []).filter((axis) => rows.some((r) => !!r.subdivisions?.[axis.id]))
    : [];

  const headerCells = [
    ...(multiFleet ? ['<th>Fleet</th>'] : []),
    '<th>Sail Number</th>',
    ...(showBowNumber ? ['<th>Bow</th>'] : []),
    ...(showEntryNumber ? ['<th>Entry</th>'] : []),
    ...(showTallyNumber ? ['<th>Tally</th>'] : []),
    ...(showBoatName ? ['<th>Boat</th>'] : []),
    ...(showBoatClass ? ['<th>Class</th>'] : []),
    `<th>${esc(showCrewName ? `${primaryHeader} / ${crewHeader}` : primaryHeader)}</th>`,
    ...(showHelm ? [`<th>${esc(helmHeader)}</th>`] : []),
    ...(showOwner ? [`<th>${esc(ownerHeader)}</th>`] : []),
    ...(showClub ? ['<th>Club</th>'] : []),
    ...(showNationality ? ['<th>Nationality</th>'] : []),
    ...(showWorldSailingId ? ['<th>World Sailing ID</th>'] : []),
    ...axes.map((axis) => `<th>${esc(axisHeader(axis))}</th>`),
    ...(showAge ? ['<th>Age</th>'] : []),
    ...(showGender ? ['<th>Gender</th>'] : []),
  ].join('\n');

  const cols = [
    ...(multiFleet ? ['<col class="fleet" />'] : []),
    '<col class="sailno" />',
    ...(showBowNumber ? ['<col class="bowno" />'] : []),
    ...(showEntryNumber ? ['<col class="entryno" />'] : []),
    ...(showTallyNumber ? ['<col class="tally" />'] : []),
    ...(showBoatName ? ['<col class="boatname" />'] : []),
    ...(showBoatClass ? ['<col class="boatclass" />'] : []),
    '<col class="helmname" />',
    ...(showHelm ? ['<col class="helm" />'] : []),
    ...(showOwner ? ['<col class="owner" />'] : []),
    ...(showClub ? ['<col class="club" />'] : []),
    ...(showNationality ? ['<col class="nat" />'] : []),
    ...(showWorldSailingId ? ['<col class="wsid" />'] : []),
    ...axes.map(() => '<col class="subdivision" />'),
    ...(showAge ? ['<col class="age" />'] : []),
    ...(showGender ? ['<col class="gender" />'] : []),
  ].join('\n');

  const body = rows
    .map((r, i) =>
      [
        `<tr class="${i % 2 === 0 ? 'odd' : 'even'} summaryrow">`,
        ...(multiFleet ? [`<td>${esc(r.fleetNames.join(', '))}</td>`] : []),
        `<td>${esc(r.sailNumber)}</td>`,
        ...(showBowNumber ? [`<td>${esc(r.bowNumber ?? '')}</td>`] : []),
        ...(showEntryNumber ? [`<td>${esc(r.entryNumber ?? '')}</td>`] : []),
        ...(showTallyNumber ? [`<td>${esc(r.tallyNumber ?? '')}</td>`] : []),
        ...(showBoatName ? [`<td>${esc(r.boatName ?? '')}</td>`] : []),
        ...(showBoatClass ? [`<td>${esc(r.boatClass ?? '')}</td>`] : []),
        `<td>${renderHelmCell(r.names, r.crewNames, showCrewName, helmBioUrl(r.worldSailingId, showWorldSailingId))}</td>`,
        ...(showHelm ? [`<td>${renderPersonCell(r.helms)}</td>`] : []),
        ...(showOwner ? [`<td>${renderPersonCell(r.owners)}</td>`] : []),
        ...(showClub ? [`<td>${esc(r.club ?? '')}</td>`] : []),
        ...(showNationality ? [renderNationalityCell(r.nationality, flagSvgByCode)] : []),
        ...(showWorldSailingId ? [renderWorldSailingIdCell(r.worldSailingId)] : []),
        ...axes.map((axis) => `<td>${esc(r.subdivisions?.[axis.id] ?? '')}</td>`),
        ...(showAge ? [`<td>${r.age != null ? r.age : ''}</td>`] : []),
        ...(showGender ? [`<td>${esc(r.gender ?? '')}</td>`] : []),
        '</tr>',
      ].join('\n'),
    )
    .join('\n');

  // The entry count, and nothing else. The standings caption's companions
  // (sailed, discards, to count) are all zero before racing and say only that
  // nothing has happened yet.
  const caption = `<div class="caption">Entries: ${rows.length}</div>`;
  const content = rows.length > 0
    ? `${caption}
<div class="tablewrap"><table class="summarytable" cellspacing="0" cellpadding="0" border="0">
<colgroup>
${cols}
</colgroup>
<thead>
<tr class="titlerow">
${headerCells}
</tr>
</thead>
<tbody>
${body}
</tbody>
</table></div>`
    : '<p>No entries yet.</p>';

  const flagDefs = showNationality
    ? renderFlagDefs(
        [...new Set(rows.map((r) => r.nationality).filter((c): c is string => !!c))].sort(),
        flagSvgByCode,
      )
    : '';

  return renderHtmlDocument(
    { ...chrome, fleetName: 'Competitor List' },
    content,
    { fontPercent, hasNhcDetail: false, hasEchoDetail: false, flagDefs },
  );
}

/** The full HTML document around already-rendered section content: styles,
 *  header logos + series title, the provisional stamp, the page heading, the
 *  footer credit line, and the NHC/ECHO toggle scripts when the content
 *  carries their columns. */
export function renderHtmlDocument(
  chrome: DocumentChrome,
  content: string,
  flags: { fontPercent: number; hasNhcDetail: boolean; hasEchoDetail: boolean; flagDefs: string },
): string {
  const { series, fleetName, leftLogoUrl, rightLogoUrl, leftUrl, rightUrl, generatedAt, resultsFinal, finalisedAt, seriesIndexUrl, openInAppUrl, officials } = chrome;
  const { fontPercent, hasNhcDetail, hasEchoDetail, flagDefs } = flags;
  const titleSuffix = fleetName ? ` \u2014 ${esc(fleetName)}` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta name="description" content="sail scoring results">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Results for ${esc(series.name)}${series.venue ? ' at ' + esc(series.venue) : ''}${titleSuffix}</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="205 205 840 840"><path fill="#fb3a3b" d="M551,757.3c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-125.9,125.9c29.4-.8,58.5-.7,87.4.3l191.1-191.1c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-177.3,177.3c33.3,1.8,66.2,4.7,98.7,8.8l59.9-59.9c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-48.4,48.4c87.3,12.9,171.9,34.6,253.4,65.8-95.4-229.3-112.6-465-9.6-706L315.1,906.2c31.6-3.2,62.9-5.5,93.9-6.9l142.1-142Z"/></svg>')}">
<style type="text/css">
body {font-family: "Poppins", system-ui, -apple-system, "Segoe UI", Roboto, arial, helvetica, sans-serif; font-size: ${fontPercent}%; text-align: center; color: #1a1a1a; border-top: 4px solid #fb3a3b;}
.hardleft  {text-align: left; float: left;  margin: 15px 0  15px 25px;}
.hardright {text-align: right; float: right; margin: 15px 25px 15px 0;}
.breadcrumb {text-align: left; margin: 0 0 14px 25px; font-size: 0.78em;}
.breadcrumb a {color: #073358; text-decoration: none;}
.breadcrumb a:hover {color: #fb3a3b; text-decoration: underline;}
table {text-align: left; margin: 0px auto 30px auto; font-size: 1em; border-collapse: collapse; border: 1px #fff solid;}
.tablewrap {overflow-x: auto; margin: 0 auto 30px auto;}
.tablewrap table {margin: 0 auto;}
td, th {padding: 4px; border: 2px #fff solid; vertical-align: top;}
th {background-color: #073358; color: #ffffff; font-weight: 600;}
.caption {padding: 5px; text-align: center; border: 0; font-weight: bold;}
h1 {font-size: 1.6em; color: #073358;}
h2 {font-size: 1.4em; color: #073358;}
h3 {font-size: 1.2em;}
p {text-align: center;}
a {color: #073358;}
a:hover {color: #fb3a3b;}
th a {color: #ffffff; text-decoration: underline;}
th a:hover {color: #cfe0f0;}
.odd {background-color: #eef2f7;}
.even {background-color: #dde7f0;}
table.headertable {border: 0px;}
table.headertable td{border: 0px;}
.headerlogo {display: block; height: 100px; width: auto; max-width: 100%; object-fit: contain;}
.headerlogo-right {margin-left: auto; margin-right: 0;}
td.rank1 { background: #d4a72c; }
td.rank2 { background: #aab0b6; }
td.rank3 { background: #c98a5e; }
td.discard { background: #f2f2f2; }
td.discard.rank1, td.discard.rank2, td.discard.rank3 { background: #f2f2f2; }
td.excluded { color: #888; text-align: center; }
.override-marker { color: #b45309; font-weight: bold; margin-left: 1px; cursor: help; }
.raceoptions { font-size: 0.85em; color: #444; margin: -20px auto 30px auto; max-width: 60em; }
.penaltylabels { font-size: 0.85em; color: #444; margin: -20px auto 30px auto; max-width: 60em; }
.racelimitnote { font-size: 0.85em; color: #444; margin: 0 auto 24px auto; max-width: 60em; }
/* A combined page's per-fleet race block: the rule and the space above it are
   what separate one fleet's set of races from the next when scrolling. */
.fleetraces { border-top: 1px solid #c7d2de; margin-top: 3em; padding-top: 0.4em; }
table.summarytable td .rating { display: block; font-size: 0.85em; color: #666; margin-top: 1px; font-family: monospace; }
table.summarytable td.discard .rating { color: #888; }
table.summarytable td.seedrating { font-family: monospace; }
td.nat { font-family: monospace; }
td.nat .flag { display: block; width: 20px; height: 13px; margin-bottom: 2px; border: 1px solid #ccc; }
td.nat .flag svg { display: block; width: 100%; height: 100%; }
td.nat .nattext { font-size: 0.8em; }
td.wsid { font-family: monospace; font-size: 0.85em; white-space: nowrap; }
.print-btn { font: inherit; color: #073358; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
.print-btn:hover { color: #fb3a3b; }
th[data-sortable] { cursor: pointer; }
th[aria-sort="ascending"]::after { content: " ▲"; font-size: 0.75em; }
th[aria-sort="descending"]::after { content: " ▼"; font-size: 0.75em; }
@page { margin: 12mm; }
@media print {
  body { border-top: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .breadcrumb, .nhc-toggle, .echo-toggle, .print-btn { display: none; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  h3.racetitle { break-after: avoid; }
  table { break-inside: auto; }
  .tablewrap { overflow-x: visible; }
}
@media (max-width: 640px) {
  table.headertable, table.headertable tbody, table.headertable tr, table.headertable td { display: block; width: auto; }
  table.headertable td { text-align: center; }
  .headerlogo { height: 64px; margin: 0 auto 10px auto; }
  .headerlogo-right { margin: 0 auto 10px auto; }
}
${hasNhcDetail ? 'body.hide-nhc-detail .nhc-detail { display: none; }\np.nhc-toggle { text-align: center; margin: 0 0 10px 0; font-size: 0.9em; }\ndiv.nhc-explainer { max-width: 640px; margin: 0 auto 16px auto; padding: 10px 14px; border: 1px #ccd solid; background: #f6f6fb; font-size: 0.9em; text-align: left; }\ndiv.nhc-explainer p { text-align: left; margin: 0 0 6px 0; }\ndiv.nhc-explainer p:last-child { margin-bottom: 0; }\ndiv.nhc-explainer .formula { font-family: monospace; }\ndiv.nhc-explainer dl { margin: 4px 0 0 0; }\ndiv.nhc-explainer dt { font-weight: bold; display: inline; }\ndiv.nhc-explainer dd { display: inline; margin: 0 0 0 4px; }\ndiv.nhc-explainer dd:after { content: ""; display: block; }\n' : ''}${hasEchoDetail ? 'body.hide-echo-detail .echo-detail { display: none; }\np.echo-toggle { text-align: center; margin: 0 0 10px 0; font-size: 0.9em; }\ndiv.echo-explainer { max-width: 640px; margin: 0 auto 16px auto; padding: 10px 14px; border: 1px #ccd solid; background: #f6f6fb; font-size: 0.9em; text-align: left; }\ndiv.echo-explainer p { text-align: left; margin: 0 0 6px 0; }\ndiv.echo-explainer p:last-child { margin-bottom: 0; }\ndiv.echo-explainer .formula { font-family: monospace; }\ndiv.echo-explainer dl { margin: 4px 0 0 0; }\ndiv.echo-explainer dt { font-weight: bold; display: inline; }\ndiv.echo-explainer dd { display: inline; margin: 0 0 0 4px; }\ndiv.echo-explainer dd:after { content: ""; display: block; }\n' : ''}</style>
</head>
<body${[hasNhcDetail ? 'hide-nhc-detail' : '', hasEchoDetail ? 'hide-echo-detail' : ''].filter(Boolean).length > 0 ? ` class="${[hasNhcDetail ? 'hide-nhc-detail' : '', hasEchoDetail ? 'hide-echo-detail' : ''].filter(Boolean).join(' ')}"` : ''}>
${seriesIndexUrl ? `<p class="breadcrumb"><a href="${esc(seriesIndexUrl)}" target="_top" rel="noopener">&larr; ${esc(series.name)}</a></p>\n` : ''}<table class="headertable" cellspacing="0" width="100%" cellpadding="0" border="0">
<tbody>
<tr>
<td width="30%">${leftLogoUrl ? maybeLink(leftUrl, `<img class="headerlogo" src="${esc(leftLogoUrl)}" alt="venue logo" />`) : ''}</td>
<td width="40%" align="center">
<h1>${esc(series.name)}</h1>
${series.venue ? `<h2>${esc(series.venue)}</h2>` : ''}
</td>
<td width="30%">${rightLogoUrl ? maybeLink(rightUrl, `<img class="headerlogo headerlogo-right" src="${esc(rightLogoUrl)}" alt="event logo" />`) : ''}</td>
</tr>
</tbody>
</table>
<div style="clear:both;"></div>
<style>div.applicant-break {page-break-after:always;}</style>
${resultsFinal
  ? `<h3 class="seriestitle">Final results${finalisedAt ? ` — declared ${formatDate(finalisedAt)}` : ''}</h3>`
  : generatedAt ? `<h3 class="seriestitle">Results are provisional as of ${formatTime(generatedAt)} on ${formatDate(generatedAt)}</h3>` : ''}
${hasOfficials(officials) ? `<p class="seriesofficials" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">${esc(formatOfficials(officials))}</p>` : ''}
${fleetName ? `<h2>${esc(fleetName)}</h2>` : ''}
${flagDefs}
${content}
<p class="hardleft">${leftUrl ? `<a href="${esc(externalHref(leftUrl))}" target="_top" rel="noopener">${esc(series.venue || leftUrl)}</a>` : ''}</p>
<p class="hardright">${rightUrl ? `<a href="${esc(externalHref(rightUrl))}" target="_top" rel="noopener">${esc(series.name)}</a>` : ''}</p>
<div style="clear:both;"></div>
<p class="credit"><svg viewBox="205 205 840 840" width="15" height="15" aria-hidden="true" style="vertical-align:-2px;margin-right:5px;"><path fill="#fb3a3b" d="M551,757.3c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-125.9,125.9c29.4-.8,58.5-.7,87.4.3l191.1-191.1c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-177.3,177.3c33.3,1.8,66.2,4.7,98.7,8.8l59.9-59.9c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-48.4,48.4c87.3,12.9,171.9,34.6,253.4,65.8-95.4-229.3-112.6-465-9.6-706L315.1,906.2c31.6-3.2,62.9-5.5,93.9-6.9l142.1-142Z"/></svg>Sail Scoring &mdash; <a href="https://sailscoring.ie" target="_top" rel="noopener">sailscoring.ie</a>${openInAppUrl ? ` &mdash; <a href="${esc(openInAppUrl)}" target="_top" rel="noopener">Open in Sail Scoring</a>` : ''} &mdash; ${renderPrintButton()}</p>
${hasNhcDetail ? renderNhcToggleScript() : ''}
${hasEchoDetail ? renderEchoToggleScript() : ''}
${renderSortScript()}
</body>
</html>`;
}

/** Screen-only "Save as PDF" control, rendered inline in the footer credit line
 *  next to "Open in Sail Scoring". Calls the browser's print dialog, which the
 *  @media print stylesheet has tuned for a clean printout (and from which the
 *  viewer picks "Save as PDF"). Hidden in print so it doesn't land in the
 *  output. Present on the public `/p/` page; the in-app preview offers the same
 *  via its Download menu, so this is its public-page counterpart. */
function renderPrintButton(): string {
  return `<button type="button" class="print-btn" onclick="window.print()">Save as PDF</button>`;
}

/** Inline column sorter for every results table on the page.
 *
 *  Published pages are self-contained single files, so this is hand-rolled
 *  rather than a CDN-loaded tablesorter. Click a header to sort ascending,
 *  again for descending, a third time for the original (rank) order — the
 *  same cycle the in-app tables use. `aria-sort` carries the state; the
 *  indicator arrows come from the stylesheet.
 *
 *  Cell values: `H:MM:SS` / `M:SS` strings compare as durations; otherwise
 *  the first number in the cell decides — which reads through discard
 *  parentheses ("(4.0)"), result codes ("146.0 BFD"), redress ("RDG(5.0)"),
 *  ordinals ("1st"), tied ranks ("3="), and prefixed sail numbers
 *  ("IRL 1234"). A column compares numerically only when every non-blank
 *  cell yields a number; otherwise as text, with the same collation the
 *  in-app sorter uses. Blank cells sort past every real value.
 *
 *  Rows remember their served position: it breaks ties, and it is how the
 *  third click restores rank order. Full-width marker rows (the split-fleet
 *  provisional cut line) hide while a sort is active — they annotate a
 *  position in the rank order, not a boat. Links inside a header (the race
 *  anchors) keep navigating; the rest of the cell sorts. Printing restores
 *  the served order first — the PDF artifact is the official ranking — and
 *  the viewer's sort comes back afterwards. With scripting off the page is
 *  simply the static ranking.
 *
 *  Row shading is served as static odd/even classes, so every reorder
 *  reassigns them in the new display order — otherwise each row keeps the
 *  shade of its served position and the alternating stripes scramble.
 *  Marker rows carry no stripe class and don't advance the alternation,
 *  matching how the server counts only data rows. */
function renderSortScript(): string {
  return `<script>(function(){
var collator=null;
try{collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});}catch(e){}
function keyOf(text){
  var t=text.replace(/\\s+/g,' ').trim();
  if(t===''||t==='\\u2014')return null;
  var p=/^(\\d+):(\\d\\d)(?::(\\d\\d))?$/.exec(t);
  if(p)return{num:p[3]!=null?(+p[1])*3600+(+p[2])*60+(+p[3]):(+p[1])*60+(+p[2]),text:t};
  var m=/-?\\d+(?:\\.\\d+)?/.exec(t);
  return m?{num:parseFloat(m[0]),text:t}:{text:t};
}
function initTable(table){
  var head=table.tHead,body=table.tBodies[0];
  if(!head||!body||head.rows.length===0)return;
  var hrow=head.rows[head.rows.length-1];
  var rows=[].slice.call(body.rows);
  var dataRows=[],markerRows=[];
  for(var i=0;i<rows.length;i++){
    rows[i].ssOrig=i;
    var marker=false;
    for(var j=0;j<rows[i].cells.length;j++)if(rows[i].cells[j].colSpan>1)marker=true;
    (marker?markerRows:dataRows).push(rows[i]);
  }
  if(dataRows.length<2)return;
  var col=-1,dir=0;
  function restripe(){
    var n=0;
    for(var i=0;i<body.rows.length;i++){
      var cl=body.rows[i].classList;
      if(!cl.contains('odd')&&!cl.contains('even'))continue;
      cl.remove(n%2===0?'even':'odd');
      cl.add(n%2===0?'odd':'even');
      n++;
    }
  }
  function apply(activeCol,activeDir){
    var i;
    if(activeDir===0){
      var all=rows.slice().sort(function(a,b){return a.ssOrig-b.ssOrig;});
      for(i=0;i<all.length;i++){all[i].style.display='';body.appendChild(all[i]);}
    }else{
      for(i=0;i<markerRows.length;i++)markerRows[i].style.display='none';
      var keyed=dataRows.map(function(r){
        var cell=r.cells[activeCol];
        return{r:r,k:cell?keyOf(cell.textContent||''):null};
      });
      var numeric=true;
      for(i=0;i<keyed.length;i++)if(keyed[i].k&&keyed[i].k.num===undefined)numeric=false;
      keyed.sort(function(a,b){
        var c;
        if(a.k===null||b.k===null)c=a.k===b.k?0:a.k===null?1:-1;
        else if(numeric)c=a.k.num-b.k.num;
        else if(collator)c=collator.compare(a.k.text,b.k.text);
        else c=a.k.text<b.k.text?-1:a.k.text>b.k.text?1:0;
        return activeDir*c||a.r.ssOrig-b.r.ssOrig;
      });
      for(i=0;i<keyed.length;i++)body.appendChild(keyed[i].r);
    }
    restripe();
    for(i=0;i<hrow.cells.length;i++){
      if(i===activeCol&&activeDir!==0)hrow.cells[i].setAttribute('aria-sort',activeDir===1?'ascending':'descending');
      else hrow.cells[i].removeAttribute('aria-sort');
    }
  }
  function toggle(i){
    if(col===i&&dir===1)dir=-1;
    else if(col===i){col=-1;dir=0;}
    else{col=i;dir=1;}
    apply(col,dir);
  }
  table.ssPrint=function(printing){apply(printing?-1:col,printing?0:dir);};
  [].forEach.call(hrow.cells,function(th,i){
    th.setAttribute('data-sortable','');
    th.tabIndex=0;
    if(!th.title)th.title='Click to sort';
    th.addEventListener('click',function(e){
      var n=e.target;
      while(n&&n!==th){if(n.tagName==='A')return;n=n.parentNode;}
      toggle(i);
    });
    th.addEventListener('keydown',function(e){
      if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle(i);}
    });
  });
}
var tables=document.querySelectorAll('table.summarytable,table.racetable');
[].forEach.call(tables,initTable);
window.addEventListener('beforeprint',function(){[].forEach.call(tables,function(t){if(t.ssPrint)t.ssPrint(true);});});
window.addEventListener('afterprint',function(){[].forEach.call(tables,function(t){if(t.ssPrint)t.ssPrint(false);});});
})();</script>`;
}

/** Viewer-facing toggle for NHC rating-calculation columns. Only emitted when
 *  the scorer has published explainability data. Defaults to hidden — paired
 *  with the `hide-nhc-detail` body class and CSS rule. */
function renderNhcToggle(): string {
  return `<p class="nhc-toggle"><label><input type="checkbox" id="nhc-detail-toggle"> Show NHC rating calculations</label></p>`;
}

/** Inline script: restore viewer preference from localStorage and wire the
 *  checkbox to toggle the body class. Key is global, not per-series, so the
 *  preference sticks across events. */
function renderNhcToggleScript(): string {
  return `<script>(function(){
var KEY='sailscoring:nhc-explain-visible';
var cb=document.getElementById('nhc-detail-toggle');
if(!cb)return;
var visible=localStorage.getItem(KEY)==='true';
if(visible){document.body.classList.remove('hide-nhc-detail');cb.checked=true;}
cb.addEventListener('change',function(){
  if(cb.checked){document.body.classList.remove('hide-nhc-detail');localStorage.setItem(KEY,'true');}
  else{document.body.classList.add('hide-nhc-detail');localStorage.setItem(KEY,'false');}
});
})();</script>`;
}

/** Viewer-facing toggle for ECHO rating-calculation columns. Same pattern
 *  as the NHC toggle but with its own body class and storage key — a
 *  series can have both NHC and ECHO fleets and toggle each independently. */
function renderEchoToggle(): string {
  return `<p class="echo-toggle"><label><input type="checkbox" id="echo-detail-toggle"> Show ECHO rating calculations</label></p>`;
}

function renderEchoToggleScript(): string {
  return `<script>(function(){
var KEY='sailscoring:echo-explain-visible';
var cb=document.getElementById('echo-detail-toggle');
if(!cb)return;
var visible=localStorage.getItem(KEY)==='true';
if(visible){document.body.classList.remove('hide-echo-detail');cb.checked=true;}
cb.addEventListener('change',function(){
  if(cb.checked){document.body.classList.remove('hide-echo-detail');localStorage.setItem(KEY,'true');}
  else{document.body.classList.add('hide-echo-detail');localStorage.setItem(KEY,'false');}
});
})();</script>`;
}

/** Prose block explaining the NHC rating-calculation columns and formula.
 *  Carries the `nhc-detail` class so it shows and hides under the same
 *  viewer toggle as the per-row calculation columns. Generic — the live
 *  α value for each race is shown in the per-race fleet header line. */
function renderNhcExplainer(): string {
  return `<div class="nhc-explainer nhc-detail">
<p><strong>NHC1</strong> is a progressive handicap. Each boat&rsquo;s TCF starts from the fleet rating list and shifts after every race based on how its corrected time compared to the fleet average. Sail Scoring implements the <em>SWNHC2015</em> algorithm (matches Sailwave NHC1 to 3 dp).</p>
<p>For each finisher: a <em>fair TCF</em> <span class="formula">Q = O &times; P50</span> is computed (where O = 100 &divide; minutes elapsed and P50 = mean(TCF) &divide; mean(O)). The <em>comparative score</em> <span class="formula">S = Q &divide; TCF</span> measures over- or under-performance. Boats with S far from the fleet mean &mdash; outside <span class="formula">&mu;(S) &plus; 1.5&middot;&sigma;(S)</span> or <span class="formula">&mu;(S) &minus; 1.0&middot;&sigma;(S)</span>, marked &dagger; &mdash; are classified <em>extreme</em> and blend more slowly.</p>
<p>The blend rate &alpha; depends on direction &times; extreme:</p>
<dl>
<dt>0.30</dt><dd>&mdash; non-extreme over-performer (TCF goes up).</dd>
<dt>0.15</dt><dd>&mdash; non-extreme under-performer.</dd>
<dt>0.15</dt><dd>&mdash; extreme over-performer.</dd>
<dt>0.075</dt><dd>&mdash; extreme under-performer.</dd>
</dl>
<p>Column meanings:</p>
<dl>
<dt>Q</dt><dd>&mdash; fair TCF for this boat in this race.</dd>
<dt>S</dt><dd>&mdash; comparative score Q &divide; TCF; &dagger; marks an extreme classification.</dd>
<dt>&alpha;</dt><dd>&mdash; the blend rate actually applied to this boat.</dd>
<dt>Z</dt><dd>&mdash; the blended provisional TCF before fleet-sum realignment.</dd>
<dt>Adjustment</dt><dd>&mdash; signed shift (New TCF &minus; TCF, post-realignment).</dd>
</dl>
<p>Finally the whole fleet is realigned by <span class="formula">Z51 = &Sigma;TCF &divide; &Sigma;Z</span> (shown in the per-race fleet header) so the total fleet rating is preserved. <strong>New TCF = round(Z &times; Z51, 3)</strong> is the rating to apply in the next race. Non-finishers carry their TCF unchanged.</p>
</div>`;
}

/** Prose block explaining the ECHO rating-calculation columns and formula.
 *  Carries the `echo-detail` class so it shows and hides under the same
 *  viewer toggle as the per-row calculation columns. Generic — the live
 *  &alpha;, &Sigma;H_S, and &Sigma;(1/T_E) for each race are shown in the
 *  per-race fleet header line. */
function renderEchoExplainer(): string {
  return `<div class="echo-explainer echo-detail">
<p><strong>ECHO</strong> is the Irish Sailing progressive handicap. Each boat&rsquo;s handicap H starts from the rated list and shifts after every race based on a Performance Index measuring how the boat sailed relative to the fleet.</p>
<p>After each race the new handicap is computed as <span class="formula">New H = H + &alpha; &times; (PI &minus; H)</span>, with <span class="formula">PI = &Sigma;H_S / (T_E &times; &Sigma;(1/T_E))</span>. &alpha;, &Sigma;H_S, and &Sigma;(1/T_E) are shown in the per-race fleet header. The rating update is suppressed when fewer than three boats finish.</p>
<p>Column meanings:</p>
<dl>
<dt>1/T_E</dt><dd>&mdash; reciprocal of this boat&rsquo;s elapsed time, in s&minus;&sup1;.</dd>
<dt>PI</dt><dd>&mdash; Performance Index for this boat in this race.</dd>
<dt>Adjustment</dt><dd>&mdash; &alpha; &times; (PI &minus; H), the signed shift applied to H.</dd>
</dl>
<p>The resulting <strong>New H</strong> (always shown alongside Finish/ET/Starting H/CT) is the handicap to apply in the next race. Non-finishers carry their H unchanged.</p>
</div>`;
}

// ---- Summary table ----

function renderSummaryTable(
  standings: StandingRowData[],
  races: RaceData[],
  view: SectionView,
  /** Anchor ids of the per-race detail tables present on the page; a race
   *  column header links only when its own table is one of them. */
  linkedAnchorIds: ReadonlySet<string>,
  flagSvgByCode: Readonly<Record<string, { viewBox: string; inner: string }>> | undefined,
): string {
  const { hasDiscards, showBowNumber, showEntryNumber, showTallyNumber, showBoatName, showBoatClass, showHelm, showOwner, showCrewName, showClub, showNationality, showWorldSailingId, visibleSubdivisionAxes: subdivisionAxes, showAge, showGender, primaryHeader, helmHeader, ownerHeader, crewHeader, summaryRatingSystem: ratingSystem } = view;
  const hasSeedCol = ratingSystem !== null;
  const seedHeader = ratingSystem === 'nhc' ? 'NHC1' : (ratingSystem === 'echo' ? 'ECHO' : '');
  const extraCols = (showBowNumber ? 1 : 0) + (showEntryNumber ? 1 : 0) + (showTallyNumber ? 1 : 0) + (showBoatName ? 1 : 0) + (showBoatClass ? 1 : 0) + (showHelm ? 1 : 0) + (showOwner ? 1 : 0) + (showClub ? 1 : 0) + (showNationality ? 1 : 0) + (showWorldSailingId ? 1 : 0) + subdivisionAxes.length + (showAge ? 1 : 0) + (showGender ? 1 : 0);
  // rank + sail [+ bow] [+ entry] [+ tally] [+ boat] [+ class] + primary [+ helm] [+ owner] [+ club] [+ nat] [+ wsid] [+ subdivision] [+ age] [+ gender] [+ seed] + races + total [+ nett]
  const colCount = 3 + extraCols + (hasSeedCol ? 1 : 0) + races.length + (hasDiscards ? 2 : 1);

  const cols = [
    '<col class="rank" />',
    '<col class="sailno" />',
    ...(showBowNumber ? ['<col class="bowno" />'] : []),
    ...(showEntryNumber ? ['<col class="entryno" />'] : []),
    ...(showTallyNumber ? ['<col class="tally" />'] : []),
    ...(showBoatName ? ['<col class="boatname" />'] : []),
    ...(showBoatClass ? ['<col class="boatclass" />'] : []),
    '<col class="helmname" />',
    ...(showHelm ? ['<col class="helm" />'] : []),
    ...(showOwner ? ['<col class="owner" />'] : []),
    ...(showClub ? ['<col class="club" />'] : []),
    ...(showNationality ? ['<col class="nat" />'] : []),
    ...(showWorldSailingId ? ['<col class="wsid" />'] : []),
    ...subdivisionAxes.map(() => '<col class="subdivision" />'),
    ...(showAge ? ['<col class="age" />'] : []),
    ...(showGender ? ['<col class="gender" />'] : []),
    ...(hasSeedCol ? ['<col class="seedrating" />'] : []),
    ...races.map(() => '<col class="race" />'),
    '<col class="total" />',
    ...(hasDiscards ? ['<col class="nett" />'] : []),
  ].join('\n');

  const headerCells = [
    '<th>Rank</th>',
    '<th>Sail Number</th>',
    ...(showBowNumber ? ['<th>Bow</th>'] : []),
    ...(showEntryNumber ? ['<th>Entry</th>'] : []),
    ...(showTallyNumber ? ['<th>Tally</th>'] : []),
    ...(showBoatName ? ['<th>Boat</th>'] : []),
    ...(showBoatClass ? ['<th>Class</th>'] : []),
    `<th>${esc(showCrewName ? `${primaryHeader} / ${crewHeader}` : primaryHeader)}</th>`,
    ...(showHelm ? [`<th>${esc(helmHeader)}</th>`] : []),
    ...(showOwner ? [`<th>${esc(ownerHeader)}</th>`] : []),
    ...(showClub ? ['<th>Club</th>'] : []),
    ...(showNationality ? ['<th>Nationality</th>'] : []),
    ...(showWorldSailingId ? ['<th>World Sailing ID</th>'] : []),
    ...subdivisionAxes.map((axis) => `<th>${esc(axisHeader(axis))}</th>`),
    ...(showAge ? ['<th>Age</th>'] : []),
    ...(showGender ? ['<th>Gender</th>'] : []),
    ...(hasSeedCol ? [`<th>${esc(seedHeader)}</th>`] : []),
    ...races.map((r) => {
      // "R4 ×2 *" — the weighting numerically, an asterisk for a race whose
      // discard behaviour differs; both spelled out in the legend below.
      const multiplier = raceMultiplier(r);
      const marks =
        (multiplier !== 1 ? ` ${formatMultiplier(multiplier)}` : '') +
        (racePolicy(r) !== 'normal' ? ' *' : '');
      const optionsNote = scoringOptionsLegend(r, r.label);
      const titleText = [r.name, optionsNote].filter(Boolean).join(' — ');
      const titleAttr = titleText ? ` title="${esc(titleText)}"` : '';
      return linkedAnchorIds.has(r.anchorId) && r.results.length > 0
        ? `<th${titleAttr}><a class="racelink" href="#${esc(r.anchorId)}">${esc(r.label)}</a>${esc(marks)}</th>`
        : `<th${titleAttr}>${esc(r.label)}${esc(marks)}</th>`;
    }),
    '<th>Total</th>',
    ...(hasDiscards ? ['<th>Nett</th>'] : []),
  ].join('\n');

  const rows = standings
    .map((s, i) => {
      const rowClass = i % 2 === 0 ? 'odd' : 'even';
      const scoreCells = s.raceScores
        .map((score) => {
          if (score.isExcluded) {
            return `<td class="excluded" title="No finishers in this race — excluded from scoring">&mdash;</td>`;
          }
          const classes = [
            score.isDiscard ? 'discard' : '',
            score.podiumRank ? `rank${score.podiumRank}` : '',
          ]
            .filter(Boolean)
            .join(' ');
          const text = renderScoreText(score.points, score.resultCode, score.penaltyCode, score.penaltyOverride, score.isDiscard, score.isRedress, score.penaltyLabel);
          const ratingSpan = hasSeedCol && score.appliedRating != null
            ? `<span class="rating">${score.appliedRating.toFixed(3)}</span>`
            : '';
          return classes ? `<td class="${classes}">${text}${ratingSpan}</td>` : `<td>${text}${ratingSpan}</td>`;
        })
        .join('\n');

      const seedCell = hasSeedCol
        ? `<td class="seedrating">${s.seedRating != null ? s.seedRating.toFixed(3) : ''}</td>`
        : '';

      return [
        `<tr class="${rowClass} summaryrow">`,
        `<td>${ordinal(s.rank)}</td>`,
        `<td>${esc(s.sailNumber)}</td>`,
        ...(showBowNumber ? [`<td>${esc(s.bowNumber ?? '')}</td>`] : []),
        ...(showEntryNumber ? [`<td>${esc(s.entryNumber ?? '')}</td>`] : []),
        ...(showTallyNumber ? [`<td>${esc(s.tallyNumber ?? '')}</td>`] : []),
        ...(showBoatName ? [`<td>${esc(s.boatName ?? '')}</td>`] : []),
        ...(showBoatClass ? [`<td>${esc(s.boatClass ?? '')}</td>`] : []),
        `<td>${renderHelmCell(s.helm, s.crewNames, showCrewName, helmBioUrl(s.worldSailingId, showWorldSailingId))}</td>`,
        ...(showHelm ? [`<td>${renderPersonCell(s.helmRole)}</td>`] : []),
        ...(showOwner ? [`<td>${renderPersonCell(s.owner)}</td>`] : []),
        ...(showClub ? [`<td>${esc(s.club ?? '')}</td>`] : []),
        ...(showNationality ? [renderNationalityCell(s.nationality, flagSvgByCode)] : []),
        ...(showWorldSailingId ? [renderWorldSailingIdCell(s.worldSailingId)] : []),
        ...subdivisionAxes.map((axis) => `<td>${esc(s.subdivisions?.[axis.id] ?? '')}</td>`),
        ...(showAge ? [`<td>${s.age != null ? s.age : ''}</td>`] : []),
        ...(showGender ? [`<td>${esc(s.gender ?? '')}</td>`] : []),
        ...(hasSeedCol ? [seedCell] : []),
        scoreCells,
        `<td>${formatPoints(s.totalPoints)}</td>`,
        ...(hasDiscards ? [`<td>${formatPoints(s.netPoints)}</td>`] : []),
        `</tr>`,
      ].join('\n');
    })
    .join('\n');

  // A marked column has to say what it does, or the standings don't add up
  // for anyone checking the arithmetic by hand.
  const optionNotes = races
    .filter((r) => hasScoringOptions(r))
    .map((r) => scoringOptionsLegend(r, r.label))
    .filter(Boolean);
  const optionsLegend = optionNotes.length > 0
    ? `\n<p class="raceoptions">${esc(optionNotes.join(' '))}</p>`
    : '';
  // A named DPI shows the scorer's word instead of the code, so the page has
  // to say what that word means (#424).
  const labelsLegend = penaltyLabelLegend(
    standings.flatMap((s) => s.raceScores.map((sc) => sc.penaltyLabel ?? '')),
  );

  return `<div class="tablewrap"><table class="summarytable" cellspacing="0" cellpadding="0" border="0">
<colgroup span="${colCount}">
${cols}
</colgroup>
<thead>
<tr class="titlerow">
${headerCells}
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table></div>${optionsLegend}${labelsLegend ? `\n${labelsLegend}` : ''}`;
}

// ---- Race detail table ----

/**
 * The finish-time and track-data columns, in display order. Shared by the
 * ordinary race tables and the split-fleet per-race page, and built from the
 * same readers the app's own surfaces use, so a published number and an
 * on-screen one can never disagree. Each column renders only when at least
 * one boat in its table carries the value, and the numbers are shown as
 * stored, so they read back exactly what the device wrote. The two `time`
 * columns are skipped on handicap tables, which already show Finish/ET.
 */
export const TRACK_DATA_COLUMNS: {
  header: string;
  title?: string;
  time?: boolean;
  value: (c: TrackDataCell | undefined) => string;
}[] = [
  { header: 'Finish time', time: true, value: finishTimeText },
  { header: 'Elapsed', time: true, value: elapsedText },
  { header: 'Distance (km)', title: 'Distance sailed', value: distanceKmText },
  { header: 'Avg speed (kn)', value: avgSpeedKnText },
  { header: 'Max speed (kn)', value: maxSpeedKtsText },
  {
    header: 'DTL (m)',
    title: 'Distance to line at the starting signal',
    value: dtlAtStartText,
  },
];

function renderRaceTable(
  race: RaceData,
  view: SectionView,
  flagSvgByCode: Readonly<Record<string, { viewBox: string; inner: string }>> | undefined,
  // `suppressLabel` drops the "Race N" prefix from the heading — set for the
  // lone race of a race-results page, where the numbering says nothing.
  opts?: { suppressLabel?: boolean },
): string {
  const { showBowNumber, showEntryNumber, showTallyNumber, showBoatName, showBoatClass, showHelm, showOwner, showCrewName, showClub, showNationality, showWorldSailingId, visibleSubdivisionAxes: subdivisionAxes, showAge, showGender, primaryHeader, helmHeader, ownerHeader, crewHeader } = view;
  const dateStr = formatIsoDate(race.date);
  const startStr = race.startTime ? ` &mdash; Start: ${esc(race.startTime)}` : '';
  const isNhc = race.isNhc === true || race.nhcHeader != null;
  const isEcho = race.isEcho === true || race.echoHeader != null;
  const hasExplain = race.nhcHeader != null;
  const hasEchoExplain = race.echoHeader != null;
  const hasHandicapCols = race.results.some((r) => r.tcc != null);
  // Track-data columns are purely data-driven: the assembler only attaches
  // the fields when the series publishes them, and a column with no value in
  // this table (no line recorded → no DTL) simply isn't rendered. Handicap
  // tables skip the two time columns they already carry as Finish/ET.
  const trackColumns = TRACK_DATA_COLUMNS.filter(
    (col) => !(col.time && hasHandicapCols) && race.results.some((r) => col.value(r) !== ''),
  );
  // ECHO uses "Starting H" per the IS guide; NHC uses "TCF"; static handicap
  // fleets use "TCC" — except ORC time-on-distance, whose rating is an
  // allowance in seconds per nautical mile.
  const isOrcTod = race.isOrcTod === true;
  const isOrcPcs = race.isOrcPcs === true;
  const ratingLabel = isOrcTod ? 'ToD' : (isEcho ? 'Starting H' : (isNhc ? 'TCF' : 'TCC'));
  const ratingColClass = isEcho ? 'starth' : (isNhc ? 'tcf' : 'tcc');
  // Detect ties in within-fleet rank
  const rankCounts = new Map<number, number>();
  for (const r of race.results) {
    if (r.rank !== null) rankCounts.set(r.rank, (rankCounts.get(r.rank) ?? 0) + 1);
  }

  const rows = race.results
    .map((r, i) => {
      const rowClass = i % 2 === 0 ? 'odd' : 'even';
      const isRankTied = r.rank !== null && (rankCounts.get(r.rank) ?? 0) > 1;
      const rankText = r.rank !== null ? `${r.rank}${isRankTied ? '=' : ''}` : '';
      // Highlight the top-3 finishers' rank cell, reusing the summary table's
      // podium classes so per-race and summary podiums share one colour scheme.
      const podiumClass = r.rank !== null && r.rank >= 1 && r.rank <= 3 ? ` class="rank${r.rank}"` : '';
      const codeSuffix = r.resultCode && r.resultCode !== 'RDG' ? ` ${r.resultCode}` : '';
      const pointsText = r.penaltyCode
        ? `${formatPoints(r.points)} ${formatPenaltyLabel(r.penaltyCode, r.penaltyOverride, r.penaltyLabel)}`
        : r.resultCode === 'RDG'
          ? `${formatPoints(r.points)} RDG`
          : `${formatPoints(r.points)}${codeSuffix}`;
      const handicapCells = hasHandicapCols
        ? [
            `<td class="mono">${esc(r.finishTime ?? '')}</td>`,
            `<td class="mono">${r.elapsedTimeSecs != null ? formatDurationSecs(r.elapsedTimeSecs) : ''}</td>`,
            `<td class="mono">${r.tcc != null ? r.tcc.toFixed(isOrcTod ? 1 : 3) : ''}${r.tccOverride ? '<span class="override-marker" title="Per-race rating override">*</span>' : ''}</td>`,
            `<td class="mono">${r.correctedTimeSecs != null ? formatCorrectedSecs(r.correctedTimeSecs) : ''}</td>`,
          ]
        : [];
      const orcIwCell = isOrcPcs
        ? [`<td class="mono"${r.impliedWind != null ? ` title="${r.impliedWind.toFixed(5)} kt"` : ''}>${r.impliedWind != null ? r.impliedWind.toFixed(2) : ''}</td>`]
        : [];
      const nhcNewTcfCell = isNhc ? [renderNhcNewTcfCell(r)] : [];
      const echoNewHCell = isEcho ? [renderEchoNewHCell(r)] : [];
      const nhcCells = hasExplain ? renderNhcCells(r) : [];
      const echoCells = hasEchoExplain ? renderEchoCells(r) : [];
      return [
        `<tr class="${rowClass} racerow">`,
        `<td${podiumClass}>${rankText}</td>`,
        `<td>${esc(r.sailNumber)}</td>`,
        ...(showBowNumber ? [`<td>${esc(r.bowNumber ?? '')}</td>`] : []),
        ...(showEntryNumber ? [`<td>${esc(r.entryNumber ?? '')}</td>`] : []),
        ...(showTallyNumber ? [`<td>${esc(r.tallyNumber ?? '')}</td>`] : []),
        ...(showBoatName ? [`<td>${esc(r.boatName ?? '')}</td>`] : []),
        ...(showBoatClass ? [`<td>${esc(r.boatClass ?? '')}</td>`] : []),
        `<td>${renderHelmCell(r.helm, r.crewNames, showCrewName, helmBioUrl(r.worldSailingId, showWorldSailingId))}</td>`,
        ...(showHelm ? [`<td>${renderPersonCell(r.helmRole)}</td>`] : []),
        ...(showOwner ? [`<td>${renderPersonCell(r.owner)}</td>`] : []),
        ...(showClub ? [`<td>${esc(r.club ?? '')}</td>`] : []),
        ...(showNationality ? [renderNationalityCell(r.nationality, flagSvgByCode)] : []),
        ...(showWorldSailingId ? [renderWorldSailingIdCell(r.worldSailingId)] : []),
        ...subdivisionAxes.map((axis) => `<td>${esc(r.subdivisions?.[axis.id] ?? '')}</td>`),
        ...(showAge ? [`<td>${r.age != null ? r.age : ''}</td>`] : []),
        ...(showGender ? [`<td>${esc(r.gender ?? '')}</td>`] : []),
        ...handicapCells,
        ...orcIwCell,
        ...nhcNewTcfCell,
        ...echoNewHCell,
        ...nhcCells,
        ...echoCells,
        `<td>${pointsText}</td>`,
        ...trackColumns.map((col) => `<td class="mono">${esc(col.value(r))}</td>`),
        `</tr>`,
      ].join('\n');
    })
    .join('\n');

  const baseColCount = 4 + (showBowNumber ? 1 : 0) + (showEntryNumber ? 1 : 0) + (showTallyNumber ? 1 : 0) + (showBoatName ? 1 : 0) + (showBoatClass ? 1 : 0) + (showHelm ? 1 : 0) + (showOwner ? 1 : 0) + (showClub ? 1 : 0) + (showNationality ? 1 : 0) + (showWorldSailingId ? 1 : 0) + subdivisionAxes.length + (showAge ? 1 : 0) + (showGender ? 1 : 0);
  const colCount = baseColCount
    + (hasHandicapCols ? 4 : 0)
    + (isOrcPcs ? 1 : 0)
    + (isNhc ? 1 : 0) + (hasExplain ? 5 : 0)
    + (isEcho ? 1 : 0) + (hasEchoExplain ? 3 : 0)
    + trackColumns.length;
  const trackHeaders = trackColumns
    .map((col) => `\n<th${col.title ? ` title="${esc(col.title)}"` : ''}>${esc(col.header)}</th>`)
    .join('');
  const trackCols = trackColumns.map(() => '\n<col class="trackdata" />').join('');
  const handicapHeaders = hasHandicapCols
    ? `\n<th>Finish</th>\n<th>ET</th>\n<th>${ratingLabel}</th>\n<th>CT</th>`
    : '';
  const handicapCols = hasHandicapCols
    ? `\n<col class="finish" />\n<col class="et" />\n<col class="${ratingColClass}" />\n<col class="ct" />`
    : '';
  // "New TCF" is always visible for NHC fleets (alongside Finish/ET/TCF/CT) —
  // it's the next-race rating, the headline output of progressive scoring, so
  // it shows even when the scorer has opted out of publishing the underlying
  // calculations. The five SWNHC2015 explainability columns (Q, S, α, Z,
  // Adjustment) remain under the calculation toggle for verification.
  const nhcNewTcfHeader = isNhc ? '\n<th>New TCF</th>' : '';
  const nhcNewTcfCol = isNhc ? '\n<col class="newtcf" />' : '';
  const nhcHeaders = hasExplain
    ? '\n<th class="nhc-detail">Q</th>\n<th class="nhc-detail">S</th>\n<th class="nhc-detail">α</th>\n<th class="nhc-detail">Z</th>\n<th class="nhc-detail">Adjustment</th>'
    : '';
  const nhcCols = hasExplain
    ? '\n<col class="fairtcf nhc-detail" />\n<col class="compscore nhc-detail" />\n<col class="alpha nhc-detail" />\n<col class="provisional nhc-detail" />\n<col class="adjustment nhc-detail" />'
    : '';
  const nhcSubheading = hasExplain
    ? (race.nhcHeader!.updateSuppressed
        ? `<p class="nhc-fleet-header nhc-detail" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">Rating system: NHC1 (SWNHC2015) &middot; Finishers: ${race.nhcHeader!.finisherCount} &middot; <strong>Rating update suppressed (fewer than 3 finishers)</strong></p>`
        : `<p class="nhc-fleet-header nhc-detail" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">Rating system: NHC1 (SWNHC2015) &middot; Finishers: ${race.nhcHeader!.finisherCount} &middot; μ(S) = ${race.nhcHeader!.sMean.toFixed(4)} &middot; σ(S) = ${race.nhcHeader!.sStdev.toFixed(4)} &middot; extreme if S &gt; ${race.nhcHeader!.sHi.toFixed(4)} or S &lt; ${race.nhcHeader!.sLo.toFixed(4)} (${race.nhcHeader!.extremeCount} this race) &middot; P50 = ${race.nhcHeader!.p50.toFixed(6)}${race.nhcHeader!.w51 != null ? ` &middot; W51 = ${race.nhcHeader!.w51.toFixed(6)}` : ''} &middot; Z51 = ${race.nhcHeader!.realignmentFactor.toFixed(6)}</p>`)
    : '';
  // ECHO IS-notation columns: 1/T_E, PI, Adjustment hide under the calculation
  // toggle; New H is always visible for ECHO fleets so competitors see next
  // race's handicap regardless of whether the math is being published. Header
  // reproduces the IS-formula inputs.
  const echoNewHHeader = isEcho ? '\n<th>New H</th>' : '';
  const echoNewHCol = isEcho ? '\n<col class="newh" />' : '';
  const orcIwHeader = isOrcPcs ? '\n<th>Implied wind</th>' : '';
  const orcIwCol = isOrcPcs ? '\n<col class="iw" />' : '';
  // The ORC audit line: how this race's corrected times were arrived at —
  // the scoring wind and its source, the course, and the scratch allowance.
  // Always visible: making PCS checkable by competitors is the point.
  const orcSubheading = race.orcHeader
    ? (() => {
        const h = race.orcHeader;
        const parts: string[] = [];
        if (h.distanceNm != null) {
          parts.push(
            h.courseModel === 'CC'
              ? `Constructed course &middot; ${h.distanceNm.toFixed(2)} NM${h.legs?.length ? ` &middot; ${h.legs.length} legs` : ''}`
              : h.courseModel
                ? `${h.courseModel === 'WL' ? 'Windward/leeward' : h.courseModel === 'CR' ? 'All-purpose' : 'Coastal'} course model &middot; ${h.distanceNm.toFixed(2)} NM`
                : `Course ${h.distanceNm.toFixed(2)} NM`,
          );
        }
        // On a PCS race the course model already names the method, and the
        // stored option duplicates it — the field name is only meaningful
        // for certificate single numbers and bands.
        if (h.option && h.scoringWind == null) parts.push(`Rating field ${esc(h.option)}`);
        if (h.scoringWind != null) {
          parts.push(
            `Scoring wind ${h.scoringWind.toFixed(2)} kt (${h.scoringWindOverridden ? 'set by the race committee' : "winner's implied wind"})`,
          );
        }
        if (h.scratchTod != null) parts.push(`Scratch allowance ${h.scratchTod.toFixed(1)} s/NM`);
        const lead =
          h.scoringWind != null
            ? 'Scored on ORC performance curves'
            : h.scratchTod != null
              ? 'Scored on ORC time-on-distance'
              : 'Scored on an ORC certificate rating';
        const legsLine = h.legs?.length
          ? `\n<p class="orc-course-legs" style="text-align:center; margin: 0 0 6px 0; font-size: 0.85em;">Legs: ${h.legs
              .map((leg) => `${leg.distanceNm.toFixed(2)} NM @ ${leg.bearingDeg}&deg; (wind ${leg.windDirectionDeg}&deg;)`)
              .join(' &middot; ')}</p>`
          : '';
        return `<p class="orc-fleet-header" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">${lead}${parts.length ? ` &middot; ${parts.join(' &middot; ')}` : ''}</p>${legsLine}\n`;
      })()
    : '';
  const echoHeaders = hasEchoExplain
    ? '\n<th class="echo-detail">1/T_E</th>\n<th class="echo-detail">PI</th>\n<th class="echo-detail">Adjustment</th>'
    : '';
  const echoCols = hasEchoExplain
    ? '\n<col class="recip echo-detail" />\n<col class="pi echo-detail" />\n<col class="adjustment echo-detail" />'
    : '';
  const echoSubheading = hasEchoExplain
    ? `<p class="echo-fleet-header echo-detail" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">Rating system: ECHO &middot; α = ${race.echoHeader!.alpha} &middot; Finishers: ${race.echoHeader!.finisherCount} &middot; ΣH_S = ${race.echoHeader!.sumH.toFixed(3)} &middot; Σ(1/T_E) = ${race.echoHeader!.sumReciprocalEt.toFixed(5)}${race.echoHeader!.updateSuppressed ? ' &middot; <strong>Rating update suppressed (fewer than 3 finishers)</strong>' : ''}</p>`
    : '';

  const primaryTh = esc(showCrewName ? `${primaryHeader} / ${crewHeader}` : primaryHeader);
  const nameStr = race.name ? `${esc(race.name)}&nbsp;&mdash;&nbsp;` : '';
  // The Points column here is the race's own score at face value; the
  // multiplier applies in the series total, so say so where the two differ.
  const optionsNote = hasScoringOptions(race) ? scoringOptionsLegend(race, 'This race') : '';
  const labelsLegend = penaltyLabelLegend(race.results.map((r) => r.penaltyLabel ?? ''));
  const optionsSubheading = optionsNote
    ? `<p class="raceoptions" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">${esc(optionsNote)}</p>\n`
    : '';
  // The race record: conditions, then whoever ran it. Two lines rather than
  // one — a scorer reading down a page is looking for the wind or for the
  // team, and rarely both at once.
  const conditionsSubheading = hasConditions(race.conditions)
    ? `<p class="raceconditions" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">${esc(formatConditions(race.conditions))}</p>\n`
    : '';
  const officialsSubheading = hasOfficials(race.officials)
    ? `<p class="raceofficials" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">${esc(formatOfficials(race.officials))}</p>\n`
    : '';
  const labelStr = opts?.suppressLabel ? '' : `${esc(race.label)}&nbsp;&mdash;&nbsp;`;
  return `<h3 class="racetitle" id="${esc(race.anchorId)}">${labelStr}${nameStr}${dateStr}${startStr}</h3>
${optionsSubheading}${conditionsSubheading}${officialsSubheading}${orcSubheading}${nhcSubheading}${echoSubheading}<div class="tablewrap"><table class="racetable" cellspacing="0" cellpadding="0" border="0">
<colgroup span="${colCount}">
<col class="rank" />
<col class="sailno" />
${showBowNumber ? '<col class="bowno" />\n' : ''}${showEntryNumber ? '<col class="entryno" />\n' : ''}${showTallyNumber ? '<col class="tally" />\n' : ''}${showBoatName ? '<col class="boatname" />\n' : ''}${showBoatClass ? '<col class="boatclass" />\n' : ''}<col class="helmname" />
${showHelm ? '<col class="helm" />\n' : ''}${showOwner ? '<col class="owner" />\n' : ''}${showClub ? '<col class="club" />\n' : ''}${showNationality ? '<col class="nat" />\n' : ''}${showWorldSailingId ? '<col class="wsid" />\n' : ''}${subdivisionAxes.map(() => '<col class="subdivision" />\n').join('')}${showAge ? '<col class="age" />\n' : ''}${showGender ? '<col class="gender" />\n' : ''}${handicapCols}${orcIwCol}${nhcNewTcfCol}${echoNewHCol}${nhcCols}${echoCols}
<col class="points" />${trackCols}
</colgroup>
<thead>
<tr class="titlerow">
<th>Rank</th>
<th>Sail Number</th>
${showBowNumber ? '<th>Bow</th>\n' : ''}${showEntryNumber ? '<th>Entry</th>\n' : ''}${showTallyNumber ? '<th>Tally</th>\n' : ''}${showBoatName ? '<th>Boat</th>\n' : ''}${showBoatClass ? '<th>Class</th>\n' : ''}<th>${primaryTh}</th>${showHelm ? `\n<th>${esc(helmHeader)}</th>` : ''}${showOwner ? `\n<th>${esc(ownerHeader)}</th>` : ''}${showClub ? '\n<th>Club</th>' : ''}${showNationality ? '\n<th>Nationality</th>' : ''}${showWorldSailingId ? '\n<th>World Sailing ID</th>' : ''}${subdivisionAxes.map((axis) => `\n<th>${esc(axisHeader(axis))}</th>`).join('')}${showAge ? '\n<th>Age</th>' : ''}${showGender ? '\n<th>Gender</th>' : ''}${handicapHeaders}${orcIwHeader}${nhcNewTcfHeader}${echoNewHHeader}${nhcHeaders}${echoHeaders}
<th>Points</th>${trackHeaders}
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table></div>${labelsLegend ? `\n${labelsLegend}` : ''}`;
}

/** Emit one `<symbol>` per referenced nationality code, deduped, so 200
 *  same-nation competitors share a single ~1 KB SVG def rather than copying
 *  it into every row. Codes without a flag in `flagSvgByCode` are skipped
 *  here and fall back to text-only rendering in the Nat cell. */
export function renderFlagDefs(
  referencedCodes: readonly string[],
  flagSvgByCode: Readonly<Record<string, { viewBox: string; inner: string }>> | undefined,
): string {
  if (!flagSvgByCode) return '';
  const symbols: string[] = [];
  for (const code of referencedCodes) {
    const flag = flagSvgByCode[code];
    if (!flag) continue;
    symbols.push(`<symbol id="flag-${esc(code)}" viewBox="${esc(flag.viewBox)}">${flag.inner}</symbol>`);
  }
  if (symbols.length === 0) return '';
  // Hide the host SVG visually while keeping referenced <use> targets resolvable.
  return `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>${symbols.join('')}</defs></svg>`;
}

/** Render a single Nat cell: flag stacked above the canonical code (matching
 *  the Sailwave layout). Unknown codes (not in `flagSvgByCode`) render
 *  code-only. Empty values render an empty cell so the column stays aligned. */
function renderNationalityCell(
  code: string | undefined,
  flagSvgByCode: Readonly<Record<string, { viewBox: string; inner: string }>> | undefined,
): string {
  if (!code) return `<td class="nat"></td>`;
  const hasFlag = flagSvgByCode != null && flagSvgByCode[code] != null;
  const flagSpan = hasFlag
    ? `<span class="flag"><svg xmlns="http://www.w3.org/2000/svg"><use href="#flag-${esc(code)}" /></svg></span>`
    : '';
  return `<td class="nat">${flagSpan}<span class="nattext">${esc(code)}</span></td>`;
}

/** Render a Sailor ID cell as a link to the sailor's World Sailing biography.
 *  Published results are where a competitor goes looking for their own record,
 *  and the ID is only useful if it takes them there. */
function renderWorldSailingIdCell(id: string | undefined): string {
  if (!id) return `<td class="wsid"></td>`;
  return `<td class="wsid"><a href="${esc(worldSailingProfileUrl(id))}" target="_blank" rel="noopener noreferrer">${esc(id)}</a></td>`;
}

/** Render the always-visible "New TCF" cell for one row. The next-race rating
 *  is the headline output of progressive scoring, so we surface it alongside
 *  Finish/ET/TCF/CT rather than hiding it under the calculation toggle.
 *  Non-finishers carry their TCF unchanged; the cell shows "unchanged". */
function renderNhcNewTcfCell(r: RaceResultData): string {
  const nhc = r.nhc;
  if (!nhc) return `<td></td>`;
  if (!nhc.isFinisher) return `<td class="mono">unchanged</td>`;
  return `<td class="mono">${nhc.newTcf.toFixed(3)}</td>`;
}

/** Render the five SWNHC2015 explainability cells for one row. Rating/finish/
 *  ET/CT and New TCF are always-visible columns rendered elsewhere; this
 *  helper only emits the five cells that hide under the viewer toggle.
 *
 *  Non-finishers leave the five computational cells blank. The verification
 *  contract: a competitor with a calculator should be able to reproduce
 *  the always-visible New TCF from these published values and the
 *  fleet-header Z51 via   New TCF ≈ round(Z × Z51, 3).
 *
 *  The S cell carries a † marker when the boat was classified as extreme
 *  (so the four-way α split — non-ext 0.30/0.15 vs extreme 0.15/0.075 — is
 *  visible at a glance). */
function renderNhcCells(r: RaceResultData): string[] {
  const nhc = r.nhc;
  if (!nhc || !nhc.isFinisher) {
    return [
      `<td class="nhc-detail"></td>`,
      `<td class="nhc-detail"></td>`,
      `<td class="nhc-detail"></td>`,
      `<td class="nhc-detail"></td>`,
      `<td class="nhc-detail"></td>`,
    ];
  }
  const sCell = nhc.compScore != null
    ? `${nhc.compScore.toFixed(4)}${nhc.isExtreme ? ' &dagger;' : ''}`
    : '';
  return [
    `<td class="mono nhc-detail">${nhc.fairTcf != null ? nhc.fairTcf.toFixed(4) : ''}</td>`,
    `<td class="mono nhc-detail">${sCell}</td>`,
    `<td class="mono nhc-detail">${nhc.alphaApplied != null ? nhc.alphaApplied.toFixed(3) : ''}</td>`,
    `<td class="mono nhc-detail">${nhc.provisionalTcf != null ? nhc.provisionalTcf.toFixed(4) : ''}</td>`,
    `<td class="mono nhc-detail">${nhc.adjustment != null ? formatSigned(nhc.adjustment, 4) : ''}</td>`,
  ];
}

/** Render the always-visible "New H" cell for one row. Mirrors
 *  renderNhcNewTcfCell for ECHO. */
function renderEchoNewHCell(r: RaceResultData): string {
  const echo = r.echo;
  if (!echo) return `<td></td>`;
  if (!echo.isFinisher) return `<td class="mono">unchanged</td>`;
  return `<td class="mono">${echo.newH.toFixed(3)}</td>`;
}

/** Render the three ECHO IS-notation explainability cells for one row. The
 *  rating/finish/ET/CT columns and New H (always-visible) are rendered
 *  elsewhere; this helper only emits the three cells that hide under the
 *  ECHO viewer toggle.
 *
 *  Non-finishers leave the three computational cells blank. The verification
 *  contract: a competitor with a calculator should be able to reproduce the
 *  always-visible New H from these published values via H + α × (PI − H),
 *  with PI verifiable from ΣH_S, T_E, and the fleet-header Σ(1/T_E). */
function renderEchoCells(r: RaceResultData): string[] {
  const echo = r.echo;
  if (!echo || !echo.isFinisher) {
    return [
      `<td class="echo-detail"></td>`,
      `<td class="echo-detail"></td>`,
      `<td class="echo-detail"></td>`,
    ];
  }
  return [
    `<td class="mono echo-detail">${echo.reciprocalEt != null ? echo.reciprocalEt.toFixed(5) : ''}</td>`,
    `<td class="mono echo-detail">${echo.pi != null ? echo.pi.toFixed(4) : ''}</td>`,
    `<td class="mono echo-detail">${echo.adjustment != null ? formatSigned(echo.adjustment, 4) : ''}</td>`,
  ];
}

function formatSigned(n: number, digits: number): string {
  return n >= 0 ? `+${n.toFixed(digits)}` : n.toFixed(digits);
}

/** One role column's cell: a single person as plain text, several stacked
 *  one per line. Returns escaped HTML — callers embed it as-is. */
function renderPersonCell(names: string[] | undefined): string {
  const list = (names ?? []).filter((n) => n.trim());
  if (list.length <= 1) return esc(list[0] ?? '');
  return list.map(esc).join('<br>');
}

/** Compose the combined primary/crew cell. The single-person, single-crew
 *  case keeps the classic one-line "Helm / Crew"; any more people — a
 *  syndicate primary or a keelboat crew — stack one name per line, primary
 *  first. With `bioUrl`, the primary name(s) link there (crew stay plain).
 *  Returns escaped HTML — callers embed it as-is. */
function renderHelmCell(
  helm: string[],
  crewNames: string[] | undefined,
  showCrewName: boolean,
  bioUrl?: string,
): string {
  const primary = helm.filter((n) => n.trim());
  const crew = showCrewName ? (crewNames ?? []).filter((n) => n.trim()) : [];
  const name = (n: string) =>
    bioUrl
      ? `<a href="${esc(bioUrl)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`
      : esc(n);
  if (primary.length <= 1 && crew.length === 0) return primary[0] ? name(primary[0]) : '';
  if (primary.length === 1 && crew.length === 1) return `${name(primary[0])} / ${esc(crew[0])}`;
  return [...primary.map(name), ...crew.map(esc)].join('<br>');
}

/** The helm cell's link target: the World Sailing bio, but only when the WS
 *  ID column is not on the table — when it is, the ID carries the link and
 *  the name stays plain, so a row never links to the profile twice. */
function helmBioUrl(
  worldSailingId: string | undefined,
  showWorldSailingId: boolean,
): string | undefined {
  return !showWorldSailingId && worldSailingId ? worldSailingProfileUrl(worldSailingId) : undefined;
}

// ---- Helpers ----

/** The penalty as it reads in a score cell: `SCP(30%)`, `DPI(2pts)`, or — when
 *  the scorer named a DPI — their name in place of the code, `TPO(2pts)`. The
 *  legend beneath the table says what a named one is; see
 *  {@link penaltyLabelLegend}. */
function formatPenaltyLabel(code: PenaltyCode, override: number | null, label?: string): string {
  // Escaped here rather than at the call sites: both of them interpolate the
  // result straight into a cell, and unlike a result code this half is the
  // scorer's free text.
  const shown = code === 'DPI' && label?.trim() ? esc(label.trim()) : code;
  if (override === null) return shown;
  if (code === 'DPI') return `${shown}(${override}pts)`;
  return `${shown}(${override}%)`;
}

/** A sentence naming every scorer-named DPI on a page, so a reader meeting
 *  "TPO" in a score cell can find out what it is. Empty when none is named. */
function penaltyLabelLegend(labels: Iterable<string>): string {
  const named = [...new Set([...labels].map((l) => l.trim()).filter(Boolean))].sort();
  if (named.length === 0) return '';
  const list = named.map(esc).join(', ');
  return `<p class="penaltylabels">${list}: discretionary points penalty (DPI), the points as shown.</p>`;
}

/** Format a score, total, or nett to one decimal place — the low-point
 *  convention used on published results ("1.0", "15.0 DNF", "22.5"). */
function formatPoints(n: number): string {
  return n.toFixed(1);
}

function renderScoreText(
  points: number,
  resultCode: ResultCode | null,
  penaltyCode: PenaltyCode | null,
  penaltyOverride: number | null,
  isDiscard: boolean,
  isRedress: boolean,
  penaltyLabel?: string,
): string {
  let text: string;
  if (isRedress) {
    text = `RDG(${formatPoints(points)})`;
  } else if (resultCode) {
    text = `${formatPoints(points)} ${resultCode}`;
  } else if (penaltyCode) {
    text = `${formatPoints(points)} ${formatPenaltyLabel(penaltyCode, penaltyOverride, penaltyLabel)}`;
  } else {
    text = formatPoints(points);
  }
  return isDiscard ? `(${text})` : text;
}

/**
 * IANA timezone used to render result timestamps (the "provisional as of" line).
 * Defaults to `Europe/Dublin` (Sail Scoring's home instance is Irish), overridable
 * per deployment via `NEXT_PUBLIC_DEFAULT_TIMEZONE` — mirrors `defaultSailCountry()`
 * in `rating-match.ts`. This matters because publishing renders server-side on
 * Vercel (UTC); without a fixed zone the stamp shows UTC rather than the
 * publisher's local time. An unset, empty, or invalid value falls back to the
 * default.
 */
function resultsTimeZone(): string {
  const tz = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE?.trim();
  if (!tz) return 'Europe/Dublin';
  try {
    // Throws RangeError on an unrecognised IANA zone.
    new Intl.DateTimeFormat('en-IE', { timeZone: tz });
    return tz;
  } catch {
    return 'Europe/Dublin';
  }
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-IE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: resultsTimeZone(),
    timeZoneName: 'short',
  });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IE', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: resultsTimeZone(),
  });
}

function formatIsoDate(iso: string): string {
  // Parse without timezone conversion
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-IE', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Parse "HH:MM:SS" → total seconds */
/** Format integer seconds as H:MM:SS or M:SS */
function formatDurationSecs(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format corrected time as H:MM:SS or M:SS. Per-finisher CT is already
 *  integer seconds; the NHC ctAvg header is a float, so round half-up here. */
function formatCorrectedSecs(secs: number): string {
  return formatDurationSecs(Math.floor(secs + 0.5));
}

/** Escape HTML special characters */
/** Ensure a link URL is absolute so it points outward rather than resolving
 *  relative to the results page. Sailwave (and scorers) often store a bare host
 *  like "www.hyc.ie" or "ilcaireland.com/event/"; prefix https:// when there's
 *  no scheme. Leaves already-absolute and protocol-relative URLs untouched. */
function externalHref(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url;
  return `https://${url}`;
}

/** Wrap `inner` HTML in an anchor to `url` when `url` is non-empty; otherwise
 *  return `inner` unchanged. Used to make the header logos clickable. */
function maybeLink(url: string | undefined, inner: string): string {
  if (!url) return inner;
  return `<a href="${esc(externalHref(url))}" target="_top" rel="noopener">${inner}</a>`;
}

// ---- Assembly helper ----

/**
 * Assemble SeriesResultsData from raw scoring outputs.
 * Call this from the standings page before passing to renderSeriesHtml().
 */
export function assembleSeriesResultsData(
  series: { name: string; venue: string; venueLogoUrl?: string; eventLogoUrl?: string; venueUrl?: string; eventUrl?: string },
  races: Array<{ id: string; raceNumber: number; name?: string | null; date: string; discardPolicy?: RaceDiscardPolicy; pointsMultiplier?: number; conditions?: RaceConditions; officials?: RaceOfficial[] }>,
  standings: Array<{
    rank: number;
    competitor: { id: string; sailNumber: string; bowNumber?: string; entryNumber?: string; tallyNumber?: string; boatName?: string; boatClass?: string; names: string[]; owners?: string[]; helms?: string[]; crewNames?: string[]; club?: string; nationality?: string; worldSailingId?: string; subdivisions?: Record<string, string>; gender?: 'M' | 'F' | ''; age?: number | null };
    racePoints: number[];
    raceCodes: (ResultCode | null)[];
    racePenaltyCodes?: (PenaltyCode | null)[];
    racePenaltyOverrides?: (number | null)[];
    racePenaltyLabels?: (string | null)[];
    raceRedressFlags?: boolean[];
    totalPoints: number;
    netPoints: number;
    raceDiscards: boolean[];
    raceExcluded?: boolean[];
  }>,
  raceScoresByRaceId: Map<string, Map<string, { points: number; place: number | null; rank: number | null; resultCode: ResultCode | null; penaltyCode?: PenaltyCode | null; penaltyOverride?: number | null; penaltyLabel?: string; finishTime?: string | null; elapsedSecs?: number | null; trackData?: FinishTrackData | null; tcfApplied?: number | null; tccOverride?: boolean; newTcf?: number | null; elapsedTime?: number | null; correctedTime?: number | null; orc?: OrcRaceCalc; nhc?: { fairTcf: number; compScore: number; isExtreme: boolean; extremeDirection?: 'fast' | 'slow'; alphaApplied: number; provisionalTcf: number; adjustment: number }; echo?: { ctRatio: number; fairTcf: number; adjustment: number; alphaApplied: number } }>>,
  competitorsById: Map<string, { sailNumber: string; bowNumber?: string; entryNumber?: string; tallyNumber?: string; boatName?: string; boatClass?: string; names: string[]; owners?: string[]; helms?: string[]; crewNames?: string[]; club?: string; nationality?: string; worldSailingId?: string; subdivisions?: Record<string, string>; gender?: 'M' | 'F' | ''; age?: number | null; ircTcc?: number; vprsTcc?: number; pyNumber?: number }>,
  enabledCompetitorFields: CompetitorFieldKey[],
  generatedAt: Date,
  fleetName?: string,
  options?: {
    /** Display label for the primary person slot. Defaults to "Competitor"
     *  in the renderer if omitted here (matching v1 file behaviour). */
    primaryPersonLabel?: PrimaryPersonLabel;
    /** Person fields opened to multiple names; their headers read plural. */
    multiPersonFields?: MultiPersonFieldKey[];
    /** Named subdivision axes; one prize-giving column each. */
    subdivisionAxes?: SubdivisionAxis[];
    /** RaceStart records for all races — used to find the gun time for this fleet */
    raceStarts?: Array<{ raceId: string; fleetIds: string[]; startTime?: string; courseLegs?: OrcCourseLeg[] }>;
    /** ID of the fleet being rendered */
    fleetId?: string;
    /** Scoring system of the fleet */
    scoringSystem?: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo' | 'vprs' | 'orc';
    /** When set (NHC fleets only), per-race aggregates that drive the
     *  rating-calculation fleet header line above each race table and the
     *  per-row explainability columns. Pass undefined to suppress the
     *  explainability columns even on NHC fleets (e.g. publishing toggle off). */
    nhcAggregatesByRaceId?: Map<string, NhcHeaderData>;
    /** When set (ECHO fleets only), per-race aggregates that drive the
     *  IS-notation fleet header line and ECHO explainability columns. Pass
     *  undefined to suppress the explainability columns even on ECHO fleets. */
    echoAggregatesByRaceId?: Map<string, EchoHeaderData>;
    /** When true and the fleet is NHC/ECHO, surface per-race applied ratings
     *  beneath each summary score (R2..N) and add a seed-rating column. */
    showPerRaceRatings?: boolean;
    /** Seed rating (initial NHC TCF / ECHO H) per competitor id; used to
     *  populate the seed-rating column in the summary table. */
    seedRatingByCompetitorId?: Map<string, number>;
    /** Prefix for the per-race in-page anchors (`#r1` → `#{prefix}r1`). Set
     *  per section on combined pages, where several fleets' race tables share
     *  one document and bare race numbers would collide. */
    anchorPrefix?: string;
    /** Results marked final: the page stamp reads "Final results" instead of
     *  the provisional-as-of line, dated by `finalisedAt` when known. */
    resultsFinal?: boolean;
    finalisedAt?: Date;
    /** The event's standing race management team. Officials are published
     *  only when the series has opted in, and this is the one place that
     *  decision is applied: callers pass the teams when `publishOfficials` is
     *  set and omit them otherwise, so the renderer never has to know. */
    officials?: RaceOfficial[];
    /** Whether per-race teams reach the page, on the same opt-in. */
    publishOfficials?: boolean;
    /** Attach RaceSense track data (and scratch finish times) to the race
     *  results. Callers resolve the whole opt-in — the workspace feature and
     *  the series' publishTrackData — before setting this, so the renderer's
     *  columns can stay purely data-driven. */
    showTrackData?: boolean;
  },
): SeriesResultsData {
  const { raceStarts, fleetId, scoringSystem, nhcAggregatesByRaceId, echoAggregatesByRaceId, primaryPersonLabel, multiPersonFields, subdivisionAxes, showPerRaceRatings, seedRatingByCompetitorId, anchorPrefix, resultsFinal, finalisedAt, officials, publishOfficials, showTrackData } = options ?? {};
  const isHandicap = scoringSystem === 'irc' || scoringSystem === 'vprs' || scoringSystem === 'py' || scoringSystem === 'nhc' || scoringSystem === 'echo' || scoringSystem === 'orc';
  const isNhcExplain = scoringSystem === 'nhc' && nhcAggregatesByRaceId != null;
  const isEchoExplain = scoringSystem === 'echo' && echoAggregatesByRaceId != null;

  // Build a map of raceId → startTime for this fleet
  const startTimeByRaceId = new Map<string, string>();
  if (isHandicap && raceStarts && fleetId) {
    for (const rs of raceStarts) {
      if (rs.raceId && rs.fleetIds.includes(fleetId) && rs.startTime) {
        startTimeByRaceId.set(rs.raceId, rs.startTime);
      }
    }
  }

  const raceDataList: RaceData[] = races.map((race) => {
    const scoresForRace = raceScoresByRaceId.get(race.id) ?? new Map();
    const startTime = startTimeByRaceId.get(race.id);
    const startSecs = startTime ? parseHmsToSeconds(startTime) ?? NaN : null;
    // The ORC audit header: correction ingredients from any scored cell's
    // audit block, plus the constructed-course record off the covering start.
    let orcHeaderData: OrcHeaderData | undefined;
    if (scoringSystem === 'orc') {
      const firstOrc = [...(scoresForRace as Map<string, { orc?: OrcRaceCalc }>).values()].find((s) => s.orc)?.orc;
      if (firstOrc) {
        const coveringStart = fleetId
          ? raceStarts?.find((rs) => rs.raceId === race.id && rs.fleetIds.includes(fleetId))
          : undefined;
        orcHeaderData = {
          ...(firstOrc.option ? { option: firstOrc.option } : {}),
          ...(firstOrc.scratchTod != null ? { scratchTod: firstOrc.scratchTod } : {}),
          ...(firstOrc.distanceNm != null ? { distanceNm: firstOrc.distanceNm } : {}),
          ...(firstOrc.scoringWind != null ? { scoringWind: firstOrc.scoringWind } : {}),
          ...(firstOrc.scoringWindOverridden ? { scoringWindOverridden: true } : {}),
          ...(firstOrc.courseModel ? { courseModel: firstOrc.courseModel } : {}),
          ...(firstOrc.courseModel === 'CC' && coveringStart?.courseLegs?.length
            ? { legs: coveringStart.courseLegs }
            : {}),
        };
      }
    }
    const results: RaceResultData[] = [];

    for (const [competitorId, score] of scoresForRace) {
      const competitor = competitorsById.get(competitorId);
      if (!competitor) continue;

      let tcc: number | undefined;
      let elapsedTimeSecs: number | undefined;
      let correctedTimeSecs: number | undefined;

      if (isHandicap && startSecs !== null) {
        // `score.tcfApplied` is the rating actually used to score this race —
        // override-aware for static fleets (a mid-series rating change), and the
        // running rating for progressive fleets. Fall back to the competitor's
        // current rating only when the engine emitted no per-race value.
        if (scoringSystem === 'irc') {
          tcc = score.tcfApplied ?? competitor.ircTcc ?? undefined;
        } else if (scoringSystem === 'vprs') {
          tcc = score.tcfApplied ?? competitor.vprsTcc ?? undefined;
        } else if (scoringSystem === 'py') {
          tcc = score.tcfApplied
            ?? (competitor.pyNumber != null && competitor.pyNumber > 0 ? 1000 / competitor.pyNumber : undefined);
        } else if ((scoringSystem === 'nhc' || scoringSystem === 'echo' || scoringSystem === 'orc') && score.tcfApplied != null) {
          // ORC: the applied rating depends on the option the race resolved
          // to, which the engine recorded — there is no meaningful
          // competitor-level fallback here.
          tcc = score.tcfApplied;
        }
        // A row recorded on a stopwatch has an elapsed time and no time of
        // day, so the ET and CT columns key off either.
        const et = score.elapsedTime
          ?? elapsedSecondsOf(
            { finishTime: score.finishTime, elapsedSecs: score.elapsedSecs },
            startSecs,
          );
        if (tcc != null && et != null) {
          elapsedTimeSecs = et;
          // Prefer the engine's corrected time when the score carries one —
          // for time-on-distance the ET × TCF recompute would be wrong, and
          // for time-on-time the two are identical by construction.
          correctedTimeSecs = score.correctedTime ?? roundCorrectedSecs(et, tcc);
        }
      }

      // The next-race rating (newTcf / newH) is shown unconditionally for NHC/ECHO
      // fleets — it's the headline output of progressive scoring, useful even when
      // the scorer has opted out of publishing the underlying calculations. The
      // calc-detail fields (ctRatio/fairTcf/adjustment for NHC; pi/reciprocalEt
      // for ECHO) only get attached when explainability is being published; the
      // renderer hides them under the viewer toggle.
      const nhcCell: NhcCellData | undefined = scoringSystem === 'nhc' && score.tcfApplied != null && score.newTcf != null
        ? {
            tcfApplied: score.tcfApplied,
            newTcf: score.newTcf,
            isFinisher: score.nhc != null,
            ...(isNhcExplain && score.nhc ? {
              fairTcf: score.nhc.fairTcf,
              compScore: score.nhc.compScore,
              isExtreme: score.nhc.isExtreme,
              ...(score.nhc.extremeDirection ? { extremeDirection: score.nhc.extremeDirection } : {}),
              alphaApplied: score.nhc.alphaApplied,
              provisionalTcf: score.nhc.provisionalTcf,
              adjustment: score.nhc.adjustment,
            } : {}),
          }
        : undefined;

      const echoCell: EchoCellData | undefined = scoringSystem === 'echo' && score.tcfApplied != null && score.newTcf != null
        ? {
            startingH: score.tcfApplied,
            newH: score.newTcf,
            isFinisher: score.echo != null,
            ...(isEchoExplain && score.echo
              ? {
                  pi: score.echo.fairTcf,
                  adjustment: score.echo.adjustment,
                  ...(elapsedTimeSecs != null && elapsedTimeSecs > 0 ? { reciprocalEt: 1 / elapsedTimeSecs } : {}),
                }
              : {}),
          }
        : undefined;

      results.push({
        sailNumber: competitor.sailNumber,
        ...(competitor.bowNumber ? { bowNumber: competitor.bowNumber } : {}),
        ...(competitor.entryNumber ? { entryNumber: competitor.entryNumber } : {}),
        ...(competitor.tallyNumber ? { tallyNumber: competitor.tallyNumber } : {}),
        ...(competitor.boatName ? { boatName: competitor.boatName } : {}),
        ...(competitor.boatClass ? { boatClass: competitor.boatClass } : {}),
        helm: competitor.names,
        ...(competitor.owners?.length ? { owner: competitor.owners } : {}),
        ...(competitor.helms?.length ? { helmRole: competitor.helms } : {}),
        ...(competitor.crewNames?.length ? { crewNames: competitor.crewNames } : {}),
        ...(competitor.club ? { club: competitor.club } : {}),
        ...(competitor.nationality ? { nationality: competitor.nationality } : {}),
        ...(competitor.worldSailingId ? { worldSailingId: competitor.worldSailingId } : {}),
        ...(competitor.subdivisions && Object.keys(competitor.subdivisions).length > 0
          ? { subdivisions: competitor.subdivisions }
          : {}),
        ...(competitor.gender ? { gender: competitor.gender } : {}),
        ...(competitor.age != null ? { age: competitor.age } : {}),
        place: score.place,
        rank: score.rank,
        points: score.points,
        resultCode: score.resultCode,
        penaltyCode: score.penaltyCode ?? null,
        penaltyOverride: score.penaltyOverride ?? null,
        ...(score.penaltyLabel ? { penaltyLabel: score.penaltyLabel } : {}),
        ...(tcc != null ? { tcc } : {}),
        ...(score.tccOverride ? { tccOverride: true } : {}),
        ...(score.orc?.impliedWind != null ? { impliedWind: score.orc.impliedWind } : {}),
        ...(score.finishTime && (isHandicap || showTrackData) ? { finishTime: score.finishTime } : {}),
        ...(showTrackData && score.elapsedSecs != null ? { elapsedSecs: score.elapsedSecs } : {}),
        ...(showTrackData && score.trackData ? { trackData: score.trackData } : {}),
        ...(elapsedTimeSecs != null ? { elapsedTimeSecs } : {}),
        ...(correctedTimeSecs != null ? { correctedTimeSecs } : {}),
        ...(nhcCell ? { nhc: nhcCell } : {}),
        ...(echoCell ? { echo: echoCell } : {}),
      });
    }

    // Finishers first (by crossing-order ascending), then coded boats (by sail number).
    results.sort((a, b) => {
      if (a.place !== null && b.place === null) return -1;
      if (a.place === null && b.place !== null) return 1;
      if (a.place !== null && b.place !== null) return a.place - b.place || compareSailNumbers(a.sailNumber, b.sailNumber);
      return compareSailNumbers(a.sailNumber, b.sailNumber);
    });

    const nhcHeader = isNhcExplain ? nhcAggregatesByRaceId!.get(race.id) : undefined;
    const echoHeader = isEchoExplain ? echoAggregatesByRaceId!.get(race.id) : undefined;

    return {
      raceNumber: race.raceNumber,
      date: race.date,
      ...(race.name ? { name: race.name } : {}),
      label: `R${race.raceNumber}`,
      anchorId: `${anchorPrefix ?? ''}r${race.raceNumber}`,
      ...(race.discardPolicy && race.discardPolicy !== 'normal' ? { discardPolicy: race.discardPolicy } : {}),
      ...(race.pointsMultiplier != null && race.pointsMultiplier !== 1 ? { pointsMultiplier: race.pointsMultiplier } : {}),
      ...(hasConditions(race.conditions) ? { conditions: race.conditions } : {}),
      ...(publishOfficials && hasOfficials(race.officials) ? { officials: race.officials } : {}),
      ...(startTime ? { startTime } : {}),
      ...(scoringSystem === 'nhc' ? { isNhc: true } : {}),
      ...(scoringSystem === 'echo' ? { isEcho: true } : {}),
      // The scoring option resolves per race, so the ToD presentation (s/NM
      // rating column, engine corrected times) is a per-race property too,
      // read off the audit block rather than the fleet configuration.
      ...(orcHeaderData?.scratchTod != null ? { isOrcTod: true } : {}),
      ...(orcHeaderData ? { orcHeader: orcHeaderData } : {}),
      ...(orcHeaderData?.scoringWind != null ? { isOrcPcs: true } : {}),
      results,
      ...(nhcHeader ? { nhcHeader } : {}),
      ...(echoHeader ? { echoHeader } : {}),
    };
  });

  // Determine per-race podium ranks by looking at who scored 1st/2nd/3rd place
  // within each race's results
  const racePodiums: Map<number, Map<string, 1 | 2 | 3>> = new Map();
  for (const raceData of raceDataList) {
    const podium = new Map<string, 1 | 2 | 3>();
    for (const r of raceData.results) {
      if (r.resultCode === null && r.rank !== null && r.rank <= 3) {
        podium.set(r.sailNumber, r.rank as 1 | 2 | 3);
      }
    }
    racePodiums.set(raceData.raceNumber, podium);
  }

  const isProgressive = scoringSystem === 'nhc' || scoringSystem === 'echo';
  const surfacePerRaceRatings = isProgressive && showPerRaceRatings === true;

  const standingRows: StandingRowData[] = standings.map((s) => {
    const seedRating = isProgressive ? seedRatingByCompetitorId?.get(s.competitor.id) : undefined;
    return {
      rank: s.rank,
      sailNumber: s.competitor.sailNumber,
      ...(s.competitor.boatName ? { boatName: s.competitor.boatName } : {}),
      ...(s.competitor.bowNumber ? { bowNumber: s.competitor.bowNumber } : {}),
      ...(s.competitor.entryNumber ? { entryNumber: s.competitor.entryNumber } : {}),
      ...(s.competitor.tallyNumber ? { tallyNumber: s.competitor.tallyNumber } : {}),
      helm: s.competitor.names,
      ...(s.competitor.owners?.length ? { owner: s.competitor.owners } : {}),
      ...(s.competitor.helms?.length ? { helmRole: s.competitor.helms } : {}),
      ...(s.competitor.crewNames?.length ? { crewNames: s.competitor.crewNames } : {}),
      ...(s.competitor.club ? { club: s.competitor.club } : {}),
      ...(s.competitor.nationality ? { nationality: s.competitor.nationality } : {}),
      ...(s.competitor.worldSailingId ? { worldSailingId: s.competitor.worldSailingId } : {}),
      ...(s.competitor.subdivisions && Object.keys(s.competitor.subdivisions).length > 0
        ? { subdivisions: s.competitor.subdivisions }
        : {}),
      ...(s.competitor.gender ? { gender: s.competitor.gender } : {}),
      ...(s.competitor.age != null ? { age: s.competitor.age } : {}),
      ...(seedRating != null ? { seedRating } : {}),
      raceScores: s.racePoints.map((points, i) => {
        const resultCode = s.raceCodes[i] ?? null;
        const penaltyCode = s.racePenaltyCodes?.[i] ?? null;
        const penaltyOverride = s.racePenaltyOverrides?.[i] ?? null;
        const penaltyLabel = s.racePenaltyLabels?.[i] ?? null;
        const isRedress = s.raceRedressFlags?.[i] ?? false;
        const race = races[i];
        const raceNumber = race?.raceNumber ?? i + 1;
        const podium = racePodiums.get(raceNumber);
        const podiumRank = resultCode === null && penaltyCode === null && !isRedress ? (podium?.get(s.competitor.sailNumber) ?? null) : null;
        // Per-race applied rating: surfaced in the summary for NHC/ECHO
        // fleets when the toggle is on. Skipped on R1 (the seed-rating column
        // carries it) and skipped for non-progressive fleets.
        let appliedRating: number | undefined;
        if (surfacePerRaceRatings && raceNumber > 1 && race) {
          const scoreForRace = raceScoresByRaceId.get(race.id)?.get(s.competitor.id);
          if (scoreForRace?.tcfApplied != null) appliedRating = scoreForRace.tcfApplied;
        }
        return {
          points,
          resultCode,
          penaltyCode,
          penaltyOverride,
          ...(penaltyLabel ? { penaltyLabel } : {}),
          isDiscard: s.raceDiscards[i] ?? false,
          isRedress,
          isExcluded: s.raceExcluded?.[i] ?? false,
          podiumRank,
          ...(appliedRating != null ? { appliedRating } : {}),
        };
      }),
      totalPoints: s.totalPoints,
      netPoints: s.netPoints,
    };
  });

  return {
    series,
    fleetName,
    leftLogoUrl: series.venueLogoUrl || undefined,
    rightLogoUrl: series.eventLogoUrl || undefined,
    leftUrl: series.venueUrl || undefined,
    rightUrl: series.eventUrl || undefined,
    generatedAt,
    ...(resultsFinal ? { resultsFinal: true } : {}),
    ...(finalisedAt ? { finalisedAt } : {}),
    ...(publishOfficials && hasOfficials(officials) ? { officials } : {}),
    enabledCompetitorFields,
    ...(primaryPersonLabel ? { primaryPersonLabel } : {}),
    ...(multiPersonFields?.length ? { multiPersonFields } : {}),
    ...(subdivisionAxes?.length ? { subdivisionAxes } : {}),
    races: raceDataList,
    standings: standingRows,
    ...(isProgressive ? { progressiveScoringSystem: scoringSystem as 'nhc' | 'echo' } : {}),
    ...(surfacePerRaceRatings ? { showPerRaceRatings: true } : {}),
  };
}
