import { describe, expect, test } from 'vitest';

import {
  categoryPagePath,
  positionCategoryLink,
  renderCategoryIndexHtml,
  resolveCategorySegment,
  type PublishedCategory,
} from '@/lib/published-category';
import type { IndexEvent } from '@/lib/published-index';

function cat(partial: Partial<PublishedCategory> & { id: string; name: string }): PublishedCategory {
  return {
    slug: partial.name.toLowerCase().replace(/ /g, '-'),
    formerSlugs: [],
    displayOrder: 0,
    publishedCount: 2,
    ...partial,
  };
}

const corkWeek = cat({ id: 'cw', name: 'Cork Week', formerSlugs: ['cork-regatta'] });
const club = cat({ id: 'club', name: 'Club Racing' });

describe('resolveCategorySegment', () => {
  test('finds a category by its slug', () => {
    expect(resolveCategorySegment([corkWeek, club], 'cork-week')).toEqual({
      category: corkWeek,
      former: false,
    });
  });

  test('a former slug resolves for a redirect', () => {
    expect(resolveCategorySegment([corkWeek], 'cork-regatta')).toEqual({
      category: corkWeek,
      former: true,
    });
  });

  test("a current slug wins over another category's former one", () => {
    const taken = cat({ id: 'new', name: 'Cork Regatta' });
    expect(resolveCategorySegment([corkWeek, taken], 'cork-regatta')?.category).toBe(taken);
  });

  test('anything else resolves to nothing', () => {
    expect(resolveCategorySegment([corkWeek], 'nope')).toBeNull();
  });
});

describe('positionCategoryLink', () => {
  const base = {
    workspaceSlug: 'rcyc',
    categories: [corkWeek, club],
    seasonLabels: ['2024', '2026'],
  };
  const link = { label: 'All Cork Week results', href: '/p/rcyc/-/cork-week' };

  test('an event slug whose series share a category links it', () => {
    expect(
      positionCategoryLink({
        ...base,
        members: [
          { categoryId: 'cw', pages: [{ subPath: 'irc-0' }] },
          { categoryId: 'cw', pages: [{ subPath: 'irc-1' }] },
        ],
      }),
    ).toEqual(link);
  });

  test('a season slug of many categories links nothing at its root…', () => {
    const members = [
      { categoryId: 'cw', pages: [{ subPath: 'cork-week/irc-0' }] },
      { categoryId: 'club', pages: [{ subPath: 'tuesdays/standings' }] },
    ];
    expect(positionCategoryLink({ ...base, members })).toBeNull();
    // …but its event folder, and a page inside it, link the event's category.
    expect(positionCategoryLink({ ...base, members, currentFolder: 'cork-week' })).toEqual(link);
  });

  test('a root page links the category of the series it belongs to', () => {
    const members = [
      { categoryId: 'cw', pages: [{ subPath: 'cork-week' }] },
      { categoryId: 'club', pages: [{ subPath: 'tuesdays' }] },
    ];
    expect(positionCategoryLink({ ...base, members, currentSubPath: 'tuesdays' })).toEqual({
      label: 'All Club Racing results',
      href: '/p/rcyc/-/club-racing',
    });
  });

  test('uncategorised, single-publication and year-named categories link nothing', () => {
    expect(
      positionCategoryLink({ ...base, members: [{ categoryId: null, pages: [] }] }),
    ).toBeNull();
    expect(
      positionCategoryLink({
        ...base,
        categories: [{ ...corkWeek, publishedCount: 1 }],
        members: [{ categoryId: 'cw', pages: [] }],
      }),
    ).toBeNull();
    expect(
      positionCategoryLink({
        ...base,
        categories: [cat({ id: 'y', name: '2024' })],
        members: [{ categoryId: 'y', pages: [] }],
      }),
    ).toBeNull();
  });
});

describe('renderCategoryIndexHtml', () => {
  function event(season: string, label: string): IndexEvent {
    return {
      key: label,
      label,
      href: `/p/rcyc/${season}/cork-week`,
      pages: [{ label: 'IRC 0', href: `/p/rcyc/${season}/cork-week/irc-0` }],
      categoryName: 'Cork Week',
      season,
      publishedAt: 0,
    };
  }

  test('one heading per season, newest first, every event row linked', () => {
    const html = renderCategoryIndexHtml({
      workspaceSlug: 'rcyc',
      workspaceName: 'Royal Cork YC',
      categoryName: 'Cork Week',
      events: [event('2004', 'Cork Week 2004'), event('2026', 'Cork Week 2026')],
    });
    expect(html).toContain('<title>Cork Week results — Royal Cork YC</title>');
    expect(html.indexOf('>2026</h2>')).toBeLessThan(html.indexOf('>2004</h2>'));
    expect(html).toContain('href="/p/rcyc/2004/cork-week/irc-0"');
    expect(html).toContain('href="/p/rcyc"');
  });

  test('a single season needs no season heading', () => {
    const html = renderCategoryIndexHtml({
      workspaceSlug: 'rcyc',
      workspaceName: 'Royal Cork YC',
      categoryName: 'Cork Week',
      events: [event('2026', 'Cork Week 2026')],
    });
    expect(html).not.toContain('<h2');
  });
});

test('categoryPagePath sits under the reserved segment', () => {
  expect(categoryPagePath('rcyc', 'cork-week')).toBe('/p/rcyc/-/cork-week');
});
