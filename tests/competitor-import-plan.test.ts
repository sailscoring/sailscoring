import { describe, it, expect } from 'vitest';
import {
  planFleetCreation,
  type FleetPlanInput,
  type PlanRow,
  type RatingSystem,
} from '@/lib/competitor-import-plan';
import type { Fleet, Competitor } from '@/lib/types';

// ── Test helpers ────────────────────────────────────────────────────────────

function row(csvFleetNames: string[], ratings: RatingSystem[] = []): PlanRow {
  return { csvFleetNames, ratings: new Set(ratings) };
}

function existingFleet(
  name: string,
  scoringSystem: Fleet['scoringSystem'],
  id: string = `existing-${name}`,
): Pick<Fleet, 'id' | 'name' | 'scoringSystem'> {
  return { id, name, scoringSystem };
}

function existingCompetitor(boatClass?: string): Pick<Competitor, 'boatClass'> {
  return boatClass ? { boatClass } : {};
}

function callPlan(overrides: Partial<FleetPlanInput>) {
  const defaults: FleetPlanInput = {
    rows: [],
    existingFleets: [],
    existingCompetitors: [],
    csvHasClassColumn: false,
    seriesScoringMode: 'handicap',
    alsoCreateScratch: {},
  };
  return planFleetCreation({ ...defaults, ...overrides });
}

// ── Decision-table cases ────────────────────────────────────────────────────

describe('planFleetCreation — scratch-mode series', () => {
  it('passes through one scratch fleet per CSV name regardless of ratings', () => {
    const plan = callPlan({
      seriesScoringMode: 'scratch',
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['echo']),
        row(['CR 1'], ['irc']),
      ],
    });
    expect(plan.proposed).toHaveLength(2);
    expect(plan.proposed[0]).toMatchObject({
      name: 'CR 0',
      scoringSystem: 'scratch',
      source: 'no-ratings',
      isExisting: false,
      rowIndices: [0, 1],
    });
    expect(plan.proposed[1]).toMatchObject({
      name: 'CR 1',
      scoringSystem: 'scratch',
      isExisting: false,
      rowIndices: [2],
    });
  });
});

describe('planFleetCreation — no ratings present', () => {
  it('creates one scratch fleet with the bare group name', () => {
    const plan = callPlan({ rows: [row(['CR 0']), row(['CR 0'])] });
    expect(plan.proposed).toHaveLength(1);
    expect(plan.proposed[0]).toMatchObject({
      name: 'CR 0',
      scoringSystem: 'scratch',
      source: 'no-ratings',
      isExisting: false,
      rowIndices: [0, 1],
    });
  });

  it('uses the default fleet name when the row has no fleet column value', () => {
    const plan = callPlan({ rows: [row([])] });
    expect(plan.proposed[0]).toMatchObject({
      name: 'Default',
      scoringSystem: 'scratch',
    });
  });
});

describe('planFleetCreation — single-system case', () => {
  it('creates one fleet of that system, bare name, with all rows', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['irc']),
      ],
    });
    expect(plan.proposed).toHaveLength(1);
    expect(plan.proposed[0]).toMatchObject({
      name: 'CR 0',
      scoringSystem: 'irc',
      source: 'rating-single',
      isExisting: false,
      rowIndices: [0, 1],
    });
  });

  it('includes unrated rows alongside rated ones in single-system case', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0']), // unrated — still goes in CR 0 (IRC)
      ],
    });
    expect(plan.proposed[0].rowIndices).toEqual([0, 1]);
  });
});

describe('planFleetCreation — multi-system case', () => {
  it('splits into one fleet per system with suffixed names', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),  // IRC only → joins CR 0 (IRC)
        row(['CR 0'], ['echo']), // ECHO only → joins CR 0 (ECHO)
      ],
    });
    expect(plan.proposed).toHaveLength(2);
    const ircFleet = plan.proposed.find((p) => p.scoringSystem === 'irc');
    const echoFleet = plan.proposed.find((p) => p.scoringSystem === 'echo');
    expect(ircFleet).toMatchObject({ name: 'CR 0 (IRC)', source: 'rating-split', rowIndices: [0] });
    expect(echoFleet).toMatchObject({ name: 'CR 0 (ECHO)', source: 'rating-split', rowIndices: [1] });
  });

  it('puts dual-rated boats in both fleets', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['echo']),
        row(['CR 0'], ['irc', 'echo']), // both → both fleets
      ],
    });
    const ircFleet = plan.proposed.find((p) => p.scoringSystem === 'irc')!;
    const echoFleet = plan.proposed.find((p) => p.scoringSystem === 'echo')!;
    expect(ircFleet.rowIndices).toEqual([0, 2]);
    expect(echoFleet.rowIndices).toEqual([1, 2]);
  });

  it('puts unrated boats in every auto-created handicap fleet for the group', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['echo']),
        row(['CR 0']), // unrated → joins both CR 0 (IRC) and CR 0 (ECHO)
      ],
    });
    const ircFleet = plan.proposed.find((p) => p.scoringSystem === 'irc')!;
    const echoFleet = plan.proposed.find((p) => p.scoringSystem === 'echo')!;
    expect(ircFleet.rowIndices).toEqual([0, 2]);
    expect(echoFleet.rowIndices).toEqual([1, 2]);
  });
});

describe('planFleetCreation — alsoCreateScratch toggle', () => {
  it('appends a scratch sibling containing every row in the group (single-system)', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['irc']),
      ],
      alsoCreateScratch: { 'CR 0': true },
    });
    expect(plan.proposed).toHaveLength(2);
    const scratch = plan.proposed.find((p) => p.source === 'also-scratch')!;
    expect(scratch).toMatchObject({
      name: 'CR 0 (Scratch)',
      scoringSystem: 'scratch',
      isExisting: false,
      rowIndices: [0, 1],
    });
  });

  it('appends a scratch sibling alongside multi-system splits', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['echo']),
      ],
      alsoCreateScratch: { 'CR 0': true },
    });
    expect(plan.proposed).toHaveLength(3);
    const scratch = plan.proposed.find((p) => p.source === 'also-scratch')!;
    expect(scratch.rowIndices).toEqual([0, 1]);
  });

  it('ignores the toggle for groups with no ratings', () => {
    const plan = callPlan({
      rows: [row(['CR 0'])],
      alsoCreateScratch: { 'CR 0': true },
    });
    expect(plan.proposed).toHaveLength(1);
    expect(plan.proposed[0].source).toBe('no-ratings');
  });

  it('only fires for the named group, not for siblings', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 1'], ['irc']),
      ],
      alsoCreateScratch: { 'CR 0': true },
    });
    expect(plan.proposed.filter((p) => p.source === 'also-scratch')).toHaveLength(1);
    expect(plan.proposed.find((p) => p.source === 'also-scratch')!.csvFleetName).toBe('CR 0');
  });
});

describe('planFleetCreation — existing fleet reuse', () => {
  it('reuses an existing fleet whose name and system match', () => {
    const plan = callPlan({
      rows: [row(['CR 0'], ['irc'])],
      existingFleets: [existingFleet('CR 0', 'irc', 'fleet-1')],
    });
    expect(plan.proposed[0]).toMatchObject({
      name: 'CR 0',
      scoringSystem: 'irc',
      isExisting: true,
      existingFleetId: 'fleet-1',
    });
  });

  it('matches existing fleet names case-insensitively, preserving stored casing', () => {
    const plan = callPlan({
      rows: [row(['cr 0'], ['irc'])],
      existingFleets: [existingFleet('CR 0', 'irc', 'fleet-1')],
    });
    expect(plan.proposed[0].name).toBe('CR 0');
    expect(plan.proposed[0].existingFleetId).toBe('fleet-1');
  });

  it('forces a suffix when bare name is taken by a different system (single-system)', () => {
    const plan = callPlan({
      rows: [row(['CR 0'], ['irc'])],
      existingFleets: [existingFleet('CR 0', 'scratch', 'fleet-scratch')],
    });
    // Existing CR 0 is scratch, plan wants IRC → suffix to avoid mutation.
    expect(plan.proposed[0]).toMatchObject({
      name: 'CR 0 (IRC)',
      scoringSystem: 'irc',
      isExisting: false,
    });
  });

  it('multi-system: reuses bare-name existing for one system, suffixes the rest', () => {
    // User-confirmed scope: existing CR 0 (IRC) → reuse for IRC, create CR 0 (ECHO).
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['echo']),
      ],
      existingFleets: [existingFleet('CR 0', 'irc', 'fleet-irc')],
    });
    const ircFleet = plan.proposed.find((p) => p.scoringSystem === 'irc')!;
    const echoFleet = plan.proposed.find((p) => p.scoringSystem === 'echo')!;
    expect(ircFleet).toMatchObject({ name: 'CR 0', isExisting: true, existingFleetId: 'fleet-irc' });
    expect(echoFleet).toMatchObject({ name: 'CR 0 (ECHO)', isExisting: false });
  });

  it('multi-system: reuses both bare and suffixed existing fleets when present', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['echo']),
      ],
      existingFleets: [
        existingFleet('CR 0', 'irc', 'fleet-irc'),
        existingFleet('CR 0 (ECHO)', 'echo', 'fleet-echo'),
      ],
    });
    const ircFleet = plan.proposed.find((p) => p.scoringSystem === 'irc')!;
    const echoFleet = plan.proposed.find((p) => p.scoringSystem === 'echo')!;
    expect(ircFleet.existingFleetId).toBe('fleet-irc');
    expect(echoFleet.existingFleetId).toBe('fleet-echo');
  });

  it('reuses bare-name existing for a no-rating group regardless of its system', () => {
    // Pragmatic: the user already chose this fleet's name and system; we put
    // the boats in it. Missing-rating warnings will surface separately.
    const plan = callPlan({
      rows: [row(['CR 0'])],
      existingFleets: [existingFleet('CR 0', 'irc', 'fleet-irc')],
    });
    expect(plan.proposed[0]).toMatchObject({
      name: 'CR 0',
      scoringSystem: 'irc',
      isExisting: true,
      existingFleetId: 'fleet-irc',
    });
  });

  it('reuses an existing scratch sibling when the toggle is on', () => {
    const plan = callPlan({
      rows: [row(['CR 0'], ['irc'])],
      existingFleets: [
        existingFleet('CR 0', 'irc', 'fleet-irc'),
        existingFleet('CR 0 (Scratch)', 'scratch', 'fleet-scratch'),
      ],
      alsoCreateScratch: { 'CR 0': true },
    });
    const scratch = plan.proposed.find((p) => p.source === 'also-scratch')!;
    expect(scratch.existingFleetId).toBe('fleet-scratch');
  });
});

describe('planFleetCreation — boatClass auto-fill flag', () => {
  it('is true when CSV has no Class column and no existing competitor has boatClass', () => {
    const plan = callPlan({
      rows: [row(['CR 0'])],
      csvHasClassColumn: false,
      existingCompetitors: [existingCompetitor(), existingCompetitor()],
    });
    expect(plan.shouldFillBoatClassFromFleetName).toBe(true);
  });

  it('is false when the CSV has a Class column', () => {
    const plan = callPlan({
      rows: [row(['CR 0'])],
      csvHasClassColumn: true,
    });
    expect(plan.shouldFillBoatClassFromFleetName).toBe(false);
  });

  it('is false when any existing competitor already has a boatClass', () => {
    const plan = callPlan({
      rows: [row(['CR 0'])],
      csvHasClassColumn: false,
      existingCompetitors: [existingCompetitor(), existingCompetitor('Sigma 33')],
    });
    expect(plan.shouldFillBoatClassFromFleetName).toBe(false);
  });
});

describe('planFleetCreation — multi-fleet rows (pipe-delimited)', () => {
  it('contributes a row to each of its CSV fleet groups independently', () => {
    const plan = callPlan({
      rows: [
        row(['PY', 'M15']),    // unrated, dual fleet
        row(['PY'], ['py']),   // PY only, with rating
      ],
    });
    // Two groups: PY (one rating system) and M15 (no ratings).
    expect(plan.proposed).toHaveLength(2);
    const py = plan.proposed.find((p) => p.csvFleetName === 'PY')!;
    const m15 = plan.proposed.find((p) => p.csvFleetName === 'M15')!;
    expect(py).toMatchObject({ scoringSystem: 'py', source: 'rating-single' });
    expect(py.rowIndices).toEqual([0, 1]); // both rows are in PY
    expect(m15).toMatchObject({ scoringSystem: 'scratch', source: 'no-ratings' });
    expect(m15.rowIndices).toEqual([0]); // only the dual-fleet row is in M15
  });
});
