import { describe, it, expect } from 'vitest';

import {
  buildTreeNav,
  folderSegmentOf,
  injectAfterBodyTag,
  leafLabel,
  pagesInFolder,
  renderFolderIndexHtml,
  renderSeasonIndexHtml,
  renderTreeNav,
  rootPages,
  sharedFolderSegment,
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

  it('finds the one folder a publication lives in, for the breadcrumb', () => {
    expect(
      sharedFolderSegment(['ilca-masters/ilca-7', 'ilca-masters/ilca-6']),
    ).toBe('ilca-masters');
    // Block series span folders; single-page publications may sit at root.
    expect(sharedFolderSegment(['winter/standings', 'spring/standings'])).toBeNull();
    expect(sharedFolderSegment(['standings'])).toBeNull();
    expect(sharedFolderSegment(['a/b', 'standings'])).toBeNull();
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
      { fleetName: 'IRC', subPath: 'irc', ownerSingle: true },
      { fleetName: 'Prizes', isPrizes: true, subPath: 'prizes', ownerSingle: true },
    ];
    expect(leafLabel(pages[0], pages, true)).toBe('Standings');
  });

  it('reads a sole contributor\'s lone results page as "Standings"', () => {
    const pages: TreePage[] = [
      { fleetName: 'Unknown', subPath: 'standings', ownerSingle: true },
      { fleetName: 'Prizes', isPrizes: true, subPath: 'prizes', ownerSingle: true },
    ];
    expect(leafLabel(pages[0], pages, true)).toBe('Standings');
  });

  it('reads a single-race event\'s lone page as "Results" (#347)', () => {
    const pages: TreePage[] = [
      { fleetName: 'Default', subPath: 'results', isRaceResults: true, ownerSingle: true },
    ];
    expect(leafLabel(pages[0], pages, true)).toBe('Results');
  });

  it('names a shared-slug synthetic single page after its series', () => {
    const pages: TreePage[] = [
      { fleetName: 'Unknown', subPath: 'standings', ownerName: 'Lambay Races Cruisers', ownerSingle: true },
      { fleetName: 'Default', subPath: 'one-designs', ownerName: 'Lambay Races One Designs', ownerSingle: true },
    ];
    expect(leafLabel(pages[0], pages, false)).toBe('Lambay Races Cruisers');
    expect(leafLabel(pages[1], pages, false)).toBe('Lambay Races One Designs');
  });

  it('keeps a meaningful lone-fleet name on a shared slug', () => {
    // The IODAI event shape: each contributing series publishes one page for
    // a real fleet — the fleet name reads better than the long series name.
    const pages: TreePage[] = [
      { fleetName: 'Regatta Racing', subPath: 'regatta-racing', ownerName: 'Munsters 2025 Regatta Racing', ownerSingle: true },
      { fleetName: 'Senior', subPath: 'senior', ownerName: 'Munsters 2025' },
      { fleetName: 'Junior', subPath: 'junior', ownerName: 'Munsters 2025' },
    ];
    expect(leafLabel(pages[0], pages, false)).toBe('Regatta Racing');
  });

  it('a shared fleet name yields to the series name alone', () => {
    // The every-class-in-one-folder shape: each series contributes one page
    // and they all carry the folder's own name as their fleet name — the
    // series is the whole signal, the fleet name pure repetition.
    const pages: TreePage[] = [
      { fleetName: 'Saturday Overall', subPath: 'sat/beneteau-211', ownerName: 'Beneteau 211 Echo (Sat) 2025' },
      { fleetName: 'Saturday Overall', subPath: 'sat/cruisers-1', ownerName: 'Cruisers 1 IRC 2025' },
    ];
    expect(leafLabel(pages[0], pages, false)).toBe('Beneteau 211 Echo (Sat) 2025');
    expect(leafLabel(pages[1], pages, false)).toBe('Cruisers 1 IRC 2025');
  });

  it('keeps the fleet-name suffix when a series has several pages in the set', () => {
    // Two series each publishing IRC + Cruiser pages: the series name alone
    // would collide with its own sibling, so the fleet name stays.
    const pages: TreePage[] = [
      { fleetName: 'IRC', subPath: 'irc', ownerName: 'Spring League' },
      { fleetName: 'Cruiser', subPath: 'cruiser', ownerName: 'Spring League' },
      { fleetName: 'IRC', subPath: 'irc-2', ownerName: 'Summer League' },
      { fleetName: 'Cruiser', subPath: 'cruiser-2', ownerName: 'Summer League' },
    ];
    expect(leafLabel(pages[0], pages, false)).toBe('Spring League — IRC');
    expect(leafLabel(pages[3], pages, false)).toBe('Summer League — Cruiser');
  });

  it('never prefixes block names — the folder level carries them', () => {
    const siblings = pagesInFolder(blockPages, 'spring');
    expect(leafLabel(siblings[0], siblings, true)).toBe('Squibs');
  });
});

/** The archive shape: one season per year, the year slug its own folder. */
const archiveSeasonTree = {
  seasons: [
    {
      label: '2025',
      segment: '2025',
      current: true,
      folders: [{ slug: '2025', label: '2025' }],
    },
    {
      label: '2024',
      segment: '2024',
      current: false,
      folders: [{ slug: '2024', label: '2024' }],
    },
  ],
  undated: [],
};

/** The live shape: per-event slugs grouped under a derived season. */
const liveSeasonTree = {
  seasons: [
    {
      label: '2026',
      segment: '2026',
      current: true,
      folders: [
        { slug: '2026-westerns', label: '2026 Westerns' },
        { slug: '2026-lambay-races', label: '2026 Lambay Races' },
      ],
    },
    {
      label: '2025',
      segment: '2025',
      current: false,
      folders: [{ slug: '2025-westerns', label: '2025 Westerns' }],
    },
  ],
  undated: [],
};

describe('buildTreeNav', () => {
  it('series index (archive shape): season menu plus a jump menu over the events', () => {
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'hyc',
      seasonTree: archiveSeasonTree,
      currentSlug: '2025',
      pages: archivePages,
      soleContributor: false,
    });
    expect(leaf).toBeNull();
    expect(selects).toHaveLength(2);
    expect(selects[0].aria).toBe('Season');
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

  it('legacy event slug: the season level leads, the slug sits at the event level', () => {
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'm15',
      seasonTree: liveSeasonTree,
      currentSlug: '2026-westerns',
      pages: [{ fleetName: 'Unknown', subPath: 'standings', ownerSingle: true }],
      soleContributor: true,
    });
    expect(leaf).toBeNull();
    expect(selects).toHaveLength(2);
    expect(selects[0].options.map((o) => o.href)).toEqual([
      '/p/m15/2026',
      '/p/m15/2025',
    ]);
    expect(selects[0].options[0].current).toBe(true);
    expect(selects[1].options).toEqual([
      { label: '2026 Westerns', href: '/p/m15/2026-westerns', current: true },
      { label: '2026 Lambay Races', href: '/p/m15/2026-lambay-races', current: false },
    ]);
  });

  it('season index: seasons plus a jump menu over the season\'s folders', () => {
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'm15',
      seasonTree: liveSeasonTree,
      currentSeason: '2026',
      pages: [],
      soleContributor: true,
    });
    expect(leaf).toBeNull();
    expect(selects).toHaveLength(2);
    expect(selects[0].options[0]).toEqual({
      label: '2026',
      href: '/p/m15/2026',
      current: true,
    });
    expect(selects[1].placeholder).toBe('Go to results…');
    expect(selects[1].options.map((o) => o.href)).toEqual([
      '/p/m15/2026-westerns',
      '/p/m15/2026-lambay-races',
    ]);
  });

  it('folder index: the folder menu marks the current folder, no leaf', () => {
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'hyc',
      seasonTree: archiveSeasonTree,
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

  it('fleet page in a folder: ancestor menus plus sibling-page leaf', () => {
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'hyc',
      seasonTree: archiveSeasonTree,
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
      { fleetName: 'Unknown', subPath: 'standings', ownerName: 'Cruisers', ownerSingle: true },
      { fleetName: 'Unknown', subPath: 'one-designs', ownerName: 'One Designs', ownerSingle: true },
    ];
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'm15',
      seasonTree: {
        seasons: [
          {
            label: '2026',
            segment: '2026',
            current: true,
            folders: [{ slug: '2026-lambay-races', label: '2026 Lambay Races' }],
          },
        ],
        undated: [],
      },
      currentSlug: '2026-lambay-races',
      pages,
      soleContributor: false,
      currentSubPath: 'standings',
    });
    // One season, one folder in it → both ancestor levels degenerate.
    expect(selects).toHaveLength(0);
    expect(leaf?.options).toEqual([
      { label: 'Cruisers', href: '/p/m15/2026-lambay-races/standings', current: true },
      { label: 'One Designs', href: '/p/m15/2026-lambay-races/one-designs', current: false },
    ]);
  });

  it('drops every degenerate level', () => {
    const { selects, leaf } = buildTreeNav({
      workspaceSlug: 'm15',
      seasonTree: {
        seasons: [
          {
            label: '2026',
            segment: '2026',
            current: true,
            folders: [{ slug: 'a', label: 'A' }],
          },
        ],
        undated: [],
      },
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
    seasonTree: archiveSeasonTree,
    currentSlug: '2025',
    pages: archivePages,
    soleContributor: false,
    currentFolder: 'autumn-league',
    currentSubPath: 'autumn-league/class-2-irc',
  };

  it('renders ancestor link-menus and few sibling pages as inline links', () => {
    const html = renderTreeNav(position, 'float');
    expect(html).toContain('sstreenav-float');
    // Never a select that navigates on change — each level is a menu of
    // links, summarised by the current position.
    expect(html).not.toContain('<select');
    expect(html).toContain('<summary aria-label="Season">2025</summary>');
    expect(html).toContain('href="/p/hyc/2024"');
    expect(html).toContain(
      '<summary aria-label="Event or series">Autumn League</summary>',
    );
    expect(html).toContain('href="/p/hyc/2025/dinghy-regatta"');
    expect(html).toContain('href="/p/hyc/2025/autumn-league/class-1-irc"');
    expect(html).toContain('<span class="sstreenav-current">Class 2 IRC</span>');
  });

  it('switches the leaf to a menu beyond four sibling pages', () => {
    const many: TreePage[] = [1, 2, 3, 4, 5].map((n) => ({
      fleetName: `Class ${n}`,
      subPath: `autumn-league/class-${n}`,
    }));
    const html = renderTreeNav(
      { ...position, pages: many, currentSubPath: 'autumn-league/class-4' },
      'float',
    );
    expect(html).toContain('<summary aria-label="Results page">Class 4</summary>');
    expect(html).toContain('href="/p/hyc/2025/autumn-league/class-1"');
    expect(html).toContain('<span class="sstreenav-current">Class 4</span>');
  });

  it('renders nothing when every level is degenerate', () => {
    expect(
      renderTreeNav(
        {
          workspaceSlug: 'm15',
          seasonTree: {
            seasons: [
              {
                label: '2026',
                segment: '2026',
                current: true,
                folders: [{ slug: 'a', label: 'A' }],
              },
            ],
            undated: [],
          },
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

describe('renderFolderIndexHtml', () => {
  it('lists the folder pages with leaf labels and links back to the slug', () => {
    const html = renderFolderIndexHtml({
      workspaceSlug: 'hyc',
      slug: '2025',
      folder: { segment: 'autumn-league', label: 'Autumn League' },
      pages: pagesInFolder(archivePages, 'autumn-league'),
      soleContributor: false,
      slugTitle: '2025',
    });
    expect(html).toContain('<h1>Autumn League</h1>');
    expect(html).toContain('href="/p/hyc/2025/autumn-league/class-1-irc"');
    expect(html).toContain('>Class 1 IRC<');
    expect(html).toContain('href="/p/hyc/2025/autumn-league/class-2-irc"');
    expect(html).toContain('<a href="/p/hyc/2025">&larr; 2025</a>');
    expect(html).toContain('<title>Autumn League — 2025</title>');
  });

  it('escapes folder labels and page labels', () => {
    const html = renderFolderIndexHtml({
      workspaceSlug: 'hyc',
      slug: '2025',
      folder: { segment: 'x', label: 'A & B <Event>' },
      pages: [{ fleetName: 'C & D', subPath: 'x/c-d' }, { fleetName: 'E', subPath: 'x/e' }],
      soleContributor: false,
      slugTitle: '2025',
    });
    expect(html).toContain('A &amp; B &lt;Event&gt;');
    expect(html).toContain('C &amp; D');
    expect(html).not.toContain('<Event>');
  });
});

describe('renderSeasonIndexHtml', () => {
  it('lists the season\'s folders and links back to the workspace', () => {
    const html = renderSeasonIndexHtml({
      workspaceSlug: 'm15',
      workspaceName: 'M15 Class',
      season: '2026',
      folders: [
        { slug: '2026-westerns', label: '2026 Westerns' },
        { slug: '2026-lambay-races', label: '2026 Lambay Races' },
      ],
    });
    expect(html).toContain('<h1>2026</h1>');
    expect(html).toContain('href="/p/m15/2026-westerns"');
    expect(html).toContain('>2026 Westerns<');
    expect(html).toContain('<a href="/p/m15">&larr; M15 Class &mdash; published results</a>');
    expect(html).toContain('<title>2026 — M15 Class</title>');
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
