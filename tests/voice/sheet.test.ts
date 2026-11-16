import { describe, expect, it } from 'vitest';

import { makeFinish } from '@/lib/finish-entry';
import type { Finish } from '@/lib/types';
import { clockTime, linesToSettle, marksOf, placeLine, removeLine, type SheetContext } from '@/lib/voice/sheet';
import type { VoiceLine } from '@/lib/voice/types';

const RACE = 'race-1';
// Local times, so the sheet's HH:MM:SS is the same wherever the test runs.
const at = (h: number, m: number, s: number, ms = 0) => new Date(2026, 10, 14, h, m, s, ms).getTime();

function line(id: string, overrides: Partial<VoiceLine> = {}): VoiceLine {
  return {
    id,
    how: 'whole',
    competitorId: id,
    couldBe: [],
    digits: '',
    words: [],
    heardAt: at(12, 0, 0),
    heardUntil: at(12, 0, 1),
    at: at(12, 0, 2),
    timeFrom: 'word',
    calledAgainAt: [],
    boatSettled: false,
    timeSettled: false,
    removed: false,
    ...overrides,
  };
}

function context(lines: VoiceLine[], timed = true): SheetContext {
  return {
    raceId: RACE,
    takesTime: () => timed,
    crossedAt: (rowId) => lines.find((l) => l.id === rowId)?.at,
  };
}

const order = (rows: Finish[]) =>
  rows.filter((r) => r.sortOrder !== null).sort((a, b) => a.sortOrder! - b.sortOrder!).map((r) => r.competitorId ?? `?${r.unknownSailNumber}`);

describe('clockTime', () => {
  it('writes the phone’s clock to the nearest second', () => {
    expect(clockTime(at(12, 41, 7, 400))).toBe('12:41:07');
    expect(clockTime(at(12, 41, 7, 600))).toBe('12:41:08');
    expect(clockTime(at(9, 5, 59, 700))).toBe('09:06:00');
  });
});

describe('placeLine', () => {
  it('adds each line at the end, in the order they crossed', () => {
    const lines = [line('a', { at: at(12, 0, 2) }), line('b', { at: at(12, 0, 9) })];
    let rows: Finish[] = [];
    for (const l of lines) rows = placeLine(rows, l, context(lines));
    expect(order(rows)).toEqual(['a', 'b']);
    expect(rows.find((r) => r.id === 'a')).toMatchObject({ competitorId: 'a', finishTime: '12:00:02', sortOrder: 1, startPresent: true });
  });

  it('moves a line when its time turns out to be earlier', () => {
    // b was called first but crossed second: her "now" came later.
    const a = line('a', { at: at(12, 0, 6), timeFrom: 'called' });
    const b = line('b', { at: at(12, 0, 8) });
    const lines = [a, b];
    let rows = placeLine(placeLine([], a, context(lines)), b, context(lines));
    expect(order(rows)).toEqual(['a', 'b']);
    b.at = at(12, 0, 4);
    rows = placeLine(rows, b, context(lines));
    expect(order(rows)).toEqual(['b', 'a']);
    expect(rows.find((r) => r.id === 'b')?.finishTime).toBe('12:00:04');
  });

  it('slots among rows typed by hand by their times', () => {
    const typed = [
      makeFinish(RACE, { id: 't1', competitorId: 'x', sortOrder: 1, finishTime: '11:59:00' }),
      makeFinish(RACE, { id: 't2', competitorId: 'y', sortOrder: 2, finishTime: '12:10:00' }),
    ];
    const a = line('a', { at: at(12, 0, 2) });
    expect(order(placeLine(typed, a, context([a])))).toEqual(['x', 'a', 'y']);
  });

  it('leaves the time off a boat scored on finishing order, and still orders her', () => {
    const lines = [line('a', { at: at(12, 0, 9) }), line('b', { at: at(12, 0, 2) })];
    let rows: Finish[] = [];
    for (const l of lines) rows = placeLine(rows, l, context(lines, false));
    expect(order(rows)).toEqual(['b', 'a']);
    expect(rows.every((r) => r.finishTime === undefined)).toBe(true);
  });

  it('files a call that fits several boats, or none, as an unknown boat', () => {
    const choose = line('l1', { how: 'ambiguous', competitorId: null, couldBe: ['a', 'b'], digits: '144' });
    const press = line('l2', { how: 'tap', competitorId: null, heardAt: null, heardUntil: null, at: at(12, 0, 30), timeFrom: 'tap' });
    const lines = [choose, press];
    let rows: Finish[] = [];
    for (const l of lines) rows = placeLine(rows, l, context(lines));
    expect(order(rows)).toEqual(['?144', '??']);
  });

  it('turns an unknown row into the boat once the line has one', () => {
    const press = line('l1', { how: 'tap', competitorId: null, at: at(12, 0, 30), timeFrom: 'tap' });
    let rows = placeLine([], press, context([press]));
    const named = { ...press, how: 'whole' as const, competitorId: 'a' };
    rows = placeLine(rows, named, context([named]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'l1', competitorId: 'a', finishTime: '12:00:30' });
    expect(rows[0].unknownSailNumber).toBeUndefined();
  });

  it('leaves a boat that already has a place where she is', () => {
    const typed = [makeFinish(RACE, { id: 't1', competitorId: 'a', sortOrder: 1 })];
    const a = line('l1', { competitorId: 'a' });
    expect(placeLine(typed, a, context([a]))).toEqual(typed);
  });

  it('joins a crossing to the row a boat was given a code on', () => {
    const coded = [makeFinish(RACE, { id: 't1', competitorId: 'a', resultCode: 'DNF' })];
    const a = line('l1', { competitorId: 'a' });
    const rows = placeLine(coded, a, context([a]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'l1', competitorId: 'a', resultCode: 'DNF', sortOrder: 1, finishTime: '12:00:02' });
  });

  it('keeps a boat the recorder put to a row by hand', () => {
    const choose = line('l1', { how: 'ambiguous', competitorId: null, couldBe: ['a', 'b'], digits: '144', timeFrom: 'called' });
    let rows = placeLine([], choose, context([choose]));
    rows = rows.map((r) => ({ ...r, competitorId: 'b', unknownSailNumber: undefined }));
    // Her "now" arrives after the recorder resolved the row.
    const timed = { ...choose, at: at(12, 0, 5), timeFrom: 'word' as const };
    rows = placeLine(rows, timed, context([timed]));
    expect(rows[0]).toMatchObject({ competitorId: 'b', finishTime: '12:00:05' });
  });
});

describe('removeLine', () => {
  it('takes the row off and closes the order up', () => {
    const lines = [line('a', { at: at(12, 0, 2) }), line('b', { at: at(12, 0, 4) }), line('c', { at: at(12, 0, 6) })];
    let rows: Finish[] = [];
    for (const l of lines) rows = placeLine(rows, l, context(lines));
    rows = removeLine(rows, 'b');
    expect(order(rows)).toEqual(['a', 'c']);
    expect(rows.map((r) => r.sortOrder).sort()).toEqual([1, 2]);
  });
});

describe('marksOf', () => {
  const timed = () => true;
  const rowFor = (l: VoiceLine) => placeLine([], l, context([l]))[0];

  it('asks for a sound-alike to be checked until someone has', () => {
    const l = line('a', { how: 'sounds' });
    expect(marksOf(l, rowFor(l), timed)).toEqual(['check']);
    expect(marksOf({ ...l, boatSettled: true }, rowFor(l), timed)).toEqual([]);
  });

  it('asks for a time taken from the call to be kept or changed', () => {
    const l = line('a', { timeFrom: 'called' });
    expect(marksOf(l, rowFor(l), timed)).toEqual(['time']);
    expect(marksOf({ ...l, timeSettled: true }, rowFor(l), timed)).toEqual([]);
    // Not on a sheet that takes no times.
    expect(marksOf(l, placeLine([], l, context([l], false))[0], () => false)).toEqual([]);
    // Nor once the recorder has typed another time over it.
    expect(marksOf(l, { ...rowFor(l), finishTime: '12:00:09' }, timed)).toEqual([]);
  });

  it('says which kind of unknown boat a row is', () => {
    const choose = line('l1', { how: 'ambiguous', competitorId: null, couldBe: ['a', 'b'] });
    const unknown = line('l2', { how: 'unknown', competitorId: null, digits: '5555' });
    const press = line('l3', { how: 'tap', competitorId: null, timeFrom: 'tap' });
    expect(marksOf(choose, rowFor(choose), timed)).toEqual(['choose']);
    expect(marksOf(unknown, rowFor(unknown), timed)).toEqual(['unknown']);
    expect(marksOf(press, rowFor(press), timed)).toEqual(['no-boat']);
  });

  it('has nothing to say about a line taken back, or a row resolved by hand', () => {
    const choose = line('l1', { how: 'ambiguous', competitorId: null, couldBe: ['a', 'b'] });
    expect(marksOf({ ...choose, removed: true }, rowFor(choose), timed)).toEqual([]);
    expect(marksOf(choose, undefined, timed)).toEqual([]);
    expect(marksOf(choose, { ...rowFor(choose), competitorId: 'b' }, timed)).toEqual([]);
  });
});

describe('linesToSettle', () => {
  it('lists the lines with something open, in crossing order', () => {
    const lines = [
      line('a', { at: at(12, 0, 9), how: 'sounds' }),
      line('b', { at: at(12, 0, 2) }),
      line('c', { at: at(12, 0, 5), timeFrom: 'called' }),
    ];
    let rows: Finish[] = [];
    for (const l of lines) rows = placeLine(rows, l, context(lines));
    expect(linesToSettle(lines, rows, () => true).map((x) => [x.line.id, x.marks])).toEqual([
      ['c', ['time']],
      ['a', ['check']],
    ]);
  });
});
