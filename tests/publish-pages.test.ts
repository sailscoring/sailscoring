/**
 * The shared page manifest (`lib/publish-pages.ts`): the one answer to "which
 * pages does this series publish", which the build renders from and both
 * publish destinations list. These tests pin the set and its order; the
 * companion assertion that the build agrees lives in
 * `tests/results-export-page-set.test.ts`.
 */
import { describe, it, expect } from 'vitest';

import { resolvePublishPages } from '@/lib/publish-pages';
import type { Fleet, PublishingGroup, Series } from '@/lib/types';

function makeSeries(overrides: Partial<Series> = {}): Series {
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
    publishingGroups: [],
    ...overrides,
  } as Series;
}

const FLEETS: Fleet[] = [
  { id: 'f-scratch', seriesId: 's1', name: 'Scratch', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-hph', seriesId: 's1', name: 'HPH', displayOrder: 1, scoringSystem: 'scratch' },
];

const OVERALL: PublishingGroup = {
  id: 'g-overall',
  name: 'Overall',
  fleetMode: 'all',
  fleetIds: [],
  detail: 'standings',
};

const names = (series: Series, fleets: Fleet[], rest = {}) =>
  resolvePublishPages({ series, fleets, ...rest }).map((p) => p.name);

describe('resolvePublishPages', () => {
  it('lists one page per fleet', () => {
    expect(names(makeSeries(), FLEETS)).toEqual(['Scratch', 'HPH']);
  });

  it('makes a lone fleet the publication default page', () => {
    const pages = resolvePublishPages({ series: makeSeries(), fleets: [FLEETS[0]] });
    expect(pages).toEqual([
      { key: 'fleet:f-scratch', name: 'Scratch', kind: 'fleet', isDefault: true, fleetId: 'f-scratch' },
    ]);
  });

  it('names the fleetless bucket for a series with no fleets at all', () => {
    expect(resolvePublishPages({ series: makeSeries(), fleets: [] })).toEqual([
      { key: 'fleet:__unknown__', name: 'Unknown', kind: 'fleet', isDefault: true },
    ]);
  });

  it('never makes a fleet of several the default page', () => {
    expect(resolvePublishPages({ series: makeSeries(), fleets: FLEETS }).every((p) => !p.isDefault)).toBe(true);
  });

  it('leads with the combined pages, ahead of the fleets they draw on', () => {
    const series = makeSeries({ publishingGroups: [OVERALL] });
    expect(names(series, FLEETS)).toEqual(['Overall', 'Scratch', 'HPH']);
  });

  it('drops a combined page that has nothing to combine', () => {
    // A fleet-sectioned group needs more than one fleet.
    const series = makeSeries({ publishingGroups: [OVERALL] });
    expect(names(series, [FLEETS[0]])).toEqual(['Scratch']);
  });

  it('publishes exactly the combined pages with individual fleet pages off', () => {
    const series = makeSeries({
      publishingGroups: [OVERALL],
      publishIndividualFleetPages: false,
    });
    expect(names(series, FLEETS)).toEqual(['Overall']);
  });

  it('keeps the fleet pages when the toggle is off but no combined page covers them', () => {
    const series = makeSeries({ publishIndividualFleetPages: false });
    expect(names(series, FLEETS)).toEqual(['Scratch', 'HPH']);
  });

  it('adds the prize sheet and entry list last, and only where the feature is on', () => {
    const series = makeSeries({ prizes: [{ id: 'p1' }] as Series['prizes'] });
    expect(names(series, FLEETS)).toEqual(['Scratch', 'HPH']);
    expect(names(series, FLEETS, { features: { prizes: true, entryList: true } })).toEqual([
      'Scratch',
      'HPH',
      'Prizes',
      'Entries',
    ]);
  });

  it('leaves the prize sheet out of a series carrying no prizes', () => {
    expect(names(makeSeries(), FLEETS, { features: { prizes: true } })).toEqual(['Scratch', 'HPH']);
  });

  it('publishes a championship trio instead of the round fleets', () => {
    const pages = resolvePublishPages({
      series: makeSeries(),
      fleets: FLEETS,
      splitFleets: true,
      features: { entryList: true },
    });
    expect(pages.map((p) => p.name)).toEqual([
      'Championship',
      'Race results',
      'Fleet assignments',
      'Entries',
    ]);
    expect(pages[0].isDefault).toBe(true);
  });
});
