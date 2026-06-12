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

const TRAILING_INTEGER = /(\d+)\s*$/;

/**
 * Suggest a name for a follow-on series. Names that end in an integer
 * increment it ("Spring Series 1" → "Spring Series 2", "Autumn 2025" →
 * "Autumn 2026" — usually right for season-year names too); anything else
 * gets " 2" appended ("Frostbites" → "Frostbites 2"). The counter keeps
 * climbing past taken names, so rolling "Series 2" over while "Series 3"
 * exists suggests "Series 4".
 */
export function suggestFollowOnName(
  sourceName: string,
  existing: Iterable<string>,
): string {
  const trimmed = sourceName.trim();
  const existingNorm = new Set<string>();
  for (const name of existing) existingNorm.add(normalizeSeriesName(name));

  const match = trimmed.match(TRAILING_INTEGER);
  const root = match ? trimmed.slice(0, -match[0].length) : `${trimmed} `;
  let n = match ? Number(match[1]) + 1 : 2;

  while (existingNorm.has(normalizeSeriesName(`${root}${n}`))) n++;
  return `${root}${n}`;
}

/** Lowercase/strip/hyphenate a series name for filenames and published URLs.
 *  Identical behaviour matters in both: a saved file and its published page
 *  must agree on the slug. */
export function seriesSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'series';
}
