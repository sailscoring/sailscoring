import { describe, expect, it } from 'vitest';

import {
  cutFromStandings,
  medalSeatsOpen,
  repechageBoatsOutsidePool,
  repechageEligibleIds,
  repechageStandings,
  splitFleetStandings,
  type SplitFleetConfig,
  type SplitFleetData,
  type SplitRound,
} from '@/lib/split-fleets';
import type { Competitor, Finish, Fleet, Race, RaceStart } from '@/lib/types';

import { championsCupConfig, ilca2026Config } from './fixtures/split-fleet-configs';

function competitor(id: string, fleetIds: string[], sail: number): Competitor {
  return {
    id,
    seriesId: 's1',
    fleetIds,
    sailNumber: `IRL ${sail}`,
    names: [`Helm ${id}`],
    clubs: [],
    gender: '',
    age: null,
    createdAt: sail,
  };
}

function fleet(id: string): Fleet {
  return { id, seriesId: 's1', name: id, displayOrder: 0, scoringSystem: 'scratch' };
}

function race(id: string, raceNumber: number): Race {
  return { id, seriesId: 's1', raceNumber, name: null, date: '2026-10-03', createdAt: raceNumber };
}

function start(raceId: string, fleetId: string, stage: RaceStart['stage'], n: number): RaceStart {
  return { id: `${raceId}-${fleetId}`, raceId, fleetIds: [fleetId], stage, stageRaceNumber: n };
}

function finish(raceId: string, competitorId: string, sortOrder: number | null, code: Finish['resultCode'] = null): Finish {
  return {
    id: `${raceId}-${competitorId}`,
    raceId,
    competitorId,
    sortOrder,
    tiedWithPrevious: false,
    resultCode: code,
    startPresent: null,
    penaltyCode: null,
    penaltyOverride: null,
    redressMethod: null,
    redressExcludeRaceIds: null,
    redressIncludeRaceIds: null,
    redressIncludeAllLater: false,
    redressPoints: null,
  };
}

function round(
  id: string,
  stage: SplitRound['stage'],
  fleetIds: string[],
  extra: Partial<SplitRound> = {},
): SplitRound {
  return {
    id,
    seriesId: 's1',
    stage,
    fromStageRace: 1,
    fleetIds,
    method: 'manual',
    basis: null,
    createdAt: 0,
    ...extra,
  };
}

/** Finishes for one fleet's race, in crossing order. */
function sheet(raceId: string, order: string[]): Finish[] {
  return order.map((id, i) => finish(raceId, id, i + 1));
}

/**
 * A Champions' Cup in miniature: flights A and B of four, two qualifying
 * races each; a1 and b1 go straight to the Final Series; a2, a3, b2 and b3
 * sail a one-fleet repêchage of two races, and a3 is promoted from it.
 */
function championsCup(opts: {
  config?: SplitFleetConfig;
  repechageFleets?: string[][];
  repechageSheets?: Record<string, string[][]>;
  promoted?: Record<string, 'repechage' | 'cut-ranking' | 'redress'>;
  medalSheet?: string[];
} = {}): SplitFleetData {
  const repechageFleets = opts.repechageFleets ?? [['a2', 'a3', 'b2', 'b3']];
  const repFleetIds = repechageFleets.map((_, i) => `rep${i}`);
  const promoted = opts.promoted ?? { a3: 'repechage' };
  const medalMembers = new Set(['a1', 'b1', ...Object.keys(promoted)]);
  const ids = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'];
  const competitors = ids.map((id, i) => {
    const fleetIds = [id.startsWith('a') ? 'qa' : 'qb'];
    repechageFleets.forEach((members, f) => {
      if (members.includes(id)) fleetIds.push(repFleetIds[f]);
    });
    if (medalMembers.has(id)) fleetIds.push('medal');
    return competitor(id, fleetIds, i + 1);
  });
  const races: Race[] = [];
  const raceStarts: RaceStart[] = [];
  const finishes: Finish[] = [];
  let n = 0;
  const addRace = (id: string, fleetId: string, stage: RaceStart['stage'], stageRace: number, order: string[]) => {
    races.push(race(id, ++n));
    raceStarts.push(start(id, fleetId, stage, stageRace));
    finishes.push(...sheet(id, order));
  };
  // Both flights finish in entry order.
  for (const q of [1, 2]) {
    addRace(`qa${q}`, 'qa', 'qualifying', q, ['a1', 'a2', 'a3', 'a4']);
    addRace(`qb${q}`, 'qb', 'qualifying', q, ['b1', 'b2', 'b3', 'b4']);
  }
  const repSheets = opts.repechageSheets ?? {
    rep0: [
      ['a3', 'b2', 'a2', 'b3'],
      ['a3', 'a2', 'b3', 'b2'],
    ],
  };
  for (const [fleetId, sheets] of Object.entries(repSheets)) {
    sheets.forEach((order, i) => addRace(`${fleetId}-r${i + 1}`, fleetId, 'repechage', i + 1, order));
  }
  if (opts.medalSheet) addRace('m1', 'medal', 'medal', 1, opts.medalSheet);
  return {
    config: opts.config ?? championsCupConfig(),
    rounds: [
      round('q', 'qualifying', ['qa', 'qb']),
      round('m', 'medal', ['medal'], {
        method: 'medal-select',
        overrides: Object.fromEntries(Object.keys(promoted).map((id) => [id, 'medal'])),
        overrideReasons: promoted,
      }),
      round('r', 'repechage', repFleetIds),
    ],
    fleets: ['qa', 'qb', 'medal', ...repFleetIds].map(fleet),
    competitors,
    races,
    raceStarts,
    finishes,
  };
}

describe('repechageStandings', () => {
  it('ranks the repêchage on its own races alone', () => {
    const [table] = repechageStandings(championsCup());
    // Qualifying: a2 was 2nd in flight A, b3 3rd in flight B. Neither counts.
    expect(table.rows.map((r) => [r.competitor.id, r.net, r.rank])).toEqual([
      ['a3', 2, 1],
      ['a2', 5, 2],
      ['b2', 6, 3],
      ['b3', 7, 4],
    ]);
    expect(table.rows.flatMap((r) => r.cells.map((c) => c.stage))).toEqual(
      Array(8).fill('repechage'),
    );
  });

  it('lists every boat that sailed it, promoted or not', () => {
    const [table] = repechageStandings(championsCup());
    expect(table.rows.filter((r) => r.promoted).map((r) => r.competitor.id)).toEqual(['a3']);
    expect(table.rows).toHaveLength(4);
  });

  it('scores a boat who did not finish her repêchage fleet plus one, with no discard', () => {
    const [table] = repechageStandings(
      championsCup({ repechageSheets: { rep0: [['a3', 'b2', 'a2'], ['a3', 'a2', 'b3', 'b2']] } }),
    );
    const b3 = table.rows.find((r) => r.competitor.id === 'b3')!;
    expect(b3.cells.map((c) => [c.points, c.code, c.discarded])).toEqual([
      [5, 'DNC', false],
      [3, null, false],
    ]);
    expect(b3.net).toBe(8);
  });

  it('ranks each repêchage fleet on its own', () => {
    const tables = repechageStandings(
      championsCup({
        repechageFleets: [['a2', 'b2'], ['a3', 'b3']],
        repechageSheets: { rep0: [['b2', 'a2']], rep1: [['a3', 'b3']] },
      }),
    );
    expect(tables.map((t) => t.rows.map((r) => [r.competitor.id, r.rank]))).toEqual([
      [['b2', 1], ['a2', 2]],
      [['a3', 1], ['b3', 2]],
    ]);
  });

  it('breaks a tie on points by A8, and shares a rank A8 cannot separate', () => {
    // a2 and a3 tie on 3 and are split on the last race; b2 and b3 never
    // sailed, so nothing separates them.
    const [table] = repechageStandings(
      championsCup({ repechageSheets: { rep0: [['a2', 'a3'], ['a3', 'a2']] } }),
    );
    expect(table.rows.map((r) => [r.competitor.id, r.net, r.rank])).toEqual([
      ['a3', 3, 1],
      ['a2', 3, 2],
      ['b2', 10, 3],
      ['b3', 10, 3],
    ]);
  });

  it('is empty without a repêchage', () => {
    const data = championsCup();
    expect(repechageStandings({ ...data, rounds: data.rounds.filter((r) => r.stage !== 'repechage') })).toEqual([]);
  });
});

describe('the championship, with a repêchage beside it', () => {
  it('holds no repêchage score, and ranks as it would without the repêchage races', () => {
    const data = championsCup({ medalSheet: ['a3', 'a1', 'b1'] });
    const rows = splitFleetStandings(data);
    expect(rows.flatMap((r) => r.cells).some((c) => c.stage === 'repechage')).toBe(false);
    const without = splitFleetStandings({
      ...data,
      raceStarts: data.raceStarts.filter((s) => s.stage !== 'repechage'),
    });
    expect(rows.map((r) => [r.competitor.id, r.net, r.rank])).toEqual(
      without.map((r) => [r.competitor.id, r.net, r.rank]),
    );
  });

  it('carries nothing into the Final Series for a promoted boat, as for the rest', () => {
    const rows = splitFleetStandings(championsCup({ medalSheet: ['a3', 'a1', 'b1'] }));
    expect(rows.slice(0, 3).map((r) => [r.competitor.id, r.net, r.medal])).toEqual([
      ['a3', 1, true],
      ['a1', 2, true],
      ['b1', 3, true],
    ]);
  });

  it('carries a promoted boat her own score where the medal stage carries one', () => {
    const config: SplitFleetConfig = {
      ...championsCupConfig(),
      medal: { ...championsCupConfig().medal!, carry: 'net' },
    };
    const rows = splitFleetStandings(championsCup({ config, medalSheet: ['a3', 'a1', 'b1'] }));
    // a3 was third twice in flight A: 6, then first in the medal race.
    const a3 = rows.find((r) => r.competitor.id === 'a3')!;
    expect(a3.net).toBe(7);
  });

  it('marks how a promoted boat got her seat, and not a redress', () => {
    const rows = splitFleetStandings(
      championsCup({ promoted: { a3: 'repechage', b2: 'cut-ranking', a2: 'redress' } }),
    );
    const via = Object.fromEntries(rows.map((r) => [r.competitor.id, r.promotedVia]));
    expect(via).toMatchObject({ a3: 'repechage', b2: 'cut-ranking', a2: undefined, a1: undefined });
  });
});

describe('cutFromStandings', () => {
  it('ranks every boat on the stage she was cut from, the medal boats included', () => {
    const rows = cutFromStandings(championsCup({ medalSheet: ['a3', 'a1', 'b1'] }));
    expect(rows.every((r) => !r.medal && !r.cells.some((c) => c.stage === 'medal'))).toBe(true);
    // Both flights finished in entry order, so each place ties across them.
    expect(rows.map((r) => [r.competitor.id, r.net, r.rank])).toEqual([
      ['a1', 2, 1],
      ['b1', 2, 1],
      ['a2', 4, 3],
      ['b2', 4, 3],
      ['a3', 6, 5],
      ['b3', 6, 5],
      ['a4', 8, 7],
      ['b4', 8, 7],
    ]);
  });
});

describe('who may sail the repêchage', () => {
  it('is anyone outside the medal fleet where the medal stage carries nothing', () => {
    expect([...repechageEligibleIds(championsCup())].sort()).toEqual(['a2', 'a4', 'b2', 'b3', 'b4']);
  });

  it('is only the top final fleet where a score is carried', () => {
    // ILCA-shaped: Gold and Silver, a halved carry into the medal races.
    const base = championsCup({ config: ilca2026Config(2) });
    const data: SplitFleetData = {
      ...base,
      rounds: [...base.rounds, round('split', 'final', ['gold', 'silver'])],
      fleets: [...base.fleets, fleet('gold'), fleet('silver')],
      competitors: base.competitors.map((c) => ({
        ...c,
        fleetIds: [...c.fleetIds, ['a1', 'b1', 'a2', 'a3'].includes(c.id) ? 'gold' : 'silver'],
      })),
    };
    expect([...repechageEligibleIds(data)].sort()).toEqual(['a2']);
    // b2 and b3 are Silver boats sailing the repêchage, and b2's promotion
    // from the cut ranking would carry a Silver score into Gold's races.
    const withSilver = championsCup({ config: ilca2026Config(2), promoted: { a3: 'repechage', b2: 'cut-ranking' } });
    const divided: SplitFleetData = {
      ...withSilver,
      rounds: [...withSilver.rounds, round('split', 'final', ['gold', 'silver'])],
      competitors: withSilver.competitors.map((c) => ({
        ...c,
        fleetIds: [...c.fleetIds, ['a1', 'b1', 'a2', 'a3'].includes(c.id) ? 'gold' : 'silver'],
      })),
    };
    expect(repechageBoatsOutsidePool(divided, 'halved').map((c) => c.id).sort()).toEqual(['b2', 'b3']);
    expect(repechageBoatsOutsidePool(divided, 'nothing')).toEqual([]);
  });

  it('is everyone outside the medal fleet while the series is undivided, whatever the carry', () => {
    const config: SplitFleetConfig = {
      ...championsCupConfig(),
      medal: { ...championsCupConfig().medal!, carry: 'halved' },
    };
    expect(repechageEligibleIds(championsCup({ config })).size).toBe(5);
  });

  it('is nobody before the medal fleet is selected', () => {
    const data = championsCup();
    expect(repechageEligibleIds({ ...data, rounds: data.rounds.filter((r) => r.stage === 'qualifying') }).size).toBe(0);
  });
});

describe('medalSeatsOpen', () => {
  it('is the medal card size less the boats already in the fleet', () => {
    expect(medalSeatsOpen(championsCup({ promoted: {} }))).toBe(4);
    expect(medalSeatsOpen(championsCup())).toBe(3);
  });
});
