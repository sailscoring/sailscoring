/**
 * Absolute date formatting, one definition per format. Relative stamps
 * ("3 minutes ago") live in lib/relative-time.ts; the published results
 * renderer keeps its own timezone-pinned formats in lib/results-renderer.ts.
 */

/** "12 Jun 2026" — the published workspace index's date format. */
export function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** "today at 14:05" / "yesterday at 14:05" / a locale date — for save and
 *  edit stamps in the app UI. */
export function formatDayStamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return d.toLocaleDateString();
}

/** "last saved today at 14:05" / "last saved yesterday" / "last saved
 *  12/06/2026" — the home-page series card's save stamp. (Deliberately
 *  drops the time on the yesterday branch, matching the shipped strings.) */
export function formatSaveDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === now.toDateString())
    return `last saved today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (d.toDateString() === yesterday.toDateString())
    return `last saved yesterday`;
  return `last saved ${d.toLocaleDateString()}`;
}

/**
 * A series date at whatever precision it is known to, for display.
 *
 * An archived event often states a year and nothing finer, and sometimes a
 * month — a results page headed "2023", a report saying the event was sailed
 * at Schull in November. A full day is left exactly as stored, since that is
 * what the app has always shown; the coarser forms are spelled out rather
 * than left as "2023-11", which reads like a truncated date rather than a
 * deliberate one.
 */
export function formatSeriesDate(date: string | undefined): string {
  if (!date) return '';
  const month = /^(\d{4})-(\d{2})$/.exec(date);
  if (!month) return date;
  const name = new Date(Number(month[1]), Number(month[2]) - 1, 1)
    .toLocaleDateString('en-IE', { month: 'long' });
  return `${name} ${month[1]}`;
}
