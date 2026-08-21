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
}

export interface RaceSenseFinish {
  /** 1-based finishing position, or `null` for the coded tail. */
  position: number | null;
  /** Verbatim column-A code when there's no position (`DNF`). */
  code: string | null;
  sailNumber: string;
  boatName: string;
  bowNumber: string;
  /** Time of day, `HH:MM:SS`, fractional seconds truncated. */
  finishTime: string | null;
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
 * `Start Time` is written `11:03` and `Finishing Time` `11:11:20.830`, and
 * `normalizeTimeInput` accepts neither. Loosening that gate would loosen it
 * for hand-typed entry too, where its strictness is the point — so the
 * shapes this one format uses are handled here. Fractional seconds truncate,
 * as a stopwatch does.
 */
export function normalizeRaceSenseTime(raw: string): string | null {
  const value = raw.trim();
  if (isBlank(value)) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(value);
  if (!match) return null;
  const [, h, m, s] = match;
  if (Number(h) > 23 || Number(m) > 59 || (s !== undefined && Number(s) > 59)) return null;
  return `${h.padStart(2, '0')}:${m}:${s ?? '00'}`;
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
    });
  }

  return starters;
}

function parseFinishes(ctx: Ctx, rows: string[][], headerAt: number): RaceSenseFinish[] {
  const cols = columnIndex(ctx, rows[headerAt], FINISHES_COLUMNS, 'Finishes');
  const sailAt = cols.get('Sail Number') ?? 1;
  const timeAt = cols.get('Finishing Time');

  const finishes: RaceSenseFinish[] = [];
  const seen = new Set<string>();
  let lastTime: string | null = null;
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
      } else if (position !== null) {
        if (lastTime !== null && finishTime < lastTime) {
          flag(ctx, 'warning', 'finish-order',
            `${sailNumber} finished at ${finishTime}, before the boat above her (${lastTime}).`,
            { where: `finish row for ${sailNumber}`, value: rawTime });
        }
        lastTime = finishTime;
      }
    }

    finishes.push({
      position,
      code,
      sailNumber,
      boatName: cell(row, cols.get('Boat Name') ?? -1),
      bowNumber: cell(row, cols.get('Bow Number') ?? -1),
      finishTime,
    });
  }

  return finishes;
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
  if (preparatorySignal !== null && !ROUTINE_SIGNALS.has(preparatorySignal)) {
    const mapped = PREPARATORY_SIGNAL_CODES[preparatorySignal];
    flag(ctx, 'warning', 'preparatory-signal',
      mapped
        ? `Started under "${preparatorySignal}", so an uncleared OCS is being read as ${mapped}. Only P has been seen in a real export — check this is what the committee meant.`
        : `Started under "${preparatorySignal}", which this import has no mapping for. Any uncleared OCS in this race needs its code set by hand.`,
      { where: 'Preparatory Signal Used', value: preparatorySignal });
  }

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
