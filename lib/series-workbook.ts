/**
 * A whole series as a spreadsheet workbook, for working on the results
 * outside the app: pivot tables, charts, a club's own trophy sheet, a
 * handicap committee's review.
 *
 * Scorer-side and complete, like a `.sailscoring` file rather than the
 * public data file: every competitor field, every finish row as entered,
 * every scored result. One-way — nothing reads it back — so its columns are
 * documented on its About sheet but are not a format anything depends on.
 *
 * The scored columns (rating applied, elapsed and corrected times, points,
 * discards, the NHC and ECHO working) are read off the results the published
 * pages are built from, so every scoring system is scored here by the code
 * that already scores it and the workbook agrees with the pages. Which of
 * those the pages *show* is a publishing choice, so the series goes through
 * with those choices set to show everything (`withEverythingShown`).
 *
 * This module builds a plain model of sheets, columns and typed cells;
 * `series-workbook-xlsx` writes it out.
 */

import { buildFleetHtmlFiles } from './results-export';
import type { ExportRepos } from './public-export';
import type { ChampionshipRaceFleet, ChampionshipRow, ResultsSection } from './public-api/published-view';
import type { RaceResultData, SeriesResultsData, StandingRowData, RaceScoreData } from './results-renderer';
import { ratingToWin, timeToWinSecs } from './results-renderer';
import { loadSeriesSnapshot, type SeriesSnapshot } from './series-snapshot';
import { seriesSlug } from './series-name';
import { parseHmsToSeconds } from './time-parse';
import { ratingSystemLabel } from './competitor-ratings';
import { summarizeDiscards, summarizeSubSeriesDiscards } from './discard-rules';
import { discardRuleOf } from './scoring';
import { seriesCodeTable } from './scoring-codes';
import { scoringCodeNotes } from './scoring-codes-text';
import { pointsSystemNote } from './high-point';
import { officialRoleLabel } from './race-officials';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from './types';

// ---- The model ----

/** How a cell's value is shown. Durations and times of day are seconds,
 *  written as spreadsheet times so they add up and average; a date is an
 *  ISO `YYYY-MM-DD`. */
export type CellFormat = 'duration' | 'time' | 'date' | 'decimal1' | 'decimal3' | 'decimal4';

export interface WorkbookCell {
  value: string | number | boolean;
  format?: CellFormat;
  /** A discarded score: still a number, greyed so the table reads as the
   *  standings do. */
  muted?: boolean;
  bold?: boolean;
}

export type Cell = WorkbookCell | null;

export interface WorkbookColumn {
  header: string;
  /** In characters. */
  width?: number;
}

export interface WorkbookSheet {
  name: string;
  columns: WorkbookColumn[];
  rows: Cell[][];
  /** Columns kept in view while scrolling sideways: what names the row. */
  frozenColumns?: number;
  /** A key/value sheet with no header row (About). */
  noHeader?: boolean;
}

export interface SeriesWorkbook {
  fileName: string;
  sheets: WorkbookSheet[];
}

// ---- Cells ----

const text = (s: string | null | undefined): Cell => (s == null || s === '' ? null : { value: s });
const num = (n: number | null | undefined, format?: CellFormat): Cell =>
  n == null || !Number.isFinite(n) ? null : { value: n, ...(format ? { format } : {}) };
const bool = (b: boolean | null | undefined): Cell => (b == null ? null : { value: b });
const yes = (b: boolean | null | undefined): Cell => (b ? { value: true } : null);
const duration = (secs: number | null | undefined): Cell => num(secs, 'duration');
const timeOfDay = (hms: string | null | undefined): Cell => num(parseHmsToSeconds(hms ?? null), 'time');
const isoDate = (iso: string | null | undefined): Cell =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? { value: iso.slice(0, 10), format: 'date' } : text(iso);
const list = (xs: readonly string[] | null | undefined, sep = '; '): Cell =>
  text((xs ?? []).filter((x) => x && x.trim()).join(sep));

/** A column of a record table: its header, and its cell for one record. A
 *  column no record has a value in is dropped — this series doesn't use it —
 *  unless it is one of the columns that say what a row is. */
interface Col<T> {
  header: string;
  width?: number;
  keep?: boolean;
  cell: (item: T) => Cell;
}

function table<T>(name: string, cols: Col<T>[], items: readonly T[], frozenColumns?: number): WorkbookSheet {
  const cells = items.map((item) => cols.map((c) => c.cell(item)));
  const used = cols.map((c, i) => c.keep || cells.some((row) => row[i] !== null));
  const kept = cols.filter((_, i) => used[i]);
  return {
    name,
    columns: kept.map((c) => ({ header: c.header, ...(c.width ? { width: c.width } : {}) })),
    rows: cells.map((row) => row.filter((_, i) => used[i])),
    ...(frozenColumns
      ? { frozenColumns: cols.slice(0, frozenColumns).filter((_, i) => used[i]).length }
      : {}),
  };
}

// ---- Settings that only decide what a page shows ----

/**
 * The series as the export builds results from it: what was scored is
 * untouched, and every choice that only decides what a published page shows
 * is set to show everything — the automatic columns rather than the series'
 * own, the rating calculations and per-race ratings, track data, full race
 * detail, a page per fleet and no combined pages (each of which would only
 * repeat a fleet's own results). The flag set is left off the pages to
 * spare loading it: competitor fields are read off the competitors.
 */
export function withEverythingShown(series: Series): Series {
  return {
    ...series,
    resultsColumns: undefined,
    publishRatingCalculations: true,
    showPerRaceRatingsInSummary: true,
    publishTrackData: true,
    publishDetail: 'full',
    publishIndividualFleetPages: true,
    publishingGroups: [],
    includeJsonExport: false,
    enabledCompetitorFields: (series.enabledCompetitorFields ?? []).filter((f) => f !== 'nationality'),
  };
}

/** What the scoring produced, as the published pages are built from it. */
export interface ScoredResults {
  sections: ResultsSection[];
  championship?: {
    columns: Array<{ key: string; label: string; race: number | null }>;
    rows: ChampionshipRow[];
    races: ChampionshipRaceFleet[];
  };
}

async function scoreSeries(repos: ExportRepos, seriesId: string): Promise<ScoredResults> {
  // The repository may be a class instance, so the override sits on an
  // object whose prototype is the original rather than on a spread copy.
  const seriesRepo: ExportRepos['seriesRepo'] = Object.create(repos.seriesRepo, {
    get: {
      value: async (id: string) => {
        const s = await repos.seriesRepo.get(id);
        return s ? withEverythingShown(s) : s;
      },
    },
  });
  const shown: ExportRepos = { ...repos, seriesRepo };
  const build = await buildFleetHtmlFiles(shown, seriesId, undefined, { includeTrackData: true });
  const result: ScoredResults = { sections: [] };
  for (const file of build?.files ?? []) {
    const view = file.view;
    if (!view) continue;
    if (view.kind === 'results') result.sections.push(...view.sections);
    else if (view.kind === 'championship') {
      result.championship = { columns: view.columns, rows: view.rows, races: result.championship?.races ?? [] };
    } else if (view.kind === 'championship-races') {
      result.championship = {
        columns: result.championship?.columns ?? [],
        rows: result.championship?.rows ?? [],
        races: view.races,
      };
    }
  }
  return result;
}

/** Load, score and lay out a series as a workbook. Null when there is no
 *  such series. */
export async function buildSeriesWorkbook(
  repos: ExportRepos,
  seriesId: string,
  exportedAt: Date = new Date(),
): Promise<SeriesWorkbook | null> {
  const snapshot = await loadSeriesSnapshot(repos, seriesId);
  if (!snapshot) return null;
  const scored = await scoreSeries(repos, seriesId);
  return assembleSeriesWorkbook(snapshot, scored, exportedAt);
}

// ---- Layout ----

interface Lookups {
  competitorById: Map<string, Competitor>;
  fleetById: Map<string, Fleet>;
  fleetByName: Map<string, Fleet>;
  raceById: Map<string, Race>;
  raceByNumber: Map<number, Race>;
}

const namesOf = (c: Competitor | undefined): Cell => list(c?.names, ' & ');

/** The columns that say who a row is, on every sheet that has one row per
 *  boat: kept even where empty, so every sheet lines up the same way. */
function whoColumns<T>(competitorOf: (item: T) => Competitor | undefined, sailNumberOf?: (item: T) => string | undefined): Col<T>[] {
  return [
    { header: 'Sail number', width: 12, keep: true, cell: (i) => text(sailNumberOf?.(i) ?? competitorOf(i)?.sailNumber) },
    { header: 'Boat name', width: 18, cell: (i) => text(competitorOf(i)?.boatName) },
    { header: 'Competitor', width: 24, keep: true, cell: (i) => namesOf(competitorOf(i)) },
  ];
}

export function assembleSeriesWorkbook(
  snapshot: SeriesSnapshot,
  scored: ScoredResults,
  exportedAt: Date,
): SeriesWorkbook {
  const { series, competitors, fleets, races } = snapshot;
  const lookups: Lookups = {
    competitorById: new Map(competitors.map((c) => [c.id, c])),
    fleetById: new Map(fleets.map((f) => [f.id, f])),
    fleetByName: new Map(fleets.map((f) => [f.name, f])),
    raceById: new Map(races.map((r) => [r.id, r])),
    raceByNumber: new Map(races.map((r) => [r.raceNumber, r])),
  };
  const sheets: WorkbookSheet[] = [
    aboutSheet(snapshot, scored, exportedAt),
    fleetsSheet(snapshot),
    competitorsSheet(snapshot, lookups),
    racesSheet(snapshot, lookups),
    finishesSheet(snapshot, lookups),
    scored.championship
      ? championshipResultsSheet(snapshot, scored.championship.races, lookups)
      : resultsSheet(scored.sections, lookups),
    scored.championship
      ? championshipStandingsSheet(scored.championship, lookups)
      : standingsSheet(scored.sections, lookups),
  ];
  return { fileName: `${seriesSlug(series.name)}.xlsx`, sheets };
}

// ---- About ----

const SHEET_GLOSSARY: Array<[string, string]> = [
  ['Fleets', 'One row per fleet: how it is scored.'],
  ['Competitors', 'One row per competitor, every field the series holds.'],
  ['Races', 'One row per start of each race: its gun, course, conditions and scoring options.'],
  ['Finishes', 'The finish sheets as entered, one row per line, in crossing order.'],
  ['Results', 'One row per competitor per race per fleet, as scored: place, code, points, discards, rating applied, elapsed and corrected times. Times are spreadsheet times, with the same time in seconds beside them.'],
  ['Standings', 'One row per competitor per fleet: rank, total and net, and the points scored in each race. Discarded scores are grey.'],
];

function aboutSheet(snapshot: SeriesSnapshot, scored: ScoredResults, exportedAt: Date): WorkbookSheet {
  const { series, subSeries } = snapshot;
  const codes = seriesCodeTable(series);
  const pair = (label: string, value: Cell): Cell[] => [{ value: label, bold: true }, value];
  const rows: Cell[][] = [
    [{ value: series.name, bold: true }],
    pair('Venue', text(series.venue)),
    pair('Starts', isoDate(series.startDate)),
    pair('Ends', isoDate(series.endDate)),
    pair('Exported', text(exportedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC')),
    pair(
      'Results',
      text(series.resultsStatus === 'final'
        ? 'Final, as currently scored'
        : 'Provisional, as currently scored — not necessarily as published'),
    ),
    pair('Points', text(codes.highPoint ? pointsSystemNote(codes.highPoint) : 'Low point (RRS Appendix A)')),
    pair('DNF, DNS and similar', text(series.dnfScoring === 'startingArea'
      ? 'Scored from boats that came to the starting area (A5.3)'
      : 'Scored from boats entered in the series (A5.2)')),
    pair('Discards', text(summarizeDiscards(series.discardThresholds ?? [], discardRuleOf(series)))),
  ];
  for (const ss of subSeries) {
    rows.push(pair(`Sub-series: ${ss.name}`, text(
      `${ss.raceIds.length} race${ss.raceIds.length === 1 ? '' : 's'}${ss.discards ? ` · ${summarizeSubSeriesDiscards(ss.discards)}` : ''}`,
    )));
  }
  for (const note of scoringCodeNotes(series.dnfScoring ?? 'seriesEntries', series.scoringCodes, codes.highPoint)) {
    rows.push(pair(`Code ${note.code}`, text(`${note.name}: ${note.sentence}`)));
  }
  if (scored.championship) rows.push(pair('Split fleets', text('Results and standings are the championship’s.')));
  rows.push([], [{ value: 'Sheets', bold: true }]);
  for (const [name, what] of SHEET_GLOSSARY) rows.push(pair(name, text(what)));
  rows.push([], [text('An export for working on the results in a spreadsheet. It is not read back by Sail Scoring: to keep or move the series, use Save to File.')]);
  return { name: 'About', columns: [{ header: '', width: 24 }, { header: '', width: 90 }], rows, noHeader: true };
}

// ---- Fleets ----

const SCORING_SYSTEM_NAME: Record<Fleet['scoringSystem'], string> = {
  scratch: 'Scratch',
  irc: 'IRC',
  py: 'Portsmouth Yardstick',
  nhc: 'NHC',
  echo: 'ECHO',
  vprs: 'VPRS',
  orc: 'ORC',
  tcf: 'Fixed TCF',
  ytc: 'YTC',
};

function fleetsSheet(snapshot: SeriesSnapshot): WorkbookSheet {
  const { competitors } = snapshot;
  return table<Fleet>('Fleets', [
    { header: 'Fleet', width: 20, keep: true, cell: (f) => text(f.name) },
    { header: 'Scoring', width: 18, keep: true, cell: (f) => text(SCORING_SYSTEM_NAME[f.scoringSystem] ?? f.scoringSystem) },
    { header: 'Rating', width: 10, cell: (f) => text(ratingSystemLabel(f)) },
    { header: 'Rating variant', cell: (f) => text(f.ratingVariant) },
    { header: 'Competitors', keep: true, cell: (f) => num(competitors.filter((c) => c.fleetIds.includes(f.id)).length) },
    { header: 'ECHO alpha', cell: (f) => num(f.scoringSystem === 'echo' ? f.echoAlpha : null) },
    { header: 'NHC parameters', width: 30, cell: (f) => text(f.nhcProfile ? JSON.stringify(f.nhcProfile) : null) },
    { header: 'ORC scoring', width: 24, cell: (f) => text(f.orcProfile ? JSON.stringify(f.orcProfile) : null) },
  ], snapshot.fleets, 1);
}

// ---- Competitors ----

function competitorsSheet(snapshot: SeriesSnapshot, lookups: Lookups): WorkbookSheet {
  const { series } = snapshot;
  const fleetNames = (c: Competitor) => c.fleetIds.map((id) => lookups.fleetById.get(id)?.name ?? '').filter(Boolean);
  const cols: Col<Competitor>[] = [
    ...whoColumns<Competitor>((c) => c),
    { header: 'Fleets', width: 16, keep: true, cell: (c) => list(fleetNames(c)) },
    { header: 'Owners', width: 20, cell: (c) => list(c.owners, ' & ') },
    { header: 'Helms', width: 20, cell: (c) => list(c.helms, ' & ') },
    { header: 'Crew', width: 24, cell: (c) => list(c.crewNames) },
    { header: 'Clubs', width: 16, cell: (c) => list(c.clubs) },
    { header: 'Class', width: 12, cell: (c) => text(c.boatClass) },
    { header: 'Nationality', cell: (c) => text(c.nationality) },
    { header: 'Gender', cell: (c) => text(c.gender) },
    { header: 'Age', cell: (c) => num(c.age) },
    { header: 'Bow number', cell: (c) => text(c.bowNumber) },
    { header: 'Other sail numbers', cell: (c) => list(c.alternativeSailNumbers) },
    { header: 'Entry number', cell: (c) => text(c.entryNumber) },
    { header: 'Tally', cell: (c) => text(c.tallyNumber) },
    { header: 'World Sailing ID', cell: (c) => text(c.worldSailingId) },
    { header: 'Seed', cell: (c) => num(c.seed) },
    { header: 'Initial fleet', cell: (c) => text(c.initialFleet) },
    ...(series.subdivisionAxes ?? []).map((axis): Col<Competitor> => ({
      header: axis.label, cell: (c) => text(c.subdivisions?.[axis.id]),
    })),
    ...(series.customFields ?? []).map((field): Col<Competitor> => ({
      header: field.label, cell: (c) => text(c.customFields?.[field.id]),
    })),
    { header: 'IRC TCC', cell: (c) => num(c.ircTcc, 'decimal3') },
    { header: 'IRC certificate', cell: (c) => text(c.ircCert?.certNumber) },
    { header: 'IRC secondary TCC', cell: (c) => num(c.ircSecondaryTcc, 'decimal3') },
    { header: 'IRC secondary certificate', cell: (c) => text(c.ircSecondaryCert?.certNumber) },
    { header: 'IRC rating source', cell: (c) => text(c.ircCert?.source) },
    { header: 'PY', cell: (c) => num(c.pyNumber) },
    { header: 'YTC', cell: (c) => num(c.ytcNumber) },
    { header: 'VPRS TCC', cell: (c) => num(c.vprsTcc, 'decimal3') },
    { header: 'Fixed TCF', cell: (c) => num(c.fixedTcf, 'decimal3') },
    { header: 'NHC starting TCF', cell: (c) => num(c.nhcStartingTcf, 'decimal3') },
    { header: 'ECHO starting handicap', cell: (c) => num(c.echoStartingTcf, 'decimal3') },
    { header: 'ORC certificate', cell: (c) => text(c.orcCert ? (c.orcCert.record.CertNo ?? c.orcCert.record.RefNo ?? null) : null) },
    { header: 'ORC GPH', cell: (c) => num(c.orcCert?.record.GPH, 'decimal1') },
    { header: 'ORC APHT', cell: (c) => num(c.orcCert?.record.APHT, 'decimal4') },
    { header: 'ORC APHD', cell: (c) => num(c.orcCert?.record.APHD, 'decimal1') },
    { header: 'Excluded', cell: (c) => yes(c.excluded) },
    { header: 'Competitor ID', width: 38, keep: true, cell: (c) => text(c.id) },
  ];
  return table('Competitors', cols, snapshot.competitors, 3);
}

// ---- Races ----

interface RaceRow { race: Race; start: RaceStart | null }

function racesSheet(snapshot: SeriesSnapshot, lookups: Lookups): WorkbookSheet {
  const { races, raceStarts, subSeries, series } = snapshot;
  const rows: RaceRow[] = races.flatMap((race): RaceRow[] => {
    const starts = raceStarts
      .filter((s) => s.raceId === race.id)
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    return starts.length > 0 ? starts.map((start) => ({ race, start })) : [{ race, start: null }];
  });
  const fleetNames = (ids: readonly string[]) => ids.map((id) => lookups.fleetById.get(id)?.name ?? '').filter(Boolean);
  const struck = (race: Race) => fleetNames(
    (series.raceFleetExclusions ?? []).filter((x) => x.raceId === race.id).map((x) => x.fleetId),
  );
  const sail = (id: string) => lookups.competitorById.get(id)?.sailNumber ?? id;
  return table<RaceRow>('Races', [
    { header: 'Race', keep: true, cell: ({ race }) => num(race.raceNumber) },
    { header: 'Race name', width: 18, cell: ({ race }) => text(race.name) },
    { header: 'Date', width: 11, keep: true, cell: ({ race }) => isoDate(race.date) },
    { header: 'Fleets', width: 20, keep: true, cell: ({ start }) => list(start ? fleetNames(start.fleetIds) : []) },
    { header: 'Gun', cell: ({ start }) => timeOfDay(start?.startTime) },
    { header: 'Stage', cell: ({ start }) => text(start?.stage) },
    { header: 'Stage race', cell: ({ start }) => num(start?.stageRaceNumber) },
    { header: 'Distance (NM)', cell: ({ start }) => num(start?.distanceNm) },
    { header: 'Course', cell: ({ start }) => text(start?.course?.name) },
    { header: 'Course legs', cell: ({ start }) => num(start?.courseLegs?.length ?? start?.course?.legs?.length) },
    { header: 'ORC option', cell: ({ start }) => text(start?.orcOption) },
    { header: 'ORC scoring wind (kt)', cell: ({ start }) => num(start?.orcScoringWind) },
    { header: 'Finishes recorded as', cell: ({ race }) => text(race.finishRecording === 'elapsed' ? 'Elapsed times' : null) },
    { header: 'Last finisher', cell: ({ race }) => timeOfDay(race.lastFinisherTime) },
    { header: 'Discard policy', cell: ({ race }) => text(
      race.discardPolicy === 'mustCount' ? 'Cannot be discarded'
        : race.discardPolicy === 'discardFirst' ? 'Discarded first' : null,
    ) },
    { header: 'Points multiplier', cell: ({ race }) => num(race.pointsMultiplier) },
    { header: 'Not scored for', cell: ({ race }) => list(struck(race)) },
    { header: 'Sub-series', width: 18, cell: ({ race }) => list(subSeries.filter((ss) => ss.raceIds.includes(race.id)).map((ss) => ss.name)) },
    { header: 'Wind min (kt)', cell: ({ race }) => num(race.conditions?.windSpeedMin) },
    { header: 'Wind max (kt)', cell: ({ race }) => num(race.conditions?.windSpeedMax) },
    { header: 'Wind direction', cell: ({ race }) => text(race.conditions?.windDirection) },
    { header: 'Notes', width: 30, cell: ({ race }) => text(race.conditions?.notes) },
    { header: 'Officials', width: 30, cell: ({ race }) => list((race.officials ?? []).map((o) => {
      const role = officialRoleLabel(o);
      return role ? `${role}: ${o.name}` : o.name;
    })) },
    { header: 'Fleet changes', width: 24, cell: ({ race }) => list((race.fleetChanges ?? []).map((fc) => [
      sail(fc.competitorId),
      ...(fc.add?.length ? [`in ${fleetNames(fc.add).join(', ')}`] : []),
      ...(fc.drop?.length ? [`out of ${fleetNames(fc.drop).join(', ')}`] : []),
    ].join(' '))) },
  ], rows, 2);
}

// ---- Finishes ----

const REDRESS_METHOD: Record<NonNullable<Finish['redressMethod']>, string> = {
  all_races: 'Average, all races',
  all_races_excl_dnc: 'Average, all races except DNC',
  races_before: 'Average, races before',
  stated: 'Stated points',
};

function finishesSheet(snapshot: SeriesSnapshot, lookups: Lookups): WorkbookSheet {
  const raceOrder = new Map(snapshot.races.map((r, i) => [r.id, i]));
  const rows = [...snapshot.finishes].sort((a, b) =>
    (raceOrder.get(a.raceId) ?? 0) - (raceOrder.get(b.raceId) ?? 0)
    || (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
    || (a.resultCode ?? '').localeCompare(b.resultCode ?? ''),
  );
  const competitorOf = (f: Finish) => (f.competitorId ? lookups.competitorById.get(f.competitorId) : undefined);
  const raceNumbers = (ids: string[] | null) =>
    (ids ?? []).map((id) => lookups.raceById.get(id)?.raceNumber).filter((n): n is number => n != null).map(String);
  return table<Finish>('Finishes', [
    { header: 'Race', keep: true, cell: (f) => num(lookups.raceById.get(f.raceId)?.raceNumber) },
    { header: 'Line', keep: true, cell: (f) => num(f.sortOrder != null ? f.sortOrder + 1 : null) },
    ...whoColumns<Finish>(competitorOf, (f) => competitorOf(f)?.sailNumber ?? f.unknownSailNumber),
    { header: 'Unknown sail number', cell: (f) => yes(f.competitorId == null) },
    { header: 'As entered', cell: (f) => text(f.enteredSailNumber) },
    { header: 'Matched on', cell: (f) => text(f.matchedOn) },
    { header: 'Tied with previous', cell: (f) => yes(f.tiedWithPrevious) },
    { header: 'Finish time', cell: (f) => timeOfDay(f.finishTime) },
    { header: 'Elapsed', cell: (f) => duration(f.elapsedSecs) },
    { header: 'Elapsed (s)', cell: (f) => num(f.elapsedSecs) },
    { header: 'Laps', cell: (f) => num(f.laps) },
    { header: 'Code', cell: (f) => text(f.resultCode) },
    { header: 'In starting area', cell: (f) => bool(f.startPresent) },
    { header: 'Penalty', cell: (f) => text(f.penaltyCode) },
    { header: 'Penalty amount', cell: (f) => num(f.penaltyOverride) },
    { header: 'Penalty in points', cell: (f) => yes(f.penaltyInPoints) },
    { header: 'Penalty label', cell: (f) => text(f.penaltyLabel) },
    { header: 'Redress', cell: (f) => text(f.redressMethod ? REDRESS_METHOD[f.redressMethod] : null) },
    { header: 'Redress points', cell: (f) => num(f.redressPoints) },
    { header: 'Redress excludes races', cell: (f) => list(raceNumbers(f.redressExcludeRaceIds), ', ') },
    { header: 'Redress uses races', cell: (f) => list(raceNumbers(f.redressIncludeRaceIds), ', ') },
    { header: 'Redress uses later races', cell: (f) => yes(f.redressIncludeAllLater) },
    { header: 'Competitor ID', width: 38, keep: true, cell: (f) => text(f.competitorId) },
  ], rows, 5);
}

// ---- Results ----

interface ResultLine {
  section: ResultsSection;
  race: SeriesResultsData['races'][number];
  /** The series race this column is, which a fleet's or a sub-series' own
   *  numbering may not show. */
  seriesRace: Race | undefined;
  competitorId: string;
  score: RaceScoreData | undefined;
  result: RaceResultData | undefined;
  winnerCtSecs: number | null;
  timeOnTime: boolean;
}

function seriesRaceOf(race: SeriesResultsData['races'][number], lookups: Lookups): Race | undefined {
  return (race.raceId ? lookups.raceById.get(race.raceId) : undefined) ?? lookups.raceByNumber.get(race.raceNumber);
}

function resultLines(sections: readonly ResultsSection[], lookups: Lookups): ResultLine[] {
  const lines: ResultLine[] = [];
  for (const section of sections) {
    const { races, standings } = section.data;
    races.forEach((race, i) => {
      const byCompetitor = new Map(race.results.flatMap((r) => (r.competitorId ? [[r.competitorId, r] as const] : [])));
      const winnerCtSecs = race.results.reduce<number | null>(
        (best, r) => (r.rank !== null && r.correctedTimeSecs != null && (best === null || r.correctedTimeSecs < best) ? r.correctedTimeSecs : best),
        null,
      );
      const timeOnTime = winnerCtSecs !== null && !race.isOrcTod;
      const seriesRace = seriesRaceOf(race, lookups);
      const seen = new Set<string>();
      const raceLines: ResultLine[] = [];
      const push = (competitorId: string, score: RaceScoreData | undefined) => {
        seen.add(competitorId);
        raceLines.push({ section, race, seriesRace, competitorId, score, result: byCompetitor.get(competitorId), winnerCtSecs, timeOnTime });
      };
      // Everyone the standings score in the race, then anyone the race table
      // has that the standings don't; listed in finishing order, as the race
      // is read, with the coded and the absent after the placed in standings
      // order.
      for (const row of standings) if (row.competitorId) push(row.competitorId, row.raceScores[i]);
      for (const id of byCompetitor.keys()) if (!seen.has(id)) push(id, undefined);
      const placeOf = (l: ResultLine) => l.result?.rank ?? Number.POSITIVE_INFINITY;
      lines.push(...raceLines.sort((a, b) => placeOf(a) - placeOf(b)));
    });
  }
  return lines;
}

function scoreStatus(score: RaceScoreData | undefined): string | null {
  if (!score) return null;
  if (score.isNotInFleet) return 'Not in this fleet for the race';
  if (score.isNotScored) return 'Not scored yet';
  if (score.isExcluded) return 'Race not counted';
  return null;
}

function resultsSheet(sections: readonly ResultsSection[], lookups: Lookups): WorkbookSheet {
  const lines = resultLines(sections, lookups);
  const competitorOf = (l: ResultLine) => lookups.competitorById.get(l.competitorId);
  const hasSubSeries = sections.some((s) => s.subSeriesName);
  const ttw = (l: ResultLine) =>
    l.timeOnTime && l.result && l.winnerCtSecs !== null ? timeToWinSecs(l.result, l.winnerCtSecs) : null;
  const rtw = (l: ResultLine) =>
    l.timeOnTime && l.result && l.winnerCtSecs !== null ? ratingToWin(l.result, l.winnerCtSecs) : null;
  const points = (l: ResultLine) => l.score?.points ?? l.result?.points ?? null;
  const code = (l: ResultLine) => l.score?.resultCode ?? l.result?.resultCode ?? null;
  const penalty = (l: ResultLine) => l.score?.penaltyCode ?? l.result?.penaltyCode ?? null;
  const ratingDecimals = (l: ResultLine): CellFormat => (l.race.isOrcTot ? 'decimal4' : l.race.isOrcTod ? 'decimal1' : 'decimal3');
  return table<ResultLine>('Results', [
    ...(hasSubSeries ? [{ header: 'Sub-series', width: 16, keep: true, cell: (l: ResultLine) => text(l.section.subSeriesName) }] : []),
    { header: 'Fleet', width: 16, keep: true, cell: (l) => text(l.section.fleetName) },
    { header: 'Race', keep: true, cell: (l) => num(l.seriesRace?.raceNumber ?? l.race.raceNumber) },
    { header: 'Race name', width: 16, cell: (l) => text(l.race.name) },
    { header: 'Date', width: 11, keep: true, cell: (l) => isoDate(l.race.date) },
    ...whoColumns<ResultLine>(competitorOf),
    { header: 'Place', keep: true, cell: (l) => num(l.result?.rank) },
    { header: 'Code', cell: (l) => text(code(l)) },
    { header: 'Penalty', cell: (l) => text(l.score?.penaltyLabel ?? l.result?.penaltyLabel ?? penalty(l)) },
    { header: 'Points', keep: true, cell: (l) => num(points(l)) },
    { header: 'Discarded', keep: true, cell: (l) => (l.score ? bool(l.score.isDiscard) : null) },
    { header: 'Redress', cell: (l) => yes(l.score?.isRedress) },
    { header: 'Not counted', width: 18, cell: (l) => text(scoreStatus(l.score)) },
    { header: 'Gun', cell: (l) => timeOfDay(l.race.startTime) },
    { header: 'Rating applied', cell: (l) => num(l.result?.tcc ?? l.score?.appliedRating, ratingDecimals(l)) },
    { header: 'Yardstick', cell: (l) => num(l.result?.yardstickNumber) },
    { header: 'Rating changed for this race', cell: (l) => yes(l.result?.tccOverride) },
    { header: 'Certificate', cell: (l) => text(l.result?.certificate === 'S' ? 'Secondary' : l.result?.certificate === 'P' ? 'Primary' : null) },
    { header: 'Laps', cell: (l) => num(l.result?.laps) },
    { header: 'Finish time', cell: (l) => timeOfDay(l.result?.finishTime) },
    { header: 'Elapsed', cell: (l) => duration(l.result?.elapsedTimeSecs ?? l.result?.elapsedSecs) },
    { header: 'Elapsed (s)', cell: (l) => num(l.result?.elapsedTimeSecs ?? l.result?.elapsedSecs) },
    { header: 'Full-course elapsed', cell: (l) => duration(l.result?.courseElapsedTimeSecs) },
    { header: 'Corrected', cell: (l) => duration(l.result?.correctedTimeSecs) },
    { header: 'Corrected (s)', cell: (l) => num(l.result?.correctedTimeSecs) },
    { header: 'Behind winner', cell: (l) => duration(
      l.result?.rank != null && l.result.correctedTimeSecs != null && l.winnerCtSecs !== null
        ? l.result.correctedTimeSecs - l.winnerCtSecs : null,
    ) },
    { header: 'Time to win', cell: (l) => duration(ttw(l)) },
    { header: 'Time to win (s)', cell: (l) => num(ttw(l)) },
    { header: 'Rating to win', cell: (l) => num(rtw(l), ratingDecimals(l)) },
    { header: 'Distance (NM)', cell: (l) => num(l.race.distanceNm) },
    { header: 'Implied wind (kt)', cell: (l) => num(l.result?.impliedWind, 'decimal1') },
    // NHC and ECHO: how the rating moved, and the working behind it.
    { header: 'Next rating', cell: (l) => num(l.result?.nhc?.newTcf ?? l.result?.echo?.newH, 'decimal3') },
    { header: 'Rating change', cell: (l) => num(l.result?.nhc?.adjustment ?? l.result?.echo?.adjustment, 'decimal4') },
    { header: 'NHC fair TCF', cell: (l) => num(l.result?.nhc?.fairTcf, 'decimal4') },
    { header: 'NHC comparative score', cell: (l) => num(l.result?.nhc?.compScore, 'decimal4') },
    { header: 'NHC extreme', cell: (l) => text(l.result?.nhc?.isExtreme ? (l.result.nhc.extremeDirection ?? 'yes') : null) },
    { header: 'NHC alpha', cell: (l) => num(l.result?.nhc?.alphaApplied, 'decimal4') },
    { header: 'NHC provisional TCF', cell: (l) => num(l.result?.nhc?.provisionalTcf, 'decimal4') },
    { header: 'ECHO performance index', cell: (l) => num(l.result?.echo?.pi, 'decimal4') },
    { header: 'Competitor ID', width: 38, keep: true, cell: (l) => text(l.competitorId) },
  ], lines, hasSubSeries ? 8 : 7);
}

// ---- Standings ----

interface StandingLine { section: ResultsSection; row: StandingRowData }

function standingsSheet(sections: readonly ResultsSection[], lookups: Lookups): WorkbookSheet {
  const hasSubSeries = sections.some((s) => s.subSeriesName);
  // One points column per series race, across every fleet: a fleet that
  // didn't sail a race leaves its column blank.
  const raceNumbers = [...new Set(sections.flatMap((s) => s.data.races.map((r) => seriesRaceOf(r, lookups)?.raceNumber ?? r.raceNumber)))]
    .sort((a, b) => a - b);
  const lines: StandingLine[] = sections.flatMap((section) => section.data.standings.map((row) => ({ section, row })));
  const scoreIn = (l: StandingLine, n: number): RaceScoreData | undefined => {
    const i = l.section.data.races.findIndex((r) => (seriesRaceOf(r, lookups)?.raceNumber ?? r.raceNumber) === n);
    return i >= 0 ? l.row.raceScores[i] : undefined;
  };
  const competitorOf = (l: StandingLine) => (l.row.competitorId ? lookups.competitorById.get(l.row.competitorId) : undefined);
  const raceLabel = (n: number) => {
    const race = lookups.raceByNumber.get(n);
    return race?.name ? `R${n} ${race.name}` : `R${n}`;
  };
  // A race whose column carries a code for some boat gets a code column
  // beside it, so the points stay numbers.
  const codedRaces = new Set(raceNumbers.filter((n) => lines.some((l) => scoreIn(l, n)?.resultCode)));
  const raceCols: Col<StandingLine>[] = raceNumbers.flatMap((n): Col<StandingLine>[] => [
    {
      header: raceLabel(n),
      keep: true,
      cell: (l) => {
        const s = scoreIn(l, n);
        if (!s || s.isNotInFleet) return null;
        return { value: s.points, ...(s.isDiscard ? { muted: true } : {}) };
      },
    },
    ...(codedRaces.has(n)
      ? [{ header: `R${n} code`, cell: (l: StandingLine) => text(scoreIn(l, n)?.resultCode ?? null) }]
      : []),
  ]);
  return table<StandingLine>('Standings', [
    ...(hasSubSeries ? [{ header: 'Sub-series', width: 16, keep: true, cell: (l: StandingLine) => text(l.section.subSeriesName) }] : []),
    { header: 'Fleet', width: 16, keep: true, cell: (l) => text(l.section.fleetName) },
    { header: 'Rank', keep: true, cell: (l) => num(l.row.rank) },
    ...whoColumns<StandingLine>(competitorOf, (l) => l.row.sailNumber),
    { header: 'Rating', cell: (l) => num(l.row.rating?.value ?? l.row.seedRating, 'decimal3') },
    { header: 'Total', keep: true, cell: (l) => num(l.row.totalPoints) },
    { header: 'Net', keep: true, cell: (l) => ({ value: l.row.netPoints, bold: true }) },
    ...raceCols,
    { header: 'Competitor ID', width: 38, keep: true, cell: (l) => text(l.row.competitorId) },
  ], lines, hasSubSeries ? 6 : 5);
}

// ---- A split-fleet championship ----

interface ChampionshipResultLine { race: ChampionshipRaceFleet; result: ChampionshipRaceFleet['results'][number] }

function championshipResultsSheet(
  snapshot: SeriesSnapshot,
  races: readonly ChampionshipRaceFleet[],
  lookups: Lookups,
): WorkbookSheet {
  const finishBy = new Map(snapshot.finishes.flatMap((f) => (f.competitorId ? [[`${f.raceId}\u0000${f.competitorId}`, f] as const] : [])));
  const lines = races.flatMap((race) => race.results.map((result) => ({ race, result })));
  const finishOf = (l: ChampionshipResultLine) => {
    const race = lookups.raceByNumber.get(l.race.race);
    return race ? finishBy.get(`${race.id}\u0000${l.result.competitorId}`) : undefined;
  };
  const competitorOf = (l: ChampionshipResultLine) => lookups.competitorById.get(l.result.competitorId);
  return table<ChampionshipResultLine>('Results', [
    { header: 'Fleet', width: 16, keep: true, cell: (l) => text(l.race.fleetName) },
    { header: 'Race', keep: true, cell: (l) => num(l.race.race) },
    { header: 'Stage race', cell: (l) => text(l.race.label) },
    { header: 'Race name', cell: (l) => text(l.race.name) },
    { header: 'Date', width: 11, keep: true, cell: (l) => isoDate(l.race.date) },
    ...whoColumns<ChampionshipResultLine>(competitorOf, (l) => l.result.competitor.sailNumber),
    { header: 'Line', cell: (l) => num(finishOf(l)?.sortOrder != null ? finishOf(l)!.sortOrder! + 1 : null) },
    { header: 'Code', cell: (l) => text(l.result.code) },
    { header: 'Points', keep: true, cell: (l) => num(l.result.points) },
    { header: 'Gun', cell: (l) => timeOfDay(l.race.startTime) },
    { header: 'Finish time', cell: (l) => timeOfDay(finishOf(l)?.finishTime) },
    { header: 'Elapsed', cell: (l) => duration(finishOf(l)?.elapsedSecs) },
    { header: 'Competitor ID', width: 38, keep: true, cell: (l) => text(l.result.competitorId) },
  ], lines, 8);
}

function championshipStandingsSheet(
  championship: NonNullable<ScoredResults['championship']>,
  lookups: Lookups,
): WorkbookSheet {
  const competitorOf = (r: ChampionshipRow) => lookups.competitorById.get(r.competitorId);
  const coded = new Set(championship.columns.filter((_, i) => championship.rows.some((r) => r.cells[i]?.code)).map((c) => c.key));
  const raceCols: Col<ChampionshipRow>[] = championship.columns.flatMap((col, i): Col<ChampionshipRow>[] => [
    {
      header: col.label,
      keep: true,
      cell: (r) => {
        const c = r.cells[i];
        return c ? { value: c.points, ...(c.discarded ? { muted: true } : {}) } : null;
      },
    },
    ...(coded.has(col.key) ? [{ header: `${col.label} code`, cell: (r: ChampionshipRow) => text(r.cells[i]?.code ?? null) }] : []),
  ]);
  return table<ChampionshipRow>('Standings', [
    { header: 'Rank', keep: true, cell: (r) => num(r.rank) },
    { header: 'Fleet', width: 14, cell: (r) => text(r.fleet) },
    ...whoColumns<ChampionshipRow>(competitorOf, (r) => r.competitor.sailNumber),
    { header: 'Total', keep: true, cell: (r) => num(r.total) },
    { header: 'Net', keep: true, cell: (r) => (r.net == null ? null : { value: r.net, bold: true }) },
    ...raceCols,
    { header: 'Competitor ID', width: 38, keep: true, cell: (r) => text(r.competitorId) },
  ], championship.rows, 5);
}
