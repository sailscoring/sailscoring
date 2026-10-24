import { afterEach, describe, expect, test, vi } from 'vitest';

import { buildPublicIndex, type PublicIndexInputRow } from '@/lib/published-index-json';

const ORIGIN = 'https://app.example';
const WS = { slug: 'hyc', name: 'Howth Yacht Club', logo: '/logos/abc' };

function row(over: Partial<PublicIndexInputRow> & { slug: string }): PublicIndexInputRow {
  return {
    seriesName: 'Series',
    pages: [{ fleetName: 'Default', isDefault: true, subPath: 'standings' }],
    dataSubPath: null,
    summary: null,
    publishedAt: Date.UTC(2026, 9, 4, 18, 0),
    ...over,
  };
}

describe('buildPublicIndex — the live shape (an event per top-level folder)', () => {
  const autumn = row({
    slug: 'autumn-league',
    seriesName: 'Autumn League',
    pages: [
      { fleetName: 'Class 1', subPath: 'class-1' },
      { fleetName: 'Class 2', subPath: 'class-2' },
      { fleetName: 'Prizes', isPrizes: true, subPath: 'prizes' },
    ],
    dataSubPath: 'autumn-league.sailscoring.json',
    apiId: '0b8a6c84-4b5e-4f3a-9d1e-2c7f5a9e1d33',
    summary: {
      firstRaceDate: '2026-09-06',
      lastRaceDate: '2026-10-04',
      races: 8,
      boats: 31,
      fleets: [
        { name: 'Class 1', scoringSystem: 'irc' },
        { name: 'Class 2', scoringSystem: 'echo' },
      ],
    },
  });
  const pursuit = row({ slug: 'pursuit', seriesName: 'Pursuit Race' });
  const doc = buildPublicIndex({
    origin: ORIGIN,
    workspace: WS,
    seasonTree: {
      seasons: [
        {
          label: '2026',
          segment: '2026',
          current: true,
          folders: [
            { slug: 'autumn-league', label: 'Autumn League' },
            { slug: 'pursuit', label: 'Pursuit Race' },
          ],
        },
      ],
      undated: [],
    },
    folderMeta: new Map(),
    publications: [pursuit, autumn],
  });

  test('carries the version, the workspace and its seasons', () => {
    expect(doc.version).toBe(1);
    expect(doc.workspace).toEqual({
      slug: 'hyc',
      name: 'Howth Yacht Club',
      url: 'https://app.example/p/hyc',
      logo: 'https://app.example/logos/abc',
    });
    expect(doc.seasons).toEqual([
      {
        label: '2026',
        current: true,
        url: 'https://app.example/p/hyc/2026',
        index: 'https://app.example/p/hyc/2026/index.json',
      },
    ]);
  });

  test('lists publications in tree order with pages, data file, fleets and dates', () => {
    expect(doc.publications.map((p) => p.name)).toEqual(['Autumn League', 'Pursuit Race']);
    expect(doc.publications[0]).toEqual({
      name: 'Autumn League',
      season: '2026',
      folder: {
        slug: 'autumn-league',
        label: 'Autumn League',
        url: 'https://app.example/p/hyc/autumn-league',
      },
      url: 'https://app.example/p/hyc/autumn-league',
      pages: [
        { label: 'Class 1', kind: 'standings', fleet: 'Class 1', url: 'https://app.example/p/hyc/autumn-league/class-1' },
        { label: 'Class 2', kind: 'standings', fleet: 'Class 2', url: 'https://app.example/p/hyc/autumn-league/class-2' },
        { label: 'Prizes', kind: 'prizes', url: 'https://app.example/p/hyc/autumn-league/prizes' },
      ],
      data: 'https://app.example/p/hyc/autumn-league/autumn-league.sailscoring.json',
      api: 'https://app.example/api/public/v1/publications/0b8a6c84-4b5e-4f3a-9d1e-2c7f5a9e1d33',
      fleets: [
        { name: 'Class 1', scoringSystem: 'irc' },
        { name: 'Class 2', scoringSystem: 'echo' },
      ],
      publishedAt: '2026-10-04T18:00:00.000Z',
      firstRaceDate: '2026-09-06',
      lastRaceDate: '2026-10-04',
      races: 8,
      boats: 31,
    });
  });

  test('a Schedule page is listed as its own kind', () => {
    const doc2 = buildPublicIndex({
      origin: ORIGIN,
      workspace: WS,
      seasonTree: { seasons: [], undated: [{ slug: 'winter', label: 'Winter' }] },
      folderMeta: new Map(),
      publications: [
        row({
          slug: 'winter',
          pages: [{ fleetName: 'Schedule', isAuxiliary: true, isSchedule: true, subPath: 'schedule' }],
        }),
      ],
    });
    expect(doc2.publications[0].pages).toEqual([
      { label: 'Schedule', kind: 'schedule', url: 'https://app.example/p/hyc/winter/schedule' },
    ]);
  });

  test('a publication whose API resources do not exist yet links none', () => {
    expect(doc.publications[1]).not.toHaveProperty('api');
  });

  test('a lone synthetic page reads as Standings, names no fleet, and an opted-out series has no data file', () => {
    const p = doc.publications[1];
    expect(p.pages).toEqual([
      { label: 'Standings', kind: 'standings', url: 'https://app.example/p/hyc/pursuit/standings' },
    ]);
    expect(p.data).toBeNull();
    // No stored summary: fleets from the pages (none named), dates unknown.
    expect(p.fleets).toEqual([]);
    expect(p.firstRaceDate).toBeNull();
    expect(p).not.toHaveProperty('races');
  });
});

describe('buildPublicIndex — the archive shape (the slug is the season)', () => {
  const tree = {
    seasons: [
      { label: '2025', segment: '2025', current: true, folders: [{ slug: '2025', label: '2025' }] },
      { label: '2024', segment: '2024', current: false, folders: [{ slug: '2024', label: '2024' }] },
    ],
    undated: [{ slug: 'misc', label: 'Misc' }],
  };
  const pubs = [
    row({
      slug: '2025',
      seriesName: "1720's Easterns",
      pages: [{ fleetName: 'Default', isDefault: true, subPath: 'easterns/standings' }],
    }),
    row({
      slug: '2025',
      seriesName: 'Ulsters',
      pages: [
        { fleetName: 'Senior', subPath: 'ulsters/senior' },
        { fleetName: 'Junior', subPath: 'ulsters/junior' },
      ],
    }),
    row({ slug: '2024', seriesName: null }),
    row({ slug: 'misc', seriesName: 'Odd One' }),
  ];
  const meta = new Map([['2025/easterns', { label: "1720's Easterns" }]]);

  test('each series lands on its event folder, labelled by its pin or humanised', () => {
    const doc = buildPublicIndex({
      origin: ORIGIN, workspace: WS, seasonTree: tree, folderMeta: meta, publications: pubs,
    });
    const [easterns, ulsters] = doc.publications;
    expect(easterns.url).toBe('https://app.example/p/hyc/2025/easterns');
    expect(easterns.event).toEqual({
      segment: 'easterns',
      label: "1720's Easterns",
      url: 'https://app.example/p/hyc/2025/easterns',
    });
    expect(ulsters.event?.label).toBe('Ulsters');
    expect(ulsters.pages.map((p) => p.label)).toEqual(['Senior', 'Junior']);
  });

  test('an orphan takes its folder name; an undated folder comes last with no season', () => {
    const doc = buildPublicIndex({
      origin: ORIGIN, workspace: WS, seasonTree: tree, folderMeta: meta, publications: pubs,
    });
    expect(doc.publications.map((p) => [p.name, p.season])).toEqual([
      ["1720's Easterns", '2025'],
      ['Ulsters', '2025'],
      ['2024', '2024'],
      ['Odd One', null],
    ]);
  });

  test('a season index narrows the publications and the seasons, and drops undated', () => {
    const doc = buildPublicIndex({
      origin: ORIGIN, workspace: WS, seasonTree: tree, folderMeta: meta, publications: pubs, season: '2024',
    });
    expect(doc.seasons.map((s) => s.label)).toEqual(['2024']);
    expect(doc.publications.map((p) => p.name)).toEqual(['2024']);
  });
});

describe('buildPublicIndex — season mode', () => {
  test('a lone series in a season folder lands on its own event', () => {
    const doc = buildPublicIndex({
      origin: ORIGIN,
      workspace: WS,
      seasonTree: {
        seasons: [{ label: '2026', segment: '2026', current: true, folders: [{ slug: '2026', label: '2026' }] }],
        undated: [],
      },
      folderMeta: new Map(),
      publications: [
        row({
          slug: '2026',
          seriesName: 'Bay Series',
          pages: [{ fleetName: 'Default', isDefault: true, subPath: 'bay-series/standings' }],
        }),
      ],
    });
    expect(doc.publications[0].url).toBe('https://app.example/p/hyc/2026/bay-series');
  });
});

describe('buildPublicIndex — the instance time zone', () => {
  const build = () =>
    buildPublicIndex({
      origin: ORIGIN,
      workspace: WS,
      seasonTree: { seasons: [], undated: [{ slug: 'pursuit', label: 'Pursuit' }] },
      folderMeta: new Map(),
      publications: [row({ slug: 'pursuit' })],
    });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('declares Europe/Dublin by default', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_TIMEZONE', undefined);
    expect(build().timeZone).toBe('Europe/Dublin');
  });

  test('declares the zone the instance is set to', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_TIMEZONE', 'America/New_York');
    expect(build().timeZone).toBe('America/New_York');
  });
});
