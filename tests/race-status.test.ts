import { describe, it, expect } from 'vitest';

import {
  effectiveLastFinisherTime,
  lastKnownFinish,
  lastRaceOfSeries,
  protestTimeLimitEnd,
} from '@/lib/race-status';
import type { Finish, Race } from '@/lib/types';

function makeRace(overrides: Partial<Race> & Pick<Race, 'id'>): Race {
  return {
    seriesId: 's1',
    raceNumber: 1,
    name: null,
    date: '2026-07-11',
    createdAt: 0,
    ...overrides,
  };
}

function makeFinish(raceId: string, overrides: Partial<Finish>): Finish {
  return {
    id: crypto.randomUUID(),
    raceId,
    competitorId: crypto.randomUUID(),
    sortOrder: 1,
    tiedWithPrevious: false,
    resultCode: null,
    startPresent: null,
    penaltyCode: null,
    penaltyOverride: null,
    redressMethod: null,
    redressExcludeRaceIds: null,
    redressIncludeRaceIds: null,
    redressIncludeAllLater: false,
    redressPoints: null,
    ...overrides,
  };
}

describe('effectiveLastFinisherTime', () => {
  it('returns the latest finish-sheet time, not the last row', () => {
    const race = makeRace({ id: 'r1' });
    const finishes = [
      makeFinish('r1', { sortOrder: 1, finishTime: '15:40:10' }),
      makeFinish('r1', { sortOrder: 3, finishTime: '15:42:05' }),
      makeFinish('r1', { sortOrder: 2, finishTime: '15:41:00' }),
    ];
    expect(effectiveLastFinisherTime(race, finishes)).toEqual({
      time: '15:42:05',
      source: 'finishes',
    });
  });

  it('counts a timed coded row (the boat still crossed last)', () => {
    const race = makeRace({ id: 'r1' });
    const finishes = [
      makeFinish('r1', { sortOrder: 1, finishTime: '15:40:10' }),
      makeFinish('r1', { sortOrder: null, resultCode: 'RET', finishTime: '15:55:00' }),
    ];
    expect(effectiveLastFinisherTime(race, finishes)?.time).toBe('15:55:00');
  });

  it('prefers the sheet over the manual field when both exist', () => {
    const race = makeRace({ id: 'r1', lastFinisherTime: '16:30:00' });
    const finishes = [makeFinish('r1', { finishTime: '15:42:05' })];
    expect(effectiveLastFinisherTime(race, finishes)).toEqual({
      time: '15:42:05',
      source: 'finishes',
    });
  });

  it('falls back to the manual field when no finish is timed', () => {
    const race = makeRace({ id: 'r1', lastFinisherTime: '16:30:00' });
    const finishes = [makeFinish('r1', {}), makeFinish('r1', { sortOrder: 2 })];
    expect(effectiveLastFinisherTime(race, finishes)).toEqual({
      time: '16:30:00',
      source: 'manual',
    });
  });

  it('returns null with no times anywhere, or an unparseable manual value', () => {
    expect(effectiveLastFinisherTime(makeRace({ id: 'r1' }), [])).toBeNull();
    expect(
      effectiveLastFinisherTime(
        makeRace({ id: 'r1', lastFinisherTime: 'soon' }),
        [],
      ),
    ).toBeNull();
  });
});

describe('lastRaceOfSeries', () => {
  it('picks the latest date, race number breaking ties', () => {
    const races = [
      makeRace({ id: 'r1', raceNumber: 1, date: '2026-07-04' }),
      makeRace({ id: 'r3', raceNumber: 3, date: '2026-07-11' }),
      makeRace({ id: 'r2', raceNumber: 2, date: '2026-07-11' }),
    ];
    expect(lastRaceOfSeries(races)?.id).toBe('r3');
    expect(lastRaceOfSeries([])).toBeNull();
  });
});

describe('lastKnownFinish', () => {
  it('returns the most recent race that actually has a time', () => {
    const races = [
      makeRace({ id: 'r1', raceNumber: 1, date: '2026-07-04' }),
      makeRace({ id: 'r2', raceNumber: 2, date: '2026-07-11' }),
      makeRace({ id: 'r3', raceNumber: 3, date: '2026-07-18' }), // no finishes yet
    ];
    const finishesByRace = new Map<string, Finish[]>([
      ['r1', [makeFinish('r1', { finishTime: '15:00:00' })]],
      ['r2', [makeFinish('r2', { finishTime: '15:42:05' })]],
    ]);
    const result = lastKnownFinish(races, finishesByRace);
    expect(result?.race.id).toBe('r2');
    expect(result?.lastFinisher.time).toBe('15:42:05');
  });

  it('sees manual times too, and is null when nothing has a time', () => {
    const races = [
      makeRace({ id: 'r1', raceNumber: 1, lastFinisherTime: '14:30:00' }),
    ];
    expect(lastKnownFinish(races, new Map())?.lastFinisher).toEqual({
      time: '14:30:00',
      source: 'manual',
    });
    expect(lastKnownFinish([makeRace({ id: 'r2' })], new Map())).toBeNull();
  });
});

describe('protestTimeLimitEnd', () => {
  const limit = { minutes: 90, basis: 'race' as const };

  it('computes last finisher + minutes on the race date', () => {
    const race = makeRace({ id: 'r1' });
    const finishesByRace = new Map<string, Finish[]>([
      ['r1', [makeFinish('r1', { finishTime: '15:42:05' })]],
    ]);
    const end = protestTimeLimitEnd(limit, race, [race], finishesByRace);
    expect(end).toEqual(new Date('2026-07-11T17:12:05'));
  });

  it("basis 'day' anchors on the latest finisher across the race day", () => {
    const r1 = makeRace({ id: 'r1', raceNumber: 1 });
    const r2 = makeRace({ id: 'r2', raceNumber: 2 });
    const otherDay = makeRace({ id: 'r3', raceNumber: 3, date: '2026-07-18' });
    const finishesByRace = new Map<string, Finish[]>([
      ['r1', [makeFinish('r1', { finishTime: '15:00:00' })]],
      ['r2', [makeFinish('r2', { finishTime: '16:10:00' })]],
      ['r3', [makeFinish('r3', { finishTime: '19:00:00' })]],
    ]);
    const races = [r1, r2, otherDay];
    const dayLimit = { minutes: 60, basis: 'day' as const };
    // r1's own finisher was 15:00, but the day's last was r2's 16:10.
    expect(protestTimeLimitEnd(dayLimit, r1, races, finishesByRace)).toEqual(
      new Date('2026-07-11T17:10:00'),
    );
    // The other day is unaffected by this one.
    expect(protestTimeLimitEnd(dayLimit, otherDay, races, finishesByRace)).toEqual(
      new Date('2026-07-18T20:00:00'),
    );
  });

  it('crosses midnight into the next day instead of wrapping', () => {
    const race = makeRace({ id: 'r1', lastFinisherTime: '23:30:00' });
    const end = protestTimeLimitEnd(limit, race, [race], new Map());
    expect(end).toEqual(new Date('2026-07-12T01:00:00'));
  });

  it('is null without a config, a last-finisher time, or a race date', () => {
    const race = makeRace({ id: 'r1' });
    const timed = new Map<string, Finish[]>([
      ['r1', [makeFinish('r1', { finishTime: '15:00:00' })]],
    ]);
    expect(protestTimeLimitEnd(undefined, race, [race], timed)).toBeNull();
    expect(protestTimeLimitEnd(limit, race, [race], new Map())).toBeNull();
    const dateless = makeRace({ id: 'r2', date: '', lastFinisherTime: '15:00:00' });
    expect(protestTimeLimitEnd(limit, dateless, [dateless], new Map())).toBeNull();
  });
});
