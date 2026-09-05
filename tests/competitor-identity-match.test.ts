import { describe, expect, it } from 'vitest';

import {
  birthYearsConflict,
  buildClubCanonicalizer,
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

  it('reads a spelled-out club and its acronym as one club', () => {
    const canon = buildClubCanonicalizer([
      'KSC',
      'Killaloe Sailing Club',
      'Killaloe SC',
    ]);
    expect(canon('KSC')).toEqual(['killaloesailingclub']);
    expect(canon('Killaloe SC')).toEqual(['killaloesailingclub']);
    expect(canon('KIllaloe SC')).toEqual(['killaloesailingclub']);
  });

  it('leaves an acronym alone when two clubs in the corpus share it', () => {
    // hyc-archive's own vocabulary: Howth and Holywood both answer to HYC, so
    // a bare "HYC" is not evidence of either.
    const canon = buildClubCanonicalizer([
      'HYC',
      'Howth Yacht Club',
      'Holywood YC',
    ]);
    expect(canon('HYC')).toEqual(['hyc']);
    expect(canon('Howth YC')).toEqual(['howthyachtclub']);
    expect(canon('Holywood YC')).toEqual(['holywoodyachtclub']);
  });

  it('keeps distinct clubs distinct', () => {
    const canon = buildClubCanonicalizer(['MYC', 'KYC']);
    expect(canon('MYC')).not.toEqual(canon('KYC'));
  });

  it('canonicalises each club of a multi-club field', () => {
    const canon = buildClubCanonicalizer([
      'WHSC / RCYC',
      'Waterford Harbour Sailing Club',
      'Royal Cork Yacht Club',
    ]);
    expect(canon('WHSC / RCYC')).toEqual([
      'waterfordharboursailingclub',
      'royalcorkyachtclub',
    ]);
    expect(canon('RCYC')).toEqual(['royalcorkyachtclub']);
  });

  it('leaves a blank club unknown when the corpus states clubs', () => {
    const canon = buildClubCanonicalizer([
      'KSC',
      'Killaloe Sailing Club',
      'Killaloe SC',
      undefined,
    ]);
    expect(canon(undefined)).toEqual([]);
    expect(canon('')).toEqual([]);
  });

  it('reads a blank as a club of its own when most rows state none', () => {
    // A club scoring its own racing fills the field in for visitors and leaves
    // it empty for members, so a blank means "one of ours".
    const canon = buildClubCanonicalizer([
      undefined,
      undefined,
      undefined,
      'Royal Irish Yacht Club',
    ]);
    expect(canon(undefined)).toHaveLength(1);
    expect(canon(undefined)).toEqual(canon(''));
    // It is nobody's club in particular — a visitor still doesn't match it.
    expect(canon(undefined)).not.toEqual(canon('Royal Irish Yacht Club'));
  });

  it('gives an unknown club its own token rather than dropping it', () => {
    const canon = buildClubCanonicalizer(['KSC', 'Killaloe Sailing Club']);
    expect(canon('Foynes YC')).toEqual(['foynesyachtclub']);
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
