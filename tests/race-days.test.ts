import { describe, expect, it } from 'vitest';
import { formatRaceDay, raceDayHeadings, UNDATED_RACE_DAY } from '@/lib/race-days';

const races = (...dates: string[]) => dates.map((date) => ({ date }));

describe('formatRaceDay', () => {
  it('names the weekday, day and month', () => {
    expect(formatRaceDay('2026-04-18', false)).toBe('Sat 18 Apr');
    expect(formatRaceDay('2026-11-01', false)).toBe('Sun 1 Nov');
  });

  it('adds the year on request', () => {
    expect(formatRaceDay('2025-12-06', true)).toBe('Sat 6 Dec 2025');
  });

  it('refuses what is not a calendar date', () => {
    expect(formatRaceDay('', false)).toBeNull();
    expect(formatRaceDay('2026-02-30', false)).toBeNull();
    expect(formatRaceDay('18/04/2026', false)).toBeNull();
  });
});

describe('raceDayHeadings', () => {
  it('heads each run of races on the same day', () => {
    expect(raceDayHeadings(races('2026-04-05', '2026-04-18', '2026-04-18', '2026-04-25'))).toEqual([
      'Sun 5 Apr',
      'Sat 18 Apr',
      null,
      'Sat 25 Apr',
    ]);
  });

  it('keeps race order, so a day split by a moved race gets two headings', () => {
    expect(raceDayHeadings(races('2026-04-18', '2026-04-25', '2026-04-18'))).toEqual([
      'Sat 18 Apr',
      'Sat 25 Apr',
      'Sat 18 Apr',
    ]);
  });

  it('gathers undated races under their own heading', () => {
    expect(raceDayHeadings(races('2026-05-16', '', ''))).toEqual(['Sat 16 May', UNDATED_RACE_DAY, null]);
  });

  it('shows no headings when no race is dated', () => {
    expect(raceDayHeadings(races('', ''))).toEqual([null, null]);
    expect(raceDayHeadings([])).toEqual([]);
  });

  it('adds the year when the races span more than one', () => {
    expect(raceDayHeadings(races('2025-12-06', '2026-01-03'))).toEqual([
      'Sat 6 Dec 2025',
      'Sat 3 Jan 2026',
    ]);
  });
});
