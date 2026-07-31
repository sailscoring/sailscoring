import { describe, it, expect } from 'vitest';
import { describeDiscardRules, summarizeDiscardRules } from '@/lib/discard-rules';
import { getDiscardCount } from '@/lib/scoring';
import type { DiscardThreshold } from '@/lib/types';

/** The shape an SI usually states: one discard from 5 races, two from 9. */
const rrsStyle: DiscardThreshold[] = [
  { minRaces: 5, discardCount: 1 },
  { minRaces: 9, discardCount: 2 },
];

/**
 * A 2026 HYC club dinghy profile, seven step-ups. Every range is three races
 * wide except 9–12, which is four — the one point where the profile departs
 * from the pattern the rest of it follows.
 */
const hyc: DiscardThreshold[] = [
  { minRaces: 3, discardCount: 1 },
  { minRaces: 6, discardCount: 2 },
  { minRaces: 9, discardCount: 3 },
  { minRaces: 13, discardCount: 4 },
  { minRaces: 16, discardCount: 5 },
  { minRaces: 19, discardCount: 6 },
  { minRaces: 22, discardCount: 7 },
];

describe('describeDiscardRules', () => {
  it('closes each rule range at the next rule', () => {
    const [first, second] = describeDiscardRules(rrsStyle);
    expect([first.appliesFrom, first.appliesTo]).toEqual([5, 8]);
    expect([second.appliesFrom, second.appliesTo]).toEqual([9, null]);
    expect(first.warnings).toEqual([]);
    expect(second.warnings).toEqual([]);
  });

  it('reports ranges in the order the rules were given, not sorted', () => {
    const outOfOrder: DiscardThreshold[] = [
      { minRaces: 9, discardCount: 2 },
      { minRaces: 5, discardCount: 1 },
    ];
    const described = describeDiscardRules(outOfOrder);
    expect([described[0].appliesFrom, described[0].appliesTo]).toEqual([9, null]);
    expect([described[1].appliesFrom, described[1].appliesTo]).toEqual([5, 8]);
    expect(described.flatMap((r) => r.warnings)).toEqual([]);
  });

  it('handles a range of a single race count', () => {
    const tight: DiscardThreshold[] = [
      { minRaces: 3, discardCount: 1 },
      { minRaces: 4, discardCount: 2 },
    ];
    expect([describeDiscardRules(tight)[0].appliesFrom, describeDiscardRules(tight)[0].appliesTo])
      .toEqual([3, 3]);
  });

  it('exposes the wide range in the HYC profile', () => {
    const ranges = describeDiscardRules(hyc).map((r) => [r.appliesFrom, r.appliesTo]);
    expect(ranges).toEqual([
      [3, 5],
      [6, 8],
      [9, 12], // four races wide where every other range is three
      [13, 15],
      [16, 18],
      [19, 21],
      [22, null],
    ]);
  });

  it('agrees with the scoring engine at every race count', () => {
    const described = describeDiscardRules(hyc);
    for (let sailed = 1; sailed <= 26; sailed++) {
      const covering = described.find(
        (r) => r.appliesFrom !== null
          && sailed >= r.appliesFrom
          && (r.appliesTo === null || sailed <= r.appliesTo),
      );
      expect(getDiscardCount(sailed, hyc)).toBe(covering?.discardCount ?? 0);
    }
  });

  describe('warnings', () => {
    it('flags a rule shadowed by an earlier one at the same race count', () => {
      const duplicated: DiscardThreshold[] = [
        { minRaces: 5, discardCount: 1 },
        { minRaces: 5, discardCount: 2 },
      ];
      const [first, second] = describeDiscardRules(duplicated);
      expect(first.warnings).toEqual([]);
      expect(second.appliesFrom).toBeNull();
      expect(second.warnings).toEqual([
        'Never applies — rule 1 already sets the discards at 5 races.',
      ]);
      // ...which is what the engine does with it.
      expect(getDiscardCount(5, duplicated)).toBe(1);
    });

    it('flags a rule that reduces the discards', () => {
      const shrinking: DiscardThreshold[] = [
        { minRaces: 5, discardCount: 2 },
        { minRaces: 9, discardCount: 1 },
      ];
      expect(describeDiscardRules(shrinking)[1].warnings).toEqual([
        'Fewer discards than the rule before it (2).',
      ]);
    });

    it('flags a rule that changes nothing', () => {
      const flat: DiscardThreshold[] = [
        { minRaces: 5, discardCount: 1 },
        { minRaces: 9, discardCount: 1 },
      ];
      expect(describeDiscardRules(flat)[1].warnings).toEqual([
        'Same number of discards as the rule before it (1).',
      ]);
    });

    it('flags a first rule that adds no discards', () => {
      expect(describeDiscardRules([{ minRaces: 5, discardCount: 0 }])[0].warnings).toEqual([
        'This rule adds no discards.',
      ]);
    });

    it('flags a rule that would discard every race', () => {
      expect(describeDiscardRules([{ minRaces: 3, discardCount: 3 }])[0].warnings).toEqual([
        'At 3 races sailed this discards every race.',
      ]);
    });

    it('flags a rule with no race count entered', () => {
      const blank = describeDiscardRules([{ minRaces: 0, discardCount: 1 }])[0];
      expect(blank.warnings).toContain('Applies before any race is sailed — enter at least 1.');
    });
  });
});

describe('summarizeDiscardRules', () => {
  it('says so when there are no rules', () => {
    expect(summarizeDiscardRules([])).toBe('No discards');
  });

  it('restates a short profile in full', () => {
    expect(summarizeDiscardRules(rrsStyle)).toBe('1 discard from 5 races, 2 from 9');
  });

  it('keeps both ends of a long profile and elides the middle', () => {
    expect(summarizeDiscardRules(hyc)).toBe('1 discard from 3 races, 2 from 6, … 7 from 22');
  });

  it('sorts by race count regardless of the order stored', () => {
    expect(summarizeDiscardRules([
      { minRaces: 9, discardCount: 2 },
      { minRaces: 5, discardCount: 1 },
    ])).toBe('1 discard from 5 races, 2 from 9');
  });

  it('leaves out a rule that never applies', () => {
    expect(summarizeDiscardRules([
      { minRaces: 5, discardCount: 1 },
      { minRaces: 5, discardCount: 2 },
    ])).toBe('1 discard from 5 races');
  });

  it('agrees on the singular for a single race', () => {
    expect(summarizeDiscardRules([{ minRaces: 1, discardCount: 1 }])).toBe('1 discard from 1 race');
  });
});
