import { describe, expect, it } from 'vitest';

import {
  directSeatsPerFleet,
  ranksEachFleet,
  splitFleetStandings,
  type SplitFleetConfig,
  type SplitFleetData,
  type SplitRound,
} from '@/lib/split-fleets';
import type { Competitor, Finish, Fleet, Race, RaceStart } from '@/lib/types';

import { championsCupConfig, ilca2026Config, openingSeriesMedalConfig } from './fixtures/split-fleet-configs';

function competitor(id: string, fleetIds: string[], n: number): Competitor {
  return { id, seriesId: 's1', fleetIds, sailNumber: id, names: [id], clubs: [], gender: '', age: null, createdAt: n };
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

const round = (id: string, stage: SplitRound['stage'], fleetIds: string[]): SplitRound => ({
  id,
  seriesId: 's1',
  stage,
  fromStageRace: 1,
  fleetIds,
  method: 'manual',
  basis: null,
  createdAt: 0,
});

/**
 * Two flights drawn once: A of four boats, B of three. `sheets` is flight →
 * one crossing order per race ("x DNF" for a code); a flight with fewer
 * sheets has sailed fewer races.
 */
function flights(
  config: SplitFleetConfig,
  sheets: { A: string[][]; B: string[][] },
  medal: string[] = [],
): SplitFleetData {
  const members = { A: ['a1', 'a2', 'a3', 'a4'], B: ['b1', 'b2', 'b3'] };
  const competitors = [
    ...members.A.map((id, i) => competitor(id, ['A', ...(medal.includes(id) ? ['M'] : [])], i)),
    ...members.B.map((id, i) => competitor(id, ['B', ...(medal.includes(id) ? ['M'] : [])], 10 + i)),
  ];
  const races: Race[] = [];
  const raceStarts: RaceStart[] = [];
  const finishes: Finish[] = [];
  for (const fleet of ['A', 'B'] as const) {
    sheets[fleet].forEach((order, i) => {
      const raceId = `${fleet}${i + 1}`;
      races.push({ id: raceId, seriesId: 's1', raceNumber: races.length + 1, name: null, date: '2026-10-03', createdAt: races.length });
      raceStarts.push({ id: `s-${raceId}`, raceId, fleetIds: [fleet], stage: 'qualifying', stageRaceNumber: i + 1 });
      let place = 0;
      for (const token of order) {
        const [id, code] = token.split(' ');
        finishes.push(code ? finish(raceId, id, null, code as Finish['resultCode']) : finish(raceId, id, ++place));
      }
    });
  }
  const fleets: Fleet[] = ['A', 'B', 'M'].map((id) => ({ id, seriesId: 's1', name: id, displayOrder: 0, scoringSystem: 'scratch' }));
  return {
    config,
    rounds: [round('q', 'qualifying', ['A', 'B']), ...(medal.length ? [round('m', 'medal', ['M'])] : [])],
    fleets,
    competitors,
    races,
    raceStarts,
    finishes,
  };
}

const PER_FLEET: SplitFleetConfig = { ...championsCupConfig(), fleetRanking: 'per-fleet' };
const COMBINED: SplitFleetConfig = { ...championsCupConfig(), fleetRanking: 'combined' };

const table = (data: SplitFleetData) =>
  splitFleetStandings(data).map((r) => [r.competitor.id, r.rankedInFleetId ?? null, r.rank, r.net]);

describe('ranksEachFleet', () => {
  it('is only an undivided championship with more than one fleet that asks for it', () => {
    expect(ranksEachFleet(PER_FLEET)).toBe(true);
    expect(ranksEachFleet(COMBINED)).toBe(false);
    expect(ranksEachFleet({ ...championsCupConfig() })).toBe(false);
    expect(ranksEachFleet({ ...openingSeriesMedalConfig(), fleetRanking: 'per-fleet' })).toBe(false);
    expect(ranksEachFleet({ ...ilca2026Config(2), fleetRanking: 'per-fleet' })).toBe(false);
  });
});

describe('directSeatsPerFleet', () => {
  it('is the card’s number, or the medal size shared equally, rounded down', () => {
    expect(directSeatsPerFleet(PER_FLEET)).toBe(3);
    expect(directSeatsPerFleet({ ...PER_FLEET, medal: { ...PER_FLEET.medal!, fromEachFleet: 2 } })).toBe(2);
  });
});

describe('each fleet ranked on its own', () => {
  const sheets = {
    A: [
      ['a1', 'a2', 'a3', 'a4'],
      ['a2', 'a1', 'a4', 'a3'],
    ],
    B: [
      ['b1', 'b2', 'b3'],
      ['b3', 'b1', 'b2'],
    ],
  };

  it('ranks each fleet from 1, in fleet order', () => {
    // Ties on points go to the last race (A8.2): a2 and a4 won theirs.
    expect(table(flights(PER_FLEET, sheets))).toEqual([
      ['a2', 'A', 1, 3],
      ['a1', 'A', 2, 3],
      ['a4', 'A', 3, 7],
      ['a3', 'A', 4, 7],
      ['b1', 'B', 1, 3],
      ['b3', 'B', 2, 4],
      ['b2', 'B', 3, 5],
    ]);
  });

  it('counts a fleet’s race once that fleet has sailed it, whatever the other fleet has', () => {
    // Flight A sails two races, flight B none: the 2025 Keelboat Champions'
    // Cup's Saturday.
    const unequal = { A: sheets.A, B: [] };
    const perFleet = splitFleetStandings(flights(PER_FLEET, unequal));
    expect(perFleet.find((r) => r.competitor.id === 'a1')!.net).toBe(3);
    // Ranked together, a race counts only once every fleet has sailed it.
    const combined = splitFleetStandings(flights(COMBINED, unequal));
    expect(combined.find((r) => r.competitor.id === 'a1')!.net).toBe(0);
  });

  it('scores a boat who does not finish from her own fleet', () => {
    const coded = { A: sheets.A, B: [['b1', 'b2', 'b3 DNF'], ['b3', 'b1', 'b2']] };
    const b3 = (config: SplitFleetConfig) =>
      splitFleetStandings(flights(config, coded)).find((r) => r.competitor.id === 'b3')!.cells[0].points;
    expect(b3(PER_FLEET)).toBe(4);
    // Ranked together, the base is the largest fleet.
    expect(b3(COMBINED)).toBe(5);
  });

  it('ranks the medal boats as a list of their own, above the fleets', () => {
    const rows = table(flights(PER_FLEET, sheets, ['a2', 'b1']));
    // a2 and b1 both score 3 over their flights' races; in one list, the
    // last race puts a2 first.
    expect(rows.slice(0, 2).map((r) => [r[0], r[2]])).toEqual([
      ['a2', 1],
      ['b1', 2],
    ]);
    // The rest keep their rank in their own fleet.
    expect(rows.slice(2).map((r) => [r[0], r[2]])).toEqual([
      ['a1', 2],
      ['a4', 3],
      ['a3', 4],
      ['b3', 2],
      ['b2', 3],
    ]);
  });

  it('shares a rank within a fleet where A8 cannot separate, and never across fleets', () => {
    const tied = { A: [['a1', 'a2', 'a3', 'a4']], B: [['b1', 'b2', 'b3']] };
    const rows = table(flights(PER_FLEET, tied));
    expect(rows.find((r) => r[0] === 'a1')![2]).toBe(1);
    expect(rows.find((r) => r[0] === 'b1')![2]).toBe(1);
  });
});
