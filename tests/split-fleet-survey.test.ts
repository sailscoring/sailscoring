import { describe, expect, it } from 'vitest';

import { classifySplitFleetConfig } from '../scripts/split-fleet-survey';

// The three championships scored with split fleets, as their published
// exports store them (2026-09).
const EVENTS = {
  jcc: {"qualifyingFleets":[{"color":"#64748b","label":"Fleet"}],"finalFleets":[],"plannedDays":[{"label":"Day 1","races":5},{"label":"Day 2","races":5}],"finishSheets":"combined","carry":"points","split":{"kind":"none"},"codeBasis":{"final":"own-fleet","qualifying":"largest-fleet"},"equalization":"abandon-extra-races","discardThresholds":[{"minRaces":5,"discardCount":1}],"maxFinalDiscards":0,"protectLoneFinalRace":false,"reassignmentTieOrder":"a8-then-entry-order","vocabulary":"opening-medal","medal":{"size":10,"tieBreak":"medal-race-then-a8","raceCount":1,"multiplier":2,"companionRace":"none"}},
  ilca7: {"qualifyingFleets":[{"color":"#eab308","label":"Yellow"},{"color":"#3b82f6","label":"Blue"},{"color":"#ef4444","label":"Red"}],"finalFleets":[{"color":"#ca8a04","label":"Gold"},{"color":"#94a3b8","label":"Silver"},{"color":"#b45309","label":"Bronze"}],"plannedDays":[{"label":"Day 1","races":2},{"label":"Day 2","races":2},{"label":"Day 3","races":2},{"label":"Day 4","races":2},{"label":"Day 5","races":2},{"label":"Day 6","races":2}],"finishSheets":"combined","carry":"points","split":{"kind":"equal-blocks"},"codeBasis":{"final":"own-fleet","qualifying":"largest-fleet"},"equalization":"abandon-extra-races","discardThresholds":[{"minRaces":3,"discardCount":1},{"minRaces":10,"discardCount":2}],"maxFinalDiscards":1,"protectLoneFinalRace":true,"reassignmentTieOrder":"a8-then-entry-order","vocabulary":"qualification-final","medal":{"size":10,"tieBreak":"last-race","raceCount":2,"multiplier":1,"companionRace":"scored-below","carryTransform":{"by":2,"kind":"divide","rounding":"half-up","appliesFrom":"first-medal-race"}}},
  ilca6: {"qualifyingFleets":[{"color":"#eab308","label":"Yellow"},{"color":"#3b82f6","label":"Blue"}],"finalFleets":[{"color":"#ca8a04","label":"Gold"},{"color":"#94a3b8","label":"Silver"}],"plannedDays":[{"label":"Day 1","races":2},{"label":"Day 2","races":2},{"label":"Day 3","races":2},{"label":"Day 4","races":2},{"label":"Day 5","races":2},{"label":"Day 6","races":2}],"finishSheets":"per-fleet","carry":"points","split":{"kind":"equal-blocks"},"codeBasis":{"final":"own-fleet","qualifying":"largest-fleet"},"equalization":"abandon-extra-races","discardThresholds":[{"minRaces":3,"discardCount":1},{"minRaces":10,"discardCount":2}],"maxFinalDiscards":1,"protectLoneFinalRace":true,"reassignmentTieOrder":"a8-then-entry-order","vocabulary":"qualification-final","medal":{"size":10,"tieBreak":"last-race","raceCount":2,"multiplier":1,"companionRace":"scored-below","carryTransform":{"by":2,"kind":"divide","rounding":"half-up","appliesFrom":"medal-fleet-selected"}},"raceLabels":{"prefixes":{"final":"QE","medal":"F","qualifying":"QP"},"continuousOpeningNumbers":false}},
};

const summary = (cfg: unknown) =>
  classifySplitFleetConfig(cfg).map((f) => `${f.cls} ${f.setting}`);

describe('classifySplitFleetConfig', () => {
  it('finds nothing in the Junior Champions\' Cup', () => {
    expect(summary(EVENTS.jcc)).toEqual([]);
  });

  it("finds only the relabel in the ILCA 7 Men's Worlds", () => {
    expect(summary(EVENTS.ilca7)).toEqual(['presentational raceLabels']);
  });

  it('finds only the carry timing in the ILCA 6 Women\'s Worlds', () => {
    expect(summary(EVENTS.ilca6)).toEqual(['conditional medal.carryTransform.appliesFrom']);
  });

  it('refuses the variants the rebuild removes', () => {
    const cfg = {
      ...EVENTS.ilca7,
      carry: 'rank-seed',
      split: { kind: 'fixed-top', topSize: 25 },
      equalization: 'exclude-extra-scores',
      medal: { ...EVENTS.ilca7.medal, tieBreak: 'stage-rank' },
    };
    expect(summary(cfg).filter((s) => s.startsWith('scoring'))).toEqual([
      'scoring carry',
      'scoring split',
      'scoring equalization',
      'scoring medal.tieBreak',
    ]);
  });

  it('treats an absent tie-break as scoring: rule A8 alone is not kept', () => {
    const { tieBreak: _, ...medal } = EVENTS.jcc.medal;
    expect(summary({ ...EVENTS.jcc, medal })).toEqual(['scoring medal.tieBreak']);
  });
});
