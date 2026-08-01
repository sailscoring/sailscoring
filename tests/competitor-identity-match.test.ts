import { describe, expect, it } from 'vitest';

import {
  birthYearsConflict,
  clubsOverlap,
  impliedBirthYear,
  isLowSignalPersonName,
  normalizeClubs,
  normalizePersonName,
  personNamesMatch,
  splitCrewCell,
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

  it('does NOT match a bare surname against anyone (it would bridge namesakes)', () => {
    // A lone "Dempsey" must not anchor an identity: treating it as a match
    // makes it a hub fusing every same-surname person.
    expect(match('Dempsey', 'John Dempsey')).toBe(false);
    expect(match('Dempsey', 'Ella Dempsey')).toBe(false);
    expect(match('Dempsey', 'Dempsey')).toBe(false);
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

describe('low-signal person names', () => {
  it('accepts a recognisable person', () => {
    expect(isLowSignalPersonName('Frank Larkin')).toBe(false);
    expect(isLowSignalPersonName("Stephen O'Brien")).toBe(false);
    expect(isLowSignalPersonName('P Ryan')).toBe(false);
  });

  it('rejects a bare first name', () => {
    // Real KSC crew cells. `personNamesMatch` would never fuse these with
    // anyone (no given name), so each would become a permanent singleton
    // identity with a public page naming nobody.
    expect(isLowSignalPersonName('Michael')).toBe(true);
    expect(isLowSignalPersonName('Daragh')).toBe(true);
  });

  it('rejects initials and punctuation-only cells', () => {
    expect(isLowSignalPersonName('AM')).toBe(true);
    expect(isLowSignalPersonName('??')).toBe(true);
    expect(isLowSignalPersonName('?????')).toBe(true);
  });

  it('rejects placeholders regardless of case', () => {
    expect(isLowSignalPersonName('TBD')).toBe(true);
    expect(isLowSignalPersonName('n/a')).toBe(true);
    expect(isLowSignalPersonName('Crew')).toBe(true);
  });

  it('rejects blank and absent names', () => {
    expect(isLowSignalPersonName('')).toBe(true);
    expect(isLowSignalPersonName('   ')).toBe(true);
    expect(isLowSignalPersonName(undefined)).toBe(true);
  });
});

describe('splitting a crew cell', () => {
  it('returns a single name whole', () => {
    expect(splitCrewCell('Frank Larkin')).toEqual(['Frank Larkin']);
  });

  it('splits the separators that join two people', () => {
    expect(splitCrewCell('Maeve Dervan, Amber Robson')).toEqual([
      'Maeve Dervan',
      'Amber Robson',
    ]);
    expect(splitCrewCell('AM, SG, AS')).toEqual(['AM', 'SG', 'AS']);
    expect(splitCrewCell('Jane Doe & John Roe')).toEqual(['Jane Doe', 'John Roe']);
    expect(splitCrewCell('Jane Doe and John Roe')).toEqual(['Jane Doe', 'John Roe']);
    // A slash joins two people in a crew cell. (In the *club* field the same
    // character separates one sailor's two clubs — see `normalizeClubs`.)
    expect(splitCrewCell("Jack Keane / Emma O'Farrell")).toEqual([
      'Jack Keane',
      "Emma O'Farrell",
    ]);
    expect(splitCrewCell('Marcus Wright/Susan Le Mignon')).toEqual([
      'Marcus Wright',
      'Susan Le Mignon',
    ]);
    expect(splitCrewCell("Pat O'Donnell/ Simon McNamara")).toEqual([
      "Pat O'Donnell",
      'Simon McNamara',
    ]);
  });

  it('never splits on whitespace alone', () => {
    expect(splitCrewCell("Pepper Robson , Zoe O'Farrell")).toEqual([
      'Pepper Robson',
      "Zoe O'Farrell",
    ]);
    expect(splitCrewCell('Mary Anne Delaney')).toEqual(['Mary Anne Delaney']);
  });

  it('drops empties', () => {
    expect(splitCrewCell('')).toEqual([]);
    expect(splitCrewCell(undefined)).toEqual([]);
    expect(splitCrewCell('Jane Doe,')).toEqual(['Jane Doe']);
  });
});
