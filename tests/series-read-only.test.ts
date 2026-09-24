import { describe, expect, it } from 'vitest';
import { isSeriesReadOnly } from '@/lib/series-read-only';

describe('isSeriesReadOnly', () => {
  it('is false for an ordinary provisional series', () => {
    expect(isSeriesReadOnly({})).toBe(false);
    expect(isSeriesReadOnly({ resultsStatus: 'provisional', archived: false })).toBe(false);
  });

  it('is true for each read-only state', () => {
    expect(isSeriesReadOnly({ archived: true })).toBe(true);
    expect(isSeriesReadOnly({ asPublished: true })).toBe(true);
    expect(isSeriesReadOnly({ resultsStatus: 'final' })).toBe(true);
  });
});
