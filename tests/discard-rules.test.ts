import { describe, it, expect } from 'vitest';
import { describeDiscardRules, discardFreeBelow, summarizeDiscardRules } from '@/lib/discard-rules';
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
  it('reads back the range each rule covers', () => {
    const [first, second] = describeDiscardRules(rrsStyle);
    expect(first.appliesLabel).toBe('applies from 5 to 8 races sailed');
    expect(second.appliesLabel).toBe('applies from 9 races sailed onwards');
    expect(first.warnings).toEqual([]);
    expect(second.warnings).toEqual([]);
  });

  it('reports ranges in the order the rules were given, not sorted', () => {
    const outOfOrder: DiscardThreshold[] = [
      { minRaces: 9, discardCount: 2 },
      { minRaces: 5, discardCount: 1 },
    ];
    const described = describeDiscardRules(outOfOrder);
    expect(described[0].appliesLabel).toBe('applies from 9 races sailed onwards');
    expect(described[1].appliesLabel).toBe('applies from 5 to 8 races sailed');
    expect(described.flatMap((r) => r.warnings)).toEqual([]);
  });

  it('names a range of one race as such', () => {
    const tight: DiscardThreshold[] = [
      { minRaces: 3, discardCount: 1 },
      { minRaces: 4, discardCount: 2 },
    ];
    expect(describeDiscardRules(tight)[0].appliesLabel).toBe('applies at 3 races sailed only');
  });

  it('exposes the wide range in the HYC profile', () => {
    const labels = describeDiscardRules(hyc).map((r) => r.appliesLabel);
    expect(labels).toEqual([
      'applies from 3 to 5 races sailed',
      'applies from 6 to 8 races sailed',
      'applies from 9 to 12 races sailed',
      'applies from 13 to 15 races sailed',
      'applies from 16 to 18 races sailed',
      'applies from 19 to 21 races sailed',
      'applies from 22 races sailed onwards',
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
      expect(second.appliesLabel).toBe('');
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

describe('discardFreeBelow', () => {
  it('gives the race count below which nothing is discarded', () => {
    expect(discardFreeBelow(rrsStyle)).toBe(5);
    expect(discardFreeBelow(hyc)).toBe(3);
  });

  it('is silent when the lowest rule covers the first race', () => {
    expect(discardFreeBelow([{ minRaces: 1, discardCount: 1 }])).toBeNull();
  });

  it('is silent when there are no rules', () => {
    expect(discardFreeBelow([])).toBeNull();
  });

  it('reads the lowest rule wherever it sits in the list', () => {
    expect(discardFreeBelow([{ minRaces: 9, discardCount: 2 }, { minRaces: 5, discardCount: 1 }])).toBe(5);
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
