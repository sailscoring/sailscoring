import { describe, it, expect } from 'vitest';

import { generateRaceDates, MAX_GENERATED_RACES } from '@/lib/race-schedule';

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
