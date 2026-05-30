import { describe, expect, it } from 'vitest';

import {
  additionKey,
  planEchoFleetAdditions,
  planEchoUpdates,
  type FleetAdditionCandidate,
  type PreviewRow,
  type RatingRecord,
} from '@/lib/source-handicaps';
import type { Competitor, Fleet } from '@/lib/types';

// Irish Sailing is the ECHO source (IRC TCCs now come from the international IRC
// list — see source-handicaps-irc.test.ts).

function comp(
  id: string,
  sailNumber: string,
  fleetIds: string[],
  extras: Partial<Competitor> = {},
): Competitor {
  return {
    id,
    seriesId: 's-target',
    fleetIds,
    sailNumber,
    name: id,
    club: '',
    gender: '',
    age: null,
    createdAt: 0,
    ...extras,
  };
}

function fleet(id: string, system: Fleet['scoringSystem']): Fleet {
  return { id, seriesId: 's-target', name: id, displayOrder: 0, scoringSystem: system };
}

function rating(sailNumber: string, extras: Partial<RatingRecord> = {}): RatingRecord {
  return { sailNumber, ...extras };
}

function byKey(rows: PreviewRow[]) {
  return new Map(rows.map((r) => [`${r.competitorId}::${r.system}`, r]));
}

const fleets = [fleet('f-irc', 'irc'), fleet('f-echo', 'echo'), fleet('f-nhc', 'nhc'), fleet('f-py', 'py')];

describe('planEchoUpdates', () => {
  it('seeds the ECHO standard by sail number', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-echo'])],
      targetFleets: fleets,
      records: [rating('IRL1431', { echo: 0.975 })],
    });
    expect(byKey(rows).get('c1::echo')).toMatchObject({ newTcf: 0.975, status: 'change' });
  });

  it('matches sail numbers regardless of spacing/case', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', 'irl 1431', ['f-echo'])],
      targetFleets: fleets,
      records: [rating('IRL1431', { echo: 0.975 })],
    });
    expect(byKey(rows).get('c1::echo')).toMatchObject({ newTcf: 0.975, status: 'change' });
  });

  it('marks unchanged when the current value already matches', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-echo'], { echoStartingTcf: 0.975 })],
      targetFleets: fleets,
      records: [rating('IRL1431', { echo: 0.975 })],
    });
    expect(byKey(rows).get('c1::echo')!.status).toBe('unchanged');
  });

  it('emits ECHO rows only — IRC/NHC/PY fleets produce nothing', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc', 'f-nhc', 'f-py', 'f-echo'])],
      targetFleets: fleets,
      records: [rating('IRL1431', { ircTcc: 0.932, echo: 0.975 })],
    });
    expect(rows.map((r) => r.system)).toEqual(['echo']);
  });

  it('reports a boat absent from the list as no-source-competitor', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', 'IRL9999', ['f-echo'])],
      targetFleets: fleets,
      records: [rating('IRL1431', { echo: 0.975 })],
    });
    expect(byKey(rows).get('c1::echo')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-competitor',
    });
  });

  it('reports a matched boat with no ECHO value as no-source-value', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', 'IRL1773', ['f-echo'])],
      targetFleets: fleets,
      records: [rating('IRL1773', { ircTcc: 1.01 })], // IRC-only record, no ECHO
    });
    expect(byKey(rows).get('c1::echo')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-value',
    });
  });

  it('ignores scratch fleets', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch')],
      records: [rating('IRL1431', { echo: 0.975 })],
    });
    expect(rows).toEqual([]);
  });
});

describe('planEchoUpdates — matching', () => {
  it('matches a country-code-less competitor to the prefixed record', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', '1431', ['f-echo'])],
      targetFleets: fleets,
      records: [rating('IRL1431', { echo: 0.975 })],
      defaultCountry: 'IRL',
    });
    const row = byKey(rows).get('c1::echo')!;
    expect(row).toMatchObject({ newTcf: 0.975, status: 'change' });
    expect(row.match).toMatchObject({ method: 'sail-no-country', sail: 'IRL1431' });
  });

  it('does not annotate an exact sail match', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-echo'])],
      targetFleets: fleets,
      records: [rating('IRL1431', { echo: 0.975 })],
    });
    expect(byKey(rows).get('c1::echo')!.match).toBeUndefined();
  });

  it('refuses to match across differing country prefixes', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', 'GBR1431', ['f-echo'])],
      targetFleets: fleets,
      records: [rating('IRL1431', { echo: 0.975 })],
    });
    expect(byKey(rows).get('c1::echo')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-competitor',
    });
  });

  it('matchByName resolves a boat with no sail match', () => {
    const rows = planEchoUpdates({
      targetCompetitors: [comp('c1', '9999', ['f-echo'], { boatName: '3 Cheers' })],
      targetFleets: fleets,
      records: [rating('IRL1431', { boatName: '3 Cheers', echo: 0.975 })],
      matchByName: true,
    });
    const row = byKey(rows).get('c1::echo')!;
    expect(row).toMatchObject({ newTcf: 0.975, status: 'change' });
    expect(row.match).toMatchObject({ method: 'name', sail: 'IRL1431', name: '3 Cheers' });
  });
});

describe('planEchoFleetAdditions', () => {
  function addByKey(cands: FleetAdditionCandidate[]) {
    return new Map(cands.map((c) => [additionKey(c.competitorId, c.system), c]));
  }

  it('proposes adding a rated boat that is not in an ECHO fleet', () => {
    const cands = planEchoFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-echo', 'echo')],
      records: [rating('IRL1431', { echo: 0.975 })],
    });
    expect(addByKey(cands).get(additionKey('c1', 'echo'))).toMatchObject({
      system: 'echo',
      targetFleetId: 'f-echo',
      proposedTcf: 0.975,
    });
  });

  it('does not propose a boat already in an ECHO fleet', () => {
    const cands = planEchoFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-echo'])],
      targetFleets: [fleet('f-echo', 'echo')],
      records: [rating('IRL1431', { echo: 0.975 })],
    });
    expect(cands).toEqual([]);
  });

  it('never proposes IRC additions (those are the international IRC source)', () => {
    const cands = planEchoFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-irc', 'irc')],
      records: [rating('IRL1431', { ircTcc: 0.932, echo: 0.975 })],
    });
    expect(addByKey(cands).has(additionKey('c1', 'irc'))).toBe(false);
  });

  it('omits ECHO when the series has no ECHO fleet', () => {
    const cands = planEchoFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch')],
      records: [rating('IRL1431', { echo: 0.975 })],
    });
    expect(cands).toEqual([]);
  });
});
