/**
 * Generate .html preview files for each YAML scoring fixture.
 *
 * Run: pnpm generate:fixtures
 *
 * Each .html file is checked in alongside its .yaml file so that scorers
 * can review test cases in a browser without running any code.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { calculateStandings, calculateFleetStandings, calculateRaceScores, calculateHandicapRaceScores } from '../lib/scoring';
import { assembleSeriesResultsData, renderSeriesHtml } from '../lib/results-renderer';
import { defaultEnabledCompetitorFields } from '../lib/competitor-fields';
import type { Competitor, Fleet, Race, Finish, DiscardThreshold, ResultCode, PenaltyCode, RaceStart } from '../lib/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Fixture schema (mirrors tests/scoring-fixtures.test.ts) ─────────────────

interface FixtureFinish {
  sailor: string;
  position?: number;
  code?: ResultCode;
  startPresent?: boolean;
  penaltyCode?: PenaltyCode;
  penaltyOverride?: number;
  redressMethod?: 'all_races' | 'races_before' | 'stated';
  redressExcludeRaces?: number[];
  redressIncludeRaces?: number[];
  redressIncludeAllLater?: boolean;
  redressPoints?: number;
}

interface FixtureRace {
  number: number;
  finishes: FixtureFinish[];
}

interface ScoringFixture {
  description: string;
  rrs_notes?: string;
  series: {
    discardThresholds: DiscardThreshold[];
    dnfScoring?: 'seriesEntries' | 'startingArea';
  };
  competitors: Array<{ sailNumber: string; name: string; fleet?: string }>;
  races: FixtureRace[];
}

// ─── Build lib inputs from fixture ───────────────────────────────────────────

function buildInputs(fixture: ScoringFixture) {
  const fleetNames = [...new Set(fixture.competitors.map((c) => c.fleet ?? 'Default'))];
  const fleets: Fleet[] = fleetNames.map((name, i) => ({
    id: `fl-${i}`,
    seriesId: 's1',
    name,
    displayOrder: i,
    scoringSystem: 'scratch' as const,
  }));
  const fleetIdByName = new Map(fleets.map((f) => [f.name, f.id]));

  const competitors: Competitor[] = fixture.competitors.map((c, i) => ({
    id: `c-${i}`,
    seriesId: 's1',
    fleetIds: [fleetIdByName.get(c.fleet ?? 'Default') ?? 'fl-0'],
    sailNumber: c.sailNumber,
    name: c.name,
    club: '',
    gender: '',
    age: null,
    createdAt: 0,
  }));

  const sailNumberToId = new Map(competitors.map((c) => [c.sailNumber, c.id]));

  const races: Race[] = fixture.races.map((r, i) => ({
    id: `r-${i}`,
    seriesId: 's1',
    raceNumber: r.number,
    date: '2025-01-01',
    createdAt: 0,
  }));

  const finishes: Finish[] = [];
  for (let ri = 0; ri < fixture.races.length; ri++) {
    for (const f of fixture.races[ri].finishes) {
      const competitorId = sailNumberToId.get(f.sailor)!;
      finishes.push({
        id: `f-${ri}-${f.sailor}`,
        raceId: races[ri].id,
        competitorId,
        sortOrder: f.position ?? null,
        resultCode: f.code ?? null,
        startPresent: f.startPresent ?? null,
        penaltyCode: f.penaltyCode ?? null,
        penaltyOverride: f.penaltyOverride ?? null,
        redressMethod: f.redressMethod ?? null,
        redressExcludeRaces: f.redressExcludeRaces ?? null,
        redressIncludeRaces: f.redressIncludeRaces ?? null,
        redressIncludeAllLater: f.redressIncludeAllLater ?? false,
        redressPoints: f.redressPoints ?? null,
      });
    }
  }

  return { competitors, fleets, races, finishes, discardThresholds: fixture.series.discardThresholds, dnfScoring: fixture.series.dnfScoring ?? 'seriesEntries' };
}

// ─── Preamble HTML ────────────────────────────────────────────────────────────

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
 * but preserving indentation so arithmetic blocks stay aligned and indented
 * race-level notes retain their visual relationship to the race block.
 * Returns null if no comments are found.
 */
function extractComments(yamlSource: string): string | null {
  const lines = yamlSource.split('\n');
  const commentLines = lines
    .filter((line) => /^\s*#/.test(line))
    .map((line) => line.replace(/^(\s*)#[ ]?/, '$1'));  // strip # and one optional space, keep indent
  const text = commentLines.join('\n').trim();
  return text || null;
}

function buildPreamble(fixture: ScoringFixture, yamlSource: string): string {
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

/** Minimal HTML escaping (matches the one inside results-renderer.ts) */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Generate HTML for one fixture ───────────────────────────────────────────

function generateFixtureHtml(fixture: ScoringFixture, yamlSource: string): string {
  const { competitors, fleets, races, finishes, discardThresholds, dnfScoring } = buildInputs(fixture);
  const isMultiFleet = fleets.length > 1;

  const competitorsById = new Map(competitors.map((c) => [c.id, c]));
  const preamble = buildPreamble(fixture, yamlSource);

  let bodyHtml: string;

  if (isMultiFleet) {
    // Render one standings section per fleet
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

    // Split into shell (doctype through preamble), fleet contents, and footer.
    // Each section from renderSeriesHtml contains a repeated <h1> header and footer;
    // we want exactly one of each, with only the per-fleet <h2>+tables repeated.
    function extractFleetContent(html: string): string {
      const m = html.match(/<h2>[\s\S]*?(?=<p class="hardleft">)/);
      return m ? m[0] : '';
    }

    const h2Idx = preambleInjected.indexOf('<h2>');
    const footerIdx = preambleInjected.indexOf('<p class="hardleft">');
    const shell = h2Idx >= 0 ? preambleInjected.slice(0, h2Idx) : preambleInjected;
    const footer = footerIdx >= 0 ? preambleInjected.slice(footerIdx) : '</body>\n</html>';

    bodyHtml = shell + sections.map(extractFleetContent).join('\n') + '\n' + footer;
  } else {
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
    bodyHtml = html.replace(
      '<div style="clear:both;"></div>',
      `<div style="clear:both;"></div>\n${preamble}`,
    );
  }

  return bodyHtml;
}

// ─── Handicap fixture types and renderer ─────────────────────────────────────

interface HandicapFixtureCompetitor {
  sailNumber: string;
  name: string;
  ircTcc?: number;
  pyNumber?: number;
}

interface HandicapFixtureFinish {
  sailor: string;
  finishTime?: string;
  code?: string;
}

interface HandicapFixtureExpected {
  sailor: string;
  rank: number | null;
  points: number;
  elapsedTime: number | null;
  correctedTime: number | null;
  tcfApplied: number | null;
}

interface HandicapFixture {
  fleet: { scoringSystem: 'irc' | 'py' };
  description: string;
  rrs_notes?: string;
  startTime: string;
  competitors: HandicapFixtureCompetitor[];
  finishes: HandicapFixtureFinish[];
  expected: HandicapFixtureExpected[];
}

function isHandicapFixture(data: unknown): data is HandicapFixture {
  return typeof data === 'object' && data !== null && 'fleet' in data;
}

function fmtSeconds(s: number | null): string {
  if (s === null) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec.toString().padStart(2, '0')}s`;
}

function fmtTcf(tcf: number | null, sys: 'irc' | 'py'): string {
  if (tcf === null) return '—';
  return `${tcf.toFixed(4)}${sys === 'py' ? ' (1000/PY)' : ''}`;
}

function generateHandicapFixtureHtml(fixture: HandicapFixture, yamlSource: string): string {
  const sys = fixture.fleet.scoringSystem.toUpperCase();
  const fleet: Fleet = {
    id: 'fl-0', seriesId: 's1', name: 'Fleet', displayOrder: 0,
    scoringSystem: fixture.fleet.scoringSystem,
  };
  const sailToId = new Map(fixture.competitors.map((c, i) => [c.sailNumber, `c-${i}`]));
  const competitors: Competitor[] = fixture.competitors.map((c, i) => ({
    id: `c-${i}`, seriesId: 's1', fleetIds: ['fl-0'],
    sailNumber: c.sailNumber, name: c.name, club: '', gender: '', age: null, createdAt: 0,
    ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
    ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
  }));
  const raceStart: RaceStart = { id: 'rs-0', raceId: 'r-0', fleetIds: ['fl-0'], startTime: fixture.startTime };
  const finishes: Finish[] = fixture.finishes.map((f, i) => ({
    id: `fin-${i}`, raceId: 'r-0', competitorId: sailToId.get(f.sailor) ?? null,
    sortOrder: null, ...(f.finishTime ? { finishTime: f.finishTime } : {}),
    resultCode: (f.code as Finish['resultCode']) ?? null, startPresent: null,
    penaltyCode: null, penaltyOverride: null,
    redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null,
    redressIncludeAllLater: false, redressPoints: null,
  }));
  const { scores } = calculateHandicapRaceScores(finishes, competitors, raceStart, fleet);

  const competitorByIdMap = new Map(competitors.map((c) => [c.id, c]));
  const finishTimeByCompetitorId = new Map(
    finishes.filter((f) => f.competitorId && f.finishTime).map((f) => [f.competitorId!, f.finishTime!])
  );

  const sortedScores = [...scores.entries()]
    .sort((a, b) => {
      const ra = a[1].rank ?? Infinity;
      const rb = b[1].rank ?? Infinity;
      if (ra !== rb) return ra - rb;
      return a[0].localeCompare(b[0]);
    });

  const rows = sortedScores.map(([cId, score]) => {
    const c = competitorByIdMap.get(cId)!;
    const ratingDisplay = fixture.fleet.scoringSystem === 'irc'
      ? (c.ircTcc?.toFixed(3) ?? '—')
      : (c.pyNumber?.toString() ?? '—');
    const finishTimeDisplay = finishTimeByCompetitorId.get(cId) ?? (score.resultCode ?? '—');
    const rankDisplay = score.rank !== null ? score.rank.toString() : '—';
    const pointsDisplay = score.points % 1 === 0 ? score.points.toString() : score.points.toFixed(1);
    return `<tr>
  <td>${esc(rankDisplay)}</td>
  <td>${esc(c.name)}</td>
  <td class="mono">${esc(c.sailNumber)}</td>
  <td class="mono">${esc(ratingDisplay)}</td>
  <td class="mono">${esc(fmtTcf(score.tcfApplied, fixture.fleet.scoringSystem))}</td>
  <td class="mono">${esc(finishTimeDisplay)}</td>
  <td class="mono">${esc(fmtSeconds(score.elapsedTime))}</td>
  <td class="mono">${esc(fmtSeconds(score.correctedTime))}</td>
  <td>${esc(pointsDisplay)}</td>
</tr>`;
  }).join('\n');

  const notesHtml = fixture.rrs_notes
    ? `<p style="font-style:italic; color:#444;">${esc(fixture.rrs_notes)}</p>`
    : '';

  const comments = extractComments(yamlSource);
  const commentsHtml = comments
    ? `<pre style="margin:0.6em 0 0; padding:0.5em; background:#fff; border:1px solid #ddd; font-size:0.95em; line-height:1.4; white-space:pre-wrap;">${esc(comments)}</pre>`
    : '';

  const ratingHeader = fixture.fleet.scoringSystem === 'irc' ? 'TCC' : 'PY';

  return `<!doctype html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width">
<title>${esc(fixture.description)} — Sail Scoring</title>
<style>
body { font: 100% arial, helvetica, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #222; }
h1 { font-size: 1.4em; }
table { border-collapse: collapse; width: 100%; margin-top: 0.8em; }
td, th { text-align: left; padding: 6px 8px; border: 1px solid #ddd; }
th { background: #f5f5f0; font-weight: bold; }
tr:nth-child(even) { background: #fafafa; }
.mono { font-family: monospace; }
footer { margin-top: 3em; font-size: 0.9em; color: #999; border-top: 1px solid #eee; padding-top: 1em; }
</style>
</head>
<body>
<p><a href="../">&larr; All ${esc(sys)} handicap examples</a></p>
<h1>${esc(fixture.description)}</h1>
${notesHtml}
<div style="margin:0.8em 0; padding:0.6em 1em; background:#f5f5f0; border:1px solid #ccc; font-size:90%;">
  <strong>Scoring system:</strong> ${esc(sys)} &nbsp;&nbsp;
  <strong>Gun time:</strong> ${esc(fixture.startTime)}
</div>
${commentsHtml}
<table>
<thead>
<tr><th>Rank</th><th>Name</th><th>Sail #</th><th>${esc(ratingHeader)}</th><th>TCF</th><th>Finish time</th><th>ET</th><th>CT</th><th>Points</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
<footer><a href="https://sailscoring.ie">sailscoring.ie</a></footer>
</body>
</html>
`;
}

// ─── Index generation ─────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { title: string; intro: string }> = {
  scratch: {
    title: 'Scratch racing',
    intro: "Position-based scoring with no handicap. Each boat's score in a race equals\n  its finishing position. Series score is the sum of race scores; lowest wins.",
  },
  fleets: {
    title: 'Fleets',
    intro: 'Multi-fleet series where competitors are grouped into fleets and scored\n  independently. The penalty point base N is the fleet size, not the total\n  series entries \u2014 a DNC in a fleet of 3 scores 4, not the series total plus one.',
  },
  codes: {
    title: 'Result codes',
    intro: 'Scoring behaviour for result codes: position-replacing codes (DNS, DNF, DSQ,\n  OCS, UFD, BFD, RET, NSC, DNC, DNE) and non-discardable penalties. Point\n  values and discard eligibility are governed by RRS Appendix A5 and Rule 30.',
  },
  'tcc-handicap': {
    title: 'TCC handicap scoring (IRC / PY)',
    intro: 'Time-on-time corrected scoring using a Time Correction Factor (TCF).\n  IRC boats use TCC directly; PY boats derive TCF = 1000 \u00f7 PY number.\n  Boats rank by lowest corrected time (CT = ET \u00d7 TCF); penalty codes are unchanged.',
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
<title>${esc(meta.title)} \u2014 Sail Scoring Worked Examples</title>
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
<title>Sail Scoring \u2014 Worked Examples</title>
<style>
${BASE_CSS}
</style>
</head>
<body>
<h1>Sail Scoring \u2014 Worked Examples</h1>
<p>
  Each example specifies a complete scoring scenario \u2014 fleet, races, finishes, and
  expected standings \u2014 and shows the arithmetic. They exist so that experienced
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

// ─── Main ─────────────────────────────────────────────────────────────────────

const fixtureDir = join(__dirname, '../tests/fixtures/scoring');
const yamlFiles = readdirSync(fixtureDir, { recursive: true, encoding: 'utf-8' })
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => join(fixtureDir, f))
  .sort();

// Group yaml files by their immediate parent directory (= category).
const byCategory = new Map<string, Array<{ yamlPath: string; description: string }>>();
let htmCount = 0;

for (const yamlPath of yamlFiles) {
  const yamlSource = readFileSync(yamlPath, 'utf-8');
  const parsed = parseYaml(yamlSource);
  let html: string;
  let description: string;
  if (isHandicapFixture(parsed)) {
    html = generateHandicapFixtureHtml(parsed, yamlSource);
    description = parsed.description;
  } else {
    const fixture = parsed as ScoringFixture;
    html = generateFixtureHtml(fixture, yamlSource);
    description = fixture.description;
  }
  const outPath = yamlPath.replace(/\.yaml$/, '.html');
  writeFileSync(outPath, html, 'utf-8');
  console.log(`  ${basename(outPath)}`);
  htmCount++;

  const categoryDir = dirname(yamlPath);
  if (!byCategory.has(categoryDir)) byCategory.set(categoryDir, []);
  byCategory.get(categoryDir)!.push({ yamlPath, description });
}

// Generate category index.html files.
const categories: Array<{ dirName: string; title: string }> = [];
for (const [categoryDir, fixtures] of [...byCategory.entries()].sort()) {
  const dirName = basename(categoryDir);
  const indexHtml = generateCategoryIndex(categoryDir, fixtures);
  writeFileSync(join(categoryDir, 'index.html'), indexHtml, 'utf-8');
  console.log(`  ${dirName}/index.html`);
  categories.push({ dirName, title: (CATEGORY_META[dirName] ?? { title: dirName }).title });
}

// Generate root index.html.
const rootIndexHtml = generateRootIndex(categories);
writeFileSync(join(fixtureDir, 'index.html'), rootIndexHtml, 'utf-8');
console.log(`  index.html`);

const indexCount = categories.length + 1;
console.log(`\nGenerated ${htmCount} fixture preview${htmCount !== 1 ? 's' : ''} and ${indexCount} index file${indexCount !== 1 ? 's' : ''}.`);
