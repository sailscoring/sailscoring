/**
 * Race dates: the recurring generator, and the date a newly added race
 * should carry.
 *
 * A season is usually a run of races on a fixed weekday at a fixed cadence
 * (weekly or fortnightly). {@link generateRaceDates} expands a start date +
 * interval into the list of race dates, either a fixed count or up to an
 * inclusive end date.
 *
 * Date arithmetic is done on the calendar parts via `Date.UTC`, advancing with
 * `setUTCDate` — never by adding a fixed number of milliseconds. Millisecond
 * addition drifts by an hour across a daylight-saving transition and can land a
 * weekly race on the wrong calendar day; UTC part-arithmetic is immune.
 */

/** Default hard cap on how many races one generation can create. */
export const MAX_GENERATED_RACES = 120;

export interface RaceScheduleOptions {
  /** ISO date "YYYY-MM-DD" of the first race. */
  startDate: string;
  /** Days between consecutive races: 7 = weekly, 14 = fortnightly. */
  intervalDays: number;
  /** Mode A — generate exactly this many races. */
  count?: number;
  /** Mode B — last race on or before this ISO date (inclusive). */
  untilDate?: string;
  /** Hard cap, applied in either mode. Defaults to {@link MAX_GENERATED_RACES}. */
  maxRaces?: number;
}

/**
 * Today's date as "YYYY-MM-DD" from the *local* calendar.
 *
 * Not `new Date().toISOString().slice(0, 10)`: that is the UTC date, so
 * anywhere ahead of UTC — Irish summer time included — the small hours after
 * midnight still read as yesterday.
 */
export function todayIsoDate(now: Date = new Date()): string {
  const y = String(now.getFullYear()).padStart(4, '0');
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Valid "YYYY-MM-DD", or null. */
function validIsoDate(v: string | null | undefined): string | null {
  return v && parseIsoDateToUtc(v) !== null ? v : null;
}

export interface DefaultRaceDateInput {
  /** Dates of the races already in the series, in series order. */
  existingDates?: readonly (string | null | undefined)[];
  /** The series window; either may be empty or unset. */
  startDate?: string | null;
  endDate?: string | null;
  /** Today's local date. Defaults to {@link todayIsoDate}; injectable so
   *  tests don't depend on when they run. */
  today?: string;
}

/**
 * The date a newly added race should default to, in preference order:
 *
 * 1. The last dated race in the series — a scorer entering several races off
 *    one day's sailing gets the right date on every one after the first.
 * 2. Today, clamped into the series window: before `startDate` → `startDate`,
 *    after `endDate` → `endDate`. So a series that ran last week never gets a
 *    race dated outside itself.
 * 3. Today, when the series has no usable dates.
 */
export function defaultRaceDate(input: DefaultRaceDateInput): string {
  const today = validIsoDate(input.today) ?? todayIsoDate();
  const existing = input.existingDates ?? [];
  for (let i = existing.length - 1; i >= 0; i--) {
    const date = validIsoDate(existing[i]);
    if (date) return date;
  }
  // ISO dates compare correctly as strings.
  const start = validIsoDate(input.startDate);
  if (start && today < start) return start;
  const end = validIsoDate(input.endDate);
  if (end && today > end) return end;
  return today;
}

/** Parse an ISO "YYYY-MM-DD" string to a UTC-midnight epoch, or null. */
function parseIsoDateToUtc(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // Reject impossible dates (e.g. 2026-02-30 rolls over to March).
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/** Format a UTC-midnight epoch back to "YYYY-MM-DD". */
function formatUtcAsIso(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/**
 * Expand a recurring schedule into an ascending list of ISO race dates.
 *
 * Exactly one of `count` / `untilDate` drives the length; if both are given,
 * `count` wins. Always bounded by `maxRaces`. Returns `[]` for invalid inputs
 * (unparseable dates, non-positive interval, `untilDate` before `startDate`, a
 * non-positive count) rather than throwing — callers preview the result and can
 * surface "no races" plainly.
 */
export function generateRaceDates(opts: RaceScheduleOptions): string[] {
  const { startDate, intervalDays, count, untilDate } = opts;
  const cap = Math.max(0, Math.floor(opts.maxRaces ?? MAX_GENERATED_RACES));
  const start = parseIsoDateToUtc(startDate);
  if (start === null) return [];
  if (!Number.isFinite(intervalDays) || intervalDays < 1) return [];
  const step = Math.floor(intervalDays);

  // Mode A: fixed count.
  if (count != null) {
    const n = Math.min(Math.floor(count), cap);
    if (!Number.isFinite(n) || n < 1) return [];
    const dates: string[] = [];
    const cursor = new Date(start);
    for (let i = 0; i < n; i++) {
      dates.push(formatUtcAsIso(cursor.getTime()));
      cursor.setUTCDate(cursor.getUTCDate() + step);
    }
    return dates;
  }

  // Mode B: until an inclusive end date.
  if (untilDate != null) {
    const end = parseIsoDateToUtc(untilDate);
    if (end === null || end < start) return [];
    const dates: string[] = [];
    const cursor = new Date(start);
    while (cursor.getTime() <= end && dates.length < cap) {
      dates.push(formatUtcAsIso(cursor.getTime()));
      cursor.setUTCDate(cursor.getUTCDate() + step);
    }
    return dates;
  }

  return [];
}
