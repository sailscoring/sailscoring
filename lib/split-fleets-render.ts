// Published-page rendering for split-fleet series (#328): the championship
// standings page (combined qualifying table before the split, tiered
// Gold/Silver/... tables after, fleet-tinted race cells, provisional cut
// line), the per-race results page (every stage race, one table per fleet),
// and the rolling fleet-assignments page (newest round first). Plain
// HTML strings, no React — mirrors lib/results-renderer.ts conventions.

import type { NationalFlag } from './nationality/types';
import type {
  Competitor,
  CompetitorFieldKey,
  Finish,
  Fleet,
  Race,
  RaceOfficial,
  RaceStart,
} from './types';
import {
  renderFlagDefs,
  renderHelmCell,
  renderHtmlDocument,
  renderListCell,
  TRACK_DATA_COLUMNS,
  type DocumentChrome,
} from './results-renderer';
import { formatConditions, hasConditions } from './race-conditions';
import { formatOfficials, hasOfficials } from './race-officials';
import { describeSplitFleetConfig } from './split-fleets-si';
import { bySailNumber } from './sail-number-sort';
import { parseHmsToSeconds } from './time-parse';
import { publishedCell } from './track-data';
import { worldSailingProfileUrl } from './world-sailing';
import {
  assembleSplitFleetData,
  capitaliseStage,
  fleetColorById,
  logicalRaces,
  provisionalCutIndexes,
  resolveVocabulary,
  roundsForStage,
  splitFleetStandings,
  stageRaceLabel,
  STAGES,
  type CellScore,
  type SeriesStage,
  type RenderSplitRound,
  type SplitFleetConfig,
  type SplitRound,
} from './split-fleets';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STAGE_ORDER: Record<SeriesStage, number> = { qualifying: 0, final: 1, medal: 2 };

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
  /** Inline flags keyed by 3-letter code (see `SeriesResultsData.
   *  flagSvgByCode`). Callers load it on demand; absent = code-only cells. */
  flagSvgByCode?: Readonly<Record<string, NationalFlag>>;
  /** Whether the series publishes RaceSense track data. The caller resolves
   *  the whole opt-in — the workspace's racesense-import feature AND the
   *  series' publishTrackData setting. It governs the track columns and the
   *  times of the boats the device measured; a hand-recorded time reaches
   *  the per-race tables either way. See `publishedCell`. */
  showTrackData?: boolean;
  /** Whether a race's own management team may be named on the race-results
   *  page. The caller resolves the series opt-in; conditions need no opt-in,
   *  because they describe the racing rather than a person. */
  publishOfficials?: boolean;
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
.sfdot { display: inline-block; width: 0.55em; height: 0.55em; border-radius: 50%; border: 1px solid rgba(0,0,0,0.25); margin-right: 0.3em; }
.sffleets { display: flex; flex-wrap: wrap; gap: 0 1.2em; justify-content: center; align-items: flex-start; }
.sffleets .tablewrap { margin: 0 0 1em 0; }
.sffleethead { color: #073358; text-align: center; }
.sfformat { margin: 2em auto 0; max-width: 46em; text-align: left; }
.sfformat summary { cursor: pointer; font-weight: 600; }
.sfformat ol { color: #555; line-height: 1.5; }
</style>`;

/**
 * The format, restated as sailing-instruction prose and folded away under the
 * standings.
 *
 * A reader who has just read the table has one obvious next question — how is
 * this event scored? — and the answer is a thing the app can already write:
 * the same sentences the scorer checked their configuration against, in the
 * language the scoring section of a sailing instruction uses. Closed by
 * default: it is the follow-up question, not the one they arrived with.
 */
function formatDetails(config: SplitFleetConfig): string {
  const lines = describeSplitFleetConfig(config)
    .map((line) => `<li>${esc(line.text)}</li>`)
    .join('\n');
  return `<details class="sfformat"><summary>How this championship is scored</summary>\n<ol>${lines}</ol></details>`;
}

function showNat(input: SplitFleetRenderInput): boolean {
  return (
    (input.enabledCompetitorFields ?? []).includes('nationality') &&
    input.competitors.some((c) => c.nationality)
  );
}

function showClass(input: SplitFleetRenderInput): boolean {
  return (
    (input.enabledCompetitorFields ?? []).includes('boatClass') &&
    input.competitors.some((c) => c.boatClass?.trim())
  );
}

function showCrew(input: SplitFleetRenderInput): boolean {
  return (
    (input.enabledCompetitorFields ?? []).includes('crewName') &&
    input.competitors.some((c) => c.crewNames?.some((n) => n.trim()))
  );
}

function showClub(input: SplitFleetRenderInput): boolean {
  return (
    (input.enabledCompetitorFields ?? []).includes('club') &&
    input.competitors.some((c) => c.clubs?.some((n) => n.trim()))
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
  /** The event's standing race management team, already filtered by the
   *  caller's publish opt-in — these pages never make that decision, the
   *  same division of labour the per-fleet path keeps. */
  officials?: RaceOfficial[];
  /** The per-race results page's URL relative to this page, when the caller
   *  knows where both will be served (the publish path does; preview,
   *  download and FTP do not). On the championship standings it turns each
   *  race column header into a deep link and adds a legend line. */
  raceResultsHref?: string;
  /** "Open in Sail Scoring" — the footer link into a read-only view of the
   *  series behind the page. A reference to the publication's data file on a
   *  published page, the payload itself on a downloaded one, exactly as on
   *  every other results page. */
  openInAppUrl?: string;
  /** The publication's `.sailscoring.json`, linked in the footer and declared
   *  as the page's JSON alternate (ADR-012). Published pages only. */
  dataFileUrl?: string;
  /** The scorer's note on every page of the publication, and the one on this
   *  page (#511). A championship's three pages take different page notes from
   *  the same caller, which is why this is per-render rather than shared. */
  seriesNote?: string;
  pageNote?: string;
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
    ...(hasOfficials(opts.officials) ? { officials: opts.officials } : {}),
    ...(opts.openInAppUrl ? { openInAppUrl: opts.openInAppUrl } : {}),
    ...(opts.dataFileUrl ? { dataFileUrl: opts.dataFileUrl } : {}),
    ...(opts.seriesNote ? { seriesNote: opts.seriesNote } : {}),
    ...(opts.pageNote ? { pageNote: opts.pageNote } : {}),
  };
}

function flagDefsFor(input: SplitFleetRenderInput): string {
  const codes = [...new Set(input.competitors.map((c) => c.nationality).filter((n): n is string => !!n))].sort();
  return renderFlagDefs(codes, input.flagSvgByCode);
}

/** fleetId → colour, as `fleetColorById` resolves it for the series. */
type FleetColors = ReadonlyMap<string, string>;

/** A fleet's colour as flat 6-digit hex; null when the fleet has none or it
 *  is unparseable. Widens `#abc` to `#aabbcc`: tint callers append an alpha
 *  suffix, and appending it to a short hex yields a seven-character value the
 *  browser drops on the floor. */
function fleetColorHex(colors: FleetColors, fleetId: string | undefined): string | null {
  const hex = (fleetId === undefined ? undefined : colors.get(fleetId))?.trim();
  if (!hex) return null;
  const six = /^#[0-9a-f]{3}$/i.test(hex)
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  return /^#[0-9a-f]{6}$/i.test(six) ? six : null;
}

/** Fleet colour at low alpha, as 8-digit hex. `alpha` defaults to the race
 *  cell's; a whole tinted row reads much stronger than one cell, so the
 *  assignment list asks for less. The organising authority's own assignment
 *  sheets use the colours flat — pure yellow, #FF3300 — which is legible on
 *  paper and hard going on a screen. */
function fleetTint(
  colors: FleetColors,
  fleetId: string | undefined,
  alpha = '2e',
): string {
  const six = fleetColorHex(colors, fleetId);
  return six ? `${six}${alpha}` : '#ffffff';
}

/** The fleet marker dot: the colour flat, bordered so pale fleets hold up.
 *  Empty when the fleet has no usable colour — the name beside it, or the
 *  cell tooltip, still carries the fleet. */
function fleetDot(colors: FleetColors, fleetId: string | undefined): string {
  const six = fleetColorHex(colors, fleetId);
  return six ? `<span class="sfdot" style="background:${six}"></span>` : '';
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
  const colors = fleetColorById(data);
  const splitRound = roundsForStage(data.rounds, 'final')[0] ?? null;
  const nat = showNat(input);
  const boatClass = showClass(input);
  const crew = showCrew(input);
  const club = showClub(input);
  const wsid = showWsid(input);
  const vocab = resolveVocabulary(data.config);
  const columnLabel = (stage: SeriesStage, n: number) =>
    stageRaceLabel(data.config, stage, n);

  /** The race columns one table needs: those some boat in it has a cell for.
   *  Per table rather than per page — once a medal stage exists the page's
   *  full set carries the medal columns, which no boat outside the medal
   *  fleet can ever hold a cell in, and every other fleet's table would
   *  carry them as dead width. The rule generalises: a stage race a whole
   *  fleet never sailed drops out of that fleet's table the same way. */
  const columnsFor = (rowsIn: typeof rows) => {
    const colKeys = new Map<string, { stage: SeriesStage; n: number }>();
    for (const r of rowsIn) for (const c of r.cells) colKeys.set(`${c.stage}:${c.stageRaceNumber}`, { stage: c.stage, n: c.stageRaceNumber });
    return [...colKeys.values()].sort(
      (a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.n - b.n,
    );
  };

  /** One fleet's sailing of one stage race — the unit a place is won in.
   *  Gold and Silver sailing the same stage race are two races here, each
   *  ranked within itself, exactly as the per-race page pulls them apart. */
  const raceKey = (c: CellScore) => `${c.stage}\u0000${c.stageRaceNumber}\u0000${c.fleetId}`;

  /** Who finished first, second and third in each of those, keyed by race and
   *  competitor. Points decide it: the engine scores finishing places in
   *  order within the fleet, so the lowest scores are the podium. A coded
   *  score is not a finishing place, and a carried score is not a race at
   *  all, so neither is eligible. Tied points share a place and consume the
   *  one below, the way a ranking always does. */
  const podiumRanks = new Map<string, 1 | 2 | 3>();
  {
    const sailed = new Map<string, { competitorId: string; points: number }[]>();
    for (const row of rows) {
      for (const c of row.cells) {
        if (c.code !== null || c.carriedTransform) continue;
        let list = sailed.get(raceKey(c));
        if (!list) sailed.set(raceKey(c), (list = []));
        list.push({ competitorId: row.competitor.id, points: c.points });
      }
    }
    for (const [race, list] of sailed) {
      list.sort((a, b) => a.points - b.points);
      let place = 0;
      let previous: number | null = null;
      for (const [i, entry] of list.entries()) {
        if (previous === null || entry.points !== previous) place = i + 1;
        if (place > 3) break;
        podiumRanks.set(`${race}\u0000${entry.competitorId}`, place as 1 | 2 | 3);
        previous = entry.points;
      }
    }
  }

  const cellHtml = (row: (typeof rows)[number], col: { stage: SeriesStage; n: number }): string => {
    const c = row.cells.find((x: CellScore) => x.stage === col.stage && x.stageRaceNumber === col.n);
    if (!c) return '<td></td>';
    const fleet = fleetName.get(c.fleetId);
    // A podium cell takes the gold/silver/bronze every other published page
    // marks a race win in, over its fleet tint — the dot and the tooltip still
    // say which fleet the race was sailed in. A discarded score keeps the
    // tint instead: a discard loses the medal here as it does on an ordinary
    // standings table, and a score that does not yet count has not won
    // anything yet either.
    const podium =
      c.counts && !c.discarded
        ? podiumRanks.get(`${raceKey(c)}\u0000${row.competitor.id}`)
        : undefined;
    const tint = c.counts ? fleetTint(colors, c.fleetId) : '#f8f9fa';
    const text = `${c.points}${c.code ? ` ${c.code}` : ''}`;
    const inner = c.discarded ? `(${esc(text)})` : esc(text);
    const dim = c.counts ? '' : ';color:#adb5bd';
    const bold = c.discardable ? '' : ';font-weight:bold';
    const note = c.counts
      ? c.carriedTransform
        ? `${vocab.seriesName} score, compressed and carried into the ${vocab.stages.medal.name}`
        : ''
      : c.carriedTransform
        ? `${vocab.seriesName} score, compressed — counts once a ${vocab.stages.medal.raceNoun} is completed`
        : c.superseded
          ? 'replaced by the carried score'
          : 'does not yet count — race incomplete across fleets';
    const titleText = [fleet ? `${fleet} fleet` : '', note].filter(Boolean).join(' — ');
    const title = titleText ? ` title="${esc(titleText)}"` : '';
    const podiumClass = podium ? ` class="rank${podium}"` : '';
    const background = podium ? '' : `background:${tint};`;
    return `<td${podiumClass} style="${background}text-align:center${dim}${bold}"${title}>${fleetDot(colors, c.fleetId)}${inner}</td>`;
  };

  // The combined qualifying table carries a Fleet column with the current
  // round's assignment — after the split the per-fleet section headings say
  // it instead. `null` = no column.
  const fleetOf = (row: (typeof rows)[number]): string | undefined => {
    const latest = [...data.rounds].sort((a, b) => b.createdAt - a.createdAt)[0];
    return latest?.fleetIds.find((f) => row.competitor.fleetIds.includes(f));
  };

  // With the race page's location known, each race column header deep-links
  // to that race's own tables. A carried-score column (stage race 0) is a
  // score, not a race: no section exists for it, so no link.
  const headerCell = (c: { stage: SeriesStage; n: number }): string => {
    const label = columnLabel(c.stage, c.n);
    return opts.raceResultsHref && c.n > 0
      ? `<th><a href="${esc(opts.raceResultsHref)}#${stageRaceAnchor(c.stage, c.n)}">${label}</a></th>`
      : `<th>${label}</th>`;
  };

  const table = (rowsIn: typeof rows, cuts: number[] = [], withFleetCol = false): string => {
    const columns = columnsFor(rowsIn);
    const head = columns.map(headerCell).join('');
    const body = rowsIn
      .map((row, i) => {
        const fleetId = withFleetCol ? fleetOf(row) : undefined;
        // No WS ID column on the table → the name carries the bio link
        // instead, so the profile is still one click away.
        const helmHtml = renderHelmCell(
          row.competitor.names,
          row.competitor.crewNames,
          crew,
          !wsid && row.competitor.worldSailingId
            ? worldSailingProfileUrl(row.competitor.worldSailingId)
            : undefined,
        );
        const tr = `<tr class="${i % 2 === 0 ? 'odd' : 'even'} summaryrow">
  <td>${row.rank}</td>
  ${withFleetCol ? `<td style="white-space:nowrap">${fleetDot(colors, fleetId)}${esc((fleetId && fleetName.get(fleetId)) || '')}</td>` : ''}
  ${nat ? natCell(row.competitor.nationality, input.flagSvgByCode) : ''}
  <td style="font-family:monospace">${esc(row.competitor.sailNumber)}</td>
  ${boatClass ? `<td>${esc(row.competitor.boatClass ?? '')}</td>` : ''}
  <td>${helmHtml}</td>
  ${club ? `<td>${renderListCell(row.competitor.clubs)}</td>` : ''}
  ${wsid ? wsidCell(row.competitor.worldSailingId) : ''}
  ${columns.map((c) => cellHtml(row, c)).join('\n  ')}
  <td style="text-align:right">${row.total}</td>
  <td style="text-align:right;font-weight:bold">${row.net}</td>
</tr>`;
        // A shared rank across the line means the ranking does not place the
        // cut — say so rather than letting the line silently resolve the tie.
        const tiedAcrossCut = cuts.includes(i) && rowsIn[i + 1]?.rank === row.rank;
        const cut = cuts.includes(i)
          ? `<tr><td colspan="${columns.length + 5 + (withFleetCol ? 1 : 0) + (nat ? 1 : 0) + (boatClass ? 1 : 0) + (club ? 1 : 0) + (wsid ? 1 : 0)}" style="border:none;padding:0"><div style="border-top:2px dashed #f59e0b;text-align:center;font-size:0.75em;color:#b45309;text-transform:uppercase">provisional split if qualifying ended now${tiedAcrossCut ? ' — the boats either side are tied; the ranking does not decide this cut' : ''}</div></td></tr>`
          : '';
        return tr + cut;
      })
      .join('\n');
    return `<div class="tablewrap"><table class="summarytable">
<thead><tr><th>Rank</th>${withFleetCol ? '<th>Fleet</th>' : ''}${nat ? '<th>Nat</th>' : ''}<th>Sail</th>${boatClass ? '<th>Class</th>' : ''}<th>${crew ? 'Helm / Crew' : 'Helm'}</th>${club ? '<th>Club</th>' : ''}${wsid ? '<th>WS ID</th>' : ''}${head}<th>Total</th><th>Nett</th></tr></thead>
<tbody>
${body}
</tbody>
</table></div>`;
  };

  // One dot + name per fleet that actually appears in the cells, in fleet
  // order — the key a reader needs before the tints and dots mean anything.
  // Deduped by name: a round-2 "Yellow" is its own fleet, but the reader is
  // being told what the colour means, and it means the same thing twice.
  const legendHtml = (): string => {
    const present = new Set(rows.flatMap((r) => r.cells.map((c) => c.fleetId)));
    const seen = new Set<string>();
    const items = [...data.fleets]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .filter((f) => present.has(f.id) && !seen.has(f.name) && seen.add(f.name))
      .map((f) => `<span style="white-space:nowrap">${fleetDot(colors, f.id)}${esc(f.name)}</span>`);
    return items.length
      ? `<p class="sfnote sflegend">Race cells are marked with the fleet the race was sailed in: ${items.join(' &nbsp; ')}<br>The first three places in each fleet's race are marked in the medal colours instead.</p>`
      : '';
  };

  // Once the medal fleet exists it gets its own table, first. It is a real
  // fleet with its own membership and score base, its boats sail races no
  // other boat can hold a column in (and never sail the companion race the
  // others do), and at that stage of a championship the public focus is
  // entirely on them — not on finding them sorted inside a table of 47.
  // The heading comes from the vocabulary, not the fleet's name: the name
  // already reads "Medal races" or "Final series", and "{name} fleet" is
  // only right by luck.
  const medalRows = rows.filter((r) => r.medal);
  const medalSection = medalRows.length
    ? `<h2>${esc(capitaliseStage(vocab.stages.medal.fleetNoun))}</h2>\n${table(medalRows)}\n<p class="sfnote">These boats are ranked ahead of every other boat in the event.</p>`
    : '';

  // The note under the fleet the medal boats came from: they have not left
  // it — the fleet's assigned size still sets its score base — and where the
  // SIs give the boats who missed the cut one more race scored from below
  // the medal places, say why its winner did not score 1.
  const leftForMedalNote = (fid: string): string => {
    const count = medalRows.filter((r) => r.finalFleetId === fid).length;
    if (!count) return '';
    const offsets = [
      ...new Map(
        data.raceStarts
          .filter(
            (s) =>
              s.stage === 'final' &&
              s.fleetIds.includes(fid) &&
              (s.firstPlaceOffset ?? 0) > 0 &&
              s.stageRaceNumber != null,
          )
          .map((s) => [s.stageRaceNumber!, s.firstPlaceOffset!] as const),
      ).entries(),
    ].sort(([a], [b]) => a - b);
    const offsetText = offsets
      .map(([n, off]) => `${columnLabel('final', n)} is scored from ${off + 1} because they are scored above it`)
      .join('; ');
    return `\n<p class="sfnote">The ${count} boats sailing the ${esc(vocab.stages.medal.name)} remain assigned to this fleet${offsetText ? `; ${esc(offsetText)}` : ''}.</p>`;
  };

  let sections: string;
  if (splitRound) {
    sections = [
      medalSection,
      ...splitRound.fleetIds.map((fid) => {
        const fleetRows = rows.filter((r) => r.finalFleetId === fid && !r.medal);
        return fleetRows.length
          ? `<h2>${esc(fleetName.get(fid) ?? '')} fleet</h2>\n${table(fleetRows)}${leftForMedalNote(fid)}`
          : '';
      }),
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    const rest = rows.filter((r) => !r.medal);
    const cuts = provisionalCutIndexes(rest.length, data.config.finalFleets.length);
    sections = [
      medalSection,
      rest.length
        ? table(rest, !medalRows.length && data.config.finalFleets.length > 1 ? cuts : [], true)
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const raceLink = opts.raceResultsHref
    ? `<p class="sfnote"><a href="${esc(opts.raceResultsHref)}">Race results</a> — each race&#39;s own tables, fleet by fleet.</p>`
    : '';

  return renderHtmlDocument(
    { ...chromeFor(input, opts), fleetName: 'Championship' },
    `${PAGE_CSS}\n${raceLink}\n${legendHtml()}\n${sections}\n${formatDetails(input.config)}`,
    {
      fontPercent: 72,
      hasNhcDetail: false,
      hasEchoDetail: false,
      flagDefs: nat ? flagDefsFor(input) : '',
    },
  );
}

/** Anchor id for one stage race on the per-race results page. Structural
 *  (`q3`, `f1`, `m1`), never rendered as text — so deep links survive a
 *  vocabulary change, which renames every visible label. */
export function stageRaceAnchor(stage: SeriesStage, n: number): string {
  return `${stage[0]}${n}`;
}


/** The per-race results page: every stage race in sailed order, one table per
 *  race per fleet — the fleets a start sequence interleaves pulled apart the
 *  way the racing actually happened, each ranked within its own fleet. Points
 *  come from the standings engine's cells, so redress, penalties, the medal
 *  multiplier and any first-place offset are already applied.
 *
 *  Returns null while no stage race has sheet rows — nothing to page yet. */
/**
 * A race's own record as the two centred lines an ordinary race table carries
 * (#338/#339): what it was sailed in, then who ran it. Same classes and same
 * wording, so a championship's race page reads like every other results page.
 *
 * Conditions describe the racing, so they publish unconditionally; the team
 * are named non-competitors and appear only where the caller says they may.
 */
function raceRecordLines(race: Race | undefined, publishOfficials: boolean): string {
  if (!race) return '';
  const line = (cls: string, text: string) =>
    `<p class="${cls}" style="text-align:center; margin: 0 0 6px 0; font-size: 0.9em;">${esc(text)}</p>\n`;
  return [
    hasConditions(race.conditions) ? line('raceconditions', formatConditions(race.conditions)) : '',
    publishOfficials && hasOfficials(race.officials)
      ? line('raceofficials', formatOfficials(race.officials))
      : '',
  ].join('');
}

export function renderSplitFleetRaceResultsPage(
  input: SplitFleetRenderInput,
  opts: SplitFleetPageChrome = {},
): string | null {
  const data = assembleSplitFleetData(input);
  const rows = splitFleetStandings(data);
  const fleetName = new Map(data.fleets.map((f) => [f.id, f.name]));
  const colors = fleetColorById(data);
  const nat = showNat(input);
  const wsid = showWsid(input);

  // Each row's cell for one (stage race, fleet), joined back to its
  // competitor. Carried cells have no race id: they are scores, not races.
  const entriesByRaceFleet = new Map<string, { competitor: Competitor; cell: CellScore }[]>();
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!cell.raceId) continue;
      const key = `${cell.stage} ${cell.stageRaceNumber} ${cell.fleetId}`;
      let list = entriesByRaceFleet.get(key);
      if (!list) entriesByRaceFleet.set(key, (list = []));
      list.push({ competitor: row.competitor, cell });
    }
  }

  // Per-race tables list only boats with a row on the race's sheet — a
  // crossing or a code. An implicit DNC scores in the standings but has no
  // place on the race's own page, same as an ordinary series' race tables.
  const sheetKey = (raceId: string, competitorId: string) => `${raceId} ${competitorId}`;
  const onSheet = new Set<string>();
  const crossingOrder = new Map<string, number>();
  const finishByKey = new Map<string, Finish>();
  for (const f of data.finishes) {
    if (!f.competitorId) continue;
    if (f.sortOrder === null && f.resultCode === null) continue;
    onSheet.add(sheetKey(f.raceId, f.competitorId));
    finishByKey.set(sheetKey(f.raceId, f.competitorId), f);
    if (f.sortOrder !== null && !f.resultCode) {
      crossingOrder.set(sheetKey(f.raceId, f.competitorId), f.sortOrder);
    }
  }

  // Each fleet's gun, so a sheet kept off the clock can have its elapsed
  // times worked out. Per fleet and not per race: Gold and Silver sailing the
  // same race start at their own times. A membership-only start has no gun
  // and leaves its fleet with crossing times alone.
  const gunByRaceFleet = new Map<string, number>();
  for (const start of data.raceStarts) {
    const secs = parseHmsToSeconds(start.startTime);
    if (secs === null) continue;
    for (const fleetId of start.fleetIds) {
      gunByRaceFleet.set(`${start.raceId} ${fleetId}`, secs);
    }
  }

  const fleetTable = (entries: { competitor: Competitor; cell: CellScore }[]): string => {
    // Scored order: finishers by points (crossing order between equals), then
    // the coded boats, worst score last, sail number between equals.
    const sorted = entries
      .filter(({ competitor, cell }) => onSheet.has(sheetKey(cell.raceId, competitor.id)))
      .sort((a, b) => {
        const ca = crossingOrder.get(sheetKey(a.cell.raceId, a.competitor.id));
        const cb = crossingOrder.get(sheetKey(b.cell.raceId, b.competitor.id));
        if ((ca !== undefined) !== (cb !== undefined)) return ca !== undefined ? -1 : 1;
        if (a.cell.points !== b.cell.points) return a.cell.points - b.cell.points;
        return ca !== undefined && cb !== undefined
          ? ca - cb
          : bySailNumber(a.competitor, b.competitor);
      });
    if (sorted.length === 0) return '';
    // What each boat's row may show. Times ride on the finish row and are
    // ordinarily publishable; RaceSense's own record — and the times of the
    // boats it measured — reach the page only where the series publishes
    // them, which is decided per boat.
    const shown = new Map<string, ReturnType<typeof publishedCell>>();
    for (const { competitor, cell } of sorted) {
      const key = sheetKey(cell.raceId, competitor.id);
      shown.set(key, publishedCell(
        finishByKey.get(key),
        gunByRaceFleet.get(`${cell.raceId} ${cell.fleetId}`) ?? null,
        { publishTrackData: input.showTrackData === true },
      ));
    }
    // A column appears only when some boat in this table has the value: a
    // race with no line recorded gets no DTL column at all, and one whose
    // times are all withheld gets no time columns.
    const trackColumns = TRACK_DATA_COLUMNS.filter((col) =>
      sorted.some(({ competitor, cell }) =>
        col.value(shown.get(sheetKey(cell.raceId, competitor.id))) !== ''),
    );
    let place = 0;
    const body = sorted
      .map(({ competitor, cell }, i) => {
        const finisher = crossingOrder.has(sheetKey(cell.raceId, competitor.id));
        const finish = shown.get(sheetKey(cell.raceId, competitor.id));
        const helm = esc(competitor.names.join(' & '));
        const helmHtml =
          !wsid && competitor.worldSailingId
            ? `<a href="${esc(worldSailingProfileUrl(competitor.worldSailingId))}" target="_blank" rel="noopener noreferrer">${helm}</a>`
            : helm;
        return `<tr class="${i % 2 === 0 ? 'odd' : 'even'}">
  <td style="text-align:center">${finisher ? ++place : ''}</td>
  ${nat ? natCell(competitor.nationality, input.flagSvgByCode) : ''}
  <td style="font-family:monospace">${esc(competitor.sailNumber)}</td>
  <td>${helmHtml}</td>
  ${wsid ? wsidCell(competitor.worldSailingId) : ''}
  <td style="text-align:center">${esc(cell.code ?? '')}</td>
  <td style="text-align:right">${cell.points}</td>
${trackColumns.map((col) => `  <td style="text-align:right">${esc(col.value(finish))}</td>`).join('\n')}
</tr>`;
      })
      .join('\n');
    const trackHeaders = trackColumns
      .map((col) => `<th${col.title ? ` title="${esc(col.title)}"` : ''}>${esc(col.header)}</th>`)
      .join('');
    return `<div class="tablewrap"><table class="summarytable">
<thead><tr><th>Rank</th>${nat ? '<th>Nat</th>' : ''}<th>Sail</th><th>Helm</th>${wsid ? '<th>WS ID</th>' : ''}<th>Code</th><th>Points</th>${trackHeaders}</tr></thead>
<tbody>
${body}
</tbody>
</table></div>`;
  };

  const sections: string[] = [];
  for (const stage of STAGES) {
    for (const lr of logicalRaces(data, stage)) {
      // No covering round means the engine scored nothing for the race, so
      // there are no cells to page (same guard as the standings pass).
      if (!lr.round) continue;
      // A stage race need not be one race on the water: Gold and Silver can
      // sail their own, each with its own wind and its own team. One record
      // under the heading when they shared a race, one per fleet when they
      // did not — never the same line repeated under every fleet.
      const raceForFleet = (fid: string) => lr.races.get(fid)?.race;
      const sharedRace =
        new Set(lr.round.fleetIds.map((fid) => raceForFleet(fid)?.id).filter(Boolean)).size === 1;
      const sharedRecord = sharedRace
        ? raceRecordLines(raceForFleet(lr.round.fleetIds[0]), !!input.publishOfficials)
        : '';
      const tables = lr.round.fleetIds
        .map((fid) => {
          const entries =
            entriesByRaceFleet.get(`${stage} ${lr.stageRaceNumber} ${fid}`) ?? [];
          const table = fleetTable(entries);
          if (!table) return '';
          const label = fleetName.get(fid) ?? '';
          const record = sharedRace
            ? ''
            : raceRecordLines(raceForFleet(fid), !!input.publishOfficials);
          return `<h3>${fleetDot(colors, fid)}${esc(label)} fleet</h3>\n${record}${table}`;
        })
        .filter(Boolean);
      if (tables.length === 0) continue;
      // The standings page dims a race the championship score can't yet use;
      // the race's own results still stand, so here it is a note, not a veil.
      const note =
        stage === 'qualifying' && !lr.valid
          ? '<p class="sfnote">Does not yet count — race incomplete across fleets.</p>\n'
          : '';
      sections.push(
        `<h2 id="${stageRaceAnchor(stage, lr.stageRaceNumber)}">${esc(
          stageRaceLabel(data.config, stage, lr.stageRaceNumber),
        )}</h2>\n${sharedRecord}${note}${tables.join('\n')}`,
      );
    }
  }
  if (sections.length === 0) return null;

  return renderHtmlDocument(
    { ...chromeFor(input, opts), fleetName: 'Race results' },
    `${PAGE_CSS}\n${sections.join('\n')}`,
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
  const colors = fleetColorById(data);
  const nat = showNat(input);
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
      // The hand-placement footnote only earns its place when the committee
      // actually moved someone; each moved boat carries the marker on her row.
      const anyOverride = round.fleetIds.some((fid) =>
        data.competitors.some(
          (c) => c.fleetIds.includes(fid) && round.overrides?.[c.id] === fid,
        ),
      );
      // One table per fleet, side by side, each in nationality order \u2014 the
      // shape the ILCA 7 Men's Worlds organising authority posts on the
      // official notice board. Side by side rather than stacked, so a whole
      // round fits one printed page and within your fleet you scan for your
      // own country. Each block is tinted in its fleet's colour, with the
      // fleet named in the header band as well, so the page survives mono
      // printing and readers who cannot separate the tints.
      const cols = nat ? 3 : 2;
      const fleets = round.fleetIds
        .map((fid) => {
          const label = fleetName.get(fid) ?? '';
          const members = data.competitors
            .filter((c) => c.fleetIds.includes(fid))
            .sort(
              (a, b) =>
                // Nationality, then sail number. A boat with no nationality
                // sorts last rather than leading the list.
                (a.nationality || '\uffff').localeCompare(b.nationality || '\uffff') ||
                bySailNumber(a, b),
            );
          const rowsHtml = members
            .map(
              (c) =>
                `<tr style="background:${fleetTint(colors, fid, '1f')}">${
                  nat ? natCell(c.nationality, input.flagSvgByCode) : ''
                }<td style="font-family:monospace">${esc(c.sailNumber)}</td><td>${esc(
                  c.names.join(' & '),
                )}${
                  round.overrides?.[c.id] === fid
                    ? '<span class="override-marker" title="Placed by the committee">*</span>'
                    : ''
                }</td></tr>`,
            )
            .join('\n');
          return `<div class="tablewrap"><table class="summarytable"><thead><tr><th colspan="${cols}" class="sffleethead" style="background:${fleetTint(
            colors,
            fid,
            '55',
          )}">${esc(label)} (${members.length})</th></tr><tr>${
            nat ? '<th>Nat</th>' : ''
          }<th>Sail</th><th>Helm</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
        })
        .join('\n');
      const basis = round.basis
        ? `From the ranking after ${stageRaceLabel(data.config, round.stage === 'final' ? 'qualifying' : round.stage, round.basis.throughStageRace)}, captured ${new Date(round.basis.capturedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.`
        : round.method === 'seeded'
          ? 'Initial seeding.'
          : round.method === 'manual'
            ? 'Initial assignment as supplied by the organising authority.'
            : '';
      return `<section class="sfround">
<h2>${esc(roundLabel(round))}</h2>
${basis ? `<p class="sfnote">${esc(basis)}</p>` : ''}
<div class="sffleets">${fleets}</div>
${anyOverride ? '<p class="sfnote">* placed by the committee</p>' : ''}
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
