/**
 * Bringing a split-fleet configuration written before series-file v58 and
 * public-export v4 forward, under ADR-013: lossless values dropped, labels
 * upgraded, and a value that would score a championship differently refused —
 * unless the data it arrives with shows it cannot change a result.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  splitFleetUpgradeContext,
  upgradeSplitFleetConfig,
  upgradeSplitFleetRaceNames,
  type SplitFleetUpgradeContext,
} from '@/lib/split-fleet-config-upgrade';
import { migrateSeriesFileObject } from '@/lib/series-file';

const DIR = join(__dirname, 'fixtures/split-fleets-published');
const published = (event: string) =>
  JSON.parse(readFileSync(join(DIR, `${event}.sailscoring.json`), 'utf-8'));

const JCC = published('junior-champions-cup-2026');
const ILCA7 = published('ilca7-men-worlds-2026');
const ILCA6 = published('ilca6-women-worlds-2026');

const contextOf = (exported: { races: unknown; splitFleets: { rounds: unknown } }) =>
  splitFleetUpgradeContext({ races: exported.races, rounds: exported.splitFleets.rounds });

const RACING: SplitFleetUpgradeContext = {
  hasRaces: true,
  medalFleetSelected: true,
  medalRaceSailed: true,
};
const NOT_STARTED: SplitFleetUpgradeContext = {
  hasRaces: false,
  medalFleetSelected: false,
  medalRaceSailed: false,
};

describe('the three championships scored with split fleets', () => {
  it('reads what their published data says about the racing', () => {
    expect(contextOf(ILCA6)).toEqual(RACING);
    expect(contextOf(JCC)).toEqual(RACING);
  });

  it('upgrade without losing a result', () => {
    for (const exported of [JCC, ILCA7, ILCA6]) {
      const result = upgradeSplitFleetConfig(exported.splitFleets.config, contextOf(exported));
      expect(result.ok).toBe(true);
    }
  });

  it('keep what each one scored with', () => {
    const result = upgradeSplitFleetConfig(ILCA7.splitFleets.config, contextOf(ILCA7));
    expect(result).toEqual({
      ok: true,
      config: {
        qualifyingFleets: ILCA7.splitFleets.config.qualifyingFleets,
        finalFleets: ILCA7.splitFleets.config.finalFleets,
        split: { kind: 'equal-blocks' },
        discardThresholds: [
          { minRaces: 3, discardCount: 1 },
          { minRaces: 10, discardCount: 2 },
        ],
        vocabulary: 'qualification-final',
        medal: {
          size: 10,
          multiplier: 1,
          carryTransform: { kind: 'divide', by: 2, rounding: 'half-up' },
          tieBreak: 'last-race',
        },
      },
    });
    const jcc = upgradeSplitFleetConfig(JCC.splitFleets.config, contextOf(JCC));
    expect(jcc.ok && jcc.config).toMatchObject({
      split: { kind: 'none' },
      finalFleets: [],
      vocabulary: 'opening-medal',
      medal: { size: 10, multiplier: 2, tieBreak: 'medal-race-then-a8' },
    });
  });
});

describe('a setting that would score differently', () => {
  const base = ILCA7.splitFleets.config;

  it('is refused, named, once there is racing it could change', () => {
    const result = upgradeSplitFleetConfig({ ...base, carry: 'rank-seed' }, RACING);
    expect(result).toEqual({ ok: false, reasons: ['how scores carry ("rank-seed")'] });
  });

  it('names every one it finds', () => {
    const result = upgradeSplitFleetConfig(
      {
        ...base,
        split: { kind: 'fixed-top', topSize: 25 },
        equalization: 'exclude-extra-scores',
        medal: { ...base.medal, tieBreak: 'stage-rank' },
      },
      RACING,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasons).toHaveLength(3);
  });

  it('is accepted where no race exists for it to change', () => {
    const result = upgradeSplitFleetConfig(
      { ...base, carry: 'rank-seed', codeBasis: { qualifying: 'fixed', final: 'own-fleet' } },
      NOT_STARTED,
    );
    expect(result.ok).toBe(true);
  });

  it('is accepted in the medal settings until the medal fleet is selected', () => {
    const { tieBreak: _, ...noTieBreak } = base.medal;
    const beforeTheCut = { ...RACING, medalFleetSelected: false, medalRaceSailed: false };
    const result = upgradeSplitFleetConfig({ ...base, medal: noTieBreak }, beforeTheCut);
    expect(result.ok && result.config.medal.tieBreak).toBe('medal-race-then-a8');
    expect(upgradeSplitFleetConfig({ ...base, medal: noTieBreak }, RACING).ok).toBe(false);
    expect(
      upgradeSplitFleetConfig({ ...base, medal: { ...base.medal, companionRace: 'dnc' } }, RACING).ok,
    ).toBe(false);
  });

  it('refuses the old carry timing only between the cut and the first medal race', () => {
    // ILCA 6's configuration: the halved score counted from the moment the
    // medal fleet was selected. That differs only while no medal race is
    // sailed, and ILCA 6 sailed hers.
    const config = ILCA6.splitFleets.config;
    expect(upgradeSplitFleetConfig(config, RACING).ok).toBe(true);
    expect(upgradeSplitFleetConfig(config, { ...RACING, medalRaceSailed: false })).toEqual({
      ok: false,
      reasons: ['halving the score before a medal race is sailed ("medal-fleet-selected")'],
    });
  });

  it('lets the companion race go, since its scoring is written on its start', () => {
    const result = upgradeSplitFleetConfig(
      { ...base, medal: { ...base.medal, companionRace: 'none' } },
      RACING,
    );
    expect(result.ok).toBe(true);
  });
});

describe('race names', () => {
  it('follows the ILCA wording from continuous Q to QP and QE', () => {
    const races = [
      { name: 'Q1 · Yellow', starts: [{ stage: 'qualifying', stageRaceNumber: 1 }] },
      { name: 'Q5', starts: [{ stage: 'qualifying', stageRaceNumber: 5 }] },
      { name: 'Q6 · Gold', starts: [{ stage: 'final', stageRaceNumber: 1 }] },
      { name: 'F1 · Final series', starts: [{ stage: 'medal', stageRaceNumber: 1 }] },
    ];
    const result = upgradeSplitFleetConfig(ILCA7.splitFleets.config, RACING);
    if (!result.ok) throw new Error('refused');
    upgradeSplitFleetRaceNames(races, ILCA7.splitFleets.config, result.config);
    expect(races.map((r) => r.name)).toEqual([
      'QP1 · Yellow',
      'QP5',
      'QE1 · Gold',
      'F1 · Final series',
    ]);
  });

  it('leaves a name the scorer typed, and never touches part of a label', () => {
    const races = [
      { name: 'Practice race', starts: [{ stage: 'qualifying', stageRaceNumber: 1 }] },
      { name: 'Q51', starts: [{ stage: 'qualifying', stageRaceNumber: 5 }] },
    ];
    const result = upgradeSplitFleetConfig(ILCA7.splitFleets.config, RACING);
    if (!result.ok) throw new Error('refused');
    upgradeSplitFleetRaceNames(races, ILCA7.splitFleets.config, result.config);
    expect(races.map((r) => r.name)).toEqual(['Practice race', 'Q51']);
  });

  it('changes nothing where the labels already match', () => {
    const races = [{ name: 'QE2 · Gold', starts: [{ stage: 'final', stageRaceNumber: 2 }] }];
    const result = upgradeSplitFleetConfig(ILCA6.splitFleets.config, RACING);
    if (!result.ok) throw new Error('refused');
    upgradeSplitFleetRaceNames(races, ILCA6.splitFleets.config, result.config);
    expect(races[0].name).toBe('QE2 · Gold');
  });
});

describe('a v57 series file', () => {
  const file = () => ({
    formatVersion: 57,
    races: [
      {
        name: 'Q1 · Yellow',
        starts: [{ stage: 'qualifying', stageRaceNumber: 1 }],
        finishes: [{}],
      },
    ],
    splitFleets: {
      config: { ...ILCA7.splitFleets.config },
      rounds: [{ stage: 'qualifying' }],
    },
  });

  it('is brought forward on read', () => {
    const obj = file();
    migrateSeriesFileObject(obj);
    expect(obj.splitFleets.config).not.toHaveProperty('carry');
    expect(obj.races[0].name).toBe('QP1 · Yellow');
  });

  it('is refused, naming the setting, where it scores with one that is gone', () => {
    const obj = file();
    obj.splitFleets.config = { ...obj.splitFleets.config, carry: 'net-plus-net' };
    expect(() => migrateSeriesFileObject(obj)).toThrow(/how scores carry \("net-plus-net"\)/);
  });
});
