import { describe, expect, test } from 'vitest';

import { competitorMatchesFilter } from '@/lib/competitor-filter';
import type { Competitor } from '@/lib/types';

function competitor(overrides: Partial<Competitor>): Competitor {
  return {
    id: 'c1',
    seriesId: 's1',
    fleetIds: ['f1'],
    sailNumber: 'IRL1234',
    names: ['Jane Doe'],
    club: 'HYC',
    gender: '',
    age: null,
    createdAt: 0,
    ...overrides,
  };
}

describe('competitorMatchesFilter', () => {
  test('empty and whitespace-only queries match everything', () => {
    const c = competitor({});
    expect(competitorMatchesFilter(c, '')).toBe(true);
    expect(competitorMatchesFilter(c, '   ')).toBe(true);
  });

  test('matches case-insensitively on sail number', () => {
    const c = competitor({ sailNumber: 'IRL1234' });
    expect(competitorMatchesFilter(c, 'irl12')).toBe(true);
    expect(competitorMatchesFilter(c, '1234')).toBe(true);
    expect(competitorMatchesFilter(c, 'GBR')).toBe(false);
  });

  test('matches on name, boat, class, helm, owner, crew and club', () => {
    const c = competitor({
      names: ['Jane Doe'],
      boatName: 'Windshift',
      boatClass: 'J24',
      helms: ['Alice Helm'],
      owners: ['Bob Owner'],
      crewNames: ['Carol Crew'],
      club: 'Howth YC',
    });
    expect(competitorMatchesFilter(c, 'jane')).toBe(true);
    expect(competitorMatchesFilter(c, 'windshift')).toBe(true);
    expect(competitorMatchesFilter(c, 'j24')).toBe(true);
    expect(competitorMatchesFilter(c, 'alice')).toBe(true);
    expect(competitorMatchesFilter(c, 'bob')).toBe(true);
    expect(competitorMatchesFilter(c, 'carol')).toBe(true);
    expect(competitorMatchesFilter(c, 'howth')).toBe(true);
    expect(competitorMatchesFilter(c, 'laser')).toBe(false);
  });

  test('absent optional fields do not match or throw', () => {
    const c = competitor({});
    expect(competitorMatchesFilter(c, 'windshift')).toBe(false);
  });

  test('multi-word queries require every word to match', () => {
    const j24 = competitor({ boatClass: 'J24', helms: ['Sam Smith'] });
    const laser = competitor({ boatClass: 'Laser', helms: ['Sam Smith'] });
    expect(competitorMatchesFilter(j24, 'j24 smith')).toBe(true);
    expect(competitorMatchesFilter(laser, 'j24 smith')).toBe(false);
    // Words can match across different fields.
    expect(competitorMatchesFilter(j24, 'smith j24')).toBe(true);
  });

  test('a word must not match across field boundaries', () => {
    // "DoeHYC" spanning name+club must not match: fields are joined with a
    // separator, not concatenated.
    const c = competitor({ names: ['Jane Doe'], club: 'HYC' });
    expect(competitorMatchesFilter(c, 'doehyc')).toBe(false);
  });
});

describe('competitorMatchesFilter over the other identifiers', () => {
  test('finds a boat by an alternative sail number', () => {
    // A scorer holding a sheet written in whatever number the boat showed
    // needs to reach the entry from that number, not only the registered one.
    const c = competitor({ alternativeSailNumbers: ['IRL 99'] });
    expect(competitorMatchesFilter(c, 'irl 99')).toBe(true);
  });

  test('finds a boat by its bow number', () => {
    expect(competitorMatchesFilter(competitor({ bowNumber: '42' }), '42')).toBe(true);
  });

  test('finds a boat by its entry number', () => {
    expect(competitorMatchesFilter(competitor({ entryNumber: '108' }), '108')).toBe(true);
  });

  test('finds a boat by its tally number', () => {
    expect(competitorMatchesFilter(competitor({ tallyNumber: 'T0042' }), 'T0042')).toBe(true);
  });

  test('does not match a number no identifier carries', () => {
    const c = competitor({ alternativeSailNumbers: ['IRL 99'], bowNumber: '42' });
    expect(competitorMatchesFilter(c, '77')).toBe(false);
  });
});
