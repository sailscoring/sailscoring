import type { ResultCode, PenaltyCode, CompetitorFieldKey, PrimaryPersonLabel } from './types';
import { escapeHtml as esc } from './html';
import { parseHmsToSeconds } from './time-parse';
import {
  PRIMARY_PERSON_LABEL_TEXT,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  isFieldDisabledByPrimary,
} from './competitor-fields';
import { roundCorrectedSecs } from './scoring';

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
  /** Which optional competitor fields the scorer has enabled for this series.
   *  Drives column visibility in the summary and race tables. The Boat column
   *  is shown iff this list contains 'boatName'; the helm cell includes the
   *  crew name iff this list contains 'crewName'. */
  enabledCompetitorFields: CompetitorFieldKey[];
  /** Label for the primary person slot (`Competitor.name`). Drives the
   *  summary and race table column heading that corresponds to the primary
   *  name. Defaults to "Competitor" if not set (matching v1 files). */
  primaryPersonLabel?: PrimaryPersonLabel;
  /** Heading for the subdivision column in the summary table (e.g. "Division",
   *  "Category"). Defaults to "Division" if not set. */
  subdivisionLabel?: string;
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
}

export interface RaceData {
  raceNumber: number;
  date: string; // ISO date string
  name?: string | null; // optional race label, shown in the section heading + column tooltip
  label: string; // column header, e.g. "R1" or "R3 Jul 23"
  anchorId: string; // in-page anchor, e.g. "r1"
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
  boatName?: string;
  boatClass?: string;
  /** Primary name — labelled per `SeriesResultsData.primaryPersonLabel`. */
  helm: string;
  /** Owner when recorded separately from the primary (helm-primary series). */
  owner?: string;
  /** Helm when recorded separately from the primary (owner-primary series). */
  helmRole?: string;
  crewName?: string;
  /** Sailing club affiliation. */
  club?: string;
  /** 3-letter national-letters code (RRS Appendix G / IOC). */
  nationality?: string;
  /** Subdivision within the fleet (e.g. "Gold", "GGM"). Labelled per
   *  `SeriesResultsData.subdivisionLabel`. */
  subdivision?: string;
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
  // Handicap fields — only set for IRC/PY fleets
  tcc?: number;              // Time Correction Factor (TCC for IRC, 1000/PY for PY)
  tccOverride?: boolean;     // true when tcc is a per-race override (mid-series rating change)
  finishTime?: string;       // "HH:MM:SS"
  elapsedTimeSecs?: number;  // integer seconds (finishTime − startTime)
  correctedTimeSecs?: number; // integer seconds, rounded half-up (elapsedTimeSecs × tcc)
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
  boatName?: string;
  boatClass?: string;
  /** Primary name — labelled per `SeriesResultsData.primaryPersonLabel`. */
  helm: string;
  /** Owner when recorded separately (helm-primary series). */
  owner?: string;
  /** Helm when recorded separately (owner-primary series). */
  helmRole?: string;
  crewName?: string;
  /** Sailing club affiliation. */
  club?: string;
  /** 3-letter national-letters code (RRS Appendix G / IOC). */
  nationality?: string;
  /** Subdivision within the fleet (e.g. "Gold", "Grand Master"), for the
   *  prize-giving column. Labelled per `SeriesResultsData.subdivisionLabel`. */
  subdivision?: string;
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

export function renderSeriesHtml(data: SeriesResultsData, options?: { fontPercent?: number }): string {
  const { series, fleetName, leftLogoUrl, rightLogoUrl, leftUrl, rightUrl, generatedAt, enabledCompetitorFields, primaryPersonLabel, subdivisionLabel, races, standings, openInAppUrl, seriesIndexUrl, progressiveScoringSystem, showPerRaceRatings } = data;
  const fontPercent = options?.fontPercent ?? 72;
  const summaryRatingSystem = showPerRaceRatings && progressiveScoringSystem ? progressiveScoringSystem : null;

  const primaryLabel = primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const primaryHeader = PRIMARY_PERSON_LABEL_TEXT[primaryLabel];
  const hasDiscards = standings.some((s) => s.netPoints !== s.totalPoints);
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
  // Subdivision is a summary-only column; suppress it if no competitor has a
  // value, mirroring the Nat-column behaviour.
  const showSubdivision =
    enabledCompetitorFields.includes('subdivision') &&
    standings.some((s) => !!s.subdivision);
  const subdivisionHeader = subdivisionLabel?.trim() || DEFAULT_SUBDIVISION_LABEL;
  // Age and Gender columns, suppressed when no competitor has a value — same
  // treatment as the Club/Nat columns.
  const showAge =
    enabledCompetitorFields.includes('age') &&
    (standings.some((s) => s.age != null) || races.some((r) => r.results.some((x) => x.age != null)));
  const showGender =
    enabledCompetitorFields.includes('gender') &&
    (standings.some((s) => !!s.gender) || races.some((r) => r.results.some((x) => !!x.gender)));
  const titleSuffix = fleetName ? ` \u2014 ${esc(fleetName)}` : '';
  const hasNhcDetail = races.some((r) => r.nhcHeader != null);
  const hasEchoDetail = races.some((r) => r.echoHeader != null);

  // Collect every nationality referenced in this document. Codes the caller
  // supplied a flag for get a single `<symbol>` definition; codes without
  // flags fall back to text rendering. Sort for deterministic output.
  const referencedCodes: string[] = (() => {
    const set = new Set<string>();
    for (const s of standings) if (s.nationality) set.add(s.nationality);
    for (const r of races) for (const x of r.results) if (x.nationality) set.add(x.nationality);
    return [...set].sort();
  })();
  const flagDefs = renderFlagDefs(referencedCodes, data.flagSvgByCode);

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
table.summarytable td .rating { display: block; font-size: 0.85em; color: #666; margin-top: 1px; font-family: monospace; }
table.summarytable td.discard .rating { color: #888; }
table.summarytable td.seedrating { font-family: monospace; }
td.nat { font-family: monospace; }
td.nat .flag { display: block; width: 20px; height: 13px; margin-bottom: 2px; border: 1px solid #ccc; }
td.nat .flag svg { display: block; width: 100%; height: 100%; }
td.nat .nattext { font-size: 0.8em; }
.print-btn { font: inherit; color: #073358; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
.print-btn:hover { color: #fb3a3b; }
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
${generatedAt ? `<h3 class="seriestitle">Results are provisional as of ${formatTime(generatedAt)} on ${formatDate(generatedAt)}</h3>` : ''}
${fleetName ? `<h2>${esc(fleetName)}</h2>` : ''}
${flagDefs}
${hasNhcDetail ? renderNhcToggle() + '\n' + renderNhcExplainer() : ''}
${hasEchoDetail ? renderEchoToggle() + '\n' + renderEchoExplainer() : ''}
${renderSummaryTable(standings, races, hasDiscards, showBoatName, showBoatClass, showHelm, showOwner, showCrewName, showClub, showNationality, showSubdivision, subdivisionHeader, showAge, showGender, primaryHeader, summaryRatingSystem, data.flagSvgByCode)}
${races
  .filter((race) => race.results.length > 0)
  .map((race) => renderRaceTable(race, showBoatName, showBoatClass, showHelm, showOwner, showCrewName, showClub, showNationality, showSubdivision, subdivisionHeader, showAge, showGender, primaryHeader, data.flagSvgByCode))
  .join('\n')}
<p class="hardleft">${leftUrl ? `<a href="${esc(externalHref(leftUrl))}" target="_top" rel="noopener">${esc(series.venue || leftUrl)}</a>` : ''}</p>
<p class="hardright">${rightUrl ? `<a href="${esc(externalHref(rightUrl))}" target="_top" rel="noopener">${esc(series.name)}</a>` : ''}</p>
<div style="clear:both;"></div>
<p class="credit"><svg viewBox="205 205 840 840" width="15" height="15" aria-hidden="true" style="vertical-align:-2px;margin-right:5px;"><path fill="#fb3a3b" d="M551,757.3c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-125.9,125.9c29.4-.8,58.5-.7,87.4.3l191.1-191.1c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-177.3,177.3c33.3,1.8,66.2,4.7,98.7,8.8l59.9-59.9c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-48.4,48.4c87.3,12.9,171.9,34.6,253.4,65.8-95.4-229.3-112.6-465-9.6-706L315.1,906.2c31.6-3.2,62.9-5.5,93.9-6.9l142.1-142Z"/></svg>Sail Scoring &mdash; <a href="https://sailscoring.ie" target="_top" rel="noopener">sailscoring.ie</a>${openInAppUrl ? ` &mdash; <a href="${esc(openInAppUrl)}" target="_top" rel="noopener">Open in Sail Scoring</a>` : ''} &mdash; ${renderPrintButton()}</p>
${hasNhcDetail ? renderNhcToggleScript() : ''}
${hasEchoDetail ? renderEchoToggleScript() : ''}
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
  hasDiscards: boolean,
  showBoatName: boolean,
  showBoatClass: boolean,
  showHelm: boolean,
  showOwner: boolean,
  showCrewName: boolean,
  showClub: boolean,
  showNationality: boolean,
  showSubdivision: boolean,
  subdivisionHeader: string,
  showAge: boolean,
  showGender: boolean,
  primaryHeader: string,
  ratingSystem: 'nhc' | 'echo' | null,
  flagSvgByCode: Readonly<Record<string, { viewBox: string; inner: string }>> | undefined,
): string {
  const hasSeedCol = ratingSystem !== null;
  const seedHeader = ratingSystem === 'nhc' ? 'NHC1' : (ratingSystem === 'echo' ? 'ECHO' : '');
  const extraCols = (showBoatName ? 1 : 0) + (showBoatClass ? 1 : 0) + (showHelm ? 1 : 0) + (showOwner ? 1 : 0) + (showClub ? 1 : 0) + (showNationality ? 1 : 0) + (showSubdivision ? 1 : 0) + (showAge ? 1 : 0) + (showGender ? 1 : 0);
  // rank + sail [+ boat] [+ class] + primary [+ helm] [+ owner] [+ club] [+ nat] [+ subdivision] [+ age] [+ gender] [+ seed] + races + total [+ nett]
  const colCount = 3 + extraCols + (hasSeedCol ? 1 : 0) + races.length + (hasDiscards ? 2 : 1);

  const cols = [
    '<col class="rank" />',
    '<col class="sailno" />',
    ...(showBoatName ? ['<col class="boatname" />'] : []),
    ...(showBoatClass ? ['<col class="boatclass" />'] : []),
    '<col class="helmname" />',
    ...(showHelm ? ['<col class="helm" />'] : []),
    ...(showOwner ? ['<col class="owner" />'] : []),
    ...(showClub ? ['<col class="club" />'] : []),
    ...(showNationality ? ['<col class="nat" />'] : []),
    ...(showSubdivision ? ['<col class="subdivision" />'] : []),
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
    ...(showBoatName ? ['<th>Boat</th>'] : []),
    ...(showBoatClass ? ['<th>Class</th>'] : []),
    `<th>${esc(showCrewName ? `${primaryHeader} / Crew` : primaryHeader)}</th>`,
    ...(showHelm ? ['<th>Helm</th>'] : []),
    ...(showOwner ? ['<th>Owner</th>'] : []),
    ...(showClub ? ['<th>Club</th>'] : []),
    ...(showNationality ? ['<th>Nationality</th>'] : []),
    ...(showSubdivision ? [`<th>${esc(subdivisionHeader)}</th>`] : []),
    ...(showAge ? ['<th>Age</th>'] : []),
    ...(showGender ? ['<th>Gender</th>'] : []),
    ...(hasSeedCol ? [`<th>${esc(seedHeader)}</th>`] : []),
    ...races.map((r) => {
      const titleAttr = r.name ? ` title="${esc(r.name)}"` : '';
      return r.results.length > 0
        ? `<th${titleAttr}><a class="racelink" href="#${esc(r.anchorId)}">${esc(r.label)}</a></th>`
        : `<th${titleAttr}>${esc(r.label)}</th>`;
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
          const text = renderScoreText(score.points, score.resultCode, score.penaltyCode, score.penaltyOverride, score.isDiscard, score.isRedress);
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
        ...(showBoatName ? [`<td>${esc(s.boatName ?? '')}</td>`] : []),
        ...(showBoatClass ? [`<td>${esc(s.boatClass ?? '')}</td>`] : []),
        `<td>${esc(renderHelmCell(s.helm, s.crewName, showCrewName))}</td>`,
        ...(showHelm ? [`<td>${esc(s.helmRole ?? '')}</td>`] : []),
        ...(showOwner ? [`<td>${esc(s.owner ?? '')}</td>`] : []),
        ...(showClub ? [`<td>${esc(s.club ?? '')}</td>`] : []),
        ...(showNationality ? [renderNationalityCell(s.nationality, flagSvgByCode)] : []),
        ...(showSubdivision ? [`<td>${esc(s.subdivision ?? '')}</td>`] : []),
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
</table></div>`;
}

// ---- Race detail table ----

function renderRaceTable(
  race: RaceData,
  showBoatName: boolean,
  showBoatClass: boolean,
  showHelm: boolean,
  showOwner: boolean,
  showCrewName: boolean,
  showClub: boolean,
  showNationality: boolean,
  showSubdivision: boolean,
  subdivisionHeader: string,
  showAge: boolean,
  showGender: boolean,
  primaryHeader: string,
  flagSvgByCode: Readonly<Record<string, { viewBox: string; inner: string }>> | undefined,
): string {
  const dateStr = formatIsoDate(race.date);
  const startStr = race.startTime ? ` &mdash; Start: ${esc(race.startTime)}` : '';
  const isNhc = race.isNhc === true || race.nhcHeader != null;
  const isEcho = race.isEcho === true || race.echoHeader != null;
  const hasExplain = race.nhcHeader != null;
  const hasEchoExplain = race.echoHeader != null;
  const hasHandicapCols = race.results.some((r) => r.tcc != null);
  // ECHO uses "Starting H" per the IS guide; NHC uses "TCF"; static handicap fleets use "TCC".
  const ratingLabel = isEcho ? 'Starting H' : (isNhc ? 'TCF' : 'TCC');
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
        ? `${formatPoints(r.points)} ${formatPenaltyLabel(r.penaltyCode, r.penaltyOverride)}`
        : r.resultCode === 'RDG'
          ? `${formatPoints(r.points)} RDG`
          : `${formatPoints(r.points)}${codeSuffix}`;
      const handicapCells = hasHandicapCols
        ? [
            `<td class="mono">${esc(r.finishTime ?? '')}</td>`,
            `<td class="mono">${r.elapsedTimeSecs != null ? formatDurationSecs(r.elapsedTimeSecs) : ''}</td>`,
            `<td class="mono">${r.tcc != null ? r.tcc.toFixed(3) : ''}${r.tccOverride ? '<span class="override-marker" title="Per-race rating override">*</span>' : ''}</td>`,
            `<td class="mono">${r.correctedTimeSecs != null ? formatCorrectedSecs(r.correctedTimeSecs) : ''}</td>`,
          ]
        : [];
      const nhcNewTcfCell = isNhc ? [renderNhcNewTcfCell(r)] : [];
      const echoNewHCell = isEcho ? [renderEchoNewHCell(r)] : [];
      const nhcCells = hasExplain ? renderNhcCells(r) : [];
      const echoCells = hasEchoExplain ? renderEchoCells(r) : [];
      return [
        `<tr class="${rowClass} racerow">`,
        `<td${podiumClass}>${rankText}</td>`,
        `<td>${esc(r.sailNumber)}</td>`,
        ...(showBoatName ? [`<td>${esc(r.boatName ?? '')}</td>`] : []),
        ...(showBoatClass ? [`<td>${esc(r.boatClass ?? '')}</td>`] : []),
        `<td>${esc(renderHelmCell(r.helm, r.crewName, showCrewName))}</td>`,
        ...(showHelm ? [`<td>${esc(r.helmRole ?? '')}</td>`] : []),
        ...(showOwner ? [`<td>${esc(r.owner ?? '')}</td>`] : []),
        ...(showClub ? [`<td>${esc(r.club ?? '')}</td>`] : []),
        ...(showNationality ? [renderNationalityCell(r.nationality, flagSvgByCode)] : []),
        ...(showSubdivision ? [`<td>${esc(r.subdivision ?? '')}</td>`] : []),
        ...(showAge ? [`<td>${r.age != null ? r.age : ''}</td>`] : []),
        ...(showGender ? [`<td>${esc(r.gender ?? '')}</td>`] : []),
        ...handicapCells,
        ...nhcNewTcfCell,
        ...echoNewHCell,
        ...nhcCells,
        ...echoCells,
        `<td>${pointsText}</td>`,
        `</tr>`,
      ].join('\n');
    })
    .join('\n');

  const baseColCount = 4 + (showBoatName ? 1 : 0) + (showBoatClass ? 1 : 0) + (showHelm ? 1 : 0) + (showOwner ? 1 : 0) + (showClub ? 1 : 0) + (showNationality ? 1 : 0) + (showSubdivision ? 1 : 0) + (showAge ? 1 : 0) + (showGender ? 1 : 0);
  const colCount = baseColCount
    + (hasHandicapCols ? 4 : 0)
    + (isNhc ? 1 : 0) + (hasExplain ? 5 : 0)
    + (isEcho ? 1 : 0) + (hasEchoExplain ? 3 : 0);
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
  const echoHeaders = hasEchoExplain
    ? '\n<th class="echo-detail">1/T_E</th>\n<th class="echo-detail">PI</th>\n<th class="echo-detail">Adjustment</th>'
    : '';
  const echoCols = hasEchoExplain
    ? '\n<col class="recip echo-detail" />\n<col class="pi echo-detail" />\n<col class="adjustment echo-detail" />'
    : '';
  const echoSubheading = hasEchoExplain
    ? `<p class="echo-fleet-header echo-detail" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">Rating system: ECHO &middot; α = ${race.echoHeader!.alpha} &middot; Finishers: ${race.echoHeader!.finisherCount} &middot; ΣH_S = ${race.echoHeader!.sumH.toFixed(3)} &middot; Σ(1/T_E) = ${race.echoHeader!.sumReciprocalEt.toFixed(5)}${race.echoHeader!.updateSuppressed ? ' &middot; <strong>Rating update suppressed (fewer than 3 finishers)</strong>' : ''}</p>`
    : '';

  const primaryTh = esc(showCrewName ? `${primaryHeader} / Crew` : primaryHeader);
  const nameStr = race.name ? `${esc(race.name)}&nbsp;&mdash;&nbsp;` : '';
  return `<h3 class="racetitle" id="${esc(race.anchorId)}">${esc(race.label)}&nbsp;&mdash;&nbsp;${nameStr}${dateStr}${startStr}</h3>
${nhcSubheading}${echoSubheading}<div class="tablewrap"><table class="racetable" cellspacing="0" cellpadding="0" border="0">
<colgroup span="${colCount}">
<col class="rank" />
<col class="sailno" />
${showBoatName ? '<col class="boatname" />\n' : ''}${showBoatClass ? '<col class="boatclass" />\n' : ''}<col class="helmname" />
${showHelm ? '<col class="helm" />\n' : ''}${showOwner ? '<col class="owner" />\n' : ''}${showClub ? '<col class="club" />\n' : ''}${showNationality ? '<col class="nat" />\n' : ''}${showSubdivision ? '<col class="subdivision" />\n' : ''}${showAge ? '<col class="age" />\n' : ''}${showGender ? '<col class="gender" />\n' : ''}${handicapCols}${nhcNewTcfCol}${echoNewHCol}${nhcCols}${echoCols}
<col class="points" />
</colgroup>
<thead>
<tr class="titlerow">
<th>Rank</th>
<th>Sail Number</th>
${showBoatName ? '<th>Boat</th>\n' : ''}${showBoatClass ? '<th>Class</th>\n' : ''}<th>${primaryTh}</th>${showHelm ? '\n<th>Helm</th>' : ''}${showOwner ? '\n<th>Owner</th>' : ''}${showClub ? '\n<th>Club</th>' : ''}${showNationality ? '\n<th>Nationality</th>' : ''}${showSubdivision ? `\n<th>${esc(subdivisionHeader)}</th>` : ''}${showAge ? '\n<th>Age</th>' : ''}${showGender ? '\n<th>Gender</th>' : ''}${handicapHeaders}${nhcNewTcfHeader}${echoNewHHeader}${nhcHeaders}${echoHeaders}
<th>Points</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

/** Emit one `<symbol>` per referenced nationality code, deduped, so 200
 *  same-nation competitors share a single ~1 KB SVG def rather than copying
 *  it into every row. Codes without a flag in `flagSvgByCode` are skipped
 *  here and fall back to text-only rendering in the Nat cell. */
function renderFlagDefs(
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

/** Compose the text for the Helm column. When crew names are shown and a
 *  crew is set, renders "Helm / Crew"; otherwise just the helm name. The
 *  result is raw text — callers are responsible for HTML-escaping. */
function renderHelmCell(helm: string, crewName: string | undefined, showCrewName: boolean): string {
  if (showCrewName && crewName && crewName.trim()) {
    return `${helm} / ${crewName}`;
  }
  return helm;
}

// ---- Helpers ----

function formatPenaltyLabel(code: PenaltyCode, override: number | null): string {
  if (override === null) return code;
  if (code === 'DPI') return `${code}(${override}pts)`;
  return `${code}(${override}%)`;
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
): string {
  let text: string;
  if (isRedress) {
    text = `RDG(${formatPoints(points)})`;
  } else if (resultCode) {
    text = `${formatPoints(points)} ${resultCode}`;
  } else if (penaltyCode) {
    text = `${formatPoints(points)} ${formatPenaltyLabel(penaltyCode, penaltyOverride)}`;
  } else {
    text = formatPoints(points);
  }
  return isDiscard ? `(${text})` : text;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
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
  races: Array<{ id: string; raceNumber: number; name?: string | null; date: string }>,
  standings: Array<{
    rank: number;
    competitor: { id: string; sailNumber: string; boatName?: string; boatClass?: string; name: string; owner?: string; helm?: string; crewName?: string; club?: string; nationality?: string; subdivision?: string; gender?: 'M' | 'F' | ''; age?: number | null };
    racePoints: number[];
    raceCodes: (ResultCode | null)[];
    racePenaltyCodes?: (PenaltyCode | null)[];
    racePenaltyOverrides?: (number | null)[];
    raceRedressFlags?: boolean[];
    totalPoints: number;
    netPoints: number;
    raceDiscards: boolean[];
    raceExcluded?: boolean[];
  }>,
  raceScoresByRaceId: Map<string, Map<string, { points: number; place: number | null; rank: number | null; resultCode: ResultCode | null; penaltyCode?: PenaltyCode | null; penaltyOverride?: number | null; finishTime?: string | null; tcfApplied?: number | null; tccOverride?: boolean; newTcf?: number | null; elapsedTime?: number | null; nhc?: { fairTcf: number; compScore: number; isExtreme: boolean; extremeDirection?: 'fast' | 'slow'; alphaApplied: number; provisionalTcf: number; adjustment: number }; echo?: { ctRatio: number; fairTcf: number; adjustment: number; alphaApplied: number } }>>,
  competitorsById: Map<string, { sailNumber: string; boatName?: string; boatClass?: string; name: string; owner?: string; helm?: string; crewName?: string; club?: string; nationality?: string; subdivision?: string; gender?: 'M' | 'F' | ''; age?: number | null; ircTcc?: number; vprsTcc?: number; pyNumber?: number }>,
  enabledCompetitorFields: CompetitorFieldKey[],
  generatedAt: Date,
  fleetName?: string,
  options?: {
    /** Display label for the primary person slot. Defaults to "Competitor"
     *  in the renderer if omitted here (matching v1 file behaviour). */
    primaryPersonLabel?: PrimaryPersonLabel;
    /** Display label for the subdivision column. Defaults to "Division". */
    subdivisionLabel?: string;
    /** RaceStart records for all races — used to find the gun time for this fleet */
    raceStarts?: Array<{ raceId: string; fleetIds: string[]; startTime?: string }>;
    /** ID of the fleet being rendered */
    fleetId?: string;
    /** Scoring system of the fleet */
    scoringSystem?: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo' | 'vprs';
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
  },
): SeriesResultsData {
  const { raceStarts, fleetId, scoringSystem, nhcAggregatesByRaceId, echoAggregatesByRaceId, primaryPersonLabel, subdivisionLabel, showPerRaceRatings, seedRatingByCompetitorId } = options ?? {};
  const isHandicap = scoringSystem === 'irc' || scoringSystem === 'vprs' || scoringSystem === 'py' || scoringSystem === 'nhc' || scoringSystem === 'echo';
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
        } else if ((scoringSystem === 'nhc' || scoringSystem === 'echo') && score.tcfApplied != null) {
          tcc = score.tcfApplied;
        }
        if (tcc != null && score.finishTime) {
          const finishSecs = parseHmsToSeconds(score.finishTime) ?? NaN;
          elapsedTimeSecs = finishSecs - startSecs;
          correctedTimeSecs = roundCorrectedSecs(elapsedTimeSecs, tcc);
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
        ...(competitor.boatName ? { boatName: competitor.boatName } : {}),
        ...(competitor.boatClass ? { boatClass: competitor.boatClass } : {}),
        helm: competitor.name,
        ...(competitor.owner ? { owner: competitor.owner } : {}),
        ...(competitor.helm ? { helmRole: competitor.helm } : {}),
        ...(competitor.crewName ? { crewName: competitor.crewName } : {}),
        ...(competitor.club ? { club: competitor.club } : {}),
        ...(competitor.nationality ? { nationality: competitor.nationality } : {}),
        ...(competitor.subdivision ? { subdivision: competitor.subdivision } : {}),
        ...(competitor.gender ? { gender: competitor.gender } : {}),
        ...(competitor.age != null ? { age: competitor.age } : {}),
        place: score.place,
        rank: score.rank,
        points: score.points,
        resultCode: score.resultCode,
        penaltyCode: score.penaltyCode ?? null,
        penaltyOverride: score.penaltyOverride ?? null,
        ...(tcc != null ? { tcc } : {}),
        ...(score.tccOverride ? { tccOverride: true } : {}),
        ...(score.finishTime && isHandicap ? { finishTime: score.finishTime } : {}),
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
      if (a.place !== null && b.place !== null) return a.place - b.place || a.sailNumber.localeCompare(b.sailNumber);
      return a.sailNumber.localeCompare(b.sailNumber);
    });

    const nhcHeader = isNhcExplain ? nhcAggregatesByRaceId!.get(race.id) : undefined;
    const echoHeader = isEchoExplain ? echoAggregatesByRaceId!.get(race.id) : undefined;

    return {
      raceNumber: race.raceNumber,
      date: race.date,
      ...(race.name ? { name: race.name } : {}),
      label: `R${race.raceNumber}`,
      anchorId: `r${race.raceNumber}`,
      ...(startTime ? { startTime } : {}),
      ...(scoringSystem === 'nhc' ? { isNhc: true } : {}),
      ...(scoringSystem === 'echo' ? { isEcho: true } : {}),
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
      ...(s.competitor.boatClass ? { boatClass: s.competitor.boatClass } : {}),
      helm: s.competitor.name,
      ...(s.competitor.owner ? { owner: s.competitor.owner } : {}),
      ...(s.competitor.helm ? { helmRole: s.competitor.helm } : {}),
      ...(s.competitor.crewName ? { crewName: s.competitor.crewName } : {}),
      ...(s.competitor.club ? { club: s.competitor.club } : {}),
      ...(s.competitor.nationality ? { nationality: s.competitor.nationality } : {}),
      ...(s.competitor.subdivision ? { subdivision: s.competitor.subdivision } : {}),
      ...(s.competitor.gender ? { gender: s.competitor.gender } : {}),
      ...(s.competitor.age != null ? { age: s.competitor.age } : {}),
      ...(seedRating != null ? { seedRating } : {}),
      raceScores: s.racePoints.map((points, i) => {
        const resultCode = s.raceCodes[i] ?? null;
        const penaltyCode = s.racePenaltyCodes?.[i] ?? null;
        const penaltyOverride = s.racePenaltyOverrides?.[i] ?? null;
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
    enabledCompetitorFields,
    ...(primaryPersonLabel ? { primaryPersonLabel } : {}),
    ...(subdivisionLabel ? { subdivisionLabel } : {}),
    races: raceDataList,
    standings: standingRows,
    ...(isProgressive ? { progressiveScoringSystem: scoringSystem as 'nhc' | 'echo' } : {}),
    ...(surfacePerRaceRatings ? { showPerRaceRatings: true } : {}),
  };
}
