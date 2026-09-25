// Named split-fleet configurations for tests. The app offers no format
// templates; these are the shapes of the championships the tests exercise.

import {
  defaultSplitFleetConfig,
  UNBANDED_FLEET,
  type SplitFleetConfig,
} from '@/lib/split-fleets';

/** The 2026 ILCA Worlds: the 2026 wording, a halved carry into a two-race
 *  Final series at single points, ties on the last race. */
export function ilca2026Config(fleetCount: number): SplitFleetConfig {
  return {
    ...defaultSplitFleetConfig(fleetCount),
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
  };
}

/** The Irish Sailing Junior Champions' Cup: one fleet, never divided, and a
 *  medal race at double points for the top ten. */
export function openingSeriesMedalConfig(): SplitFleetConfig {
  return {
    ...defaultSplitFleetConfig(1),
    qualifyingFleets: [UNBANDED_FLEET],
    finalFleets: [],
    split: { kind: 'none' },
    discardThresholds: [{ minRaces: 5, discardCount: 1 }],
    medal: {
      size: 10,
      multiplier: 2,
      tieBreak: 'medal-race-then-a8',
    },
  };
}
