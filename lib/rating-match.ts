/**
 * Source-neutral helpers for matching competitors to external rating records
 * by sail number and boat name. Shared by the Irish Sailing (ECHO) and
 * international IRC sources of the Update Handicaps dialog — kept in their own
 * module so neither source has to import from the other.
 *
 * Pure: no `server-only`, no network. Reads one deployment parameter
 * (`NEXT_PUBLIC_DEFAULT_SAIL_COUNTRY`) for the prefix to assume when a
 * competitor's sail number omits its country code.
 */

/** Which IRC TCC column to read — the scorer's spin/non-spin choice. */
export type IrcTccVariant = 'spin' | 'non-spin';

/**
 * Canonicalise a sail number: uppercase, and strip everything that isn't a
 * letter or digit. So `"IRL 1431"`, `"irl-1431"`, and `"IRL1431"` all collapse
 * to `"IRL1431"`.
 */
export function normalizeSailNumber(sailNumber: string): string {
  return sailNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface SailNumberParts {
  /** Fully normalised, e.g. `"IRL1431"`. */
  full: string;
  /** Leading national-letters prefix, e.g. `"IRL"`; empty when absent. */
  prefix: string;
  /** The remainder after the prefix, e.g. `"1431"`. */
  core: string;
}

/**
 * Split a sail number into its national prefix and numeric core. Sail Scoring
 * competitors commonly omit the country code (`"1431"`), whereas rating lists
 * usually carry it (`"IRL1431"`) — splitting lets the matcher compare on the
 * core when one side has no prefix, while still refusing to match two
 * *different* prefixes (an Irish `IRL1431` is not a British `GBR1431`). See
 * {@link sailNumbersMatch}.
 */
export function sailNumberParts(sailNumber: string): SailNumberParts {
  const full = normalizeSailNumber(sailNumber);
  const m = /^([A-Z]*)(.*)$/.exec(full)!;
  return { full, prefix: m[1], core: m[2] };
}

/**
 * The country code to assume for a competitor whose sail number has no
 * national prefix. Defaults to `IRL` (Sail Scoring's home instance is Irish),
 * overridable per deployment via `NEXT_PUBLIC_DEFAULT_SAIL_COUNTRY`. Set it to
 * an empty string to assume nothing — then a prefix-less sail number stays
 * country-agnostic and matches across nations (more likely to be ambiguous).
 */
export function defaultSailCountry(): string {
  return (process.env.NEXT_PUBLIC_DEFAULT_SAIL_COUNTRY ?? 'IRL')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/**
 * Apply a default country code to a prefix-less sail number. A competitor who
 * types `"1431"` on an Irish instance is taken to mean `"IRL1431"`, so the
 * worldwide IRC list resolves to the Irish boat rather than reporting every
 * `…1431` across all nations as ambiguous. Returns `parts` unchanged when it
 * already has a prefix, has no core, or `defaultCountry` is empty.
 */
export function withDefaultCountry(
  parts: SailNumberParts,
  defaultCountry: string,
): SailNumberParts {
  if (parts.prefix || !parts.core || !defaultCountry) return parts;
  const prefix = defaultCountry.toUpperCase();
  return { prefix, core: parts.core, full: prefix + parts.core };
}

/**
 * Whether two sail numbers refer to the same boat for matching purposes.
 * Cores must be equal and non-empty; prefixes must be compatible — equal, or
 * at least one side absent (the country-code-less case). Two present but
 * differing prefixes never match.
 */
export function sailNumbersMatch(a: SailNumberParts, b: SailNumberParts): boolean {
  if (!a.core || a.core !== b.core) return false;
  if (a.prefix && b.prefix) return a.prefix === b.prefix;
  return true;
}

/**
 * Canonicalise a boat name for liberal matching: lowercase, drop accents and
 * everything that isn't a letter or digit. So `"AfterHours Adó"` and
 * `"Afterhours-Ado"` compare equal. Returns `""` for an empty/undefined name
 * (which never matches).
 */
export function normalizeBoatName(name: string | undefined): string {
  if (!name) return '';
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

/**
 * How a typed sail number relates to a stored one, for the places a scorer
 * types a number to find a boat: finish entry, the finish sheet import, and
 * race-day check-in.
 *
 * Comparison is on the normalised form, split into national prefix and
 * core, so a recorder who writes `4076` for a boat registered as `IRL4076`
 * finds it — championship fleets carry national letters that nobody types
 * at the finish line — and `IRL4076` finds a boat stored as `IRL 4076`.
 *
 * - `exact`: the same boat by {@link sailNumbersMatch} rules (equal cores;
 *   prefixes equal or one absent), or identical normalised strings.
 * - `prefix`: the typed text is the start of the stored number. Typed text
 *   with national letters must line up against the full stored number
 *   (`IRL4` → `IRL4076`); typed digits alone match the start of the core
 *   (`407` → `IRL4076`), so `GBR4076` never finds `IRL4076`.
 * - `null`: no relation, or either side is blank.
 */
export type SailEntryMatch = 'exact' | 'prefix';

export function matchSailEntry(stored: string, typed: string): SailEntryMatch | null {
  const t = sailNumberParts(typed);
  const s = sailNumberParts(stored);
  if (!t.full || !s.full) return null;
  if (t.full === s.full || sailNumbersMatch(t, s)) return 'exact';
  if (t.prefix) return s.full.startsWith(t.full) ? 'prefix' : null;
  return s.core.startsWith(t.core) ? 'prefix' : null;
}

/**
 * The registered sail number a typed entry is matched against. A number
 * stored without national letters on a competitor whose nationality is known
 * is matched as if it carried them, so `IRL1234` finds the Irish `1234`
 * while `GBR1234` does not. A number that already carries letters is used as
 * stored, whatever the nationality field says.
 */
export function registeredSailForEntry(c: { sailNumber: string; nationality?: string | null }): string {
  const sail = c.sailNumber.trim();
  const nationality = c.nationality?.trim() ?? '';
  if (!sail || !nationality || sailNumberParts(sail).prefix) return sail;
  return `${nationality}${sail}`;
}

/**
 * The same relation for an identifier that carries no national prefix — a
 * bow number — where only the normalised strings are compared.
 */
export function matchPlainEntry(stored: string, typed: string): SailEntryMatch | null {
  const t = normalizeSailNumber(typed);
  const s = normalizeSailNumber(stored);
  if (!t || !s) return null;
  if (t === s) return 'exact';
  return s.startsWith(t) ? 'prefix' : null;
}
