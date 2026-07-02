import { describe, it, expect } from 'vitest';

import {
  resolvePublishingGroups,
  suppressedFleetIds,
  describeGroupMembers,
  publishingGroupError,
} from '@/lib/publishing-groups';
import type { Fleet, PublishingGroup } from '@/lib/types';

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
    publishMembersIndividually: true,
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

describe('suppressedFleetIds', () => {
  it('is empty when every group also publishes members individually', () => {
    expect(suppressedFleetIds([makeGroup()], FLEETS).size).toBe(0);
  });

  it('collects members of a group that replaces its standalone pages', () => {
    const group = makeGroup({
      fleetMode: 'chosen',
      fleetIds: ['f-scratch', 'f-hph'],
      publishMembersIndividually: false,
    });
    const suppressed = suppressedFleetIds([group], FLEETS);
    expect([...suppressed].sort()).toEqual(['f-hph', 'f-scratch']);
    expect(suppressed.has('f-irc')).toBe(false);
  });

  it('an empty (all members deleted) group suppresses nothing', () => {
    const group = makeGroup({
      fleetMode: 'chosen',
      fleetIds: ['f-deleted'],
      publishMembersIndividually: false,
    });
    expect(suppressedFleetIds([group], FLEETS).size).toBe(0);
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
