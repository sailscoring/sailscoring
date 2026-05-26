import type { Category, Series } from './types';

/**
 * Pure grouping helpers for the home series list (#154). Kept out of the page
 * component so the partitioning rules can be unit-tested directly.
 */

export interface CategoryGroup {
  /** `null` is the synthetic "Uncategorized" bucket. */
  category: Category | null;
  series: Series[];
}

export interface YearGroup {
  /** `null` is the "Undated" bucket (no parseable start date). */
  year: number | null;
  series: Series[];
}

/** Year of the event, parsed from `startDate` ("YYYY-MM-DD"); null if unset. */
export function seriesEventYear(s: Series): number | null {
  const m = /^(\d{4})/.exec(s.startDate ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Partition active series into category sections. Categories appear in their
 * `displayOrder`; the Uncategorized bucket sorts last. Only non-empty groups
 * are returned — empty categories stay selectable in the move menu but aren't
 * shown as sections. Input order is preserved within each group.
 *
 * A series whose `categoryId` doesn't match a known category (e.g. deleted in
 * another tab before this list refreshed) falls into Uncategorized.
 */
export function groupActiveByCategory(
  series: Series[],
  categories: Category[],
): CategoryGroup[] {
  const byId = new Map(categories.map((c) => [c.id, c] as const));
  const buckets = new Map<string | null, Series[]>();
  for (const s of series) {
    const key = s.categoryId && byId.has(s.categoryId) ? s.categoryId : null;
    const list = buckets.get(key) ?? [];
    list.push(s);
    buckets.set(key, list);
  }
  const groups: CategoryGroup[] = [];
  for (const c of [...categories].sort((a, b) => a.displayOrder - b.displayOrder)) {
    const list = buckets.get(c.id);
    if (list && list.length) groups.push({ category: c, series: list });
  }
  const uncategorized = buckets.get(null);
  if (uncategorized && uncategorized.length) {
    groups.push({ category: null, series: uncategorized });
  }
  return groups;
}

/**
 * Partition archived series into year sections. Years descend (most recent
 * first); the "Undated" bucket sorts last. Within a year, series sort by start
 * date descending; the undated bucket sorts by name so the order is stable.
 */
export function groupArchivedByYear(series: Series[]): YearGroup[] {
  const buckets = new Map<number | null, Series[]>();
  for (const s of series) {
    const y = seriesEventYear(s);
    const list = buckets.get(y) ?? [];
    list.push(s);
    buckets.set(y, list);
  }
  const years = [...buckets.keys()]
    .filter((y): y is number => y !== null)
    .sort((a, b) => b - a);
  const groups: YearGroup[] = years.map((y) => ({
    year: y,
    series: buckets
      .get(y)!
      .slice()
      .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')),
  }));
  const undated = buckets.get(null);
  if (undated && undated.length) {
    groups.push({
      year: null,
      series: undated.slice().sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return groups;
}
