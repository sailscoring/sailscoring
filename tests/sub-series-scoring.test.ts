import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  calculateFleetStandings,
  calculateSubSeriesFleetStandings,
  groupRacesBySubSeries,
  subSeriesEntrantIds,
} from '@/lib/scoring';
import { endOfSeriesTcfKey, endOfSeriesTcfs } from '@/lib/source-handicaps';
import type { Competitor, Finish, Fleet, PenaltyCode, Race, SubSeries } from '@/lib/types';
import { buildFixtureInputs, loadFixturesFromDir } from './fixtures/scoring/types';

function makeCompetitor(id: string, seriesId = 's1', fleetId = 'f1'): Competitor {
  return { id, seriesId, fleetIds: [fleetId], sailNumber: id, name: id, club: '', gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, raceNumber: number, seriesId = 's1'): Race {
  return { id, seriesId, raceNumber, name: null, date: '2025-01-01', createdAt: 0 };
}

function makeSubSeries(
  id: string,
  name: string,
  displayOrder: number,
  raceIds: string[] = [],
  extra: Partial<SubSeries> = {},
  seriesId = 's1',
): SubSeries {
  return { id, seriesId, name, displayOrder, raceIds, ...extra };
}

function makeFinish(
  raceId: string,
  competitorId: string,
  sortOrder: number | null,
  resultCode: Finish['resultCode'] = null,
  penaltyCode: PenaltyCode | null = null,
  penaltyOverride: number | null = null,
): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, resultCode, startPresent: null, penaltyCode, penaltyOverride, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null };
}

const scratchFleet: Fleet = { id: 'f1', seriesId: 's1', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' };
const fleetTwo: Fleet = { id: 'f2', seriesId: 's1', name: 'Fleet Two', displayOrder: 1, scoringSystem: 'scratch' };

function makeMultiFleetCompetitor(id: string, fleetIds: string[]): Competitor {
  return { id, seriesId: 's1', fleetIds, sailNumber: id, name: id, club: '', gender: '', age: null, createdAt: 0 };
}

// ─── groupRacesBySubSeries ───────────────────────────────────────────────────

describe('groupRacesBySubSeries', () => {
  it('returns sub-series in displayOrder, races sorted by raceNumber', () => {
    const spring = makeSubSeries('s', 'Spring', 0, ['r4', 'r3']);
    const winter = makeSubSeries('w', 'Winter', 1, ['r2', 'r1']);
    const races = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3), makeRace('r4', 4)];
    const blocks = groupRacesBySubSeries([winter, spring], races);
    expect(blocks.map((b) => b.subSeries.id)).toEqual(['s', 'w']);
    expect(blocks[0].races.map((r) => r.id)).toEqual(['r3', 'r4']);
    expect(blocks[1].races.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('keeps a sub-series with no races (empty selection)', () => {
    const winter = makeSubSeries('w', 'Winter', 0, ['r1']);
    const spring = makeSubSeries('s', 'Spring', 1, []);
    const blocks = groupRacesBySubSeries([winter, spring], [makeRace('r1', 1)]);
    expect(blocks.map((b) => b.subSeries.id)).toEqual(['w', 's']);
    expect(blocks[1].races).toEqual([]);
  });

  it('supports overlapping selections and ignores unknown race ids', () => {
    const all = makeSubSeries('all', 'Overall', 0, ['r1', 'r2', 'gone']);
    const odd = makeSubSeries('odd', 'Odd', 1, ['r1']);
    const blocks = groupRacesBySubSeries([all, odd], [makeRace('r1', 1), makeRace('r2', 2)]);
    expect(blocks[0].races.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(blocks[1].races.map((r) => r.id)).toEqual(['r1']);
  });
});

// ─── subSeriesEntrantIds ─────────────────────────────────────────────────────

describe('subSeriesEntrantIds', () => {
  const races = [makeRace('r1', 1), makeRace('r2', 2)];

  it('counts finishers and coded results, but not explicit DNC rows', () => {
    const finishes = [
      makeFinish('r1', 'A', 1),            // finisher
      makeFinish('r1', 'B', null, 'DNS'),  // came to the start area
      makeFinish('r1', 'C', null, 'DNC'),  // explicit DNC row in every race
      makeFinish('r2', 'C', null, 'DNC'),
      // D has no rows at all
    ];
    const entrants = subSeriesEntrantIds(races, finishes);
    expect(entrants).toEqual(new Set(['A', 'B']));
  });

  it('one non-DNC result anywhere in the block is enough', () => {
    const finishes = [
      makeFinish('r1', 'C', null, 'DNC'),
      makeFinish('r2', 'C', 1),
    ];
    expect(subSeriesEntrantIds(races, finishes)).toEqual(new Set(['C']));
  });

  it('ignores results in races outside the block and unresolved finishes', () => {
    const finishes = [
      makeFinish('r9', 'A', 1),
      { ...makeFinish('r1', 'B', 2), competitorId: null },
    ];
    expect(subSeriesEntrantIds(races, finishes).size).toBe(0);
  });
});

// ─── calculateSubSeriesFleetStandings: scratch ───────────────────────────────

describe('calculateSubSeriesFleetStandings (scratch)', () => {
  // Winter: r1–r4 (1 discard at 4 races); Spring: r5–r6 (0 discards).
  const races = [
    makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3), makeRace('r4', 4),
    makeRace('r5', 5), makeRace('r6', 6),
  ];
  const winter = makeSubSeries('w', 'Winter', 0, ['r1', 'r2', 'r3', 'r4']);
  const spring = makeSubSeries('s', 'Spring', 1, ['r5', 'r6']);
  const competitors = ['A', 'B', 'C', 'D', 'E'].map((id) => makeCompetitor(id));
  const discardThresholds = [{ minRaces: 4, discardCount: 1 }];

  // A wins everything; B second except a bad r4; E sails Winter only;
  // B misses r5 entirely (implicit DNC within Spring).
  const finishes = [
    ...['r1', 'r2', 'r3'].flatMap((r) => [
      makeFinish(r, 'A', 1), makeFinish(r, 'B', 2), makeFinish(r, 'C', 3), makeFinish(r, 'D', 4), makeFinish(r, 'E', 5),
    ]),
    makeFinish('r4', 'A', 1), makeFinish('r4', 'C', 2), makeFinish('r4', 'D', 3), makeFinish('r4', 'E', 4), makeFinish('r4', 'B', 5),
    makeFinish('r5', 'A', 1), makeFinish('r5', 'C', 2), makeFinish('r5', 'D', 3),
    makeFinish('r6', 'A', 1), makeFinish('r6', 'B', 2), makeFinish('r6', 'C', 3), makeFinish('r6', 'D', 4),
  ];

  const results = calculateSubSeriesFleetStandings(
    [winter, spring], [scratchFleet], competitors, races, finishes, discardThresholds,
  );
  const winterStandings = results[0].fleetStandings[0].standings;
  const springStandings = results[1].fleetStandings[0].standings;

  it('scores each sub-series over its own races', () => {
    expect(results.map((r) => r.subSeries.id)).toEqual(['w', 's']);
    expect(results[0].races.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    for (const s of winterStandings) expect(s.racePoints).toHaveLength(4);
    for (const s of springStandings) expect(s.racePoints).toHaveLength(2);
  });

  it('applies the series discard thresholds to the block race count', () => {
    const winterB = winterStandings.find((s) => s.competitor.id === 'B')!;
    expect(winterB.raceDiscards[3]).toBe(true);           // 4 races → 1 discard; B drops the r4 score
    expect(winterB.netPoints).toBe(6);                    // 2+2+2, the 5 discarded
    for (const s of springStandings) {
      expect(s.raceDiscards.every((d) => !d)).toBe(true); // 2 races → 0 discards
    }
  });

  it('leaves a boat that sat out a block off that block standings', () => {
    expect(winterStandings.map((s) => s.competitor.id)).toContain('E');
    expect(springStandings.map((s) => s.competitor.id)).not.toContain('E');
  });

  it('bases DNC penalties on the block entrants, not the series entry list', () => {
    // Spring entrants: A, B, C, D (E sat the block out). B missed r5, so DNC
    // scores entrants + 1 = 5 — not 6 from the 5-boat series entry list.
    const springB = springStandings.find((s) => s.competitor.id === 'B')!;
    expect(springB.raceCodes[0]).toBe('DNC');
    expect(springB.racePoints[0]).toBe(5);
  });
});

// ─── calculateSubSeriesFleetStandings: fleet-scoping ─────────────────────────

describe('calculateSubSeriesFleetStandings (fleet-scoping)', () => {
  // Three boats in f1, two in f2; A is in both fleets.
  const competitors = [
    makeMultiFleetCompetitor('A', ['f1', 'f2']),
    makeMultiFleetCompetitor('B', ['f1']),
    makeMultiFleetCompetitor('C', ['f1']),
    makeMultiFleetCompetitor('D', ['f2']),
  ];
  const races = [makeRace('r1', 1), makeRace('r2', 2)];
  const finishes = ['r1', 'r2'].flatMap((r) => [
    makeFinish(r, 'A', 1), makeFinish(r, 'B', 2), makeFinish(r, 'C', 3), makeFinish(r, 'D', 4),
  ]);

  it('absent fleetIds scores every fleet (unchanged default)', () => {
    const all = makeSubSeries('all', 'Overall', 0, ['r1', 'r2']);
    const [block] = calculateSubSeriesFleetStandings(
      [all], [scratchFleet, fleetTwo], competitors, races, finishes,
    );
    expect(block.fleetStandings.map((fs) => fs.fleet.id)).toEqual(['f1', 'f2']);
  });

  it('scopes standings to the named fleets and drops out-of-scope entrants', () => {
    const f1Only = makeSubSeries('one', 'F1 only', 0, ['r1', 'r2'], { fleetIds: ['f1'] });
    const [block] = calculateSubSeriesFleetStandings(
      [f1Only], [scratchFleet, fleetTwo], competitors, races, finishes,
    );
    // Only f1 is scored; D (f2-only) doesn't fall through to an Unknown bucket.
    expect(block.fleetStandings.map((fs) => fs.fleet.id)).toEqual(['f1']);
    const ids = block.fleetStandings[0].standings.map((s) => s.competitor.id).sort();
    expect(ids).toEqual(['A', 'B', 'C']);
  });
});

// ─── calculateSubSeriesFleetStandings: per-fleet exclusion ───────────────────

describe('calculateSubSeriesFleetStandings (per-fleet exclusion)', () => {
  // Two fleets share r1–r3. r2 is struck for f1 only.
  const competitors = [
    makeMultiFleetCompetitor('A', ['f1']),
    makeMultiFleetCompetitor('B', ['f1']),
    makeMultiFleetCompetitor('C', ['f2']),
    makeMultiFleetCompetitor('D', ['f2']),
  ];
  const races = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
  const finishes = ['r1', 'r2', 'r3'].flatMap((r) => [
    makeFinish(r, 'A', 1), makeFinish(r, 'B', 2), makeFinish(r, 'C', 3), makeFinish(r, 'D', 4),
  ]);

  const overall = makeSubSeries('all', 'Overall', 0, ['r1', 'r2', 'r3'], {
    raceFleetExclusions: [{ raceId: 'r2', fleetId: 'f1' }],
  });
  const [block] = calculateSubSeriesFleetStandings(
    [overall], [scratchFleet, fleetTwo], competitors, races, finishes,
  );
  const f1 = block.fleetStandings.find((fs) => fs.fleet.id === 'f1')!;
  const f2 = block.fleetStandings.find((fs) => fs.fleet.id === 'f2')!;

  it('strikes the excluded race from the affected fleet only', () => {
    // f1 scores 2 races (r2 struck); f2 scores all 3.
    for (const s of f1.standings) expect(s.racePoints).toHaveLength(2);
    for (const s of f2.standings) expect(s.racePoints).toHaveLength(3);
  });

  it('leaves the race intact for every other fleet', () => {
    expect(block.races.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    const c = f2.standings.find((s) => s.competitor.id === 'C')!;
    expect(c.racePoints).toEqual([1, 1, 1]); // C wins f2 in all three races
  });
});

// ─── calculateSubSeriesFleetStandings: progressive carry ─────────────────────

describe('calculateSubSeriesFleetStandings (NHC carry)', () => {
  // The Sailwave-verified H17 HPH fixture, split after race 2 into Early +
  // Late, with Late set to *continue* Early's chain. The explicit carry must
  // reproduce the whole-series chain exactly: every (race, competitor)
  // applied/new TCF matches a single run over all races.
  const loaded = loadFixturesFromDir(join(__dirname, 'fixtures/scoring/nhc'));
  const h17 = loaded.find((l) => l.yamlPath.endsWith('07-h17-hph-multi-race-base-realign.yaml'));
  if (!h17) throw new Error('H17 NHC fixture not found');
  const inputs = buildFixtureInputs(h17.fixture);
  const raceIds = inputs.races.map((r) => r.id);

  const early = makeSubSeries('blk-1', 'Early', 0, raceIds.slice(0, 2));
  const late = makeSubSeries('blk-2', 'Late', 1, raceIds.slice(2), {
    startingHandicapSource: 'continue',
    continueFromSubSeriesId: 'blk-1',
  });

  const full = calculateFleetStandings(
    inputs.fleets, inputs.competitors, inputs.races, inputs.finishes,
    inputs.discardThresholds, inputs.dnfScoring, inputs.raceStarts,
  ).fleetStandings[0];

  const blocks = calculateSubSeriesFleetStandings(
    [early, late], inputs.fleets, inputs.competitors, inputs.races, inputs.finishes,
    inputs.discardThresholds, inputs.dnfScoring, inputs.raceStarts,
  );

  it('reproduces the whole-series TCF chain exactly across the carry', () => {
    const fullByKey = new Map(
      (full.tcfHistory ?? []).map((rec) => [`${rec.raceId}:${rec.competitorId}`, rec]),
    );
    let compared = 0;
    for (const block of blocks) {
      for (const rec of block.fleetStandings[0].tcfHistory ?? []) {
        const fullRec = fullByKey.get(`${rec.raceId}:${rec.competitorId}`);
        expect(fullRec).toBeDefined();
        expect(rec.tcfApplied).toBe(fullRec!.tcfApplied);
        expect(rec.newTcf).toBe(fullRec!.newTcf);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('seeds the Late block from the end-of-Early ratings', () => {
    const lateBlock = blocks[1].fleetStandings[0];
    const r3 = inputs.races[2];
    const fullEndOfR2 = new Map(
      (full.tcfHistory ?? []).filter((rec) => rec.raceId === inputs.races[1].id).map((rec) => [rec.competitorId, rec.newTcf]),
    );
    const lateR3Applied = new Map(
      (lateBlock.tcfHistory ?? []).filter((rec) => rec.raceId === r3.id).map((rec) => [rec.competitorId, rec.tcfApplied]),
    );
    expect(lateR3Applied.size).toBeGreaterThan(0);
    for (const [competitorId, applied] of lateR3Applied) {
      const carried = fullEndOfR2.get(competitorId);
      if (carried !== undefined) expect(applied).toBe(carried);
    }
  });

  it('matches the per-race aggregates of the whole-series run', () => {
    for (const block of blocks) {
      for (const [raceId, agg] of block.fleetStandings[0].nhcAggregatesByRaceId ?? new Map()) {
        const fullAgg = full.nhcAggregatesByRaceId?.get(raceId);
        expect(fullAgg).toBeDefined();
        expect(agg.realignmentFactor).toBe(fullAgg!.realignmentFactor);
        expect(agg.p50).toBe(fullAgg!.p50);
        expect(agg.finisherCount).toBe(fullAgg!.finisherCount);
      }
    }
  });
});

// ─── Per-stream end-of-series TCF (the listTcfHistory composition) ───────────

describe('end-of-series TCF over independent sub-series blocks', () => {
  // The same H17 fixture, but split into two *independent* blocks (both seed
  // from base — no carry). This is the per-stream case: Late re-runs the chain
  // from base over its own races, so its end-of-chain ratings differ from a
  // single whole-series chain. This is exactly what listTcfHistory now flattens
  // and feeds to endOfSeriesTcfs for follow-on seeding.
  const loaded = loadFixturesFromDir(join(__dirname, 'fixtures/scoring/nhc'));
  const h17 = loaded.find((l) => l.yamlPath.endsWith('07-h17-hph-multi-race-base-realign.yaml'));
  if (!h17) throw new Error('H17 NHC fixture not found');
  const inputs = buildFixtureInputs(h17.fixture);
  const raceIds = inputs.races.map((r) => r.id);

  const early = makeSubSeries('blk-1', 'Early', 0, raceIds.slice(0, 2));
  const lateIndependent = makeSubSeries('blk-2', 'Late', 1, raceIds.slice(2)); // no continue → base

  const blocks = calculateSubSeriesFleetStandings(
    [early, lateIndependent], inputs.fleets, inputs.competitors, inputs.races, inputs.finishes,
    inputs.discardThresholds, inputs.dnfScoring, inputs.raceStarts,
  );
  const subSeriesHistory = blocks.flatMap((b) => b.fleetStandings.flatMap((fr) => fr.tcfHistory ?? []));

  const wholeSeries = calculateFleetStandings(
    inputs.fleets, inputs.competitors, inputs.races, inputs.finishes,
    inputs.discardThresholds, inputs.dnfScoring, inputs.raceStarts,
  ).fleetStandings[0];
  const wholeHistory = wholeSeries.tcfHistory ?? [];

  it('resolves each boat to its last block end, not the whole-series chain end', () => {
    const fleetId = inputs.fleets[0].id;
    const blockEnds = endOfSeriesTcfs(inputs.competitors, inputs.fleets, inputs.races, subSeriesHistory);
    const wholeEnds = endOfSeriesTcfs(inputs.competitors, inputs.fleets, inputs.races, wholeHistory);

    // The latest race is in the Late block; its independent (from-base) newTcf
    // is what the per-stream resolution returns.
    const lastRaceId = raceIds[raceIds.length - 1];
    const lateNewTcf = new Map(
      subSeriesHistory.filter((r) => r.raceId === lastRaceId).map((r) => [r.competitorId, r.newTcf]),
    );
    expect(lateNewTcf.size).toBeGreaterThan(0);

    let diverged = 0;
    for (const c of inputs.competitors) {
      const block = blockEnds.get(endOfSeriesTcfKey(c.id, fleetId));
      const expected = lateNewTcf.get(c.id);
      if (expected !== undefined) {
        expect(block?.endTcf).toBe(expected);
      }
      const whole = wholeEnds.get(endOfSeriesTcfKey(c.id, fleetId));
      if (block && whole && block.endTcf !== whole.endTcf) diverged++;
    }
    // The independent re-seed genuinely moves at least one boat's end rating —
    // otherwise the test would pass vacuously against the whole-series chain.
    expect(diverged).toBeGreaterThan(0);
  });
});
