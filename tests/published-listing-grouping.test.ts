import { describe, expect, it } from 'vitest';

import {
  groupWorkspaceListing,
  renderWorkspaceIndexHtml,
  type WorkspaceIndexItem,
} from '@/lib/published-index';

/**
 * Public workspace-listing grouping (#154/#171 surfaced publicly). Active
 * publications mirror the in-app category sections and manual order; archived
 * ones are relegated to "Past results" year sections. Placement comes from each
 * slug's representative series (see `listPublishedByWorkspace`).
 */

function item(p: Partial<WorkspaceIndexItem> & { slug: string }): WorkspaceIndexItem {
  return {
    title: p.slug,
    publishedAt: 1_700_000_000_000,
    fleetCount: 1,
    ...p,
  };
}

describe('groupWorkspaceListing', () => {
  it('orders active sections by category displayOrder, Uncategorized last', () => {
    const { active, past } = groupWorkspaceListing([
      item({ slug: 'plain' }), // uncategorised
      item({ slug: 'cruisers', categoryName: 'Cruisers', categoryOrder: 1 }),
      item({ slug: 'dinghies', categoryName: 'Dinghies', categoryOrder: 0 }),
    ]);
    expect(past).toEqual([]);
    expect(active.map((g) => g.categoryName)).toEqual([
      'Dinghies',
      'Cruisers',
      null,
    ]);
  });

  it('orders within a section by the manual series order, newest first as tiebreak', () => {
    const { active } = groupWorkspaceListing([
      item({ slug: 'b', categoryName: 'C', categoryOrder: 0, seriesOrder: 2 }),
      item({ slug: 'a', categoryName: 'C', categoryOrder: 0, seriesOrder: 1 }),
      item({ slug: 'c', categoryName: 'C', categoryOrder: 0, seriesOrder: 1, publishedAt: 9_000_000_000_000 }),
    ]);
    // seriesOrder 1 before 2; within seriesOrder 1, the newer publishedAt wins.
    expect(active[0].items.map((i) => i.slug)).toEqual(['c', 'a', 'b']);
  });

  it('relegates archived publications to year sections, newest year first', () => {
    const { active, past } = groupWorkspaceListing([
      item({ slug: 'active-one' }),
      item({ slug: 'old-2024', archived: true, year: 2024 }),
      item({ slug: 'old-2025', archived: true, year: 2025 }),
      item({ slug: 'old-undated', archived: true, year: null }),
    ]);
    expect(active.map((g) => g.categoryName)).toEqual([null]);
    expect(past.map((g) => g.year)).toEqual([2025, 2024, null]);
  });

  it('treats an orphaned/bare item as an active uncategorised entry', () => {
    const { active, past } = groupWorkspaceListing([item({ slug: 'orphan' })]);
    expect(past).toEqual([]);
    expect(active).toHaveLength(1);
    expect(active[0].categoryName).toBeNull();
  });
});

describe('renderWorkspaceIndexHtml sections', () => {
  it('renders a flat list with no section headings when uncategorised and nothing archived', () => {
    const html = renderWorkspaceIndexHtml('hyc', 'Howth', [
      item({ slug: 'spring', title: 'Spring' }),
    ]);
    expect(html).toContain('Spring');
    expect(html).not.toContain('class="section"');
    expect(html).not.toContain('Uncategorized');
  });

  it('renders category headings and a Past results section when present', () => {
    const html = renderWorkspaceIndexHtml('hyc', 'Howth', [
      item({ slug: 'cr', title: 'Cruisers Series', categoryName: 'Cruisers', categoryOrder: 0 }),
      item({ slug: 'plain', title: 'Loose Series' }),
      item({ slug: 'old', title: 'Old Series', archived: true, year: 2024 }),
    ]);
    expect(html).toContain('class="section"');
    expect(html).toContain('Cruisers');
    expect(html).toContain('Uncategorized');
    expect(html).toContain('Past results');
    expect(html).toContain('2024');
    // Active sections come before the relegated Past results block.
    expect(html.indexOf('Cruisers Series')).toBeLessThan(html.indexOf('Past results'));
    expect(html.indexOf('Old Series')).toBeGreaterThan(html.indexOf('Past results'));
  });
});
