import { describe, test, expect } from 'vitest';

import { ilca2026SplitFleetConfig } from '@/lib/split-fleets';
import { splitFleetConfigSchema } from '@/lib/validation/split-fleets';

const BASE = ilca2026SplitFleetConfig(2);

describe('race labels', () => {
  test('accepts a config with no labels of its own', () => {
    expect(splitFleetConfigSchema.parse(BASE).raceLabels).toBeUndefined();
  });

  test('accepts the notice board of the 2026 ILCA 6 Women’s Worlds', () => {
    const parsed = splitFleetConfigSchema.parse({
      ...BASE,
      raceLabels: {
        prefixes: { qualifying: 'QP', final: 'QE', medal: 'F' },
        continuousOpeningNumbers: false,
      },
    });
    expect(parsed.raceLabels?.prefixes.final).toBe('QE');
  });

  test('refuses a restart that labels two races the same', () => {
    // Q1-Q5 then Q1 again: the second stage restarting under the first
    // stage's prefix gives two different races the same label, which is the
    // label a competitor names on a scoring enquiry.
    expect(() =>
      splitFleetConfigSchema.parse({
        ...BASE,
        raceLabels: {
          prefixes: { qualifying: 'Q', final: 'Q', medal: 'F' },
          continuousOpeningNumbers: false,
        },
      }),
    ).toThrow(/different prefix/);
  });

  test('refuses a prefix that is not a short run of letters', () => {
    for (const qualifying of ['', 'QUAL', 'Q1', 'Q ']) {
      expect(() =>
        splitFleetConfigSchema.parse({
          ...BASE,
          raceLabels: {
            prefixes: { qualifying, final: 'QE', medal: 'F' },
            continuousOpeningNumbers: false,
          },
        }),
      ).toThrow();
    }
  });
});
