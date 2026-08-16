import { describe, it, expect } from 'vitest';
import {
  planFleetCreation,
  planKeyFor,
  NO_OVERRIDES,
  type FleetPlanInput,
  type FleetPlanOverrides,
  type PlanRow,
  type RatingSystem,
} from '@/lib/competitor-import-plan';
import type { Fleet } from '@/lib/types';

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

function planOverrides(partial: Partial<FleetPlanOverrides>): FleetPlanOverrides {
  return { extraSystems: {}, byFleet: {}, ...partial };
}

function callPlan(input: Partial<FleetPlanInput>) {
  const defaults: FleetPlanInput = {
    rows: [],
    existingFleets: [],
    overrides: NO_OVERRIDES,
  };
  return planFleetCreation({ ...defaults, ...input });
}

// ── Decision-table cases ────────────────────────────────────────────────────

describe('planFleetCreation — column mappings drive system choice', () => {
  it('proposes handicap fleets whenever a rating column is mapped, regardless of any series-level mode', () => {
    // The planner has no notion of series scoringMode — column mappings
    // are authoritative. The importer is responsible for flipping the
    // series mode to 'handicap' when the plan creates handicap fleets.
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['echo']),
        row(['CR 1'], ['irc']),
      ],
    });
    expect(plan.proposed).toHaveLength(3);
    expect(plan.proposed[0]).toMatchObject({
      name: 'CR 0 (ECHO)',
      scoringSystem: 'echo',
      source: 'rating-split',
    });
    expect(plan.proposed[1]).toMatchObject({
      name: 'CR 0 (IRC)',
      scoringSystem: 'irc',
      source: 'rating-split',
    });
    expect(plan.proposed[2]).toMatchObject({
      name: 'CR 1',
      scoringSystem: 'irc',
      source: 'rating-single',
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

  it('reuses a renamed default (sole scratch) fleet for rows with no fleet column', () => {
    // A first import created a "Default" fleet; the user renamed it to
    // "Scratch". Re-importing the same list (no fleet column) must reuse
    // that fleet by identity, not mint a fresh "Default".
    const plan = callPlan({
      rows: [row([]), row([])],
      existingFleets: [existingFleet('Scratch', 'scratch', 'fleet-scratch')],
    });
    expect(plan.proposed).toHaveLength(1);
    expect(plan.proposed[0]).toMatchObject({
      name: 'Scratch',
      scoringSystem: 'scratch',
      source: 'no-ratings',
      isExisting: true,
      existingFleetId: 'fleet-scratch',
    });
  });

  it('reuses the sole scratch fleet even alongside a handicap fleet', () => {
    const plan = callPlan({
      rows: [row([])],
      existingFleets: [
        existingFleet('Scratch', 'scratch', 'fleet-scratch'),
        existingFleet('IRC Div', 'irc', 'fleet-irc'),
      ],
    });
    expect(plan.proposed[0]).toMatchObject({
      name: 'Scratch',
      isExisting: true,
      existingFleetId: 'fleet-scratch',
    });
  });

  it('does not reuse by identity when the reuse target is ambiguous (two scratch fleets)', () => {
    const plan = callPlan({
      rows: [row([])],
      existingFleets: [
        existingFleet('Scratch', 'scratch', 'fleet-a'),
        existingFleet('Overall', 'scratch', 'fleet-b'),
      ],
    });
    expect(plan.proposed[0]).toMatchObject({ name: 'Default', isExisting: false });
  });

  it('still prefers an exact "Default" name match over the sole-scratch fallback', () => {
    const plan = callPlan({
      rows: [row([])],
      existingFleets: [existingFleet('Default', 'scratch', 'fleet-default')],
    });
    expect(plan.proposed[0]).toMatchObject({
      name: 'Default',
      isExisting: true,
      existingFleetId: 'fleet-default',
    });
  });

  it('does not apply the sole-scratch fallback to an explicitly named "Default" group', () => {
    // The CSV literally names a "Default" fleet — that is an explicit choice,
    // not the implicit no-column default, so it should not silently fold into
    // a differently-named sole scratch fleet.
    const plan = callPlan({
      rows: [row(['Default'])],
      existingFleets: [existingFleet('Scratch', 'scratch', 'fleet-scratch')],
    });
    expect(plan.proposed[0]).toMatchObject({ name: 'Default', isExisting: false });
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

describe('planFleetCreation — extra systems', () => {
  it('appends a scratch sibling containing every row in the group (single-system)', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['irc']),
      ],
      overrides: planOverrides({ extraSystems: { 'CR 0': ['scratch'] } }),
    });
    expect(plan.proposed).toHaveLength(2);
    const scratch = plan.proposed.find((p) => p.source === 'added')!;
    expect(scratch).toMatchObject({
      name: 'CR 0 (Scratch)',
      scoringSystem: 'scratch',
      isExisting: false,
      membership: 'all',
      canFilterByRating: false,
      rowIndices: [0, 1],
    });
  });

  it('appends a scratch sibling alongside multi-system splits', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 0'], ['echo']),
      ],
      overrides: planOverrides({ extraSystems: { 'CR 0': ['scratch'] } }),
    });
    expect(plan.proposed).toHaveLength(3);
    const scratch = plan.proposed.find((p) => p.source === 'added')!;
    expect(scratch.rowIndices).toEqual([0, 1]);
  });

  it('adds a scratch sibling to a group with no ratings of its own', () => {
    // The group's own fleet is scratch under the bare name, so the added
    // one is suffixed rather than colliding with it.
    const plan = callPlan({
      rows: [row(['CR 0'])],
      overrides: planOverrides({ extraSystems: { 'CR 0': ['scratch'] } }),
    });
    expect(plan.proposed.map((p) => [p.name, p.source])).toEqual([
      ['CR 0', 'no-ratings'],
      ['CR 0 (Scratch)', 'added'],
    ]);
  });

  it('only fires for the named group, not for siblings', () => {
    const plan = callPlan({
      rows: [
        row(['CR 0'], ['irc']),
        row(['CR 1'], ['irc']),
      ],
      overrides: planOverrides({ extraSystems: { 'CR 0': ['scratch'] } }),
    });
    expect(plan.proposed.filter((p) => p.source === 'added')).toHaveLength(1);
    expect(plan.proposed.find((p) => p.source === 'added')!.csvFleetName).toBe('CR 0');
  });

  it('adds a rating fleet the file says nothing about, holding the whole group', () => {
    // The case the step exists for: an NHC entry list, IRC certificates to
    // follow. Nothing in the file says who holds one, so everyone joins.
    const plan = callPlan({
      rows: [
        row(['Cruisers 1'], ['nhc']),
        row(['Cruisers 1'], ['nhc']),
      ],
      overrides: planOverrides({ extraSystems: { 'Cruisers 1': ['irc'] } }),
    });
    expect(plan.proposed.map((p) => [p.name, p.scoringSystem])).toEqual([
      ['Cruisers 1', 'nhc'],
      ['Cruisers 1 (IRC)', 'irc'],
    ]);
    const irc = plan.proposed[1];
    expect(irc.membership).toBe('all');
    expect(irc.canFilterByRating).toBe(false);
    expect(irc.rowIndices).toEqual([0, 1]);
  });

  it('ignores a system the group already has', () => {
    const plan = callPlan({
      rows: [row(['CR 0'], ['irc'])],
      overrides: planOverrides({ extraSystems: { 'CR 0': ['irc'] } }),
    });
    expect(plan.proposed).toHaveLength(1);
    expect(plan.proposed[0].source).toBe('rating-single');
  });

  it('reuses an existing fleet under the suffixed name', () => {
    const plan = callPlan({
      rows: [row(['CR 0'], ['nhc'])],
      existingFleets: [existingFleet('CR 0 (IRC)', 'irc', 'f-irc')],
      overrides: planOverrides({ extraSystems: { 'CR 0': ['irc'] } }),
    });
    const irc = plan.proposed.find((p) => p.scoringSystem === 'irc')!;
    expect(irc).toMatchObject({ isExisting: true, existingFleetId: 'f-irc' });
  });
});

describe('planFleetCreation — per-fleet overrides', () => {
  const ircAndEcho = [row(['CR 0'], ['irc']), row(['CR 0'], ['echo'])];

  it('keys overrides on group and system, not on position', () => {
    // Adding a system ahead of ECHO in the plan must not shift ECHO's
    // override onto a different fleet.
    const key = planKeyFor('CR 0', 'echo');
    const plan = callPlan({
      rows: ircAndEcho,
      overrides: planOverrides({
        extraSystems: { 'CR 0': ['scratch'] },
        byFleet: { [key]: { name: 'Renamed' } },
      }),
    });
    expect(plan.proposed.find((p) => p.scoringSystem === 'echo')!.name).toBe('Renamed');
    expect(plan.proposed.find((p) => p.scoringSystem === 'irc')!.name).toBe('CR 0 (IRC)');
  });

  it('drops a fleet from the plan', () => {
    const plan = callPlan({
      rows: ircAndEcho,
      overrides: planOverrides({
        byFleet: { [planKeyFor('CR 0', 'echo')]: { drop: true } },
      }),
    });
    expect(plan.proposed.map((p) => p.scoringSystem)).toEqual(['irc']);
  });

  it('widens a split fleet to the whole group', () => {
    const plan = callPlan({
      rows: ircAndEcho,
      overrides: planOverrides({
        byFleet: { [planKeyFor('CR 0', 'irc')]: { membership: 'all' } },
      }),
    });
    const irc = plan.proposed.find((p) => p.scoringSystem === 'irc')!;
    expect(irc.membership).toBe('all');
    expect(irc.rowIndices).toEqual([0, 1]);
  });

  it('narrows a single-system fleet to its rated boats', () => {
    const plan = callPlan({
      rows: [row(['CR 0'], ['irc']), row(['CR 0'])],
      overrides: planOverrides({
        byFleet: { [planKeyFor('CR 0', 'irc')]: { membership: 'rated' } },
      }),
    });
    // The unrated row still joins: a boat nobody rated belongs wherever its
    // group is scored, so the missing rating is visible rather than silent.
    expect(plan.proposed[0].rowIndices).toEqual([0, 1]);
  });

  it('clamps a rated choice the file cannot honour back to all boats', () => {
    const plan = callPlan({
      rows: [row(['CR 0'], ['nhc']), row(['CR 0'], ['nhc'])],
      overrides: planOverrides({
        extraSystems: { 'CR 0': ['irc'] },
        byFleet: { [planKeyFor('CR 0', 'irc')]: { membership: 'rated' } },
      }),
    });
    const irc = plan.proposed.find((p) => p.scoringSystem === 'irc')!;
    expect(irc.membership).toBe('all');
    expect(irc.rowIndices).toEqual([0, 1]);
  });

  it('does not rename a fleet it is reusing rather than creating', () => {
    const plan = callPlan({
      rows: [row(['CR 0'], ['irc'])],
      existingFleets: [existingFleet('CR 0', 'irc', 'f1')],
      overrides: planOverrides({
        byFleet: { [planKeyFor('CR 0', 'irc')]: { name: 'Something else' } },
      }),
    });
    expect(plan.proposed[0]).toMatchObject({ name: 'CR 0', isExisting: true });
  });

  it('ignores a blank rename', () => {
    const plan = callPlan({
      rows: [row(['CR 0'], ['irc'])],
      overrides: planOverrides({
        byFleet: { [planKeyFor('CR 0', 'irc')]: { name: '   ' } },
      }),
    });
    expect(plan.proposed[0].name).toBe('CR 0');
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

  it('reuses an existing scratch sibling when one is added', () => {
    const plan = callPlan({
      rows: [row(['CR 0'], ['irc'])],
      existingFleets: [
        existingFleet('CR 0', 'irc', 'fleet-irc'),
        existingFleet('CR 0 (Scratch)', 'scratch', 'fleet-scratch'),
      ],
      overrides: planOverrides({ extraSystems: { 'CR 0': ['scratch'] } }),
    });
    const scratch = plan.proposed.find((p) => p.source === 'added')!;
    expect(scratch.existingFleetId).toBe('fleet-scratch');
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
