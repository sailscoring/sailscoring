/**
 * The starters checklist groups the entry list into one table per start,
 * not per fleet: a class scored under IRC and HPH at once is one table with
 * each boat on it once.
 */
import { describe, it, expect } from 'vitest';

import {
  CHECKLIST_DENSITIES,
  KEEP_WHOLE_ROWS,
  buildStartersChecklist,
  checklistHeading,
  planChecklistSheet,
  type ChecklistSheet,
} from '@/lib/starters-checklist';

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

  it('carries each boat\'s class onto the sheet', () => {
    const tables = buildStartersChecklist({
      fleets: [fleet('default', 'Default', 0), fleet('py', 'PY Fleet', 1)],
      competitors: [
        { ...boat('798', ['default', 'py']), boatClass: 'RS 600' },
        { ...boat('6', ['default', 'py']), boatClass: 'Finn' },
        boat('38', ['default', 'py']),
      ],
    });
    expect(tables[0].boats).toEqual([
      { sailNumber: '6', boatClass: 'Finn' },
      { sailNumber: '38' },
      { sailNumber: '798', boatClass: 'RS 600' },
    ]);
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

describe('planChecklistSheet', () => {
  const headed = (...boats: number[]) => boats.map((n) => ({ boats: n, headed: true }));
  // HYC's Dinghy Frostbite: ILCA 7, ILCA 6, ILCA 4, Melges 15, PY Fleet.
  const FROSTBITE = headed(15, 7, 4, 8, 17);

  /** The pages each table's rows were set on. */
  const pagesOf = (sheet: ChecklistSheet, table: number) =>
    new Set(sheet.pages.flatMap((cols, p) => (cols.some((c) => c.pieces.some((x) => x.table === table)) ? [p] : [])));
  const pieces = (sheet: ChecklistSheet) => sheet.pages.flatMap((cols) => cols.flatMap((c) => c.pieces));

  /** Every row of every table set once, in order, spare rows included. */
  const expectEveryRowOnce = (sheet: ChecklistSheet, tables: { boats: number }[]) => {
    tables.forEach((t, i) => {
      const mine = pieces(sheet).filter((x) => x.table === i);
      let next = 0;
      for (const x of mine) {
        expect(x.from).toBe(next);
        next = x.to;
      }
      expect(next).toBe(t.boats + sheet.density.spareRows);
    });
  };

  it('tightens a sheet a few rows over one page onto one', () => {
    const sheet = planChecklistSheet(FROSTBITE);
    expect(sheet.pages).toHaveLength(1);
    // Giving up a spare row under each start is enough; the rows stay full size.
    expect(sheet.density).toBe(CHECKLIST_DENSITIES[1]);
    expectEveryRowOnce(sheet, FROSTBITE);
  });

  it('sets a short sheet as designed, on one page', () => {
    const tables = headed(6, 3, 2, 3, 7);
    const sheet = planChecklistSheet(tables);
    expect(sheet.pages).toHaveLength(1);
    expect(sheet.density).toBe(CHECKLIST_DENSITIES[0]);
    expectEveryRowOnce(sheet, tables);
  });

  it('prints a sheet that needs two pages however it is set at full size', () => {
    const tables = headed(24, 11, 6, 13, 27);
    const sheet = planChecklistSheet(tables);
    expect(sheet.pages).toHaveLength(2);
    expect(sheet.density).toBe(CHECKLIST_DENSITIES[0]);
    expectEveryRowOnce(sheet, tables);
  });

  it('breaks between starts, never inside one, when the sheet runs to a second page', () => {
    for (const tables of [headed(24, 11, 6, 13, 27), headed(39, 18, 10, 21, 44), headed(30, 30, 30, 30)]) {
      const sheet = planChecklistSheet(tables);
      expect(sheet.pages.length).toBeGreaterThan(1);
      tables.forEach((_, i) => expect(pagesOf(sheet, i).size).toBe(1));
      expectEveryRowOnce(sheet, tables);
    }
  });

  it('runs a start too long for a page of its own over as many as it needs', () => {
    const tables = headed(150);
    const sheet = planChecklistSheet(tables);
    expect(sheet.pages.length).toBeGreaterThan(1);
    expectEveryRowOnce(sheet, tables);
  });

  it('keeps a short table off a column boundary', () => {
    for (const tables of [FROSTBITE, headed(24, 11, 6, 13, 27), headed(5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5)]) {
      const sheet = planChecklistSheet(tables);
      tables.forEach((t, i) => {
        if (t.boats + sheet.density.spareRows <= KEEP_WHOLE_ROWS) {
          expect(pieces(sheet).filter((x) => x.table === i)).toHaveLength(1);
        }
      });
    }
  });

  it('leaves no lone row at the foot of a column or the head of the next', () => {
    for (const tables of [FROSTBITE, headed(24, 11, 6, 13, 27), headed(39, 18, 10, 21, 44)]) {
      for (const x of pieces(planChecklistSheet(tables))) expect(x.to - x.from).toBeGreaterThan(1);
    }
  });

  it('balances the last page rather than filling the first column', () => {
    const sheet = planChecklistSheet(headed(20, 20));
    const [first, second] = sheet.pages[0];
    // Two twenty-boat classes: one to a column, not both run down the first.
    expect(first.pieces.map((x) => x.table)).toEqual([0]);
    expect(second.pieces.map((x) => x.table)).toEqual([1]);
  });

  it('ends the sheet with the notes, once', () => {
    for (const tables of [FROSTBITE, headed(3), headed(39, 18, 10, 21, 44)]) {
      const sheet = planChecklistSheet(tables);
      const withNotes = sheet.pages.flatMap((cols, p) => cols.flatMap((c, k) => (c.notes ? [[p, k]] : [])));
      expect(withNotes).toHaveLength(1);
      expect(withNotes[0][0]).toBe(sheet.pages.length - 1);
    }
  });
});
