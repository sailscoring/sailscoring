import type { Competitor, CompetitorFieldKey, PrimaryPersonLabel } from './types';

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
  'gender',
  'age',
] as const;

/** Human-readable labels for each configurable field. */
export const COMPETITOR_FIELD_LABELS: Record<CompetitorFieldKey, string> = {
  boatName: 'Boat name',
  boatClass: 'Class',
  helm: 'Helm name',
  owner: 'Owner name',
  crewName: 'Crew name',
  club: 'Club',
  gender: 'Gender',
  age: 'Age',
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
