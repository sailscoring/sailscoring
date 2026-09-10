/**
 * Grouping fleets into the classes a published entry list is tabled by. The
 * shapes here are the ones the rule has to get right on real entry lists:
 * Howth's autumn league (a class scored under two systems, named with the
 * class first), the same thing named the other way round, and the near
 * misses that must *not* group.
 */
import { describe, it, expect } from 'vitest';

import { groupFleets, type GroupableFleet } from '@/lib/fleet-groups';

let seq = 0;
function fleet(name: string, importGroups?: string[]): GroupableFleet {
  return { id: `f${seq}`, name, displayOrder: seq++, ...(importGroups ? { importGroups } : {}) };
}

/** Members as a fleet-id → competitor-id map, from a plain object. */
function membership(spec: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(spec).map(([id, boats]) => [id, new Set(boats)]));
}

const summarise = (groups: ReturnType<typeof groupFleets>) =>
  groups.map((g) => [g.name, g.fleets.map((f) => f.label ?? '—')]);

describe('groupFleets', () => {
  it('groups a class scored under two systems, and names the columns by what differs', () => {
    const hph = fleet('Class 1 HPH');
    const irc = fleet('Class 1 IRC');
    const groups = groupFleets(
      [hph, irc],
      membership({ [hph.id]: ['a', 'b', 'c', 'd'], [irc.id]: ['a', 'b', 'c', 'd', 'e'] }),
    );
    expect(summarise(groups)).toEqual([['Class 1', ['HPH', 'IRC']]]);
  });

  it('reads the same when the system leads the name', () => {
    const irc = fleet('IRC Class 1');
    const nhc = fleet('NHC Class 1');
    const groups = groupFleets(
      [irc, nhc],
      membership({ [irc.id]: ['a', 'b'], [nhc.id]: ['a', 'b'] }),
    );
    expect(summarise(groups)).toEqual([['Class 1', ['IRC', 'NHC']]]);
  });

  it('strips the punctuation a split strands at an edge', () => {
    const a = fleet('Cruiser 1 (IRC)');
    const b = fleet('Cruiser 1 (ECHO)');
    const groups = groupFleets([a, b], membership({ [a.id]: ['x'], [b.id]: ['x'] }));
    expect(summarise(groups)).toEqual([['Cruiser 1', ['IRC', 'ECHO']]]);
  });

  it('keeps two classes apart even when their names share three words', () => {
    // The shape that breaks a names-only rule: Non Spin Class 4 and Non Spin
    // Class 5 share "Non Spin Class" but are different classes.
    const four = fleet('Non Spin Class 4 HPH');
    const five = fleet('Non Spin Class 5 HPH');
    const groups = groupFleets(
      [four, five],
      membership({ [four.id]: ['a', 'b', 'c'], [five.id]: ['d', 'e', 'f'] }),
    );
    expect(summarise(groups)).toEqual([
      ['Non Spin Class 4 HPH', ['—']],
      ['Non Spin Class 5 HPH', ['—']],
    ]);
  });

  it('is not fooled by one boat entered in two classes', () => {
    const four = fleet('Non Spin Class 4 HPH');
    const five = fleet('Non Spin Class 5 HPH');
    const groups = groupFleets(
      [four, five],
      membership({ [four.id]: ['a', 'b', 'c', 'd'], [five.id]: ['d', 'e', 'f', 'g'] }),
    );
    expect(groups).toHaveLength(2);
  });

  it('keeps a fleet holding everybody out of the class it overlaps', () => {
    // Overall shares every boat with Class 1, but shares no word with it.
    const one = fleet('Class 1 IRC');
    const overall = fleet('Overall');
    const groups = groupFleets(
      [one, overall],
      membership({ [one.id]: ['a', 'b'], [overall.id]: ['a', 'b', 'c'] }),
    );
    expect(groups).toHaveLength(2);
  });

  it('keeps the same system in different classes apart', () => {
    const one = fleet('Class 1 IRC');
    const two = fleet('Class 2 IRC');
    const groups = groupFleets(
      [one, two],
      membership({ [one.id]: ['a', 'b'], [two.id]: ['c', 'd'] }),
    );
    expect(groups).toHaveLength(2);
  });

  it('groups on the importer\'s recorded grouping value however the fleets were renamed', () => {
    const a = fleet('IRC 1', ['Cruiser 1']);
    const b = fleet('Cruisers One', ['Cruiser 1']);
    const groups = groupFleets([a, b], membership({ [a.id]: [], [b.id]: [] }));
    // Nothing in the names is shared, so the recorded value heads the group
    // and each fleet keeps its own name as its column.
    expect(summarise(groups)).toEqual([['Cruiser 1', ['IRC 1', 'Cruisers One']]]);
  });

  it('prefers what the names share over the recorded value when both apply', () => {
    const a = fleet('Cruiser 1 IRC', ['Cruiser 1']);
    const b = fleet('Cruiser 1 ECHO', ['Cruiser 1']);
    const groups = groupFleets([a, b], membership({ [a.id]: [], [b.id]: [] }));
    expect(summarise(groups)).toEqual([['Cruiser 1', ['IRC', 'ECHO']]]);
  });

  it('leaves a fleet named exactly its group unlabelled', () => {
    const bare = fleet('Class 1');
    const irc = fleet('Class 1 IRC');
    const groups = groupFleets(
      [bare, irc],
      membership({ [bare.id]: ['a', 'b'], [irc.id]: ['a', 'b'] }),
    );
    expect(summarise(groups)).toEqual([['Class 1', ['—', 'IRC']]]);
  });

  it('breaks a chained group with nothing in common back into single fleets', () => {
    // A shares its tail with B, B shares its head with C, and across all
    // three there is nothing to head a group with.
    const a = fleet('Alpha Blue');
    const b = fleet('Bravo Blue');
    const c = fleet('Bravo Gold');
    const groups = groupFleets(
      [a, b, c],
      membership({ [a.id]: ['x'], [b.id]: ['x'], [c.id]: ['x'] }),
    );
    expect(summarise(groups)).toEqual([
      ['Alpha Blue', ['—']],
      ['Bravo Blue', ['—']],
      ['Bravo Gold', ['—']],
    ]);
  });

  it('returns groups and their fleets in display order', () => {
    const two = { id: 'f-two', name: 'Class 2 IRC', displayOrder: 3 };
    const oneB = { id: 'f-1b', name: 'Class 1 IRC', displayOrder: 2 };
    const oneA = { id: 'f-1a', name: 'Class 1 HPH', displayOrder: 1 };
    const groups = groupFleets(
      [two, oneB, oneA],
      membership({ 'f-two': ['z'], 'f-1b': ['a', 'b'], 'f-1a': ['a', 'b'] }),
    );
    expect(groups.map((g) => g.name)).toEqual(['Class 1', 'Class 2 IRC']);
    expect(groups[0].fleets.map((f) => f.name)).toEqual(['Class 1 HPH', 'Class 1 IRC']);
  });

  it('leaves an empty fleet on its own — no boats is no evidence', () => {
    const hph = fleet('Class 3 HPH');
    const irc = fleet('Class 3 IRC');
    const groups = groupFleets([hph, irc], membership({ [hph.id]: ['a'], [irc.id]: [] }));
    expect(groups).toHaveLength(2);
  });
});
