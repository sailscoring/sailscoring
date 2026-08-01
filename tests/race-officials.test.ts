/**
 * Race management team vocabulary (#339). The list is World Sailing's Race
 * Management Manual, race-management roles only — the assertions below pin
 * both halves of that, since the whole point of a fixed list is that nobody
 * can quietly add "OOD" beside "Race Officer".
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OFFICIAL_ROLE,
  OFFICIAL_ROLES,
  OFFICIAL_ROLE_LABEL,
  formatOfficials,
  hasOfficials,
  isOfficialRole,
  namedOfficials,
} from '@/lib/race-officials';
import type { OfficialRole, RaceOfficial } from '@/lib/types';

function official(role: OfficialRole, name: string, id = `${role}-${name}`): RaceOfficial {
  return { id, role, name };
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
    for (const role of OFFICIAL_ROLES) {
      expect(OFFICIAL_ROLE_LABEL[role]).toBeTruthy();
    }
    expect(Object.keys(OFFICIAL_ROLE_LABEL)).toHaveLength(OFFICIAL_ROLES.length);
  });

  it('starts a new row on the role every event has', () => {
    expect(DEFAULT_OFFICIAL_ROLE).toBe('raceOfficer');
    expect(OFFICIAL_ROLES).toContain(DEFAULT_OFFICIAL_ROLE);
  });

  it('recognises its own roles and nothing else', () => {
    expect(isOfficialRole('raceOfficer')).toBe(true);
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
});
