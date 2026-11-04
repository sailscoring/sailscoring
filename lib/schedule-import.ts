/**
 * Reading a race schedule from a spreadsheet: one row per race, turned into
 * the races and starts the Races tab's generator would create.
 *
 * A row carries the race's date (required), optionally a name and a race
 * number, and its guns in one of two layouts:
 *
 * - a single **Start** column — one gun per race, run through the series'
 *   default start sequence, as Add multiple races does with irregular dates;
 * - a column **per fleet** — each fleet's own gun. Fleets on the same time
 *   share a start; a blank or a dash means that fleet doesn't sail the race.
 *
 * Not every gun is known when a schedule is written: the second race of a
 * day goes "as soon as possible" after the first. A cell reading ASAP, TBC,
 * TBA or "after" is a start with no gun time, to be filled in on the day —
 * anything else that isn't a time is an error, so a mistyped time is never
 * read as an untimed start. Untimed fleets start together where the default
 * start sequence puts them together, and separately otherwise.
 *
 * A row's race number is an ordering hint only: races are appended after
 * the series' existing ones and numbered by the server.
 */

import { normalizeFleetName } from './finish-sheet-csv';
import { HEADER_SCAN_ROWS } from './import-table';
import { MAX_GENERATED_RACES } from './race-schedule';
import { generateStarts } from './start-sequence';
import { normalizeTimeInput } from './time-parse';
import type { Fleet, StartGroup } from './types';

/**
 * What a column is read as. A fleet column carries the fleet's id; the
 * encoding is a plain string so it can be a select's value.
 */
export type ScheduleField = 'date' | 'name' | 'race' | 'start' | 'ignore' | `fleet:${string}`;

export type ScheduleColumnMap = Record<number, ScheduleField>;

export function fleetField(fleetId: string): ScheduleField {
  return `fleet:${fleetId}`;
}

export function fleetIdOf(field: ScheduleField): string | null {
  return field.startsWith('fleet:') ? field.slice('fleet:'.length) : null;
}

/** "Start: ILCA & 420", "Start - Toppers", "ILCA & 420 start" — the fleet
 *  named in a per-fleet start column's heading. */
function fleetNameInHeading(header: string): string {
  return header
    .trim()
    .replace(/^(start|gun|first\s+start)\s*[:\-–—]\s*/i, '')
    .replace(/\s*[:\-–—]?\s*(start|gun)$/i, '')
    .trim();
}

/**
 * The fleet a heading names, compared the way the finish-sheet importer
 * compares a class column: case, spacing and punctuation are noise. An exact
 * match wins; failing that, a single fleet whose name contains the heading
 * (or the heading the fleet's name). Two such fleets is no match — a heading
 * that could be either is left for the scorer to point.
 */
export function matchFleetHeading(header: string, fleets: readonly Fleet[]): Fleet | null {
  const wanted = normalizeFleetName(fleetNameInHeading(header));
  if (!wanted) return null;
  const exact = fleets.filter((f) => normalizeFleetName(f.name) === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = fleets.filter((f) => {
    const name = normalizeFleetName(f.name);
    return name.includes(wanted) || wanted.includes(name);
  });
  return loose.length === 1 ? loose[0] : null;
}

/** The field a column heading suggests, given the series' fleets. */
export function detectScheduleField(header: string, fleets: readonly Fleet[]): ScheduleField {
  const h = header.trim().toLowerCase();
  if (!h) return 'ignore';
  if (/^(race\s*)?date$|^day$|^date\s+of\s+race$/.test(h)) return 'date';
  if (/^(race\s*)?(no\.?|number|num|#)$|^race$|^r$/.test(h)) return 'race';
  if (/^(race\s*)?name$|^title$|^event$|^description$/.test(h)) return 'name';
  if (/^(first\s*)?(start|gun)(\s*time)?$|^time$/.test(h)) return 'start';
  const fleet = matchFleetHeading(header, fleets);
  return fleet ? fleetField(fleet.id) : 'ignore';
}

/**
 * The index of the row holding the column headings: the first of the opening
 * {@link HEADER_SCAN_ROWS} rows with a cell that reads as the date column.
 * A schedule can open with a title or the club's name; without a date heading
 * anywhere the first row is taken, and the mapping step lets the scorer say
 * which column is the date.
 */
export function findScheduleHeaderRow(rows: readonly string[][]): number {
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    if (rows[i].some((cell) => detectScheduleField(cell, []) === 'date')) return i;
  }
  return 0;
}

/** Why a mapping can't be read, or null when it can. */
export function scheduleMappingProblem(
  columnMap: ScheduleColumnMap,
  opts: { hasStartSequence: boolean },
): string | null {
  const fields = Object.values(columnMap);
  if (!fields.includes('date')) return 'Choose the column that holds each race’s date.';
  for (const single of ['date', 'name', 'race', 'start'] as const) {
    if (fields.filter((f) => f === single).length > 1) {
      return `Only one column can be the ${single === 'race' ? 'race number' : single}.`;
    }
  }
  const fleetIds = fields.flatMap((f) => fleetIdOf(f) ?? []);
  if (new Set(fleetIds).size !== fleetIds.length) {
    return 'Two columns are pointed at the same fleet.';
  }
  const hasStart = fields.includes('start');
  if (hasStart && fleetIds.length > 0) {
    return 'Use either one Start column or a column per fleet, not both.';
  }
  if (hasStart && !opts.hasStartSequence) {
    return 'A single Start column runs the default start sequence, and this series has none. Set one in Settings ▸ Fleets, or give each fleet its own column.';
  }
  return null;
}

/** Cells that say a fleet doesn't sail the race. */
const NOT_SAILING = /^[-–—]+$|^(n\/?a|none|no)$/i;

/** Cells that say the start happens but its gun isn't fixed. */
const UNTIMED = /^(asap|a\.s\.a\.p\.?|tbc|tba|tbd|after|follows?|\?)$/i;

type GunCell = { kind: 'time'; time: string } | { kind: 'untimed' } | { kind: 'none' } | { kind: 'bad' };

function readGun(raw: string): GunCell {
  const s = raw.trim();
  if (!s || NOT_SAILING.test(s)) return { kind: 'none' };
  if (UNTIMED.test(s)) return { kind: 'untimed' };
  const time = normalizeTimeInput(s);
  if (!time || Number(time.slice(0, 2)) > 23) return { kind: 'bad' };
  return { kind: 'time', time };
}

/** A real calendar date "YYYY-MM-DD", or null. */
function validIso(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const back = new Date(Date.UTC(y, mo - 1, d));
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d
    ? iso
    : null;
}

/**
 * A schedule's date cell as ISO "YYYY-MM-DD", or null. An Excel date cell
 * arrives already ISO (with a time after it when the cell carried one); a
 * typed date is read day-first — `8/11/2025` is the 8th of November — with or
 * without a weekday in front ("Sat 8 Nov 2025"). A date with no year is
 * refused rather than guessed.
 */
export function parseScheduleDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s);
  if (iso) return validIso(iso[1]);
  const text = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '');

  const numeric = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})$/.exec(text);
  if (numeric) return isoFrom(numeric[3], numeric[2], numeric[1]);

  // "8 Nov 2025", "8th November, 2025", "November 8th 2025".
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(text);
  if (dayFirst) return isoFrom(dayFirst[3], monthNumber(dayFirst[2]), dayFirst[1]);
  const monthFirst = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(text);
  if (monthFirst) return isoFrom(monthFirst[3], monthNumber(monthFirst[1]), monthFirst[2]);
  return null;
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** "Nov", "November", "Sept" → "11"; anything else → null. A month is
 *  any three-letter-or-longer start of its full name. */
function monthNumber(word: string): string | null {
  const w = word.toLowerCase();
  if (w.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(w));
  return i >= 0 ? String(i + 1) : null;
}

function isoFrom(year: string, month: string | null, day: string): string | null {
  if (month === null) return null;
  const y = year.length === 2 ? 2000 + Number(year) : Number(year);
  return validIso(`${String(y).padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
}

/** A start of an imported race: its fleets, and its gun when known. */
export interface ImportedStart {
  fleetIds: string[];
  startTime?: string;
}

export interface ImportedRace {
  /** The sheet row it came from, 1-based as the spreadsheet numbers it. */
  rowNumber: number;
  date: string;
  name: string | null;
  starts: ImportedStart[];
}

export interface ScheduleRowError {
  rowNumber: number;
  reason: string;
}

export interface ParseScheduleResult {
  races: ImportedRace[];
  errors: ScheduleRowError[];
  /** Set when the sheet has more races than one import may add; nothing is
   *  imported then. */
  tooMany: number | null;
}

export interface ParseScheduleInput {
  /** Data rows, below the headings. */
  rows: readonly string[][];
  columnMap: ScheduleColumnMap;
  fleets: readonly Fleet[];
  /** The series' default start sequence, which a Start column runs. */
  startSequence: readonly StartGroup[];
  /** Whether a race with no start columns at all gets the default sequence
   *  with no gun times — true where the generator would time the sequence
   *  (a handicap series with one), so the fleets are in every race. */
  untimedSequenceWhenNoStarts: boolean;
  /** The spreadsheet row number of `rows[0]`. Defaults to 2 (headings on 1). */
  firstRowNumber?: number;
  maxRaces?: number;
}

/** Fleets on the same gun share a start, in gun order. Untimed fleets share
 *  one where the default start sequence groups them, and otherwise start
 *  alone — nothing else says which of them go together. */
function groupFleetGuns(
  guns: { fleetId: string; gun: GunCell }[],
  startSequence: readonly StartGroup[],
): ImportedStart[] {
  const byTime = new Map<string, string[]>();
  const untimed = new Map<string, string[]>();
  for (const { fleetId, gun } of guns) {
    if (gun.kind === 'time') byTime.set(gun.time, [...(byTime.get(gun.time) ?? []), fleetId]);
    else if (gun.kind === 'untimed') {
      const group = startSequence.findIndex((g) => g.fleetIds.includes(fleetId));
      const key = group >= 0 ? `group:${group}` : `fleet:${fleetId}`;
      untimed.set(key, [...(untimed.get(key) ?? []), fleetId]);
    }
  }
  const timed = [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([startTime, fleetIds]) => ({ fleetIds, startTime }));
  return [...timed, ...[...untimed.values()].map((fleetIds) => ({ fleetIds }))];
}

export function parseSchedule(input: ParseScheduleInput): ParseScheduleResult {
  const firstRowNumber = input.firstRowNumber ?? 2;
  const maxRaces = input.maxRaces ?? MAX_GENERATED_RACES;
  const fleetName = new Map(input.fleets.map((f) => [f.id, f.name]));

  let dateCol = -1;
  let nameCol = -1;
  let raceCol = -1;
  let startCol = -1;
  const fleetCols: { col: number; fleetId: string }[] = [];
  for (const [colStr, field] of Object.entries(input.columnMap)) {
    const col = Number(colStr);
    if (field === 'date') dateCol = col;
    else if (field === 'name') nameCol = col;
    else if (field === 'race') raceCol = col;
    else if (field === 'start') startCol = col;
    else {
      const fleetId = fleetIdOf(field);
      if (fleetId && fleetName.has(fleetId)) fleetCols.push({ col, fleetId });
    }
  }

  const cell = (row: readonly string[], col: number) => (col >= 0 ? (row[col] ?? '').trim() : '');
  const parsed: (ImportedRace & { hint: number | null; order: number })[] = [];
  const errors: ScheduleRowError[] = [];

  input.rows.forEach((row, i) => {
    const rowNumber = firstRowNumber + i;
    const rawDate = cell(row, dateCol);
    const date = parseScheduleDate(rawDate);
    if (!date) {
      errors.push({
        rowNumber,
        reason: rawDate ? `"${rawDate}" isn't a date with a year` : 'no date',
      });
      return;
    }

    let starts: ImportedStart[];
    if (startCol >= 0) {
      const raw = cell(row, startCol);
      const gun = readGun(raw);
      if (gun.kind === 'bad') {
        errors.push({ rowNumber, reason: `"${raw}" isn't a start time` });
        return;
      }
      // Blank or ASAP: the sequence's starts, with no gun yet.
      starts =
        gun.kind === 'time'
          ? generateStarts([...input.startSequence], gun.time)
          : input.startSequence.map((g) => ({ fleetIds: [...g.fleetIds] }));
    } else if (fleetCols.length > 0) {
      const guns = fleetCols.map(({ col, fleetId }) => ({ fleetId, raw: cell(row, col), gun: readGun(cell(row, col)) }));
      const bad = guns.find((g) => g.gun.kind === 'bad');
      if (bad) {
        errors.push({
          rowNumber,
          reason: `"${bad.raw}" under ${fleetName.get(bad.fleetId)} isn't a start time`,
        });
        return;
      }
      starts = groupFleetGuns(guns, input.startSequence);
      if (starts.length === 0) {
        errors.push({ rowNumber, reason: 'no fleet has a start in this race' });
        return;
      }
    } else if (input.untimedSequenceWhenNoStarts) {
      starts = input.startSequence.map((g) => ({ fleetIds: [...g.fleetIds] }));
    } else {
      starts = [];
    }

    const hintMatch = /\d+/.exec(cell(row, raceCol));
    parsed.push({
      rowNumber,
      date,
      name: cell(row, nameCol) || null,
      starts,
      hint: hintMatch ? Number(hintMatch[0]) : null,
      order: i,
    });
  });

  // The race-number column orders the races; rows without one keep their
  // place after the numbered ones.
  parsed.sort((a, b) => {
    if (a.hint !== null && b.hint !== null && a.hint !== b.hint) return a.hint - b.hint;
    if (a.hint === null && b.hint !== null) return 1;
    if (a.hint !== null && b.hint === null) return -1;
    return a.order - b.order;
  });

  const races = parsed.map(({ rowNumber, date, name, starts }) => ({ rowNumber, date, name, starts }));
  if (races.length > maxRaces) return { races: [], errors, tooMany: races.length };
  return { races, errors, tooMany: null };
}
