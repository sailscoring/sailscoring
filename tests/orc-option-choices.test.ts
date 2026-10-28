import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mergeOrcScoringOptions, parseOrcRmsJson } from '@/lib/orc-certificate';
import {
  orcChoiceOf,
  orcChoiceRows,
  orcOptionChoices,
  orcOptionToCopy,
  orcSettleChoice,
  type OrcChoiceSelection,
} from '@/lib/orc-option-choices';
import type { OrcProfile } from '@/lib/types';

// The Irish catalog from the real DownRMS feed: the national five-band,
// triple-number and single-number sets, each as a time-on-time and a
// time-on-distance field under one name.
const { scoringOptions } = parseOrcRmsJson(
  readFileSync(join(process.cwd(), 'tests/fixtures/orc/downrms-irl-sample.json'), 'utf-8'),
);
const catalog = mergeOrcScoringOptions(undefined, scoringOptions);
const certificateOptions: OrcProfile[] = Object.entries(catalog)
  .filter(([, e]) => e.kind !== 'pcs')
  .map(([option, e]) => ({ option, kind: e.kind }));
const choices = orcOptionChoices(certificateOptions, catalog);

const choice = (option: string) => choices.find((c) => c.option === option);
const settle = (wanted: OrcChoiceSelection) => orcSettleChoice(choices, wanted);
const from = (option: string, change: OrcChoiceSelection) =>
  settle({ ...orcChoiceOf(choices, option)!, ...change });

describe('orcOptionChoices', () => {
  it('takes a national five-band option apart into its kind, course, set and band', () => {
    expect(choice('IRL_5B_WL_LM_TOT')).toMatchObject({
      kind: 'tot', office: 'IRL', course: '50-50 Windward/Leeward', numbers: 5, band: 'L/M', bandKey: 'LM',
    });
    // Its time-on-distance twin differs in its kind alone.
    expect(choice('IRL_5B_WL_LM_TOD')).toMatchObject({
      kind: 'tod', course: '50-50 Windward/Leeward', numbers: 5, band: 'L/M',
    });
    expect(choice('IRL_TN_AP_M_TOT')).toMatchObject({ course: 'All Purpose', numbers: 3, bandKey: 'M' });
    expect(choice('IRL_PREDUP_TOT')).toMatchObject({ course: 'Predominant Upwind', numbers: 1 });
    expect(choice('IRL_PREDUP_TOT')?.band).toBeUndefined();
  });

  it('folds one course\'s spellings together, whatever set names it', () => {
    // "5-Band All Purpose" and "Triple Number All-Purpose" are one course.
    const ap = choices.filter((c) => c.office === 'IRL' && c.kind === 'tot' && /all.purpose/i.test(c.course));
    expect(new Set(ap.map((c) => c.courseKey)).size).toBe(1);
    expect(new Set(ap.map((c) => c.numbers))).toEqual(new Set([1, 3, 5]));
  });

  it('places every international option on its course', () => {
    expect(choice('APHT')).toMatchObject({ kind: 'tot', office: 'ORC', course: 'All-purpose', numbers: 1 });
    expect(choice('CC_TOT')).toMatchObject({ course: 'Constructed course at the recorded wind' });
    expect(choice('CC')?.courseKey).toBe(choice('CC_TOT')?.courseKey);
  });

  it('leaves out certificate options the catalog can\'t name', () => {
    const bare = orcOptionChoices([{ option: 'IRL_5B_WL_LM_TOT', kind: 'tot' }], undefined);
    expect(bare.some((c) => c.option === 'IRL_5B_WL_LM_TOT')).toBe(false);
    expect(bare.some((c) => c.option === 'APHT')).toBe(true);
  });
});

describe('orcSettleChoice', () => {
  it('changing the course keeps the kind, the set and the band', () => {
    // A windward/leeward day, then a round-the-cans one.
    expect(from('IRL_5B_WL_LM_TOT', { course: choice('IRL_AP_LM_TOT')!.courseKey }).option).toBe('IRL_AP_LM_TOT');
  });

  it('changing the kind keeps the rest', () => {
    expect(from('IRL_5B_WL_LM_TOT', { kind: 'tod' }).option).toBe('IRL_5B_WL_LM_TOD');
    // Curves on the same course: all-purpose stays all-purpose.
    expect(from('APHT', { kind: 'pcs' }).option).toBe('CR');
    // And back from curves to the recorded wind keeps the constructed course.
    expect(from('CC', { kind: 'tot' }).option).toBe('CC_TOT');
  });

  it('clears a row the change leaves no value for, and only that row', () => {
    // A triple has no L/M: the band is left to choose.
    const r = from('IRL_5B_WL_LM_TOT', { numbers: 3 });
    expect(r.option).toBeUndefined();
    expect(r.selection).toEqual({ kind: 'tot', course: choice('IRL_5B_WL_LM_TOT')!.courseKey, numbers: 3 });
    // Med is in both sets, so it carries over.
    expect(from('IRL_5B_WL_M_TOT', { numbers: 3 }).option).toBe('IRL_TN_WL_M_TOT');
    // No Irish course is scored on curves.
    const pcs = from('IRL_5B_WL_LM_TOT', { kind: 'pcs' });
    expect(pcs.option).toBeUndefined();
    expect(pcs.selection).toEqual({ kind: 'pcs' });
  });

  it('takes a row\'s only value without being asked', () => {
    // The international all-purpose course has one number, so choosing the
    // course is choosing the option.
    expect(settle({ kind: 'tot', course: choice('APHT')!.courseKey }).option).toBe('APHT');
  });

  it('round-trips every option', () => {
    for (const c of choices) expect(settle(orcChoiceOf(choices, c.option)!).option).toBe(c.option);
  });
});

describe('orcChoiceRows', () => {
  it('offers each row only what the rows above allow, bands lightest first', () => {
    const rows = orcChoiceRows(choices, orcChoiceOf(choices, 'IRL_5B_WL_LM_TOT')!);
    expect(rows.kinds).toEqual(['tot', 'tod', 'pcs']);
    // International courses first, then Ireland's.
    expect(rows.courses[0]).toMatchObject({ office: 'ORC', label: 'All-purpose' });
    expect(rows.courses.filter((c) => c.office === 'IRL').map((c) => c.label)).toEqual([
      '50-50 Windward/Leeward',
      '60-40 Windward/Leeward',
      'All Purpose',
      'Predominant Downwind',
      'Predominant Reaching',
      'Predominant Upwind',
    ]);
    expect(rows.numbers).toEqual([3, 5]);
    expect(rows.bands.map((b) => b.label)).toEqual(['Low', 'L/M', 'Med', 'M/H', 'High']);
  });
});

describe('orcOptionToCopy', () => {
  const races = [
    { id: 'r1', raceNumber: 1 },
    { id: 'r2', raceNumber: 2 },
    { id: 'r3', raceNumber: 3 },
  ];
  const orc = new Set(['orc1', 'orc2']);

  it('copies the latest ORC start in this race first', () => {
    const starts = [
      { raceId: 'r2', fleetIds: ['orc1'], startTime: '12:30:00', orcOption: 'IRL_AP_M_TOT' },
      { raceId: 'r3', fleetIds: ['orc1'], startTime: '12:30:00', orcOption: 'IRL_5B_WL_LM_TOT' },
      { raceId: 'r3', fleetIds: ['orc2'], startTime: '12:38:00', orcOption: 'IRL_5B_WL_L_TOT' },
      // A later start with no ORC fleet says nothing about the option.
      { raceId: 'r3', fleetIds: ['irc'], startTime: '12:50:00' },
    ];
    expect(orcOptionToCopy(races[2], races, starts, orc)).toBe('IRL_5B_WL_L_TOT');
  });

  it('else the most recent earlier race with an ORC start', () => {
    const starts = [
      { raceId: 'r1', fleetIds: ['orc1'], startTime: '12:30:00', orcOption: 'APHT' },
      { raceId: 'r2', fleetIds: ['orc1'], startTime: '12:30:00', orcOption: 'IRL_AP_M_TOT' },
    ];
    expect(orcOptionToCopy(races[2], races, starts, orc)).toBe('IRL_AP_M_TOT');
  });

  it('copies the fleet default too, rather than reaching past it', () => {
    const starts = [
      { raceId: 'r1', fleetIds: ['orc1'], startTime: '12:30:00', orcOption: 'IRL_AP_M_TOT' },
      { raceId: 'r2', fleetIds: ['orc1'], startTime: '12:30:00' },
    ];
    expect(orcOptionToCopy(races[2], races, starts, orc)).toBeUndefined();
  });
});
