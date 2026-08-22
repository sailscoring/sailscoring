/**
 * The configuration → sailing-instruction prose used by the split-fleet
 * editor. Asserts the sentences a scorer checks against their own SI: the
 * carry model, the discard ladder, the caps, the non-finisher bases, and the
 * medal race.
 */

import { describe, it, expect } from 'vitest';

import { describeSplitFleetConfig, SENTENCES_BY_SETTING } from '@/lib/split-fleets-si';
import type { SplitFleetSentenceId } from '@/lib/split-fleets-si';
import {
  defaultSplitFleetConfig,
  ilca2026SplitFleetConfig,
  iodaSplitFleetConfig,
  type SplitFleetConfig,
} from '@/lib/split-fleets';

const joined = (config: SplitFleetConfig) =>
  describeSplitFleetConfig(config)
    .map((s) => s.text)
    .join('\n');

describe('describeSplitFleetConfig', () => {
  it('states the ILCA-shaped default in SI language', () => {
    const text = joined(defaultSplitFleetConfig(3));
    // With a medal stage the event's structure is the opening series and then
    // that stage; the two stages under it are the sentence after (2026 ILCA
    // SI 7.1/7.2's shape, which the generic vocabulary shares).
    expect(text).toContain('sailed as an opening series followed by the medal races');
    expect(text).toContain(
      'opening series will be divided into a qualifying series and a final series',
    );
    expect(text).toContain('three qualifying fleets (Yellow, Blue and Red)');
    expect(text).toContain('reassigned to the qualifying fleets on the basis of their ranks');
    expect(text).toContain('Gold, Silver and Bronze');
    // Scoped to the opening series, not the championship: the medal races add
    // to it afterwards (2026 ILCA SI 18.6.1's shape).
    expect(text).toContain('will count for total points in the opening series');
    expect(text).toContain(
      'excluding her worst score when 4 or more races have been completed, and her two worst scores when 10 or more',
    );
    // The cap and the lone-race protection are one sentence, not two.
    expect(text).toContain(
      'No more than one excluded score may come from the final series, and if only one ' +
        'final series race has been completed that score will not be excluded.',
    );
    expect(text).toContain('largest qualifying fleet, plus one');
    expect(text).toContain('own final fleet, plus one');
    expect(text).toContain('first 10 boats');
    expect(text).toContain('multiplied by 2 and may not be excluded');
    expect(text).toContain('the first Gold boat will be scored 11 points');
  });

  it('says what the boats who miss the cut sail, and how it is scored', () => {
    // Part of the same SI clause, and the first thing a scorer checks after
    // the medal fleet itself. The race is the same either way — one more of
    // the second stage, in their own fleets — and what varies is whether the
    // fleet the medal boats left starts scoring below them.
    expect(joined(defaultSplitFleetConfig(3))).toContain(
      'the boats that do not qualify for it will sail one more final series race in their own fleets, ' +
        'in which the first Gold boat will be scored 11 points, the second 12, and so on',
    );
    expect(joined(ilca2026SplitFleetConfig(3))).toContain(
      'the boats that do not qualify for it will sail one more Elimination series race in their own fleets, ' +
        'in which the first Gold boat will be scored 11 points, the second 12, and so on',
    );
    expect(
      joined({
        ...ilca2026SplitFleetConfig(3),
        medal: { ...ilca2026SplitFleetConfig(3).medal!, companionRace: 'none' },
      }),
    ).toContain(
      'the boats that do not qualify for it will sail one more Elimination series race in their own fleets.',
    );
  });

  it('drops the medal sentence when there is no medal race', () => {
    const text = joined(iodaSplitFleetConfig(4));
    expect(text).not.toContain('medal race');
    // No third stage, so no umbrella term to distinguish it from either.
    expect(text).toContain('sailed as a qualifying series followed by a final series');
    expect(text).not.toContain('opening series');
    expect(text).toContain('excluding her worst score when 5 or more races have been completed');
  });

  it('states net+net as two series added together, discarded separately', () => {
    const text = joined({ ...defaultSplitFleetConfig(2), carry: 'net-plus-net' });
    expect(text).toContain(
      'total of her qualifying series score plus her final series score',
    );
    expect(text).toContain('separately to the qualifying series and the final series');
    // The continuous-carry caps are not part of this model.
    expect(text).not.toContain('excluded score may come from the final series');
  });

  it('states carried position as non-excludable points', () => {
    const text = joined({ ...defaultSplitFleetConfig(2), carry: 'rank-seed' });
    expect(text).toContain('carried forward to the final series as non-excludable points');
    expect(text).toContain('carried qualifying position may not be excluded');
  });

  it('states a fixed top fleet by size', () => {
    const text = joined({
      ...defaultSplitFleetConfig(2),
      split: { kind: 'fixed-top', topSize: 25 },
    });
    expect(text).toContain('the first 25 boats will be assigned to the Gold fleet');
  });

  it('states a fixed non-finisher score when configured', () => {
    const text = joined({
      ...defaultSplitFleetConfig(2),
      codeBasis: { qualifying: 'fixed', fixedPoints: 60, final: 'largest-qualifying' },
    });
    expect(text).toContain('scored 60 points in the qualifying series');
    expect(text).toContain('largest qualifying fleet, plus one in the final series');
  });
});

/**
 * The sentence ids exist so the editor can point a setting at the sentences it
 * writes. Two things have to hold for that to keep working as the prose is
 * edited: a config never emits the same id twice (or a mark would land on two
 * sentences claiming to be the same clause), and every id a setting claims is
 * one some configuration actually produces (or the setting marks nothing and
 * the scorer concludes it does nothing).
 */
describe('sentence ids', () => {
  // Enough configurations between them to reach every branch of the prose.
  const configs: SplitFleetConfig[] = [
    defaultSplitFleetConfig(3),
    ilca2026SplitFleetConfig(3),
    iodaSplitFleetConfig(4),
    { ...defaultSplitFleetConfig(2), carry: 'net-plus-net' },
    { ...defaultSplitFleetConfig(2), carry: 'rank-seed' },
    { ...defaultSplitFleetConfig(2), maxFinalDiscards: 0 },
    { ...defaultSplitFleetConfig(2), equalization: 'exclude-extra-scores' },
    {
      ...defaultSplitFleetConfig(2),
      medal: {
        size: 10,
        raceCount: 1,
        multiplier: 2,
        companionRace: 'scored-below',
        carryTransform: { kind: 'divide', by: 2, rounding: 'half-up' },
        tieBreak: 'stage-rank',
      },
    },
  ];

  it('gives each sentence of a configuration its own id', () => {
    for (const config of configs) {
      const ids = describeSplitFleetConfig(config).map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('emits every id the editor points a setting at', () => {
    const emitted = new Set<SplitFleetSentenceId>(
      configs.flatMap((config) => describeSplitFleetConfig(config).map((s) => s.id)),
    );
    for (const [setting, ids] of Object.entries(SENTENCES_BY_SETTING)) {
      for (const id of ids) {
        expect(`${setting} → ${id}`).toBe(`${setting} → ${emitted.has(id) ? id : 'never written'}`);
      }
    }
  });
});
