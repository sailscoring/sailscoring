// Published-page rendering for split-fleet series (#328): the championship
// standings page (combined qualifying table before the split, tiered
// Gold/Silver/... tables after, fleet-tinted race cells, provisional cut
// line), the per-race results page (every stage race, one table per fleet),
// and the rolling fleet-assignments page (latest stage first). Plain
// HTML strings, no React — mirrors lib/results-renderer.ts conventions.

import type { NationalFlag } from './nationality/types';
import type {
  Competitor,
  CompetitorFieldKey,
  DnfScoring,
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
import { CHAMPIONSHIP_PAGE, SCORING_NOTES_PAGE } from './publish-pages';
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
  cutFromStandings,
  directSeatsPerFleet,
  fleetColorById,
  logicalRaces,
  medalStageStandsAlone,
  provisionalCutIndexes,
  ranksEachFleet,
  REPECHAGE_WORDS,
  repechageTableRows,
  resolveVocabulary,
  roundsForStage,
  splitFleetStandings,
  stageRaceLabel,
  STORED_STAGES,
  type CellScore,
  type StoredStage,
  type RenderSplitRound,
  type SplitFleetConfig,
  type SplitRound,
} from './split-fleets';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STAGE_ORDER: Record<StoredStage, number> = { qualifying: 0, final: 1, repechage: 2, medal: 3 };

export interface SplitFleetRenderInput {
  seriesName: string;
  config: SplitFleetConfig;
  rounds: RenderSplitRound[];
  fleets: Fleet[];
  competitors: Competitor[];
  races: Race[];
  raceStarts: RaceStart[];
  finishes: Finish[];
  /** The series' non-finisher rule (see `SplitFleetData.dnfScoring`). */
  dnfScoring?: DnfScoring;
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
.sfdot { display: inline-block; min-width: 1.4em; padding: 0 0.25em; box-sizing: border-box; line-height: 1.35em; border-radius: 0.7em; border: 1px solid rgba(0,0,0,0.25); margin-right: 0.3em; font-size: 0.75em; font-weight: 600; text-align: center; vertical-align: 0.1em; }
.sfnotes { max-width: 46em; margin: 0 auto; text-align: left; }
.sfnotes h3 { color: #073358; }
.sfnotes ol { line-height: 1.5; }
.sfnotes p { text-align: left; }
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
function formatDetails(
  config: SplitFleetConfig,
  rounds: readonly { stage: string }[],
  dnfScoring: DnfScoring | undefined,
): string {
  return `<details class="sfformat"><summary>${FORMAT_HEADING}</summary>\n${formatList(config, rounds, dnfScoring)}</details>`;
}

const FORMAT_HEADING = 'How this championship is scored';

function formatList(
  config: SplitFleetConfig,
  rounds: readonly { stage: string }[],
  dnfScoring: DnfScoring | undefined,
): string {
  const lines = describeSplitFleetConfig(config, {
    repechage: rounds.some((r) => r.stage === 'repechage'),
    dnfScoring,
  })
    .map((line) => `<li>${esc(line.text)}</li>`)
    .join('\n');
  return `<ol>${lines}</ol>`;
}

/** Whether a competitor's own number earns a column. Where boats are drawn
 *  for each fleet it is only an entry number — the sail number a reader
 *  knows a boat by is the one drawn for her, which changes fleet by fleet —
 *  so it means nothing to anyone reading the results. */
function showOwnNumber(config: SplitFleetConfig): boolean {
  return !config.boatAssignments;
}

/** A fleet's name as a heading: "Gold fleet", but "Fleet 1" rather than
 *  "Fleet 1 fleet", and "Flight 2" rather than "Flight 2 fleet". */
export function fleetHeading(name: string): string {
  return /\b(fleet|flight)\b/i.test(name) ? name : `${name} fleet`;
}

/** The heading over the medal fleet's table. The stage's fleet noun, unless
 *  that is only the stage's own name with "fleet" added — "Final series",
 *  not "Final series fleet" — where the name says it better. */
function medalHeading(config: SplitFleetConfig): string {
  const { name, fleetNoun } = resolveVocabulary(config).stages.medal;
  return capitaliseStage(fleetNoun.toLowerCase() === `${name} fleet`.toLowerCase() ? name : fleetNoun);
}

/** The sail number a boat carries in a fleet: the boat drawn for her there,
 *  or her own. */
function boatIn(competitor: Competitor, fleetId: string | undefined): string {
  return (fleetId && competitor.fleetSailNumbers?.[fleetId]?.trim()) || competitor.sailNumber;
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
   *  race column header into a deep link. */
  raceResultsHref?: string;
  /** The Scoring notes page's URL relative to this page, on the same terms.
   *  Where it is known, the standings link to it instead of carrying the
   *  format themselves, and every page leaves the data links to it. */
  scoringNotesHref?: string;
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
    ...(opts.scoringNotesHref ? { omitFooterDataLinks: true } : {}),
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

/** The fleet marker: the fleet's short name on its colour, bordered so pale
 *  fleets hold up. The letters carry the fleet on their own — a reader who
 *  cannot tell the colours apart, or a fleet with no colour, loses nothing. */
function fleetChip(colors: FleetColors, fleetId: string, abbrev: string): string {
  const six = fleetColorHex(colors, fleetId);
  const background = six ?? '#e9ecef';
  const ink = six && isDark(six) ? '#ffffff' : '#1a1a1a';
  return `<span class="sfdot" style="background:${background};color:${ink}">${esc(abbrev)}</span>`;
}

/** Whether white text reads better than black on a colour (WCAG relative
 *  luminance against the midpoint contrast). */
function isDark(six: string): boolean {
  const channel = (i: number) => {
    const c = parseInt(six.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return l < 0.179;
}

/**
 * Short names for fleets, each distinct from the rest: the initials of the
 * name's words, a number kept whole — "Y", "B", "F1", "MR" — and where two
 * names still collide ("Blue", "Black") more of the first word, until they
 * differ. Keyed by name: a round-2 "Yellow" is its own fleet, but it reads
 * as the same fleet and takes the same letters.
 */
export function fleetAbbreviations(names: readonly string[]): Map<string, string> {
  const unique = [...new Set(names)];
  const words = (name: string) => name.trim().split(/\s+/).filter(Boolean);
  const abbrev = (name: string, n: number) =>
    words(name)
      .map((w, i) => (/^\d+$/.test(w) ? w : (i === 0 ? w.slice(0, n) : w[0]).replace(/^./, (c) => c.toUpperCase())))
      .join('');
  // Only the names that collide take more letters: "Gold" and "Green"
  // becoming "Go" and "Gr" leaves "Yellow" a plain "Y".
  const length = new Map(unique.map((name) => [name, 1]));
  const longest = Math.max(1, ...unique.map((n) => words(n)[0]?.length ?? 1));
  for (let round = 0; round < longest; round++) {
    const byAbbrev = new Map<string, string[]>();
    for (const name of unique) {
      const a = abbrev(name, length.get(name)!);
      byAbbrev.set(a, [...(byAbbrev.get(a) ?? []), name]);
    }
    const colliding = [...byAbbrev.values()].filter((names) => names.length > 1).flat();
    if (!colliding.length) break;
    for (const name of colliding) length.set(name, length.get(name)! + 1);
  }
  const out = new Map(unique.map((name) => [name, abbrev(name, length.get(name)!)]));
  return new Set(out.values()).size === unique.length ? out : new Map(unique.map((name) => [name, name]));
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
  // Every score is listed once. The repêchage's are in tables of their own;
  // where the medal races carry nothing, the medal boats' earlier scores
  // leave the championship table for the ranking they were cut from, which
  // then lists every boat.
  const repTables = repechageTableRows(data);
  const standsAlone = medalStageStandsAlone(data, rows);
  const cutRows = standsAlone ? cutFromStandings(data) : [];
  const fleetName = new Map(data.fleets.map((f) => [f.id, f.name]));
  const colors = fleetColorById(data);
  const abbrevs = fleetAbbreviations(data.fleets.map((f) => f.name));
  const chip = (fleetId: string) =>
    fleetChip(colors, fleetId, abbrevs.get(fleetName.get(fleetId) ?? '') ?? '');
  // The fleets whose chips some table actually shows — the key lists these.
  const chippedFleets = new Set<string>();
  const ownNumber = showOwnNumber(data.config);
  const splitRound = roundsForStage(data.rounds, 'final')[0] ?? null;
  const nat = showNat(input);
  const boatClass = showClass(input);
  const crew = showCrew(input);
  const club = showClub(input);
  const wsid = showWsid(input);
  const vocab = resolveVocabulary(data.config);
  const columnLabel = (stage: StoredStage, n: number) =>
    stageRaceLabel(data.config, stage, n);

  /** The race columns one table needs: those some boat in it has a cell for.
   *  Per table rather than per page — once a medal stage exists the page's
   *  full set carries the medal columns, which no boat outside the medal
   *  fleet can ever hold a cell in, and every other fleet's table would
   *  carry them as dead width. The rule generalises: a stage race a whole
   *  fleet never sailed drops out of that fleet's table the same way. */
  const columnsFor = (rowsIn: typeof rows) => {
    const colKeys = new Map<string, { stage: StoredStage; n: number }>();
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
    for (const row of [...(standsAlone ? [...rows.filter((r) => r.medal), ...cutRows] : rows), ...repTables.flatMap((t) => t.rows)]) {
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

  const cellHtml = (
    row: (typeof rows)[number],
    col: { stage: StoredStage; n: number },
    marked: boolean,
  ): string => {
    const c = row.cells.find((x: CellScore) => x.stage === col.stage && x.stageRaceNumber === col.n);
    if (!c) return '<td></td>';
    const fleet = fleetName.get(c.fleetId);
    // A podium cell takes the gold/silver/bronze every other published page
    // marks a race win in, over its fleet tint — the chip and the tooltip
    // still say which fleet the race was sailed in. A discarded score keeps
    // the tint instead: a discard loses the medal here as it does on an
    // ordinary standings table, and a score that does not yet count has not
    // won anything yet either.
    const podium =
      c.counts && !c.discarded
        ? podiumRanks.get(`${raceKey(c)}\u0000${row.competitor.id}`)
        : undefined;
    // Only a column whose boats sailed in different fleets marks them, and
    // only where no Fleet column already says which (see `table`).
    if (marked) chippedFleets.add(c.fleetId);
    const tint = !c.counts ? '#f8f9fa' : marked ? fleetTint(colors, c.fleetId) : null;
    const text = `${c.points}${c.code ? ` ${c.code}` : ''}`;
    const inner = c.discarded ? `(${esc(text)})` : esc(text);
    const dim = c.counts ? '' : ';color:#adb5bd';
    const bold = c.discardable ? '' : ';font-weight:bold';
    const into = c.stage === 'final' ? vocab.stages.final : vocab.stages.medal;
    const note = c.counts
      ? c.carriedTransform
        ? `score carried into the ${into.name}`
        : ''
      : c.carriedTransform
        ? `score carried into the ${into.name} — counts once a ${into.raceNoun} is completed`
        : c.superseded
          ? 'replaced by the carried score'
          : 'does not yet count — race incomplete across fleets';
    const titleText = [fleet ? fleetHeading(fleet) : '', note].filter(Boolean).join(' — ');
    const title = titleText ? ` title="${esc(titleText)}"` : '';
    const podiumClass = podium ? ` class="rank${podium}"` : '';
    const background = podium || !tint ? '' : `background:${tint};`;
    return `<td${podiumClass} style="${background}text-align:center${dim}${bold}"${title}>${marked ? chip(c.fleetId) : ''}${inner}</td>`;
  };

  // The combined qualifying table carries a Fleet column with the current
  // round's assignment — after the split the per-fleet section headings say
  // it instead. `null` = no column.
  // The repêchage is not an assignment of the championship's fleets, so it
  // never supplies this column.
  // The latest round the boat was assigned in — not simply the latest
  // round, which after the medal fleet is chosen holds none of the boats
  // left out of it.
  const fleetOf = (row: (typeof rows)[number]): string | undefined => {
    for (const round of [...data.rounds]
      .filter((r) => r.stage !== 'repechage')
      .sort((a, b) => b.createdAt - a.createdAt)) {
      const fid = round.fleetIds.find((f) => row.competitor.fleetIds.includes(f));
      if (fid) return fid;
    }
    return undefined;
  };
  // In the ranking the medal fleet was cut from, the fleet a boat sailed
  // that stage in — its qualifying flight, where there is more than one.
  const lastQualifying = roundsForStage(data.rounds, 'qualifying').at(-1);
  const qualifyingFleetOf = (row: (typeof rows)[number]): string | undefined =>
    lastQualifying?.fleetIds.find((f) => row.competitor.fleetIds.includes(f));

  // With the race page's location known, each race column header deep-links
  // to that race's own tables. A carried-score column (stage race 0) is a
  // score, not a race: no section exists for it, so no link.
  const headerCell = (c: { stage: StoredStage; n: number }): string => {
    const label = columnLabel(c.stage, c.n);
    return opts.raceResultsHref && c.n > 0
      ? `<th><a href="${esc(opts.raceResultsHref)}#${stageRaceAnchor(c.stage, c.n)}">${label}</a></th>`
      : `<th>${label}</th>`;
  };

  const table = (
    rowsIn: typeof rows,
    cuts: number[] = [],
    withFleetCol = false,
    cutLabel = `provisional split if the ${vocab.stages.qualifying.name} ended now`,
    /** Only these stages' columns: the medal races alone, where nothing is
     *  carried into them. */
    onlyStages?: StoredStage[],
    fleetColumn: (row: (typeof rows)[number]) => string | undefined = fleetOf,
  ): string => {
    const columns = columnsFor(rowsIn).filter((c) => !onlyStages || onlyStages.includes(c.stage));
    const head = columns.map(headerCell).join('');
    // A Fleet column that would say the same thing on every row says nothing.
    const fleetCol =
      withFleetCol &&
      new Set(rowsIn.map((r) => fleetColumn(r)).filter((f): f is string => !!f)).size > 1;
    // Cells are marked only where nothing else says which fleet a race was
    // sailed in. A column every boat sailed in one fleet is said by the
    // heading; a column that mixes fleets is said by the Fleet column, so
    // long as each boat sailed all of them in the fleet it names. Otherwise
    // — a boat reassigned between races, or a table after the split holding
    // the fleets its boats qualified in — every cell carries its fleet.
    const inCol = (r: (typeof rows)[number], col: { stage: StoredStage; n: number }) =>
      r.cells.filter((c) => c.stage === col.stage && c.stageRaceNumber === col.n);
    const mixedColumns = columns.filter(
      (col) => new Set(rowsIn.flatMap((r) => inCol(r, col).map((c) => c.fleetId))).size > 1,
    );
    // Where marking is needed it is needed only in the mixed columns: a
    // column of one fleet is still said by the heading.
    const marksMixed =
      mixedColumns.length > 0 &&
      (!fleetCol ||
        rowsIn.some((r) => {
          const sailed = new Set(mixedColumns.flatMap((col) => inCol(r, col).map((c) => c.fleetId)));
          return sailed.size > 1 || (sailed.size === 1 && !sailed.has(fleetColumn(r) ?? ''));
        }));
    const body = rowsIn
      .map((row, i) => {
        const fleetId = fleetCol ? fleetColumn(row) : undefined;
        // No WS ID column on the table → the name carries the bio link
        // instead, so the profile is still one click away.
        const helmHtml =
          renderHelmCell(
            row.competitor.names,
            row.competitor.crewNames,
            crew,
            !wsid && row.competitor.worldSailingId
              ? worldSailingProfileUrl(row.competitor.worldSailingId)
              : undefined,
          ) + promotedBadge(row);
        const tr = `<tr class="${i % 2 === 0 ? 'odd' : 'even'} summaryrow">
  <td>${row.rank}</td>
  ${fleetCol ? `<td style="white-space:nowrap">${esc((fleetId && fleetName.get(fleetId)) || '')}</td>` : ''}
  ${nat ? natCell(row.competitor.nationality, input.flagSvgByCode) : ''}
  ${ownNumber ? `<td style="font-family:monospace">${esc(row.competitor.sailNumber)}</td>` : ''}
  ${boatClass ? `<td>${esc(row.competitor.boatClass ?? '')}</td>` : ''}
  <td>${helmHtml}</td>
  ${club ? `<td>${renderListCell(row.competitor.clubs)}</td>` : ''}
  ${wsid ? wsidCell(row.competitor.worldSailingId) : ''}
  ${columns.map((c) => cellHtml(row, c, marksMixed && mixedColumns.includes(c))).join('\n  ')}
  <td style="text-align:right">${row.total}</td>
  <td style="text-align:right;font-weight:bold">${row.net}</td>
</tr>`;
        // A shared rank across the line means the ranking does not place the
        // cut — say so rather than letting the line silently resolve the tie.
        const tiedAcrossCut = cuts.includes(i) && rowsIn[i + 1]?.rank === row.rank;
        const cut = cuts.includes(i)
          ? `<tr><td colspan="${columns.length + 4 + (ownNumber ? 1 : 0) + (fleetCol ? 1 : 0) + (nat ? 1 : 0) + (boatClass ? 1 : 0) + (club ? 1 : 0) + (wsid ? 1 : 0)}" style="border:none;padding:0"><div style="border-top:2px dashed #f59e0b;text-align:center;font-size:0.75em;color:#b45309;text-transform:uppercase">${esc(cutLabel)}${tiedAcrossCut ? ' — the boats either side are tied; the ranking does not decide this cut' : ''}</div></td></tr>`
          : '';
        return tr + cut;
      })
      .join('\n');
    return `<div class="tablewrap"><table class="summarytable">
<thead><tr><th>Rank</th>${fleetCol ? '<th>Fleet</th>' : ''}${nat ? '<th>Nat</th>' : ''}${ownNumber ? '<th>Sail</th>' : ''}${boatClass ? '<th>Class</th>' : ''}<th>${crew ? 'Helm / Crew' : 'Helm'}</th>${club ? '<th>Club</th>' : ''}${wsid ? '<th>WS ID</th>' : ''}${head}<th>Total</th><th>Nett</th></tr></thead>
<tbody>
${body}
</tbody>
</table></div>`;
  };

  /** Where a repêchage boat went: her row in the repêchage says she was
   *  promoted. Her row in the medal fleet says nothing — once there, she is
   *  one of its boats like any other. */
  const promotedBadge = (row: (typeof rows)[number]): string =>
    row.promotedVia && !row.medal
      ? ` <span class="sfnote">&rarr; ${esc(medalHeading(data.config))}</span>`
      : '';

  // One chip + name per fleet some table marks its cells with, in fleet
  // order. Deduped by name, as the chips are. None when no table mixes
  // fleets in a race column — the headings have said it all.
  const legendHtml = (): string => {
    const seen = new Set<string>();
    const items = [...data.fleets]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .filter((f) => chippedFleets.has(f.id) && !seen.has(f.name) && seen.add(f.name))
      .map((f) => `<span style="white-space:nowrap">${chip(f.id)}${esc(f.name)}</span>`);
    return items.length
      ? `<p class="sfnote sflegend">Fleet each race was sailed in: ${items.join(' &nbsp; ')}</p>`
      : '';
  };

  // Once the medal fleet exists it gets its own table, first. It is a real
  // fleet with its own membership and score base, its boats sail races no
  // other boat can hold a column in (and never sail the companion race the
  // others do), and at that stage of a championship the public focus is
  // entirely on them — not on finding them sorted inside a table of 47.
  // The heading comes from the vocabulary, not the fleet's name: the name
  // already reads "Medal races" or "Final series", and "{name} fleet" is
  // only right by luck. Its place at the top says it ranks ahead of the rest;
  // what it carries in is the Scoring notes' business.
  const medalRows = rows.filter((r) => r.medal);
  const medalSection = medalRows.length
    ? `<h2>${esc(medalHeading(data.config))}</h2>\n${
        standsAlone ? table(medalRows, [], false, undefined, ['medal']) : table(medalRows)
      }`
    : '';
  // The heading over the boats below the medal fleet, where there is one to
  // set them apart from.
  const restHeading = (stageName: string) =>
    medalRows.length ? `<h2>${esc(capitaliseStage(stageName))}</h2>` : '';

  // The repêchage, between the medal fleet and the rest: one table per
  // repêchage fleet, listing every boat that sailed it — a promoted boat's
  // repêchage scores are in no other table.
  const repechageSection = repTables
    .filter((t) => t.rows.length > 0)
    .map((t, _i, all) => {
      const heading =
        all.length > 1
          ? `${capitaliseStage(REPECHAGE_WORDS.name)} · ${fleetName.get(t.fleetId) ?? ''}`
          : capitaliseStage(REPECHAGE_WORDS.name);
      return `<h2>${esc(heading)}</h2>\n${table(t.rows)}`;
    })
    .join('\n');

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

  // Where the medal fleet will be cut if racing ended now, while it has yet to
  // be selected: off the top fleet once the split is committed, and off the
  // whole ranking where the fleet is never divided. A championship with no
  // medal stage has no cut to draw.
  const medalSize = data.config.medal?.size ?? Infinity;
  const medalCut = (stageName: string) => `${vocab.stages.medal.fleetNoun} cut if the ${stageName} ended now`;

  // Where each fleet is ranked on its own: one table per fleet, each ranked
  // from 1, and before the medal fleet is selected, each fleet's own cut.
  const perFleet = ranksEachFleet(data.config);
  const seatsEach = directSeatsPerFleet(data.config);
  const perFleetSections = (rowsIn: typeof rows, withCut: boolean, level = 2): string[] =>
    (lastQualifying?.fleetIds ?? []).map((fid) => {
      const fleetRows = rowsIn.filter((r) => r.rankedInFleetId === fid);
      if (!fleetRows.length) return '';
      const cut = withCut && data.config.medal && fleetRows.length > seatsEach;
      return `<h${level}>${esc(fleetHeading(fleetName.get(fid) ?? ''))}</h${level}>\n${
        cut ? table(fleetRows, [seatsEach - 1], false, medalCut(vocab.stages.qualifying.name)) : table(fleetRows)
      }`;
    });

  let sections: string;
  if (perFleet) {
    sections = [
      medalSection,
      repechageSection,
      ...(standsAlone
        ? [
            restHeading(vocab.stages.qualifying.name),
            ...perFleetSections(cutRows, false, medalRows.length ? 3 : 2),
          ]
        : perFleetSections(
            rows.filter((r) => !r.medal),
            !medalRows.length,
          )),
    ]
      .filter(Boolean)
      .join('\n');
  } else if (standsAlone) {
    // Nothing carried: the ranking the medal fleet was cut from stands on
    // its own, every boat in it, below the medal fleet and the repêchage.
    const cutName = splitRound ? vocab.stages.final.name : vocab.stages.qualifying.name;
    sections = [
      medalSection,
      repechageSection,
      splitRound
        ? [
            restHeading(cutName),
            ...splitRound.fleetIds.map((fid) => {
              const fleetRows = cutRows.filter((r) => r.finalFleetId === fid);
              const h = medalRows.length ? 'h3' : 'h2';
              return fleetRows.length ? `<${h}>${esc(fleetHeading(fleetName.get(fid) ?? ''))}</${h}>\n${table(fleetRows)}` : '';
            }),
          ]
            .filter(Boolean)
            .join('\n')
        : `<h2>${esc(capitaliseStage(cutName))}</h2>\n${table(
            cutRows,
            [],
            (lastQualifying?.fleetIds.length ?? 0) > 1,
            undefined,
            undefined,
            qualifyingFleetOf,
          )}`,
    ]
      .filter(Boolean)
      .join('\n');
  } else if (splitRound) {
    sections = [
      medalSection,
      repechageSection,
      ...splitRound.fleetIds.map((fid, fleetIndex) => {
        const fleetRows = rows.filter((r) => r.finalFleetId === fid && !r.medal);
        const cut = !medalRows.length && fleetIndex === 0 && fleetRows.length > medalSize;
        return fleetRows.length
          ? `<h2>${esc(fleetHeading(fleetName.get(fid) ?? ''))}</h2>\n${
              cut
                ? table(fleetRows, [medalSize - 1], false, medalCut(vocab.stages.final.name))
                : table(fleetRows)
            }${leftForMedalNote(fid)}`
          : '';
      }),
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    const rest = rows.filter((r) => !r.medal);
    const undivided = data.config.split.kind === 'none';
    sections = [
      medalSection,
      repechageSection,
      rest.length ? restHeading(vocab.stages.qualifying.name) : '',
      !rest.length
        ? ''
        : undivided
          ? !medalRows.length && rest.length > medalSize
            ? table(rest, [medalSize - 1], true, medalCut(vocab.stages.qualifying.name))
            : table(rest, [], true)
          : table(
              rest,
              !medalRows.length && data.config.finalFleets.length > 1
                ? provisionalCutIndexes(rest.length, data.config.finalFleets.length)
                : [],
              true,
            ),
    ]
      .filter(Boolean)
      .join('\n');
  }

  // The format lives on the Scoring notes page wherever there is one to link
  // to; a page built without it (a preview, a download) keeps it folded at
  // the foot rather than lose it.
  const format = opts.scoringNotesHref
    ? ''
    : formatDetails(input.config, input.rounds, input.dnfScoring);

  return renderHtmlDocument(
    {
      ...chromeFor(input, opts),
      fleetName: CHAMPIONSHIP_PAGE,
      hidePageHeading: true,
      ...(opts.scoringNotesHref ? { scoringNotesUrl: opts.scoringNotesHref } : {}),
    },
    `${PAGE_CSS}\n${legendHtml()}\n${sections}\n${format}`,
    {
      fontPercent: 72,
      hasNhcDetail: false,
      hasEchoDetail: false,
      flagDefs: nat ? flagDefsFor(input) : '',
    },
  );
}

/**
 * The Scoring notes page: what a reader goes looking for once they have read
 * the standings — how the championship is scored, and the data behind the
 * results — kept off the standings so the tables can stand on their own.
 */
export function renderSplitFleetScoringNotesPage(
  input: SplitFleetRenderInput,
  opts: SplitFleetPageChrome = {},
): string {
  const dataLinks = [
    opts.openInAppUrl
      ? `<a href="${esc(opts.openInAppUrl)}" target="_top" rel="noopener">Open in Sail Scoring</a> to look through the series behind these results`
      : '',
    opts.dataFileUrl
      ? `<a href="${esc(opts.dataFileUrl)}" target="_top" rel="noopener">Data (.sailscoring.json)</a>, the same series as a file`
      : '',
  ].filter(Boolean);
  const data = dataLinks.length
    ? `<h3>The data behind these results</h3>\n<ul>\n${dataLinks.map((l) => `<li>${l}</li>`).join('\n')}\n</ul>`
    : '';
  return renderHtmlDocument(
    { ...chromeFor(input, opts), fleetName: SCORING_NOTES_PAGE, omitFooterDataLinks: true },
    `${PAGE_CSS}\n<div class="sfnotes">\n<h3>${FORMAT_HEADING}</h3>\n${formatList(input.config, input.rounds, input.dnfScoring)}\n${data}\n</div>`,
    {
      fontPercent: 72,
      hasNhcDetail: false,
      hasEchoDetail: false,
      flagDefs: '',
    },
  );
}

/** Anchor id for one stage race on the per-race results page. Structural
 *  (`q3`, `f1`, `m1`), never rendered as text — so deep links survive a
 *  vocabulary change, which renames every visible label. */
export function stageRaceAnchor(stage: StoredStage, n: number): string {
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
  const nat = showNat(input);
  const wsid = showWsid(input);

  // Each row's cell for one (stage race, fleet), joined back to its
  // competitor. Carried cells have no race id: they are scores, not races.
  const entriesByRaceFleet = new Map<string, { competitor: Competitor; cell: CellScore }[]>();
  for (const row of [...rows, ...repechageTableRows(data).flatMap((t) => t.rows)]) {
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
  <td style="font-family:monospace">${esc(boatIn(competitor, cell.fleetId))}</td>
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
  // In sailed order: the repêchage between the stage it was cut from and the
  // medal races.
  for (const stage of STORED_STAGES) {
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
          return `<h3>${esc(fleetHeading(label))}</h3>\n${record}${table}`;
        })
        .filter(Boolean);
      if (tables.length === 0) continue;
      // The standings page dims a race the championship score can't yet use;
      // the race's own results still stand, so here it is a note, not a veil.
      const note =
        stage === 'qualifying' && !lr.valid
          ? '<p class="sfnote">Does not yet count — race incomplete across fleets.</p>\n'
          : stage === 'repechage'
            ? `<p class="sfnote">A ${REPECHAGE_WORDS.raceNoun}: it counts for nothing in the championship.</p>\n`
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
    if (r.stage === 'medal') return medalHeading(data.config);
    if (r.stage === 'repechage') return capitaliseStage(REPECHAGE_WORDS.name);
    const idx = roundsForStage(data.rounds, 'qualifying').indexOf(r) + 1;
    return `${capitaliseStage(vocab.stages.qualifying.name)} round ${idx} (${stageRaceLabel(data.config, 'qualifying', r.fromStageRace)} onward)`;
  };

  // The latest stage first — the medal fleet, then the repêchage its last
  // seats came from, then the stages before — and within a stage the newest
  // round first. By stage rather than by when a round was committed: the
  // repêchage is committed after the medal fleet it feeds, but reads below it.
  const stageRank = (r: SplitRound) => STORED_STAGES.indexOf(r.stage);
  const sections = [...data.rounds]
    .sort((a, b) => stageRank(b) - stageRank(a) || b.createdAt - a.createdAt)
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
      const boats = data.config.boatAssignments === true;
      const ownNumber = showOwnNumber(data.config);
      const cols = (nat ? 2 : 1) + (ownNumber ? 1 : 0) + (boats ? 1 : 0);
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
                }${ownNumber ? `<td style="font-family:monospace">${esc(c.sailNumber)}</td>` : ''}<td>${esc(
                  c.names.join(' & '),
                )}${
                  round.overrides?.[c.id] === fid
                    ? '<span class="override-marker" title="Placed by the committee">*</span>'
                    : ''
                }</td>${
                  boats
                    ? `<td style="font-family:monospace">${esc(c.fleetSailNumbers?.[fid] ?? '')}</td>`
                    : ''
                }</tr>`,
            )
            .join('\n');
          return `<div class="tablewrap"><table class="summarytable"><thead><tr><th colspan="${cols}" class="sffleethead" style="background:${fleetTint(
            colors,
            fid,
            '55',
          )}">${esc(label)} (${members.length})</th></tr><tr>${
            nat ? '<th>Nat</th>' : ''
          }${ownNumber ? '<th>Sail</th>' : ''}<th>Helm</th>${
            boats ? '<th>Boat</th>' : ''
          }</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
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
