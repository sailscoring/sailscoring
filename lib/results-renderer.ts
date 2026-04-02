import type { ResultCode } from './types';

// ---- Input types ----

export interface SeriesResultsData {
  series: {
    name: string;
    venue: string;
  };
  leftLogoUrl?: string;
  rightLogoUrl?: string;
  /** If set, renders "Results are provisional as of HH:MM on Month D, YYYY" */
  generatedAt?: Date;
  /** Races in series order */
  races: RaceData[];
  /** Standings sorted by rank ascending */
  standings: StandingRowData[];
}

export interface RaceData {
  raceNumber: number;
  date: string; // ISO date string
  label: string; // column header, e.g. "R1" or "R3 Jul 23"
  anchorId: string; // in-page anchor, e.g. "r1"
  results: RaceResultData[];
}

export interface RaceResultData {
  rank: number;
  sailNumber: string;
  helm: string;
  place: number | null;
  points: number;
  resultCode: ResultCode | null;
}

export interface StandingRowData {
  rank: number;
  sailNumber: string;
  helm: string;
  raceScores: RaceScoreData[];
  totalPoints: number;
  netPoints: number;
}

export interface RaceScoreData {
  points: number;
  resultCode: ResultCode | null;
  isDiscard: boolean;
  podiumRank: 1 | 2 | 3 | null;
}

// ---- Renderer ----

export function renderSeriesHtml(data: SeriesResultsData): string {
  const { series, leftLogoUrl, rightLogoUrl, generatedAt, races, standings } = data;

  const hasDiscards = standings.some((s) => s.netPoints !== s.totalPoints);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta name="description" content="sail scoring results">
<meta name="viewport" content="width=device-width">
<title>Results for ${esc(series.name)}${series.venue ? ' at ' + esc(series.venue) : ''}</title>
<style type="text/css">
body {font: 80% arial, helvetica, sans-serif; text-align: center;}
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
${renderSummaryTable(standings, races, hasDiscards)}
${races.map((race) => renderRaceTable(race)).join('\n')}
<p class="hardleft"></p>
<p class="hardright"></p>
<p>Sail Scoring &mdash; <a href="https://sailscoring.ie">sailscoring.ie</a></p>
</body>
</html>`;
}

// ---- Summary table ----

function renderSummaryTable(
  standings: StandingRowData[],
  races: RaceData[],
  hasDiscards: boolean,
): string {
  const colCount = 3 + races.length + (hasDiscards ? 2 : 1); // rank + sail + helm + races + total [+ nett]

  const cols = [
    '<col class="rank" />',
    '<col class="sailno" />',
    '<col class="helmname" />',
    ...races.map(() => '<col class="race" />'),
    '<col class="total" />',
    ...(hasDiscards ? ['<col class="nett" />'] : []),
  ].join('\n');

  const headerCells = [
    '<th>Rank</th>',
    '<th>Sail</th>',
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
          const text = renderScoreText(score.points, score.resultCode, score.isDiscard);
          return classes ? `<td class="${classes}">${text}</td>` : `<td>${text}</td>`;
        })
        .join('\n');

      return `<tr class="${rowClass} summaryrow">
<td>${ordinal(s.rank)}</td>
<td>${esc(s.sailNumber)}</td>
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
  const rows = race.results
    .map((r, i) => {
      const rowClass = i % 2 === 0 ? 'odd' : 'even';
      const placeText = r.resultCode ?? String(r.place ?? '');
      return `<tr class="${rowClass} racerow">
<td>${r.rank}</td>
<td>${esc(r.sailNumber)}</td>
<td>${esc(r.helm)}</td>
<td>${placeText}</td>
<td>${r.points}</td>
</tr>`;
    })
    .join('\n');

  return `<h3 class="racetitle" id="${esc(race.anchorId)}">${esc(race.label)}&nbsp;&mdash;&nbsp;${dateStr}</h3>
<table class="racetable" cellspacing="0" cellpadding="0" border="0">
<colgroup span="5">
<col class="rank" />
<col class="sailno" />
<col class="helmname" />
<col class="place" />
<col class="points" />
</colgroup>
<thead>
<tr class="titlerow">
<th>Rank</th>
<th>Sail</th>
<th>Helm</th>
<th>Place</th>
<th>Points</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>`;
}

// ---- Helpers ----

function renderScoreText(
  points: number,
  resultCode: ResultCode | null,
  isDiscard: boolean,
): string {
  const text = resultCode ? `${points} ${resultCode}` : String(points);
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
    competitor: { sailNumber: string; name: string };
    racePoints: number[];
    raceCodes: (ResultCode | null)[];
    totalPoints: number;
    netPoints: number;
    raceDiscards: boolean[];
  }>,
  raceScoresByRaceId: Map<string, Map<string, { points: number; place: number | null; resultCode: ResultCode | null }>>,
  competitorsById: Map<string, { sailNumber: string; name: string }>,
  generatedAt: Date,
): SeriesResultsData {
  const raceDataList: RaceData[] = races.map((race) => {
    const scoresForRace = raceScoresByRaceId.get(race.id) ?? new Map();
    const results: RaceResultData[] = [];

    for (const [competitorId, score] of scoresForRace) {
      const competitor = competitorsById.get(competitorId);
      if (!competitor) continue;
      results.push({
        rank: 0, // assigned below after sort
        sailNumber: competitor.sailNumber,
        helm: competitor.name,
        place: score.place,
        points: score.points,
        resultCode: score.resultCode,
      });
    }

    // Sort by points ascending (finishers first, then coded)
    results.sort((a, b) => a.points - b.points || a.sailNumber.localeCompare(b.sailNumber));
    results.forEach((r, i) => { r.rank = i + 1; });

    return {
      raceNumber: race.raceNumber,
      date: race.date,
      label: `R${race.raceNumber}`,
      anchorId: `r${race.raceNumber}`,
      results,
    };
  });

  // Determine per-race podium ranks by looking at who scored 1st/2nd/3rd place
  // within each race's results
  const racePodiums: Map<number, Map<string, 1 | 2 | 3>> = new Map();
  for (const raceData of raceDataList) {
    const podium = new Map<string, 1 | 2 | 3>();
    for (const r of raceData.results) {
      if (r.resultCode === null && r.rank <= 3) {
        podium.set(r.sailNumber, r.rank as 1 | 2 | 3);
      }
    }
    racePodiums.set(raceData.raceNumber, podium);
  }

  const standingRows: StandingRowData[] = standings.map((s) => ({
    rank: s.rank,
    sailNumber: s.competitor.sailNumber,
    helm: s.competitor.name,
    raceScores: s.racePoints.map((points, i) => {
      const resultCode = s.raceCodes[i] ?? null;
      const raceNumber = races[i]?.raceNumber ?? i + 1;
      const podium = racePodiums.get(raceNumber);
      const podiumRank = resultCode === null ? (podium?.get(s.competitor.sailNumber) ?? null) : null;
      return {
        points,
        resultCode,
        isDiscard: s.raceDiscards[i] ?? false,
        podiumRank,
      };
    }),
    totalPoints: s.totalPoints,
    netPoints: s.netPoints,
  }));

  return {
    series,
    leftLogoUrl: series.venueLogoUrl || undefined,
    rightLogoUrl: series.eventLogoUrl || undefined,
    generatedAt,
    races: raceDataList,
    standings: standingRows,
  };
}
