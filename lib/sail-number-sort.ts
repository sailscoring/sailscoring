/**
 * The one comparator for ordering competitors by sail number.
 *
 * Sail numbers are free text, so a plain string comparison orders them by
 * first character: `217236` lands before `7`, and a scorer looking for a
 * short number finds it at the bottom of the list. What people expect is the
 * national prefix grouping first and the digits compared as numbers —
 * `IRL 7`, `IRL 69`, `IRL 217236`, with every `GBR` entry together.
 *
 * Deliberately not `localeCompare(…, { numeric: true })`: locale collation
 * varies with the runtime's ICU data and gives spaces and punctuation their
 * own weighting, so `IRL 7`, `IRL-7`, and `IRL7` need not agree. Published
 * results are rendered on the server and the same list is rendered on the
 * client, so the order has to be identical in both. Comparing explicit
 * segments of a canonicalised string keeps it deterministic and testable.
 *
 * Pure: safe to import from server rendering, client components, and the
 * scoring engine alike.
 */

import { normalizeSailNumber, sailNumberParts } from './rating-match';

/** A run of digits or of letters within a canonicalised sail number. */
interface Segment {
  digits: boolean;
  text: string;
}

function segments(normalized: string): Segment[] {
  return (normalized.match(/\d+|\D+/g) ?? []).map((text) => ({
    digits: /^\d/.test(text),
    text,
  }));
}

/**
 * Compare two runs of digits as numbers, without going through `Number` —
 * sail numbers are not bounded by `Number.MAX_SAFE_INTEGER` in principle, and
 * a silent precision loss here would be an ordering bug nobody could see.
 * Leading zeros carry no value, so `007` sorts as `7` — between `6` and `8`,
 * not ahead of every other number. (The two spellings are still separated by
 * the tiebreak in {@link compareSailNumbers}, which keeps the order total.)
 */
function compareDigitRuns(a: string, b: string): number {
  const sa = a.replace(/^0+/, '');
  const sb = b.replace(/^0+/, '');
  if (sa.length !== sb.length) return sa.length - sb.length;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Digit runs sort before letter runs, so a prefix-less number precedes a
 *  prefixed one (`7` before `IRL 7`). Series rarely mix the two conventions;
 *  when one does, the bare numbers group at the top rather than scattering. */
function compareSegments(a: Segment[], b: Segment[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const sa = a[i];
    const sb = b[i];
    if (sa.digits !== sb.digits) return sa.digits ? -1 : 1;
    const c = sa.digits
      ? compareDigitRuns(sa.text, sb.text)
      : sa.text < sb.text
        ? -1
        : sa.text > sb.text
          ? 1
          : 0;
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/**
 * Order two sail numbers the way a scorer reads a list: national prefix
 * first, then the number itself ascending. Case and punctuation are ignored
 * for ordering purposes but break ties, so the result is a total order and
 * the sort is reproducible.
 */
export function compareSailNumbers(a: string, b: string): number {
  const c = compareSegments(
    segments(normalizeSailNumber(a)),
    segments(normalizeSailNumber(b)),
  );
  if (c !== 0) return c;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** {@link compareSailNumbers} lifted to anything carrying a sail number. */
export function bySailNumber<T extends { sailNumber: string }>(a: T, b: T): number {
  return compareSailNumbers(a.sailNumber, b.sailNumber);
}

/**
 * Order by the numeric core alone, ignoring the national prefix — so `GBR 12`
 * and `IRL 12` land together rather than a nation apart.
 *
 * This is the wrong order for a competitor list and the right one for seeding
 * a split-fleet championship, where the sail number stands in for nothing but
 * itself and grouping by nation is the outcome to avoid. Only
 * `seedOrder` in `split-fleets.ts` should want it.
 */
export function compareSailNumbersIgnoringPrefix(a: string, b: string): number {
  const c = compareSegments(
    segments(sailNumberParts(a).core),
    segments(sailNumberParts(b).core),
  );
  return c !== 0 ? c : compareSailNumbers(a, b);
}
