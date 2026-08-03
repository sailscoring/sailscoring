import { describe, expect, it } from 'vitest';

import {
  isValidWorldSailingId,
  normalizeWorldSailingId,
  worldSailingProfileUrl,
} from '@/lib/world-sailing';

describe('normalizeWorldSailingId', () => {
  it('upper-cases and strips whitespace', () => {
    expect(normalizeWorldSailingId('irlmm1')).toBe('IRLMM1');
    expect(normalizeWorldSailingId('GBR MI2')).toBe('GBRMI2');
    expect(normalizeWorldSailingId('  usats15  ')).toBe('USATS15');
  });

  it('stores blanks sparsely', () => {
    expect(normalizeWorldSailingId('')).toBeUndefined();
    expect(normalizeWorldSailingId('   ')).toBeUndefined();
    expect(normalizeWorldSailingId(undefined)).toBeUndefined();
    expect(normalizeWorldSailingId(null)).toBeUndefined();
  });

  it('leaves a malformed value alone rather than dropping it', () => {
    // The scorer has to be able to see what the entry list actually said.
    expect(normalizeWorldSailingId('not an id')).toBe('NOTANID');
  });
});

describe('isValidWorldSailingId', () => {
  it('accepts the published format — nation code, initials, optional number', () => {
    expect(isValidWorldSailingId('USATS15')).toBe(true);
    expect(isValidWorldSailingId('GBRMI2')).toBe(true);
    expect(isValidWorldSailingId('GBRTT27')).toBe(true);
    expect(isValidWorldSailingId('ESPFE')).toBe(true);   // no disambiguating number
    expect(isValidWorldSailingId('GBRHM15')).toBe(true);
  });

  it('rejects what is plainly not an ID', () => {
    expect(isValidWorldSailingId('IRL')).toBe(false);         // nation code alone
    expect(isValidWorldSailingId('irlmm1')).toBe(false);      // normalize first
    expect(isValidWorldSailingId('IRLMM12345')).toBe(false);  // too many digits
    expect(isValidWorldSailingId('1985-04-12')).toBe(false);  // a date of birth
    expect(isValidWorldSailingId('')).toBe(false);
    expect(isValidWorldSailingId(undefined)).toBe(false);
  });
});

describe('worldSailingProfileUrl', () => {
  it('links to the sailor biography', () => {
    expect(worldSailingProfileUrl('GBRHM15')).toBe(
      'https://www.sailing.org/sailor/?ref=GBRHM15',
    );
  });

  it('escapes a value that is not a well-formed ID', () => {
    expect(worldSailingProfileUrl('A B&C')).toBe(
      'https://www.sailing.org/sailor/?ref=A%20B%26C',
    );
  });
});
