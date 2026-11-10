import type { Race } from './types';

/**
 * Race-day headings for the Races tab. Club racing is planned by the day —
 * two or three races of a Saturday — so the list groups each run of races
 * that share a date under one heading, rather than repeating the date on
 * every row.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The heading over races with no date — the published schedule's wording. */
export const UNDATED_RACE_DAY = 'Not yet dated';

/**
 * "Sat 18 Apr", or "Sat 18 Apr 2026" with the year. Null for anything that
 * isn't a real calendar date. Spelled out by hand rather than through Intl so
 * the wording doesn't drift with the browser's locale data.
 */
export function formatRaceDay(iso: string, withYear: boolean): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Read as UTC so the weekday doesn't shift with the viewer's timezone.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const text = `${WEEKDAYS[d.getUTCDay()]} ${day} ${MONTHS[month - 1]}`;
  return withYear ? `${text} ${year}` : text;
}

/**
 * The heading, if any, to show above each race: one at the start of every
 * run of consecutive races on the same day. Runs, not buckets — the list
 * keeps the scorer's race order, so a race moved out of its day reads as
 * its own day rather than being pulled back to the others.
 *
 * No headings at all when no race has a date: there would be one heading,
 * saying only that nothing is dated. The year joins the label only when
 * the races span more than one, as a winter series does.
 */
export function raceDayHeadings(races: readonly Pick<Race, 'date'>[]): (string | null)[] {
  const years = new Set(
    races.filter((r) => formatRaceDay(r.date, false) !== null).map((r) => r.date.slice(0, 4)),
  );
  if (years.size === 0) return races.map(() => null);
  const withYear = years.size > 1;
  const labels = races.map((r) => formatRaceDay(r.date, withYear) ?? UNDATED_RACE_DAY);
  return labels.map((label, i) => (i === 0 || labels[i - 1] !== label ? label : null));
}
