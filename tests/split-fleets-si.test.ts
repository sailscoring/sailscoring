/**
 * The configuration → sailing-instruction prose used by the split-fleet
 * editor. Asserts the sentences a scorer checks against their own SI: the
 * carry model, the discard ladder, the caps, the non-finisher bases, and the
 * medal race.
 */

import { describe, it, expect } from 'vitest';

import { describeSplitFleetConfig } from '@/lib/split-fleets-si';
import { defaultSplitFleetConfig, iodaSplitFleetConfig } from '@/lib/split-fleets';

const joined = (config: Parameters<typeof describeSplitFleetConfig>[0]) =>
  describeSplitFleetConfig(config).join('\n');

describe('describeSplitFleetConfig', () => {
  it('states the ILCA-shaped default in SI language', () => {
    const text = joined(defaultSplitFleetConfig(3));
    expect(text).toContain('qualifying series followed by a final series');
    expect(text).toContain('three qualifying fleets (Yellow, Blue and Red)');
    expect(text).toContain('reassigned to the qualifying fleets on the basis of their ranks');
    expect(text).toContain('Gold, Silver and Bronze');
    expect(text).toContain('will count for total points in the championship');
    expect(text).toContain(
      'excluding her worst score when 4 or more races have been completed, and her two worst scores when 10 or more',
    );
    expect(text).toContain('No more than one excluded score may come from the final series');
    expect(text).toContain('If only one final series race has been completed');
    expect(text).toContain('largest qualifying fleet, plus one');
    expect(text).toContain('own final series fleet, plus one');
    expect(text).toContain('first 10 boats');
    expect(text).toContain('multiplied by 2 and may not be excluded');
    expect(text).toContain('scored from 11');
  });

  it('drops the medal sentence when there is no medal race', () => {
    const text = joined(iodaSplitFleetConfig(4));
    expect(text).not.toContain('medal race');
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
