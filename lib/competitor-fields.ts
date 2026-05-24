import type { Competitor, CompetitorFieldKey, PrimaryPersonLabel, Series } from './types';

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

/** Canonical ordering of all configurable competitor fields. The settings UI
 *  and any UI that lists fields should iterate over this in this order.
 *  `helm` and `owner` are optional *role* fields — use them to record whichever
 *  role the primary label doesn't already carry. */
export const ALL_COMPETITOR_FIELDS: readonly CompetitorFieldKey[] = [
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
 *  only a fallback: the effective label is per-series and comes from
 *  `subdivisionFieldLabel()`. Use that resolver, not this map, for any
 *  subdivision header. */
export const COMPETITOR_FIELD_LABELS: Record<CompetitorFieldKey, string> = {
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

/** Suggested quick-pick labels for the subdivision field. The setting is a
 *  freeform string — these are conveniences, not an exhaustive set, so a
 *  regatta can type "Flight", "Band", or anything else that fits. */
export const SUBDIVISION_LABEL_PRESETS: readonly string[] = [
  'Division',
  'Category',
  'Class',
  'Group',
  'Section',
] as const;

/** Maximum length of a subdivision label. Long enough for any sensible header
 *  word; short enough to keep table columns and form labels tidy. */
export const SUBDIVISION_LABEL_MAX_LENGTH = 24;

/** Authoritative label for the subdivision field. Series config wins over the
 *  static fallback in `COMPETITOR_FIELD_LABELS`; an empty/whitespace label
 *  falls back to the default. Same dynamic-label pattern as helm/owner under
 *  `primaryPersonLabel`. */
export function subdivisionFieldLabel(
  series: Pick<Series, 'subdivisionLabel'>,
): string {
  return series.subdivisionLabel?.trim() || DEFAULT_SUBDIVISION_LABEL;
}
