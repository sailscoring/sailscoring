import { describe, expect, it } from 'vitest';

import { groupRaces, raceWindow, rowsFromSubmission, uploadOf, type RecordingRow } from '@/lib/record-finishes';
import type { FinishSubmission } from '@/lib/types';

const row = (over: Partial<RecordingRow>): RecordingRow => ({
  id: 'r', competitorId: null, sailNumber: '', finishTime: '', elapsedSecs: null, resultCode: '', ...over,
});

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
  it('normalises times, names boats by id or sail number, and leaves blank start times out', () => {
    const { input, problems } = uploadOf({
      rows: [
        row({ id: 'a', sailNumber: ' 22 ', finishTime: '124213' }),
        row({ id: 'b', competitorId: 'c15', sailNumber: '15', finishTime: '12:43' }),
        row({ id: 'c', sailNumber: '254', finishTime: '12:44:00', resultCode: 'DNF' }),
        row({ id: 'd', sailNumber: '9', elapsedSecs: 3725 }),
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
        { id: 'a', competitorId: null, sailNumber: '22', finishTime: '12:42:13', elapsedSecs: null, resultCode: null },
        { id: 'b', competitorId: 'c15', sailNumber: null, finishTime: '12:43:00', elapsedSecs: null, resultCode: null },
        // A code wins over a time, as on an imported sheet.
        { id: 'c', competitorId: null, sailNumber: '254', finishTime: null, elapsedSecs: null, resultCode: 'DNF' },
        { id: 'd', competitorId: null, sailNumber: '9', finishTime: null, elapsedSecs: 3725, resultCode: null },
      ],
      complete: true,
    });
  });

  it('says which rows and starts can’t be sent', () => {
    const { input, problems } = uploadOf({
      rows: [row({ id: 'a' }), row({ id: 'b', sailNumber: '7', finishTime: '25:61' })],
      startTimes: { s1: 'soon' },
      recordedBy: '',
      complete: false,
      revision: 1,
    });
    expect(problems).toEqual([
      'Row 1 needs a sail number.',
      'Row 2 “25:61” isn’t a time (HH:MM:SS).',
      '“soon” isn’t a start time (HH:MM:SS).',
    ]);
    expect(input.finishes).toEqual([]);
    expect(input.recordedBy).toBeNull();
  });
});

describe('a submission back into rows', () => {
  it('shows each boat by the number written down, or its entry’s', () => {
    const rows = rowsFromSubmission({
      finishes: [
        { id: 'a', competitorId: 'c15', sailNumber: null, finishTime: '12:00:00', elapsedSecs: null, resultCode: null },
        { id: 'b', competitorId: null, sailNumber: 'IRL 892', finishTime: null, elapsedSecs: null, resultCode: 'DNF' },
      ],
    } as FinishSubmission, (id) => ({ c15: '15' })[id]);
    expect(rows).toEqual([
      { id: 'a', competitorId: 'c15', sailNumber: '15', finishTime: '12:00:00', elapsedSecs: null, resultCode: '' },
      { id: 'b', competitorId: null, sailNumber: 'IRL 892', finishTime: '', elapsedSecs: null, resultCode: 'DNF' },
    ]);
  });
});
