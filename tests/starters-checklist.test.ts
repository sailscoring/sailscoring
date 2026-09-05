/**
 * The starters checklist groups the entry list into one table per start,
 * not per fleet: a class scored under IRC and HPH at once is one table with
 * each boat on it once.
 */
import { describe, it, expect } from 'vitest';

import { buildStartersChecklist, checklistHeading } from '@/lib/starters-checklist';

const fleet = (id: string, name: string, displayOrder: number, splitRoundId?: string) => ({
  id,
  name,
  displayOrder,
  ...(splitRoundId ? { splitRoundId } : {}),
});

const boat = (sailNumber: string, fleetIds: string[], boatName?: string) => ({
  sailNumber,
  fleetIds,
  ...(boatName ? { boatName } : {}),
});

// HYC's cruiser classes: each scored under IRC and HPH, with a boat entered
// in one or both. Class 2 is HPH-only.
const FLEETS = [
  fleet('default', 'Default', 0),
  fleet('c1-irc', 'Class 1 IRC', 1),
  fleet('c1-hph', 'Class 1 HPH', 2),
  fleet('c2-hph', 'Class 2 HPH', 3),
  fleet('c3-irc', 'Class 3 IRC', 4),
  fleet('c3-hph', 'Class 3 HPH', 5),
];

const BOATS = [
  boat('1234', ['default', 'c1-irc', 'c1-hph'], 'Checkmate'),
  boat('IRL 88', ['default', 'c1-hph']),
  boat('4', ['default', 'c1-irc']),
  boat('2001', ['default', 'c2-hph']),
  boat('3050', ['default', 'c3-irc', 'c3-hph']),
  boat('3007', ['default', 'c3-hph']),
];

describe('buildStartersChecklist', () => {
  it('merges fleets that share a boat when there is no start sequence', () => {
    const tables = buildStartersChecklist({ fleets: FLEETS, competitors: BOATS });
    expect(tables.map((t) => t.heading)).toEqual(['Class 1', 'Class 2 HPH', 'Class 3']);
    expect(tables[0].boats.map((b) => b.sailNumber)).toEqual(['4', 'IRL 88', '1234']);
    expect(tables[1].boats.map((b) => b.sailNumber)).toEqual(['2001']);
    expect(tables[2].boats.map((b) => b.sailNumber)).toEqual(['3007', '3050']);
  });

  it('lists a boat once per table however many of the start\'s fleets it is in', () => {
    const tables = buildStartersChecklist({ fleets: FLEETS, competitors: BOATS });
    const all = tables.flatMap((t) => t.boats.map((b) => b.sailNumber));
    expect(all.filter((s) => s === '1234')).toHaveLength(1);
    expect(all).toHaveLength(BOATS.length);
  });

  it('follows the default start sequence when the series has one', () => {
    // Classes 3 and 2 start together on this club's Tuesday sequence, and
    // Class 1 IRC and HPH share a gun as ever.
    const tables = buildStartersChecklist({
      fleets: FLEETS,
      competitors: BOATS,
      startGroups: [
        { fleetIds: ['c3-irc', 'c3-hph', 'c2-hph'], intervalMinutes: 0 },
        { fleetIds: ['c1-irc', 'c1-hph'], intervalMinutes: 5 },
      ],
    });
    expect(tables.map((t) => t.heading)).toEqual(['Class 2 HPH / Class 3 IRC / Class 3 HPH', 'Class 1']);
    expect(tables[0].boats.map((b) => b.sailNumber)).toEqual(['2001', '3007', '3050']);
  });

  it('gives a fleet outside every start group a table of its own', () => {
    const tables = buildStartersChecklist({
      fleets: FLEETS,
      competitors: BOATS,
      startGroups: [{ fleetIds: ['c1-irc', 'c1-hph'], intervalMinutes: 0 }],
    });
    expect(tables.map((t) => t.heading)).toEqual(['Class 1', 'Class 2 HPH', 'Class 3 IRC', 'Class 3 HPH']);
    // Without the merge rule, a boat in both Class 3 fleets is on both tables:
    // the sequence says they are separate starts.
    expect(tables[2].boats.map((b) => b.sailNumber)).toEqual(['3050']);
    expect(tables[3].boats.map((b) => b.sailNumber)).toEqual(['3007', '3050']);
  });

  it('puts the boats of a single-fleet series in one unheaded table', () => {
    const tables = buildStartersChecklist({
      fleets: [fleet('default', 'Default', 0)],
      competitors: [boat('20', ['default']), boat('3', ['default'], 'Tern')],
    });
    expect(tables).toEqual([
      { heading: null, boats: [{ sailNumber: '3', boatName: 'Tern' }, { sailNumber: '20' }] },
    ]);
  });

  it('lists an unassigned boat on a multi-fleet series last, unheaded', () => {
    const tables = buildStartersChecklist({
      fleets: FLEETS,
      competitors: [...BOATS, boat('999', ['default'])],
    });
    expect(tables.at(-1)).toEqual({ heading: null, boats: [{ sailNumber: '999' }] });
    expect(tables).toHaveLength(4);
  });

  it('makes no table for a fleet with nobody in it', () => {
    const tables = buildStartersChecklist({
      fleets: [...FLEETS, fleet('c4', 'Class 4', 6)],
      competitors: BOATS,
    });
    expect(tables.map((t) => t.heading)).not.toContain('Class 4');
  });

  it('uses the latest round\'s fleets on a split-fleet series', () => {
    // Round 2 re-dealt the fleets; assignment appends, so a boat holds both
    // rounds' fleets. Only the latest round is racing.
    const fleets = [
      fleet('default', 'Default', 0),
      fleet('r1-y', 'Yellow', 1, 'round-1'),
      fleet('r1-b', 'Blue', 2, 'round-1'),
      fleet('r2-y', 'Yellow', 3, 'round-2'),
      fleet('r2-b', 'Blue', 4, 'round-2'),
    ];
    const tables = buildStartersChecklist({
      fleets,
      competitors: [
        boat('218456', ['default', 'r1-y', 'r2-b']),
        boat('201122', ['default', 'r1-b', 'r2-b']),
        boat('219000', ['default', 'r1-b', 'r2-y']),
      ],
    });
    expect(tables.map((t) => t.heading)).toEqual(['Yellow', 'Blue']);
    expect(tables[0].boats.map((b) => b.sailNumber)).toEqual(['219000']);
    expect(tables[1].boats.map((b) => b.sailNumber)).toEqual(['201122', '218456']);
  });

  it('orders by the number on the sail, not the national prefix', () => {
    const tables = buildStartersChecklist({
      fleets: [fleet('default', 'Default', 0)],
      competitors: [boat('IRL 210', ['default']), boat('GBR 12', ['default']), boat('IRL 12', ['default'])],
    });
    expect(tables[0].boats.map((b) => b.sailNumber)).toEqual(['GBR 12', 'IRL 12', 'IRL 210']);
  });
});

describe('checklistHeading', () => {
  it('is the words the fleet names share', () => {
    expect(checklistHeading(['Class 1 IRC', 'Class 1 HPH', 'Class 1 ECHO'])).toBe('Class 1');
    expect(checklistHeading(['Cruisers 2 - IRC', 'Cruisers 2 - ECHO'])).toBe('Cruisers 2');
  });

  it('joins names that differ by more than the scoring system', () => {
    // "Class" says nothing; "Class 1" would say the wrong thing.
    expect(checklistHeading(['Class 2 HPH', 'Class 3 IRC', 'Class 3 HPH'])).toBe('Class 2 HPH / Class 3 IRC / Class 3 HPH');
    expect(checklistHeading(['Class 1 IRC', 'Class 10 IRC'])).toBe('Class 1 IRC / Class 10 IRC');
  });

  it('accepts a one-word shared prefix', () => {
    expect(checklistHeading(['Cruisers IRC', 'Cruisers ECHO'])).toBe('Cruisers');
  });

  it('joins the names when they share no leading words', () => {
    expect(checklistHeading(['IRC Class 1', 'ECHO Class 1'])).toBe('IRC Class 1 / ECHO Class 1');
  });

  it('is the fleet name itself for a lone fleet', () => {
    expect(checklistHeading(['ILCA 7'])).toBe('ILCA 7');
  });
});
