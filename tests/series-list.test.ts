import { describe, expect, test } from 'vitest';

import {
  groupActiveByCategory,
  groupArchivedByYear,
  seriesEventYear,
} from '@/lib/series-list';
import type { Category, Series } from '@/lib/types';

// The grouping helpers only read id / name / categoryId / startDate, so the
// fixtures stay minimal and cast through `unknown`.
function s(partial: Partial<Series> & { id: string }): Series {
  return { name: partial.id, startDate: '', categoryId: null, ...partial } as unknown as Series;
}
function cat(id: string, displayOrder: number, name = id): Category {
  return { id, name, displayOrder };
}

describe('seriesEventYear', () => {
  test('parses the year from an ISO start date', () => {
    expect(seriesEventYear(s({ id: 'a', startDate: '2025-06-14' }))).toBe(2025);
  });
  test('returns null when the start date is empty or unparseable', () => {
    expect(seriesEventYear(s({ id: 'a', startDate: '' }))).toBeNull();
    expect(seriesEventYear(s({ id: 'a', startDate: 'TBC' }))).toBeNull();
  });
});

describe('groupActiveByCategory', () => {
  test('orders by category displayOrder, Uncategorized last, only non-empty', () => {
    const cats = [
      cat('spring', 1, 'Spring'),
      cat('autumn', 0, 'Autumn'),
      cat('empty', 2, 'Empty'),
    ];
    const series = [
      s({ id: '1', categoryId: 'spring' }),
      s({ id: '2', categoryId: null }),
      s({ id: '3', categoryId: 'autumn' }),
    ];
    const groups = groupActiveByCategory(series, cats);
    // Autumn (order 0) before Spring (order 1); Empty omitted; Uncategorized last.
    expect(groups.map((g) => g.category?.name ?? 'Uncategorized')).toEqual([
      'Autumn',
      'Spring',
      'Uncategorized',
    ]);
  });

  test('an unknown category id falls into Uncategorized', () => {
    const groups = groupActiveByCategory([s({ id: '1', categoryId: 'ghost' })], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBeNull();
    expect(groups[0].series.map((x) => x.id)).toEqual(['1']);
  });

  test('preserves input order within a group', () => {
    const groups = groupActiveByCategory([s({ id: 'b' }), s({ id: 'a' })], []);
    expect(groups[0].series.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('groupArchivedByYear', () => {
  test('years descend, Undated last, within-year sorted by start date desc', () => {
    const series = [
      s({ id: 'y2024', startDate: '2024-05-01' }),
      s({ id: 'y2025a', startDate: '2025-03-01' }),
      s({ id: 'y2025b', startDate: '2025-09-01' }),
      s({ id: 'undated', startDate: '' }),
    ];
    const groups = groupArchivedByYear(series);
    expect(groups.map((g) => g.year)).toEqual([2025, 2024, null]);
    expect(groups[0].series.map((x) => x.id)).toEqual(['y2025b', 'y2025a']);
    expect(groups[2].series.map((x) => x.id)).toEqual(['undated']);
  });
});
