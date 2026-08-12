import { describe, it, expect } from 'vitest';

import {
  countMissingAxisValues,
  resolvePublishingGroups,
  describeGroupSections,
  fleetPagesSuppressed,
  describeGroupMembers,
  groupApplies,
  producesPage,
  publishingGroupError,
  subdivisionSections,
} from '@/lib/publishing-groups';
import type { Fleet, PublishingGroup, Standing, SubdivisionAxis } from '@/lib/types';

function makeFleet(id: string, name: string, displayOrder: number): Fleet {
  return { id, seriesId: 's1', name, displayOrder, scoringSystem: 'scratch' };
}

// Deliberately out of display order to prove members sort by displayOrder.
const FLEETS: Fleet[] = [
  makeFleet('f-hph', 'Puppeteer HPH', 1),
  makeFleet('f-scratch', 'Puppeteer Scratch', 0),
  makeFleet('f-irc', 'IRC 1', 2),
];

function makeGroup(overrides: Partial<PublishingGroup> = {}): PublishingGroup {
  return {
    id: 'g1',
    name: 'Overall',
    fleetMode: 'all',
    fleetIds: [],
    detail: 'standings',
    ...overrides,
  };
}

describe('resolvePublishingGroups', () => {
  it('returns nothing for absent or empty config', () => {
    expect(resolvePublishingGroups(undefined, FLEETS)).toEqual([]);
    expect(resolvePublishingGroups([], FLEETS)).toEqual([]);
  });

  it("'all' mode includes every fleet, in displayOrder", () => {
    const [resolved] = resolvePublishingGroups([makeGroup()], FLEETS);
    expect(resolved.fleets.map((f) => f.name)).toEqual([
      'Puppeteer Scratch',
      'Puppeteer HPH',
      'IRC 1',
    ]);
  });

  it("'chosen' mode picks the listed fleets, in displayOrder regardless of listing order", () => {
    const group = makeGroup({ fleetMode: 'chosen', fleetIds: ['f-hph', 'f-scratch'] });
    const [resolved] = resolvePublishingGroups([group], FLEETS);
    expect(resolved.fleets.map((f) => f.id)).toEqual(['f-scratch', 'f-hph']);
  });

  it('drops ids whose fleet no longer exists, keeping the group', () => {
    const group = makeGroup({ fleetMode: 'chosen', fleetIds: ['f-deleted'] });
    const [resolved] = resolvePublishingGroups([group], FLEETS);
    expect(resolved.fleets).toEqual([]);
    expect(resolved.group).toBe(group);
  });

  it('preserves the stored group order', () => {
    const groups = [makeGroup({ id: 'g1', name: 'A' }), makeGroup({ id: 'g2', name: 'B' })];
    expect(resolvePublishingGroups(groups, FLEETS).map((r) => r.group.name)).toEqual(['A', 'B']);
  });
});

describe('fleetPagesSuppressed', () => {
  it('is false while individual fleet pages are on (the default)', () => {
    const groups = resolvePublishingGroups([makeGroup()], FLEETS);
    expect(fleetPagesSuppressed(undefined, groups)).toBe(false);
    expect(fleetPagesSuppressed(true, groups)).toBe(false);
  });

  it('is true when switched off with a page-producing combined page', () => {
    const groups = resolvePublishingGroups([makeGroup()], FLEETS);
    expect(fleetPagesSuppressed(false, groups)).toBe(true);
  });

  it('is inert with no producing combined page — fleet pages always publish', () => {
    expect(fleetPagesSuppressed(false, [])).toBe(false);
    // A group with no surviving members produces no page and counts for nothing.
    const ghost = resolvePublishingGroups(
      [makeGroup({ fleetMode: 'chosen', fleetIds: ['f-deleted'] })],
      FLEETS,
    ).filter((r) => r.fleets.length > 0);
    expect(fleetPagesSuppressed(false, ghost)).toBe(false);
  });
});

describe('describeGroupMembers', () => {
  it("summarises 'all' mode without naming fleets", () => {
    const [resolved] = resolvePublishingGroups([makeGroup()], FLEETS);
    expect(describeGroupMembers(resolved)).toBe('all fleets');
  });

  it('joins chosen member names in display order', () => {
    const group = makeGroup({ fleetMode: 'chosen', fleetIds: ['f-hph', 'f-scratch'] });
    const [resolved] = resolvePublishingGroups([group], FLEETS);
    expect(describeGroupMembers(resolved)).toBe('Puppeteer Scratch + Puppeteer HPH');
  });
});

describe('publishingGroupError', () => {
  it('accepts a well-formed group', () => {
    expect(publishingGroupError(makeGroup(), [makeGroup()], FLEETS)).toBeNull();
  });

  it('rejects an empty name', () => {
    const g = makeGroup({ name: '  ' });
    expect(publishingGroupError(g, [g], FLEETS)).toMatch(/name/);
  });

  it('rejects a name matching a fleet (case-insensitive) — pages are keyed by name', () => {
    const g = makeGroup({ name: 'puppeteer scratch' });
    expect(publishingGroupError(g, [g], FLEETS)).toMatch(/fleet/i);
  });

  it('rejects a name shared with another group', () => {
    const a = makeGroup({ id: 'g1', name: 'Overall' });
    const b = makeGroup({ id: 'g2', name: ' overall ' });
    expect(publishingGroupError(b, [a, b], FLEETS)).toMatch(/already/);
  });

  it('rejects a chosen group with no members', () => {
    const g = makeGroup({ fleetMode: 'chosen', fleetIds: [] });
    expect(publishingGroupError(g, [g], FLEETS)).toMatch(/fleet/i);
  });
});

describe('groupApplies', () => {
  it('needs more than one fleet to combine fleets', () => {
    expect(groupApplies(makeGroup(), false)).toBe(false);
    expect(groupApplies(makeGroup(), true)).toBe(true);
  });

  it('applies an axis-sectioned page to a single-fleet series', () => {
    // The GP14 Munsters case: one scoring pool, three divisions.
    expect(groupApplies(makeGroup({ sectionAxisId: 'axis-div' }), false)).toBe(true);
  });
});

describe('describeGroupSections', () => {
  const axes: SubdivisionAxis[] = [{ id: 'axis-div', label: 'Division' }];

  it('names fleet sections by default', () => {
    expect(describeGroupSections(makeGroup(), axes)).toBe('one section per fleet');
  });

  it('names the axis a page is sectioned by', () => {
    expect(describeGroupSections(makeGroup({ sectionAxisId: 'axis-div' }), axes)).toBe(
      'one section per Division',
    );
  });

  it('says so when the axis is gone', () => {
    expect(describeGroupSections(makeGroup({ sectionAxisId: 'axis-gone' }), axes)).toMatch(
      /no longer has/,
    );
  });
});

// ---- Sectioning by a subdivision axis (#390) ----

const AXIS = 'axis-div';

function makeStanding(
  rank: number,
  sailNumber: string,
  division: string | undefined,
): Standing {
  return {
    rank,
    competitor: {
      id: `c-${sailNumber}`,
      seriesId: 's1',
      fleetIds: ['f-scratch'],
      sailNumber,
      names: [`Helm ${sailNumber}`],
      club: '',
      gender: '',
      age: null,
      createdAt: 0,
      ...(division !== undefined ? { subdivisions: { [AXIS]: division } } : {}),
    },
    racePoints: [rank],
    raceRanks: [rank],
    raceCodes: [null],
    racePenaltyCodes: [null],
    racePenaltyOverrides: [null],
    totalPoints: rank,
    netPoints: rank,
    raceDiscards: [false],
    raceNonDiscardable: [false],
    raceRedressFlags: [false],
    raceExcluded: [false],
  };
}

describe('subdivisionSections', () => {
  it('cuts the standings into one section per value, best-placed division first', () => {
    const standings = [
      makeStanding(1, '14256', 'Gold'),
      makeStanding(2, '14203', 'Silver'),
      makeStanding(3, '14', 'Gold'),
      makeStanding(4, '14171', 'Bronze'),
    ];
    const sections = subdivisionSections(standings, AXIS);
    expect(sections.map((s) => s.value)).toEqual(['Gold', 'Silver', 'Bronze']);
    expect(sections[0].standings.map((s) => s.competitor.sailNumber)).toEqual(['14256', '14']);
  });

  it('renumbers each section 1..n while leaving the scores alone', () => {
    const standings = [
      makeStanding(1, '14256', 'Gold'),
      makeStanding(2, '14203', 'Silver'),
      makeStanding(3, '14', 'Gold'),
    ];
    const [gold, silver] = subdivisionSections(standings, AXIS);
    expect(gold.standings.map((s) => s.rank)).toEqual([1, 2]);
    expect(silver.standings.map((s) => s.rank)).toEqual([1]);
    // The second Gold boat is 2nd in Gold on the series points it actually scored.
    expect(gold.standings[1].netPoints).toBe(3);
  });

  it('keeps boats tied in the series tied within their division', () => {
    const standings = [
      makeStanding(1, 'A', 'Gold'),
      { ...makeStanding(2, 'B', 'Gold'), rank: 2 },
      { ...makeStanding(2, 'C', 'Gold'), rank: 2 },
      { ...makeStanding(4, 'D', 'Gold'), rank: 4 },
    ];
    const [gold] = subdivisionSections(standings, AXIS);
    expect(gold.standings.map((s) => s.rank)).toEqual([1, 2, 2, 4]);
  });

  it('treats differently-cased spellings as one division, keeping the first', () => {
    const standings = [makeStanding(1, 'A', 'Gold'), makeStanding(2, 'B', 'gold')];
    const sections = subdivisionSections(standings, AXIS);
    expect(sections).toHaveLength(1);
    expect(sections[0].value).toBe('Gold');
    expect(sections[0].standings).toHaveLength(2);
  });

  it('leaves out competitors carrying no value, and counts them', () => {
    const standings = [
      makeStanding(1, 'A', 'Gold'),
      makeStanding(2, 'B', undefined),
      makeStanding(3, 'C', '  '),
    ];
    expect(subdivisionSections(standings, AXIS)).toHaveLength(1);
    expect(countMissingAxisValues(standings, AXIS)).toBe(2);
  });

  it('yields nothing for an axis nobody carries', () => {
    expect(subdivisionSections([makeStanding(1, 'A', 'Gold')], 'axis-other')).toEqual([]);
  });
});

describe('publishingGroupError — axis sections', () => {
  const axes: SubdivisionAxis[] = [{ id: AXIS, label: 'Division' }];

  it('accepts a page sectioned by a configured axis', () => {
    const g = makeGroup({ sectionAxisId: AXIS });
    expect(publishingGroupError(g, [g], FLEETS, axes)).toBeNull();
  });

  it('rejects a page sectioned by an axis the series no longer has', () => {
    const g = makeGroup({ sectionAxisId: 'axis-gone' });
    expect(publishingGroupError(g, [g], FLEETS, axes)).toMatch(/no longer has/);
  });
});

describe('producesPage — a series with no fleet rows', () => {
  it('publishes an all-fleets axis page, which cuts the synthetic fleet', () => {
    const [resolved] = resolvePublishingGroups([makeGroup({ sectionAxisId: AXIS })], []);
    expect(producesPage(resolved)).toBe(true);
  });

  it('keeps a fleet-sectioned page inert', () => {
    const [resolved] = resolvePublishingGroups([makeGroup()], []);
    expect(producesPage(resolved)).toBe(false);
  });

  it('keeps an axis page whose chosen fleets are gone inert', () => {
    const group = makeGroup({ sectionAxisId: AXIS, fleetMode: 'chosen', fleetIds: ['f-gone'] });
    const [resolved] = resolvePublishingGroups([group], FLEETS);
    expect(producesPage(resolved)).toBe(false);
  });
});
