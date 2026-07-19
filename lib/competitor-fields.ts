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

/** Names of every fleet a competitor belongs to, in stored order. A boat can be
 *  entered in more than one fleet (e.g. a handicap fleet and a scratch fleet
 *  sharing a start); callers should reflect all of them, not just the first.
 *  Unresolvable ids are dropped. */
export function competitorFleetNames(
  fleetIds: readonly string[],
  fleetById: Map<string, Pick<Fleet, 'name'>>,
): string[] {
  return fleetIds
    .map((id) => fleetById.get(id)?.name)
    .filter((name): name is string => name != null);
}

/** Canonical ordering of all configurable competitor fields. The settings UI
 *  and any UI that lists fields should iterate over this in this order.
 *  `helm` and `owner` are optional *role* fields — use them to record whichever
 *  role the primary label doesn't already carry. */
export const ALL_COMPETITOR_FIELDS: readonly CompetitorFieldKey[] = [
  'bowNumber',
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
