import type { ResultCode, PenaltyCode } from './types';

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
  /** Races in series order */
  races: RaceData[];
  /** Standings sorted by rank ascending */
  standings: StandingRowData[];
  /** Pre-serialised PublicSeriesExport JSON. When present, embeds the data in a
   *  <script type="application/json"> block at the end of <body> for programmatic
   *  consumers. Always set together with openInAppUrl. */
  publicExportJson?: string;
  /** Full import URL, e.g. https://app.sailscoring.ie/?import=<base64url>. When set,
   *  adds an "Open in Sail Scoring" link to the footer. Requires publicExportJson. */
  openInAppUrl?: string;
}

export interface RaceData {
  raceNumber: number;
  date: string; // ISO date string
  label: string; // column header, e.g. "R1" or "R3 Jul 23"
  anchorId: string; // in-page anchor, e.g. "r1"
  startTime?: string; // "HH:MM:SS" gun time for this fleet (handicap fleets only)
  results: RaceResultData[];
}

export interface RaceResultData {
  sailNumber: string;
  boatName?: string;
  helm: string;
  place: number | null;   // raw cross-fleet finish position; null for coded finishes
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
}

export interface StandingRowData {
  rank: number;
  sailNumber: string;
  boatName?: string;
  helm: string;
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
  const { series, fleetName, leftLogoUrl, rightLogoUrl, generatedAt, races, standings, publicExportJson, openInAppUrl } = data;
  const fontPercent = options?.fontPercent ?? 80;

  const hasDiscards = standings.some((s) => s.netPoints !== s.totalPoints);
  const titleSuffix = fleetName ? ` \u2014 ${esc(fleetName)}` : '';

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
</style>
</head>
<body>
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
${renderSummaryTable(standings, races, hasDiscards)}
${races.map((race) => renderRaceTable(race)).join('\n')}
<p class="hardleft"></p>
<p class="hardright"></p>
<p>Sail Scoring &mdash; <a href="https://sailscoring.ie">sailscoring.ie</a>${openInAppUrl ? ` &mdash; <a href="${esc(openInAppUrl)}">Open in Sail Scoring</a>` : ''}</p>
${publicExportJson ? `<script type="application/json" id="sail-scoring-data">
${escJson(publicExportJson)}
</script>` : ''}
</body>
</html>`;
}

// ---- Summary table ----

function renderSummaryTable(
  standings: StandingRowData[],
  races: RaceData[],
  hasDiscards: boolean,
): string {
  const hasBoatNames = standings.some((s) => s.boatName);
  const colCount = (hasBoatNames ? 4 : 3) + races.length + (hasDiscards ? 2 : 1); // rank + sail [+ boat] + helm + races + total [+ nett]

  const cols = [
    '<col class="rank" />',
    '<col class="sailno" />',
    ...(hasBoatNames ? ['<col class="boatname" />'] : []),
    '<col class="helmname" />',
    ...races.map(() => '<col class="race" />'),
    '<col class="total" />',
    ...(hasDiscards ? ['<col class="nett" />'] : []),
  ].join('\n');

  const headerCells = [
    '<th>Rank</th>',
    '<th>Sail</th>',
    ...(hasBoatNames ? ['<th>Boat</th>'] : []),
    '<th>Helm</th>',
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

      return `<tr class="${rowClass} summaryrow">
<td>${ordinal(s.rank)}</td>
<td>${esc(s.sailNumber)}</td>
${hasBoatNames ? `<td>${esc(s.boatName ?? '')}</td>` : ''}
<td>${esc(s.helm)}</td>
${scoreCells}
<td>${s.totalPoints}</td>
${hasDiscards ? `<td>${s.netPoints}</td>` : ''}
</tr>`;
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

function renderRaceTable(race: RaceData): string {
  const dateStr = formatIsoDate(race.date);
  const startStr = race.startTime ? ` &mdash; Start: ${esc(race.startTime)}` : '';
  const hasBoatNames = race.results.some((r) => r.boatName);
  const hasHandicapCols = race.results.some((r) => r.tcc != null);
  // Detect ties in place (cross-fleet) and rank (within-fleet)
  const placeCounts = new Map<number, number>();
  const rankCounts = new Map<number, number>();
  for (const r of race.results) {
    if (r.place !== null) placeCounts.set(r.place, (placeCounts.get(r.place) ?? 0) + 1);
    if (r.rank !== null) rankCounts.set(r.rank, (rankCounts.get(r.rank) ?? 0) + 1);
  }

  const rows = race.results
    .map((r, i) => {
      const rowClass = i % 2 === 0 ? 'odd' : 'even';
      const isPlaceTied = r.place !== null && (placeCounts.get(r.place) ?? 0) > 1;
      const isRankTied = r.rank !== null && (rankCounts.get(r.rank) ?? 0) > 1;
      const placeText = r.resultCode ?? (r.place !== null ? `${r.place}${isPlaceTied ? '=' : ''}` : '');
      const rankText = r.rank !== null ? `${r.rank}${isRankTied ? '=' : ''}` : '';
      const pointsText = r.penaltyCode
        ? `${r.points} ${formatPenaltyLabel(r.penaltyCode, r.penaltyOverride)}`
        : r.resultCode === 'RDG'
          ? `${r.points} RDG`
          : String(r.points);
      const handicapCells = hasHandicapCols
        ? `\n<td class="mono">${r.tcc != null ? r.tcc.toFixed(3) : ''}</td>\n<td class="mono">${esc(r.finishTime ?? '')}</td>\n<td class="mono">${r.elapsedTimeSecs != null ? formatDurationSecs(r.elapsedTimeSecs) : ''}</td>\n<td class="mono">${r.correctedTimeSecs != null ? formatCorrectedSecs(r.correctedTimeSecs) : ''}</td>`
        : '';
      return `<tr class="${rowClass} racerow">
<td>${placeText}</td>
<td>${esc(r.sailNumber)}</td>
${hasBoatNames ? `<td>${esc(r.boatName ?? '')}</td>` : ''}
<td>${esc(r.helm)}</td>
<td>${rankText}</td>
<td>${pointsText}</td>${handicapCells}
</tr>`;
    })
    .join('\n');

  const baseColCount = hasBoatNames ? 6 : 5;
  const colCount = baseColCount + (hasHandicapCols ? 4 : 0);
  const handicapHeaders = hasHandicapCols
    ? '\n<th>TCC</th>\n<th>Finish</th>\n<th>ET</th>\n<th>CT</th>'
    : '';
  const handicapCols = hasHandicapCols
    ? '\n<col class="tcc" />\n<col class="finish" />\n<col class="et" />\n<col class="ct" />'
    : '';

  return `<h3 class="racetitle" id="${esc(race.anchorId)}">${esc(race.label)}&nbsp;&mdash;&nbsp;${dateStr}${startStr}</h3>
<table class="racetable" cellspacing="0" cellpadding="0" border="0">
<colgroup span="${colCount}">
<col class="place" />
<col class="sailno" />
${hasBoatNames ? '<col class="boatname" />\n' : ''}<col class="helmname" />
<col class="rank" />
<col class="points" />${handicapCols}
</colgroup>
<thead>
<tr class="titlerow">
<th>Place</th>
<th>Sail</th>
${hasBoatNames ? '<th>Boat</th>\n' : ''}<th>Helm</th>
<th>Rank</th>
<th>Points</th>${handicapHeaders}
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>`;
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

/** Escape JSON for safe embedding inside a <script> tag.
 *  Only `</` needs escaping to prevent early tag termination; full HTML-escaping
 *  would corrupt the JSON text. */
function escJson(json: string): string {
  return json.replace(/<\//g, '<\\/');
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
    competitor: { sailNumber: string; boatName?: string; name: string };
    racePoints: number[];
    raceCodes: (ResultCode | null)[];
    racePenaltyCodes?: (PenaltyCode | null)[];
    racePenaltyOverrides?: (number | null)[];
    raceRedressFlags?: boolean[];
    totalPoints: number;
    netPoints: number;
    raceDiscards: boolean[];
  }>,
  raceScoresByRaceId: Map<string, Map<string, { points: number; place: number | null; rank: number | null; resultCode: ResultCode | null; penaltyCode?: PenaltyCode | null; penaltyOverride?: number | null; finishTime?: string | null }>>,
  competitorsById: Map<string, { sailNumber: string; boatName?: string; name: string; ircTcc?: number; pyNumber?: number }>,
  generatedAt: Date,
  fleetName?: string,
  options?: {
    /** RaceStart records for all races — used to find the gun time for this fleet */
    raceStarts?: Array<{ raceId: string; fleetIds: string[]; startTime: string }>;
    /** ID of the fleet being rendered */
    fleetId?: string;
    /** Scoring system of the fleet */
    scoringSystem?: 'scratch' | 'irc' | 'py';
  },
): SeriesResultsData {
  const { raceStarts, fleetId, scoringSystem } = options ?? {};
  const isHandicap = scoringSystem === 'irc' || scoringSystem === 'py';

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
        }
        if (tcc != null && score.finishTime) {
          const finishSecs = parseTimeSecs(score.finishTime);
          elapsedTimeSecs = finishSecs - startSecs;
          correctedTimeSecs = elapsedTimeSecs * tcc;
        }
      }

      results.push({
        sailNumber: competitor.sailNumber,
        ...(competitor.boatName ? { boatName: competitor.boatName } : {}),
        helm: competitor.name,
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
      });
    }

    // Finishers first (by cross-fleet place ascending), then coded boats (by sail number).
    results.sort((a, b) => {
      if (a.place !== null && b.place === null) return -1;
      if (a.place === null && b.place !== null) return 1;
      if (a.place !== null && b.place !== null) return a.place - b.place || a.sailNumber.localeCompare(b.sailNumber);
      return a.sailNumber.localeCompare(b.sailNumber);
    });

    return {
      raceNumber: race.raceNumber,
      date: race.date,
      label: `R${race.raceNumber}`,
      anchorId: `r${race.raceNumber}`,
      ...(startTime ? { startTime } : {}),
      results,
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
    helm: s.competitor.name,
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
    races: raceDataList,
    standings: standingRows,
  };
}
