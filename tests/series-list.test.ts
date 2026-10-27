import { describe, expect, test } from 'vitest';

import {
  groupActiveByCategory,
  groupArchivedByYear,
  seriesEventYear,
  seriesMatchesSearch,
} from '@/lib/series-list';
import type { Category, Series } from '@/lib/types';

// The helpers only read id / name / venue / categoryId / startDate, so the
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

describe('seriesMatchesSearch', () => {
  const cats = [cat('club', 0, 'Club Racing'), cat('open', 1, 'Open Events')];
  const autumn = s({
    id: 'a',
    name: 'Autumn League',
    venue: 'Howth',
    startDate: '2023-09-16',
    categoryId: 'club',
  });

  test('an empty or blank query matches everything', () => {
    expect(seriesMatchesSearch(autumn, '', cats)).toBe(true);
    expect(seriesMatchesSearch(autumn, '   ', cats)).toBe(true);
  });

  test('matches the name, venue, year, or category name, ignoring case', () => {
    expect(seriesMatchesSearch(autumn, 'autumn', cats)).toBe(true);
    expect(seriesMatchesSearch(autumn, 'HOWTH', cats)).toBe(true);
    expect(seriesMatchesSearch(autumn, '2023', cats)).toBe(true);
    expect(seriesMatchesSearch(autumn, 'club racing', cats)).toBe(true);
    expect(seriesMatchesSearch(autumn, 'lea', cats)).toBe(true);
  });

  test('every word must match, each in any field', () => {
    expect(seriesMatchesSearch(autumn, 'howth 2023', cats)).toBe(true);
    expect(seriesMatchesSearch(autumn, '  league   autumn ', cats)).toBe(true);
    expect(seriesMatchesSearch(autumn, 'howth 2022', cats)).toBe(false);
    expect(seriesMatchesSearch(autumn, 'autumn open', cats)).toBe(false);
  });

  test('does not match fields the series lacks', () => {
    const bare = s({ id: 'b', name: 'Frostbites', venue: '', startDate: '', categoryId: null });
    expect(seriesMatchesSearch(bare, 'frost', cats)).toBe(true);
    expect(seriesMatchesSearch(bare, 'uncategorized', cats)).toBe(false);
    expect(seriesMatchesSearch(bare, 'null', cats)).toBe(false);
  });

  test('a series in an unknown category matches on its other fields only', () => {
    const ghost = s({ id: 'g', name: 'Laser Open', categoryId: 'deleted' });
    expect(seriesMatchesSearch(ghost, 'laser', cats)).toBe(true);
    expect(seriesMatchesSearch(ghost, 'deleted', cats)).toBe(false);
  });
});
