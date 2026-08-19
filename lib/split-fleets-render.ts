// Published-page rendering for split-fleet series (#328): the championship
// standings page (combined qualifying table before the split, tiered
// Gold/Silver/... tables after, fleet-tinted race cells, provisional cut
// line) and the rolling fleet-assignments page (newest round first). Plain
// HTML strings, no React — mirrors lib/results-renderer.ts conventions.

import type { Competitor, CompetitorFieldKey, Finish, Fleet, Race, RaceStart } from './types';
import { renderFlagDefs } from './results-renderer';
import { bySailNumber } from './sail-number-sort';
import { worldSailingProfileUrl } from './world-sailing';
import {
  championshipValidity,
  provisionalCutIndexes,
  roundsForStage,
  splitFleetStandings,
  type CellScore,
  type SeriesStage,
  type SplitFleetConfig,
  type SplitFleetData,
  type SplitRound,
} from './split-fleets';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STAGE_PREFIX: Record<SeriesStage, string> = { qualifying: 'Q', final: 'F', medal: 'M' };

/** Column heading for a stage race. Stage race 0 is not a race: in the final
 *  series it is the carried qualifying position (`rank-seed` carry), in the
 *  medal stage the compressed opening-series score (`medal.carryTransform`). */
function columnLabel(stage: SeriesStage, n: number): string {
  if (n !== 0) return `${STAGE_PREFIX[stage]}${n}`;
  return stage === 'medal' ? 'Carried' : 'QS';
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

const PAGE_CSS = `body { font: 100% arial, helvetica, sans-serif; max-width: 1000px; margin: 24px auto; padding: 0 16px; color: #222; }
td.nat { text-align: center; }
td.nat .flag svg { width: 1.5em; height: 1em; display: block; margin: 0 auto; }
td.nat .nattext { font-size: 0.75em; letter-spacing: 0.03em; }
h1 { font-size: 1.4em; margin-bottom: 0.2em; }
h2 { font-size: 1.05em; margin: 1.4em 0 0.3em; }
table { border-collapse: collapse; width: 100%; margin-top: 0.4em; font-size: 0.92em; }
td, th { padding: 5px 7px; border: 1px solid #ddd; }
th { background: #f5f5f0; text-align: left; }
.wrap { overflow-x: auto; }
footer { margin-top: 3em; font-size: 0.9em; color: #999; border-top: 1px solid #eee; padding-top: 1em; }`;

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
  opts: { backHref?: string } = {},
): string {
  const data = assembleSplitFleetData(input);
  const rows = splitFleetStandings(data);
  const fleetName = new Map(data.fleets.map((f) => [f.id, f.name]));
  const splitRound = roundsForStage(data.rounds, 'final')[0] ?? null;
  const nat = showNat(input);
  const wsid = showWsid(input);

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
        ? ' title="qualifying-series position, carried into the final series"'
        : c.carriedTransform
          ? ' title="opening-series score, compressed and carried into the medal races"'
          : ''
      : c.superseded
        ? ' title="replaced by the carried score"'
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
        const tr = `<tr>
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
    return `<div class="wrap"><table>
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

  const back = opts.backHref
    ? `<p><a href="${esc(opts.backHref)}">&larr; ${esc(input.seriesName)}</a></p>`
    : '';
  // Below the SIs' minimum these are a running order, not a championship
  // result — say so on the page rather than letting it read as one.
  const validity = championshipValidity(data);
  const notice =
    validity && !validity.valid
      ? `<p style="border-left:3px solid #f59e0b;background:#fffbeb;padding:0.5em 0.75em;color:#92400e">Not yet a valid championship: ${validity.completed} of the ${validity.required} races required have been completed.</p>`
      : '';
  return `<!doctype html>
<html lang="en">
<head><meta name="viewport" content="width=device-width"><title>${esc(input.seriesName)} — Championship standings</title><style>${PAGE_CSS}</style></head>
<body>
${nat ? flagDefsFor(input) : ''}
${back}
<h1>${esc(input.seriesName)}</h1>
${notice}
${sections}
<footer><a href="https://sailscoring.ie">sailscoring.ie</a></footer>
</body>
</html>
`;
}

/** The rolling fleet-assignments page: every round, newest first. */
export function renderSplitFleetAssignmentsPage(
  input: SplitFleetRenderInput,
  opts: { backHref?: string } = {},
): string {
  const data = assembleSplitFleetData(input);
  const fleetName = new Map(data.fleets.map((f) => [f.id, f.name]));
  const nat = showNat(input);

  const roundLabel = (r: SplitRound): string => {
    if (r.stage === 'final') return 'Final series split';
    if (r.stage === 'medal') return 'Medal fleet';
    const idx = roundsForStage(data.rounds, 'qualifying').indexOf(r) + 1;
    return `Qualifying round ${idx} (Q${r.fromStageRace} onward)`;
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
              (c) =>
                `<tr>${nat ? natCell(c.nationality, input.flagSvgByCode) : ''}<td style="font-family:monospace">${esc(c.sailNumber)}</td><td>${esc(c.names.join(' & '))}</td>${
                  round.overrides?.[c.id] === fid ? '<td>placed by the committee</td>' : '<td></td>'
                }</tr>`,
            )
            .join('\n');
          return `<h3 style="margin:0.8em 0 0.2em">${esc(fleetName.get(fid) ?? '')} (${members.length})</h3>
<div class="wrap"><table><thead><tr>${nat ? '<th>Nat</th>' : ''}<th>Sail</th><th>Helm</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
        })
        .join('\n');
      const basis = round.basis
        ? `From the ranking after ${STAGE_PREFIX[round.stage === 'final' ? 'qualifying' : round.stage]}${round.basis.throughStageRace}, captured ${new Date(round.basis.capturedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.`
        : round.method === 'seeded'
          ? 'Initial seeding.'
          : '';
      return `<section style="margin:1.5em 0;padding:1em;border:1px solid #ddd;border-radius:8px">
<h2 style="margin:0">${esc(roundLabel(round))}</h2>
<p style="color:#555;font-size:0.9em">${esc(basis)}</p>
${fleets}
</section>`;
    })
    .join('\n');

  const back = opts.backHref
    ? `<p><a href="${esc(opts.backHref)}">&larr; ${esc(input.seriesName)}</a></p>`
    : '';
  const note =
    '<p style="color:#555;font-size:0.9em">Newest assignment first. Assignments are frozen when made; later scoring changes never change a published round.</p>';
  return `<!doctype html>
<html lang="en">
<head><meta name="viewport" content="width=device-width"><title>${esc(input.seriesName)} — Fleet assignments</title><style>${PAGE_CSS}</style></head>
<body>
${nat ? flagDefsFor(input) : ''}
${back}
<h1>${esc(input.seriesName)} — Fleet assignments</h1>
${note}
${sections}
<footer><a href="https://sailscoring.ie">sailscoring.ie</a></footer>
</body>
</html>
`;
}
