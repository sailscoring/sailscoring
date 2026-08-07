import { describe, it, expect } from 'vitest';
import {
  compareSailNumbers,
  compareSailNumbersIgnoringPrefix,
  bySailNumber,
} from '@/lib/sail-number-sort';

const sorted = (input: string[]) => [...input].sort(compareSailNumbers);

describe('compareSailNumbers', () => {
  it('orders by the number, not the first digit', () => {
    // The reported bug: a string sort puts 217236 before 7.
    expect(sorted(['217236', '7', '69', '1234'])).toEqual([
      '7',
      '69',
      '1234',
      '217236',
    ]);
  });

  it('groups by national prefix, then orders numerically within it', () => {
    expect(sorted(['IRL 69', 'GBR 1234', 'IRL 7', 'GBR 7', 'IRL 217236'])).toEqual([
      'GBR 7',
      'GBR 1234',
      'IRL 7',
      'IRL 69',
      'IRL 217236',
    ]);
  });

  it('ignores spacing and punctuation between prefix and number', () => {
    expect(sorted(['IRL-69', 'IRL7', 'irl 8'])).toEqual(['IRL7', 'irl 8', 'IRL-69']);
  });

  it('sorts prefix-less numbers ahead of prefixed ones', () => {
    expect(sorted(['IRL 7', '900', 'GBR 1'])).toEqual(['900', 'GBR 1', 'IRL 7']);
  });

  it('treats leading zeros as valueless', () => {
    // 007 sorts as 7 — between 6 and 8, not before every other number.
    expect(sorted(['IRL 8', 'IRL 007', 'IRL 6'])).toEqual([
      'IRL 6',
      'IRL 007',
      'IRL 8',
    ]);
    expect(sorted(['IRL 010', 'IRL 9'])).toEqual(['IRL 9', 'IRL 010']);
  });

  it('orders trailing suffix letters after the bare number', () => {
    expect(sorted(['1234X', '1234', '1234A'])).toEqual(['1234', '1234A', '1234X']);
  });

  it('compares numbers beyond MAX_SAFE_INTEGER without precision loss', () => {
    const a = '9007199254740993';
    const b = '9007199254740992';
    expect(compareSailNumbers(a, b)).toBeGreaterThan(0);
  });

  it('is a total order — distinct spellings never compare equal', () => {
    expect(compareSailNumbers('IRL 7', 'irl 7')).not.toBe(0);
    expect(compareSailNumbers('IRL 7', 'IRL 7')).toBe(0);
  });

  it('is antisymmetric', () => {
    const cases: [string, string][] = [
      ['7', '217236'],
      ['GBR 1', 'IRL 1'],
      ['1234', '1234A'],
      ['', 'IRL 1'],
    ];
    for (const [a, b] of cases) {
      expect(Math.sign(compareSailNumbers(a, b))).toBe(
        -Math.sign(compareSailNumbers(b, a)),
      );
    }
  });

  it('handles empty and letters-only sail numbers without throwing', () => {
    expect(sorted(['', 'IRL 1', 'ZZ'])).toEqual(['', 'IRL 1', 'ZZ']);
  });
});

describe('bySailNumber', () => {
  it('sorts records carrying a sail number', () => {
    const rows = [{ sailNumber: '217236' }, { sailNumber: '7' }];
    expect([...rows].sort(bySailNumber)).toEqual([
      { sailNumber: '7' },
      { sailNumber: '217236' },
    ]);
  });
});

describe('compareSailNumbersIgnoringPrefix', () => {
  it('interleaves nations by number, for split-fleet seeding', () => {
    expect(
      ['IRL 12', 'GBR 3', 'IRL 3', 'GBR 12'].sort(compareSailNumbersIgnoringPrefix),
    ).toEqual(['GBR 3', 'IRL 3', 'GBR 12', 'IRL 12']);
  });

  it('falls back to the full comparison when cores tie', () => {
    expect(compareSailNumbersIgnoringPrefix('GBR 12', 'IRL 12')).toBeLessThan(0);
  });
});
