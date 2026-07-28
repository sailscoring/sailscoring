import { describe, it, expect } from 'vitest';

import {
  buildTreeNav,
  folderSegmentOf,
  injectAfterBodyTag,
  leafLabel,
  orderTopFolders,
  pagesInFolder,
  renderTreeNav,
  rootPages,
  slugFolders,
  type TreePage,
} from '@/lib/published-tree';

// The publication tree (ADR-011): folders derived from the (slug, subPath)
// data publications already carry, and the navigation cascade rendered from
// them. Route wiring is covered by e2e/publishing.spec.ts.

// The archive shape: a year slug shared by several series, each publishing
// event/class pages beneath it.
const archivePages: TreePage[] = [
  { fleetName: 'Class 1 IRC', subPath: 'autumn-league/class-1-irc', ownerName: 'Autumn League 2025' },
  { fleetName: 'Class 2 IRC', subPath: 'autumn-league/class-2-irc', ownerName: 'Autumn League 2025' },
  { fleetName: 'Optimist', subPath: 'dinghy-regatta/optimist', ownerName: 'Dinghy Regatta 2025' },
];

// A live sub-series publication: block pages carry their sub-series name.
const blockPages: TreePage[] = [
  { fleetName: 'Squibs', subSeriesName: 'Spring', subPath: 'spring/squibs', ownerName: 'Club Series' },
  { fleetName: 'Puppeteers', subSeriesName: 'Spring', subPath: 'spring/puppeteers', ownerName: 'Club Series' },
  { fleetName: 'Squibs', subSeriesName: 'Summer', subPath: 'summer/squibs', ownerName: 'Club Series' },
];

describe('tree derivation', () => {
  it('splits folder segments from sub-paths', () => {
    expect(folderSegmentOf('autumn-league/class-1')).toBe('autumn-league');
    expect(folderSegmentOf('standings')).toBeNull();
  });

  it('derives folders in first-appearance order, humanising archive segments', () => {
    expect(slugFolders(archivePages)).toEqual([
      { segment: 'autumn-league', label: 'Autumn League' },
      { segment: 'dinghy-regatta', label: 'Dinghy Regatta' },
    ]);
  });

  it('labels a folder by its block name when the pages agree on one', () => {
    expect(slugFolders(blockPages)).toEqual([
      { segment: 'spring', label: 'Spring' },
      { segment: 'summer', label: 'Summer' },
    ]);
  });

  it('partitions root pages from folder pages', () => {
    const mixed: TreePage[] = [
      { fleetName: 'Default', subPath: 'summer-regatta' },
      { fleetName: 'Gold Fleet', subPath: 'gp14-munsters/gold-fleet' },
    ];
    expect(rootPages(mixed).map((p) => p.subPath)).toEqual(['summer-regatta']);
    expect(pagesInFolder(mixed, 'gp14-munsters').map((p) => p.subPath)).toEqual([
      'gp14-munsters/gold-fleet',
    ]);
  });
});

describe('leafLabel', () => {
  it('keeps the prize sheet name and block-free fleet names', () => {
    const pages: TreePage[] = [
      { fleetName: 'IRC', subPath: 'irc' },
      { fleetName: 'Cruiser', subPath: 'cruiser' },
      { fleetName: 'Prizes', isPrizes: true, subPath: 'prizes' },
    ];
    expect(leafLabel(pages[0], pages, true)).toBe('IRC');
    expect(leafLabel(pages[2], pages, true)).toBe('Prizes');
  });

  it('reads a lone named fleet as "Standings" too, prizes aside', () => {
    // Mirrors the series-index rule: a sole contributor's only results page
    // is the standings, whatever its fleet is called.
    const pages: TreePage[] = [
      { fleetName: 'IRC', subPath: 'irc' },
      { fleetName: 'Prizes', isPrizes: true, subPath: 'prizes' },
    ];
    expect(leafLabel(pages[0], pages, true)).toBe('Standings');
  });

  it('reads a sole contributor\'s lone results page as "Standings"', () => {
    const pages: TreePage[] = [
      { fleetName: 'Default', subPath: 'standings' },
      { fleetName: 'Prizes', isPrizes: true, subPath: 'prizes' },
    ];
    expect(leafLabel(pages[0], pages, true)).toBe('Standings');
  });

  it('names a shared-slug synthetic Default page after its series', () => {
    const pages: TreePage[] = [
      { fleetName: 'Default', subPath: 'standings', ownerName: 'Lambay Races Cruisers' },
      { fleetName: 'Default', subPath: 'one-designs', ownerName: 'Lambay Races One Designs' },
    ];
    expect(leafLabel(pages[0], pages, false)).toBe('Lambay Races Cruisers');
    expect(leafLabel(pages[1], pages, false)).toBe('Lambay Races One Designs');
  });

  it('disambiguates same-named fleets from different series', () => {
    const pages: TreePage[] = [
      { fleetName: 'IRC', subPath: 'irc', ownerName: 'Spring League' },
      { fleetName: 'IRC', subPath: 'irc-2', ownerName: 'Summer League' },
    ];
    expect(leafLabel(pages[0], pages, false)).toBe('Spring League — IRC');
  });

  it('never prefixes block names — the folder level carries them', () => {
    const siblings = pagesInFolder(blockPages, 'spring');
    expect(leafLabel(siblings[0], siblings, true)).toBe('Squibs');
  });
});

describe('orderTopFolders', () => {
  it('sorts season-like slugs newest first', () => {
    const ordered = orderTopFolders([
      { slug: '2023', label: '2023' },
      { slug: '2025', label: '2025' },
      { slug: '2024', label: '2024' },
    ]);
    expect(ordered.map((f) => f.slug)).toEqual(['2025', '2024', '2023']);
  });

  it('understands year-spanning season slugs', () => {
    const ordered = orderTopFolders([
      { slug: '2025', label: '2025' },
      { slug: '2025-26', label: '2025–26' },
    ]);
    expect(ordered.map((f) => f.slug)).toEqual(['2025-26', '2025']);
  });

  it('keeps publish order when any slug is not season-like', () => {
    const given = [
      { slug: '2026-westerns', label: '2026 Westerns' },
      { slug: '2025', label: '2025' },
    ];
    expect(orderTopFolders(given)).toEqual(given);
  });
});

const topFolders = [
  { slug: '2025', label: '2025' },
  { slug: '2024', label: '2024' },
];

describe('buildTreeNav', () => {
  it('series index: top select plus a jump select over the slug children', () => {
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'hyc',
      topFolders,
      currentSlug: '2025',
      pages: archivePages,
      soleContributor: false,
    });
    expect(leaf).toBeNull();
    expect(selects).toHaveLength(2);
    expect(selects[0].options).toEqual([
      { label: '2025', href: '/p/hyc/2025', current: true },
      { label: '2024', href: '/p/hyc/2024', current: false },
    ]);
    expect(selects[1].placeholder).toBe('Go to results…');
    expect(selects[1].options.map((o) => o.href)).toEqual([
      '/p/hyc/2025/autumn-league',
      '/p/hyc/2025/dinghy-regatta',
    ]);
  });

  it('folder index: the folder select marks the current folder, no leaf', () => {
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'hyc',
      topFolders,
      currentSlug: '2025',
      pages: archivePages,
      soleContributor: false,
      currentFolder: 'autumn-league',
    });
    expect(leaf).toBeNull();
    expect(selects[1].options.find((o) => o.current)?.href).toBe(
      '/p/hyc/2025/autumn-league',
    );
  });

  it('fleet page in a folder: ancestor selects plus sibling-page leaf', () => {
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'hyc',
      topFolders,
      currentSlug: '2025',
      pages: archivePages,
      soleContributor: false,
      currentFolder: 'autumn-league',
      currentSubPath: 'autumn-league/class-2-irc',
    });
    expect(selects).toHaveLength(2);
    expect(leaf?.options).toEqual([
      {
        label: 'Class 1 IRC',
        href: '/p/hyc/2025/autumn-league/class-1-irc',
        current: false,
      },
      {
        label: 'Class 2 IRC',
        href: '/p/hyc/2025/autumn-league/class-2-irc',
        current: true,
      },
    ]);
  });

  it('root-level page: the slug children are the sibling set', () => {
    const pages: TreePage[] = [
      { fleetName: 'Default', subPath: 'standings', ownerName: 'Cruisers' },
      { fleetName: 'Default', subPath: 'one-designs', ownerName: 'One Designs' },
    ];
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'm15',
      topFolders: [{ slug: '2026-lambay-races', label: '2026 Lambay Races' }],
      currentSlug: '2026-lambay-races',
      pages,
      soleContributor: false,
      currentSubPath: 'standings',
    });
    // One top folder → the top select is degenerate and dropped.
    expect(selects).toHaveLength(0);
    expect(leaf?.options).toEqual([
      { label: 'Cruisers', href: '/p/m15/2026-lambay-races/standings', current: true },
      { label: 'One Designs', href: '/p/m15/2026-lambay-races/one-designs', current: false },
    ]);
  });

  it('drops every degenerate level', () => {
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'm15',
      topFolders: [{ slug: 'a', label: 'A' }],
      currentSlug: 'a',
      pages: [{ fleetName: 'Default', subPath: 'standings' }],
      soleContributor: true,
      currentSubPath: 'standings',
    });
    expect(selects).toHaveLength(0);
    expect(leaf).toBeNull();
  });
});

describe('renderTreeNav', () => {
  const position = {
    workspaceSlug: 'hyc',
    topFolders,
    currentSlug: '2025',
    pages: archivePages,
    soleContributor: false,
    currentFolder: 'autumn-league',
    currentSubPath: 'autumn-league/class-2-irc',
  };

  it('renders ancestor selects and few sibling pages as inline links', () => {
    const html = renderTreeNav(position, 'float');
    expect(html).toContain('sstreenav-float');
    expect(html).toContain('<option value="/p/hyc/2025" selected>2025</option>');
    expect(html).toContain(
      '<option value="/p/hyc/2025/autumn-league" selected>Autumn League</option>',
    );
    expect(html).toContain('href="/p/hyc/2025/autumn-league/class-1-irc"');
    expect(html).toContain('<span class="sstreenav-current">Class 2 IRC</span>');
  });

  it('switches the leaf to a select beyond four sibling pages', () => {
    const many: TreePage[] = [1, 2, 3, 4, 5].map((n) => ({
      fleetName: `Class ${n}`,
      subPath: `autumn-league/class-${n}`,
    }));
    const html = renderTreeNav(
      { ...position, pages: many, currentSubPath: 'autumn-league/class-4' },
      'float',
    );
    expect(html).toContain(
      '<option value="/p/hyc/2025/autumn-league/class-4" selected>Class 4</option>',
    );
    expect(html).not.toContain('<span class="sstreenav-current"');
  });

  it('renders nothing when every level is degenerate', () => {
    expect(
      renderTreeNav(
        {
          workspaceSlug: 'm15',
          topFolders: [{ slug: 'a', label: 'A' }],
          currentSlug: 'a',
          pages: [{ fleetName: 'Default', subPath: 'standings' }],
          soleContributor: true,
          currentSubPath: 'standings',
        },
        'float',
      ),
    ).toBe('');
  });

  it('escapes labels and hides from print', () => {
    const html = renderTreeNav(
      {
        ...position,
        pages: [
          { fleetName: 'A & B <Cruisers>', subPath: 'autumn-league/a-b' },
          { fleetName: 'Other', subPath: 'autumn-league/other' },
        ],
        currentSubPath: 'autumn-league/other',
      },
      'float',
    );
    expect(html).toContain('A &amp; B &lt;Cruisers&gt;');
    expect(html).not.toContain('<Cruisers>');
    expect(html).toContain('@media print { .sstreenav { display: none; } }');
  });
});

describe('injectAfterBodyTag', () => {
  it('inserts the fragment right after the opening body tag', () => {
    const html = '<html><body class="x"><p>hi</p></body></html>';
    expect(injectAfterBodyTag(html, '<nav/>')).toBe(
      '<html><body class="x"><nav/><p>hi</p></body></html>',
    );
  });

  it('leaves a document without a body tag unchanged', () => {
    expect(injectAfterBodyTag('<p>bare</p>', '<nav/>')).toBe('<p>bare</p>');
  });
});
