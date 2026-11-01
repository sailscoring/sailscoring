/**
 * The columns of a series' results tables: which competitor columns a
 * standings, race-results or entry-list table shows, in what order, under
 * what titles (`docs/design/results-columns.md`).
 *
 * This module decides the columns and nothing else. The renderers — the
 * published HTML, the in-app Standings tab — each turn a column key into a
 * cell their own way, so a column means the same thing everywhere it is
 * drawn.
 *
 * Pure and client-safe: no database, no DOM.
 */

import {
  boatClassDistinguishes,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  isFieldDisabledByPrimary,
  personFieldHeader,
  primaryPersonHeader,
} from './competitor-fields';
import type {
  CompetitorFieldKey,
  CustomField,
  MultiPersonFieldKey,
  PrimaryPersonLabel,
  ResultsColumn,
  ResultsTable,
  SubdivisionAxis,
} from './types';

export type { ResultsTable } from './types';

export const RESULTS_TABLES: readonly ResultsTable[] = ['standings', 'races', 'entries'];

/**
 * A competitor column. Most are a competitor field; `rank` is the row's
 * position (the series rank in the standings, the race rank in a race
 * table), `fleet` the fleets an entry is in (the entry list's ungrouped
 * table), and `primary` the series' primary person. A subdivision axis is
 * `subdivision:<axisId>`.
 */
export type CompetitorColumnKey =
  | 'rank'
  | 'fleet'
  | 'sailNumber'
  | 'bowNumber'
  | 'entryNumber'
  | 'tallyNumber'
  | 'boatName'
  | 'boatClass'
  | 'primary'
  | 'helm'
  | 'owner'
  | 'crewName'
  | 'club'
  | 'nationality'
  | 'worldSailingId'
  | 'age'
  | 'gender'
  | 'country'
  | `subdivision:${string}`
  | `field:${string}`;

/** The competitor columns that are a fixed field, as opposed to a
 *  subdivision axis or a custom field. */
export const FIXED_COMPETITOR_COLUMNS: readonly CompetitorColumnKey[] = [
  'rank', 'fleet', 'sailNumber', 'bowNumber', 'entryNumber', 'tallyNumber',
  'boatName', 'boatClass', 'primary', 'helm', 'owner', 'crewName', 'club',
  'nationality', 'country', 'worldSailingId', 'age', 'gender',
];

/** Competitor columns every table keeps: every row has to say whose it is. */
export const REQUIRED_COLUMNS: readonly CompetitorColumnKey[] = ['sailNumber', 'primary'];

/**
 * The standings table's scoring columns, after its competitor columns and
 * races, in their fixed order. `perRaceRatings` is the progressive-handicap
 * seed-rating column with each race's applied rating beneath its score.
 */
export const STANDINGS_SCORING_COLUMNS = ['perRaceRatings', 'total', 'nett'] as const;

/**
 * A race table's scoring columns, after its competitor columns, in their
 * fixed order: the elapsed → rating → corrected arithmetic reads left to
 * right. `ratingCalculations` is the NHC and ECHO working (Q, S, α, Z,
 * Adjustment; 1/T_E, PI, Adjustment), shown and hidden together. The
 * `track:` columns are RaceSense track data, on tables only while the series
 * publishes it.
 */
export const RACE_SCORING_COLUMNS = [
  'laps',
  'finish',
  'elapsed',
  'rating',
  'corrected',
  'delta',
  'impliedWind',
  'newRating',
  'ratingCalculations',
  'points',
  'track:finishTime',
  'track:elapsed',
  'track:distance',
  'track:avgSpeed',
  'track:maxSpeed',
  'track:dtl',
] as const;

export type StandingsScoringColumnKey = (typeof STANDINGS_SCORING_COLUMNS)[number];
export type RaceScoringColumnKey = (typeof RACE_SCORING_COLUMNS)[number];

/** Scoring columns that can be retitled but not hidden: a race table is its
 *  points. */
export const UNHIDEABLE_SCORING_COLUMNS: readonly string[] = ['points'];

/** Longest a column title's line may run. */
export const COLUMN_TITLE_MAX_LENGTH = 40;
/** Lines a column title may run to — two, for a title in two languages. */
export const COLUMN_TITLE_MAX_LINES = 2;
/** Longest a custom field's name may run. */
export const CUSTOM_FIELD_LABEL_MAX_LENGTH = 40;

/** The custom field a `field:<id>` key names, if it is one. */
export function customFieldId(key: string): string | null {
  return key.startsWith('field:') ? key.slice('field:'.length) : null;
}

/** Whether a key is a competitor column (as opposed to a scoring column). */
export function isCompetitorColumnKey(key: string): key is CompetitorColumnKey {
  return (
    (FIXED_COMPETITOR_COLUMNS as readonly string[]).includes(key) ||
    subdivisionAxisId(key) != null ||
    customFieldId(key) != null
  );
}

/** Whether a key is a scoring column of either table. */
export function isScoringColumnKey(key: string): boolean {
  return (
    (STANDINGS_SCORING_COLUMNS as readonly string[]).includes(key) ||
    (RACE_SCORING_COLUMNS as readonly string[]).includes(key)
  );
}

/** The lines of a column title as the scorer wrote it, blank lines dropped. */
export function titleLines(title: string): string[] {
  return title.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

/**
 * What is wrong with a series' own columns, worded as the Results columns
 * dialog words it; empty when nothing is. One validator, used wherever the
 * list is written. With `series`, a column naming a subdivision axis or
 * custom field the series doesn't have is a problem too; without it (the
 * API boundary, which validates the list on its own), such a column is left
 * for the renderer to skip, as it skips any column whose field is gone.
 */
export function resultsColumnsProblems(
  columns: readonly ResultsColumn[],
  series?: { subdivisionAxes?: readonly SubdivisionAxis[]; customFields?: readonly CustomField[] },
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const column of columns) {
    const { key } = column;
    if (seen.has(key)) {
      problems.push(`The column ${key} is listed twice.`);
      continue;
    }
    seen.add(key);
    const competitor = isCompetitorColumnKey(key);
    if (!competitor && !isScoringColumnKey(key)) {
      problems.push(`There is no column ${key}.`);
      continue;
    }
    const axisId = subdivisionAxisId(key);
    if (series && axisId != null && !series.subdivisionAxes?.some((a) => a.id === axisId)) {
      problems.push('A column shows a subdivision this series doesn’t have.');
    }
    const fieldId = customFieldId(key);
    if (series && fieldId != null && !series.customFields?.some((f) => f.id === fieldId)) {
      problems.push('A column shows a custom field this series doesn’t have.');
    }
    if (column.title != null) {
      const lines = column.title.split('\n');
      if (lines.length > COLUMN_TITLE_MAX_LINES) problems.push('A title can have at most two lines.');
      if (lines.some((l) => l.trim().length > COLUMN_TITLE_MAX_LENGTH)) {
        problems.push(`Keep the title to ${COLUMN_TITLE_MAX_LENGTH} characters or fewer.`);
      }
    }
    if (competitor) {
      if (column.hidden) problems.push('A competitor column is removed, not hidden.');
      if (column.tables != null) {
        if (column.tables.length === 0) problems.push('Tick at least one table, or remove the column.');
        if (new Set(column.tables).size !== column.tables.length) problems.push(`The column ${key} names a table twice.`);
      }
    } else {
      if (column.tables != null || column.showWhenEmpty || column.joinNames || column.inPrimary) {
        problems.push(`The scoring column ${key} can only be hidden or retitled.`);
      }
      if (column.hidden && UNHIDEABLE_SCORING_COLUMNS.includes(key)) {
        problems.push('The Points column can’t be hidden.');
      }
    }
    if (column.inPrimary && key !== 'crewName') problems.push('Only the crew can share the primary column.');
  }
  for (const key of REQUIRED_COLUMNS) {
    if (!seen.has(key)) {
      problems.push(key === 'sailNumber' ? 'The sail number column can’t be removed.' : 'The primary name column can’t be removed.');
    }
  }
  return problems;
}

/** What a series says about its competitor fields: the inputs every column
 *  decision reads. */
export interface ColumnSettings {
  enabledCompetitorFields: readonly CompetitorFieldKey[];
  primaryPersonLabel?: PrimaryPersonLabel;
  multiPersonFields?: readonly MultiPersonFieldKey[];
  subdivisionAxes?: readonly SubdivisionAxis[];
  customFields?: readonly CustomField[];
  /** The series' own columns; absent = automatic columns. */
  resultsColumns?: readonly ResultsColumn[];
}

/**
 * The competitor fields of one table row, as the column decisions read
 * them. Named as the results rows name them: `helm` is the primary
 * person(s), `helmRole` a separately recorded helm.
 */
export interface ColumnRow {
  bowNumber?: string;
  entryNumber?: string;
  tallyNumber?: string;
  boatName?: string;
  boatClass?: string;
  helmRole?: string[];
  owner?: string[];
  crewNames?: string[];
  clubs?: string[];
  nationality?: string;
  worldSailingId?: string;
  subdivisions?: Record<string, string>;
  gender?: 'M' | 'F' | '';
  age?: number | null;
  customFields?: Record<string, string>;
}

/** One column of a table, decided. */
export interface CompetitorColumn {
  key: CompetitorColumnKey;
  /** The column's heading, as plain text. A title the scorer gave two lines
   *  carries them split by "\n". */
  header: string;
  /** On `primary`: the crew share this column ("Helm / Crew"). */
  pairCrew?: boolean;
  /** Several names on one line, joined with " & ". On `primary` paired with
   *  the crew, `joinCrew` says the same of the crew. */
  joinNames?: boolean;
  joinCrew?: boolean;
}

/** The subdivision axis a `subdivision:<id>` key names, if it is one. */
export function subdivisionAxisId(key: string): string | null {
  return key.startsWith('subdivision:') ? key.slice('subdivision:'.length) : null;
}

/** The `<col>` class a column has always published under — page styles and
 *  readers' own stylesheets target them. */
export function columnClass(key: CompetitorColumnKey): string {
  if (subdivisionAxisId(key) != null) return 'subdivision';
  if (customFieldId(key) != null) return 'customfield';
  switch (key) {
    case 'rank': return 'rank';
    case 'fleet': return 'fleet';
    case 'sailNumber': return 'sailno';
    case 'bowNumber': return 'bowno';
    case 'entryNumber': return 'entryno';
    case 'tallyNumber': return 'tally';
    case 'boatName': return 'boatname';
    case 'boatClass': return 'boatclass';
    case 'primary': return 'helmname';
    case 'helm': return 'helm';
    case 'owner': return 'owner';
    case 'crewName': return 'crew';
    case 'club': return 'club';
    case 'nationality': return 'nat';
    case 'worldSailingId': return 'wsid';
    case 'age': return 'age';
    case 'gender': return 'gender';
    case 'country': return 'country';
  }
  return 'competitor';
}

/** The person-column headings, which depend on the series' primary label and
 *  on which person fields take several names. */
function personHeaders(settings: ColumnSettings) {
  const multi = settings.multiPersonFields ? [...settings.multiPersonFields] : undefined;
  const primaryLabel = settings.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  return {
    primaryLabel,
    primary: primaryPersonHeader(primaryLabel, multi),
    helm: personFieldHeader('helm', multi),
    owner: personFieldHeader('owner', multi),
    crew: personFieldHeader('crewName', multi),
  };
}

/** A column's default heading: the one it has under automatic columns. */
export function defaultColumnHeader(
  key: CompetitorColumnKey,
  settings: ColumnSettings,
  opts?: { pairCrew?: boolean },
): string {
  const axisId = subdivisionAxisId(key);
  if (axisId != null) {
    const axis = settings.subdivisionAxes?.find((a) => a.id === axisId);
    return axis?.label?.trim() || DEFAULT_SUBDIVISION_LABEL;
  }
  const fieldId = customFieldId(key);
  if (fieldId != null) {
    return settings.customFields?.find((f) => f.id === fieldId)?.label.trim() || 'Custom field';
  }
  const people = personHeaders(settings);
  switch (key) {
    case 'rank': return 'Rank';
    case 'fleet': return 'Fleet';
    case 'sailNumber': return 'Sail Number';
    case 'bowNumber': return 'Bow';
    case 'entryNumber': return 'Entry';
    case 'tallyNumber': return 'Tally';
    case 'boatName': return 'Boat';
    case 'boatClass': return 'Class';
    case 'primary': return opts?.pairCrew ? `${people.primary} / ${people.crew}` : people.primary;
    case 'helm': return people.helm;
    case 'owner': return people.owner;
    case 'crewName': return people.crew;
    case 'club': return 'Club';
    case 'nationality': return 'Nationality';
    case 'worldSailingId': return 'World Sailing ID';
    case 'age': return 'Age';
    case 'gender': return 'Gender';
    case 'country': return 'Country';
  }
  return key;
}

/** Whether any row has a value for a column — the test behind leaving a
 *  column off a table no boat has a value in. For the Class column the test
 *  is that the boats differ: a table of one class gains nothing from a
 *  column repeating it. */
export function columnHasValues(key: CompetitorColumnKey, rows: readonly ColumnRow[]): boolean {
  const axisId = subdivisionAxisId(key);
  if (axisId != null) return rows.some((r) => !!r.subdivisions?.[axisId]);
  const fieldId = customFieldId(key);
  if (fieldId != null) return rows.some((r) => !!r.customFields?.[fieldId]?.trim());
  switch (key) {
    case 'bowNumber': return rows.some((r) => !!r.bowNumber);
    case 'entryNumber': return rows.some((r) => !!r.entryNumber);
    case 'tallyNumber': return rows.some((r) => !!r.tallyNumber);
    case 'boatName': return rows.some((r) => !!r.boatName);
    case 'boatClass': return boatClassDistinguishes(rows.map((r) => r.boatClass));
    case 'helm': return rows.some((r) => (r.helmRole?.length ?? 0) > 0);
    case 'owner': return rows.some((r) => (r.owner?.length ?? 0) > 0);
    case 'crewName': return rows.some((r) => (r.crewNames?.length ?? 0) > 0);
    case 'club': return rows.some((r) => (r.clubs?.length ?? 0) > 0);
    case 'nationality':
    case 'country':
      return rows.some((r) => !!r.nationality);
    case 'worldSailingId': return rows.some((r) => !!r.worldSailingId);
    case 'age': return rows.some((r) => r.age != null);
    case 'gender': return rows.some((r) => !!r.gender);
  }
  return true;
}

/**
 * The automatic columns for one table: the columns the app chooses from the
 * fields switched on, leaving out the ones no boat has a value in.
 *
 * `rows` are the rows whose values decide that. A fleet's standings and race
 * tables pass every row of both, so the two carry the same columns and a
 * reader moving between them finds each one where it was. The entry list
 * passes its whole page.
 *
 * The standings and race tables print the Boat, Helm, Owner and Crew columns
 * whenever their field is switched on; the entry list, published before any
 * of that may be filled in, leaves them off when no entry has one.
 */
export function automaticColumns(
  settings: ColumnSettings,
  table: ResultsTable,
  rows: readonly ColumnRow[],
  opts?: { multiFleet?: boolean },
): CompetitorColumn[] {
  const on = (k: CompetitorFieldKey) => settings.enabledCompetitorFields.includes(k);
  const { primaryLabel } = personHeaders(settings);
  const entries = table === 'entries';
  const shown = (field: CompetitorFieldKey, key: CompetitorColumnKey = field as CompetitorColumnKey) =>
    on(field) && columnHasValues(key, rows);
  // The standings and race tables keep these whenever they are switched on.
  const kept = (field: CompetitorFieldKey) => (entries ? shown(field) : on(field));

  const showHelm = !isFieldDisabledByPrimary('helm', primaryLabel) && kept('helm');
  const showOwner = !isFieldDisabledByPrimary('owner', primaryLabel) && kept('owner');
  const showCrew = kept('crewName');
  const { pairCrew, showCrewColumn } = crewLayout(showCrew, showHelm);

  const keys: CompetitorColumnKey[] = [];
  if (entries) {
    if (opts?.multiFleet) keys.push('fleet');
  } else {
    keys.push('rank');
  }
  keys.push('sailNumber');
  if (shown('bowNumber')) keys.push('bowNumber');
  if (shown('entryNumber')) keys.push('entryNumber');
  if (shown('tallyNumber')) keys.push('tallyNumber');
  if (kept('boatName')) keys.push('boatName');
  if (shown('boatClass')) keys.push('boatClass');
  keys.push('primary');
  if (showHelm) keys.push('helm');
  if (showOwner) keys.push('owner');
  if (showCrewColumn) keys.push('crewName');
  if (shown('club')) keys.push('club');
  if (shown('nationality')) keys.push('nationality');
  if (shown('worldSailingId')) keys.push('worldSailingId');
  if (on('subdivision')) {
    for (const axis of settings.subdivisionAxes ?? []) {
      const key = `subdivision:${axis.id}` as const;
      if (columnHasValues(key, rows)) keys.push(key);
    }
  }
  if (shown('age')) keys.push('age');
  if (shown('gender')) keys.push('gender');
  // Custom fields come last, each left off when no boat has a value.
  for (const field of settings.customFields ?? []) {
    const key = `field:${field.id}` as const;
    if (columnHasValues(key, rows)) keys.push(key);
  }

  return keys.map((key) => ({
    key,
    header: defaultColumnHeader(key, settings, { pairCrew: key === 'primary' && pairCrew }),
    ...(key === 'primary' && pairCrew ? { pairCrew: true } : {}),
  }));
}

/**
 * The competitor columns for one table: the series' own columns when it has
 * them, otherwise the automatic ones.
 */
export function tableColumns(
  settings: ColumnSettings,
  table: ResultsTable,
  rows: readonly ColumnRow[],
  opts?: { multiFleet?: boolean },
): CompetitorColumn[] {
  return settings.resultsColumns
    ? ownColumns(settings, settings.resultsColumns, table, rows, opts)
    : automaticColumns(settings, table, rows, opts);
}

/**
 * Whether a competitor column can appear on a table at all: its field is
 * switched on, its subdivision axis or custom field still exists, and it
 * means something there — Rank is not on an entry list, the Fleet column
 * only on the entry list's single table across several fleets.
 */
export function columnAvailable(
  key: CompetitorColumnKey,
  settings: ColumnSettings,
  table: ResultsTable,
  opts?: { multiFleet?: boolean },
): boolean {
  const on = (k: CompetitorFieldKey) => settings.enabledCompetitorFields.includes(k);
  const primaryLabel = settings.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const axisId = subdivisionAxisId(key);
  if (axisId != null) return on('subdivision') && !!settings.subdivisionAxes?.some((a) => a.id === axisId);
  const fieldId = customFieldId(key);
  if (fieldId != null) return !!settings.customFields?.some((f) => f.id === fieldId);
  switch (key) {
    case 'rank': return table !== 'entries';
    case 'fleet': return table === 'entries' && opts?.multiFleet === true;
    case 'sailNumber':
    case 'primary':
      return true;
    case 'helm':
    case 'owner':
      return on(key) && !isFieldDisabledByPrimary(key, primaryLabel);
    case 'country': return on('nationality');
  }
  return on(key as CompetitorFieldKey);
}

/** The series' own columns for one table, in its order, each under its own
 *  title where it has one. */
function ownColumns(
  settings: ColumnSettings,
  list: readonly ResultsColumn[],
  table: ResultsTable,
  rows: readonly ColumnRow[],
  opts?: { multiFleet?: boolean },
): CompetitorColumn[] {
  const crew = list.find((c) => c.key === 'crewName');
  const crewInPrimary = crew?.inPrimary === true && columnAvailable('crewName', settings, table, opts);
  const out: CompetitorColumn[] = [];
  for (const column of list) {
    if (!isCompetitorColumnKey(column.key)) continue;
    const key = column.key;
    if (!columnAvailable(key, settings, table, opts)) continue;
    if (column.tables && !column.tables.includes(table)) continue;
    if (key === 'crewName' && crewInPrimary) continue;
    const always = key === 'rank' || key === 'fleet' || (REQUIRED_COLUMNS as readonly string[]).includes(key);
    if (!always && !column.showWhenEmpty && !columnHasValues(key, rows)) continue;
    const pairCrew = key === 'primary' && crewInPrimary;
    const title = column.title != null ? titleLines(column.title).join('\n') : '';
    out.push({
      key,
      header: title || defaultColumnHeader(key, settings, { pairCrew }),
      ...(pairCrew ? { pairCrew: true } : {}),
      ...(column.joinNames ? { joinNames: true } : {}),
      ...(pairCrew && crew?.joinNames ? { joinCrew: true } : {}),
    });
  }
  return out;
}

/** What a series says about its scoring columns: its own list, and the
 *  publishing toggles that decide two of them under automatic columns. */
export interface ScoringColumnSettings {
  resultsColumns?: readonly ResultsColumn[];
  publishRatingCalculations?: boolean;
  showPerRaceRatingsInSummary?: boolean;
}

/**
 * Whether a scoring column is shown. Under automatic columns every one is,
 * except that the NHC and ECHO working and the per-race ratings follow the
 * Publishing card's toggles. With the series' own columns the list decides;
 * a scoring column it doesn't mention is shown, since it is part of the
 * table rather than a choice the scorer made.
 */
export function scoringColumnShown(
  settings: ScoringColumnSettings,
  key: StandingsScoringColumnKey | RaceScoringColumnKey,
): boolean {
  if (settings.resultsColumns) {
    const column = settings.resultsColumns.find((c) => c.key === key);
    return column ? column.hidden !== true || UNHIDEABLE_SCORING_COLUMNS.includes(key) : true;
  }
  if (key === 'ratingCalculations') return settings.publishRatingCalculations ?? true;
  if (key === 'perRaceRatings') return settings.showPerRaceRatingsInSummary ?? true;
  return true;
}

/** A scoring column's own title, as its lines split by "\n", or undefined
 *  for its default. */
export function scoringColumnTitle(
  columns: readonly ResultsColumn[] | undefined,
  key: StandingsScoringColumnKey | RaceScoringColumnKey,
): string | undefined {
  const title = columns?.find((c) => c.key === key)?.title;
  const lines = title != null ? titleLines(title) : [];
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/** Where the crew go. Beside the primary ("Helm / Crew") when the primary is
 *  the only person column: in a helm-primary series that is the helm, and
 *  elsewhere the entry's one name. When a separate Helm column is shown, the
 *  primary is not the helm, and pairing the crew with it would put them
 *  under the wrong person, so they take a column of their own instead. */
function crewLayout(showCrew: boolean, showHelm: boolean): { pairCrew: boolean; showCrewColumn: boolean } {
  return { pairCrew: showCrew && !showHelm, showCrewColumn: showCrew && showHelm };
}

/** The labels the built-in competitor fields go by, which a custom field
 *  can't take: a scorer looking for Class finds one Class. */
const BUILT_IN_FIELD_NAMES = [
  'sail number', 'sail no', 'bow', 'bow number', 'entry', 'entry number', 'tally', 'tally number',
  'boat', 'boat name', 'class', 'helm', 'owner', 'crew', 'club', 'nationality', 'nat', 'country',
  'world sailing id', 'age', 'gender', 'rank', 'fleet',
];

/** Longest a custom field's value may run. */
export const CUSTOM_FIELD_VALUE_MAX_LENGTH = 200;

/** What is wrong with a series' custom fields, worded as the Competitor
 *  fields card words it; empty when nothing is. */
export function customFieldsProblems(fields: readonly CustomField[]): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const field of fields) {
    const label = field.label.trim();
    if (!field.id) problems.push('A custom field has no id.');
    else if (ids.has(field.id)) problems.push('Two custom fields share an id.');
    ids.add(field.id);
    if (!label) {
      problems.push('Name is required.');
      continue;
    }
    if (label.length > CUSTOM_FIELD_LABEL_MAX_LENGTH) {
      problems.push(`Keep the name to ${CUSTOM_FIELD_LABEL_MAX_LENGTH} characters or fewer.`);
    }
    const key = label.toLowerCase();
    if (BUILT_IN_FIELD_NAMES.includes(key)) {
      problems.push(`${label} is already a field. To publish it under another title, retitle its column.`);
    } else if (names.has(key)) {
      problems.push(`This series already has a field called ${label}.`);
    }
    names.add(key);
  }
  return problems;
}

/**
 * The custom fields a series publishes: every one under automatic columns,
 * which show them all, and under the series' own columns only those that are
 * a column. A custom field leaves the app only as a column, so this is the
 * set the public export and the published results API may carry.
 */
export function publishedCustomFields(series: {
  customFields?: readonly CustomField[];
  resultsColumns?: readonly ResultsColumn[];
}): CustomField[] {
  const fields = [...(series.customFields ?? [])];
  if (!series.resultsColumns) return fields;
  const keys = new Set(series.resultsColumns.map((c) => c.key));
  return fields.filter((f) => keys.has(`field:${f.id}`));
}

/** A competitor's values for the given fields, or undefined when it has none
 *  (sparse, as stored). */
export function customFieldValues(
  values: Record<string, string> | undefined,
  fields: readonly CustomField[],
): Record<string, string> | undefined {
  if (!values) return undefined;
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.id]?.trim();
    if (v) out[f.id] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * A series' own columns with a competitor column added at the end of the
 * competitor columns, on every table — where a field switched on, or a
 * custom field just added, appears while the series sets its own columns.
 * Unchanged when the column is already listed.
 */
export function withCompetitorColumn(list: readonly ResultsColumn[], key: CompetitorColumnKey): ResultsColumn[] {
  if (list.some((c) => c.key === key)) return [...list];
  let at = -1;
  list.forEach((c, i) => {
    if (isCompetitorColumnKey(c.key)) at = i;
  });
  return [...list.slice(0, at + 1), { key }, ...list.slice(at + 1)];
}

/** A series' own columns without a column. */
export function withoutColumn(list: readonly ResultsColumn[], key: string): ResultsColumn[] {
  return list.filter((c) => c.key !== key);
}
