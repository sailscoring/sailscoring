import { describe, expect, it } from 'vitest';

import {
  birthYearsConflict,
  clubsOverlap,
  impliedBirthYear,
  normalizeClubs,
  normalizePersonName,
  personNamesMatch,
} from '@/lib/competitor-identity-match';

const n = normalizePersonName;
const match = (a: string, b: string) => personNamesMatch(n(a), n(b));

describe('normalizePersonName', () => {
  it('splits given names from surname and folds case', () => {
    expect(n('Louise Magowan')).toEqual({
      surname: 'magowan',
      given: ['louise'],
      full: 'louise magowan',
    });
  });

  it('strips apostrophes, hyphens and accents', () => {
    expect(n("Aoife O'Toole").surname).toBe('otoole');
    expect(n('Síofra Ní-Bhriain').surname).toBe('nibhriain');
    expect(n('Séan Ó Faoláin').full).toBe('sean o faolain');
  });

  it('keeps multiple given tokens', () => {
    expect(n('Mary Kate Murphy')).toEqual({
      surname: 'murphy',
      given: ['mary', 'kate'],
      full: 'mary kate murphy',
    });
  });

  it('yields an all-empty result for blank or punctuation-only input', () => {
    expect(n('')).toEqual({ surname: '', given: [], full: '' });
    expect(n('  -  ')).toEqual({ surname: '', given: [], full: '' });
    expect(n(undefined)).toEqual({ surname: '', given: [], full: '' });
  });
});

describe('personNamesMatch', () => {
  it('matches identical names', () => {
    expect(match('John Keating', 'John Keating')).toBe(true);
  });

  it('matches an initial against the full first name', () => {
    expect(match('J Keating', 'John Keating')).toBe(true);
    expect(match('John Keating', 'J. Keating')).toBe(true);
  });

  it('tolerates a bare surname (older data)', () => {
    expect(match('Keating', 'John Keating')).toBe(true);
  });

  it('does NOT fuse different first names sharing a surname (namesakes)', () => {
    expect(match('Jack Keating', 'John Keating')).toBe(false);
    expect(match('James Murphy', 'John Murphy')).toBe(false);
  });

  it('does not match on a single-letter initial that disagrees', () => {
    expect(match('A Murphy', 'John Murphy')).toBe(false);
  });

  it('requires a non-empty matching surname', () => {
    expect(match('John Keating', 'John Sheridan')).toBe(false);
    expect(match('', '')).toBe(false);
  });

  it('is insensitive to spacing and punctuation noise', () => {
    expect(match('  louise   MAGOWAN ', 'Louise Magowan')).toBe(true);
  });
});

describe('clubs', () => {
  it('splits multi-club fields', () => {
    expect(normalizeClubs('WHSC / RCYC')).toEqual(['whsc', 'rcyc']);
    expect(normalizeClubs('TBSC/CHSC')).toEqual(['tbsc', 'chsc']);
    expect(normalizeClubs('RStGYC')).toEqual(['rstgyc']);
  });

  it('overlaps when the fields share any club', () => {
    expect(clubsOverlap('WHSC / RCYC', 'RCYC')).toBe(true);
    expect(clubsOverlap('RStGYC', 'rstgyc')).toBe(true);
  });

  it('does not overlap when clubs are disjoint', () => {
    expect(clubsOverlap('MYC', 'KYC')).toBe(false);
  });

  it('treats an empty/unknown club as compatible', () => {
    expect(clubsOverlap('', 'RCYC')).toBe(true);
    expect(clubsOverlap('RCYC', undefined)).toBe(true);
  });
});

describe('implied birth year', () => {
  it('is race year minus age', () => {
    expect(impliedBirthYear(12, 2026)).toBe(2014);
  });

  it('is null when age or year is unknown', () => {
    expect(impliedBirthYear(null, 2026)).toBeNull();
    expect(impliedBirthYear(undefined, 2026)).toBeNull();
    expect(impliedBirthYear(12, null)).toBeNull();
  });

  it('conflicts only when both years are known and more than a year apart', () => {
    expect(birthYearsConflict(2014, 2014)).toBe(false);
    expect(birthYearsConflict(2014, 2015)).toBe(false); // one-year slop
    expect(birthYearsConflict(2014, 2008)).toBe(true);
    expect(birthYearsConflict(2014, null)).toBe(false); // unknown is no signal
    expect(birthYearsConflict(null, null)).toBe(false);
  });
});
