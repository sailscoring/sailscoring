/**
 * Helpers for CSV competitor import.
 */

/** Field roles a CSV column can map to in the importer's column-mapping
 *  dropdown. `primary` is the configurable primary-person slot (helm or
 *  owner depending on the series); `helm` and `owner` are the role-specific
 *  values used when both are present in the same CSV. */
export type CompetitorField =
  | 'sailNumber'
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
  | 'fleet'
  | 'tcc'
  | 'py'
  | 'nhcStartingTcf'
  | 'echoStartingTcf'
  | 'ignore';

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
  if (/age/.test(h)) return 'age';
  if (/fleet|division/.test(h)) return 'fleet';
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
