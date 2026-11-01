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
  MultiPersonFieldKey,
  PrimaryPersonLabel,
  SubdivisionAxis,
} from './types';

/** The three kinds of table a competitor column can appear on. */
export type ResultsTable = 'standings' | 'races' | 'entries';

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
  | `subdivision:${string}`;

/** What a series says about its competitor fields: the inputs every column
 *  decision reads. */
export interface ColumnSettings {
  enabledCompetitorFields: readonly CompetitorFieldKey[];
  primaryPersonLabel?: PrimaryPersonLabel;
  multiPersonFields?: readonly MultiPersonFieldKey[];
  subdivisionAxes?: readonly SubdivisionAxis[];
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
}

/** One column of a table, decided. */
export interface CompetitorColumn {
  key: CompetitorColumnKey;
  /** The column's heading, as plain text. */
  header: string;
  /** On `primary`: the crew share this column ("Helm / Crew"). */
  pairCrew?: boolean;
}

/** The subdivision axis a `subdivision:<id>` key names, if it is one. */
export function subdivisionAxisId(key: string): string | null {
  return key.startsWith('subdivision:') ? key.slice('subdivision:'.length) : null;
}

/** The `<col>` class a column has always published under — page styles and
 *  readers' own stylesheets target them. */
export function columnClass(key: CompetitorColumnKey): string {
  if (subdivisionAxisId(key) != null) return 'subdivision';
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
    case 'nationality': return rows.some((r) => !!r.nationality);
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

  return keys.map((key) => ({
    key,
    header: defaultColumnHeader(key, settings, { pairCrew: key === 'primary' && pairCrew }),
    ...(key === 'primary' && pairCrew ? { pairCrew: true } : {}),
  }));
}

/** Where the crew go. Beside the primary ("Helm / Crew") when the primary is
 *  the only person column: in a helm-primary series that is the helm, and
 *  elsewhere the entry's one name. When a separate Helm column is shown, the
 *  primary is not the helm, and pairing the crew with it would put them
 *  under the wrong person, so they take a column of their own instead. */
function crewLayout(showCrew: boolean, showHelm: boolean): { pairCrew: boolean; showCrewColumn: boolean } {
  return { pairCrew: showCrew && !showHelm, showCrewColumn: showCrew && showHelm };
}
