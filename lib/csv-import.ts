/**
 * Helpers for CSV competitor import.
 */

/** Field roles a CSV column can map to in the importer's column-mapping
 *  dropdown. `primary` is the configurable primary-person slot (helm or
 *  owner depending on the series); `helm` and `owner` are the role-specific
 *  values used when both are present in the same CSV. */
export type CompetitorField =
  | 'sailNumber'
  | 'bowNumber'
  | 'boatName'
  | 'boatClass'
  | 'primary'
  | 'helm'
  | 'owner'
  | 'crewName'
  | 'club'
  | 'nationality'
  | 'gender'
  | 'age'
  | 'subdivision'
  | 'fleet'
  | 'tcc'
  | 'vprsTcc'
  | 'py'
  | 'nhcStartingTcf'
  | 'echoStartingTcf'
  | 'ignore';

/**
 * A column-mapping target. Beyond the plain field roles, a column may target a
 * specific subdivision axis: an existing one (by id, `axis:<id>`) or a new axis
 * to be created from the column header (`newaxis`), or — when the import also
 * pushes to rrs.org — a relay-only field (`relay:<field>`) that is sent to
 * rrs.org and never stored. Encoded as strings so they flow through the
 * `<Select>` dropdown and the column map unchanged; the plain field switches
 * (planner, reconcile) never match an axis or relay target.
 */
export type ColumnTarget =
  | CompetitorField
  | `axis:${string}`
  | typeof NEW_AXIS_TARGET
  | `relay:${RelayField}`;

/** Sentinel target: create a fresh subdivision axis from this column's header. */
export const NEW_AXIS_TARGET = 'newaxis';

/** Contact / membership fields relayed to rrs.org at import time and
 *  deliberately never stored (they belong to the entry system, not the
 *  scoring engine). Keys match `RrsOrgRelayFields` in `lib/rrs-org.ts`. */
export type RelayField = 'email' | 'phone' | 'mnaCode' | 'mnaNumber';

export const RELAY_FIELDS: readonly RelayField[] = ['email', 'phone', 'mnaCode', 'mnaNumber'];

/** The dropdown value for a relay-only field. */
export function relayColumnTarget(field: RelayField): ColumnTarget {
  return `relay:${field}`;
}

/** The relay field a target points at, or null if it isn't a relay target. */
export function relayFieldOf(target: ColumnTarget): RelayField | null {
  return target.startsWith('relay:') ? (target.slice('relay:'.length) as RelayField) : null;
}

/**
 * Auto-detect a relay-only field from a column header. Consulted only when
 * the import will also push to rrs.org — without a push these columns stay on
 * whatever `autoDetectField` says (normally `ignore`), keeping the plain CSV
 * flow byte-for-byte unchanged.
 */
export function autoDetectRelayField(header: string): RelayField | null {
  const h = header.trim().replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  if (/e-?mail/.test(h)) return 'email';
  if (/phone|mobile|\bcell\b|\btel\b/.test(h)) return 'phone';
  // "MNA no." / "MNA number" / "membership number" is the member id; a bare
  // "MNA" column is the authority code itself.
  if (/\bmna\b.*(no|num)|member(ship)?\s*(no|num)/.test(h)) return 'mnaNumber';
  if (/\bmna\b/.test(h)) return 'mnaCode';
  return null;
}

/** The dropdown value for an existing subdivision axis. */
export function axisColumnTarget(axisId: string): ColumnTarget {
  return `axis:${axisId}`;
}

/** The axis id a target points at, or null if it isn't an existing-axis target. */
export function subdivisionAxisIdOf(target: ColumnTarget): string | null {
  return target.startsWith('axis:') ? target.slice('axis:'.length) : null;
}

/** Whether a target routes a column into a subdivision axis (existing or new). */
export function isSubdivisionTarget(target: ColumnTarget): boolean {
  return target === NEW_AXIS_TARGET || subdivisionAxisIdOf(target) !== null;
}

/**
 * Pick the configured axis a subdivision-column header best matches, by index,
 * or null to create a new axis. Prefers an exact label match, then falls back to
 * token overlap (so a "Age Category" header lands on an "Age category" axis and
 * a "Division" header on "Division"). Case- and punctuation-insensitive.
 */
export function matchSubdivisionAxis(header: string, axisLabels: string[]): number | null {
  const tokenize = (s: string) =>
    s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  const headerTokens = new Set(tokenize(header));
  if (headerTokens.size === 0) return null;
  const normHeader = [...headerTokens].join(' ');

  let best = -1;
  let bestScore = 0;
  axisLabels.forEach((label, i) => {
    const labelTokens = tokenize(label);
    if (labelTokens.join(' ') === normHeader) {
      best = i;
      bestScore = Infinity; // exact match wins outright
      return;
    }
    if (bestScore === Infinity) return;
    const score = labelTokens.filter((t) => headerTokens.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return bestScore > 0 ? best : null;
}

/**
 * Auto-detect the most-likely field role for a CSV column header.
 *
 * The CSV may use either spaced ("Sail Number"), snake_case, or camelCase
 * ("sailNumber") header conventions. Before matching against the rule
 * library we insert a space at each lowercase→uppercase transition so
 * `\b`-anchored rules fire correctly inside concatenated words — without
 * this, e.g. `boatName` would never match `\bboat\b` and `initialEcho`
 * would never match `\becho\b`.
 */
export function autoDetectField(header: string): CompetitorField {
  const h = header.trim().replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  if (/sail/.test(h)) return 'sailNumber';
  if (/\bbow\b/.test(h)) return 'bowNumber';
  if (/\bboat\b/.test(h)) return 'boatName';
  if (/\bclass\b/.test(h)) return 'boatClass';
  if (/crew/.test(h)) return 'crewName';
  if (/\bhelm\b|skipper/.test(h)) return 'helm';
  if (/\bowner\b|\bentrant\b/.test(h)) return 'owner';
  // Nationality must be checked before `/name/`: bare "nat" and "nationality"
  // both contain the substring "na…" that callers spell as a header, and the
  // reference IODAI CSV uses literally `nat` (which `/name/` doesn't match
  // anyway). Order also catches "country" up-front.
  if (/\bnat\b|nationality|country/.test(h)) return 'nationality';
  if (/name/.test(h)) return 'primary';
  if (/club/.test(h)) return 'club';
  if (/gender|sex/.test(h)) return 'gender';
  // "Age category / group / band / division" is a prize subdivision, not the
  // numeric age field — check that before the bare `/age/` rule claims it.
  if (/age/.test(h)) {
    return /category|division|group|band|subdivision/.test(h) ? 'subdivision' : 'age';
  }
  // Subdivision (Gold/Silver/Bronze, age categories) is a distinct field from
  // fleet. "division" used to fall through to `fleet`; it is now its own role.
  // "class" is intentionally left to `boatClass` above — a CSV "Class" column
  // is far more often the boat class than a subdivision label.
  if (/\bsubdivision\b|division|category/.test(h)) return 'subdivision';
  if (/\bfleet\b/.test(h)) return 'fleet';
  // VPRS must be checked before the generic `tcc` rule — a "VPRS TCC" header
  // contains "tcc" and would otherwise be read as an IRC column.
  if (/vprs/.test(h)) return 'vprsTcc';
  if (/tcc|irc.*rating|rating.*irc/.test(h)) return 'tcc';
  if (/\bpy\b|portsmouth/.test(h)) return 'py';
  if (/\bnhc\b|nhc.*tcf|nhc.*rating/.test(h)) return 'nhcStartingTcf';
  if (/\becho\b|echo.*tcf|echo.*rating|echo.*handicap/.test(h)) return 'echoStartingTcf';
  if (/starting.*tcf/.test(h)) return 'nhcStartingTcf';
  return 'ignore';
}

/**
 * Parse a fleet cell from a CSV row.
 *
 * Multi-fleet competitors are expressed by separating fleet names with a
 * pipe character (`|`), matching the convention used by Sailwave exports:
 *
 *   "PY"        → ["PY"]
 *   "PY|M15"    → ["PY", "M15"]
 *   "  PY  |  M15  " → ["PY", "M15"]   (each part is trimmed)
 *   "PY||M15"   → ["PY", "M15"]        (empty segments dropped)
 *   "PY|py"     → ["PY"]               (case-insensitive dedupe; first spelling wins)
 *   ""          → []                   (caller decides on the default fleet)
 *
 * Pipe was chosen over comma because commas are CSV field separators and
 * would require quoting to round-trip cleanly.
 */
export function parseFleetCell(cell: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of cell.split('|')) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}
