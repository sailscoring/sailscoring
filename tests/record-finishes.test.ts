import { describe, expect, it } from 'vitest';

import type { Candidate } from '@/lib/finish-sheet-csv';
import { makeFinish } from '@/lib/finish-entry';
import { groupRaces, raceWindow, sheetFromSubmission, uploadOf } from '@/lib/record-finishes';
import type { Finish, SubmittedFinish } from '@/lib/types';

const row = (over: Partial<Finish> & Pick<Finish, 'id'>): Finish => makeFinish('race', over);

describe('the races a recorder picks from', () => {
  it('spans a week either side, across a month end', () => {
    expect(raceWindow('2026-10-29')).toEqual({ from: '2026-10-22', to: '2026-11-05' });
  });

  it('puts today first, then the days ahead, then the days behind latest first', () => {
    const races = ['2026-10-20', '2026-10-24', '2026-10-25', '2026-10-25', '2026-10-27'].map((date, i) => ({ race: { date, n: i } }));
    const g = groupRaces(races, '2026-10-25');
    expect(g.today.map((r) => r.race.n)).toEqual([2, 3]);
    expect(g.upcoming.map((r) => r.race.n)).toEqual([4]);
    expect(g.earlier.map((r) => r.race.n)).toEqual([1, 0]);
  });
});

describe('an upload of the recording', () => {
  it('sends the finishers in crossing order, then the coded boats, naming each by id or the number written down', () => {
    const { input, problems } = uploadOf({
      finishes: [
        row({ id: 'b', competitorId: 'c15', sortOrder: 2, finishTime: '12:43:00', startPresent: true }),
        row({ id: 'r', competitorId: 'c254', resultCode: 'RET' }),
        row({ id: 'a', competitorId: null, unknownSailNumber: '999', sortOrder: 1 }),
        row({ id: 'e', competitorId: 'c9', sortOrder: 3, elapsedSecs: 3725 }),
        // A start check-in is no line of the sheet.
        row({ id: 'k', competitorId: 'c7', startPresent: true }),
      ],
      startTimes: { s1: '11:02', s2: '' },
      recordedBy: ' Committee boat ',
      complete: true,
      revision: 3,
    });
    expect(problems).toEqual([]);
    expect(input).toEqual({
      revision: 3,
      recordedBy: 'Committee boat',
      starts: [{ startId: 's1', startTime: '11:02:00' }],
      finishes: [
        { id: 'a', competitorId: null, sailNumber: '999', finishTime: null, elapsedSecs: null, resultCode: null },
        { id: 'b', competitorId: 'c15', sailNumber: null, finishTime: '12:43:00', elapsedSecs: null, resultCode: null },
        { id: 'e', competitorId: 'c9', sailNumber: null, finishTime: null, elapsedSecs: 3725, resultCode: null },
        { id: 'r', competitorId: 'c254', sailNumber: null, finishTime: null, elapsedSecs: null, resultCode: 'RET' },
      ],
      complete: true,
    });
  });

  it('says which start times can’t be sent', () => {
    const { input, problems } = uploadOf({
      finishes: [],
      startTimes: { s1: 'soon' },
      recordedBy: '',
      complete: false,
      revision: 1,
    });
    expect(problems).toEqual(['“soon” isn’t a start time (HH:MM:SS).']);
    expect(input.starts).toEqual([]);
    expect(input.recordedBy).toBeNull();
  });
});

describe('a submission back into the recording', () => {
  const candidates: Candidate[] = [
    { id: 'c15', sailNumber: '15' },
    { id: 'c22', sailNumber: '22' },
  ] as Candidate[];
  const sailNumberOf = (id: string) => candidates.find((c) => c.id === id)?.sailNumber;
  const sent = (finishes: Partial<SubmittedFinish>[]) => ({
    finishes: finishes.map((f, i) => ({
      id: `f${i}`, competitorId: null, sailNumber: null, finishTime: null, elapsedSecs: null, resultCode: null, ...f,
    })),
  });

  it('reads it as the review does: in order, matching a number entered since', () => {
    const rows = sheetFromSubmission('race', sent([
      { competitorId: 'c15', finishTime: '12:00:00' },
      // Entered since it went in as an unknown boat.
      { sailNumber: '22' },
      { sailNumber: 'IRL 892' },
    ]), candidates, sailNumberOf);
    expect(rows.map((f) => [f.competitorId, f.unknownSailNumber ?? null, f.sortOrder, f.finishTime ?? null])).toEqual([
      ['c15', null, 1, '12:00:00'],
      ['c22', null, 2, null],
      [null, 'IRL 892', 3, null],
    ]);
    expect(rows.every((f) => f.raceId === 'race')).toBe(true);
  });

  it('keeps a coded boat out of the order', () => {
    const rows = sheetFromSubmission('race', sent([{ competitorId: 'c22', resultCode: 'DNF' }]), candidates, sailNumberOf);
    expect(rows.map((f) => [f.competitorId, f.sortOrder, f.resultCode])).toEqual([['c22', null, 'DNF']]);
  });
});
