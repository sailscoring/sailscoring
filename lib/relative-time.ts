/**
 * Compact relative-time formatting for activity surfaces (#153): "just now",
 * "5m ago", "3h ago", "2d ago", and a plain locale date once a week has
 * passed. Pure (an injectable `now` keeps it testable); client-safe.
 */
export function formatRelativeTime(
  when: string | number | Date,
  now: number = Date.now(),
): string {
  const t =
    when instanceof Date
      ? when.getTime()
      : typeof when === 'number'
        ? when
        : Date.parse(when);
  if (!Number.isFinite(t)) return '';

  const sec = Math.round((now - t) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}
