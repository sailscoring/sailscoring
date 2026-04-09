import type { CompetitorFieldKey } from './types';

/** Canonical ordering of all configurable competitor fields. The settings UI
 *  and any UI that lists fields should iterate over this in this order. */
export const ALL_COMPETITOR_FIELDS: readonly CompetitorFieldKey[] = [
  'boatName',
  'crewName',
  'club',
  'gender',
  'age',
] as const;

/** Human-readable labels for each configurable field. */
export const COMPETITOR_FIELD_LABELS: Record<CompetitorFieldKey, string> = {
  boatName: 'Boat name',
  crewName: 'Crew name',
  club: 'Club',
  gender: 'Gender',
  age: 'Age',
};

/** Default set of enabled competitor fields for a new series. Kept minimal so
 *  a scratch-fleet scorer (the majority case) sees a clean competitor list
 *  and can opt into boat name, crew name, gender, or age from the series
 *  settings. Intentionally static — we do not infer from fleet scoring
 *  systems, to avoid surprising scorers by silently flipping visibility. */
export function defaultEnabledCompetitorFields(): CompetitorFieldKey[] {
  return ['club'];
}
