import { describe, expect, it } from 'vitest';

import {
  groupWorkspaceListing,
  renderWorkspaceIndexHtml,
  type WorkspaceIndexItem,
} from '@/lib/published-index';

/**
 * Public workspace-listing grouping (the in-app series organisation surfaced
 * publicly). Active
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

  it('sorts null category and series orders last, like absent ones', () => {
    // The management page's rows cross /api/v1 as JSON, which can't carry the
    // Infinity sentinel — unset orders arrive as null and must still sort last.
    const { active } = groupWorkspaceListing([
      item({ slug: 'loose', categoryName: 'Fleet', categoryOrder: 0, seriesOrder: null }),
      item({ slug: 'first', categoryName: 'Fleet', categoryOrder: 0, seriesOrder: 1 }),
      item({ slug: 'tail', categoryName: 'Tail', categoryOrder: null }),
    ]);
    expect(active.map((g) => g.categoryName)).toEqual(['Fleet', 'Tail']);
    expect(active[0].items.map((i) => i.slug)).toEqual(['first', 'loose']);
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

  it('every season collapsible, the current one open, category headings within (ADR-011)', () => {
    const html = renderWorkspaceIndexHtml(
      'hyc',
      'Howth',
      [
        item({ slug: 'cr', title: 'Cruisers Series', categoryName: 'Cruisers', categoryOrder: 0, season: '2026' }),
        item({ slug: 'plain', title: 'Loose Series', season: '2026' }),
        item({ slug: 'old', title: 'Old Series', season: '2024' }),
      ],
      '',
      { currentSeason: '2026' },
    );
    expect(html).toContain('<details class="season" open data-open><summary>2026</summary>');
    expect(html).toContain('Cruisers');
    expect(html).toContain('Uncategorized');
    expect(html).toContain('<details class="season"><summary>2024</summary>');
    // The current season's items come before the collapsed prior season.
    expect(html.indexOf('Cruisers Series')).toBeLessThan(html.indexOf('<summary>2024'));
    expect(html.indexOf('Old Series')).toBeGreaterThan(html.indexOf('<summary>2024'));
  });

  it('suppresses a category heading that merely echoes its lone row', () => {
    // The event-family-as-category shape: most seasons hold one event per
    // family, and 'Leinsters' over a single 'Leinsters' row says nothing.
    const html = renderWorkspaceIndexHtml('iodai', 'IODAI', [
      item({
        slug: '2019',
        title: '2019',
        season: '2019',
        contributors: [
          {
            title: 'IODAI Leinsters 2019 — Main Fleet',
            categoryName: 'Leinsters',
            pages: [
              { fleetName: 'Senior', subPath: 'leinsters/senior' },
              { fleetName: 'Junior', subPath: 'leinsters/junior' },
            ],
          },
          {
            title: 'Irish Sailing Youth Nationals 2019',
            categoryName: 'Trials',
            pages: [{ fleetName: 'Standings', subPath: 'youth-nationals/standings' }],
          },
        ],
      }),
      item({ slug: '2018', title: '2018', season: '2018' }),
    ]);
    // 'Leinsters' echoes its lone row → suppressed; 'Trials' differs from
    // its row's label → kept.
    expect(html).not.toContain('>Leinsters</h3>');
    expect(html).toContain('<h3 class="cat">Trials</h3>');
  });

  it('suppresses a category heading that repeats its season label', () => {
    // The archive corpora file series under a category named after the year;
    // showing it under the season heading would say the same thing twice.
    const html = renderWorkspaceIndexHtml('dbsc', 'DBSC', [
      item({ slug: '2024', title: '2024', categoryName: '2024', categoryOrder: 0, season: '2024' }),
      item({ slug: '2023', title: '2023', categoryName: '2023', categoryOrder: 1, season: '2023' }),
    ]);
    expect(html).not.toContain('class="cat"');
    expect(html).toContain('<summary>2024</summary>');
    expect(html).toContain('<summary>2023</summary>');
  });
});
