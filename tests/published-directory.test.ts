import { describe, expect, test } from 'vitest';

import {
  badgesOf,
  buildDirectory,
  directoryJson,
  directoryLinkIds,
  renderDirectoryHtml,
} from '@/lib/published-directory';
import type { DirectoryRows } from '@/lib/published-repository';
import type { PublicationSummary } from '@/lib/types';

function summary(over: Partial<PublicationSummary> = {}): PublicationSummary {
  return { firstRaceDate: null, lastRaceDate: null, races: 0, boats: 0, fleets: [], ...over };
}

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12));

const rows: DirectoryRows = {
  workspaces: [
    { id: 'w-hyc', slug: 'hyc', name: 'Howth Yacht Club', logo: '/logos/hyc', description: 'Racing off Howth' },
    { id: 'w-iodai', slug: 'iodai', name: 'IODAI', logo: '', description: null },
    { id: 'w-empty', slug: 'empty', name: 'Nothing Yet', logo: '', description: null },
  ],
  // Newest first, as the repository reads them.
  publications: [
    {
      id: 'p-autumn', workspaceId: 'w-hyc', slug: 'autumn-league', seriesName: 'Autumn League',
      publishedAt: day(6), startDate: '2026-09-06',
      summary: summary({ races: 8, boats: 31, fleets: [{ name: 'Class 1', scoringSystem: 'irc' }, { name: 'Class 2', scoringSystem: 'echo' }] }),
    },
    {
      id: 'p-ulsters', workspaceId: 'w-iodai', slug: '2025', seriesName: 'Ulsters',
      publishedAt: day(5), startDate: '2025-06-13',
      summary: summary({ races: 6, boats: 40, fleets: [{ name: 'Senior' }], asPublished: true }),
    },
    {
      id: 'p-easterns', workspaceId: 'w-iodai', slug: '2025', seriesName: 'Easterns',
      publishedAt: day(4), startDate: '2025-05-01',
      summary: summary({ races: 5, boats: 38, fleets: [{ name: 'Senior' }], asPublished: true }),
    },
    {
      id: 'p-summer', workspaceId: 'w-hyc', slug: 'summer-series', seriesName: 'Summer Series',
      publishedAt: day(1), startDate: '2025-06-01',
      summary: null,
    },
  ],
  folders: [],
  seasons: [{ workspaceId: 'w-hyc', label: '2026', isCurrent: true }],
};

const pages = new Map([
  ['p-autumn', [{ fleetName: 'Class 1', subPath: 'class-1' }]],
  ['p-ulsters', [{ fleetName: 'Senior', subPath: 'ulsters/senior' }]],
  ['p-easterns', [{ fleetName: 'Senior', subPath: 'easterns/senior' }]],
  ['p-summer', [{ fleetName: 'Default', isDefault: true, subPath: 'standings' }]],
]);

describe('directoryLinkIds', () => {
  test("reads the pages of each workspace's latest and of the recent strip only", () => {
    expect(directoryLinkIds(rows).sort()).toEqual(['p-autumn', 'p-easterns', 'p-summer', 'p-ulsters']);
    const one = { ...rows, publications: rows.publications.slice(0, 2) };
    expect(directoryLinkIds(one).sort()).toEqual(['p-autumn', 'p-ulsters']);
  });
});

describe('buildDirectory', () => {
  const dir = buildDirectory(rows, pages);

  test('lists workspaces with something published, most recently active first', () => {
    expect(dir.workspaces.map((w) => w.slug)).toEqual(['hyc', 'iodai']);
  });

  test('counts seasons, series, races and entries from the stored summaries', () => {
    const [hyc, iodai] = dir.workspaces;
    expect(hyc.counts).toEqual({ seasons: 2, series: 2, races: 8, entries: 31 });
    expect(hyc.currentSeason).toBe('2026');
    expect(iodai.counts).toEqual({ seasons: 1, series: 2, races: 11, entries: 78 });
  });

  test('names the latest publication and lands on its own event in a shared season folder', () => {
    const [hyc, iodai] = dir.workspaces;
    expect(hyc.latest).toEqual({ name: 'Autumn League', path: '/p/hyc/autumn-league', publishedAt: day(6).getTime() });
    expect(iodai.latest.path).toBe('/p/iodai/2025/ulsters');
  });

  test('badges the kinds of racing', () => {
    expect(dir.workspaces[0].badges).toEqual(['IRC', 'ECHO']);
    expect(dir.workspaces[1].badges).toEqual(['Archive']);
  });

  test('the recent strip runs across workspaces, newest first', () => {
    expect(dir.recent.map((r) => [r.name, r.workspaceSlug])).toEqual([
      ['Autumn League', 'hyc'],
      ['Ulsters', 'iodai'],
      ['Easterns', 'iodai'],
      ['Summer Series', 'hyc'],
    ]);
  });
});

describe('badgesOf', () => {
  test('orders handicap systems, then one-design, then format', () => {
    expect(
      badgesOf([
        summary({ splitFleet: true, fleets: [{ name: 'A', scoringSystem: 'scratch' }] }),
        summary({ fleets: [{ name: 'B', scoringSystem: 'orc' }, { name: 'C', scoringSystem: 'irc' }] }),
      ]),
    ).toEqual(['IRC', 'ORC', 'One-design', 'Split-fleet']);
  });
});

describe('directoryJson', () => {
  test('absolute URLs, each workspace linking its own index.json', () => {
    const json = directoryJson(buildDirectory(rows, pages), 'https://app.example');
    expect(json.version).toBe(1);
    expect(json.workspaces[0]).toEqual({
      slug: 'hyc',
      name: 'Howth Yacht Club',
      url: 'https://app.example/p/hyc',
      index: 'https://app.example/p/hyc/index.json',
      logo: 'https://app.example/logos/hyc',
      description: 'Racing off Howth',
      lastPublishedAt: day(6).toISOString(),
      currentSeason: '2026',
      latest: { name: 'Autumn League', url: 'https://app.example/p/hyc/autumn-league', publishedAt: day(6).toISOString() },
      counts: { seasons: 2, series: 2, races: 8, entries: 31 },
      badges: ['IRC', 'ECHO'],
    });
    expect(json.workspaces[1]).not.toHaveProperty('logo');
    expect(json.recent[0]).toEqual({
      name: 'Autumn League',
      url: 'https://app.example/p/hyc/autumn-league',
      publishedAt: day(6).toISOString(),
      workspace: 'hyc',
    });
  });
});

describe('renderDirectoryHtml', () => {
  const html = renderDirectoryHtml(buildDirectory(rows, pages));

  test('is the one public page open to search, and declares its JSON twin', () => {
    expect(html).not.toContain('noindex');
    expect(html).toContain('<link rel="alternate" type="application/json" href="/p/index.json">');
  });

  test('renders a card per workspace with its signs of life and scale', () => {
    expect(html).toContain('data-workspace="hyc"');
    expect(html).toContain('data-workspace="iodai"');
    expect(html).not.toContain('data-workspace="empty"');
    expect(html).toContain('Racing off Howth');
    expect(html).toContain('<time datetime="2026-10-06T12:00:00.000Z" data-ago>6 Oct 2026</time>');
    expect(html).toContain('2 seasons · 2 series · 8 races · 31 entries');
    expect(html).toContain('<a href="/p/iodai/2025/ulsters">Ulsters</a>');
    // A workspace with no logo gets its initials.
    expect(html).toContain('<span class="mono" aria-hidden="true">I</span>');
  });

  test('an empty directory says so', () => {
    expect(renderDirectoryHtml({ workspaces: [], recent: [] })).toContain('Nothing published yet.');
  });
});
