import { describe, expect, it } from 'vitest';

import { makeFinish } from '@/lib/finish-entry';
import type { Finish } from '@/lib/types';
import {
  atOfClockTime,
  clockTenths,
  clockTime,
  handChanges,
  placeFinish,
  removeRow,
  submittableRows,
  suggestionRowId,
  syncSuggestions,
  type SheetContext,
} from '@/lib/voice/sheet';
import type { Suggestion } from '@/lib/voice/timeline';
import type { VoiceFinish } from '@/lib/voice/types';

const RACE = 'race-1';
// Local times, so the sheet's HH:MM:SS is the same wherever the test runs.
const at = (h: number, m: number, s: number, ms = 0) => new Date(2026, 10, 22, h, m, s, ms).getTime();

function suggestion(key: string, competitorId: string | null, when: number, overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    key,
    competitorId,
    sailNumber: null,
    couldBe: [],
    heard: null,
    at: when,
    timeFrom: 'press',
    pressId: null,
    calledAt: null,
    callKey: null,
    nowKey: null,
    check: null,
    ...overrides,
  };
}

function finish(id: string, competitorId: string | null, when: number, overrides: Partial<VoiceFinish> = {}): VoiceFinish {
  return { id, competitorId, sailNumber: null, at: when, timeFrom: 'press', pressId: null, calledAt: null, removed: false, ...overrides };
}

function context(times: Record<string, number>, timed = true): SheetContext {
  return { raceId: RACE, takesTime: () => timed, crossedAt: (rowId) => times[rowId] };
}

const order = (rows: readonly Finish[]) =>
  rows.filter((r) => r.sortOrder !== null).sort((a, b) => a.sortOrder! - b.sortOrder!).map((r) => r.competitorId ?? `?${r.unknownSailNumber}`);

describe('clock times', () => {
  it('writes the phone’s clock to the nearest second, and to a tenth', () => {
    expect(clockTime(at(12, 41, 7, 400))).toBe('12:41:07');
    expect(clockTime(at(12, 41, 7, 600))).toBe('12:41:08');
    expect(clockTenths(at(12, 41, 7, 340))).toBe('12:41:07.3');
    expect(clockTenths(at(12, 41, 59, 960))).toBe('12:42:00.0');
  });

  it('reads a time typed on the sheet onto the nearest day', () => {
    expect(atOfClockTime('12:41:08', at(12, 40, 0))).toBe(at(12, 41, 8));
    expect(atOfClockTime('00:00:05', at(23, 59, 50))).toBe(at(23, 59, 50) + 15_000);
    expect(atOfClockTime('soon', at(12, 0, 0))).toBeNull();
  });
});

describe('syncSuggestions', () => {
  it('puts each suggestion on the sheet in the order they finished', () => {
    const s = [suggestion('a', 'kestrel', at(12, 0, 9)), suggestion('b', 'gannet', at(12, 0, 2))];
    const times = { [suggestionRowId('a')]: at(12, 0, 9), [suggestionRowId('b')]: at(12, 0, 2) };
    const { rows, written } = syncSuggestions([], s, context(times));
    expect(order(rows)).toEqual(['gannet', 'kestrel']);
    expect(rows.find((r) => r.id === suggestionRowId('a'))).toMatchObject({ finishTime: '12:00:09', startPresent: true });
    expect([...written.keys()]).toEqual([suggestionRowId('a'), suggestionRowId('b')]);
  });

  it('gives back the same rows when nothing has changed', () => {
    const s = [suggestion('a', 'kestrel', at(12, 0, 9))];
    const ctx = context({ [suggestionRowId('a')]: at(12, 0, 9) });
    const first = syncSuggestions([], s, ctx).rows;
    expect(syncSuggestions(first, s, ctx).rows).toBe(first);
  });

  it('takes away a suggestion that has gone, and moves one whose time has', () => {
    const typed = makeFinish(RACE, { id: 't', competitorId: 'tern', sortOrder: 1, finishTime: '12:00:05' });
    const ctx1 = context({ [suggestionRowId('a')]: at(12, 0, 2), [suggestionRowId('b')]: at(12, 0, 8) });
    const one = syncSuggestions([typed], [suggestion('a', 'kestrel', at(12, 0, 2)), suggestion('b', 'gannet', at(12, 0, 8))], ctx1).rows;
    expect(order(one)).toEqual(['kestrel', 'tern', 'gannet']);
    const ctx2 = context({ [suggestionRowId('a')]: at(12, 0, 7) });
    const two = syncSuggestions(one, [suggestion('a', 'kestrel', at(12, 0, 7))], ctx2).rows;
    expect(order(two)).toEqual(['tern', 'kestrel']);
  });

  it('leaves out a competitor who already has a place, and files a NOW with no sail number under ?', () => {
    const typed = makeFinish(RACE, { id: 't', competitorId: 'kestrel', sortOrder: 1, finishTime: '12:00:05' });
    const { rows } = syncSuggestions([typed], [suggestion('a', 'kestrel', at(12, 0, 2)), suggestion('n', null, at(12, 0, 9))], context({}));
    expect(order(rows)).toEqual(['kestrel', '??']);
    expect(rows.find((r) => r.id === 't')).toBe(typed);
  });

  it('gives an order-only fleet’s rows no time', () => {
    const { rows } = syncSuggestions([], [suggestion('a', 'kestrel', at(12, 0, 2))], context({}, false));
    expect(rows[0].finishTime).toBeUndefined();
  });
});

describe('handChanges', () => {
  it('finds a suggested row changed by hand, and one deleted', () => {
    const s = [suggestion('a', 'kestrel', at(12, 0, 2)), suggestion('b', 'gannet', at(12, 0, 8))];
    const { rows, written } = syncSuggestions([], s, context({}));
    const edited = rows
      .filter((r) => r.id !== suggestionRowId('b'))
      .map((r) => (r.id === suggestionRowId('a') ? { ...r, finishTime: '12:00:03' } : r));
    expect(handChanges(edited, written)).toEqual({
      changed: [{ key: 'a', row: expect.objectContaining({ finishTime: '12:00:03' }) }],
      deleted: ['b'],
    });
    expect(handChanges(rows, written)).toEqual({ changed: [], deleted: [] });
  });
});

describe('placeFinish', () => {
  it('replaces the suggestion it was accepted from, in the same place', () => {
    const s = [suggestion('a', 'kestrel', at(12, 0, 2)), suggestion('b', 'gannet', at(12, 0, 8))];
    const times = { [suggestionRowId('a')]: at(12, 0, 2), [suggestionRowId('b')]: at(12, 0, 8), f1: at(12, 0, 8) };
    const { rows } = syncSuggestions([], s, context(times));
    const out = placeFinish(rows, finish('f1', 'gannet', at(12, 0, 8)), context(times), suggestionRowId('b'));
    expect(out.map((r) => r.id).sort()).toEqual(['f1', suggestionRowId('a')].sort());
    expect(order(out)).toEqual(['kestrel', 'gannet']);
  });

  it('finishes a competitor on their row with no place, and leaves one with a place alone', () => {
    const coded = makeFinish(RACE, { id: 'c', competitorId: 'kestrel', sortOrder: null, startPresent: true });
    const out = placeFinish([coded], finish('f1', 'kestrel', at(12, 0, 2)), context({}));
    expect(out).toEqual([expect.objectContaining({ id: 'f1', competitorId: 'kestrel', sortOrder: 1, startPresent: true, finishTime: '12:00:02' })]);
    const placedRow = makeFinish(RACE, { id: 't', competitorId: 'kestrel', sortOrder: 1 });
    expect(placeFinish([placedRow], finish('f1', 'kestrel', at(12, 0, 2)), context({}))).toEqual([placedRow]);
  });

  it('files a competitor not on the entry list under the sail number, and takes a removed finish off', () => {
    const out = placeFinish([], finish('f1', null, at(12, 0, 2), { sailNumber: '44' }), context({}));
    expect(out[0]).toMatchObject({ competitorId: null, unknownSailNumber: '44' });
    expect(placeFinish(out, finish('f1', null, at(12, 0, 2), { removed: true }), context({}))).toEqual([]);
  });
});

describe('removeRow and submittableRows', () => {
  it('numbers the order again, and leaves suggestions behind', () => {
    const { rows } = syncSuggestions(
      [makeFinish(RACE, { id: 't', competitorId: 'tern', sortOrder: 1, finishTime: '12:00:05' })],
      [suggestion('a', 'kestrel', at(12, 0, 2))],
      context({ [suggestionRowId('a')]: at(12, 0, 2) }),
    );
    expect(removeRow(rows, suggestionRowId('a'))).toEqual([expect.objectContaining({ id: 't', sortOrder: 1 })]);
    expect(submittableRows(rows).map((r) => r.id)).toEqual(['t']);
  });
});
