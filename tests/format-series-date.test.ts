/**
 * `formatSeriesDate` — a series date at whatever precision it is known to
 * (#629).
 *
 * An archived event often states a year and nothing finer, and sometimes a
 * month. A full day is shown exactly as stored, which is what the app has
 * always done; the coarser forms are spelled out, since "2023-11" reads like
 * a truncated date rather than a deliberate one.
 */
import { describe, expect, it } from 'vitest';

import { formatSeriesDate } from '@/lib/format-date';

describe('formatSeriesDate', () => {
  it('spells out a month-precision date', () => {
    expect(formatSeriesDate('2023-11')).toBe('November 2023');
    expect(formatSeriesDate('2026-01')).toBe('January 2026');
  });

  it('leaves a year alone — there is nothing to spell out', () => {
    expect(formatSeriesDate('2023')).toBe('2023');
  });

  it('leaves a full day exactly as stored', () => {
    expect(formatSeriesDate('2026-05-05')).toBe('2026-05-05');
  });

  it('says nothing when the archive knows nothing', () => {
    expect(formatSeriesDate(undefined)).toBe('');
    expect(formatSeriesDate('')).toBe('');
  });
});
