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
 *
 * The manual's list is fixed, so two names for one job can't both be picked
 * from it. What it doesn't cover is everyone a club puts on the record — a
 * beach master, a rescue coordinator, a jury secretary — so `other` sits
 * alongside it as an explicit escape hatch the scorer writes out themselves.
 * Offering the real titles first is what keeps it the exception.
 */

import type { OfficialRole, RaceOfficial } from './types';

/** The manual's roles, in its own seniority-then-function order. This array is
 *  the source of truth for the order they are offered and displayed in. */
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

/** Every role a row can hold: the manual's, then the write-your-own. `other`
 *  is deliberately last and outside `OFFICIAL_ROLES` — the vocabulary is the
 *  manual's, and this is the picker's full option list, which is a different
 *  thing. */
export const OFFICIAL_ROLE_OPTIONS: readonly OfficialRole[] = [...OFFICIAL_ROLES, 'other'];

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
  other: 'Other…',
};

/** The role a new row starts on — the one every event has. */
export const DEFAULT_OFFICIAL_ROLE: OfficialRole = 'raceOfficer';

export const OFFICIAL_NAME_MAX_LENGTH = 80;

/** Shorter than a name: a role is a title, not a sentence. Long enough for
 *  "Assistant Beach Master" and not much more. */
export const OFFICIAL_CUSTOM_ROLE_MAX_LENGTH = 40;

export function isOfficialRole(value: unknown): value is OfficialRole {
  return (
    typeof value === 'string' && (OFFICIAL_ROLE_OPTIONS as readonly string[]).includes(value)
  );
}

/**
 * How a member's role reads. The one place a role becomes display text, so
 * the picker, the race header and the published page can't word it
 * differently.
 *
 * A written-out role is shown as typed. Empty for an `other` row nobody
 * filled a role in on — the person is then listed by name alone, which is
 * better than a bare "Other".
 */
export function officialRoleLabel(official: RaceOfficial): string {
  if (official.role === 'other') return (official.customRole ?? '').trim();
  return OFFICIAL_ROLE_LABEL[official.role];
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
 * A team as it should be stored: the rows that name someone, trimmed, with a
 * written-out role kept only where one is read. Both editors save through
 * this, so a role typed into `Other…` and then abandoned for a real title
 * doesn't travel on as dead weight.
 */
export function tidyOfficials(officials: RaceOfficial[] | undefined): RaceOfficial[] {
  return namedOfficials(officials).map((o) => {
    const custom = o.role === 'other' ? (o.customRole ?? '').trim() : '';
    return {
      id: o.id,
      role: o.role,
      name: o.name.trim(),
      ...(custom ? { customRole: custom } : {}),
    };
  });
}

/**
 * A team as one line: "Race Officer: Jane Smith · Recorder: Tom Byrne".
 *
 * List order is preserved rather than sorted by seniority — the scorer chose
 * the order, and a club series that lists the duty officer first shouldn't
 * have that reshuffled. Empty when nobody is named.
 *
 * A member whose role resolves to nothing — an `other` row left blank — is
 * listed by name alone rather than behind an empty label.
 */
export function formatOfficials(officials: RaceOfficial[] | undefined): string {
  return namedOfficials(officials)
    .map((o) => {
      const role = officialRoleLabel(o);
      return role ? `${role}: ${o.name.trim()}` : o.name.trim();
    })
    .join(' · ');
}
