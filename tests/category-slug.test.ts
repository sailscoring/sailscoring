import { describe, expect, test } from 'vitest';

import {
  categorySlugBase,
  formerSlugsAfterRename,
  uniqueCategorySlug,
} from '@/lib/category-slug';

describe('categorySlugBase', () => {
  test('kebab-cases the name', () => {
    expect(categorySlugBase('Cork Week')).toBe('cork-week');
    expect(categorySlugBase('  Open Events & Regattas ')).toBe('open-events-regattas');
    expect(categorySlugBase('2025–26')).toBe('2025-26');
  });

  test('a name with nothing sluggable reads as "category"', () => {
    expect(categorySlugBase('—')).toBe('category');
  });

  test('never yields the reserved "-" segment or an edge hyphen', () => {
    for (const name of ['-', '--x--', 'É']) {
      const slug = categorySlugBase(name);
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe('uniqueCategorySlug', () => {
  test('keeps a free slug, suffixes a taken one', () => {
    expect(uniqueCategorySlug('cork-week', new Set())).toBe('cork-week');
    expect(uniqueCategorySlug('cork-week', new Set(['cork-week']))).toBe('cork-week-2');
    expect(
      uniqueCategorySlug('cork-week', new Set(['cork-week', 'cork-week-2'])),
    ).toBe('cork-week-3');
  });
});

describe('formerSlugsAfterRename', () => {
  test('appends the old slug when the slug changes', () => {
    expect(formerSlugsAfterRename([], 'a', 'b')).toEqual(['a']);
    expect(formerSlugsAfterRename(['x'], 'a', 'b')).toEqual(['x', 'a']);
  });

  test('an unchanged slug changes nothing', () => {
    expect(formerSlugsAfterRename(['x'], 'a', 'a')).toEqual(['x']);
  });

  test('renaming back to a former slug drops it from the list', () => {
    expect(formerSlugsAfterRename(['a'], 'b', 'a')).toEqual(['b']);
  });
});
