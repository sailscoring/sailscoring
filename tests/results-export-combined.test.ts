/**
 * Combined published pages (#255) in the shared page builder: a blockless
 * multi-fleet series with publishing groups emits one combined page per
 * group (listed first), renders standings-only or full detail per the
 * group's setting, and drops the standalone page of any fleet whose group
 * replaces it.
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

function makeSeries(publishingGroups: PublishingGroup[]): Series {
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
  };
}

const FLEETS: Fleet[] = [
  { id: 'f-scratch', seriesId: 's1', name: 'Puppeteer Scratch', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-hph', seriesId: 's1', name: 'Puppeteer HPH', displayOrder: 1, scoringSystem: 'scratch' },
  { id: 'f-irc', seriesId: 's1', name: 'IRC 1', displayOrder: 2, scoringSystem: 'scratch' },
];

function makeCompetitor(id: string, sail: string, fleetIds: string[]): Competitor {
  return { id, seriesId: 's1', fleetIds, sailNumber: sail, name: `Helm ${sail}`, club: '', gender: '', age: null, createdAt: 0 };
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
  publishMembersIndividually: true,
};

const PUPPETEER: PublishingGroup = {
  id: 'g-pups',
  name: 'Puppeteer',
  fleetMode: 'chosen',
  fleetIds: ['f-scratch', 'f-hph'],
  detail: 'full',
  publishMembersIndividually: false,
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

  it('a replace-members group renders full detail and drops the standalone pages', async () => {
    const files = await buildFleetHtmlFiles(makeRepos(makeSeries([PUPPETEER])), 's1');
    expect(files!.map((f) => f.fleetName)).toEqual(['Puppeteer', 'IRC 1']);
    const pups = files![0];
    expect(pups.isCombined).toBe(true);
    // Both member fleets' sections carry their race tables, with per-section
    // anchors so the race links stay unambiguous.
    expect(pups.html.match(/class="racetable"/g)).toHaveLength(2);
    expect(pups.html).toContain('id="puppeteer-scratch-r1"');
    expect(pups.html).toContain('id="puppeteer-hph-r1"');
    // The non-member fleet is untouched and un-suppressed.
    expect(files![1].isCombined).toBeUndefined();
  });

  it('both groups compose: combined pages lead in group order', async () => {
    const files = await buildFleetHtmlFiles(
      makeRepos(makeSeries([OVERALL, PUPPETEER])),
      's1',
    );
    expect(files!.map((f) => f.fleetName)).toEqual(['Overall', 'Puppeteer', 'IRC 1']);
  });

  it('a chosen group whose fleets were all deleted renders no page', async () => {
    const ghost: PublishingGroup = { ...PUPPETEER, fleetIds: ['f-gone'] };
    const files = await buildFleetHtmlFiles(makeRepos(makeSeries([ghost])), 's1');
    // No combined page, and nothing suppressed (an empty group replaces nothing).
    expect(files!.map((f) => f.fleetName)).toEqual([
      'Puppeteer Scratch',
      'Puppeteer HPH',
      'IRC 1',
    ]);
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

  it('a replace-members group suppresses standalone pages per block', async () => {
    const files = await buildFleetHtmlFiles(makeBlockRepos(makeSeries([PUPPETEER])), 's1');
    expect(files!.map((f) => `${f.subSeriesName}/${f.fleetName}`)).toEqual([
      'Winter/Puppeteer',
      'Winter/IRC 1',
      'Spring/Puppeteer',
    ]);
    // Full detail: each block's combined page carries its members' race tables.
    for (const f of files!.filter((x) => x.isCombined)) {
      expect(f.html.match(/class="racetable"/g)).toHaveLength(2);
    }
  });

  it('a chosen group with no members in a block renders no page there and suppresses nothing', async () => {
    const ircOnly: PublishingGroup = {
      ...PUPPETEER,
      name: 'IRC Combined',
      fleetIds: ['f-irc'],
    };
    const files = await buildFleetHtmlFiles(makeBlockRepos(makeSeries([ircOnly])), 's1');
    // Winter: IRC 1 publishes only through the combined page. Spring's block
    // scoping excludes IRC 1 entirely, so Spring has no combined page and its
    // fleets are untouched.
    expect(files!.map((f) => `${f.subSeriesName}/${f.fleetName}`)).toEqual([
      'Winter/IRC Combined',
      'Winter/Puppeteer Scratch',
      'Winter/Puppeteer HPH',
      'Spring/Puppeteer Scratch',
      'Spring/Puppeteer HPH',
    ]);
  });
});
