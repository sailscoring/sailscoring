import { describe, expect, it } from 'vitest';

import type { Candidate } from '@/lib/finish-sheet-csv';
import { diffSheets, matchOf, raceCandidates, readSubmission } from '@/lib/finish-submission';
import type { Competitor, Finish, RaceStart, SubmittedFinish } from '@/lib/types';

const candidates: Candidate[] = [
  { id: 'c1', sailNumber: '15', fleetIds: ['f1'] },
  { id: 'c2', sailNumber: '22', fleetIds: ['f1'] },
  { id: 'c3', sailNumber: '254', fleetIds: ['f1'], bowNumber: '7' },
];
const entered: Record<string, string> = { c1: '15', c2: '22', c3: '254', c9: '901' };
const sailOf = (id: string) => entered[id];

const submitted = (rows: Partial<SubmittedFinish>[]): SubmittedFinish[] =>
  rows.map((r, i) => ({
    id: `f${i + 1}`, competitorId: null, sailNumber: null, finishTime: null, elapsedSecs: null, resultCode: null, ...r,
  }));

const stored = (rows: Partial<Finish>[]): Finish[] =>
  rows.map((r, i) => ({
    id: `s${i + 1}`, raceId: 'r', competitorId: null, sortOrder: null, tiedWithPrevious: false, resultCode: null,
    startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null,
    redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null, ...r,
  }));

describe('readSubmission', () => {
  it('reads ids, sail numbers, bow numbers, times and codes as an import would', () => {
    const finishes = submitted([
      { competitorId: 'c2', finishTime: '12:00:01' },
      { sailNumber: '7', finishTime: '12:00:05' },
      { sailNumber: 'IRL 892', finishTime: '12:01:00' },
      { competitorId: 'c1', resultCode: 'DNF' },
    ]);
    const read = readSubmission(finishes, candidates, sailOf);
    expect(read.finishes.map((f) => [f.competitorId, f.unknownSailNumber ?? null, f.sortOrder, f.finishTime ?? null, f.resultCode]))
      .toEqual([
        ['c2', null, 1, '12:00:01', null],
        ['c3', null, 2, '12:00:05', null],
        [null, 'IRL 892', 3, '12:01:00', null],
        ['c1', null, null, null, 'DNF'],
      ]);
    expect(read.finishes[1]).toMatchObject({ matchedOn: 'bow', enteredSailNumber: '7' });
    expect(matchOf(finishes, read)).toEqual({ matched: 3, unknownSailNumbers: ['IRL 892'], skipped: [] });
  });

  it('keeps an elapsed time, and says which rows are skipped and why', () => {
    const finishes = submitted([
      { competitorId: 'c1', elapsedSecs: 3725.5 },
      { competitorId: 'c9', finishTime: '12:00:00' },
      { sailNumber: '22', resultCode: 'XYZ' },
    ]);
    const read = readSubmission(finishes, candidates, sailOf);
    expect(read.finishes).toMatchObject([{ competitorId: 'c1', elapsedSecs: 3725.5, sortOrder: 1 }]);
    expect(matchOf(finishes, read)).toEqual({
      matched: 1,
      unknownSailNumbers: [],
      skipped: [
        { id: 'f2', reason: '901 isn\'t entered in a fleet in this race' },
        { id: 'f3', reason: 'unknown result code "XYZ"' },
      ],
    });
  });
});

describe('diffSheets', () => {
  it('lines up each boat before and after, in the submission’s order', () => {
    const current = stored([
      { competitorId: 'c1', sortOrder: 1, finishTime: '12:00:00' },
      { competitorId: 'c2', sortOrder: 3, finishTime: '12:00:09' },
      { competitorId: 'c3', resultCode: 'DNF' },
      // A check-in, not a line of the sheet.
      { competitorId: 'c9', startPresent: true },
    ]);
    const incoming = readSubmission(submitted([
      { competitorId: 'c2', finishTime: '12:00:09' },
      { competitorId: 'c1', finishTime: '12:00:00' },
      { sailNumber: 'IRL 892', finishTime: '12:01:00' },
    ]), candidates, sailOf).finishes;
    expect(diffSheets(current, incoming)).toEqual([
      { competitorId: 'c2', unknownSailNumber: null, before: { place: 2, time: '12:00:09', code: null }, after: { place: 1, time: '12:00:09', code: null }, changed: true },
      { competitorId: 'c1', unknownSailNumber: null, before: { place: 1, time: '12:00:00', code: null }, after: { place: 2, time: '12:00:00', code: null }, changed: true },
      { competitorId: null, unknownSailNumber: 'IRL 892', before: null, after: { place: 3, time: '12:01:00', code: null }, changed: true },
      { competitorId: 'c3', unknownSailNumber: null, before: { place: null, time: null, code: 'DNF' }, after: null, changed: true },
    ]);
  });

  it('marks a line the submission leaves as it was', () => {
    const current = stored([{ competitorId: 'c1', sortOrder: 1, elapsedSecs: 61 }]);
    const incoming = readSubmission(submitted([{ competitorId: 'c1', elapsedSecs: 61 }]), candidates, sailOf).finishes;
    expect(diffSheets(current, incoming)).toEqual([
      { competitorId: 'c1', unknownSailNumber: null, before: { place: 1, time: '1:01', code: null }, after: { place: 1, time: '1:01', code: null }, changed: false },
    ]);
  });
});

describe('raceCandidates', () => {
  const boat = (id: string, fleetIds: string[]): Competitor =>
    ({ id, seriesId: 's', sailNumber: id.toUpperCase(), fleetIds, names: ['A'], gender: '', age: null, createdAt: 0 }) as Competitor;
  const start = (fleetIds: string[]): RaceStart => ({ id: `st-${fleetIds.join()}`, raceId: 'r', fleetIds });
  const names: Record<string, string> = { f1: 'Class 1', f2: 'Class 2' };

  it('is the boats in the race\'s fleets, with those fleets\' names', () => {
    const got = raceCandidates([boat('a', ['f1']), boat('b', ['f2']), boat('c', ['f1', 'f2'])], [start(['f1'])], (id) => names[id]);
    expect(got.map((c) => [c.id, c.fleetNames])).toEqual([
      ['a', ['Class 1']],
      ['c', ['Class 1']],
    ]);
  });

  it('is every boat while the race has no starts, fleets or not', () => {
    const got = raceCandidates([boat('a', ['f1']), boat('q', [])], [], (id) => names[id]);
    expect(got.map((c) => c.id)).toEqual(['a', 'q']);
  });
});
