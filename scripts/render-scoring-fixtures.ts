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
import { calculateStandings, calculateRaceScores } from '../lib/scoring';
import { assembleSeriesResultsData, renderSeriesHtml } from '../lib/results-renderer';
import type { Competitor, Race, Finish, DiscardThreshold, ResultCode } from '../lib/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Fixture schema (mirrors tests/scoring-fixtures.test.ts) ─────────────────

interface FixtureFinish {
  sailor: string;
  position?: number;
  code?: ResultCode;
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
  };
  competitors: Array<{ sailNumber: string; name: string }>;
  races: FixtureRace[];
}

// ─── Build lib inputs from fixture ───────────────────────────────────────────

function buildInputs(fixture: ScoringFixture) {
  const competitors: Competitor[] = fixture.competitors.map((c, i) => ({
    id: `c-${i}`,
    seriesId: 's1',
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
      });
    }
  }

  return { competitors, races, finishes, discardThresholds: fixture.series.discardThresholds };
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

  const configHtml = `<p style="margin:0 0 0.5em; color:#333;"><strong>Scoring configuration:</strong> ${esc(discardThresholdsSummary(fixture.series.discardThresholds))}</p>`;

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
  const { competitors, races, finishes, discardThresholds } = buildInputs(fixture);

  const standings = calculateStandings(competitors, races, finishes, discardThresholds);

  // Build raceScoresByRaceId for assembleSeriesResultsData
  const raceScoresByRaceId = new Map<
    string,
    Map<string, { points: number; place: number | null; resultCode: ResultCode | null }>
  >();
  for (const race of races) {
    const raceFinishes = finishes.filter((f) => f.raceId === race.id);
    raceScoresByRaceId.set(race.id, calculateRaceScores(raceFinishes, competitors));
  }

  const competitorsById = new Map(competitors.map((c) => [c.id, c]));

  const data = assembleSeriesResultsData(
    { name: fixture.description, venue: '' },
    races,
    standings,
    raceScoresByRaceId,
    competitorsById,
    new Date(),
  );
  // Don't show a "provisional" timestamp — the file would change on every regeneration.
  delete data.generatedAt;

  // renderSeriesHtml generates a full document; inject preamble after the header table
  const preamble = buildPreamble(fixture, yamlSource);
  const html = renderSeriesHtml(data);

  // The header table is followed by <div style="clear:both;"></div>
  // Inject the preamble immediately after that div, before the results tables.
  return html.replace(
    '<div style="clear:both;"></div>',
    `<div style="clear:both;"></div>\n${preamble}`,
  );
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
