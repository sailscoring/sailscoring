/**
 * Multi-key click-to-sort for hand-rolled tables.
 *
 * The stack is an ordered list of keys: the first decides, the rest break
 * ties, so "nationality, then gender, then sail number" is one expression
 * rather than three clicks in reverse order. Three keys is the cap — Sailwave,
 * which is where scorers meet this idea, sorts on a column or a pair, and a
 * deeper stack stops being something anyone can read off the header row.
 *
 * Sorting is view state. Nothing here persists, and the comparator is applied
 * to an already-ordered list, so `Array.prototype.sort` being stable (ES2019)
 * is what keeps rows in their underlying order once every key ties.
 *
 * The comparators are the generic ones — text, numbers, blanks. Column
 * identity and the accessor for each belong to the table, which is the only
 * thing that knows which of its columns are currently shown.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortKey {
  columnId: string;
  dir: SortDirection;
}

/** How many keys the stack holds before the oldest is dropped. */
export const MAX_SORT_KEYS = 3;

export interface SortableColumn<T> {
  id: string;
  /** Ascending comparison. Direction is applied by {@link comparatorFor}. */
  compare: (a: T, b: T) => number;
}

/**
 * Blank values sort as greater than any real one, so they collect at the end
 * of an ascending sort and the start of a descending one. Always-last would
 * read better in isolation but isn't reversible, and a scorer reversing a
 * column to find the empty rows is a real use.
 */
function compareBlankLast<V>(
  a: V | null | undefined,
  b: V | null | undefined,
  compare: (a: V, b: V) => number,
): number {
  const aBlank = a === null || a === undefined || a === '';
  const bBlank = b === null || b === undefined || b === '';
  if (aBlank || bBlank) return aBlank && bBlank ? 0 : aBlank ? 1 : -1;
  return compare(a as V, b as V);
}

// Numeric so a club like "49er Fleet 2" orders sensibly; base sensitivity so
// case and accents don't split otherwise-equal names into arbitrary groups.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Compare display text, blanks last. */
export function compareText(a: string | null | undefined, b: string | null | undefined): number {
  return compareBlankLast(a, b, (x, y) => collator.compare(x, y));
}

/** Compare numbers, blanks last. */
export function compareNumeric(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  return compareBlankLast(a, b, (x, y) => x - y);
}

/** The direction this column is currently sorted in, if it is in the stack. */
export function sortDirectionFor(keys: SortKey[], columnId: string): SortDirection | undefined {
  return keys.find((k) => k.columnId === columnId)?.dir;
}

/**
 * This column's 1-based position in the stack, or undefined when it isn't
 * sorted. Only meaningful to show once more than one key is active — with a
 * single key the badge would say "1" and mean nothing.
 */
export function sortPositionFor(keys: SortKey[], columnId: string): number | undefined {
  if (keys.length < 2) return undefined;
  const i = keys.findIndex((k) => k.columnId === columnId);
  return i === -1 ? undefined : i + 1;
}

/**
 * Apply a click to the stack.
 *
 * A plain click sorts by that column alone; clicking it again reverses it, and
 * a third click clears the sort — which is how the list gets back to its
 * default order without a separate reset control.
 *
 * An additive click (shift) appends the column instead of replacing the stack,
 * and cycles asc → desc → gone in place for a column already in it. Appending
 * past {@link MAX_SORT_KEYS} drops the oldest key, so the most recent intent
 * is the one that survives.
 */
export function toggleSortKey(
  keys: SortKey[],
  columnId: string,
  additive: boolean,
): SortKey[] {
  const existing = keys.find((k) => k.columnId === columnId);

  if (!additive) {
    if (existing && keys.length === 1) {
      return existing.dir === 'asc' ? [{ columnId, dir: 'desc' }] : [];
    }
    return [{ columnId, dir: 'asc' }];
  }

  if (existing) {
    if (existing.dir === 'asc') {
      return keys.map((k) => (k.columnId === columnId ? { columnId, dir: 'desc' as const } : k));
    }
    return keys.filter((k) => k.columnId !== columnId);
  }

  const appended = [...keys, { columnId, dir: 'asc' as const }];
  return appended.slice(-MAX_SORT_KEYS);
}

/**
 * The comparator for a stack of keys. Returns undefined when nothing is
 * sorted, so callers can skip copying the list entirely.
 */
export function comparatorFor<T>(
  keys: SortKey[],
  columns: SortableColumn<T>[],
): ((a: T, b: T) => number) | undefined {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const active = keys
    .map((k) => ({ column: byId.get(k.columnId), dir: k.dir }))
    .filter((k): k is { column: SortableColumn<T>; dir: SortDirection } => k.column !== undefined);
  if (active.length === 0) return undefined;

  return (a, b) => {
    for (const { column, dir } of active) {
      const c = column.compare(a, b);
      if (c !== 0) return dir === 'asc' ? c : -c;
    }
    return 0;
  };
}
