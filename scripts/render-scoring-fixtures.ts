/**
 * Generate .htm preview files for each YAML scoring fixture.
 *
 * Run: pnpm generate:fixtures
 *
 * Each .htm file is checked in alongside its .yaml file so that scorers
 * can review test cases in a browser without running any code.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { calculateStandings, calculateFleetStandings, calculateRaceScores } from '../lib/scoring';
import { assembleSeriesResultsData, renderSeriesHtml } from '../lib/results-renderer';
import type { Competitor, Fleet, Race, Finish, DiscardThreshold, ResultCode } from '../lib/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Fixture schema (mirrors tests/scoring-fixtures.test.ts) ─────────────────

interface FixtureFinish {
  sailor: string;
  position?: number;
  code?: ResultCode;
  startPresent?: boolean;
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
  }));
  const fleetIdByName = new Map(fleets.map((f) => [f.name, f.id]));

  const competitors: Competitor[] = fixture.competitors.map((c, i) => ({
    id: `c-${i}`,
    seriesId: 's1',
    fleetId: fleetIdByName.get(c.fleet ?? 'Default') ?? 'f1',
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
        finishPosition: f.position ?? null,
        resultCode: f.code ?? null,
        startPresent: f.startPresent ?? null,
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
    const fleetResults = calculateFleetStandings(fleets, competitors, races, finishes, discardThresholds, dnfScoring);
    const sections: string[] = [];

    for (const { fleet, standings } of fleetResults) {
      const fleetCompetitorIds = new Set(
        competitors.filter((c) => c.fleetId === fleet.id).map((c) => c.id),
      );
      const raceScoresByRaceId = new Map<
        string,
        Map<string, { points: number; place: number | null; rank: number | null; resultCode: ResultCode | null }>
      >();
      for (const race of races) {
        const raceFinishes = finishes.filter(
          (f) => f.raceId === race.id && fleetCompetitorIds.has(f.competitorId),
        );
        raceScoresByRaceId.set(race.id, calculateRaceScores(raceFinishes, competitors.filter((c) => fleetCompetitorIds.has(c.id)), dnfScoring));
      }

      const data = assembleSeriesResultsData(
        { name: fixture.description, venue: '' },
        races,
        standings,
        raceScoresByRaceId,
        competitorsById,
        new Date(),
        fleet.name,
      );
      delete data.generatedAt;
      sections.push(renderSeriesHtml(data));
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
    const standings = calculateStandings(competitors, races, finishes, discardThresholds, dnfScoring);

    const raceScoresByRaceId = new Map<
      string,
      Map<string, { points: number; place: number | null; rank: number | null; resultCode: ResultCode | null }>
    >();
    for (const race of races) {
      const raceFinishes = finishes.filter((f) => f.raceId === race.id);
      raceScoresByRaceId.set(race.id, calculateRaceScores(raceFinishes, competitors, dnfScoring));
    }

    const data = assembleSeriesResultsData(
      { name: fixture.description, venue: '' },
      races,
      standings,
      raceScoresByRaceId,
      competitorsById,
      new Date(),
    );
    delete data.generatedAt;

    const html = renderSeriesHtml(data);
    bodyHtml = html.replace(
      '<div style="clear:both;"></div>',
      `<div style="clear:both;"></div>\n${preamble}`,
    );
  }

  return bodyHtml;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const fixtureDir = join(__dirname, '../tests/fixtures/scoring');
const yamlFiles = readdirSync(fixtureDir, { recursive: true, encoding: 'utf-8' })
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => join(fixtureDir, f))
  .sort();

let count = 0;
for (const yamlPath of yamlFiles) {
  const yamlSource = readFileSync(yamlPath, 'utf-8');
  const fixture = parseYaml(yamlSource) as ScoringFixture;
  const html = generateFixtureHtml(fixture, yamlSource);
  const outPath = yamlPath.replace(/\.yaml$/, '.htm');
  writeFileSync(outPath, html, 'utf-8');
  console.log(`  ${basename(outPath)}`);
  count++;
}
console.log(`\nGenerated ${count} fixture preview${count !== 1 ? 's' : ''}.`);
