/**
 * The configuration → sailing-instruction prose used by the split-fleet
 * editor. Asserts the sentences a scorer checks against their own SI: the
 * discard ladder, the caps, the non-finisher bases, and the medal race.
 */

import { describe, it, expect } from 'vitest';

import { describeSplitFleetConfig, SENTENCES_BY_SETTING } from '@/lib/split-fleets-si';
import type { SplitFleetSentenceId } from '@/lib/split-fleets-si';
import { defaultSplitFleetConfig, type SplitFleetConfig } from '@/lib/split-fleets';
import { ilca2026Config, openingSeriesMedalConfig } from './fixtures/split-fleet-configs';

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

  it('states how the races are numbered, in the labels the notice board will use', () => {
    // A scorer checks this sentence against their own paperwork, and the
    // three schemes below all came off notice boards under sailing
    // instructions that numbered the races a fourth way.
    expect(joined(defaultSplitFleetConfig(3))).toContain(
      'races in the qualifying series will be numbered Q1, Q2 and so on; races in the ' +
        'final series, F1, F2 and so on; races in the medal races, M1, M2 and so on',
    );
    expect(joined(ilca2026Config(3))).toContain(
      'races in the Preliminary series will be numbered QP1, QP2 and so on; races in the ' +
        'Elimination series, QE1, QE2 and so on; races in the Final series, F1, F2 and so on',
    );
  });

  it('says what the boats who miss the cut sail, and how it is scored', () => {
    // Part of the same SI clause, and the first thing a scorer checks after
    // the medal fleet itself: one more race of the second stage, in their
    // own fleets, with the fleet the medal boats left scoring below them.
    expect(joined(defaultSplitFleetConfig(3))).toContain(
      'the boats that do not qualify for it will sail one more final series race in their own fleets, ' +
        'in which the first Gold boat will be scored 11 points, the second 12, and so on',
    );
    expect(joined(ilca2026Config(3))).toContain(
      'the boats that do not qualify for it will sail one more Elimination series race in their own fleets, ' +
        'in which the first Gold boat will be scored 11 points, the second 12, and so on',
    );
  });

  it('says the deciding fleet is ranked highest, whatever the points', () => {
    // The engine has always done it and the published page has always
    // asserted it; unsaid here, a scorer could not check it against a notice
    // of race — and this event's notice of race does not contain it.
    expect(joined(defaultSplitFleetConfig(3))).toContain(
      'The boats qualified to compete in the medal races will be ranked highest in the event.',
    );
    expect(joined(ilca2026Config(3))).toContain(
      'The boats qualified to compete in the Final series will be ranked highest in the event.',
    );
  });

  it('says how the boats who miss the cut are scored where the fleet is never divided', () => {
    // No medal-race score, and any one more race of the opening series they
    // sail is scored below the medal fleet.
    expect(joined(openingSeriesMedalConfig())).toContain(
      'the boats that do not qualify for it will have no score for the medal race, and in any one ' +
        'more opening series race they sail the first of them will be scored 11 points, the ' +
        'second 12, and so on',
    );
  });

  it('numbers only the stages an unbanded championship sails', () => {
    // The middle stage is never sailed, so it has no races to number — and
    // naming it here puts a stage the event does not sail into the document a
    // scorer reads against their notice of race.
    const text = joined(openingSeriesMedalConfig());
    expect(text).toContain(
      'races in the opening series will be numbered Q1, Q2 and so on; races in the medal races, M1, M2 and so on',
    );
    expect(text).not.toContain('final series');
  });

  it('says a medal-race tie-break runs before rule A8, not instead of it', () => {
    // The distinction the sentence has to carry: `last-race` replaces A8, so
    // a tie it cannot break stands; this one runs ahead of A8 and hands back
    // whatever it leaves.
    expect(joined(defaultSplitFleetConfig(3))).toContain(
      'A tie between boats with different scores in the medal race will be broken in favour of ' +
        'the boat with the lower score in it. This changes rule A8. Any remaining tie will be ' +
        'broken by rule A8.',
    );
  });

  it('says a last-race tie-break replaces rule A8', () => {
    expect(joined(ilca2026Config(3))).toContain(
      'For the boats in the Final series, a tie will be broken in favour of the boat with the ' +
        'better score in the last race. This changes rule A8.',
    );
  });

  it('says what an abandoned finale does to the halved score', () => {
    // 2026 ILCA SI 18.7.5 as Amendment 5 rewrote it.
    expect(joined(ilca2026Config(3))).toContain(
      'If no Final series race is completed, her Qualification series score will decide the ' +
        'championship without being divided.',
    );
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
    ilca2026Config(3),
    openingSeriesMedalConfig(),
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
