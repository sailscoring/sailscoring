/**
 * Helpers for CSV competitor import.
 */

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
