/**
 * Race management team vocabulary (#339). The list is World Sailing's Race
 * Management Manual, race-management roles only — the assertions below pin
 * both halves of that, since the whole point of a fixed list is that nobody
 * can quietly add "OOD" beside "Race Officer".
 *
 * The write-your-own role sits outside that list on purpose, and the tests
 * keep it there: it is an option the picker offers, not a term the manual
 * has, and the two are different things.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OFFICIAL_ROLE,
  OFFICIAL_ROLES,
  OFFICIAL_ROLE_LABEL,
  OFFICIAL_ROLE_OPTIONS,
  formatOfficials,
  hasOfficials,
  isOfficialRole,
  namedOfficials,
  officialRoleLabel,
  tidyOfficials,
} from '@/lib/race-officials';
import type { OfficialRole, RaceOfficial } from '@/lib/types';

function official(role: OfficialRole, name: string, id = `${role}-${name}`): RaceOfficial {
  return { id, role, name };
}

function custom(customRole: string, name: string): RaceOfficial {
  return { id: `other-${name}`, role: 'other', name, customRole };
}

describe('the role vocabulary', () => {
  it('is the eleven race-management roles', () => {
    expect(OFFICIAL_ROLES).toEqual([
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
    ]);
  });

  it('excludes the jury and protest-committee titles', () => {
    const labels = OFFICIAL_ROLES.map((r) => OFFICIAL_ROLE_LABEL[r]);
    for (const excluded of ['Chief Umpire', 'Umpire', 'Judge', 'Classifier']) {
      expect(labels).not.toContain(excluded);
    }
  });

  it('excludes club colloquialisms World Sailing has its own term for', () => {
    const labels = OFFICIAL_ROLES.map((r) => OFFICIAL_ROLE_LABEL[r]);
    // An OOD is a Race Officer; the person recording finishes is a Recorder.
    for (const excluded of ['Officer of the Day', 'OOD', 'Scorer']) {
      expect(labels).not.toContain(excluded);
    }
    expect(labels).toContain('Race Officer');
    expect(labels).toContain('Recorder');
  });

  it('labels every role', () => {
    for (const role of OFFICIAL_ROLE_OPTIONS) {
      expect(OFFICIAL_ROLE_LABEL[role]).toBeTruthy();
    }
    expect(Object.keys(OFFICIAL_ROLE_LABEL)).toHaveLength(OFFICIAL_ROLE_OPTIONS.length);
  });

  it('offers the manual’s roles, then the write-your-own, last', () => {
    expect(OFFICIAL_ROLE_OPTIONS).toEqual([...OFFICIAL_ROLES, 'other']);
    expect(OFFICIAL_ROLES).not.toContain('other');
  });

  it('starts a new row on the role every event has', () => {
    expect(DEFAULT_OFFICIAL_ROLE).toBe('raceOfficer');
    expect(OFFICIAL_ROLES).toContain(DEFAULT_OFFICIAL_ROLE);
  });

  it('recognises its own roles and nothing else', () => {
    expect(isOfficialRole('raceOfficer')).toBe(true);
    expect(isOfficialRole('other')).toBe(true);
    expect(isOfficialRole('umpire')).toBe(false);
    expect(isOfficialRole('')).toBe(false);
    expect(isOfficialRole(undefined)).toBe(false);
    expect(isOfficialRole(3)).toBe(false);
  });
});

describe('reading a team', () => {
  it('treats an unnamed row as a half-filled row, not a member', () => {
    const team = [official('raceOfficer', 'Jane Smith'), official('recorder', '  ')];
    expect(namedOfficials(team)).toHaveLength(1);
    expect(hasOfficials(team)).toBe(true);
  });

  it('is empty for no team, an empty team, and a wholly unnamed one', () => {
    expect(hasOfficials(undefined)).toBe(false);
    expect(hasOfficials([])).toBe(false);
    expect(hasOfficials([official('raceOfficer', '')])).toBe(false);
    expect(namedOfficials(undefined)).toEqual([]);
  });
});

describe('officialRoleLabel', () => {
  it('reads a written-out role exactly as typed', () => {
    expect(officialRoleLabel(custom('Beach Master', 'Sam Doyle'))).toBe('Beach Master');
  });

  it('trims it, and is empty when it was never filled in', () => {
    expect(officialRoleLabel(custom('  Rescue Coordinator  ', 'Sam'))).toBe(
      'Rescue Coordinator',
    );
    expect(officialRoleLabel(custom('   ', 'Sam'))).toBe('');
    expect(officialRoleLabel(official('other', 'Sam'))).toBe('');
  });

  it('ignores a stray written-out role on a manual title', () => {
    // A scorer who typed a role and then picked a real one off the list.
    expect(
      officialRoleLabel({ ...official('recorder', 'Tom'), customRole: 'Beach Master' }),
    ).toBe('Recorder');
  });
});

describe('tidyOfficials', () => {
  it('trims the written-out role and keeps it only on an `other` row', () => {
    expect(
      tidyOfficials([
        custom('  Beach Master  ', '  Sam Doyle  '),
        { ...official('recorder', 'Tom Byrne'), customRole: 'Beach Master' },
      ]),
    ).toEqual([
      { id: 'other-  Sam Doyle  ', role: 'other', name: 'Sam Doyle', customRole: 'Beach Master' },
      { id: 'recorder-Tom Byrne', role: 'recorder', name: 'Tom Byrne' },
    ]);
  });

  it('writes no key at all for a blank written-out role', () => {
    const [tidied] = tidyOfficials([custom('   ', 'Sam Doyle')]);
    expect(tidied).not.toHaveProperty('customRole');
  });

  it('drops rows that name nobody', () => {
    expect(tidyOfficials([custom('Beach Master', '  ')])).toEqual([]);
    expect(tidyOfficials(undefined)).toEqual([]);
  });
});

describe('formatOfficials', () => {
  it('names each member with their role', () => {
    expect(
      formatOfficials([official('raceOfficer', 'Jane Smith'), official('recorder', 'Tom Byrne')]),
    ).toBe('Race Officer: Jane Smith · Recorder: Tom Byrne');
  });

  it('keeps the scorer’s order rather than sorting by seniority', () => {
    // A club series that lists the duty officer first shouldn't be reshuffled.
    expect(
      formatOfficials([
        official('recorder', 'Tom Byrne'),
        official('principalRaceOfficer', 'Jane Smith'),
      ]),
    ).toBe('Recorder: Tom Byrne · Principal Race Officer: Jane Smith');
  });

  it('trims names and drops unnamed rows', () => {
    expect(
      formatOfficials([official('raceOfficer', '  Jane Smith  '), official('timekeeper', '')]),
    ).toBe('Race Officer: Jane Smith');
  });

  it('is empty when there is nobody to name', () => {
    expect(formatOfficials(undefined)).toBe('');
    expect(formatOfficials([])).toBe('');
  });

  it('uses a written-out role beside the manual’s own', () => {
    expect(
      formatOfficials([official('raceOfficer', 'Jane Smith'), custom('Beach Master', 'Sam Doyle')]),
    ).toBe('Race Officer: Jane Smith · Beach Master: Sam Doyle');
  });

  it('lists someone by name alone when their role was left blank', () => {
    expect(
      formatOfficials([official('raceOfficer', 'Jane Smith'), custom('', 'Sam Doyle')]),
    ).toBe('Race Officer: Jane Smith · Sam Doyle');
  });
});
