import { describe, it, expect } from 'vitest';

import {
  defaultRaceDate,
  generateRaceDates,
  generateRaceSchedule,
  todayIsoDate,
  MAX_GENERATED_RACES,
  MAX_RACES_PER_DAY,
} from '@/lib/race-schedule';

describe('generateRaceDates', () => {
  it('generates a weekly run by count', () => {
    expect(
      generateRaceDates({ startDate: '2026-05-05', intervalDays: 7, count: 4 }),
    ).toEqual(['2026-05-05', '2026-05-12', '2026-05-19', '2026-05-26']);
  });

  it('generates a fortnightly run up to an inclusive end date', () => {
    expect(
      generateRaceDates({
        startDate: '2026-05-05',
        intervalDays: 14,
        untilDate: '2026-06-16',
      }),
    ).toEqual(['2026-05-05', '2026-05-19', '2026-06-02', '2026-06-16']);
  });

  it('includes a race falling exactly on the until date', () => {
    const dates = generateRaceDates({
      startDate: '2026-05-05',
      intervalDays: 7,
      untilDate: '2026-05-19',
    });
    expect(dates).toEqual(['2026-05-05', '2026-05-12', '2026-05-19']);
  });

  it('excludes a cadence step that overshoots the until date', () => {
    const dates = generateRaceDates({
      startDate: '2026-05-05',
      intervalDays: 7,
      untilDate: '2026-05-18',
    });
    expect(dates).toEqual(['2026-05-05', '2026-05-12']);
  });

  it('handles a single race', () => {
    expect(
      generateRaceDates({ startDate: '2026-05-05', intervalDays: 7, count: 1 }),
    ).toEqual(['2026-05-05']);
  });

  it('keeps the weekday stable across a spring-forward DST transition', () => {
    // Irish clocks jump forward on 2026-03-29. A Tuesday cadence spanning it
    // must stay on Tuesdays — the classic millisecond-addition drift bug.
    const dates = generateRaceDates({
      startDate: '2026-03-24',
      intervalDays: 7,
      count: 3,
    });
    expect(dates).toEqual(['2026-03-24', '2026-03-31', '2026-04-07']);
    for (const d of dates) {
      // getUTCDay 2 = Tuesday.
      expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(2);
    }
  });

  it('advances correctly across a leap-year February', () => {
    const dates = generateRaceDates({
      startDate: '2028-02-22',
      intervalDays: 7,
      count: 3,
    });
    expect(dates).toEqual(['2028-02-22', '2028-02-29', '2028-03-07']);
  });

  it('crosses a year boundary', () => {
    const dates = generateRaceDates({
      startDate: '2026-12-22',
      intervalDays: 7,
      count: 3,
    });
    expect(dates).toEqual(['2026-12-22', '2026-12-29', '2027-01-05']);
  });

  it('returns empty when the until date precedes the start', () => {
    expect(
      generateRaceDates({
        startDate: '2026-05-05',
        intervalDays: 7,
        untilDate: '2026-04-01',
      }),
    ).toEqual([]);
  });

  it('returns empty for a non-positive count', () => {
    expect(
      generateRaceDates({ startDate: '2026-05-05', intervalDays: 7, count: 0 }),
    ).toEqual([]);
  });

  it('returns empty for an unparseable start date', () => {
    expect(
      generateRaceDates({ startDate: 'not-a-date', intervalDays: 7, count: 3 }),
    ).toEqual([]);
    expect(
      generateRaceDates({ startDate: '2026-02-30', intervalDays: 7, count: 3 }),
    ).toEqual([]);
  });

  it('returns empty for a non-positive interval', () => {
    expect(
      generateRaceDates({ startDate: '2026-05-05', intervalDays: 0, count: 3 }),
    ).toEqual([]);
  });

  it('clamps a count to the default cap', () => {
    const dates = generateRaceDates({
      startDate: '2026-01-06',
      intervalDays: 7,
      count: 500,
    });
    expect(dates).toHaveLength(MAX_GENERATED_RACES);
  });

  it('clamps an until-date run to a supplied cap', () => {
    const dates = generateRaceDates({
      startDate: '2026-01-06',
      intervalDays: 7,
      untilDate: '2030-01-01',
      maxRaces: 10,
    });
    expect(dates).toHaveLength(10);
  });
});

describe('generateRaceSchedule', () => {
  it('puts the same number of races on each day, counting days', () => {
    expect(
      generateRaceSchedule({ startDate: '2026-11-08', intervalDays: 7, count: 4, racesPerDay: 3 }),
    ).toEqual([
      { date: '2026-11-08', races: 3 },
      { date: '2026-11-15', races: 3 },
      { date: '2026-11-22', races: 3 },
      { date: '2026-11-29', races: 3 },
    ]);
  });

  it('runs a regatta on consecutive days', () => {
    expect(
      generateRaceSchedule({
        startDate: '2026-08-23',
        intervalDays: 1,
        untilDate: '2026-08-26',
        racesPerDay: 2,
      }),
    ).toEqual([
      { date: '2026-08-23', races: 2 },
      { date: '2026-08-24', races: 2 },
      { date: '2026-08-25', races: 2 },
      { date: '2026-08-26', races: 2 },
    ]);
  });

  it('is one race a day when racesPerDay is 1, matching generateRaceDates', () => {
    const opts = { startDate: '2026-05-05', intervalDays: 14, untilDate: '2026-06-16' };
    expect(generateRaceSchedule({ ...opts, racesPerDay: 1 }).map((d) => d.date)).toEqual(
      generateRaceDates(opts),
    );
  });

  it('applies the cap to races, keeping every day whole', () => {
    const days = generateRaceSchedule({
      startDate: '2026-01-04',
      intervalDays: 7,
      count: 1000,
      racesPerDay: 7,
    });
    expect(days).toHaveLength(Math.floor(MAX_GENERATED_RACES / 7));
    expect(days.every((d) => d.races === 7)).toBe(true);
  });

  it('honours an explicit cap', () => {
    expect(
      generateRaceSchedule({
        startDate: '2026-01-04',
        intervalDays: 7,
        count: 10,
        racesPerDay: 3,
        maxRaces: 7,
      }),
    ).toHaveLength(2);
  });

  it('returns nothing for a races-per-day out of range', () => {
    const base = { startDate: '2026-05-05', intervalDays: 7, count: 4 };
    expect(generateRaceSchedule({ ...base, racesPerDay: 0 })).toEqual([]);
    expect(generateRaceSchedule({ ...base, racesPerDay: Number.NaN })).toEqual([]);
    expect(generateRaceSchedule({ ...base, racesPerDay: MAX_RACES_PER_DAY + 1 })).toEqual([]);
  });

  it('returns nothing when the dates themselves are invalid', () => {
    expect(
      generateRaceSchedule({ startDate: 'nope', intervalDays: 7, count: 4, racesPerDay: 2 }),
    ).toEqual([]);
  });
});

describe('todayIsoDate', () => {
  it('reads the local calendar, not the UTC one', () => {
    // 00:30 on 1 June in a zone an hour ahead of UTC is still 31 May in UTC —
    // the bug that dated small-hours races to yesterday.
    const local = new Date(2026, 5, 1, 0, 30);
    expect(todayIsoDate(local)).toBe('2026-06-01');
  });

  it('pads a single-digit month and day', () => {
    expect(todayIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('defaultRaceDate', () => {
  it('uses the last dated race in the series', () => {
    expect(
      defaultRaceDate({
        existingDates: ['2026-05-05', '2026-05-12'],
        startDate: '2026-05-01',
        endDate: '2026-08-31',
        today: '2026-06-20',
      }),
    ).toBe('2026-05-12');
  });

  it('skips undated races to find the last real date', () => {
    expect(
      defaultRaceDate({ existingDates: ['2026-05-05', '', null], today: '2026-06-20' }),
    ).toBe('2026-05-05');
  });

  it('clamps today back to the start date of a future series', () => {
    expect(
      defaultRaceDate({ startDate: '2026-07-01', endDate: '2026-07-08', today: '2026-06-20' }),
    ).toBe('2026-07-01');
  });

  it('clamps today forward to the end date of a finished series', () => {
    expect(
      defaultRaceDate({ startDate: '2026-06-01', endDate: '2026-06-10', today: '2026-06-20' }),
    ).toBe('2026-06-10');
  });

  it('clamps to the start date of a single-day series with no end date', () => {
    expect(defaultRaceDate({ startDate: '2026-07-01', endDate: '', today: '2026-06-20' })).toBe(
      '2026-07-01',
    );
  });

  it('keeps today when it falls inside the series window', () => {
    expect(
      defaultRaceDate({ startDate: '2026-06-01', endDate: '2026-08-31', today: '2026-06-20' }),
    ).toBe('2026-06-20');
  });

  it('falls back to today when the series has no usable dates', () => {
    expect(defaultRaceDate({ startDate: '', endDate: 'not-a-date', today: '2026-06-20' })).toBe(
      '2026-06-20',
    );
  });

  it('defaults to today when nothing at all is known', () => {
    expect(defaultRaceDate({})).toBe(todayIsoDate());
  });
});
