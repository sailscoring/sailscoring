/**
 * The sign in/out sheet lists every boat once, under its fleet, with the
 * person expected to sign for it.
 */
import { describe, it, expect } from 'vitest';

import { buildSignInOutSheet } from '@/lib/sign-in-out-sheet';
import type { CompetitorFieldKey, PrimaryPersonLabel } from '@/lib/types';

const fleet = (id: string, name: string, displayOrder: number, splitRoundId?: string) => ({
  id,
  name,
  displayOrder,
  ...(splitRoundId ? { splitRoundId } : {}),
});

const boat = (
  sailNumber: string,
  fleetIds: string[],
  extra: { boatClass?: string; names?: string[]; helms?: string[] } = {},
) => ({ sailNumber, fleetIds, names: extra.names ?? [`Helm ${sailNumber}`], ...extra });

// A Frostbite-shaped series: ILCA rigs as fleets of their own, and a PY
// fleet of mixed classes.
const FLEETS = [
  fleet('default', 'Default', 0),
  fleet('ilca7', 'ILCA 7', 1),
  fleet('ilca6', 'ILCA 6', 2),
  fleet('py', 'PY Fleet', 3),
];

const BOATS = [
  boat('219127', ['default', 'ilca7'], { boatClass: 'ILCA 7' }),
  boat('43', ['default', 'ilca7'], { boatClass: 'ILCA 7' }),
  boat('3006', ['default', 'ilca6'], { boatClass: 'ILCA 6' }),
  boat('IRL 99', ['default', 'py'], { boatClass: '49er' }),
  boat('38', ['default', 'py'], { boatClass: 'IDRA 14', names: ['Alan Carr'] }),
];

function build(
  overrides: {
    fleets?: ReturnType<typeof fleet>[];
    competitors?: ReturnType<typeof boat>[];
    primaryPersonLabel?: PrimaryPersonLabel;
    enabledCompetitorFields?: CompetitorFieldKey[];
  } = {},
) {
  return buildSignInOutSheet({
    fleets: overrides.fleets ?? FLEETS,
    competitors: overrides.competitors ?? BOATS,
    primaryPersonLabel: overrides.primaryPersonLabel ?? 'helm',
    enabledCompetitorFields: overrides.enabledCompetitorFields ?? ['boatClass'],
  });
}

describe('buildSignInOutSheet', () => {
  it('makes one table per fleet, in fleet order, sail numbers in number order', () => {
    const sheet = build();
    expect(sheet.tables.map((t) => t.heading)).toEqual(['ILCA 7', 'ILCA 6', 'PY Fleet']);
    expect(sheet.tables[0].rows.map((r) => r.sailNumber)).toEqual(['43', '219127']);
    // National prefixes are ignored: the number is what is on the sail.
    expect(sheet.tables[2].rows.map((r) => r.sailNumber)).toEqual(['38', 'IRL 99']);
  });

  it('lists a boat scored in two fleets once, under the fleets merged', () => {
    const sheet = build({
      fleets: [fleet('c1-irc', 'Class 1 IRC', 0), fleet('c1-hph', 'Class 1 HPH', 1), fleet('c2', 'Class 2 HPH', 2)],
      competitors: [boat('1234', ['c1-irc', 'c1-hph']), boat('88', ['c1-hph']), boat('2001', ['c2'])],
    });
    expect(sheet.tables.map((t) => t.heading)).toEqual(['Class 1', 'Class 2 HPH']);
    expect(sheet.tables[0].rows.map((r) => r.sailNumber)).toEqual(['88', '1234']);
  });

  it('ignores the start sequence: two fleets that start together are still two fleets', () => {
    // groupEntriesByStart is only given start groups by the starters
    // checklist; the sheet takes none, so nothing here can merge ILCA 7 and
    // ILCA 6.
    expect(build().tables.map((t) => t.heading)).toContain('ILCA 6');
  });

  it('heads nothing on a series with a single fleet', () => {
    const sheet = build({
      fleets: [fleet('default', 'Default', 0)],
      competitors: [boat('1', ['default']), boat('2', ['default'])],
    });
    expect(sheet.tables).toEqual([
      { heading: null, rows: [{ sailNumber: '1', person: 'Helm 1' }, { sailNumber: '2', person: 'Helm 2' }] },
    ]);
  });

  it('lists a split-fleet series under the latest round only', () => {
    const sheet = build({
      fleets: [
        fleet('r1-y', 'Yellow', 1, 'q1'),
        fleet('r1-b', 'Blue', 2, 'q1'),
        fleet('r2-y', 'Yellow', 3, 'q2'),
        fleet('r2-b', 'Blue', 4, 'q2'),
      ],
      competitors: [boat('1', ['r1-y', 'r2-b']), boat('2', ['r1-b', 'r2-y'])],
    });
    expect(sheet.tables.map((t) => [t.heading, t.rows.map((r) => r.sailNumber)])).toEqual([
      ['Yellow', ['2']],
      ['Blue', ['1']],
    ]);
  });

  describe('the class column', () => {
    it('carries each boat’s class when the series records it', () => {
      const sheet = build();
      expect(sheet.showClass).toBe(true);
      expect(sheet.tables[2].rows[0]).toEqual({ sailNumber: '38', boatClass: 'IDRA 14', person: 'Alan Carr' });
    });

    it('is left out when no boat has a class', () => {
      const sheet = build({ competitors: [boat('1', ['ilca7']), boat('2', ['ilca7'], { boatClass: '  ' })] });
      expect(sheet.showClass).toBe(false);
      expect(sheet.tables[0].rows.every((r) => !('boatClass' in r))).toBe(true);
    });

    it('is left out when the series does not record classes, whatever is stored', () => {
      expect(build({ enabledCompetitorFields: [] }).showClass).toBe(false);
    });
  });

  describe('who signs', () => {
    it('is the primary person, headed Helm, on a helm-primary series', () => {
      const sheet = build({
        competitors: [boat('800', ['ilca7'], { names: ['Gary Cullen', 'Mark McLoughlin'] })],
      });
      expect(sheet.personHeader).toBe('Helm');
      expect(sheet.tables[0].rows[0].person).toBe('Gary Cullen & Mark McLoughlin');
    });

    it('is the recorded helm on an owner-primary series that records helms', () => {
      const sheet = build({
        primaryPersonLabel: 'owner',
        enabledCompetitorFields: ['helm'],
        competitors: [
          boat('1', ['ilca7'], { names: ['An Owner'], helms: ['A Helm'] }),
          // No helm recorded for this one: the owner is the best the sheet
          // can do.
          boat('2', ['ilca7'], { names: ['Another Owner'] }),
        ],
      });
      expect(sheet.personHeader).toBe('Helm');
      expect(sheet.tables[0].rows.map((r) => r.person)).toEqual(['A Helm', 'Another Owner']);
    });

    it('is the primary person under the series’ own label when no helm is known', () => {
      const sheet = build({
        primaryPersonLabel: 'owner',
        enabledCompetitorFields: ['helm'],
        competitors: [boat('1', ['ilca7'], { names: ['An Owner'] })],
      });
      expect(sheet.personHeader).toBe('Owner');
      expect(sheet.tables[0].rows[0].person).toBe('An Owner');
    });
  });
});
