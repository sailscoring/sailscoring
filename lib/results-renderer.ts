import type { ResultCode, PenaltyCode, CompetitorFieldKey, PrimaryPersonLabel } from './types';
import {
  PRIMARY_PERSON_LABEL_TEXT,
  DEFAULT_PRIMARY_PERSON_LABEL,
  isFieldDisabledByPrimary,
} from './competitor-fields';

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
  /** Races in series order */
  races: RaceData[];
  /** Standings sorted by rank ascending */
  standings: StandingRowData[];
  /** Full import URL, e.g. https://app.sailscoring.ie/?import=<base64url>. When set,
   *  adds an "Open in Sail Scoring" link to the footer. */
  openInAppUrl?: string;
}

export interface RaceData {
  raceNumber: number;
  date: string; // ISO date string
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
  alpha: number;
  finisherCount: number;
  ctAvgSecs: number;
  meanTcf: number;
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
  place: number | null;   // internal sort key for display order; null for coded finishes
  rank: number | null;    // within-fleet finish rank; null for coded finishes
  points: number;
  resultCode: ResultCode | null;
  penaltyCode: PenaltyCode | null;
  penaltyOverride: number | null;
  // Handicap fields — only set for IRC/PY fleets
  tcc?: number;              // Time Correction Factor (TCC for IRC, 1000/PY for PY)
  finishTime?: string;       // "HH:MM:SS"
  elapsedTimeSecs?: number;  // integer seconds (finishTime − startTime)
  correctedTimeSecs?: number; // float seconds (elapsedTimeSecs × tcc)
  // NHC fields — only set for NHC fleets when explainability is enabled
  nhc?: NhcCellData;
  // ECHO fields — only set for ECHO fleets when explainability is enabled
  echo?: EchoCellData;
}

/** NHC per-finisher intermediates for the explainability columns. Set on
 *  every NHC competitor (including non-finishers — for non-finishers the
 *  cell renderer leaves intermediate columns blank and shows "unchanged"
 *  in the New TCF column). */
export interface NhcCellData {
  tcfApplied: number;
  newTcf: number;
  ctRatio?: number;
  fairTcf?: number;
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
  podiumRank: 1 | 2 | 3 | null;
}

// ---- Renderer ----

export function renderSeriesHtml(data: SeriesResultsData, options?: { fontPercent?: number }): string {
  const { series, fleetName, leftLogoUrl, rightLogoUrl, generatedAt, enabledCompetitorFields, primaryPersonLabel, races, standings, openInAppUrl } = data;
  const fontPercent = options?.fontPercent ?? 80;

  const primaryLabel = primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const primaryHeader = PRIMARY_PERSON_LABEL_TEXT[primaryLabel];
  const hasDiscards = standings.some((s) => s.netPoints !== s.totalPoints);
  const showBoatName = enabledCompetitorFields.includes('boatName');
  const showBoatClass = enabledCompetitorFields.includes('boatClass');
  const showHelm = enabledCompetitorFields.includes('helm') && !isFieldDisabledByPrimary('helm', primaryLabel);
  const showOwner = enabledCompetitorFields.includes('owner') && !isFieldDisabledByPrimary('owner', primaryLabel);
  const showCrewName = enabledCompetitorFields.includes('crewName');
  const titleSuffix = fleetName ? ` \u2014 ${esc(fleetName)}` : '';
  const hasNhcDetail = races.some((r) => r.nhcHeader != null);
  const hasEchoDetail = races.some((r) => r.echoHeader != null);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta name="description" content="sail scoring results">
<meta name="viewport" content="width=device-width">
<title>Results for ${esc(series.name)}${series.venue ? ' at ' + esc(series.venue) : ''}${titleSuffix}</title>
<style type="text/css">
body {font: ${fontPercent}% arial, helvetica, sans-serif; text-align: center;}
.hardleft  {text-align: left; float: left;  margin: 15px 0  15px 25px;}
.hardright {text-align: right; float: right; margin: 15px 25px 15px 0;}
table {text-align: left; margin: 0px auto 30px auto; font-size: 1em; border-collapse: collapse; border: 1px #999 solid;}
td, th {padding: 4px; border: 1px #999 solid; vertical-align: top;}
.caption {padding: 5px; text-align: center; border: 0; font-weight: bold;}
p {text-align: center;}
.odd {background-color: #eef;}
table.headertable {border: 0px;}
table.headertable td{border: 0px;}
td.rank1 { background: #ffd700; }
td.rank2 { background: #6a91c5; }
td.rank3 { background: #da6841; }
td.discard { background: #f2f2f2; }
td.discard.rank1, td.discard.rank2, td.discard.rank3 { background: #f2f2f2; }
${hasNhcDetail ? 'body.hide-nhc-detail .nhc-detail { display: none; }\np.nhc-toggle { text-align: center; margin: 0 0 10px 0; font-size: 0.9em; }\n' : ''}${hasEchoDetail ? 'body.hide-echo-detail .echo-detail { display: none; }\np.echo-toggle { text-align: center; margin: 0 0 10px 0; font-size: 0.9em; }\n' : ''}</style>
</head>
<body${[hasNhcDetail ? 'hide-nhc-detail' : '', hasEchoDetail ? 'hide-echo-detail' : ''].filter(Boolean).length > 0 ? ` class="${[hasNhcDetail ? 'hide-nhc-detail' : '', hasEchoDetail ? 'hide-echo-detail' : ''].filter(Boolean).join(' ')}"` : ''}>
<table class="headertable" cellspacing="0" width="100%" cellpadding="0" border="0">
<tbody>
<tr>
<td width="30%">${leftLogoUrl ? `<img style="display:block; height:100px;" src="${esc(leftLogoUrl)}" alt="venue logo" />` : ''}</td>
<td width="40%" align="center">
<h1>${esc(series.name)}</h1>
${series.venue ? `<h2>${esc(series.venue)}</h2>` : ''}
</td>
<td width="30%">${rightLogoUrl ? `<img style="display:block; height:100px;" src="${esc(rightLogoUrl)}" alt="event logo" align="right" />` : ''}</td>
</tr>
</tbody>
</table>
<div style="clear:both;"></div>
<style>div.applicant-break {page-break-after:always;}</style>
${generatedAt ? `<h3 class="seriestitle">Results are provisional as of ${formatTime(generatedAt)} on ${formatDate(generatedAt)}</h3>` : ''}
${fleetName ? `<h2>${esc(fleetName)}</h2>` : ''}
${hasNhcDetail ? renderNhcToggle() : ''}
${hasEchoDetail ? renderEchoToggle() : ''}
${renderSummaryTable(standings, races, hasDiscards, showBoatName, showBoatClass, showHelm, showOwner, showCrewName, primaryHeader)}
${races.map((race) => renderRaceTable(race, showBoatName, showBoatClass, showHelm, showOwner, showCrewName, primaryHeader)).join('\n')}
<p class="hardleft"></p>
<p class="hardright"></p>
<p>Sail Scoring &mdash; <a href="https://sailscoring.ie">sailscoring.ie</a>${openInAppUrl ? ` &mdash; <a href="${esc(openInAppUrl)}">Open in Sail Scoring</a>` : ''}</p>
${hasNhcDetail ? renderNhcToggleScript() : ''}
${hasEchoDetail ? renderEchoToggleScript() : ''}
</body>
</html>`;
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
  primaryHeader: string,
): string {
  const extraCols = (showBoatName ? 1 : 0) + (showBoatClass ? 1 : 0) + (showHelm ? 1 : 0) + (showOwner ? 1 : 0);
  const colCount = 3 + extraCols + races.length + (hasDiscards ? 2 : 1); // rank + sail [+ boat] [+ class] + primary [+ helm] [+ owner] + races + total [+ nett]

  const cols = [
    '<col class="rank" />',
    '<col class="sailno" />',
    ...(showBoatName ? ['<col class="boatname" />'] : []),
    ...(showBoatClass ? ['<col class="boatclass" />'] : []),
    '<col class="helmname" />',
    ...(showHelm ? ['<col class="helm" />'] : []),
    ...(showOwner ? ['<col class="owner" />'] : []),
    ...races.map(() => '<col class="race" />'),
    '<col class="total" />',
    ...(hasDiscards ? ['<col class="nett" />'] : []),
  ].join('\n');

  const headerCells = [
    '<th>Rank</th>',
    '<th>Sail</th>',
    ...(showBoatName ? ['<th>Boat</th>'] : []),
    ...(showBoatClass ? ['<th>Class</th>'] : []),
    `<th>${esc(showCrewName ? `${primaryHeader} / Crew` : primaryHeader)}</th>`,
    ...(showHelm ? ['<th>Helm</th>'] : []),
    ...(showOwner ? ['<th>Owner</th>'] : []),
    ...races.map(
      (r) => `<th><a class="racelink" href="#${esc(r.anchorId)}">${esc(r.label)}</a></th>`,
    ),
    '<th>Total</th>',
    ...(hasDiscards ? ['<th>Nett</th>'] : []),
  ].join('\n');

  const rows = standings
    .map((s, i) => {
      const rowClass = i % 2 === 0 ? 'odd' : 'even';
      const scoreCells = s.raceScores
        .map((score) => {
          const classes = [
            score.isDiscard ? 'discard' : '',
            score.podiumRank ? `rank${score.podiumRank}` : '',
          ]
            .filter(Boolean)
            .join(' ');
          const text = renderScoreText(score.points, score.resultCode, score.penaltyCode, score.penaltyOverride, score.isDiscard, score.isRedress);
          return classes ? `<td class="${classes}">${text}</td>` : `<td>${text}</td>`;
        })
        .join('\n');

      return [
        `<tr class="${rowClass} summaryrow">`,
        `<td>${ordinal(s.rank)}</td>`,
        `<td>${esc(s.sailNumber)}</td>`,
        ...(showBoatName ? [`<td>${esc(s.boatName ?? '')}</td>`] : []),
        ...(showBoatClass ? [`<td>${esc(s.boatClass ?? '')}</td>`] : []),
        `<td>${esc(renderHelmCell(s.helm, s.crewName, showCrewName))}</td>`,
        ...(showHelm ? [`<td>${esc(s.helmRole ?? '')}</td>`] : []),
        ...(showOwner ? [`<td>${esc(s.owner ?? '')}</td>`] : []),
        scoreCells,
        `<td>${s.totalPoints}</td>`,
        ...(hasDiscards ? [`<td>${s.netPoints}</td>`] : []),
        `</tr>`,
      ].join('\n');
    })
    .join('\n');

  return `<table class="summarytable" cellspacing="0" cellpadding="0" border="0">
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
</table>`;
}

// ---- Race detail table ----

function renderRaceTable(race: RaceData, showBoatName: boolean, showBoatClass: boolean, showHelm: boolean, showOwner: boolean, showCrewName: boolean, primaryHeader: string): string {
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
      const codeSuffix = r.resultCode && r.resultCode !== 'RDG' ? ` ${r.resultCode}` : '';
      const pointsText = r.penaltyCode
        ? `${r.points} ${formatPenaltyLabel(r.penaltyCode, r.penaltyOverride)}`
        : r.resultCode === 'RDG'
          ? `${r.points} RDG`
          : `${r.points}${codeSuffix}`;
      const handicapCells = hasHandicapCols
        ? [
            `<td class="mono">${esc(r.finishTime ?? '')}</td>`,
            `<td class="mono">${r.elapsedTimeSecs != null ? formatDurationSecs(r.elapsedTimeSecs) : ''}</td>`,
            `<td class="mono">${r.tcc != null ? r.tcc.toFixed(3) : ''}</td>`,
            `<td class="mono">${r.correctedTimeSecs != null ? formatCorrectedSecs(r.correctedTimeSecs) : ''}</td>`,
          ]
        : [];
      const nhcCells = hasExplain ? renderNhcCells(r) : [];
      const echoCells = hasEchoExplain ? renderEchoCells(r) : [];
      return [
        `<tr class="${rowClass} racerow">`,
        `<td>${rankText}</td>`,
        `<td>${esc(r.sailNumber)}</td>`,
        ...(showBoatName ? [`<td>${esc(r.boatName ?? '')}</td>`] : []),
        ...(showBoatClass ? [`<td>${esc(r.boatClass ?? '')}</td>`] : []),
        `<td>${esc(renderHelmCell(r.helm, r.crewName, showCrewName))}</td>`,
        ...(showHelm ? [`<td>${esc(r.helmRole ?? '')}</td>`] : []),
        ...(showOwner ? [`<td>${esc(r.owner ?? '')}</td>`] : []),
        ...handicapCells,
        ...nhcCells,
        ...echoCells,
        `<td>${pointsText}</td>`,
        `</tr>`,
      ].join('\n');
    })
    .join('\n');

  const baseColCount = 4 + (showBoatName ? 1 : 0) + (showBoatClass ? 1 : 0) + (showHelm ? 1 : 0) + (showOwner ? 1 : 0);
  const colCount = baseColCount + (hasHandicapCols ? 4 : 0) + (hasExplain ? 4 : 0) + (hasEchoExplain ? 4 : 0);
  const handicapHeaders = hasHandicapCols
    ? `\n<th>Finish</th>\n<th>ET</th>\n<th>${ratingLabel}</th>\n<th>CT</th>`
    : '';
  const handicapCols = hasHandicapCols
    ? `\n<col class="finish" />\n<col class="et" />\n<col class="${ratingColClass}" />\n<col class="ct" />`
    : '';
  const nhcHeaders = hasExplain
    ? '\n<th class="nhc-detail">CT ratio</th>\n<th class="nhc-detail">Fair TCF</th>\n<th class="nhc-detail">Adjustment</th>\n<th class="nhc-detail">New TCF</th>'
    : '';
  const nhcCols = hasExplain
    ? '\n<col class="ctratio nhc-detail" />\n<col class="fairtcf nhc-detail" />\n<col class="adjustment nhc-detail" />\n<col class="newtcf nhc-detail" />'
    : '';
  const nhcSubheading = hasExplain
    ? `<p class="nhc-fleet-header nhc-detail" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">Rating system: NHC1 &middot; α = ${race.nhcHeader!.alpha} &middot; Finishers: ${race.nhcHeader!.finisherCount} &middot; CT_avg: ${formatCorrectedSecs(race.nhcHeader!.ctAvgSecs)} &middot; mean TCF: ${race.nhcHeader!.meanTcf.toFixed(4)}</p>`
    : '';
  // ECHO IS-notation columns: 1/T_E, PI, Adjustment, New H — all hidden under
  // the ECHO viewer toggle. Header reproduces the IS-formula inputs.
  const echoHeaders = hasEchoExplain
    ? '\n<th class="echo-detail">1/T_E</th>\n<th class="echo-detail">PI</th>\n<th class="echo-detail">Adjustment</th>\n<th class="echo-detail">New H</th>'
    : '';
  const echoCols = hasEchoExplain
    ? '\n<col class="recip echo-detail" />\n<col class="pi echo-detail" />\n<col class="adjustment echo-detail" />\n<col class="newh echo-detail" />'
    : '';
  const echoSubheading = hasEchoExplain
    ? `<p class="echo-fleet-header echo-detail" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">Rating system: ECHO &middot; α = ${race.echoHeader!.alpha} &middot; Finishers: ${race.echoHeader!.finisherCount} &middot; ΣH_S = ${race.echoHeader!.sumH.toFixed(3)} &middot; Σ(1/T_E) = ${race.echoHeader!.sumReciprocalEt.toFixed(5)}${race.echoHeader!.updateSuppressed ? ' &middot; <strong>Rating update suppressed (fewer than 3 finishers)</strong>' : ''}</p>`
    : '';

  const primaryTh = esc(showCrewName ? `${primaryHeader} / Crew` : primaryHeader);
  return `<h3 class="racetitle" id="${esc(race.anchorId)}">${esc(race.label)}&nbsp;&mdash;&nbsp;${dateStr}${startStr}</h3>
${nhcSubheading}${echoSubheading}<table class="racetable" cellspacing="0" cellpadding="0" border="0">
<colgroup span="${colCount}">
<col class="rank" />
<col class="sailno" />
${showBoatName ? '<col class="boatname" />\n' : ''}${showBoatClass ? '<col class="boatclass" />\n' : ''}<col class="helmname" />
${showHelm ? '<col class="helm" />\n' : ''}${showOwner ? '<col class="owner" />\n' : ''}${handicapCols}${nhcCols}${echoCols}
<col class="points" />
</colgroup>
<thead>
<tr class="titlerow">
<th>Rank</th>
<th>Sail</th>
${showBoatName ? '<th>Boat</th>\n' : ''}${showBoatClass ? '<th>Class</th>\n' : ''}<th>${primaryTh}</th>${showHelm ? '\n<th>Helm</th>' : ''}${showOwner ? '\n<th>Owner</th>' : ''}${handicapHeaders}${nhcHeaders}${echoHeaders}
<th>Points</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>`;
}

/** Render the four NHC explainability cells for one row. Rating/finish/ET/CT
 *  have been promoted to always-visible columns so non-scratch race tables
 *  always carry that data; this helper only emits the four cells that hide
 *  under the viewer toggle.
 *
 *  Non-finishers leave the three computational cells blank and show
 *  "unchanged" in the New TCF column. The verification contract: a competitor
 *  with a calculator should be able to reproduce New TCF from these published
 *  values via TCF + α × (Fair TCF − TCF). */
function renderNhcCells(r: RaceResultData): string[] {
  const nhc = r.nhc;
  if (!nhc) {
    return [
      `<td class="nhc-detail"></td>`,
      `<td class="nhc-detail"></td>`,
      `<td class="nhc-detail"></td>`,
      `<td class="nhc-detail"></td>`,
    ];
  }
  if (!nhc.isFinisher) {
    return [
      `<td class="nhc-detail"></td>`,
      `<td class="nhc-detail"></td>`,
      `<td class="nhc-detail"></td>`,
      `<td class="mono nhc-detail">unchanged</td>`,
    ];
  }
  return [
    `<td class="mono nhc-detail">${nhc.ctRatio != null ? nhc.ctRatio.toFixed(4) : ''}</td>`,
    `<td class="mono nhc-detail">${nhc.fairTcf != null ? nhc.fairTcf.toFixed(4) : ''}</td>`,
    `<td class="mono nhc-detail">${nhc.adjustment != null ? formatSigned(nhc.adjustment, 4) : ''}</td>`,
    `<td class="mono nhc-detail">${nhc.newTcf.toFixed(3)}</td>`,
  ];
}

/** Render the four ECHO IS-notation explainability cells for one row. The
 *  rating/finish/ET/CT columns (always-visible) carry the static handicap
 *  data; this helper only emits the four cells that hide under the ECHO
 *  viewer toggle.
 *
 *  Non-finishers leave the three computational cells blank and show
 *  "unchanged" in the New H column. The verification contract: a competitor
 *  with a calculator should be able to reproduce New H from these published
 *  values via H + α × (PI − H), with PI verifiable from ΣH_S, T_E, and the
 *  fleet-header Σ(1/T_E). */
function renderEchoCells(r: RaceResultData): string[] {
  const echo = r.echo;
  if (!echo) {
    return [
      `<td class="echo-detail"></td>`,
      `<td class="echo-detail"></td>`,
      `<td class="echo-detail"></td>`,
      `<td class="echo-detail"></td>`,
    ];
  }
  if (!echo.isFinisher) {
    return [
      `<td class="echo-detail"></td>`,
      `<td class="echo-detail"></td>`,
      `<td class="echo-detail"></td>`,
      `<td class="mono echo-detail">unchanged</td>`,
    ];
  }
  return [
    `<td class="mono echo-detail">${echo.reciprocalEt != null ? echo.reciprocalEt.toFixed(5) : ''}</td>`,
    `<td class="mono echo-detail">${echo.pi != null ? echo.pi.toFixed(4) : ''}</td>`,
    `<td class="mono echo-detail">${echo.adjustment != null ? formatSigned(echo.adjustment, 4) : ''}</td>`,
    `<td class="mono echo-detail">${echo.newH.toFixed(3)}</td>`,
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
    text = `RDG(${points})`;
  } else if (resultCode) {
    text = `${points} ${resultCode}`;
  } else if (penaltyCode) {
    text = `${points} ${formatPenaltyLabel(penaltyCode, penaltyOverride)}`;
  } else {
    text = String(points);
  }
  return isDiscard ? `(${text})` : text;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IE', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatIsoDate(iso: string): string {
  // Parse without timezone conversion
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-IE', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Parse "HH:MM:SS" → total seconds */
function parseTimeSecs(hms: string): number {
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/** Format integer seconds as H:MM:SS or M:SS */
function formatDurationSecs(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format corrected time (float seconds) as H:MM:SS.d or M:SS.d */
function formatCorrectedSecs(secs: number): string {
  const h = Math.floor(secs / 3600);
  const rem = secs % 3600;
  const m = Math.floor(rem / 60);
  const s = (rem % 60).toFixed(1);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`;
  return `${m}:${s.padStart(4, '0')}`;
}

/** Escape HTML special characters */
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Assembly helper ----

/**
 * Assemble SeriesResultsData from raw scoring outputs.
 * Call this from the standings page before passing to renderSeriesHtml().
 */
export function assembleSeriesResultsData(
  series: { name: string; venue: string; venueLogoUrl?: string; eventLogoUrl?: string },
  races: Array<{ id: string; raceNumber: number; date: string }>,
  standings: Array<{
    rank: number;
    competitor: { sailNumber: string; boatName?: string; boatClass?: string; name: string; owner?: string; helm?: string; crewName?: string };
    racePoints: number[];
    raceCodes: (ResultCode | null)[];
    racePenaltyCodes?: (PenaltyCode | null)[];
    racePenaltyOverrides?: (number | null)[];
    raceRedressFlags?: boolean[];
    totalPoints: number;
    netPoints: number;
    raceDiscards: boolean[];
  }>,
  raceScoresByRaceId: Map<string, Map<string, { points: number; place: number | null; rank: number | null; resultCode: ResultCode | null; penaltyCode?: PenaltyCode | null; penaltyOverride?: number | null; finishTime?: string | null; tcfApplied?: number | null; newTcf?: number | null; elapsedTime?: number | null; nhc?: { ctRatio: number; fairTcf: number; adjustment: number; alphaApplied: number }; echo?: { ctRatio: number; fairTcf: number; adjustment: number; alphaApplied: number } }>>,
  competitorsById: Map<string, { sailNumber: string; boatName?: string; boatClass?: string; name: string; owner?: string; helm?: string; crewName?: string; ircTcc?: number; pyNumber?: number }>,
  enabledCompetitorFields: CompetitorFieldKey[],
  generatedAt: Date,
  fleetName?: string,
  options?: {
    /** Display label for the primary person slot. Defaults to "Competitor"
     *  in the renderer if omitted here (matching v1 file behaviour). */
    primaryPersonLabel?: PrimaryPersonLabel;
    /** RaceStart records for all races — used to find the gun time for this fleet */
    raceStarts?: Array<{ raceId: string; fleetIds: string[]; startTime: string }>;
    /** ID of the fleet being rendered */
    fleetId?: string;
    /** Scoring system of the fleet */
    scoringSystem?: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo';
    /** When set (NHC fleets only), per-race aggregates that drive the
     *  rating-calculation fleet header line above each race table and the
     *  per-row explainability columns. Pass undefined to suppress the
     *  explainability columns even on NHC fleets (e.g. publishing toggle off). */
    nhcAggregatesByRaceId?: Map<string, NhcHeaderData>;
    /** When set (ECHO fleets only), per-race aggregates that drive the
     *  IS-notation fleet header line and ECHO explainability columns. Pass
     *  undefined to suppress the explainability columns even on ECHO fleets. */
    echoAggregatesByRaceId?: Map<string, EchoHeaderData>;
  },
): SeriesResultsData {
  const { raceStarts, fleetId, scoringSystem, nhcAggregatesByRaceId, echoAggregatesByRaceId, primaryPersonLabel } = options ?? {};
  const isHandicap = scoringSystem === 'irc' || scoringSystem === 'py' || scoringSystem === 'nhc' || scoringSystem === 'echo';
  const isNhcExplain = scoringSystem === 'nhc' && nhcAggregatesByRaceId != null;
  const isEchoExplain = scoringSystem === 'echo' && echoAggregatesByRaceId != null;

  // Build a map of raceId → startTime for this fleet
  const startTimeByRaceId = new Map<string, string>();
  if (isHandicap && raceStarts && fleetId) {
    for (const rs of raceStarts) {
      if (rs.raceId && rs.fleetIds.includes(fleetId)) {
        startTimeByRaceId.set(rs.raceId, rs.startTime);
      }
    }
  }

  const raceDataList: RaceData[] = races.map((race) => {
    const scoresForRace = raceScoresByRaceId.get(race.id) ?? new Map();
    const startTime = startTimeByRaceId.get(race.id);
    const startSecs = startTime ? parseTimeSecs(startTime) : null;
    const results: RaceResultData[] = [];

    for (const [competitorId, score] of scoresForRace) {
      const competitor = competitorsById.get(competitorId);
      if (!competitor) continue;

      let tcc: number | undefined;
      let elapsedTimeSecs: number | undefined;
      let correctedTimeSecs: number | undefined;

      if (isHandicap && startSecs !== null) {
        if (scoringSystem === 'irc' && competitor.ircTcc != null) {
          tcc = competitor.ircTcc;
        } else if (scoringSystem === 'py' && competitor.pyNumber != null && competitor.pyNumber > 0) {
          tcc = 1000 / competitor.pyNumber;
        } else if ((scoringSystem === 'nhc' || scoringSystem === 'echo') && score.tcfApplied != null) {
          tcc = score.tcfApplied;
        }
        if (tcc != null && score.finishTime) {
          const finishSecs = parseTimeSecs(score.finishTime);
          elapsedTimeSecs = finishSecs - startSecs;
          correctedTimeSecs = elapsedTimeSecs * tcc;
        }
      }

      const nhcCell: NhcCellData | undefined = isNhcExplain && score.tcfApplied != null && score.newTcf != null
        ? {
            tcfApplied: score.tcfApplied,
            newTcf: score.newTcf,
            isFinisher: score.nhc != null,
            ...(score.nhc ? { ctRatio: score.nhc.ctRatio, fairTcf: score.nhc.fairTcf, adjustment: score.nhc.adjustment } : {}),
          }
        : undefined;

      const echoCell: EchoCellData | undefined = isEchoExplain && score.tcfApplied != null && score.newTcf != null
        ? {
            startingH: score.tcfApplied,
            newH: score.newTcf,
            isFinisher: score.echo != null,
            ...(score.echo
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
        place: score.place,
        rank: score.rank,
        points: score.points,
        resultCode: score.resultCode,
        penaltyCode: score.penaltyCode ?? null,
        penaltyOverride: score.penaltyOverride ?? null,
        ...(tcc != null ? { tcc } : {}),
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

  const standingRows: StandingRowData[] = standings.map((s) => ({
    rank: s.rank,
    sailNumber: s.competitor.sailNumber,
    ...(s.competitor.boatName ? { boatName: s.competitor.boatName } : {}),
    ...(s.competitor.boatClass ? { boatClass: s.competitor.boatClass } : {}),
    helm: s.competitor.name,
    ...(s.competitor.owner ? { owner: s.competitor.owner } : {}),
    ...(s.competitor.helm ? { helmRole: s.competitor.helm } : {}),
    ...(s.competitor.crewName ? { crewName: s.competitor.crewName } : {}),
    raceScores: s.racePoints.map((points, i) => {
      const resultCode = s.raceCodes[i] ?? null;
      const penaltyCode = s.racePenaltyCodes?.[i] ?? null;
      const penaltyOverride = s.racePenaltyOverrides?.[i] ?? null;
      const isRedress = s.raceRedressFlags?.[i] ?? false;
      const raceNumber = races[i]?.raceNumber ?? i + 1;
      const podium = racePodiums.get(raceNumber);
      const podiumRank = resultCode === null && penaltyCode === null && !isRedress ? (podium?.get(s.competitor.sailNumber) ?? null) : null;
      return {
        points,
        resultCode,
        penaltyCode,
        penaltyOverride,
        isDiscard: s.raceDiscards[i] ?? false,
        isRedress,
        podiumRank,
      };
    }),
    totalPoints: s.totalPoints,
    netPoints: s.netPoints,
  }));

  return {
    series,
    fleetName,
    leftLogoUrl: series.venueLogoUrl || undefined,
    rightLogoUrl: series.eventLogoUrl || undefined,
    generatedAt,
    enabledCompetitorFields,
    ...(primaryPersonLabel ? { primaryPersonLabel } : {}),
    races: raceDataList,
    standings: standingRows,
  };
}
