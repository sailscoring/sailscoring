import { describe, it, expect } from 'vitest';

import {
  endOfSeriesTcfKey,
  endOfSeriesTcfs,
  planHandicapUpdates,
  proposeFleetMapping,
  type EndOfSeriesTcf,
} from '@/lib/source-handicaps';
import type { Competitor, Fleet, Race, TcfRecord } from '@/lib/types';

function comp(id: string, fleetIds: string[], extras: Partial<Competitor> = {}): Competitor {
  return {
    id,
    seriesId: 's-source',
    fleetIds,
    sailNumber: id,
    name: id,
    club: '',
    gender: '',
    age: null,
    createdAt: 0,
    ...extras,
  };
}

function fleet(id: string, system: Fleet['scoringSystem'], name = id): Fleet {
  return {
    id,
    seriesId: 's-source',
    name,
    displayOrder: 0,
    scoringSystem: system,
  };
}

function race(id: string, raceNumber: number, date: string): Race {
  return { id, seriesId: 's-source', raceNumber, date, createdAt: 0 };
}

function tcf(raceId: string, competitorId: string, fleetId: string, newTcf: number): TcfRecord {
  return {
    id: `${raceId}-${competitorId}-${fleetId}`,
    raceId,
    competitorId,
    fleetId,
    tcfApplied: newTcf, // value irrelevant for these tests; resolver only reads newTcf
    newTcf,
  };
}

describe('endOfSeriesTcfs', () => {
  it('returns empty when no progressive fleets exist', () => {
    const fleets = [fleet('f-scratch', 'scratch'), fleet('f-irc', 'irc')];
    const result = endOfSeriesTcfs([comp('A', ['f-scratch'])], fleets, [], []);
    expect(result.size).toBe(0);
  });

  it('returns the newTcf of the latest race per (competitor, fleet)', () => {
    const fleets = [fleet('f-nhc', 'nhc')];
    const races = [
      race('r1', 1, '2026-05-01'),
      race('r2', 2, '2026-05-08'),
      race('r3', 3, '2026-05-15'),
    ];
    const history = [
      tcf('r1', 'A', 'f-nhc', 1.005),
      tcf('r2', 'A', 'f-nhc', 1.010),
      tcf('r3', 'A', 'f-nhc', 1.020),
      tcf('r1', 'B', 'f-nhc', 0.995),
      tcf('r2', 'B', 'f-nhc', 0.985),
    ];
    const result = endOfSeriesTcfs([comp('A', ['f-nhc']), comp('B', ['f-nhc'])], fleets, races, history);
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))).toMatchObject({
      endTcf: 1.020,
      lastRaceId: 'r3',
      lastRaceNumber: 3,
      system: 'nhc',
    });
    // Boat B's latest record is r2 — r3 has no row for B (e.g. DNC and
    // outside the rating-update fleet).
    expect(result.get(endOfSeriesTcfKey('B', 'f-nhc'))).toMatchObject({
      endTcf: 0.985,
      lastRaceId: 'r2',
      lastRaceNumber: 2,
    });
  });

  it('orders races by date first, raceNumber second', () => {
    // raceNumber order would pick r1 (1.111) as latest; date order picks r2 (1.222).
    const fleets = [fleet('f-nhc', 'nhc')];
    const races = [
      race('r1', 1, '2026-06-01'),
      race('r2', 2, '2026-05-01'), // out-of-order date
      race('r3', 3, '2026-06-01'), // same date as r1; higher raceNumber wins
    ];
    const history = [
      tcf('r1', 'A', 'f-nhc', 1.111),
      tcf('r2', 'A', 'f-nhc', 1.222),
      tcf('r3', 'A', 'f-nhc', 1.333),
    ];
    const result = endOfSeriesTcfs([comp('A', ['f-nhc'])], fleets, races, history);
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))?.endTcf).toBe(1.333);
  });

  it('keeps NHC and ECHO records for the same boat separate (multi-fleet)', () => {
    const fleets = [fleet('f-nhc', 'nhc'), fleet('f-echo', 'echo')];
    const races = [race('r1', 1, '2026-05-01')];
    const history = [
      tcf('r1', 'A', 'f-nhc', 1.234),
      tcf('r1', 'A', 'f-echo', 0.987),
    ];
    const result = endOfSeriesTcfs(
      [comp('A', ['f-nhc', 'f-echo'])],
      fleets,
      races,
      history,
    );
    expect(result.size).toBe(2);
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))?.system).toBe('nhc');
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))?.endTcf).toBe(1.234);
    expect(result.get(endOfSeriesTcfKey('A', 'f-echo'))?.system).toBe('echo');
    expect(result.get(endOfSeriesTcfKey('A', 'f-echo'))?.endTcf).toBe(0.987);
  });

  it('ignores history rows whose fleet is static-TCF', () => {
    // A stale record pointing at an IRC fleet — should never have existed,
    // but if it does we drop it on the floor rather than fabricating an
    // EndOfSeriesTcf entry.
    const fleets = [fleet('f-irc', 'irc'), fleet('f-nhc', 'nhc')];
    const races = [race('r1', 1, '2026-05-01')];
    const history = [
      tcf('r1', 'A', 'f-irc', 0.999),
      tcf('r1', 'A', 'f-nhc', 1.050),
    ];
    const result = endOfSeriesTcfs(
      [comp('A', ['f-irc', 'f-nhc'])],
      fleets,
      races,
      history,
    );
    expect(result.size).toBe(1);
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))?.endTcf).toBe(1.050);
  });

  it('drops history records whose race is unknown', () => {
    const fleets = [fleet('f-nhc', 'nhc')];
    const races = [race('r1', 1, '2026-05-01')];
    const history = [
      tcf('r1', 'A', 'f-nhc', 1.000),
      tcf('r-ghost', 'A', 'f-nhc', 9.999), // race not in input
    ];
    const result = endOfSeriesTcfs([comp('A', ['f-nhc'])], fleets, races, history);
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))?.endTcf).toBe(1.000);
  });

  it('drops history records for competitors no longer in the series', () => {
    const fleets = [fleet('f-nhc', 'nhc')];
    const races = [race('r1', 1, '2026-05-01')];
    const history = [
      tcf('r1', 'A', 'f-nhc', 1.000),
      tcf('r1', 'B-deleted', 'f-nhc', 1.234),
    ];
    const result = endOfSeriesTcfs([comp('A', ['f-nhc'])], fleets, races, history);
    expect(result.size).toBe(1);
    expect(result.has(endOfSeriesTcfKey('B-deleted', 'f-nhc'))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────

function endTcf(competitorId: string, fleetId: string, system: 'nhc' | 'echo', endTcfVal: number): EndOfSeriesTcf {
  return {
    competitorId,
    fleetId,
    system,
    endTcf: endTcfVal,
    lastRaceId: 'r-last',
    lastRaceNumber: 6,
  };
}

describe('planHandicapUpdates', () => {
  it('emits a "change" row when the new TCF differs', () => {
    const targetFleet = fleet('tgt-nhc', 'nhc', 'Puppeteer');
    const targetComp = comp('A', ['tgt-nhc'], { nhcStartingTcf: 1.201 });
    const sourceComp = comp('A', ['src-nhc']);
    const endMap = new Map([[endOfSeriesTcfKey('A', 'src-nhc'), endTcf('A', 'src-nhc', 'nhc', 1.019)]]);

    const rows = planHandicapUpdates({
      targetCompetitors: [targetComp],
      targetFleets: [targetFleet],
      sourceCompetitors: [sourceComp],
      endOfSourceTcfs: endMap,
      fleetMapping: { 'tgt-nhc': 'src-nhc' },
    });
    expect(rows).toEqual([
      {
        competitorId: 'A',
        targetFleetId: 'tgt-nhc',
        system: 'nhc',
        currentTcf: 1.201,
        newTcf: 1.019,
        status: 'change',
      },
    ]);
  });

  it('emits "unchanged" when the values match exactly', () => {
    const targetFleet = fleet('tgt-echo', 'echo');
    const targetComp = comp('A', ['tgt-echo'], { echoStartingTcf: 1.000 });
    const sourceComp = comp('A', ['src-echo']);
    const endMap = new Map([[endOfSeriesTcfKey('A', 'src-echo'), endTcf('A', 'src-echo', 'echo', 1.000)]]);

    const rows = planHandicapUpdates({
      targetCompetitors: [targetComp],
      targetFleets: [targetFleet],
      sourceCompetitors: [sourceComp],
      endOfSourceTcfs: endMap,
      fleetMapping: { 'tgt-echo': 'src-echo' },
    });
    expect(rows[0].status).toBe('unchanged');
  });

  it('emits no rows for scratch target fleets', () => {
    const targetFleet = fleet('tgt-scratch', 'scratch');
    const targetComp = comp('A', ['tgt-scratch']);
    const rows = planHandicapUpdates({
      targetCompetitors: [targetComp],
      targetFleets: [targetFleet],
      sourceCompetitors: [comp('A', [])],
      endOfSourceTcfs: new Map(),
      fleetMapping: {},
    });
    expect(rows).toEqual([]);
  });

  it('marks unmapped target fleets as not-found / no-source-fleet-mapping', () => {
    const targetFleet = fleet('tgt-nhc', 'nhc');
    const targetComp = comp('A', ['tgt-nhc'], { nhcStartingTcf: 1.0 });
    const rows = planHandicapUpdates({
      targetCompetitors: [targetComp],
      targetFleets: [targetFleet],
      sourceCompetitors: [comp('A', [])],
      endOfSourceTcfs: new Map(),
      fleetMapping: { 'tgt-nhc': null },
    });
    expect(rows[0]).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-fleet-mapping',
      currentTcf: 1.0,
      newTcf: null,
    });
  });

  it('marks missing source competitor as not-found / no-source-competitor', () => {
    const targetFleet = fleet('tgt-nhc', 'nhc');
    const targetComp = comp('A', ['tgt-nhc'], { nhcStartingTcf: 1.0 });
    const rows = planHandicapUpdates({
      targetCompetitors: [targetComp],
      targetFleets: [targetFleet],
      sourceCompetitors: [], // no source boats
      endOfSourceTcfs: new Map(),
      fleetMapping: { 'tgt-nhc': 'src-nhc' },
    });
    expect(rows[0]).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-competitor',
    });
  });

  it('marks NHC source-comp-with-no-end-TCF as not-found / no-source-value', () => {
    // Source comp exists (e.g. registered for the source series) but
    // never raced in the mapped source fleet — no TcfRecord rows for it,
    // resolver returns nothing, planner surfaces "no-source-value".
    const targetFleet = fleet('tgt-nhc', 'nhc');
    const targetComp = comp('A', ['tgt-nhc'], { nhcStartingTcf: 1.0 });
    const rows = planHandicapUpdates({
      targetCompetitors: [targetComp],
      targetFleets: [targetFleet],
      sourceCompetitors: [comp('A', ['src-other-fleet'])],
      endOfSourceTcfs: new Map(),
      fleetMapping: { 'tgt-nhc': 'src-nhc' },
    });
    expect(rows[0]).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-value',
    });
  });

  it('matches competitors by sail number, case-insensitively', () => {
    const targetFleet = fleet('tgt-nhc', 'nhc');
    const targetComp = comp('tgt-A', ['tgt-nhc'], { sailNumber: 'irl 1234', nhcStartingTcf: 1.0 });
    const sourceComp = comp('src-A', [], { sailNumber: 'IRL 1234' });
    const endMap = new Map([[endOfSeriesTcfKey('src-A', 'src-nhc'), endTcf('src-A', 'src-nhc', 'nhc', 1.123)]]);
    const rows = planHandicapUpdates({
      targetCompetitors: [targetComp],
      targetFleets: [targetFleet],
      sourceCompetitors: [sourceComp],
      endOfSourceTcfs: endMap,
      fleetMapping: { 'tgt-nhc': 'src-nhc' },
    });
    expect(rows[0]).toMatchObject({ status: 'change', newTcf: 1.123, competitorId: 'tgt-A' });
  });

  it('reads IRC TCC straight off the source competitor (no fleet history)', () => {
    const targetFleet = fleet('tgt-irc', 'irc');
    const targetComp = comp('A', ['tgt-irc'], { ircTcc: 0.95 });
    const sourceComp = comp('A', [], { ircTcc: 0.972 });
    const rows = planHandicapUpdates({
      targetCompetitors: [targetComp],
      targetFleets: [targetFleet],
      sourceCompetitors: [sourceComp],
      endOfSourceTcfs: new Map(), // irrelevant for IRC
      fleetMapping: { 'tgt-irc': 'src-irc' },
    });
    expect(rows[0]).toMatchObject({ status: 'change', currentTcf: 0.95, newTcf: 0.972 });
  });

  it('reads PY number straight off the source competitor', () => {
    const targetFleet = fleet('tgt-py', 'py');
    const targetComp = comp('A', ['tgt-py'], { pyNumber: 1100 });
    const sourceComp = comp('A', [], { pyNumber: 1034 });
    const rows = planHandicapUpdates({
      targetCompetitors: [targetComp],
      targetFleets: [targetFleet],
      sourceCompetitors: [sourceComp],
      endOfSourceTcfs: new Map(),
      fleetMapping: { 'tgt-py': 'src-py' },
    });
    expect(rows[0]).toMatchObject({ status: 'change', currentTcf: 1100, newTcf: 1034 });
  });

  it('emits one row per (competitor, fleet) for multi-fleet boats', () => {
    const fleets = [fleet('tgt-nhc', 'nhc'), fleet('tgt-echo', 'echo')];
    const targetComp = comp('A', ['tgt-nhc', 'tgt-echo'], {
      nhcStartingTcf: 1.0,
      echoStartingTcf: 1.0,
    });
    const sourceComp = comp('A', []);
    const endMap = new Map([
      [endOfSeriesTcfKey('A', 'src-nhc'), endTcf('A', 'src-nhc', 'nhc', 1.05)],
      [endOfSeriesTcfKey('A', 'src-echo'), endTcf('A', 'src-echo', 'echo', 0.98)],
    ]);
    const rows = planHandicapUpdates({
      targetCompetitors: [targetComp],
      targetFleets: fleets,
      sourceCompetitors: [sourceComp],
      endOfSourceTcfs: endMap,
      fleetMapping: { 'tgt-nhc': 'src-nhc', 'tgt-echo': 'src-echo' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.system).sort()).toEqual(['echo', 'nhc']);
    const nhcRow = rows.find((r) => r.system === 'nhc')!;
    expect(nhcRow.newTcf).toBe(1.05);
    const echoRow = rows.find((r) => r.system === 'echo')!;
    expect(echoRow.newTcf).toBe(0.98);
  });
});

describe('proposeFleetMapping', () => {
  it('matches on (name, scoringSystem), case-insensitive', () => {
    const target = [fleet('tgt-pup', 'nhc', 'Puppeteer'), fleet('tgt-cls3', 'echo', 'Class 3')];
    const source = [fleet('src-pup', 'nhc', 'PUPPETEER'), fleet('src-cls3', 'echo', 'Class 3')];
    expect(proposeFleetMapping(target, source)).toEqual({
      'tgt-pup': 'src-pup',
      'tgt-cls3': 'src-cls3',
    });
  });

  it('falls back to single-candidate-for-system when names differ', () => {
    const target = [fleet('tgt-pup', 'nhc', 'Puppeteer')];
    const source = [fleet('src-hph', 'nhc', 'Puppeteer HPH')];
    expect(proposeFleetMapping(target, source)).toEqual({ 'tgt-pup': 'src-hph' });
  });

  it('leaves the entry null when multiple same-system source fleets exist with no name match', () => {
    const target = [fleet('tgt-pup', 'nhc', 'Puppeteer')];
    const source = [
      fleet('src-1', 'nhc', 'Class 1 NHC'),
      fleet('src-2', 'nhc', 'Class 2 NHC'),
    ];
    expect(proposeFleetMapping(target, source)).toEqual({ 'tgt-pup': null });
  });

  it('omits scratch target fleets', () => {
    const target = [fleet('tgt-scr', 'scratch'), fleet('tgt-nhc', 'nhc', 'NHC')];
    const source = [fleet('src-nhc', 'nhc', 'NHC')];
    expect(proposeFleetMapping(target, source)).toEqual({ 'tgt-nhc': 'src-nhc' });
  });

  it('never matches across scoringSystem boundaries', () => {
    const target = [fleet('tgt-nhc', 'nhc', 'Class 3')];
    const source = [fleet('src-echo', 'echo', 'Class 3')];
    expect(proposeFleetMapping(target, source)).toEqual({ 'tgt-nhc': null });
  });
});
