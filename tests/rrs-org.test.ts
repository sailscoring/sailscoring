import { describe, it, expect } from 'vitest';

import {
  buildRrsOrgCompetitors,
  buildRrsOrgPayload,
  normalizePhone,
  splitName,
  RRS_ORG_SOURCE,
  type RrsOrgRelayFields,
} from '@/lib/rrs-org';
import type { Competitor, Fleet } from '@/lib/types';

function makeCompetitor(overrides: Partial<Competitor> & { id: string }): Competitor {
  return {
    seriesId: 's1',
    fleetIds: ['fl-scratch'],
    sailNumber: '14302',
    names: ['Kevin Donnelly'],
    club: 'Sutton DC',
    gender: '',
    age: null,
    createdAt: 0,
    ...overrides,
  };
}

const fleets: Fleet[] = [
  { id: 'fl-scratch', seriesId: 's1', name: 'Scratch', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'fl-hph', seriesId: 's1', name: 'HPH', displayOrder: 1, scoringSystem: 'py' },
];

describe('splitName', () => {
  it('splits at the first space: first token vs the rest', () => {
    expect(splitName('Kevin Donnelly')).toEqual({ first: 'Kevin', last: 'Donnelly' });
    expect(splitName('John van der Berg')).toEqual({ first: 'John', last: 'van der Berg' });
  });

  it('puts a single-token name wholly into last_name', () => {
    expect(splitName('Diarmaid')).toEqual({ first: '', last: 'Diarmaid' });
  });

  it('trims surrounding whitespace', () => {
    expect(splitName('  Meg  Tyrrell ')).toEqual({ first: 'Meg', last: 'Tyrrell' });
  });
});

describe('normalizePhone', () => {
  it('keeps international numbers, stripping punctuation', () => {
    expect(normalizePhone('+353 86 123 4567')).toBe('+353861234567');
    expect(normalizePhone('+44 (0)7911 123-456')).toBe('+447911123456');
  });

  it('converts a 00 prefix to +', () => {
    expect(normalizePhone('00353861234567')).toBe('+353861234567');
  });

  it('converts national format via the nationality dialing code, dropping the trunk 0', () => {
    expect(normalizePhone('086 123 4567', 'IRL')).toBe('+353861234567');
    expect(normalizePhone('07911 123456', 'GBR')).toBe('+447911123456');
  });

  it('returns null rather than guessing', () => {
    expect(normalizePhone('086 123 4567')).toBeNull();          // no nationality
    expect(normalizePhone('086 123 4567', 'XYZ')).toBeNull();   // unknown code
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone('ext. only', 'IRL')).toBeNull();      // no digits
  });
});

describe('buildRrsOrgCompetitors', () => {
  it('maps stored fields onto the API row, deriving mna_code from nationality', () => {
    const c = makeCompetitor({
      id: 'c1',
      nationality: 'IRL',
      boatName: 'Rufus',
      boatClass: 'GP14',
      helms: ['Diana Kissane'],
      names: ['D. Kissane'], // owner-primary series: helm wins for RRS.org
    });
    const { competitors, warnings } = buildRrsOrgCompetitors([c], fleets, { divisionSource: 'none' });
    expect(warnings).toEqual([]);
    expect(competitors).toEqual([{
      competitor_id: '1',
      sail_number: '14302',
      country_code: 'IRL',
      first_name: 'Diana',
      last_name: 'Kissane',
      boat_name: 'Rufus',
      boat_class: 'GP14',
      division: '',
      club_name: 'Sutton DC',
      email: '',
      phone: '',
      mna_code: 'IRL',
      mna_number: '',
    }]);
  });

  it('uses empty strings, never null, for absent values', () => {
    const c = makeCompetitor({ id: 'c1', club: '' });
    const [row] = buildRrsOrgCompetitors([c], fleets, { divisionSource: 'none' }).competitors;
    for (const value of Object.values(row)) {
      expect(typeof value).toBe('string');
    }
  });

  it('numbers competitor_id from 1, never sending the UUID competitor id', () => {
    // RRS.org resolves competitor_id to an integer: UUIDs collide there and it
    // drops the losers silently, on a 200. Every row must be a distinct integer.
    const cs = [
      makeCompetitor({ id: '83d8ad30-5570-452c-bf78-5482560362ad' }),
      makeCompetitor({ id: '9dbf5a30-9538-44b0-83a4-5c59ee4c1986' }),
      makeCompetitor({ id: '90c69e88-0fed-4a22-a85c-8a9e6167acb0' }),
    ];
    const { competitors } = buildRrsOrgCompetitors(cs, fleets, { divisionSource: 'none' });
    expect(competitors.map((r) => r.competitor_id)).toEqual(['1', '2', '3']);
    const asIntegers = competitors.map((r) => Number(r.competitor_id));
    expect(asIntegers.every(Number.isInteger)).toBe(true);
    expect(new Set(asIntegers).size).toBe(cs.length);
  });

  it('divisionSource fleet joins multi-fleet memberships in fleet order', () => {
    const c = makeCompetitor({ id: 'c1', fleetIds: ['fl-scratch', 'fl-hph'] });
    const [row] = buildRrsOrgCompetitors([c], fleets, { divisionSource: 'fleet' }).competitors;
    expect(row.division).toBe('Scratch / HPH');
  });

  it('divisionSource axis reads the competitor subdivision value', () => {
    const c = makeCompetitor({ id: 'c1', subdivisions: { 'axis-1': 'Silver' } });
    const config = { divisionSource: 'axis' as const, divisionAxisId: 'axis-1' };
    expect(buildRrsOrgCompetitors([c], fleets, config).competitors[0].division).toBe('Silver');
    // A competitor with no value for the axis gets an empty division.
    const bare = makeCompetitor({ id: 'c2' });
    expect(buildRrsOrgCompetitors([bare], fleets, config).competitors[0].division).toBe('');
  });

  it('relays contact fields, normalising phones and counting relay rows', () => {
    const withPhone = makeCompetitor({ id: 'c1', nationality: 'IRL' });
    const noContact = makeCompetitor({ id: 'c2', sailNumber: '14241' });
    const relay = new Map<string, RrsOrgRelayFields>([
      ['c1', { email: 'kd@example.com', phone: '086 123 4567', mnaNumber: 'IS12345' }],
    ]);
    const { competitors, warnings, relayCount } = buildRrsOrgCompetitors(
      [withPhone, noContact], fleets, { divisionSource: 'none' }, relay,
    );
    expect(warnings).toEqual([]);
    expect(relayCount).toBe(1);
    expect(competitors[0]).toMatchObject({
      email: 'kd@example.com',
      phone: '+353861234567',
      mna_number: 'IS12345',
    });
    expect(competitors[1]).toMatchObject({ email: '', phone: '', mna_number: '' });
  });

  it('a relayed mna_code overrides the nationality default', () => {
    const c = makeCompetitor({ id: 'c1', nationality: 'IRL' });
    const relay = new Map<string, RrsOrgRelayFields>([['c1', { mnaCode: 'GBR' }]]);
    const [row] = buildRrsOrgCompetitors([c], fleets, { divisionSource: 'none' }, relay).competitors;
    expect(row.mna_code).toBe('GBR');
  });

  it('an unresolvable phone is sent blank and warned about, not guessed', () => {
    const c = makeCompetitor({ id: 'c1' }); // no nationality → no dialing code
    const relay = new Map<string, RrsOrgRelayFields>([['c1', { phone: '086 123 4567' }]]);
    const { competitors, warnings } = buildRrsOrgCompetitors(
      [c], fleets, { divisionSource: 'none' }, relay,
    );
    expect(competitors[0].phone).toBe('');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ competitorId: 'c1', sailNumber: '14302' });
  });

  it('sends the first listed person for a multi-person entry (rrs.org has one person slot)', () => {
    const coOwned = makeCompetitor({
      id: 'c2',
      names: ['J. Murphy', 'M. Murphy'],
    });
    const coHelmed = makeCompetitor({
      id: 'c3',
      helms: ['Alice Byrne', 'Bob Malone'],
      names: ['Owner Person'],
    });
    const { competitors } = buildRrsOrgCompetitors([coOwned, coHelmed], fleets, { divisionSource: 'none' });
    expect(competitors[0]).toMatchObject({ first_name: 'J.', last_name: 'Murphy' });
    expect(competitors[1]).toMatchObject({ first_name: 'Alice', last_name: 'Byrne' });
  });
});
describe('buildRrsOrgPayload', () => {
  it('wraps rows with the event uuid and our source marker', () => {
    const payload = buildRrsOrgPayload('d17854ef-f55f-4ab6-8429-3f55527b6e9f', []);
    expect(payload).toEqual({
      uuid: 'd17854ef-f55f-4ab6-8429-3f55527b6e9f',
      source: RRS_ORG_SOURCE,
      competitors: [],
    });
  });
});
