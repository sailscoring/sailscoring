import type {
  Competitor,
  CompetitorFieldKey,
  Fleet,
  PrimaryPersonLabel,
  Series,
  SubdivisionAxis,
} from './types';

/** Render "Helm / Crew" when the series has crew names enabled and a crew is
 *  set; otherwise just the helm. Used in autocomplete rows and finish lists. */
export function displayHelmCrew(
  competitor: Pick<Competitor, 'name' | 'crewName'>,
  showCrew: boolean,
): string {
  if (showCrew && competitor.crewName && competitor.crewName.trim()) {
    return `${competitor.name} / ${competitor.crewName}`;
  }
  return competitor.name;
}

/** Label a competitor for finish entry, check-in, and other crew-facing lists.
 *  Leads with the boat name when `boatName` is an enabled display field and the
 *  competitor has one (keelboat one-designs identified by boat name), then
 *  appends the primary person (`displayHelmCrew`): "Eclipse — Hogan / Dyson".
 *  When `boatName` is not enabled or absent, returns just the person, identical
 *  to `displayHelmCrew`. */
export function displayCompetitorLabel(
  competitor: Pick<Competitor, 'name' | 'crewName' | 'boatName'>,
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
  crewName: 'Crew name',
  club: 'Club',
  nationality: 'Nationality',
  gender: 'Gender',
  age: 'Age',
  subdivision: 'Division',
};

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
