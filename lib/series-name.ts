/**
 * Series name uniqueness + disambiguation helpers.
 *
 * Series names are the primary identifier in the UI (list, page titles, exports),
 * so the app enforces case-insensitive uniqueness across the local series set.
 * Canonical disambiguation suffix is ` (2)`, ` (3)`, …; the same convention is
 * used across `.sailscoring` file opens, public-export imports, and
 * wizard-placeholder fallbacks.
 */

/** Lowercase + trim. For compare only; the stored form preserves the user's casing. */
export function normalizeSeriesName(name: string): string {
  return name.trim().toLowerCase();
}

export function isDuplicateSeriesName(
  candidate: string,
  existing: Iterable<string>,
): boolean {
  const needle = normalizeSeriesName(candidate);
  if (!needle) return false;
  for (const name of existing) {
    if (normalizeSeriesName(name) === needle) return true;
  }
  return false;
}

const TRAILING_COUNTER = / \((\d+)\)$/;

/**
 * Return `baseName` if unused, otherwise the lowest `${root} (n)` that's free.
 * Case-insensitive + whitespace-trimmed. If `baseName` already ends with ` (N)`,
 * strip it first so repeated imports become ` (2)`, ` (3)`, … rather than
 * ` (2) (2)`.
 */
export function disambiguateSeriesName(baseName: string, existing: Iterable<string>): string {
  const trimmed = baseName.trim();
  const existingNorm = new Set<string>();
  for (const name of existing) existingNorm.add(normalizeSeriesName(name));

  if (!existingNorm.has(normalizeSeriesName(trimmed))) return trimmed;

  const match = trimmed.match(TRAILING_COUNTER);
  const root = match ? trimmed.slice(0, -match[0].length) : trimmed;
  const startFrom = match ? Number(match[1]) + 1 : 2;

  let n = startFrom;
  while (existingNorm.has(normalizeSeriesName(`${root} (${n})`))) n++;
  return `${root} (${n})`;
}
