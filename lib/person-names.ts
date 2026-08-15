/**
 * Comparing sailors' names across two lists that were typed by different
 * people.
 *
 * A championship entry list and the ranking or profile it is joined against
 * rarely agree character for character, and the differences say nothing about
 * whether they name the same sailor:
 *
 *   Zachary Littlewood       Zac Littlewood              (a shortened name)
 *   Philipp Grochtmann       Philipp Andreas Grochtmann  (a middle name)
 *   Sergio Garcia Garrido    Sergio Garrido              (a dropped surname)
 *   Robert Meek              Robert Meek IV              (a suffix)
 *   Sultan … Alowaus         Sultan … Alowais            (a transliteration)
 *
 * Calling all of those a mismatch buries the difference that matters — a
 * sailor joined to the wrong record — under a screenful of noise. So the
 * comparison tolerates them, and reports *how* two names agreed rather than
 * whether, leaving the caller to decide what a looser agreement is worth.
 */

/** Generational suffixes a formal record keeps and an entry list rarely
 *  repeats. */
const NAME_SUFFIXES = new Set(['jr', 'jnr', 'sr', 'snr', 'ii', 'iii', 'iv', 'v', 'vi']);

/** Fold a name to comparable tokens: accents, case, and punctuation go (World
 *  Sailing writes given names as "Dean,John"), as do bare initials and
 *  generational suffixes. Order is not preserved — family-name-first is a
 *  convention, not a difference. */
export function nameTokens(value: string | undefined): string[] {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !NAME_SUFFIXES.has(token));
}

/** Levenshtein distance, abandoned as soon as it can only exceed `max`. */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return false;
    previous = row;
  }
  return previous[b.length] <= max;
}

/** Whether one name token can be the other. */
function tokensAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // A shortened given name: "Zac" for "Zachary", "Leo" for "Leopoldo".
  if (shorter.length >= 3 && longer.startsWith(shorter)) return true;
  // A single character of transliteration: "Alowais" for "Alowaus". Held to
  // longer tokens, where one letter is a small share of the name.
  return shorter.length >= 5 && withinEditDistance(a, b, 1);
}

export type NameAgreement = 'same' | 'variant' | 'different';

/**
 * How two token lists agree: `same` if they are the same names, `variant` if
 * the shorter list is carried entirely by the longer one — every token
 * accounted for, extra middle or family names allowed on either side.
 *
 * A single token is never enough. Sharing one family name is what siblings at
 * the same regatta do, and telling them apart is the point of comparing.
 */
export function namesAgree(a: readonly string[], b: readonly string[]): NameAgreement {
  if (a.length === 0 || b.length === 0) return 'different';
  if (a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ')) return 'same';
  const [fewer, more] = a.length <= b.length ? [a, b] : [b, a];
  if (fewer.length < 2) return 'different';
  const unclaimed = [...more];
  for (const token of fewer) {
    // Exact first, so a loose rule can't claim a token an exact match needs.
    let at = unclaimed.indexOf(token);
    if (at < 0) at = unclaimed.findIndex((candidate) => tokensAgree(token, candidate));
    if (at < 0) return 'different';
    unclaimed.splice(at, 1);
  }
  return 'variant';
}

/** Whether two written names can be the same person at all. */
export function namesCouldMatch(a: string | undefined, b: string | undefined): boolean {
  return namesAgree(nameTokens(a), nameTokens(b)) !== 'different';
}
