import { describe, test, expect } from 'vitest';

import { ilca2026Config, openingSeriesMedalConfig } from '../fixtures/split-fleet-configs';
import { splitFleetConfigSchema } from '@/lib/validation/split-fleets';

const BASE = ilca2026Config(2);

describe('settings the championship no longer has', () => {
  test('drops race labels and wording of its own rather than storing them', () => {
    const parsed = splitFleetConfigSchema.parse({
      ...BASE,
      raceLabels: {
        prefixes: { qualifying: 'Q', final: 'E', medal: 'F' },
        continuousOpeningNumbers: false,
      },
    });
    expect(parsed).not.toHaveProperty('raceLabels');
  });
});

describe('the split rule and the fleets it needs', () => {
  test('accepts a championship that never bands its fleet', () => {
    const parsed = splitFleetConfigSchema.parse(openingSeriesMedalConfig());
    expect(parsed.qualifyingFleets).toHaveLength(1);
    expect(parsed.finalFleets).toHaveLength(0);
    expect(parsed.split).toEqual({ kind: 'none' });
  });

  test('refuses final fleets on a championship that never splits', () => {
    expect(() =>
      splitFleetConfigSchema.parse({
        ...openingSeriesMedalConfig(),
        finalFleets: [
          { label: 'Gold', color: '#000' },
          { label: 'Silver', color: '#000' },
        ],
      }),
    ).toThrow(/never splits needs none/);
  });

  test('refuses a split with nothing to split into', () => {
    expect(() =>
      splitFleetConfigSchema.parse({ ...BASE, finalFleets: [{ label: 'Gold', color: '#000' }] }),
    ).toThrow(/at least two fleets/);
  });
});
