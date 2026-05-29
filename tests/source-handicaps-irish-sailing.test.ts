import { describe, expect, it } from 'vitest';

import type { IrishSailingRating } from '@/lib/irish-sailing-ratings';
import {
  planHandicapUpdatesFromIrishSailing,
  type PreviewRow,
} from '@/lib/source-handicaps';
import type { Competitor, Fleet } from '@/lib/types';

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

function rating(sailNumber: string, extras: Partial<IrishSailingRating> = {}): IrishSailingRating {
  return { sailNumber, ...extras };
}

function byKey(rows: PreviewRow[]) {
  return new Map(rows.map((r) => [`${r.competitorId}::${r.system}`, r]));
}

const fleets = [fleet('f-irc', 'irc'), fleet('f-echo', 'echo'), fleet('f-nhc', 'nhc'), fleet('f-py', 'py')];

describe('planHandicapUpdatesFromIrishSailing', () => {
  it('seeds spin IRC TCC and ECHO by default', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc', 'f-echo'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932, ircNonSpinTcc: 0.918, echo: 0.975 })],
      ircVariant: 'spin',
    });
    const m = byKey(rows);
    expect(m.get('c1::irc')).toMatchObject({ newTcf: 0.932, status: 'change' });
    expect(m.get('c1::echo')).toMatchObject({ newTcf: 0.975, status: 'change' });
  });

  it('uses the non-spin TCC when that variant is chosen', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932, ircNonSpinTcc: 0.918 })],
      ircVariant: 'non-spin',
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.918 });
  });

  it('matches sail numbers regardless of spacing/case', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'irl 1431', ['f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariant: 'spin',
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.932, status: 'change' });
  });

  it('marks unchanged when the current value already matches', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'], { ircTcc: 0.932 })],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariant: 'spin',
    });
    expect(byKey(rows).get('c1::irc')!.status).toBe('unchanged');
  });

  it('reports NHC/PY fleets as system-not-published', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-nhc', 'f-py'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932, echo: 0.975 })],
      ircVariant: 'spin',
    });
    const m = byKey(rows);
    expect(m.get('c1::nhc')).toMatchObject({ status: 'not-found', notFoundReason: 'system-not-published' });
    expect(m.get('c1::py')).toMatchObject({ status: 'not-found', notFoundReason: 'system-not-published' });
  });

  it('reports a boat absent from the list as no-source-competitor', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL9999', ['f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariant: 'spin',
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-competitor',
    });
  });

  it('reports a matched boat lacking the value as no-source-value', () => {
    // ECHO-only boat asked for its IRC TCC.
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1773', ['f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1773', { echo: 1.01 })],
      ircVariant: 'spin',
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-value',
    });
  });

  it('ignores scratch fleets', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch')],
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariant: 'spin',
    });
    expect(rows).toEqual([]);
  });
});
