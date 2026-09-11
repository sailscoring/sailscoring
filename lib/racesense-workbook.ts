/**
 * Structural parser for a RaceSense regatta export.
 *
 * RaceSense is Vakaros' iOS race-committee app. It exports a regatta as one
 * .xlsx workbook: a `Race N` sheet per race, then a `Summary` sheet.
 * `docs/notes/racesense/import-format.md` describes the format; this module
 * turns it into data and says what it didn't understand.
 *
 * Two rules shape everything here.
 *
 * **Nothing is located by row index.** The reference export alone varies the
 * Starts header between rows 14 and 16 and between four and six columns,
 * omits the Finishes block entirely when nobody finished, and slips a
 * footnote into the sail-number column. A championship export will differ
 * again. Blocks are found by their labels and columns by their headings.
 *
 * **Nothing is silently dropped.** Every cell, column, row and header the
 * parser doesn't recognise becomes an `RaceSenseAnomaly`. During a regatta
 * that list is what tells the scorer — and us — which assumption the
 * committee's device has just broken.
 *
 * The parse stays verbatim: statuses, position codes and times come back as
 * RaceSense wrote them (times normalised, nothing else). Turning a status
 * into a scoring code is `startStatusCode`; matching a sheet to a race in a
 * series is `lib/racesense-plan.ts`.
 */

import { normalizeTimeInput } from './time-parse';
import type { WorkbookSheet } from './import-table';
import type { ResultCode } from './types';

/** The app version this parser was verified against. A different build isn't
 *  an error — it's a prompt to re-read the export before trusting it. */
export const VERIFIED_APP_VERSION = '0.10.11 (1)';

/** Sheets holding one race. Everything else is the `Summary` or a surprise. */
const RACE_SHEET = /^Race (\d+)$/;

const SUMMARY_SHEET = 'Summary';

/** RaceSense's placeholders for "no value" — `---` in the Finishes block,
 *  `--` in `DTL at Start (m)`. */
const BLANK_VALUES = new Set(['', '-', '--', '---']);

// ---------------------------------------------------------------------------
// Recognised vocabulary. These tables are the parser's whole model of the
// format: adding a status or a preparatory signal mid-regatta is an edit
// here, not a change of logic anywhere else.
// ---------------------------------------------------------------------------

/** What a Starts-block `Status` cell means.
 *
 *  - `started` — over the line legally (the cell is empty).
 *  - `ocs` — on the course side and did not return. **Also appears as a DNF
 *    row in the Finishes tail**, so this column is the only place the fact
 *    survives; see the format note.
 *  - `cleared` — returned and re-crossed, either seen by RaceSense
 *    (`OCS (Cleared)`) or cleared by hand at the committee boat (`OCS *`,
 *    which is why such a sheet carries a `* cleared manually` footnote).
 *    No penalty: the finish stands.
 *  - `not-checked-in` — most likely the boat's device never checked in at
 *    registration rather than anything about the race. Boats carrying it go
 *    on to finish. Reported, never scored: if it ever warrants a code, the
 *    race committee makes that call. */
export type StartStatus = 'started' | 'ocs' | 'cleared' | 'not-checked-in';

export const START_STATUSES: Readonly<Record<string, StartStatus>> = {
  '': 'started',
  'OCS': 'ocs',
  'OCS (Cleared)': 'cleared',
  'OCS *': 'cleared',
  'Not Checked-In': 'not-checked-in',
};

/**
 * Which code an uncleared OCS becomes, by the race's preparatory signal.
 *
 * Only `P` has ever been observed, so the strings RaceSense writes for the
 * others are guesses at best — a signal outside this table derives no code
 * and raises an anomaly instead, and one inside it that isn't P or I is
 * flagged as well. Both leave the call with the scorer.
 *
 * Z flag is deliberately absent: RRS 30.2 gives a boat on the course side an
 * additive 20% penalty (`ZFP`), not a start code, and this import doesn't
 * carry penalties.
 */
export const PREPARATORY_SIGNAL_CODES: Readonly<Record<string, ResultCode>> = {
  'P': 'OCS',
  'I': 'OCS',
  'U': 'UFD',    // RRS 30.3
  'Black': 'BFD', // RRS 30.4
};

/** Preparatory signals whose OCS handling is settled: everything else earns
 *  a look even when the table above can map it. */
const ROUTINE_SIGNALS = new Set(['P', 'I']);

/** Column headings the Starts block may carry. `DTL at Start (m)` is absent
 *  when no line was recorded; `Protest` appears only when a boat has one. */
const STARTS_COLUMNS = new Set([
  'Sail Number',
  'Boat Name',
  'Bow Number',
  'Status',
  'DTL at Start (m)',
  'Protest',
]);

/** Column headings the Finishes block may carry. Its first column — the one
 *  holding the position or the code — has no heading at all. */
const FINISHES_COLUMNS = new Set([
  'Sail Number',
  'Boat Name',
  'Bow Number',
  'Total Time',
  'Finishing Time',
  'Max Speed (kts)',
  'Distance Traveled (km)',
]);

/** Key/value rows above the blocks, in both the workbook header and each
 *  race sheet. Anything else in column A of that region is unexpected. */
const KEY_ROWS = new Set([
  'RaceSense Event Report',
  'Regatta',
  'Regatta ID',
  'Division',
  'Regatta Start Date',
  'Starts',
  'Start #',
  'Date',
  'Preparatory Signal Used',
  'Start Time',
  'Boat Location',
  'Pin Location',
  'Finishes',
]);

/** Column-A values in the Finishes block that aren't a position. RaceSense
 *  writes only `DNF`; the rest are here so a championship export that uses
 *  them parses rather than surprising us mid-regatta. */
const FINISH_CODES: Readonly<Record<string, ResultCode>> = {
  'DNF': 'DNF',
  'DNS': 'DNS',
  'DNC': 'DNC',
  'RET': 'RET',
  'OCS': 'OCS',
  'UFD': 'UFD',
  'BFD': 'BFD',
  'DSQ': 'DSQ',
  'NSC': 'NSC',
};

/**
 * How much of the fleet's median distance a boat must be under before her
 * finish is worth a second look, and how many timed finishes a race needs
 * before a median means anything at all.
 *
 * The bound is deliberately loose — the boats it has to catch were 19% and
 * 81% short, while boats reading 13% and 50% short had finished exactly where
 * they should — because the early elapsed time is doing the discriminating.
 * Both numbers want more events behind them than one championship.
 */
const SHORT_COURSE_DISTANCE_RATIO = 0.9;
const SHORT_COURSE_MIN_FINISHES = 5;

/** The footnote RaceSense drops below the starters when a race has a
 *  manually-cleared OCS. It sits in the sail-number column and reads like a
 *  boat, so it is matched and consumed rather than parsed as one. */
const CLEARED_FOOTNOTE = '* cleared manually';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type AnomalySeverity = 'info' | 'warning';

/**
 * Something the parser didn't recognise, or recognised and wants looked at.
 *
 * `where` locates it for a human reading the workbook in Excel — the row's
 * own handle ("the starter row for 1022"), not a cell reference, because
 * blank rows are dropped before the parser sees a sheet and an A1 address
 * would be off by however many the sheet happened to contain.
 */
export interface RaceSenseAnomaly {
  severity: AnomalySeverity;
  /** Stable slug, for grouping in the report. */
  kind: string;
  sheet: string;
  where?: string;
  /** Verbatim, so an unrecognised value can be added to the tables above. */
  value?: string;
  message: string;
}

export interface RaceSenseStarter {
  sailNumber: string;
  boatName: string;
  bowNumber: string;
  /** Verbatim `Status` cell — `''` for a clean start. */
  status: string;
  /** `null` when the status isn't one we know. */
  meaning: StartStatus | null;
  /** RaceSense knows a protest was flagged; nothing downstream imports it. */
  protest: boolean;
  /** Metres to the line at the starting signal, sign verbatim. `null` when
   *  the sheet has no DTL column (no line recorded) or the cell is blank. */
  dtlAtStartM: number | null;
}

/**
 * A Starts row holding no evidence that the boat came to the starting area:
 * her device never checked in, and it never registered a distance to the line
 * either. She is on the sheet because she is entered, not because she raced.
 */
export function neverCameToTheLine(starter: RaceSenseStarter): boolean {
  return starter.meaning === 'not-checked-in' && starter.dtlAtStartM === null;
}

/**
 * What the Starts block says about the start itself: how many boats came to
 * the line, how many were over it and stayed over, and how many were over it
 * and got back.
 *
 * The two are worth counting apart. An uncleared OCS costs the boat her race;
 * a cleared one costs her nothing at all, so it never reaches the finish
 * sheet and would otherwise go unrecorded — but a start where twelve boats
 * were over and nine returned is a different start from one where three were
 * over and stayed there, and that is the difference a race officer is asking
 * about.
 */
export interface StartLineCounts {
  starters: number;
  ocs: number;
  cleared: number;
}

export function startLineCounts(race: RaceSenseRace): StartLineCounts {
  const counts = { starters: 0, ocs: 0, cleared: 0 };
  for (const starter of race.starters) {
    if (neverCameToTheLine(starter)) continue;
    counts.starters++;
    if (starter.meaning === 'ocs') counts.ocs++;
    else if (starter.meaning === 'cleared') counts.cleared++;
  }
  return counts;
}

export interface RaceSenseFinish {
  /** 1-based finishing position, or `null` for the coded tail. */
  position: number | null;
  /** Verbatim column-A code when there's no position (`DNF`). */
  code: string | null;
  sailNumber: string;
  boatName: string;
  bowNumber: string;
  /** Time of day, `HH:MM:SS`, fractional seconds truncated. Read for the
   *  cross-check below and never imported: exports have been seen writing an
   *  individual boat's timestamp an hour out while her elapsed time stayed
   *  right, so `totalTimeSecs` is the value that reaches a result. */
  finishTime: string | null;
  /** Elapsed time in seconds, fractional part kept. The measurement. */
  totalTimeSecs: number | null;
  maxSpeedKts: number | null;
  /** Distance sailed, km — the unit the export uses. */
  distanceKm: number | null;
}

export interface RaceSenseRace {
  sheetName: string;
  /** From the sheet name, which is the only place it's reliable. */
  number: number;
  startNumber: string | null;
  /** ISO `YYYY-MM-DD`. */
  date: string | null;
  /** Verbatim `Preparatory Signal Used`. */
  preparatorySignal: string | null;
  /** Time of day, `HH:MM:SS`. */
  startTime: string | null;
  starters: RaceSenseStarter[];
  /** `null` — not `[]` — when the sheet carries no Finishes block, which is
   *  what RaceSense writes when nobody finished. */
  finishes: RaceSenseFinish[] | null;
}

export interface RaceSenseSummaryEntry {
  /** Column-A label, split on `" - "`. */
  sailNumber: string;
  boatName: string;
  /** Race number → verbatim cell (`"1."`, `"DNF"`). */
  cells: Map<number, string>;
}

export interface RaceSenseWorkbook {
  regatta: string | null;
  /** RaceSense's own id for the regatta — the second path segment of a
   *  player.vakaros.com watch URL. Championship exports print it on every
   *  sheet; the club-series export this parser was first written against
   *  predates it. What ties a workbook to the document behind the player. */
  regattaId: string | null;
  division: string | null;
  appVersion: string | null;
  regattaStartDate: string | null;
  races: RaceSenseRace[];
  summary: RaceSenseSummaryEntry[] | null;
  anomalies: RaceSenseAnomaly[];
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

const cell = (row: string[] | undefined, index: number): string =>
  (row?.[index] ?? '').trim();

const isBlank = (value: string): boolean => BLANK_VALUES.has(value.trim());

/** A value cell, with RaceSense's placeholders flattened to null. */
const valueOrNull = (value: string): string | null => (isBlank(value) ? null : value.trim());

/**
 * Normalise a RaceSense time of day to `HH:MM:SS`.
 *
 * `Start Time` is written `11:03` and `Finishing Time` `11:11:20.830`. The
 * shared gate reads the first of those now, so this trims the fractional
 * seconds — truncating, as a stopwatch does — and hands the rest over. The
 * hour bound is this format's own: a clock reading past 23 is a corrupt
 * cell, not a race that ran long.
 */
export function normalizeRaceSenseTime(raw: string): string | null {
  const value = raw.trim();
  if (isBlank(value)) return null;
  const match = /^(\d{1,2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/.exec(value);
  if (!match) return null;
  const normalized = normalizeTimeInput(match[1]);
  if (!normalized || Number(normalized.slice(0, 2)) > 23) return null;
  return normalized;
}

/**
 * Parse a `Total Time` elapsed value to seconds, fractional part kept.
 *
 * The reference export writes `14:20.450` (minutes:seconds); a longer race
 * would need an hours group, so `1:14:20.450` is accepted too. Distinct from
 * `normalizeRaceSenseTime`, which reads times of day and truncates fractions
 * — an elapsed time's fraction is the measurement, not noise.
 */
export function normalizeRaceSenseElapsed(raw: string): number | null {
  const value = raw.trim();
  if (isBlank(value)) return null;
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(value);
  if (!match) return null;
  const [, h, m, s] = match;
  if (Number(m) > 59 || Number(s) >= 60) return null;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);
}

/** An elapsed time back in the shape RaceSense writes it, for a message that
 *  quotes one cell against another. */
function formatElapsed(secs: number): string {
  const whole = Math.floor(secs);
  const frac = secs - whole;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  const tail = frac > 0 ? String(Number(frac.toFixed(3))).slice(1) : '';
  return `${m}:${String(s).padStart(2, '0')}${tail}`;
}

/** Which scoring code an uncleared OCS becomes under this race's preparatory
 *  signal. `null` when the signal isn't one we have a mapping for — the
 *  scorer sets the code by hand, having been told why. */
export function startStatusCode(
  meaning: StartStatus | null,
  preparatorySignal: string | null,
): ResultCode | null {
  if (meaning !== 'ocs') return null;
  const signal = (preparatorySignal ?? '').trim();
  return PREPARATORY_SIGNAL_CODES[signal] ?? null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface Ctx {
  sheet: string;
  anomalies: RaceSenseAnomaly[];
}

function flag(
  ctx: Ctx,
  severity: AnomalySeverity,
  kind: string,
  message: string,
  extra?: { where?: string; value?: string },
): void {
  ctx.anomalies.push({ severity, kind, sheet: ctx.sheet, message, ...extra });
}

/** Column A → column B for the key/value rows above the blocks. */
function keyValues(rows: string[][]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const key = cell(row, 0);
    if (KEY_ROWS.has(key) && !out.has(key)) out.set(key, cell(row, 1));
  }
  return out;
}

/** `App Version: 0.10.11 (1)` sits loose in the top row rather than in a
 *  key/value pair, so it's found by prefix wherever it landed. */
function appVersion(rows: string[][]): string | null {
  for (const row of rows.slice(0, 3)) {
    for (const value of row) {
      const match = /^App Version:\s*(.+)$/.exec(value.trim());
      if (match) return match[1].trim();
    }
  }
  return null;
}

/** Map a block's heading row to column indexes, reporting any heading the
 *  parser has no name for — a new column is exactly the kind of format
 *  change worth hearing about the day it appears. */
function columnIndex(
  ctx: Ctx,
  header: string[],
  known: Set<string>,
  block: string,
): Map<string, number> {
  const out = new Map<string, number>();
  header.forEach((raw, i) => {
    const label = raw.trim();
    // Unlabelled columns are the sheet's trailing padding (and, in the
    // Finishes block, the position column) — neither names anything.
    if (label === '') return;
    if (!out.has(label)) out.set(label, i);
    if (!known.has(label)) {
      flag(ctx, 'warning', 'unknown-column', `Unrecognised ${block} column "${label}".`, {
        where: `${block} heading row`,
        value: label,
      });
    }
  });
  return out;
}

/** Read a numeric cell (a DTL, a speed, a distance), flattening RaceSense's
 *  placeholders to null and flagging anything that is neither. */
function parseMetric(
  ctx: Ctx,
  raw: string,
  label: string,
  where: string,
): number | null {
  const value = valueOrNull(raw);
  if (value === null) return null;
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    flag(ctx, 'warning', 'unreadable-number', `Couldn’t read the ${label} "${value}".`,
      { where, value });
    return null;
  }
  return Number(value);
}

function parseStarters(
  ctx: Ctx,
  rows: string[][],
  headerAt: number,
  endAt: number,
): RaceSenseStarter[] {
  const cols = columnIndex(ctx, rows[headerAt], STARTS_COLUMNS, 'Starts');
  const sailAt = cols.get('Sail Number') ?? 0;
  const statusAt = cols.get('Status');
  const protestAt = cols.get('Protest');
  const dtlAt = cols.get('DTL at Start (m)');

  if (statusAt === undefined) {
    flag(ctx, 'warning', 'missing-column',
      'The Starts block has no Status column, so OCS calls cannot be read from this sheet.',
      { where: 'Starts heading row' });
  }

  const starters: RaceSenseStarter[] = [];
  const seen = new Set<string>();

  for (let i = headerAt + 1; i < endAt; i++) {
    const row = rows[i];
    const sailNumber = cell(row, sailAt);
    if (sailNumber === '') continue;

    if (sailNumber === CLEARED_FOOTNOTE) continue;  // the manual-clear footnote
    if (sailNumber.startsWith('*')) {
      flag(ctx, 'warning', 'unexpected-row',
        'A footnote-looking row in the sail-number column was skipped.',
        { where: 'Starts block', value: sailNumber });
      continue;
    }

    const status = statusAt === undefined ? '' : cell(row, statusAt);
    const meaning = START_STATUSES[status] ?? null;
    if (meaning === null) {
      flag(ctx, 'warning', 'unknown-status',
        `Unrecognised start status "${status}" — no code was derived from it.`,
        { where: `starter ${sailNumber}`, value: status });
    }

    const protest = protestAt !== undefined && cell(row, protestAt).toLowerCase() === 'yes';
    if (protest) {
      flag(ctx, 'info', 'protest',
        'RaceSense recorded a protest against this boat. Protests are not imported — the race committee’s notes decide the outcome.',
        { where: `starter ${sailNumber}` });
    }

    if (seen.has(sailNumber)) {
      flag(ctx, 'warning', 'duplicate-sail', `${sailNumber} appears twice in the Starts block.`,
        { where: `starter ${sailNumber}`, value: sailNumber });
    }
    seen.add(sailNumber);

    starters.push({
      sailNumber,
      boatName: cell(row, cols.get('Boat Name') ?? -1),
      bowNumber: cell(row, cols.get('Bow Number') ?? -1),
      status,
      meaning,
      protest,
      dtlAtStartM: dtlAt === undefined
        ? null
        : parseMetric(ctx, cell(row, dtlAt), 'DTL at start', `starter ${sailNumber}`),
    });
  }

  return starters;
}

function parseFinishes(ctx: Ctx, rows: string[][], headerAt: number): RaceSenseFinish[] {
  const cols = columnIndex(ctx, rows[headerAt], FINISHES_COLUMNS, 'Finishes');
  const sailAt = cols.get('Sail Number') ?? 1;
  const timeAt = cols.get('Finishing Time');
  const totalAt = cols.get('Total Time');
  const speedAt = cols.get('Max Speed (kts)');
  const distanceAt = cols.get('Distance Traveled (km)');

  const finishes: RaceSenseFinish[] = [];
  const seen = new Set<string>();
  // The block is ordered by elapsed time, and so is the import; the times of
  // day beside it are a rendering that has been seen going wrong for
  // individual boats, so ordering is checked against the elapsed times.
  let lastElapsed: number | null = null;
  let lastPosition = 0;

  for (let i = headerAt + 1; i < rows.length; i++) {
    const row = rows[i];
    const marker = cell(row, 0);
    const sailNumber = cell(row, sailAt);
    if (marker === '' && sailNumber === '') continue;

    let position: number | null = null;
    let code: string | null = null;
    const asPosition = /^(\d+)\.?$/.exec(marker);
    if (asPosition) {
      position = Number(asPosition[1]);
    } else if (marker in FINISH_CODES) {
      code = marker;
    } else {
      flag(ctx, 'warning', 'unknown-position',
        `Unrecognised finish marker "${marker}" — the row was skipped.`,
        { where: `finish row for ${sailNumber || '(no sail number)'}`, value: marker });
      continue;
    }

    if (sailNumber === '') {
      flag(ctx, 'warning', 'unexpected-row', 'A finish row carries no sail number.',
        { where: `finish row "${marker}"` });
      continue;
    }
    if (seen.has(sailNumber)) {
      flag(ctx, 'warning', 'duplicate-sail', `${sailNumber} appears twice in the Finishes block.`,
        { where: `finish row for ${sailNumber}`, value: sailNumber });
    }
    seen.add(sailNumber);

    if (position !== null) {
      if (position !== lastPosition + 1) {
        flag(ctx, 'warning', 'finish-order',
          `Finishing positions jump from ${lastPosition} to ${position}.`,
          { where: `finish row for ${sailNumber}`, value: marker });
      }
      lastPosition = position;
    }

    const rawTime = timeAt === undefined ? '' : cell(row, timeAt);
    let finishTime: string | null = null;
    if (!isBlank(rawTime)) {
      finishTime = normalizeRaceSenseTime(rawTime);
      if (finishTime === null) {
        flag(ctx, 'warning', 'unreadable-time', `Couldn’t read the finishing time "${rawTime}".`,
          { where: `finish row for ${sailNumber}`, value: rawTime });
      }
    }

    const rawTotal = totalAt === undefined ? '' : cell(row, totalAt);
    const totalTimeSecs = normalizeRaceSenseElapsed(rawTotal);
    if (totalTimeSecs === null && !isBlank(rawTotal)) {
      flag(ctx, 'warning', 'unreadable-time', `Couldn’t read the total time "${rawTotal}".`,
        { where: `finish row for ${sailNumber}`, value: rawTotal });
    }

    if (position !== null && totalTimeSecs !== null) {
      if (lastElapsed !== null && totalTimeSecs < lastElapsed) {
        flag(ctx, 'warning', 'finish-order',
          `${sailNumber} took ${rawTotal.trim()}, less than the boat placed above her (${formatElapsed(lastElapsed)}).`,
          { where: `finish row for ${sailNumber}`, value: rawTotal });
      }
      lastElapsed = totalTimeSecs;
    }

    finishes.push({
      position,
      code,
      sailNumber,
      boatName: cell(row, cols.get('Boat Name') ?? -1),
      bowNumber: cell(row, cols.get('Bow Number') ?? -1),
      finishTime,
      totalTimeSecs,
      maxSpeedKts: speedAt === undefined
        ? null
        : parseMetric(ctx, cell(row, speedAt), 'max speed', `finish row for ${sailNumber}`),
      distanceKm: distanceAt === undefined
        ? null
        : parseMetric(ctx, cell(row, distanceAt), 'distance traveled', `finish row for ${sailNumber}`),
    });
  }

  return finishes;
}

/**
 * Say so when a race started under a signal whose OCS handling isn't
 * settled. Shared with the player-document reading, which sees the same
 * signals spelled differently and normalises them to the export's spelling
 * before asking.
 */
export function checkPreparatorySignal(
  ctx: { sheet: string; anomalies: RaceSenseAnomaly[] },
  preparatorySignal: string | null,
): void {
  if (preparatorySignal === null || ROUTINE_SIGNALS.has(preparatorySignal)) return;
  const mapped = PREPARATORY_SIGNAL_CODES[preparatorySignal];
  flag(ctx, 'warning', 'preparatory-signal',
    mapped
      ? `Started under "${preparatorySignal}", so an uncleared OCS is being read as ${mapped}. Only P has been seen in a real export — check this is what the committee meant.`
      : `Started under "${preparatorySignal}", which this import has no mapping for. Any uncleared OCS in this race needs its code set by hand.`,
    { where: 'Preparatory Signal Used', value: preparatorySignal });
}

function parseRaceSheet(sheet: WorkbookSheet, number: number, ctx: Ctx): RaceSenseRace {
  const rows = sheet.rows;
  const keys = keyValues(rows);

  const titleAt = rows.findIndex((r) => RACE_SHEET.test(cell(r, 0)));
  if (titleAt >= 0) {
    const titled = Number(RACE_SHEET.exec(cell(rows[titleAt], 0))![1]);
    if (titled !== number) {
      flag(ctx, 'warning', 'race-number',
        `The sheet is named "${sheet.name}" but its title row reads "Race ${titled}".`,
        { where: 'title row', value: String(titled) });
    }
  }

  const startsHeaderAt = rows.findIndex((r) => cell(r, 0) === 'Sail Number');
  const finishesAt = rows.findIndex((r) => cell(r, 0) === 'Finishes');

  const preparatorySignal = valueOrNull(keys.get('Preparatory Signal Used') ?? '');
  checkPreparatorySignal(ctx, preparatorySignal);

  const startNumber = valueOrNull(keys.get('Start #') ?? '');
  if (startNumber !== null && startNumber !== '1') {
    flag(ctx, 'warning', 'start-number',
      `Start # is ${startNumber}. Every export seen so far says 1, so what a second start means here is unverified.`,
      { where: 'Start #', value: startNumber });
  }

  const rawStartTime = keys.get('Start Time') ?? '';
  const startTime = normalizeRaceSenseTime(rawStartTime);
  if (!isBlank(rawStartTime) && startTime === null) {
    flag(ctx, 'warning', 'unreadable-time', `Couldn’t read the start time "${rawStartTime}".`,
      { where: 'Start Time', value: rawStartTime });
  }

  let starters: RaceSenseStarter[] = [];
  if (startsHeaderAt < 0) {
    flag(ctx, 'warning', 'missing-block',
      'No Starts block on this sheet — no starters could be read.');
  } else {
    const endAt = finishesAt > startsHeaderAt ? finishesAt : rows.length;
    starters = parseStarters(ctx, rows, startsHeaderAt, endAt);
  }

  let finishes: RaceSenseFinish[] | null = null;
  if (finishesAt < 0) {
    flag(ctx, 'info', 'missing-finishes',
      'No Finishes block: RaceSense omits it when nobody finished, so every starter here is a non-finisher.');
  } else {
    const headerAt = rows.findIndex((r, i) => i > finishesAt && cell(r, 1) === 'Sail Number');
    if (headerAt < 0) {
      flag(ctx, 'warning', 'missing-block',
        'The Finishes block has no heading row, so its columns couldn’t be identified.');
    } else {
      finishes = parseFinishes(ctx, rows, headerAt);
    }
  }

  if (finishes) {
    checkFinishingTimes(ctx, startTime, finishes);
    checkShortCourseFinishes(ctx, finishes);
  }

  return {
    sheetName: sheet.name,
    number,
    startNumber,
    date: valueOrNull(keys.get('Date') ?? ''),
    preparatorySignal,
    startTime,
    starters,
    finishes,
  };
}

/**
 * Check each boat's `Finishing Time` against her `Total Time`, and say so when
 * they disagree.
 *
 * Exports have been seen writing an individual boat's timestamp an hour out
 * while her elapsed time stayed right — four boats in one race of one day of
 * one championship, the rest of the sheet correct. Nothing is imported from
 * the timestamp, so a race like that scores correctly regardless; the note
 * exists so the device's mistake is on the record rather than found by eye,
 * and so a whole-sheet drift shows up as a whole-sheet complaint.
 *
 * Reported as `info`, deliberately. A warning against a race is a decision
 * the scorer has to make before importing it, and there is no decision here:
 * the value that disagrees is one this import doesn't read. Being told is the
 * whole of it.
 *
 * A second's disagreement is the format's own rounding — the timestamp
 * truncates its fractional seconds and the elapsed time keeps them — so only
 * a larger gap is worth saying anything about.
 */
function checkFinishingTimes(
  ctx: Ctx,
  startTime: string | null,
  finishes: readonly RaceSenseFinish[],
): void {
  if (startTime === null) return;
  const startSeconds = hmsToSeconds(startTime);
  for (const f of finishes) {
    if (f.finishTime === null || f.totalTimeSecs === null) continue;
    const expected = startSeconds + Math.floor(f.totalTimeSecs);
    const drift = hmsToSeconds(f.finishTime) - expected;
    if (Math.abs(drift) <= 1) continue;
    flag(ctx, 'info', 'finish-time-drift',
      `${f.sailNumber}'s finishing time is ${describeDrift(drift)} her elapsed time (${f.finishTime} against ${secondsToHms(expected)}) — the device's own inconsistency. Nothing is scored from it: the elapsed time is what this import reads.`,
      { where: `finish row for ${f.sailNumber}`, value: f.finishTime });
  }
}

const hmsToSeconds = (time: string): number => {
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

const secondsToHms = (total: number): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
};

/** "an hour early", "3s late" — the shape of the disagreement in words, since
 *  a whole hour is a different kind of problem from a few seconds. */
function describeDrift(drift: number): string {
  const direction = drift < 0 ? 'earlier than' : 'later than';
  const size = Math.abs(drift);
  if (size % 3600 === 0) {
    const hours = size / 3600;
    return `${hours === 1 ? 'an hour' : `${hours} hours`} ${direction}`;
  }
  return `${size}s ${direction}`;
}

/**
 * Say so when a boat's finish looks like the line crossed a lap early.
 *
 * RaceSense sometimes takes an earlier lap's crossing for a boat's finish.
 * She lands near the front of the results having sailed well short of the
 * fleet and taken well less time than it, and everyone she wrongly beat is
 * pushed down a place. It happened twice in the ten races of the 2026 ILCA 6
 * Women's Worlds, and both times only the committee's own results caught it:
 * one boat 7 km and 36 minutes short, and a race where seven boats came in
 * 2 km and a quarter of an hour short and took the first seven places
 * between them, moving 42 of the 54 boats in the fleet.
 *
 * Short distance on its own doesn't mean this. A GPS dropout loses part of a
 * boat's track and still catches her real finish, so she reads short and
 * places correctly — one boat at that event sailed nearly 5 km short and
 * finished exactly where she should have. What makes a finish false is short
 * distance *and* an early time: crossing the line a lap early necessarily
 * means both, and nothing else does. The elapsed condition is what separates
 * the two, which is why the distance bound can afford to be loose.
 *
 * A warning, and one the scorer is expected to overrule sometimes: a boat can
 * be genuinely quick and genuinely economical round the course. The check
 * says which finish to look up in the committee's results, not which one is
 * wrong.
 */
export function checkShortCourseFinishes(
  ctx: { sheet: string; anomalies: RaceSenseAnomaly[] },
  finishes: readonly RaceSenseFinish[],
): void {
  const measured = finishes.filter(
    (f): f is RaceSenseFinish & { distanceKm: number; totalTimeSecs: number } =>
      f.position !== null && f.code === null
      && f.distanceKm !== null && f.totalTimeSecs !== null,
  );
  if (measured.length < SHORT_COURSE_MIN_FINISHES) return;

  const medianDistanceKm = median(measured.map((f) => f.distanceKm));
  const medianElapsed = median(measured.map((f) => f.totalTimeSecs));
  const shortOfKm = medianDistanceKm * SHORT_COURSE_DISTANCE_RATIO;

  for (const f of measured) {
    if (f.distanceKm >= shortOfKm || f.totalTimeSecs >= medianElapsed) continue;
    flag(ctx, 'warning', 'short-course-finish',
      `${f.sailNumber} finished ${f.distanceKm.toFixed(2)} km in ${formatElapsed(Math.round(f.totalTimeSecs))}, against a fleet median of ${medianDistanceKm.toFixed(2)} km and ${formatElapsed(Math.round(medianElapsed))}. A boat crossing the line a lap early looks like this. Check her finish against the race committee's.`,
      { where: `finish row for ${f.sailNumber}`, value: f.sailNumber });
  }
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function parseSummarySheet(sheet: WorkbookSheet, ctx: Ctx): RaceSenseSummaryEntry[] | null {
  const rows = sheet.rows;
  const headerAt = rows.findIndex((r) => cell(r, 0) === '' && RACE_SHEET.test(cell(r, 1)));
  if (headerAt < 0) {
    flag(ctx, 'warning', 'missing-block',
      'The Summary sheet has no results grid, so it can’t be used to cross-check the race sheets.');
    return null;
  }

  const raceAt = new Map<number, number>();
  rows[headerAt].forEach((raw, i) => {
    const match = RACE_SHEET.exec(raw.trim());
    if (match) raceAt.set(Number(match[1]), i);
  });

  const entries: RaceSenseSummaryEntry[] = [];
  for (let i = headerAt + 1; i < rows.length; i++) {
    const label = cell(rows[i], 0);
    if (label === '') continue;
    const [sailNumber, ...rest] = label.split(' - ');
    const cells = new Map<number, string>();
    for (const [number, index] of raceAt) {
      const value = cell(rows[i], index);
      if (value !== '') cells.set(number, value);
    }
    entries.push({ sailNumber: sailNumber.trim(), boatName: rest.join(' - ').trim(), cells });
  }
  return entries;
}

/**
 * Cross-check the Summary grid against the race sheets.
 *
 * The grid encodes the same results independently, so it's a free checksum —
 * but it only speaks in positions and DNF. An uncleared OCS reads DNF here,
 * which is expected and not worth reporting; anything else that disagrees is.
 */
function checkSummary(
  races: RaceSenseRace[],
  summary: RaceSenseSummaryEntry[],
  anomalies: RaceSenseAnomaly[],
): void {
  const ctx: Ctx = { sheet: SUMMARY_SHEET, anomalies };
  const byNumber = new Map(races.map((r) => [r.number, r]));

  for (const entry of summary) {
    for (const [number, value] of entry.cells) {
      const race = byNumber.get(number);
      if (!race) {
        flag(ctx, 'warning', 'summary-mismatch',
          `The Summary has a Race ${number} column but the workbook has no such sheet.`,
          { where: `Race ${number}`, value });
        continue;
      }

      const finish = race.finishes?.find((f) => f.sailNumber === entry.sailNumber) ?? null;
      const expected = finish === null
        ? 'DNF'
        : finish.position !== null ? `${finish.position}.` : finish.code ?? 'DNF';

      if (value !== expected) {
        flag(ctx, 'warning', 'summary-mismatch',
          `The Summary says ${entry.sailNumber} scored "${value}" in Race ${number}, but that race sheet says "${expected}".`,
          { where: `${entry.sailNumber}, Race ${number}`, value });
      }
    }
  }
}

/**
 * Parse a RaceSense workbook's sheets.
 *
 * Never throws: a sheet it can't make sense of yields anomalies and whatever
 * of the race it could read. Mid-regatta, a partial parse the scorer can see
 * around beats an exception.
 */
export function parseRaceSenseWorkbook(sheets: WorkbookSheet[]): RaceSenseWorkbook {
  const anomalies: RaceSenseAnomaly[] = [];
  const races: RaceSenseRace[] = [];
  let summary: RaceSenseSummaryEntry[] | null = null;

  const first = sheets[0];
  const keys = first ? keyValues(first.rows) : new Map<string, string>();
  const version = first ? appVersion(first.rows) : null;

  if (version !== null && version !== VERIFIED_APP_VERSION) {
    anomalies.push({
      severity: 'info',
      kind: 'app-version',
      sheet: first.name,
      where: 'App Version',
      value: version,
      message: `Written by RaceSense ${version}; this import was verified against ${VERIFIED_APP_VERSION}. Worth reading the anomalies below closely.`,
    });
  }

  const seenNumbers = new Map<number, string>();

  for (const sheet of sheets) {
    if (sheet.rows.length === 0) continue;
    const ctx: Ctx = { sheet: sheet.name, anomalies };

    if (sheet.name === SUMMARY_SHEET) {
      summary = parseSummarySheet(sheet, ctx);
      continue;
    }

    const match = RACE_SHEET.exec(sheet.name);
    if (!match) {
      flag(ctx, 'warning', 'unknown-sheet',
        `Sheet "${sheet.name}" is neither a race nor the Summary, so it was skipped.`,
        { value: sheet.name });
      continue;
    }

    const number = Number(match[1]);
    const previous = seenNumbers.get(number);
    if (previous !== undefined) {
      flag(ctx, 'warning', 'duplicate-race',
        `Two sheets claim to be race ${number} ("${previous}" and "${sheet.name}").`,
        { value: sheet.name });
    }
    seenNumbers.set(number, sheet.name);

    races.push(parseRaceSheet(sheet, number, ctx));
  }

  races.sort((a, b) => a.number - b.number);
  if (summary) checkSummary(races, summary, anomalies);

  return {
    regatta: valueOrNull(keys.get('Regatta') ?? ''),
    regattaId: valueOrNull(keys.get('Regatta ID') ?? ''),
    division: valueOrNull(keys.get('Division') ?? ''),
    appVersion: version,
    regattaStartDate: valueOrNull(keys.get('Regatta Start Date') ?? ''),
    races,
    summary,
    anomalies,
  };
}

/** One anomaly kind, as it should be read: the same missing Finishes block
 *  on four sheets is one thing that happened four times, not four things. */
export interface AnomalyGroup {
  kind: string;
  severity: AnomalySeverity;
  /** The first occurrence's wording, which is representative of the group. */
  message: string;
  count: number;
  sheets: string[];
  /** Distinct verbatim values, so an unrecognised status can be read off the
   *  report and added to the tables above without opening the workbook. */
  values: string[];
}

/** Group anomalies by kind for a report, warnings first. A 40-race workbook
 *  with one new column would otherwise repeat itself 40 times. */
export function groupAnomalies(anomalies: RaceSenseAnomaly[]): AnomalyGroup[] {
  const groups = new Map<string, AnomalyGroup>();
  for (const a of anomalies) {
    let group = groups.get(a.kind);
    if (!group) {
      group = { kind: a.kind, severity: a.severity, message: a.message, count: 0, sheets: [], values: [] };
      groups.set(a.kind, group);
    }
    group.count++;
    if (!group.sheets.includes(a.sheet)) group.sheets.push(a.sheet);
    if (a.value && !group.values.includes(a.value)) group.values.push(a.value);
  }
  return [...groups.values()].sort((a, b) =>
    a.severity === b.severity ? b.count - a.count : a.severity === 'warning' ? -1 : 1);
}
