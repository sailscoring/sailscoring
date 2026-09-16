/**
 * Whether a configuration still reads as the class format it was built from.
 *
 * The Format picker says "Custom — started from …" the moment a config stops
 * matching, which is a claim about scoring. So what the comparison ignores
 * matters as much as what it checks: a format decides how a championship is
 * scored, not what the event calls its own fleets or writes on its race
 * column.
 */

import { describe, it, expect } from 'vitest';

import { matchesFormat } from '@/components/split-fleets-editor';
import {
  defaultSplitFleetConfig,
  ilca2026SplitFleetConfig,
  openingSeriesMedalConfig,
} from '@/lib/split-fleets';

describe('matchesFormat', () => {
  it('recognises a format it was built from', () => {
    expect(matchesFormat(openingSeriesMedalConfig(), 'opening-medal-unbanded')).toBe(true);
    expect(matchesFormat(ilca2026SplitFleetConfig(3), 'ilca-2026')).toBe(true);
  });

  it('still recognises it when the fleets are named for the event', () => {
    // The case that reported this: one fleet named after the class it sails,
    // every scoring field untouched. Naming a fleet is the first thing a
    // scorer does, and it is not a departure from the format.
    expect(
      matchesFormat(
        { ...openingSeriesMedalConfig(), qualifyingFleets: [{ label: 'TR 3.6', color: '#64748b' }] },
        'opening-medal-unbanded',
      ),
    ).toBe(true);
    // The same holds for a banded championship whose sailing instructions
    // call the fleets something other than the colours we deal them under.
    const ilca = ilca2026SplitFleetConfig(3);
    expect(
      matchesFormat(
        {
          ...ilca,
          qualifyingFleets: ilca.qualifyingFleets.map((f, i) => ({ ...f, label: `Group ${i + 1}` })),
          finalFleets: ilca.finalFleets.map((f) => ({ ...f, label: f.label.toUpperCase() })),
        },
        'ilca-2026',
      ),
    ).toBe(true);
  });

  it('does not recognise a change to how the championship scores', () => {
    const c = openingSeriesMedalConfig();
    expect(matchesFormat({ ...c, discardThresholds: [{ minRaces: 4, discardCount: 1 }] }, 'opening-medal-unbanded')).toBe(false);
    expect(matchesFormat({ ...c, medal: { ...c.medal!, size: 6 } }, 'opening-medal-unbanded')).toBe(false);
    expect(matchesFormat({ ...c, medal: { ...c.medal!, companionRace: 'none' } }, 'opening-medal-unbanded')).toBe(false);
  });

  it('counts the fleets even though it ignores their names', () => {
    // The count is passed into the format's builder, so a two-fleet ILCA is
    // still ILCA — but an unbanded config is not, however it is labelled.
    expect(matchesFormat(defaultSplitFleetConfig(2), 'ilca-2025')).toBe(true);
    expect(matchesFormat(openingSeriesMedalConfig(), 'ilca-2025')).toBe(false);
  });
});
