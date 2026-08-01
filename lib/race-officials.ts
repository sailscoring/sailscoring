/**
 * The race management team vocabulary — the shared terms behind
 * `Series.officials` and `Race.officials`.
 *
 * Pure, so the authoring UI, the race header and the published renderer all
 * name a role the same way and can't drift.
 *
 * The list is World Sailing's Race Management Manual, not the RRS: the
 * rulebook names only bodies (race committee, protest committee), never
 * individuals, so the individual titles have to come from the manual. It never
 * says "Officer of the Day" or "Scorer" — an OOD is a Race Officer and the
 * person recording finishes is a Recorder, which is why neither appears here.
 * Fixed rather than configurable, so two names for one job stay
 * unrepresentable.
 */

import type { OfficialRole, RaceOfficial } from './types';

/** The roles, in the manual's own seniority-then-function order. This array is
 *  the source of truth for both the picker order and the display order. */
export const OFFICIAL_ROLES: readonly OfficialRole[] = [
  'principalRaceOfficer',
  'raceOfficer',
  'deputyRaceOfficer',
  'assistantRaceOfficer',
  'recorder',
  'timekeeper',
  'markLayer',
  'safetyOfficer',
  'equipmentInspector',
  'eventMeasurer',
  'technicalDelegate',
];

export const OFFICIAL_ROLE_LABEL: Record<OfficialRole, string> = {
  principalRaceOfficer: 'Principal Race Officer',
  raceOfficer: 'Race Officer',
  deputyRaceOfficer: 'Deputy Race Officer',
  assistantRaceOfficer: 'Assistant Race Officer',
  recorder: 'Recorder',
  timekeeper: 'Timekeeper',
  markLayer: 'Mark Layer',
  safetyOfficer: 'Safety Officer',
  equipmentInspector: 'Equipment Inspector',
  eventMeasurer: 'Event Measurer',
  technicalDelegate: 'Technical Delegate',
};

/** The role a new row starts on — the one every event has. */
export const DEFAULT_OFFICIAL_ROLE: OfficialRole = 'raceOfficer';

export const OFFICIAL_NAME_MAX_LENGTH = 80;

export function isOfficialRole(value: unknown): value is OfficialRole {
  return typeof value === 'string' && (OFFICIAL_ROLES as readonly string[]).includes(value);
}

/** Whether a team is worth showing at all. An entry with no name is a
 *  half-filled row, not a member, so it doesn't count. */
export function hasOfficials(officials: RaceOfficial[] | undefined): boolean {
  return namedOfficials(officials).length > 0;
}

/** The entries that actually name someone, in list order. The authoring UI
 *  lets a row exist before it's filled in; every read path wants only the
 *  filled ones. */
export function namedOfficials(officials: RaceOfficial[] | undefined): RaceOfficial[] {
  return (officials ?? []).filter((o) => o.name.trim() !== '');
}

/**
 * A team as one line: "Race Officer: Jane Smith · Recorder: Tom Byrne".
 *
 * List order is preserved rather than sorted by seniority — the scorer chose
 * the order, and a club series that lists the duty officer first shouldn't
 * have that reshuffled. Empty when nobody is named.
 */
export function formatOfficials(officials: RaceOfficial[] | undefined): string {
  return namedOfficials(officials)
    .map((o) => `${OFFICIAL_ROLE_LABEL[o.role]}: ${o.name.trim()}`)
    .join(' · ');
}
