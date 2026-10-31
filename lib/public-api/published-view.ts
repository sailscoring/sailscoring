/**
 * The published view (ADR-015): a publication as its pages present it,
 * stored for the published results API to serve.
 *
 * The view follows the pages. Every publish hands this module the data behind
 * the pages it is publishing, and only the parts of the view those pages show
 * are replaced: a fleet's standings and its race results with the page that
 * shows that fleet, the entry list with the Entries page. A page left unticked
 * leaves its parts as they were, so the API says what the pages say, and a
 * part goes when the last page that shows it does.
 *
 * Pure. It never reads the database or storage and knows no secrets; the
 * caller turns internal competitor ids into public ones (`ViewContext`), so
 * nothing internal reaches what is stored.
 */

import {
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  isFieldDisabledByPrimary,
  primaryPersonHeader,
} from '../competitor-fields';
import { ordinal } from '../ordinal';
import {
  formatPoints,
  raceResultPointsText,
  scoreDisplayText,
  type CompetitorListGroup,
  type RaceResultData,
  type SeriesResultsData,
  type StandingRowData,
} from '../results-renderer';
import { seriesSlug } from '../series-name';
import { formatElapsedInput } from '../time-parse';
import type { ScheduleRace } from '../schedule';
import type {
  CompetitorFieldKey,
  MultiPersonFieldKey,
  PrimaryPersonLabel,
  SubdivisionAxis,
} from '../types';
import type {
  PublicApiCompetitor,
  PublicApiCompetitors,
  PublicApiEntry,
  PublicApiPublication,
  PublicApiRace,
  PublicApiRaceFleet,
  PublicApiRaces,
  PublicApiSchedule,
  PublicApiStandings,
  PublicApiStandingsTable,
} from '../validation/public-api-v1';

// ---- What a page shows ----

/** The display settings a page's competitor columns follow. */
export interface CompetitorDisplay {
  enabledCompetitorFields: readonly CompetitorFieldKey[];
  primaryPersonLabel?: PrimaryPersonLabel;
  multiPersonFields?: readonly MultiPersonFieldKey[];
  subdivisionAxes?: readonly SubdivisionAxis[];
}

/** One fleet's section of a results page: the data the page rendered. */
export interface ResultsSection {
  fleetName: string;
  subSeriesName?: string;
  scoringSystem: string | null;
  data: SeriesResultsData;
}

/** One competitor's line in a championship table, already resolved for
 *  display by the championship's own engine. */
export interface ChampionshipRow {
  competitorId: string;
  rank: number | null;
  fleet?: string;
  cells: Array<{
    column: string;
    points: number;
    code: string | null;
    discarded: boolean;
    counts: boolean;
  } | null>;
  total: number | null;
  net: number | null;
  competitor: CompetitorFields;
}

/** One fleet's sailing of one championship race. */
export interface ChampionshipRaceFleet {
  race: number;
  name: string | null;
  date: string | null;
  fleetName: string;
  label: string;
  startTime: string | null;
  results: Array<{
    competitorId: string;
    competitor: CompetitorFields;
    points: number;
    code: string | null;
  }>;
}

/** The competitor fields the row models carry, under the names they carry
 *  them by. */
export interface CompetitorFields {
  sailNumber: string;
  bowNumber?: string;
  entryNumber?: string;
  tallyNumber?: string;
  boatName?: string;
  boatClass?: string;
  names: string[];
  helms?: string[];
  owners?: string[];
  crewNames?: string[];
  clubs?: string[];
  nationality?: string;
  worldSailingId?: string;
  subdivisions?: Record<string, string>;
  gender?: 'M' | 'F' | '';
  age?: number | null;
}

/**
 * What one page shows, for the published view. The build attaches it to each
 * page it renders; a page with nothing for the API (the prize sheet, the
 * fleet assignments) carries none.
 */
export type PageView =
  | { kind: 'results'; sections: ResultsSection[] }
  | { kind: 'entries'; groups: CompetitorListGroup[]; display: CompetitorDisplay; count: number }
  | {
      kind: 'championship';
      columns: Array<{ key: string; label: string; race: number | null; date: string | null; name: string | null }>;
      rows: ChampionshipRow[];
      display: CompetitorDisplay;
    }
  | { kind: 'championship-races'; races: ChampionshipRaceFleet[]; display: CompetitorDisplay }
  | {
      kind: 'archive';
      sections: ArchiveSection[];
    }
  /** The Schedule page's races, each with the absolute URL of its results
   *  once the publish handler knows where they are served. */
  | { kind: 'schedule'; races: Array<ScheduleRace & { results: string | null }> };

/** One fleet of an as-published archive, as its tables were printed. */
export interface ArchiveSection {
  fleetName: string;
  caption?: string;
  leadColumns: string[];
  races: Array<{ label: string; date: string | null }>;
  summaryColumns: string[];
  rows: Array<{
    competitorId: string;
    rank: number | null;
    rankLabel: string;
    competitor: { sailNumber: string; names: string[] };
    leadCells: string[];
    raceCells: Array<{ text: string; discard?: boolean; rank?: number }>;
    summaryCells: string[];
  }>;
  raceTables: Array<{
    label: string;
    date: string | null;
    caption?: string;
    columns: string[];
    rows: Array<{ competitorId?: string; rank?: number; cells: string[] }>;
  }>;
}

// ---- The stored view ----

interface Part<T> {
  /** Unix ms: when the page this part came from was published. */
  publishedAt: number;
  /** Where the part sits among its siblings, from the build's page order. */
  order: number;
  value: T;
}

interface RaceFleetPart {
  race: number;
  name: string | null;
  date: string | null;
  fleet: PublicApiRaceFleet;
}

type CompetitorsPart = Pick<PublicApiCompetitors, 'count' | 'namesLabel' | 'groups'>;
type SchedulePart = Pick<PublicApiSchedule, 'races'>;

/**
 * The published view as stored between publishes: every part, and which live
 * page last supplied it. Resources are rendered from it (`viewResources`).
 */
export interface PublishedViewState {
  version: 1;
  tables: Record<string, Part<PublicApiStandingsTable>>;
  raceFleets: Record<string, Part<RaceFleetPart>>;
  competitors?: Part<CompetitorsPart>;
  schedule?: Part<SchedulePart>;
  /** Page key → the part keys it showed when it was last published. */
  pages: Record<string, string[]>;
}

export function emptyPublishedView(): PublishedViewState {
  return { version: 1, tables: {}, raceFleets: {}, pages: {} };
}

/** How the caller names competitors and links: public ids, identity slugs,
 *  and the base the API's own URLs hang off. */
export interface ViewContext {
  /** `{origin}/api/public/v1/publications/{id}`. */
  apiBase: string;
  competitor(internalId: string): Pick<PublicApiCompetitor, 'id' | 'identity'>;
}

/** A page's contribution to this publish: its key, as the publication stores
 *  its pages, and what it shows. */
export interface PageContribution {
  pageKey: string;
  view: PageView;
}

const COMPETITORS_KEY = 'competitors';
const SCHEDULE_KEY = 'schedule';

/** A published page's identity within its publication: its sub-series and
 *  name, as the publish path keys the pages it stores. */
export function publishedPageKey(page: { fleetName: string; subSeriesName?: string }): string {
  return `${page.subSeriesName ?? ''}\u0000${page.fleetName}`;
}

/** Every internal competitor id a page names, for the caller to resolve to
 *  public ids before the view is built. */
export function competitorIdsOf(view: PageView): string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined) => {
    if (id) ids.add(id);
  };
  switch (view.kind) {
    case 'results':
      for (const s of view.sections) {
        for (const row of s.data.standings) add(row.competitorId);
        for (const race of s.data.races) for (const r of race.results) add(r.competitorId);
      }
      break;
    case 'entries':
      for (const g of view.groups) for (const row of g.rows) add(row.competitorId);
      break;
    case 'championship':
      for (const row of view.rows) add(row.competitorId);
      break;
    case 'championship-races':
      for (const race of view.races) for (const r of race.results) add(r.competitorId);
      break;
    case 'archive':
      for (const s of view.sections) for (const row of s.rows) add(row.competitorId);
      break;
    case 'schedule':
      break;
  }
  return [...ids];
}

/** The fleet key the API names a fleet by in paths and references. */
export function fleetKey(name: string): string {
  return seriesSlug(name);
}

function tableKey(subSeries: string | null, key: string): string {
  return `${subSeries ?? ''}\u0000${key}`;
}

function raceFleetKey(race: number, subSeries: string | null, key: string): string {
  return `${race}\u0000${tableKey(subSeries, key)}`;
}

// ---- Competitors ----

function axisLabel(axis: SubdivisionAxis): string {
  return axis.label?.trim() || DEFAULT_SUBDIVISION_LABEL;
}

/** The names the primary person column is headed by. */
function namesLabelOf(display: CompetitorDisplay): string {
  return primaryPersonHeader(
    display.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
    display.multiPersonFields ? [...display.multiPersonFields] : undefined,
  );
}

/**
 * A competitor as the API names them: the fields the series displays and
 * nothing else. A field is included when the series has it switched on and
 * the competitor has a value, which is the page's own rule less the column it
 * prints blank.
 */
function competitorOf(
  fields: CompetitorFields,
  internalId: string,
  display: CompetitorDisplay,
  ctx: ViewContext,
): PublicApiCompetitor {
  const on = new Set(display.enabledCompetitorFields);
  const primary = display.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const list = (v: string[] | undefined) => (v && v.length > 0 ? v : undefined);
  const subdivisions: Record<string, string> = {};
  if (on.has('subdivision')) {
    for (const axis of display.subdivisionAxes ?? []) {
      const value = fields.subdivisions?.[axis.id];
      if (value) subdivisions[axisLabel(axis)] = value;
    }
  }
  const helms = on.has('helm') && !isFieldDisabledByPrimary('helm', primary) ? list(fields.helms) : undefined;
  const owners = on.has('owner') && !isFieldDisabledByPrimary('owner', primary) ? list(fields.owners) : undefined;
  const crew = on.has('crewName') ? list(fields.crewNames) : undefined;
  const clubs = on.has('club') ? list(fields.clubs) : undefined;
  return {
    ...ctx.competitor(internalId),
    sailNumber: fields.sailNumber,
    ...(on.has('bowNumber') && fields.bowNumber ? { bowNumber: fields.bowNumber } : {}),
    ...(on.has('entryNumber') && fields.entryNumber ? { entryNumber: fields.entryNumber } : {}),
    ...(on.has('tallyNumber') && fields.tallyNumber ? { tallyNumber: fields.tallyNumber } : {}),
    ...(on.has('boatName') && fields.boatName ? { boatName: fields.boatName } : {}),
    ...(on.has('boatClass') && fields.boatClass ? { boatClass: fields.boatClass } : {}),
    names: fields.names,
    ...(helms ? { helms } : {}),
    ...(owners ? { owners } : {}),
    ...(crew ? { crew } : {}),
    ...(clubs ? { clubs } : {}),
    ...(on.has('nationality') && fields.nationality ? { nationality: fields.nationality } : {}),
    ...(on.has('worldSailingId') && fields.worldSailingId ? { worldSailingId: fields.worldSailingId } : {}),
    ...(Object.keys(subdivisions).length > 0 ? { subdivisions } : {}),
    ...(on.has('gender') && (fields.gender === 'M' || fields.gender === 'F') ? { gender: fields.gender } : {}),
    ...(on.has('age') && fields.age != null ? { age: fields.age } : {}),
  };
}

/** The row models name the primary people `helm` and the separate helm role
 *  `helmRole`; this is the one place that is undone. */
function fieldsOfRow(row: StandingRowData | RaceResultData): CompetitorFields {
  return {
    sailNumber: row.sailNumber,
    ...(row.bowNumber ? { bowNumber: row.bowNumber } : {}),
    ...(row.entryNumber ? { entryNumber: row.entryNumber } : {}),
    ...(row.tallyNumber ? { tallyNumber: row.tallyNumber } : {}),
    ...(row.boatName ? { boatName: row.boatName } : {}),
    ...(row.boatClass ? { boatClass: row.boatClass } : {}),
    names: row.helm,
    ...(row.helmRole ? { helms: row.helmRole } : {}),
    ...(row.owner ? { owners: row.owner } : {}),
    ...(row.crewNames ? { crewNames: row.crewNames } : {}),
    ...(row.clubs ? { clubs: row.clubs } : {}),
    ...(row.nationality ? { nationality: row.nationality } : {}),
    ...(row.worldSailingId ? { worldSailingId: row.worldSailingId } : {}),
    ...(row.subdivisions ? { subdivisions: row.subdivisions } : {}),
    ...(row.gender ? { gender: row.gender } : {}),
    ...(row.age != null ? { age: row.age } : {}),
  };
}

function displayOfData(data: SeriesResultsData): CompetitorDisplay {
  return {
    enabledCompetitorFields: data.enabledCompetitorFields,
    ...(data.primaryPersonLabel ? { primaryPersonLabel: data.primaryPersonLabel } : {}),
    ...(data.multiPersonFields ? { multiPersonFields: data.multiPersonFields } : {}),
    ...(data.subdivisionAxes ? { subdivisionAxes: data.subdivisionAxes } : {}),
  };
}

// ---- Parts from pages ----

interface ContributedPart {
  key: string;
  apply(state: PublishedViewState, publishedAt: number): void;
}

/** What the rating column of a fleet's race table is headed. */
function ratingLabelOf(race: SeriesResultsData['races'][number], scoringSystem: string | null): string | null {
  if (race.ratingColumnLabel) return race.ratingColumnLabel;
  if (race.isNhc) return 'TCF';
  if (race.isEcho) return 'Starting H';
  if (race.isOrcTod) return 'ToD';
  if (race.isOrcTot) return 'ToT';
  switch (scoringSystem) {
    case 'irc': return 'TCC';
    case 'vprs': return 'TCC';
    case 'py': return 'PY';
    case 'orc': return 'TCC';
    case 'tcf': return 'TCF';
    default: return null;
  }
}

/**
 * The race tables print a tied rank with `=`. The API carries the rank as a
 * number; `rank` is enough to see the tie.
 */
function resultsSectionParts(
  section: ResultsSection,
  order: number,
  ctx: ViewContext,
): ContributedPart[] {
  const { data } = section;
  const display = displayOfData(data);
  const key = fleetKey(section.fleetName);
  const subSeries = section.subSeriesName ?? null;
  const fleet = { key, name: section.fleetName };
  // Before the first race the page is a placeholder: the fleet's entrants,
  // unranked, with no totals, since every boat is on nothing.
  const placeholder = data.races.length === 0;
  const hasDiscards = data.standings.some((s) => s.netPoints !== s.totalPoints);

  const table: PublicApiStandingsTable = {
    fleet,
    subSeries,
    scoringSystem: section.scoringSystem,
    namesLabel: namesLabelOf(display),
    races: data.races.map((r) => ({
      race: r.order ?? r.raceNumber,
      label: r.label,
      date: r.date || null,
      name: r.name ?? null,
    })),
    rows: data.standings.map((s) => ({
      rank: placeholder ? null : s.rank,
      rankDisplay: placeholder ? '' : ordinal(s.rank),
      competitor: competitorOf(fieldsOfRow(s), s.competitorId ?? s.sailNumber, display, ctx),
      scores: s.raceScores.map((score) => ({
        points: score.points,
        code: score.resultCode ?? score.penaltyCode ?? (score.isRedress ? 'RDG' : null),
        discarded: score.isDiscard,
        ...(score.isExcluded ? { excluded: true } : {}),
        display: score.isExcluded
          ? '—'
          : scoreDisplayText(
              score.points,
              score.resultCode,
              score.penaltyCode,
              score.penaltyOverride,
              score.isDiscard,
              score.isRedress,
              score.penaltyLabel,
              score.penaltyInPoints,
            ),
      })),
      total: placeholder ? null : s.totalPoints,
      net: placeholder ? null : s.netPoints,
      totalDisplay: placeholder ? null : formatPoints(s.totalPoints),
      netDisplay: placeholder || !hasDiscards ? null : formatPoints(s.netPoints),
    })),
  };

  const parts: ContributedPart[] = [
    {
      key: `t:${tableKey(subSeries, key)}`,
      apply(state, publishedAt) {
        state.tables[tableKey(subSeries, key)] = { publishedAt, order, value: table };
      },
    },
  ];

  for (const race of data.races) {
    if (race.results.length === 0) continue;
    const n = race.order ?? race.raceNumber;
    const raceFleet: PublicApiRaceFleet = {
      fleet,
      subSeries,
      label: race.label,
      startTime: race.startTime ?? null,
      ratingLabel: ratingLabelOf(race, section.scoringSystem),
      results: race.results.map((r) => ({
        competitor: competitorOf(fieldsOfRow(r), r.competitorId ?? r.sailNumber, display, ctx),
        rank: r.rank,
        points: r.points,
        code: r.resultCode ?? r.penaltyCode ?? null,
        display: raceResultPointsText(r),
        ...(r.finishTime ? { finishTime: r.finishTime } : {}),
        ...(r.elapsedTimeSecs != null
          ? { elapsed: formatElapsedInput(r.elapsedTimeSecs) }
          : r.elapsedSecs != null
            ? { elapsed: formatElapsedInput(r.elapsedSecs) }
            : {}),
        ...(r.correctedTimeSecs != null ? { corrected: formatElapsedInput(r.correctedTimeSecs) } : {}),
        ...(r.laps != null ? { laps: r.laps } : {}),
        ...(r.tcc != null ? { rating: r.tcc } : {}),
      })),
    };
    const k = raceFleetKey(n, subSeries, key);
    parts.push({
      key: `r:${k}`,
      apply(state, publishedAt) {
        state.raceFleets[k] = {
          publishedAt,
          order,
          value: { race: n, name: race.name ?? null, date: race.date || null, fleet: raceFleet },
        };
      },
    });
  }
  return parts;
}

function entriesParts(
  view: Extract<PageView, { kind: 'entries' }>,
  ctx: ViewContext,
): ContributedPart[] {
  const value: CompetitorsPart = {
    count: view.count,
    namesLabel: namesLabelOf(view.display),
    groups: view.groups.map((g) => ({
      heading: g.heading ?? null,
      ratingColumns: g.ratingColumns,
      competitors: g.rows.map((row): PublicApiEntry => ({
        ...competitorOf(
          row,
          row.competitorId ?? row.sailNumber,
          view.display,
          ctx,
        ),
        fleets: row.fleetNames,
        ...(g.ratingColumns.length > 0 && row.ratings ? { ratings: row.ratings } : {}),
      })),
    })),
  };
  return [
    {
      key: COMPETITORS_KEY,
      apply(state, publishedAt) {
        state.competitors = { publishedAt, order: 0, value };
      },
    },
  ];
}

/** A championship's cells print their points as the engine holds them —
 *  "12", "(30 DNC)" — not to one decimal as a series table does. */
function championshipCellText(points: number, code: string | null, discarded: boolean): string {
  const text = `${points}${code ? ` ${code}` : ''}`;
  return discarded ? `(${text})` : text;
}

const CHAMPIONSHIP_KEY = 'championship';

function championshipParts(
  view: Extract<PageView, { kind: 'championship' }>,
  ctx: ViewContext,
): ContributedPart[] {
  const table: PublicApiStandingsTable = {
    fleet: { key: CHAMPIONSHIP_KEY, name: 'Championship' },
    subSeries: null,
    scoringSystem: 'scratch',
    namesLabel: namesLabelOf(view.display),
    races: view.columns.map((c) => ({ race: c.race, label: c.label, date: c.date, name: c.name })),
    rows: view.rows.map((row) => ({
      rank: row.rank,
      rankDisplay: row.rank === null ? '' : String(row.rank),
      competitor: competitorOf(row.competitor, row.competitorId, view.display, ctx),
      ...(row.fleet ? { fleet: row.fleet } : {}),
      scores: row.cells.map((c) =>
        c === null
          ? null
          : {
              points: c.points,
              code: c.code,
              discarded: c.discarded,
              ...(c.counts ? {} : { excluded: true }),
              display: championshipCellText(c.points, c.code, c.discarded),
            },
      ),
      total: row.total,
      net: row.net,
      totalDisplay: row.total === null ? null : String(row.total),
      netDisplay: row.net === null ? null : String(row.net),
    })),
  };
  return [
    {
      key: `t:${tableKey(null, CHAMPIONSHIP_KEY)}`,
      apply(state, publishedAt) {
        state.tables[tableKey(null, CHAMPIONSHIP_KEY)] = { publishedAt, order: 0, value: table };
      },
    },
  ];
}

/** Places within one fleet's sailing of a race, by points: a coded score
 *  takes no place, and tied points share one. */
function placesByPoints(results: Array<{ points: number; code: string | null }>): (number | null)[] {
  const finishers = results
    .map((r, i) => ({ i, points: r.points, coded: r.code !== null }))
    .filter((r) => !r.coded)
    .sort((a, b) => a.points - b.points);
  const places: (number | null)[] = results.map(() => null);
  let place = 0;
  let previous: number | null = null;
  finishers.forEach((r, idx) => {
    if (previous === null || r.points !== previous) place = idx + 1;
    places[r.i] = place;
    previous = r.points;
  });
  return places;
}

function championshipRaceParts(
  view: Extract<PageView, { kind: 'championship-races' }>,
  ctx: ViewContext,
): ContributedPart[] {
  return view.races.map((rf, order) => {
    const key = fleetKey(rf.fleetName);
    const sorted = [...rf.results].sort((a, b) => a.points - b.points);
    const places = placesByPoints(sorted);
    const raceFleet: PublicApiRaceFleet = {
      fleet: { key, name: rf.fleetName },
      subSeries: null,
      label: rf.label,
      startTime: rf.startTime,
      ratingLabel: null,
      results: sorted.map((r, i) => ({
        competitor: competitorOf(r.competitor, r.competitorId, view.display, ctx),
        rank: places[i],
        points: r.points,
        code: r.code,
        display: championshipCellText(r.points, r.code, false),
      })),
    };
    const k = raceFleetKey(rf.race, null, key);
    return {
      key: `r:${k}`,
      apply(state: PublishedViewState, publishedAt: number) {
        state.raceFleets[k] = {
          publishedAt,
          order,
          value: { race: rf.race, name: rf.name, date: rf.date, fleet: raceFleet },
        };
      },
    };
  });
}

function archiveParts(
  view: Extract<PageView, { kind: 'archive' }>,
  order: number,
  ctx: ViewContext,
): ContributedPart[] {
  const parts: ContributedPart[] = [];
  view.sections.forEach((section, si) => {
    const key = fleetKey(section.fleetName);
    const fleet = { key, name: section.fleetName };
    const competitorFor = (row: ArchiveSection['rows'][number]): PublicApiCompetitor => ({
      ...ctx.competitor(row.competitorId),
      sailNumber: row.competitor.sailNumber,
      names: row.competitor.names,
      details: section.leadColumns.map((label, i) => ({ label, value: row.leadCells[i] ?? '' })),
    });
    const table: PublicApiStandingsTable = {
      fleet,
      subSeries: null,
      scoringSystem: null,
      namesLabel: 'Competitor',
      ...(section.caption ? { caption: section.caption } : {}),
      races: section.races.map((r, i) => ({ race: i + 1, label: r.label, date: r.date, name: null })),
      rows: section.rows.map((row) => ({
        rank: row.rank,
        rankDisplay: row.rankLabel,
        competitor: competitorFor(row),
        scores: section.races.map((_, i) => {
          const cell = row.raceCells[i];
          if (!cell || cell.text.trim() === '') return null;
          return { points: null, code: null, discarded: !!cell.discard, display: cell.text };
        }),
        total: null,
        net: null,
        totalDisplay: null,
        netDisplay: null,
        summary: section.summaryColumns.map((label, i) => ({ label, value: row.summaryCells[i] ?? '' })),
      })),
    };
    const tk = tableKey(null, key);
    parts.push({
      key: `t:${tk}`,
      apply(state, publishedAt) {
        state.tables[tk] = { publishedAt, order: order * 100 + si, value: table };
      },
    });
    // A race's results are the column of the standings, with the source's
    // own per-race table where it printed one per race in the same order.
    const tablesAlign = section.raceTables.length === section.races.length;
    section.races.forEach((race, i) => {
      const n = i + 1;
      const results = section.rows
        .filter((row) => (row.raceCells[i]?.text ?? '').trim() !== '')
        .map((row) => ({
          competitor: competitorFor(row),
          rank: row.raceCells[i]?.rank ?? null,
          points: null,
          code: null,
          display: row.raceCells[i]!.text,
        }))
        .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
      const source = tablesAlign ? section.raceTables[i] : undefined;
      if (results.length === 0 && !source) return;
      const raceFleet: PublicApiRaceFleet = {
        fleet,
        subSeries: null,
        label: race.label,
        startTime: null,
        ratingLabel: null,
        results,
        ...(source
          ? {
              table: {
                ...(source.caption ? { caption: source.caption } : {}),
                columns: source.columns,
                rows: source.rows.map((r) => r.cells),
              },
            }
          : {}),
      };
      const k = raceFleetKey(n, null, key);
      parts.push({
        key: `r:${k}`,
        apply(state, publishedAt) {
          state.raceFleets[k] = {
            publishedAt,
            order: order * 100 + si,
            value: { race: n, name: null, date: race.date ?? source?.date ?? null, fleet: raceFleet },
          };
        },
      });
    });
  });
  return parts;
}

function scheduleParts(view: Extract<PageView, { kind: 'schedule' }>): ContributedPart[] {
  const value: SchedulePart = {
    races: view.races.map((r) => ({
      race: r.race,
      name: r.name,
      date: r.date,
      starts: r.starts.map((s) => ({ time: s.time, fleets: s.fleetNames.map(fleetKey) })),
      status: r.sailed ? ('sailed' as const) : ('scheduled' as const),
      ...(r.sailed && r.results ? { results: r.results } : {}),
    })),
  };
  return [
    {
      key: SCHEDULE_KEY,
      apply(state, publishedAt) {
        state.schedule = { publishedAt, order: 0, value };
      },
    },
  ];
}

function partsOf(view: PageView, order: number, ctx: ViewContext): ContributedPart[] {
  switch (view.kind) {
    case 'results':
      return view.sections.flatMap((s, i) => resultsSectionParts(s, order * 100 + i, ctx));
    case 'entries':
      return entriesParts(view, ctx);
    case 'championship':
      return championshipParts(view, ctx);
    case 'championship-races':
      return championshipRaceParts(view, ctx);
    case 'archive':
      return archiveParts(view, order, ctx);
    case 'schedule':
      return scheduleParts(view);
  }
}

/**
 * The view after one publish.
 *
 * Each contributing page replaces the parts it shows. `livePages` is the
 * publication's page list once this publish lands: a page no longer in it
 * (retracted, or dropped by the build) stops vouching for its parts, and a
 * part no live page shows is removed.
 */
export function applyPublish(
  previous: PublishedViewState | null,
  contributions: readonly PageContribution[],
  livePages: ReadonlySet<string>,
  publishedAt: number,
  ctx: ViewContext,
): PublishedViewState {
  const state: PublishedViewState = previous
    ? {
        version: 1,
        tables: { ...previous.tables },
        raceFleets: { ...previous.raceFleets },
        ...(previous.competitors ? { competitors: previous.competitors } : {}),
        ...(previous.schedule ? { schedule: previous.schedule } : {}),
        pages: { ...previous.pages },
      }
    : emptyPublishedView();
  contributions.forEach((c, order) => {
    const parts = partsOf(c.view, order, ctx);
    for (const part of parts) part.apply(state, publishedAt);
    state.pages[c.pageKey] = parts.map((p) => p.key);
  });
  return prune(state, livePages);
}

/** The view with only the parts some live page still shows. */
export function prune(state: PublishedViewState, livePages: ReadonlySet<string>): PublishedViewState {
  const pages = Object.fromEntries(
    Object.entries(state.pages).filter(([page]) => livePages.has(page)),
  );
  const shown = new Set(Object.values(pages).flat());
  return {
    version: 1,
    tables: Object.fromEntries(
      Object.entries(state.tables).filter(([k]) => shown.has(`t:${k}`)),
    ),
    raceFleets: Object.fromEntries(
      Object.entries(state.raceFleets).filter(([k]) => shown.has(`r:${k}`)),
    ),
    ...(state.competitors && shown.has(COMPETITORS_KEY) ? { competitors: state.competitors } : {}),
    ...(state.schedule && shown.has(SCHEDULE_KEY) ? { schedule: state.schedule } : {}),
    pages,
  };
}

// ---- Resources ----

/** The publication's own facts, restated on every publish. */
export type PublicationFacts = Omit<
  PublicApiPublication,
  'timeZone' | 'id' | 'url' | 'resources'
>;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function latest(parts: Array<{ publishedAt: number }>): number {
  return Math.max(...parts.map((p) => p.publishedAt));
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

/**
 * Every resource the view serves, keyed by its path below the publication
 * (`''` is the publication itself). A resource with nothing behind it is
 * absent, and the read route answers it 404.
 */
export function viewResources(
  state: PublishedViewState,
  publication: { id: string; facts: PublicationFacts },
  timeZone: string,
  apiBase: string,
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const base = { timeZone, publication: apiBase };
  const tables = Object.values(state.tables).sort(byOrder);
  const raceFleets = Object.values(state.raceFleets).sort(byOrder);
  const resources: PublicApiPublication['resources'] = {};

  if (tables.length > 0) {
    const standings: PublicApiStandings = {
      ...base,
      publishedAt: iso(latest(tables)),
      tables: tables.map((t) => t.value),
    };
    out.set('standings', standings);
    resources.standings = { url: `${apiBase}/standings`, publishedAt: standings.publishedAt };
    const byFleet = new Map<string, typeof tables>();
    for (const t of tables) {
      const list = byFleet.get(t.value.fleet.key) ?? [];
      list.push(t);
      byFleet.set(t.value.fleet.key, list);
    }
    for (const [key, list] of byFleet) {
      out.set(`standings/${key}`, {
        ...base,
        publishedAt: iso(latest(list)),
        tables: list.map((t) => t.value),
      } satisfies PublicApiStandings);
    }
  }

  if (raceFleets.length > 0) {
    const byRace = new Map<number, typeof raceFleets>();
    for (const rf of raceFleets) {
      const list = byRace.get(rf.value.race) ?? [];
      list.push(rf);
      byRace.set(rf.value.race, list);
    }
    const numbers = [...byRace.keys()].sort((a, b) => a - b);
    const races: PublicApiRaces = {
      ...base,
      publishedAt: iso(latest(raceFleets)),
      races: numbers.map((n) => {
        const list = byRace.get(n)!;
        const first = list[0]!.value;
        const starts = new Map<string, string[]>();
        for (const rf of list) {
          const time = rf.value.fleet.startTime ?? '';
          const fleets = starts.get(time) ?? [];
          if (!fleets.includes(rf.value.fleet.fleet.key)) fleets.push(rf.value.fleet.fleet.key);
          starts.set(time, fleets);
        }
        return {
          race: n,
          name: list.map((rf) => rf.value.name).find((x) => x) ?? null,
          date: first.date,
          starts: [...starts.entries()]
            .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
            .map(([time, fleets]) => ({ time: time || null, fleets })),
          fleets: [...new Set(list.map((rf) => rf.value.fleet.fleet.key))],
          url: `${apiBase}/races/${n}`,
        };
      }),
    };
    out.set('races', races);
    resources.races = { url: `${apiBase}/races`, publishedAt: races.publishedAt };
    for (const n of numbers) {
      const list = byRace.get(n)!;
      const race: PublicApiRace = {
        ...base,
        publishedAt: iso(latest(list)),
        race: n,
        name: list.map((rf) => rf.value.name).find((x) => x) ?? null,
        date: list[0]!.value.date,
        fleets: list.map((rf) => rf.value.fleet),
      };
      out.set(`races/${n}`, race);
    }
  }

  if (state.competitors) {
    const competitors: PublicApiCompetitors = {
      ...base,
      publishedAt: iso(state.competitors.publishedAt),
      ...state.competitors.value,
    };
    out.set('competitors', competitors);
    resources.competitors = { url: `${apiBase}/competitors`, publishedAt: competitors.publishedAt };
  }

  if (state.schedule) {
    const schedule: PublicApiSchedule = {
      ...base,
      publishedAt: iso(state.schedule.publishedAt),
      ...state.schedule.value,
    };
    out.set('schedule', schedule);
    resources.schedule = { url: `${apiBase}/schedule`, publishedAt: schedule.publishedAt };
  }

  const pub: PublicApiPublication = {
    timeZone,
    id: publication.id,
    url: apiBase,
    ...publication.facts,
    resources,
  };
  out.set('', pub);
  return out;
}
