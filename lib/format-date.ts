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
