// Published-page rendering for split-fleet series (#328): the championship
// standings page (combined qualifying table before the split, tiered
// Gold/Silver/... tables after, fleet-tinted race cells, provisional cut
// line) and the rolling fleet-assignments page (newest round first). Plain
// HTML strings, no React — mirrors lib/results-renderer.ts conventions.

import type { Competitor, CompetitorFieldKey, Finish, Fleet, Race, RaceStart } from './types';
import { renderFlagDefs, renderHtmlDocument, type DocumentChrome } from './results-renderer';
import { bySailNumber } from './sail-number-sort';
import { worldSailingProfileUrl } from './world-sailing';
import {
  capitaliseStage,
  provisionalCutIndexes,
  qualifyingRaceCount,
  resolveVocabulary,
  roundsForStage,
  splitFleetStandings,
  stageRaceLabel,
  type CellScore,
  type SeriesStage,
  type SplitFleetConfig,
  type SplitFleetData,
  type SplitRound,
} from './split-fleets';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STAGE_ORDER: Record<SeriesStage, number> = { qualifying: 0, final: 1, medal: 2 };

/** A round as the render path receives it: wide enough for both the server
 *  repo's `SplitRound` and the file-shaped rounds the client repo hands back
 *  (no `seriesId`, `method` as a bare string, `basis` optional). */
export type RenderSplitRound = Omit<SplitRound, 'seriesId' | 'method' | 'basis'> & {
  seriesId?: string;
  method: string;
  basis?: SplitRound['basis'];
};

export interface SplitFleetRenderInput {
  seriesName: string;
  config: SplitFleetConfig;
  rounds: RenderSplitRound[];
  fleets: Fleet[];
  competitors: Competitor[];
  races: Race[];
  raceStarts: RaceStart[];
  finishes: Finish[];
  /** Which optional competitor fields the scorer shows; drives the Nat
   *  column. Absent = none. */
  enabledCompetitorFields?: CompetitorFieldKey[];
  /** Inline flag SVGs keyed by 3-letter code (see `SeriesResultsData.
   *  flagSvgByCode`). Callers load it on demand; absent = code-only cells. */
  flagSvgByCode?: Readonly<Record<string, { viewBox: string; inner: string }>>;
}

export function assembleSplitFleetData(input: SplitFleetRenderInput): SplitFleetData {
  return {
    config: input.config,
    rounds: input.rounds.map((r) => ({
      ...r,
      seriesId: r.seriesId ?? '',
      method: r.method as SplitRound['method'],
      basis: r.basis ?? null,
    })),
    fleets: input.fleets,
    competitors: input.competitors,
    races: input.races,
    raceStarts: input.raceStarts,
    finishes: input.finishes,
  };
}

/** Rules these pages need on top of the shared published-page styles: the
 *  fleet tints and the round cards have no equivalent in the results shell.
 *  Everything else — the body font, the table look, the Nat cell, the footer —
 *  comes from `renderHtmlDocument`, so that a championship's pages sit beside
 *  the competitor list and the standings without looking like another site. */
const PAGE_CSS = `<style>
.sfnote { color: #555; font-size: 0.9em; }
.sfround { margin: 1.5em 0; padding: 1em; border: 1px solid #ddd; border-radius: 8px; text-align: left; }
.sfround h2 { margin: 0; font-size: 1.05em; }
.sfround h3 { margin: 0.8em 0 0.2em; font-size: 1em; }
</style>`;

function showNat(input: SplitFleetRenderInput): boolean {
  return (
    (input.enabledCompetitorFields ?? []).includes('nationality') &&
    input.competitors.some((c) => c.nationality)
  );
}

function showWsid(input: SplitFleetRenderInput): boolean {
  return (
    (input.enabledCompetitorFields ?? []).includes('worldSailingId') &&
    input.competitors.some((c) => c.worldSailingId)
  );
}

function wsidCell(id: string | undefined): string {
  if (!id) return '<td class="wsid"></td>';
  return `<td class="wsid" style="font-family:monospace;font-size:0.85em;white-space:nowrap"><a href="${esc(worldSailingProfileUrl(id))}" target="_blank" rel="noopener noreferrer">${esc(id)}</a></td>`;
}

function natCell(
  code: string | undefined,
  flagSvgByCode: SplitFleetRenderInput['flagSvgByCode'],
): string {
  if (!code) return '<td class="nat"></td>';
  const flag = flagSvgByCode?.[code]
    ? `<span class="flag"><svg xmlns="http://www.w3.org/2000/svg"><use href="#flag-${esc(code)}" /></svg></span>`
    : '';
  return `<td class="nat">${flag}<span class="nattext">${esc(code)}</span></td>`;
}

/** The published-page chrome a caller supplies for these two pages. The same
 *  fields `renderHtmlDocument` takes, minus the ones the renderers know
 *  themselves (the series name, and which page this is). */
export interface SplitFleetPageChrome {
  venue?: string;
  leftLogoUrl?: string;
  rightLogoUrl?: string;
  leftUrl?: string;
  rightUrl?: string;
  generatedAt?: Date;
  resultsFinal?: boolean;
  finalisedAt?: Date;
  /** The event index, rendered as the shell's breadcrumb. */
  seriesIndexUrl?: string;
}

function chromeFor(input: SplitFleetRenderInput, opts: SplitFleetPageChrome): DocumentChrome {
  return {
    series: { name: input.seriesName, venue: opts.venue ?? '' },
    ...(opts.leftLogoUrl ? { leftLogoUrl: opts.leftLogoUrl } : {}),
    ...(opts.rightLogoUrl ? { rightLogoUrl: opts.rightLogoUrl } : {}),
    ...(opts.leftUrl ? { leftUrl: opts.leftUrl } : {}),
    ...(opts.rightUrl ? { rightUrl: opts.rightUrl } : {}),
    generatedAt: opts.generatedAt ?? new Date(0),
    ...(opts.resultsFinal ? { resultsFinal: true } : {}),
    ...(opts.finalisedAt ? { finalisedAt: opts.finalisedAt } : {}),
    ...(opts.seriesIndexUrl ? { seriesIndexUrl: opts.seriesIndexUrl } : {}),
  };
}

function flagDefsFor(input: SplitFleetRenderInput): string {
  const codes = [...new Set(input.competitors.map((c) => c.nationality).filter((n): n is string => !!n))].sort();
  return renderFlagDefs(codes, input.flagSvgByCode);
}

function fleetTint(config: SplitFleetConfig, label: string | undefined): string {
  const all = [...config.qualifyingFleets, ...config.finalFleets];
  const hit = all.find((f) => f.label === label);
  // Soft tint: fleet colour at low alpha via 8-digit hex when possible.
  return hit ? `${hit.color}2e` : '#ffffff';
}

/** The championship standings page. Returns full HTML. Deliberately carries
 *  no generation timestamp: the publish path content-hashes the page to
 *  detect no-op re-publishes. */
export function renderSplitFleetStandingsPage(
  input: SplitFleetRenderInput,
  opts: SplitFleetPageChrome = {},
): string {
  const data = assembleSplitFleetData(input);
  const rows = splitFleetStandings(data);
  const fleetName = new Map(data.fleets.map((f) => [f.id, f.name]));
  const splitRound = roundsForStage(data.rounds, 'final')[0] ?? null;
  const nat = showNat(input);
  const wsid = showWsid(input);
  const qRaces = qualifyingRaceCount(data);
  const vocab = resolveVocabulary(data.config);
  const columnLabel = (stage: SeriesStage, n: number) =>
    stageRaceLabel(data.config, stage, n, qRaces);

  const colKeys = new Map<string, { stage: SeriesStage; n: number }>();
  for (const r of rows) for (const c of r.cells) colKeys.set(`${c.stage}:${c.stageRaceNumber}`, { stage: c.stage, n: c.stageRaceNumber });
  const columns = [...colKeys.values()].sort(
    (a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.n - b.n,
  );

  const cellHtml = (row: (typeof rows)[number], col: { stage: SeriesStage; n: number }): string => {
    const c = row.cells.find((x: CellScore) => x.stage === col.stage && x.stageRaceNumber === col.n);
    if (!c) return '<td></td>';
    const tint = c.counts ? fleetTint(data.config, fleetName.get(c.fleetId)) : '#f8f9fa';
    const text = `${c.points}${c.code ? ` ${c.code}` : ''}`;
    const inner = c.discarded ? `(${esc(text)})` : esc(text);
    const dim = c.counts ? '' : ';color:#adb5bd';
    const bold = c.discardable ? '' : ';font-weight:bold';
    const title = c.counts
      ? c.carriedRank
        ? ` title="${esc(vocab.stages.qualifying.name)} position, carried into the ${esc(vocab.stages.final.name)}"`
        : c.carriedTransform
          ? ` title="${esc(vocab.seriesName)} score, compressed and carried into the ${esc(vocab.stages.medal.name)}"`
          : ''
      : c.superseded
        ? ' title="replaced by the carried score"'
        : c.excludedAsExtra
          ? ` title="excluded so every boat has the same number of ${esc(vocab.stages.qualifying.name)} scores"`
          : ' title="does not yet count — race incomplete across fleets"';
    return `<td style="background:${tint};text-align:center${dim}${bold}"${title}>${inner}</td>`;
  };

  const table = (rowsIn: typeof rows, cuts: number[] = []): string => {
    const head = columns.map((c) => `<th>${columnLabel(c.stage, c.n)}</th>`).join('');
    const body = rowsIn
      .map((row, i) => {
        const medal = row.medal
          ? ' <span style="font-size:0.8em;color:#b8860b;border:1px solid #b8860b;border-radius:3px;padding:0 3px;">medal</span>'
          : '';
        const tr = `<tr class="${i % 2 === 0 ? 'odd' : 'even'} summaryrow">
  <td>${row.rank}</td>
  ${nat ? natCell(row.competitor.nationality, input.flagSvgByCode) : ''}
  <td style="font-family:monospace">${esc(row.competitor.sailNumber)}</td>
  <td>${esc(row.competitor.names.join(' & '))}${medal}</td>
  ${wsid ? wsidCell(row.competitor.worldSailingId) : ''}
  ${columns.map((c) => cellHtml(row, c)).join('\n  ')}
  <td style="text-align:right">${row.total}</td>
  <td style="text-align:right;font-weight:bold">${row.net}</td>
</tr>`;
        const cut = cuts.includes(i)
          ? `<tr><td colspan="${columns.length + 5 + (nat ? 1 : 0) + (wsid ? 1 : 0)}" style="border:none;padding:0"><div style="border-top:2px dashed #f59e0b;text-align:center;font-size:0.75em;color:#b45309;text-transform:uppercase">provisional split if qualifying ended now</div></td></tr>`
          : '';
        return tr + cut;
      })
      .join('\n');
    return `<div class="tablewrap"><table class="summarytable">
<thead><tr><th>Rank</th>${nat ? '<th>Nat</th>' : ''}<th>Sail</th><th>Helm</th>${wsid ? '<th>WS ID</th>' : ''}${head}<th>Total</th><th>Nett</th></tr></thead>
<tbody>
${body}
</tbody>
</table></div>`;
  };

  let sections: string;
  if (splitRound) {
    sections = splitRound.fleetIds
      .map((fid) => {
        const fleetRows = rows.filter((r) => r.finalFleetId === fid);
        return fleetRows.length
          ? `<h2>${esc(fleetName.get(fid) ?? '')} fleet</h2>\n${table(fleetRows)}`
          : '';
      })
      .filter(Boolean)
      .join('\n');
  } else {
    const cuts = provisionalCutIndexes(rows.length, data.config.finalFleets.length);
    sections = table(rows, data.config.finalFleets.length > 1 ? cuts : []);
  }

  return renderHtmlDocument(
    { ...chromeFor(input, opts), fleetName: 'Championship' },
    `${PAGE_CSS}\n${sections}`,
    {
      fontPercent: 72,
      hasNhcDetail: false,
      hasEchoDetail: false,
      flagDefs: nat ? flagDefsFor(input) : '',
    },
  );
}

/** The rolling fleet-assignments page: every round, newest first. */
export function renderSplitFleetAssignmentsPage(
  input: SplitFleetRenderInput,
  opts: SplitFleetPageChrome = {},
): string {
  const data = assembleSplitFleetData(input);
  const fleetName = new Map(data.fleets.map((f) => [f.id, f.name]));
  const nat = showNat(input);
  const qRaces = qualifyingRaceCount(data);
  const vocab = resolveVocabulary(data.config);

  const roundLabel = (r: SplitRound): string => {
    if (r.stage === 'final') return `${capitaliseStage(vocab.stages.final.name)} split`;
    if (r.stage === 'medal') return capitaliseStage(vocab.stages.medal.fleetNoun);
    const idx = roundsForStage(data.rounds, 'qualifying').indexOf(r) + 1;
    return `${capitaliseStage(vocab.stages.qualifying.name)} round ${idx} (${stageRaceLabel(data.config, 'qualifying', r.fromStageRace)} onward)`;
  };

  const sections = [...data.rounds]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((round) => {
      const fleets = round.fleetIds
        .map((fid) => {
          const members = data.competitors
            .filter((c) => c.fleetIds.includes(fid))
            .sort(bySailNumber);
          const rowsHtml = members
            .map(
              (c, i) =>
                `<tr class="${i % 2 === 0 ? 'odd' : 'even'} summaryrow">${nat ? natCell(c.nationality, input.flagSvgByCode) : ''}<td style="font-family:monospace">${esc(c.sailNumber)}</td><td>${esc(c.names.join(' & '))}</td>${
                  round.overrides?.[c.id] === fid ? '<td>placed by the committee</td>' : '<td></td>'
                }</tr>`,
            )
            .join('\n');
          return `<h3>${esc(fleetName.get(fid) ?? '')} (${members.length})</h3>
<div class="tablewrap"><table class="summarytable"><thead><tr>${nat ? '<th>Nat</th>' : ''}<th>Sail</th><th>Helm</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
        })
        .join('\n');
      const basis = round.basis
        ? `From the ranking after ${stageRaceLabel(data.config, round.stage === 'final' ? 'qualifying' : round.stage, round.basis.throughStageRace, qRaces)}, captured ${new Date(round.basis.capturedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.`
        : round.method === 'seeded'
          ? 'Initial seeding.'
          : round.method === 'manual'
            ? 'Initial assignment as supplied by the organising authority.'
            : '';
      return `<section class="sfround">
<h2>${esc(roundLabel(round))}</h2>
<p class="sfnote">${esc(basis)}</p>
${fleets}
</section>`;
    })
    .join('\n');

  const note =
    '<p class="sfnote">Newest assignment first. Assignments are frozen when made; later scoring changes never change a published round.</p>';
  const body = sections.trim()
    ? `${note}\n${sections}`
    : '<p class="sfnote">No fleets have been assigned yet.</p>';
  return renderHtmlDocument(
    { ...chromeFor(input, opts), fleetName: 'Fleet assignments' },
    `${PAGE_CSS}\n${body}`,
    {
      fontPercent: 72,
      hasNhcDetail: false,
      hasEchoDetail: false,
      flagDefs: nat ? flagDefsFor(input) : '',
    },
  );
}
