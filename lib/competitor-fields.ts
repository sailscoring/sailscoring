import type {
  Competitor,
  CompetitorFieldKey,
  Fleet,
  MultiPersonFieldKey,
  PrimaryPersonLabel,
  Series,
  SubdivisionAxis,
} from './types';

/** Trim a person-name list and drop empty entries, returning undefined when
 *  nothing remains (sparse storage — a competitor with no crew carries no
 *  `crewNames`, mirroring `cleanSubdivisions`). Shared by the primary, owner,
 *  helm, and crew lists. */
export function cleanPersonNames(names: string[] | undefined): string[] | undefined {
  const out = (names ?? []).map((n) => n.trim()).filter((n) => n.length > 0);
  return out.length > 0 ? out : undefined;
}

/** Order-sensitive equality of two person-name lists, ignoring blank entries.
 *  Used to detect "no change" on CSV re-import. */
export function samePersonNames(a: string[] | undefined, b: string[] | undefined): boolean {
  const na = cleanPersonNames(a) ?? [];
  const nb = cleanPersonNames(b) ?? [];
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

/** Trim a competitor's club list, dropping blanks and repeats. Duplicates are
 *  compared case-insensitively but the scorer's own spelling and order
 *  survive, as they do for alternative sail numbers: an entry list that writes
 *  the same club into both its Club and Other Club columns states one
 *  affiliation, not two. */
export function cleanClubs(clubs: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of clubs ?? []) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** One-line rendering of a club list — "HYC, RIYC". For the contexts that
 *  have a single cell to spend: the competitors table, sorting and search, the
 *  CLI's listing, and the RRS.org push's one `club_name` field. Published
 *  tables have a column of their own and stack the clubs instead. */
export function formatClubs(clubs: readonly string[] | undefined): string {
  return cleanClubs(clubs).join(', ');
}

/** Whether an entry is affiliated to a named club. Membership, not equality:
 *  a boat listing both its home club and a visiting one is a member of each,
 *  which is what a prize clause ("first HYC boat") asks. */
export function isClubMember(clubs: readonly string[] | undefined, club: string): boolean {
  const wanted = club.trim();
  return (clubs ?? []).some((c) => c.trim() === wanted);
}

/** Order-sensitive equality of two club lists, ignoring blanks and repeats.
 *  Used to detect "no change" on CSV re-import. */
export function sameClubs(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const ca = cleanClubs(a);
  const cb = cleanClubs(b);
  return ca.length === cb.length && ca.every((v, i) => v === cb[i]);
}

/** One-line rendering of the primary person(s): a single name as-is, a
 *  multi-person primary joined " & " — "J. Murphy & M. Murphy". The joined
 *  form is also what sorting, search, and duplicate detection compare. */
export function formatPrimaryNames(names: readonly string[]): string {
  return names.filter((n) => n.trim()).join(' & ');
}

/** Render "Helm / Crew" when the series has crew enabled and exactly one crew
 *  is set; otherwise just the primary name(s). Used in autocomplete rows and
 *  finish lists — one-line contexts, so a multi-person crew is deliberately
 *  left to the tables (a finish-sheet row is no place for a keelboat's eight
 *  names). A multi-person primary joins with " & " (it cannot be dropped). */
export function displayHelmCrew(
  competitor: Pick<Competitor, 'names' | 'crewNames'>,
  showCrew: boolean,
): string {
  const primary = formatPrimaryNames(competitor.names);
  const crew = cleanPersonNames(competitor.crewNames);
  if (showCrew && crew?.length === 1) {
    return `${primary} / ${crew[0]}`;
  }
  return primary;
}

/** Label a competitor for finish entry, check-in, and other crew-facing lists.
 *  Leads with the boat name when `boatName` is an enabled display field and the
 *  competitor has one (keelboat one-designs identified by boat name), then
 *  appends the primary person (`displayHelmCrew`): "Eclipse — Hogan / Dyson".
 *  When `boatName` is not enabled or absent, returns just the person, identical
 *  to `displayHelmCrew`. */
export function displayCompetitorLabel(
  competitor: Pick<Competitor, 'names' | 'crewNames' | 'boatName'>,
  opts: { enabledCompetitorFields: readonly CompetitorFieldKey[]; showCrew: boolean },
): string {
  const person = displayHelmCrew(competitor, opts.showCrew);
  const boatName = competitor.boatName?.trim();
  if (opts.enabledCompetitorFields.includes('boatName') && boatName) {
    return `${boatName} — ${person}`;
  }
  return person;
}

/**
 * The fleets a competitor belongs to, in the series' own fleet order.
 * Unresolvable ids are dropped.
 *
 * Ordered here rather than by the caller because `fleetIds` order is an
 * accident of how membership came to be written — a CSV import writes the
 * order the fleet names first appear in the file, adding a fleet by hand
 * appends, and an import that correctly skips an unchanged row leaves
 * whatever order that row already had. A series can end up holding several
 * orders at once, so two boats with identical membership read differently in
 * the same table. Membership order is not data.
 *
 * `displayOrder` decides, with the name as tiebreak: fleets can share a
 * `displayOrder` in older data (see the self-heal in
 * `components/series-settings/fleets-card.tsx`), and `sort` being stable
 * would otherwise quietly fall back to `fleetIds` order for exactly those
 * series.
 */
export function competitorFleets<T extends Pick<Fleet, 'name' | 'displayOrder'>>(
  fleetIds: readonly string[],
  fleetById: Map<string, T>,
): T[] {
  return fleetIds
    .map((id) => fleetById.get(id))
    .filter((f): f is T => f != null)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
}

/** Names of every fleet a competitor belongs to, in the series' own fleet
 *  order (see {@link competitorFleets}). A boat can be entered in more than
 *  one fleet (e.g. a handicap fleet and a scratch fleet sharing a start);
 *  callers should reflect all of them, not just the first. */
export function competitorFleetNames(
  fleetIds: readonly string[],
  fleetById: Map<string, Pick<Fleet, 'name' | 'displayOrder'>>,
): string[] {
  return competitorFleets(fleetIds, fleetById).map((f) => f.name);
}

/** Canonical ordering of all configurable competitor fields. The settings UI
 *  and any UI that lists fields should iterate over this in this order.
 *  `helm` and `owner` are optional *role* fields — use them to record whichever
 *  role the primary label doesn't already carry. */
export const ALL_COMPETITOR_FIELDS: readonly CompetitorFieldKey[] = [
  'bowNumber',
  'alternativeSailNumbers',
  'entryNumber',
  'tallyNumber',
  'seed',
  'initialFleet',
  'worldSailingId',
  'boatName',
  'boatClass',
  'helm',
  'owner',
  'crewName',
  'club',
  'nationality',
  'gender',
  'age',
  'subdivision',
] as const;

/** Human-readable labels for each configurable field. For `subdivision` this is
 *  only a fallback used when no axis is configured: the effective headers are
 *  per-series and come from `Series.subdivisionAxes` (see `subdivisionAxisLabel`). */
export const COMPETITOR_FIELD_LABELS: Record<CompetitorFieldKey, string> = {
  bowNumber: 'Bow number',
  alternativeSailNumbers: 'Alternative sail numbers',
  entryNumber: 'Entry number',
  tallyNumber: 'Tally number',
  seed: 'Seeding rank',
  initialFleet: 'Initial fleet',
  worldSailingId: 'World Sailing ID',
  boatName: 'Boat name',
  boatClass: 'Class',
  helm: 'Helm name',
  owner: 'Owner name',
  crewName: 'Crew',
  club: 'Club',
  nationality: 'Nationality',
  gender: 'Gender',
  age: 'Age',
  subdivision: 'Division',
};

/**
 * Alternative sail numbers are entered and imported as one comma-separated
 * cell — a boat carries a handful at most, and a row of inputs would cost more
 * clicks than it saves. Parsing trims, drops blanks, and de-duplicates
 * case-insensitively while keeping the scorer's own spelling and order.
 */
export function parseAlternativeSailNumbers(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (!value) continue;
    const key = value.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Record a number a boat actually raced under on its alternatives list, so
 *  finish entry matches it from the next race on. Returns the new list, or
 *  null when there is nothing to record: a blank entry, the boat's own
 *  registered number, or a number already listed (all compared
 *  case-insensitively, as matching itself is). */
export function addAlternativeSailNumber(
  competitor: Pick<Competitor, 'sailNumber' | 'alternativeSailNumbers'>,
  entered: string,
): string[] | null {
  const value = entered.trim();
  if (!value) return null;
  const key = value.toUpperCase();
  if (key === competitor.sailNumber.trim().toUpperCase()) return null;
  const existing = competitor.alternativeSailNumbers ?? [];
  if (existing.some((v) => v.trim().toUpperCase() === key)) return null;
  return [...existing, value];
}

/** The inverse of {@link parseAlternativeSailNumbers}, for populating the field. */
export function formatAlternativeSailNumbers(values: string[] | undefined): string {
  return (values ?? []).join(', ');
}

/** Order of the person fields in the "Allow multiple" settings UI. */
export const MULTI_PERSON_FIELD_KEYS: readonly MultiPersonFieldKey[] = [
  'primary',
  'owner',
  'helm',
  'crewName',
] as const;

/** Whether an optional competitor field is one of the person fields that can
 *  be opened to multiple names (`owner`, `helm`, `crewName`). Narrows the key
 *  so the settings card can pass it to the multi-person toggles. */
export function isMultiPersonField(
  field: CompetitorFieldKey,
): field is Extract<MultiPersonFieldKey, CompetitorFieldKey> {
  return field === 'owner' || field === 'helm' || field === 'crewName';
}

/** Whether a person field's entry affordances are opened to multiple names
 *  (per-series setting, gated by the `multi-person-fields` feature). Stored
 *  lists render regardless — this only governs the add-a-row button and the
 *  import's append/split behaviour. */
export function multiPersonAllowed(
  series: Pick<Series, 'multiPersonFields'>,
  key: MultiPersonFieldKey,
): boolean {
  return series.multiPersonFields?.includes(key) ?? false;
}

/** Column headers for the role person fields, singular and plural. Crew is a
 *  mass noun, so it reads the same either way. */
const PERSON_FIELD_HEADERS: Record<'owner' | 'helm' | 'crewName', [string, string]> = {
  owner: ['Owner', 'Owners'],
  helm: ['Helm', 'Helms'],
  crewName: ['Crew', 'Crew'],
};

/** Column header for a role person field. Plural once the series has opened
 *  that field to multiple names — the setting is the scorer's declared intent
 *  for the whole series, so the header doesn't flip about as rows are edited
 *  or as you page through the competitors. */
export function personFieldHeader(
  field: 'owner' | 'helm' | 'crewName',
  multiPersonFields: readonly MultiPersonFieldKey[] | undefined,
): string {
  const [singular, plural] = PERSON_FIELD_HEADERS[field];
  return multiPersonFields?.includes(field) ? plural : singular;
}

/** Form label for a role person field — the header plus the noun the inputs
 *  hold: "Owner name", or "Owner names" when the field takes several. */
export function personFieldFormLabel(
  field: 'owner' | 'helm',
  multiPersonFields: readonly MultiPersonFieldKey[] | undefined,
): string {
  const [singular] = PERSON_FIELD_HEADERS[field];
  return `${singular} ${multiPersonFields?.includes(field) ? 'names' : 'name'}`;
}

/** Display order for the primary-label picker. */
export const PRIMARY_PERSON_LABELS: readonly PrimaryPersonLabel[] = [
  'competitor',
  'entrant',
  'helm',
  'owner',
] as const;

/** Human-readable singular labels for each primary-label option. Used as
 *  column headers and form labels. */
export const PRIMARY_PERSON_LABEL_TEXT: Record<PrimaryPersonLabel, string> = {
  competitor: 'Competitor',
  entrant: 'Entrant',
  helm: 'Helm',
  owner: 'Owner',
};

/** Plural forms of the primary-label options, for the column header of a
 *  series whose entries carry more than one primary name. */
const PRIMARY_PERSON_LABEL_PLURAL: Record<PrimaryPersonLabel, string> = {
  competitor: 'Competitors',
  entrant: 'Entrants',
  helm: 'Helms',
  owner: 'Owners',
};

/** Header for the primary person column, plural when the series opens the
 *  primary slot to multiple names. */
export function primaryPersonHeader(
  label: PrimaryPersonLabel,
  multiPersonFields: readonly MultiPersonFieldKey[] | undefined,
): string {
  return multiPersonFields?.includes('primary')
    ? PRIMARY_PERSON_LABEL_PLURAL[label]
    : PRIMARY_PERSON_LABEL_TEXT[label];
}

/** The plural noun for a person field opened to several names, for naming the
 *  setting in prose. The primary slot takes the series' own label. */
export function multiPersonFieldLabel(
  key: MultiPersonFieldKey,
  primaryLabel: PrimaryPersonLabel,
): string {
  return key === 'primary'
    ? primaryPersonHeader(primaryLabel, ['primary'])
    : personFieldHeader(key, [key]);
}

/** Short descriptions to help scorers choose a primary-label option. */
export const PRIMARY_PERSON_LABEL_HINTS: Record<PrimaryPersonLabel, string> = {
  competitor: 'Generic — works for mixed fleets or when you don’t want to commit to a role.',
  entrant: 'Generic — for entries where the identifying person isn’t the sailor (crewed events, corporate entries).',
  helm: 'Role — dinghy pattern. Use for helm-identified entries; Owner becomes an optional field.',
  owner: 'Role — cruiser pattern. Use for owner-identified entries; Helm becomes an optional field.',
};

/** Default set of enabled competitor fields for a new series. Includes boat
 *  name and club so the common cases (dinghy and cruiser) read naturally out
 *  of the box. Intentionally static — we do not infer from fleet scoring
 *  systems, to avoid surprising scorers by silently flipping visibility. */
export function defaultEnabledCompetitorFields(): CompetitorFieldKey[] {
  return ['boatName', 'club'];
}

/** Default primary person label for a new series. Generic ("Competitor")
 *  rather than role-specific so new scorers aren’t forced to commit to a
 *  convention on series creation. */
export const DEFAULT_PRIMARY_PERSON_LABEL: PrimaryPersonLabel = 'competitor';

/** Return the optional-field key that a given primary label occupies, or null
 *  for generic primaries. Used to grey-out the matching field in the Settings
 *  card and the CSV import dropdown: with primary = Helm, the `helm` key is
 *  already the primary slot and must not also be an optional field. */
export function primaryPersonFieldKey(label: PrimaryPersonLabel): CompetitorFieldKey | null {
  if (label === 'helm') return 'helm';
  if (label === 'owner') return 'owner';
  return null;
}

/** Is a given optional field disabled by the current primary label? */
export function isFieldDisabledByPrimary(
  field: CompetitorFieldKey,
  primary: PrimaryPersonLabel,
): boolean {
  return primaryPersonFieldKey(primary) === field;
}

/** Default label for the `subdivision` competitor field. Gold/Silver/Bronze
 *  skill tiers are the canonical case, so "Division" is the out-of-the-box
 *  label; age-category regattas (e.g. ILCA Masters) rename it to "Category". */
export const DEFAULT_SUBDIVISION_LABEL = 'Division';

/** Maximum length of a subdivision label. Long enough for any sensible header
 *  word; short enough to keep table columns and form labels tidy. */
export const SUBDIVISION_LABEL_MAX_LENGTH = 24;

/** The configured subdivision axes for a series, in display order. Empty when
 *  no axis has been added. Tolerates a missing array (file-built Series objects
 *  predating multi-axis), returning []. */
export function subdivisionAxes(
  series: Pick<Series, 'subdivisionAxes'>,
): SubdivisionAxis[] {
  return series.subdivisionAxes ?? [];
}

/** Display label for one axis, falling back to the default for an empty value.
 *  Same dynamic-label pattern as helm/owner under `primaryPersonLabel`. */
export function subdivisionAxisLabel(axis: Pick<SubdivisionAxis, 'label'>): string {
  return axis.label?.trim() || DEFAULT_SUBDIVISION_LABEL;
}

/** A competitor's value on a given axis, or '' when unset. */
export function competitorSubdivision(
  competitor: Pick<Competitor, 'subdivisions'>,
  axisId: string,
): string {
  return competitor.subdivisions?.[axisId] ?? '';
}

/** Build a fresh axis with a stable id and the given label. */
export function newSubdivisionAxis(label: string): SubdivisionAxis {
  return { id: crypto.randomUUID(), label };
}

/** Trim values and drop empty entries from a subdivisions map, returning
 *  undefined when nothing remains (sparse storage — a competitor with no axis
 *  values carries no `subdivisions`). */
export function cleanSubdivisions(
  subs: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!subs) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(subs)) {
    const t = v?.trim();
    if (t) out[k] = t;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Order-insensitive equality of two subdivisions maps, ignoring empty values.
 *  Used to detect "no change" on CSV re-import. */
export function subdivisionsEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const norm = (m: Record<string, string> | undefined) =>
    JSON.stringify(
      Object.entries(m ?? {})
        .filter(([, v]) => v?.trim())
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
    );
  return norm(a) === norm(b);
}

/** Upgrade a legacy single-axis representation (`subdivisionLabel` + per-competitor
 *  `subdivision`, file formats v6–v12 / pre-multi-axis DB rows) to the multi-axis shape.
 *  Returns the axes to set on the series and the id of the synthesised axis (or
 *  null when none is warranted, so callers skip writing competitor values). The
 *  "is it in use" rule mirrors the DB backfill in `drizzle/0053_*`: the field was
 *  enabled, carried a non-default label, or any competitor held a value. */
export function upgradeSubdivisionAxes(opts: {
  legacyLabel?: string;
  fieldEnabled: boolean;
  hasAnyValue: boolean;
}): { axes: SubdivisionAxis[]; axisId: string | null } {
  const label = opts.legacyLabel?.trim();
  const want =
    opts.fieldEnabled ||
    opts.hasAnyValue ||
    (label != null && label !== '' && label !== DEFAULT_SUBDIVISION_LABEL);
  if (!want) return { axes: [], axisId: null };
  const axis = newSubdivisionAxis(label || DEFAULT_SUBDIVISION_LABEL);
  return { axes: [axis], axisId: axis.id };
}

/** Whether two fleet-membership lists contain the same ids (order-insensitive). */
export function sameFleetIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const id of b) if (!set.has(id)) return false;
  return true;
}
