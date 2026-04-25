/**
 * Generate .html preview files for each YAML scoring fixture.
 *
 * Run: pnpm generate:fixtures
 *
 * Each .html file is checked in alongside its .yaml file so that scorers
 * can review test cases in a browser without running any code.
 *
 * All fixtures share a unified schema (see tests/fixtures/scoring/types.ts);
 * this script dispatches on fleet.scoringSystem:
 *   - scratch (or no fleet)        → full series results layout
 *   - irc / py                     → preamble + per-race CT/TCF table + standings
 *   - nhc                          → preamble + per-race progression tables + standings
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  calculateStandings,
  calculateFleetStandings,
  calculateRaceScores,
  calculateHandicapRaceScores,
} from '../lib/scoring';
import { assembleSeriesResultsData, renderSeriesHtml } from '../lib/results-renderer';
import { defaultEnabledCompetitorFields } from '../lib/competitor-fields';
import type { DiscardThreshold, ResultCode, PenaltyCode } from '../lib/types';
import { buildFixtureInputs, type Fixture } from '../tests/fixtures/scoring/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Minimal HTML escaping (matches the one inside results-renderer.ts) */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function discardThresholdsSummary(thresholds: DiscardThreshold[]): string {
  if (thresholds.length === 0) return 'No discards.';
  return thresholds
    .slice()
    .sort((a, b) => a.minRaces - b.minRaces)
    .map((t) => `${t.discardCount} discard${t.discardCount !== 1 ? 's' : ''} from race ${t.minRaces}`)
    .join(', ') + '.';
}

/**
 * Extract all YAML comment lines from the raw source, stripping the leading `#`
 * but preserving indentation so arithmetic blocks stay aligned.
 */
function extractComments(yamlSource: string): string | null {
  const lines = yamlSource.split('\n');
  const commentLines = lines
    .filter((line) => /^\s*#/.test(line))
    .map((line) => line.replace(/^(\s*)#[ ]?/, '$1'));
  const text = commentLines.join('\n').trim();
  return text || null;
}

function buildPreamble(fixture: Fixture, yamlSource: string): string {
  const notesHtml = fixture.rrs_notes
    ? `<p style="margin:0 0 0.5em; font-style:italic; color:#444;">${esc(fixture.rrs_notes.trim())}</p>`
    : '';

  const dnfLabel = fixture.series.dnfScoring === 'startingArea'
    ? 'A5.3 (starting area)'
    : 'A5.2 (series entries)';
  const configHtml = `<p style="margin:0 0 0.5em; color:#333;"><strong>Scoring configuration:</strong> ${esc(discardThresholdsSummary(fixture.series.discardThresholds))} DNF/OCS scoring: ${esc(dnfLabel)}.</p>`;

  const comments = extractComments(yamlSource);
  const commentsHtml = comments
    ? `<pre style="margin:0.6em 0 0; padding:0.5em; background:#fff; border:1px solid #ddd; font-size:0.95em; line-height:1.4; white-space:pre-wrap; overflow-x:auto;">${esc(comments)}</pre>`
    : '';

  return `<div style="max-width:900px; margin:1em auto; padding:0.8em 1.2em; background:#f5f5f0; border:1px solid #ccc; text-align:left; font-family:arial,helvetica,sans-serif; font-size:80%; line-height:1.5;">
${notesHtml}${configHtml}${commentsHtml}
</div>`;
}

// ─── Scratch / fleets / codes renderer (full series results layout) ─────────

function generateScratchFixtureHtml(fixture: Fixture, yamlSource: string): string {
  const { competitors, fleets, races, finishes, discardThresholds, dnfScoring } = buildFixtureInputs(fixture);
  const isMultiFleet = fleets.length > 1;

  const competitorsById = new Map(competitors.map((c) => [c.id, c]));
  const preamble = buildPreamble(fixture, yamlSource);

  if (isMultiFleet) {
    const { fleetStandings: fleetResults } = calculateFleetStandings(fleets, competitors, races, finishes, discardThresholds, dnfScoring);
    const sections: string[] = [];

    for (const { fleet, standings } of fleetResults) {
      const fleetCompetitorIds = new Set(
        competitors.filter((c) => c.fleetIds.includes(fleet.id)).map((c) => c.id),
      );
      const raceScoresByRaceId = new Map<
        string,
        Map<string, { points: number; place: number | null; rank: number | null; resultCode: ResultCode | null; penaltyCode: PenaltyCode | null; penaltyOverride: number | null }>
      >();
      for (const race of races) {
        const raceFinishes = finishes.filter(
          (f) => f.raceId === race.id && f.competitorId !== null && fleetCompetitorIds.has(f.competitorId),
        );
        const finishByCompetitorId = new Map(raceFinishes.filter((f) => f.competitorId !== null).map((f) => [f.competitorId!, f]));
        const scores = calculateRaceScores(raceFinishes, competitors.filter((c) => fleetCompetitorIds.has(c.id)), dnfScoring);
        raceScoresByRaceId.set(race.id, new Map([...scores.entries()].map(([id, s]) => [
          id,
          { points: s.points, place: s.place, rank: s.rank, resultCode: s.resultCode, penaltyCode: finishByCompetitorId.get(id)?.penaltyCode ?? null, penaltyOverride: finishByCompetitorId.get(id)?.penaltyOverride ?? null },
        ])));
      }

      const data = assembleSeriesResultsData(
        { name: fixture.description, venue: '' },
        races,
        standings,
        raceScoresByRaceId,
        competitorsById,
        defaultEnabledCompetitorFields(),
        new Date(),
        fleet.name,
      );
      delete data.generatedAt;
      sections.push(renderSeriesHtml(data, { fontPercent: 100 }));
    }

    const first = sections[0];
    const preambleInjected = first.replace(
      '<div style="clear:both;"></div>',
      `<div style="clear:both;"></div>\n${preamble}`,
    );

    function extractFleetContent(html: string): string {
      const m = html.match(/<h2>[\s\S]*?(?=<p class="hardleft">)/);
      return m ? m[0] : '';
    }

    const h2Idx = preambleInjected.indexOf('<h2>');
    const footerIdx = preambleInjected.indexOf('<p class="hardleft">');
    const shell = h2Idx >= 0 ? preambleInjected.slice(0, h2Idx) : preambleInjected;
    const footer = footerIdx >= 0 ? preambleInjected.slice(footerIdx) : '</body>\n</html>';

    return shell + sections.map(extractFleetContent).join('\n') + '\n' + footer;
  }

  const { standings } = calculateStandings(competitors, races, finishes, discardThresholds, dnfScoring);

  const raceScoresByRaceId = new Map<
    string,
    Map<string, { points: number; place: number | null; rank: number | null; resultCode: ResultCode | null; penaltyCode: PenaltyCode | null; penaltyOverride: number | null }>
  >();
  for (const race of races) {
    const raceFinishes = finishes.filter((f) => f.raceId === race.id);
    const finishByCompetitorId = new Map(raceFinishes.filter((f) => f.competitorId !== null).map((f) => [f.competitorId!, f]));
    const scores = calculateRaceScores(raceFinishes, competitors, dnfScoring);
    raceScoresByRaceId.set(race.id, new Map([...scores.entries()].map(([id, s]) => [
      id,
      { points: s.points, place: s.place, rank: s.rank, resultCode: s.resultCode, penaltyCode: finishByCompetitorId.get(id)?.penaltyCode ?? null, penaltyOverride: finishByCompetitorId.get(id)?.penaltyOverride ?? null },
    ])));
  }

  const data = assembleSeriesResultsData(
    { name: fixture.description, venue: '' },
    races,
    standings,
    raceScoresByRaceId,
    competitorsById,
    defaultEnabledCompetitorFields(),
    new Date(),
  );
  delete data.generatedAt;

  const html = renderSeriesHtml(data, { fontPercent: 100 });
  return html.replace(
    '<div style="clear:both;"></div>',
    `<div style="clear:both;"></div>\n${preamble}`,
  );
}

// ─── Handicap renderer shared helpers ────────────────────────────────────────

function fmtSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec.toString().padStart(2, '0')}s`;
}

function fmtTcf(tcf: number | null | undefined, sys: 'irc' | 'py' | 'nhc'): string {
  if (tcf === null || tcf === undefined) return '—';
  const suffix = sys === 'py' ? ' (1000/PY)' : '';
  return `${tcf.toFixed(4)}${suffix}`;
}

function fmtPoints(p: number): string {
  return p % 1 === 0 ? p.toString() : p.toFixed(1);
}

function renderStandingsTable(fixture: Fixture): string {
  const rows = fixture.expected.standings.map((s) => {
    const competitor = fixture.competitors.find((c) => c.sailNumber === s.sailor);
    const name = competitor?.name ?? s.sailor;
    const racePointsCells = s.racePoints.map((p, i) => {
      const code = s.raceCodes[i];
      const discard = s.raceDiscards[i];
      const inner = code ? `${code}` : fmtPoints(p);
      return `<td class="mono"${discard ? ' style="text-decoration:line-through;color:#888;"' : ''}>${esc(inner)}</td>`;
    }).join('');
    return `<tr>
  <td>${s.rank}</td>
  <td>${esc(name)}</td>
  <td class="mono">${esc(s.sailor)}</td>
  ${racePointsCells}
  <td class="mono">${esc(fmtPoints(s.totalPoints))}</td>
  <td class="mono">${esc(fmtPoints(s.netPoints))}</td>
</tr>`;
  }).join('\n');

  const raceCount = fixture.races.length;
  const raceHeaders = Array.from({ length: raceCount }, (_, i) => {
    const r = fixture.races[i];
    return `<th>R${r.number ?? i + 1}</th>`;
  }).join('');

  return `<h2 style="margin-top:1.5em;">Series standings</h2>
<table>
<thead>
<tr><th>Rank</th><th>Name</th><th>Sail #</th>${raceHeaders}<th>Total</th><th>Net</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>`;
}

// ─── IRC / PY renderer ───────────────────────────────────────────────────────

function generateHandicapFixtureHtml(fixture: Fixture, yamlSource: string): string {
  if (!fixture.fleet || (fixture.fleet.scoringSystem !== 'irc' && fixture.fleet.scoringSystem !== 'py')) {
    throw new Error(`Expected handicap fleet, got ${fixture.fleet?.scoringSystem}`);
  }
  const sys = fixture.fleet.scoringSystem;
  const sysUpper = sys.toUpperCase();
  const { competitors, races, finishes, raceStarts } = buildFixtureInputs(fixture);
  const competitorByIdMap = new Map(competitors.map((c) => [c.id, c]));

  const raceSections = fixture.races.map((fixtureRace, ri) => {
    const raceId = races[ri].id;
    const raceStart = raceStarts.find((rs) => rs.raceId === raceId);
    if (!raceStart) return '';
    const raceFinishes = finishes.filter((f) => f.raceId === raceId);
    const tcfMap = new Map<string, number>();
    for (const c of competitors) {
      if (sys === 'irc' && c.ircTcc != null) tcfMap.set(c.id, c.ircTcc);
      else if (sys === 'py' && c.pyNumber != null) tcfMap.set(c.id, 1000 / c.pyNumber);
    }
    const ratedCompetitors = competitors.filter((c) => tcfMap.has(c.id));
    const { scores } = calculateHandicapRaceScores(raceFinishes, ratedCompetitors, raceStart, tcfMap);

    const finishTimeByCompetitorId = new Map(
      raceFinishes.filter((f) => f.competitorId && f.finishTime).map((f) => [f.competitorId!, f.finishTime!]),
    );

    const sortedScores = [...scores.entries()].sort((a, b) => {
      const ra = a[1].rank ?? Infinity;
      const rb = b[1].rank ?? Infinity;
      if (ra !== rb) return ra - rb;
      return a[0].localeCompare(b[0]);
    });

    const rows = sortedScores.map(([cId, score]) => {
      const c = competitorByIdMap.get(cId)!;
      const ratingDisplay = sys === 'irc'
        ? (c.ircTcc?.toFixed(3) ?? '—')
        : (c.pyNumber?.toString() ?? '—');
      const finishTimeDisplay = finishTimeByCompetitorId.get(cId) ?? (score.resultCode ?? '—');
      const rankDisplay = score.rank !== null ? score.rank.toString() : '—';
      return `<tr>
  <td>${esc(rankDisplay)}</td>
  <td>${esc(c.name)}</td>
  <td class="mono">${esc(c.sailNumber)}</td>
  <td class="mono">${esc(ratingDisplay)}</td>
  <td class="mono">${esc(finishTimeDisplay)}</td>
  <td class="mono">${esc(fmtSeconds(score.elapsedTime))}</td>
  <td class="mono">${esc(fmtTcf(score.tcfApplied, sys))}</td>
  <td class="mono">${esc(fmtSeconds(score.correctedTime))}</td>
  <td>${esc(fmtPoints(score.points))}</td>
</tr>`;
    }).join('\n');

    const ratingHeader = sys === 'irc' ? 'TCC' : 'PY';
    const raceLabel = fixture.races.length > 1 ? `Race ${fixtureRace.number ?? ri + 1}` : 'Race arithmetic';

    return `<h2 style="margin-top:1.5em;">${esc(raceLabel)}</h2>
<div style="margin:0.4em 0 0.6em; color:#444; font-size:90%;">
  <strong>Gun time:</strong> ${esc(fixtureRace.startTime ?? '')}
</div>
<table>
<thead>
<tr><th>Rank</th><th>Name</th><th>Sail #</th><th>${esc(ratingHeader)}</th><th>Finish time</th><th>ET</th><th>TCF</th><th>CT</th><th>Points</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>`;
  }).join('\n');

  const notesHtml = fixture.rrs_notes
    ? `<p style="font-style:italic; color:#444;">${esc(fixture.rrs_notes)}</p>`
    : '';

  const comments = extractComments(yamlSource);
  const commentsHtml = comments
    ? `<pre style="margin:0.6em 0 0; padding:0.5em; background:#fff; border:1px solid #ddd; font-size:0.95em; line-height:1.4; white-space:pre-wrap;">${esc(comments)}</pre>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width">
<title>${esc(fixture.description)} — Sail Scoring</title>
<style>
body { font: 100% arial, helvetica, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #222; }
h1 { font-size: 1.4em; }
h2 { font-size: 1.1em; margin-top: 1.5em; border-bottom: 1px solid #ccc; padding-bottom: 0.2em; }
table { border-collapse: collapse; width: 100%; margin-top: 0.5em; }
td, th { text-align: left; padding: 6px 8px; border: 1px solid #ddd; }
th { background: #f5f5f0; font-weight: bold; }
tr:nth-child(even) { background: #fafafa; }
.mono { font-family: monospace; }
footer { margin-top: 3em; font-size: 0.9em; color: #999; border-top: 1px solid #eee; padding-top: 1em; }
</style>
</head>
<body>
<p><a href="../">&larr; All ${esc(sysUpper)} handicap examples</a></p>
<h1>${esc(fixture.description)}</h1>
${notesHtml}
<div style="margin:0.8em 0; padding:0.6em 1em; background:#f5f5f0; border:1px solid #ccc; font-size:90%;">
  <strong>Scoring system:</strong> ${esc(sysUpper)}
</div>
${commentsHtml}
${raceSections}
${renderStandingsTable(fixture)}
<footer><a href="https://sailscoring.ie">sailscoring.ie</a></footer>
</body>
</html>
`;
}

// ─── NHC renderer ────────────────────────────────────────────────────────────

function generateNhcFixtureHtml(fixture: Fixture, yamlSource: string): string {
  if (!fixture.fleet || fixture.fleet.scoringSystem !== 'nhc') {
    throw new Error(`Expected NHC fleet, got ${fixture.fleet?.scoringSystem}`);
  }
  const { competitors, fleets, races, finishes, raceStarts, discardThresholds, dnfScoring } = buildFixtureInputs(fixture);

  const { fleetStandings } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    finishes,
    discardThresholds,
    dnfScoring,
    raceStarts,
  );
  const fleetResult = fleetStandings[0];
  const nhcRaceScoresByRaceId = fleetResult.nhcRaceScoresByRaceId!;
  const nhcAggregatesByRaceId = fleetResult.nhcAggregatesByRaceId!;

  const competitorByIdMap = new Map(competitors.map((c) => [c.id, c]));

  const raceSections = fixture.races.map((fixtureRace, ri) => {
    const raceId = races[ri].id;
    const scores = nhcRaceScoresByRaceId.get(raceId);
    const aggs = nhcAggregatesByRaceId.get(raceId);
    if (!scores || !aggs) return '';

    const raceFinishes = finishes.filter((f) => f.raceId === raceId);
    const finishTimeByCompetitorId = new Map(
      raceFinishes.filter((f) => f.competitorId && f.finishTime).map((f) => [f.competitorId!, f.finishTime!]),
    );

    const sortedScores = [...scores.entries()].sort((a, b) => {
      const ra = a[1].rank ?? Infinity;
      const rb = b[1].rank ?? Infinity;
      if (ra !== rb) return ra - rb;
      return a[0].localeCompare(b[0]);
    });

    const rows = sortedScores.map(([cId, score]) => {
      const c = competitorByIdMap.get(cId)!;
      const finishTimeDisplay = finishTimeByCompetitorId.get(cId) ?? (score.resultCode ?? '—');
      const rankDisplay = score.rank !== null ? score.rank.toString() : '—';
      const ctRatio = score.nhc?.ctRatio;
      const fairTcf = score.nhc?.fairTcf;
      const adjustment = score.nhc?.adjustment;
      return `<tr>
  <td>${esc(rankDisplay)}</td>
  <td>${esc(c.name)}</td>
  <td class="mono">${esc(c.sailNumber)}</td>
  <td class="mono">${esc(finishTimeDisplay)}</td>
  <td class="mono">${esc(fmtSeconds(score.elapsedTime))}</td>
  <td class="mono">${esc(fmtTcf(score.tcfApplied, 'nhc'))}</td>
  <td class="mono">${esc(fmtSeconds(score.correctedTime))}</td>
  <td class="mono">${ctRatio !== undefined ? esc(ctRatio.toFixed(4)) : '—'}</td>
  <td class="mono">${fairTcf !== undefined ? esc(fairTcf.toFixed(4)) : '—'}</td>
  <td class="mono">${adjustment !== undefined ? esc((adjustment >= 0 ? '+' : '') + adjustment.toFixed(4)) : '—'}</td>
  <td class="mono">${esc(fmtTcf(score.newTcf, 'nhc'))}</td>
  <td>${esc(fmtPoints(score.points))}</td>
</tr>`;
    }).join('\n');

    const raceLabel = `Race ${fixtureRace.number ?? ri + 1}`;

    return `<h2 style="margin-top:1.5em;">${esc(raceLabel)}</h2>
<div style="margin:0.4em 0 0.6em; color:#444; font-size:90%;">
  <strong>Gun time:</strong> ${esc(fixtureRace.startTime ?? '')} &nbsp;
  <strong>α:</strong> ${aggs.alpha.toFixed(2)} &nbsp;
  <strong>Finishers:</strong> ${aggs.finisherCount} &nbsp;
  <strong>CT<sub>avg</sub>:</strong> ${fmtSeconds(aggs.ctAvg)} &nbsp;
  <strong>mean(TCF):</strong> ${aggs.meanTcf.toFixed(4)}
</div>
<table>
<thead>
<tr>
  <th>Rank</th><th>Name</th><th>Sail #</th>
  <th>Finish time</th><th>ET</th><th>TCF<sub>applied</sub></th><th>CT</th>
  <th>CT<sub>avg</sub>/CT</th><th>fair TCF</th><th>adj</th><th>new TCF</th>
  <th>Points</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>`;
  }).join('\n');

  const notesHtml = fixture.rrs_notes
    ? `<p style="font-style:italic; color:#444;">${esc(fixture.rrs_notes)}</p>`
    : '';

  const comments = extractComments(yamlSource);
  const commentsHtml = comments
    ? `<pre style="margin:0.6em 0 0; padding:0.5em; background:#fff; border:1px solid #ddd; font-size:0.95em; line-height:1.4; white-space:pre-wrap; overflow-x:auto;">${esc(comments)}</pre>`
    : '';

  const notesPara = fixture.notes
    ? `<pre style="margin:0.6em 0; padding:0.5em; background:#fff; border:1px solid #ddd; font-size:0.95em; line-height:1.4; white-space:pre-wrap;">${esc(fixture.notes.trim())}</pre>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width">
<title>${esc(fixture.description)} — Sail Scoring</title>
<style>
body { font: 100% arial, helvetica, sans-serif; max-width: 1000px; margin: 40px auto; padding: 0 20px; color: #222; }
h1 { font-size: 1.4em; }
h2 { font-size: 1.1em; margin-top: 1.5em; border-bottom: 1px solid #ccc; padding-bottom: 0.2em; }
table { border-collapse: collapse; width: 100%; margin-top: 0.5em; font-size: 0.9em; }
td, th { text-align: left; padding: 5px 7px; border: 1px solid #ddd; }
th { background: #f5f5f0; font-weight: bold; }
tr:nth-child(even) { background: #fafafa; }
.mono { font-family: monospace; }
footer { margin-top: 3em; font-size: 0.9em; color: #999; border-top: 1px solid #eee; padding-top: 1em; }
</style>
</head>
<body>
<p><a href="../">&larr; All NHC examples</a></p>
<h1>${esc(fixture.description)}</h1>
${notesHtml}
<div style="margin:0.8em 0; padding:0.6em 1em; background:#f5f5f0; border:1px solid #ccc; font-size:90%;">
  <strong>Scoring system:</strong> NHC1 &nbsp;&nbsp;
  <strong>α (blend factor):</strong> ${fixture.fleet.alpha?.toFixed(2) ?? '—'}
</div>
${notesPara}
${commentsHtml}
${raceSections}
${renderStandingsTable(fixture)}
<footer><a href="https://sailscoring.ie">sailscoring.ie</a></footer>
</body>
</html>
`;
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

function generateFixtureHtml(fixture: Fixture, yamlSource: string): string {
  const sys = fixture.fleet?.scoringSystem ?? 'scratch';
  if (sys === 'nhc') return generateNhcFixtureHtml(fixture, yamlSource);
  if (sys === 'irc' || sys === 'py') return generateHandicapFixtureHtml(fixture, yamlSource);
  return generateScratchFixtureHtml(fixture, yamlSource);
}

// ─── Index generation ────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { title: string; intro: string }> = {
  scratch: {
    title: 'Scratch racing',
    intro: "Position-based scoring with no handicap. Each boat's score in a race equals\n  its finishing position. Series score is the sum of race scores; lowest wins.",
  },
  fleets: {
    title: 'Fleets',
    intro: 'Multi-fleet series where competitors are grouped into fleets and scored\n  independently. The penalty point base N is the fleet size, not the total\n  series entries — a DNC in a fleet of 3 scores 4, not the series total plus one.',
  },
  codes: {
    title: 'Result codes',
    intro: 'Scoring behaviour for result codes: position-replacing codes (DNS, DNF, DSQ,\n  OCS, UFD, BFD, RET, NSC, DNC, DNE) and non-discardable penalties. Point\n  values and discard eligibility are governed by RRS Appendix A5 and Rule 30.',
  },
  'tcc-handicap': {
    title: 'TCC handicap scoring (IRC / PY)',
    intro: 'Time-on-time corrected scoring using a Time Correction Factor (TCF).\n  IRC boats use TCC directly; PY boats derive TCF = 1000 ÷ PY number.\n  Boats rank by lowest corrected time (CT = ET × TCF); penalty codes are unchanged.',
  },
  nhc: {
    title: 'NHC progressive handicap',
    intro: 'Progressive handicap (NHC1): each boat’s TCF is updated after every race\n  based on its finish, so fast boats acquire higher TCFs and slow boats lower\n  ones. Race N+1 uses race N’s updated TCF. The blend factor α controls how\n  quickly the TCF responds to each race’s result.',
  },
};

const BASE_CSS = `body { font: 100% arial, helvetica, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #222; }
h1 { font-size: 1.6em; margin-bottom: 0.2em; }
p { line-height: 1.6; color: #444; }
h2 { font-size: 1.1em; margin: 2em 0 0.4em; border-bottom: 1px solid #ccc; padding-bottom: 0.2em; }
ul { margin: 0; padding: 0 0 0 1.2em; }
li { margin: 0.4em 0; }
a { color: #336; }
footer { margin-top: 3em; font-size: 0.9em; color: #999; border-top: 1px solid #eee; padding-top: 1em; }`;

const TABLE_CSS = `table { border-collapse: collapse; width: 100%; margin-top: 0.5em; }
td, th { text-align: left; padding: 6px 8px; border: 1px solid #ddd; vertical-align: top; }
th { background: #f5f5f0; font-weight: bold; }
tr:nth-child(even) { background: #fafafa; }`;

function generateCategoryIndex(
  categoryDir: string,
  fixtures: Array<{ yamlPath: string; description: string }>,
): string {
  const dirName = basename(categoryDir);
  const meta = CATEGORY_META[dirName] ?? { title: dirName, intro: '' };

  const rows = fixtures
    .map((f, i) => {
      const htmlFile = basename(f.yamlPath).replace(/\.yaml$/, '.html');
      return `<tr>\n  <td>${i + 1}</td>\n  <td><a href="${htmlFile}">${esc(f.description)}</a></td>\n</tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width">
<title>${esc(meta.title)} — Sail Scoring Worked Examples</title>
<style>
${BASE_CSS}
${TABLE_CSS}
</style>
</head>
<body>
<p><a href="../">&larr; All examples</a></p>
<h1>${esc(meta.title)}</h1>
<p>
  ${meta.intro}
</p>

<h2>Examples</h2>
<table>
<thead>
<tr><th>#</th><th>Scenario</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>

<footer>
  <a href="https://sailscoring.ie">sailscoring.ie</a>
</footer>
</body>
</html>
`;
}

function generateRootIndex(categories: Array<{ dirName: string; title: string }>): string {
  const sections = categories
    .map(
      ({ dirName, title }) =>
        `<h2>${esc(title)}</h2>\n<ul>\n  <li><a href="${dirName}/">Browse all ${esc(title.toLowerCase())} examples</a></li>\n</ul>`,
    )
    .join('\n\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width">
<title>Sail Scoring — Worked Examples</title>
<style>
${BASE_CSS}
</style>
</head>
<body>
<h1>Sail Scoring — Worked Examples</h1>
<p>
  Each example specifies a complete scoring scenario — fleet, races, finishes, and
  expected standings — and shows the arithmetic. They exist so that experienced
  scorers can verify that the scoring engine produces results consistent with
  the Racing Rules of Sailing.
</p>

${sections}

<footer>
  <a href="https://sailscoring.ie">sailscoring.ie</a>
</footer>
</body>
</html>
`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const fixtureDir = join(__dirname, '../tests/fixtures/scoring');
const yamlFiles = readdirSync(fixtureDir, { recursive: true, encoding: 'utf-8' })
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => join(fixtureDir, f))
  .sort();

const byCategory = new Map<string, Array<{ yamlPath: string; description: string }>>();
let htmCount = 0;

for (const yamlPath of yamlFiles) {
  const yamlSource = readFileSync(yamlPath, 'utf-8');
  const fixture = parseYaml(yamlSource) as Fixture;
  const html = generateFixtureHtml(fixture, yamlSource);
  const outPath = yamlPath.replace(/\.yaml$/, '.html');
  writeFileSync(outPath, html, 'utf-8');
  console.log(`  ${basename(outPath)}`);
  htmCount++;

  const categoryDir = dirname(yamlPath);
  if (!byCategory.has(categoryDir)) byCategory.set(categoryDir, []);
  byCategory.get(categoryDir)!.push({ yamlPath, description: fixture.description });
}

const categories: Array<{ dirName: string; title: string }> = [];
for (const [categoryDir, fixtures] of [...byCategory.entries()].sort()) {
  const dirName = basename(categoryDir);
  const indexHtml = generateCategoryIndex(categoryDir, fixtures);
  writeFileSync(join(categoryDir, 'index.html'), indexHtml, 'utf-8');
  console.log(`  ${dirName}/index.html`);
  categories.push({ dirName, title: (CATEGORY_META[dirName] ?? { title: dirName }).title });
}

const rootIndexHtml = generateRootIndex(categories);
writeFileSync(join(fixtureDir, 'index.html'), rootIndexHtml, 'utf-8');
console.log(`  index.html`);

const indexCount = categories.length + 1;
console.log(`\nGenerated ${htmCount} fixture preview${htmCount !== 1 ? 's' : ''} and ${indexCount} index file${indexCount !== 1 ? 's' : ''}.`);
