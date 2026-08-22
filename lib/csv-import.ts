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
  | 'alternativeSailNumbers'
  | 'entryNumber'
  | 'seed'
  | 'initialFleet'
  | 'worldSailingId'
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

/** A column-index-keyed map of what each CSV column maps to. */
export type ColumnMap = Record<number, ColumnTarget>;

/** Sentinel target: create a fresh subdivision axis from this column's header. */
export const NEW_AXIS_TARGET = 'newaxis';

/**
 * Split one person cell (crew, owner, helm, or primary) into individual
 * names. Splits only on separators that unambiguously mean "next person":
 * Sailwave's `<br>` publishing convention, literal newlines, and semicolons.
 * Deliberately NOT on commas (surname-first "MOUSE Micky" formats put a comma
 * inside one name) and NOT on "&" ("Alice & Bob Byrne" is two people sharing
 * a surname, and "J & M Murphy" is the canonical co-owner spelling — one
 * entry unless the sheet separates them).
 */
export function splitPersonCell(raw: string): string[] {
  return raw
    .split(/<br\s*\/?>|\r?\n|;/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

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

/** Normalise a header for rule matching: the CSV may use spaced ("Sail
 *  Number"), snake_case, or camelCase ("sailNumber") conventions, so insert a
 *  space at each lowercase→uppercase transition before lowercasing — without
 *  it, `\b`-anchored rules never fire inside concatenated words. */
function normalizeHeader(header: string): string {
  return header.trim().replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/**
 * Whether a header names the column that splits competitors into fleets.
 *
 * Grouping is not a field role — there is no `Competitor.fleet`, only
 * `fleetIds` — so it is detected separately and never occupies a column's
 * mapping. That is what lets one "Class" column both group the fleets and
 * record each boat's class. Only a Fleet header is detected: Class means
 * boat class and Division means subdivision, and neither stands in for
 * grouping. A file with neither proposes one fleet, and the importer's
 * Fleets step offers to split it by any column the scorer picks.
 */
export function isGroupingHeader(header: string): boolean {
  const h = normalizeHeader(header);
  // "Initial fleet" names one boat's assignment, not the axis the entry list
  // is split along — it is a field of its own (see `INITIAL_FLEET_HEADER`).
  return /\bfleet\b/.test(h) && !INITIAL_FLEET_HEADER.test(h);
}

/**
 * A header naming the fleet a seeding committee assigned the boat to, rather
 * than a fleet the entry list is divided into. Qualified spellings only —
 * a bare "Fleet" column is the grouping column on an ordinary series, and is
 * read as the assignment only on a split-fleet series, where the fleets
 * belong to the assignment rounds and there is nothing to group.
 */
const INITIAL_FLEET_HEADER =
  /\b(initial|assigned?|allocated?|seed(ing)?|start(ing)?|preliminary|qualifying)\b.{0,4}\b(fleet|group|colou?r)\b/;

/** Auto-detect the most-likely field role for a CSV column header. */
export function autoDetectField(header: string): CompetitorField {
  const h = normalizeHeader(header);
  // The World Sailing Sailor ID must be checked before `/sail/`: both "World
  // Sailing ID" and "Sailor ID" contain it. Sailwave's `HelmID` belongs here
  // too — its user guide is explicit that the *ID fields are for a sailor
  // identification string such as the WS Sailor ID, not for arbitrary data.
  if (/world\s*sailing|sailor\s*id|\bwsid\b|\bws\s*id\b|\bisaf\b|ifperson|\bhelm\s*id\b/.test(h))
    return 'worldSailingId';
  if (/sail/.test(h)) return 'sailNumber';
  if (/\bbow\b/.test(h)) return 'bowNumber';
  if (/entry\s*(number|no|id|#)?/.test(h)) return 'entryNumber';
  // Before the seeding rule: "Seeding fleet" carries both words, and it is
  // the assignment, not the rank.
  if (INITIAL_FLEET_HEADER.test(h)) return 'initialFleet';
  if (/\bseed(ing)?\b|\brank(ing)?\b/.test(h)) return 'seed';
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
  // fleet. "division" used to fall through to fleet; it is now its own role.
  // "class" is intentionally left to `boatClass` above — a CSV "Class" column
  // is far more often the boat class than a subdivision label.
  if (/\bsubdivision\b|division|category/.test(h)) return 'subdivision';
  // A Fleet header has no field of its own; see `isGroupingHeader`.
  if (/\bfleet\b/.test(h)) return 'ignore';
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
 * What a seeding-ish column on a split-fleet series' entry list actually
 * carries: the committee's ranking (`seed`) or the assignment it made from
 * one (`initialFleet`).
 *
 * The cells decide, not the header — committees label the column "Fleet",
 * "Seeding", "Group" and worse, and the two kinds of value look nothing
 * alike. Every non-blank cell a positive whole number is a ranking; anything
 * else is a set of fleet labels. Returns null when the column is empty, or
 * when the caller should leave the header's own detection alone.
 *
 * The one case this cannot read is a committee that numbers its fleets
 * 1/2/3 — indistinguishable from a ranking, and deliberately not guessed at:
 * the scorer picks the target in the mapping dropdown instead, and the seed
 * dialog's preview shows the resulting fleet sizes before anything commits.
 */
export function routeSeedingColumn(values: readonly string[]): 'seed' | 'initialFleet' | null {
  const filled = values.map((v) => v.trim()).filter((v) => v.length > 0);
  if (filled.length === 0) return null;
  return filled.every((v) => /^\d+$/.test(v) && parseInt(v, 10) > 0) ? 'seed' : 'initialFleet';
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
