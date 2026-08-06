/**
 * Combined published pages (#255) in the shared page builder: a multi-fleet
 * series with publishing groups emits one combined page per group (leading
 * its view's cluster), renders standings-only or full detail per the group's
 * setting, and — with `publishIndividualFleetPages` off — emits exactly the
 * combined pages, no standalone fleet entries.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type {
  Competitor,
  Finish,
  Fleet,
  PublishingGroup,
  Race,
  Series,
} from '@/lib/types';

function makeSeries(
  publishingGroups: PublishingGroup[],
  publishIndividualFleetPages = true,
): Series {
  return {
    id: 's1',
    name: 'Autumn League',
    venue: 'HYC',
    startDate: '2026-09-01',
    endDate: '2026-10-30',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: 0,
    lastSavedAt: null,
    lastModifiedAt: 0,
    scoringMode: 'scratch',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: false,
    enabledCompetitorFields: ['club'],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
    publishingGroups,
    publishIndividualFleetPages,
  };
}

const FLEETS: Fleet[] = [
  { id: 'f-scratch', seriesId: 's1', name: 'Puppeteer Scratch', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-hph', seriesId: 's1', name: 'Puppeteer HPH', displayOrder: 1, scoringSystem: 'scratch' },
  { id: 'f-irc', seriesId: 's1', name: 'IRC 1', displayOrder: 2, scoringSystem: 'scratch' },
];

function makeCompetitor(id: string, sail: string, fleetIds: string[]): Competitor {
  return { id, seriesId: 's1', fleetIds, sailNumber: sail, names: [`Helm ${sail}`], club: '', gender: '', age: null, createdAt: 0 };
}

const COMPETITORS = [
  makeCompetitor('c1', '101', ['f-scratch', 'f-hph']),
  makeCompetitor('c2', '102', ['f-scratch', 'f-hph']),
  makeCompetitor('c3', '201', ['f-irc']),
];

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-05', createdAt: 0 },
];

function makeFinish(competitorId: string, sortOrder: number): Finish {
  return { id: `r1-${competitorId}`, raceId: 'r1', competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null };
}

const FINISHES = [makeFinish('c1', 1), makeFinish('c2', 2), makeFinish('c3', 3)];

function makeRepos(series: Series): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === series.id ? series : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => FINISHES },
    raceStartRepo: { listBySeries: async () => [] },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

const OVERALL: PublishingGroup = {
  id: 'g-overall',
  name: 'Overall',
  fleetMode: 'all',
  fleetIds: [],
  detail: 'standings',
};

const PUPPETEER: PublishingGroup = {
  id: 'g-pups',
  name: 'Puppeteer',
  fleetMode: 'chosen',
  fleetIds: ['f-scratch', 'f-hph'],
  detail: 'full',
};

describe('buildFleetHtmlFiles — combined pages', () => {
  it('emits no combined pages when the series has none configured', async () => {
    const files = await buildFleetHtmlFiles(makeRepos(makeSeries([])), 's1');
    expect(files!.map((f) => f.fleetName)).toEqual([
      'Puppeteer Scratch',
      'Puppeteer HPH',
      'IRC 1',
    ]);
    expect(files!.every((f) => !f.isCombined)).toBe(true);
  });

  it('an Overall group adds a standings-only page first, keeping every fleet page', async () => {
    const files = await buildFleetHtmlFiles(makeRepos(makeSeries([OVERALL])), 's1');
    expect(files!.map((f) => f.fleetName)).toEqual([
      'Overall',
      'Puppeteer Scratch',
      'Puppeteer HPH',
      'IRC 1',
    ]);
    const overall = files![0];
    expect(overall.isCombined).toBe(true);
    // All three fleets' standings on one page…
    expect(overall.html).toContain('<h2>Overall</h2>');
    expect(overall.html).toContain('<h2>Puppeteer Scratch</h2>');
    expect(overall.html).toContain('<h2>Puppeteer HPH</h2>');
    expect(overall.html).toContain('<h2>IRC 1</h2>');
    expect(overall.html.match(/class="summarytable"/g)).toHaveLength(3);
    // …with no per-race detail tables (standings-only).
    expect(overall.html).not.toContain('class="racetable"');
  });

  it('a full-detail group keeps per-section race tables with unambiguous anchors', async () => {
    const files = await buildFleetHtmlFiles(makeRepos(makeSeries([PUPPETEER])), 's1');
    expect(files!.map((f) => f.fleetName)).toEqual([
      'Puppeteer',
      'Puppeteer Scratch',
      'Puppeteer HPH',
      'IRC 1',
    ]);
    const pups = files![0];
    expect(pups.isCombined).toBe(true);
    expect(pups.html.match(/class="racetable"/g)).toHaveLength(2);
    expect(pups.html).toContain('id="puppeteer-scratch-r1"');
    expect(pups.html).toContain('id="puppeteer-hph-r1"');
  });

  it('a full-detail group reads standings-first, then a race block per fleet', async () => {
    const files = await buildFleetHtmlFiles(makeRepos(makeSeries([PUPPETEER])), 's1');
    const html = files![0].html;
    // Every member's standings comes before any race detail…
    const lastSummary = html.lastIndexOf('class="summarytable"');
    const firstRaceTable = html.indexOf('class="racetable"');
    expect(lastSummary).toBeGreaterThan(-1);
    expect(firstRaceTable).toBeGreaterThan(lastSummary);
    // …and each fleet's races sit in their own delineated, linkable section,
    // in the same fleet order as the standings above them.
    expect(html).toContain('<section class="fleetraces" id="puppeteer-scratch-races">');
    expect(html).toContain('<section class="fleetraces" id="puppeteer-hph-races">');
    expect(html.indexOf('id="puppeteer-scratch-races"')).toBeLessThan(
      html.indexOf('id="puppeteer-hph-races"'),
    );
    // The qualifier is what keeps the two occurrences of a fleet name apart.
    expect(html).toContain('<h2>Puppeteer Scratch &mdash; race results</h2>');
    expect(html).toContain('<h2>Puppeteer HPH &mdash; race results</h2>');
  });

  it("a full-detail group's summary race links still resolve within the document", async () => {
    const files = await buildFleetHtmlFiles(makeRepos(makeSeries([PUPPETEER])), 's1');
    const html = files![0].html;
    const targets = [...html.matchAll(/class="racelink" href="#([^"]+)"/g)].map((m) => m[1]);
    expect(targets).toEqual(['puppeteer-scratch-r1', 'puppeteer-hph-r1']);
    for (const id of targets) expect(html).toContain(`id="${id}"`);
  });

  it('individual fleet pages off: the output is exactly the combined pages', async () => {
    const files = await buildFleetHtmlFiles(
      makeRepos(makeSeries([OVERALL, PUPPETEER], false)),
      's1',
    );
    // IRC 1 is on the Overall page; nothing publishes standalone — including
    // any fleet a combined page happens not to cover.
    expect(files!.map((f) => f.fleetName)).toEqual(['Overall', 'Puppeteer']);
  });

  it('the toggle is inert without a page-producing combined page', async () => {
    const ghost: PublishingGroup = { ...PUPPETEER, fleetIds: ['f-gone'] };
    const files = await buildFleetHtmlFiles(makeRepos(makeSeries([ghost], false)), 's1');
    // No combined page survives, so fleet pages publish regardless of the
    // toggle — a page-less publication is never constructed.
    expect(files!.map((f) => f.fleetName)).toEqual([
      'Puppeteer Scratch',
      'Puppeteer HPH',
      'IRC 1',
    ]);
  });
});

describe('buildFleetHtmlFiles — combined page race-detail limit (#372)', () => {
  const MANY_RACES: Race[] = [1, 2, 3, 4].map((n) => ({
    id: `r${n}`,
    seriesId: 's1',
    raceNumber: n,
    name: null,
    date: `2026-09-0${n + 4}`,
    createdAt: 0,
  }));

  const MANY_FINISHES: Finish[] = MANY_RACES.flatMap((race) =>
    ['c1', 'c2', 'c3'].map((competitorId, i) => ({
      ...makeFinish(competitorId, i + 1),
      id: `${race.id}-${competitorId}`,
      raceId: race.id,
    })),
  );

  function makeManyRaceRepos(series: Series): ExportRepos {
    return {
      ...makeRepos(series),
      raceRepo: { listBySeries: async () => MANY_RACES },
      finishRepo: { listBySeries: async () => MANY_FINISHES },
    } as unknown as ExportRepos;
  }

  async function combinedHtml(group: PublishingGroup): Promise<string> {
    const files = await buildFleetHtmlFiles(makeManyRaceRepos(makeSeries([group])), 's1');
    return files![0].html;
  }

  it('publishes only the last N races’ detail tables, keeping the full standings', async () => {
    const html = await combinedHtml({ ...PUPPETEER, recentRaces: 2 });
    // Two fleets × the last two races.
    expect(html.match(/class="racetable"/g)).toHaveLength(4);
    expect(html).toContain('id="puppeteer-scratch-r3"');
    expect(html).toContain('id="puppeteer-scratch-r4"');
    expect(html).not.toContain('id="puppeteer-scratch-r1"');
    expect(html).not.toContain('id="puppeteer-scratch-r2"');
    // The standings keep every race column — the limit is about page height,
    // not about which races are scored.
    expect(html.match(/<col class="race" \/>/g)).toHaveLength(8);
  });

  it('links only the race columns whose detail table is on the page', async () => {
    const html = await combinedHtml({ ...PUPPETEER, recentRaces: 2 });
    const targets = [...html.matchAll(/class="racelink" href="#([^"]+)"/g)].map((m) => m[1]);
    expect(targets).toEqual([
      'puppeteer-scratch-r3',
      'puppeteer-scratch-r4',
      'puppeteer-hph-r3',
      'puppeteer-hph-r4',
    ]);
    for (const id of targets) expect(html).toContain(`id="${id}"`);
  });

  it('says on the page that the race detail is trimmed', async () => {
    const html = await combinedHtml({ ...PUPPETEER, recentRaces: 2 });
    expect(html).toContain('Race results shown for the last 2 races');
    expect(html).toContain('the standings cover the whole series');
  });

  it('is absent, or wider than the series, without effect', async () => {
    for (const group of [PUPPETEER, { ...PUPPETEER, recentRaces: 9 }]) {
      const html = await combinedHtml(group);
      expect(html.match(/class="racetable"/g)).toHaveLength(8);
      expect(html).not.toContain('<p class="racelimitnote"');
    }
  });

  it('is inert on a standings-only page, which has no race tables to trim', async () => {
    const html = await combinedHtml({ ...OVERALL, recentRaces: 2 });
    expect(html).not.toContain('class="racetable"');
    expect(html).not.toContain('<p class="racelimitnote"');
  });
});

describe('buildFleetHtmlFiles — combined pages on a block series (#255)', () => {
  // Two blocks over the same race; Spring is fleet-scoped so it scores only
  // the two Puppeteer fleets, exercising the membership ∩ block-fleets rule.
  const SUB_SERIES = [
    { id: 'ss-w', seriesId: 's1', name: 'Winter', displayOrder: 0, raceIds: ['r1'] },
    { id: 'ss-s', seriesId: 's1', name: 'Spring', displayOrder: 1, raceIds: ['r1'], fleetIds: ['f-scratch', 'f-hph'] },
  ];

  function makeBlockRepos(series: Series): ExportRepos {
    return {
      ...makeRepos(series),
      subSeriesRepo: { listBySeries: async () => SUB_SERIES },
    } as unknown as ExportRepos;
  }

  it('an Overall group renders one combined page per block, leading each cluster', async () => {
    const files = await buildFleetHtmlFiles(makeBlockRepos(makeSeries([OVERALL])), 's1');
    expect(files!.map((f) => `${f.subSeriesName}/${f.fleetName}`)).toEqual([
      'Winter/Overall',
      'Winter/Puppeteer Scratch',
      'Winter/Puppeteer HPH',
      'Winter/IRC 1',
      'Spring/Overall',
      'Spring/Puppeteer Scratch',
      'Spring/Puppeteer HPH',
    ]);
    const winterOverall = files![0];
    expect(winterOverall.isCombined).toBe(true);
    // The Winter Overall carries all three fleets scored in Winter…
    expect(winterOverall.html.match(/class="summarytable"/g)).toHaveLength(3);
    expect(winterOverall.html).toContain('Winter');
    // …while the Spring Overall covers only the block's scoped fleets.
    const springOverall = files!.find(
      (f) => f.subSeriesName === 'Spring' && f.isCombined,
    )!;
    expect(springOverall.html.match(/class="summarytable"/g)).toHaveLength(2);
    expect(springOverall.html).not.toContain('<h2>IRC 1</h2>');
  });

  it('individual fleet pages off: each block publishes exactly its combined pages', async () => {
    const files = await buildFleetHtmlFiles(
      makeBlockRepos(makeSeries([PUPPETEER], false)),
      's1',
    );
    expect(files!.map((f) => `${f.subSeriesName}/${f.fleetName}`)).toEqual([
      'Winter/Puppeteer',
      'Spring/Puppeteer',
    ]);
    // Full detail: each block's combined page carries its members' race tables.
    for (const f of files!) {
      expect(f.html.match(/class="racetable"/g)).toHaveLength(2);
    }
  });

  it('a race-results series drops every summary, fleet pages and combined alike', async () => {
    const series = { ...makeSeries([OVERALL]), publishDetail: 'races' as const };
    const files = await buildFleetHtmlFiles(makeRepos(series), 's1');
    expect(files!.map((f) => f.fleetName)).toEqual([
      'Overall',
      'Puppeteer Scratch',
      'Puppeteer HPH',
      'IRC 1',
    ]);
    for (const f of files!) {
      expect(f.html).not.toContain('class="summarytable"');
      expect(f.html).toContain('class="racetable"');
    }
    // The Overall group asked for standings only; on a single-race event that
    // is exactly the table this setting exists to suppress, so it renders the
    // members' race tables instead of nothing.
    expect(files![0].html.match(/class="racetable"/g)).toHaveLength(3);
  });

  it('the toggle is inert per block: a block with no combined page keeps its fleet pages', async () => {
    const ircOnly: PublishingGroup = {
      ...PUPPETEER,
      name: 'IRC Combined',
      fleetIds: ['f-irc'],
    };
    const files = await buildFleetHtmlFiles(
      makeBlockRepos(makeSeries([ircOnly], false)),
      's1',
    );
    // Winter has a combined page, so only it publishes there. Spring's block
    // scoping excludes IRC 1, so Spring has no combined page — its fleet
    // pages publish despite the toggle.
    expect(files!.map((f) => `${f.subSeriesName}/${f.fleetName}`)).toEqual([
      'Winter/IRC Combined',
      'Spring/Puppeteer Scratch',
      'Spring/Puppeteer HPH',
    ]);
  });
});
