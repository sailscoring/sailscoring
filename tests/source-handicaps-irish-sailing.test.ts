import { describe, expect, it } from 'vitest';

import type { IrishSailingRating } from '@/lib/irish-sailing-ratings';
import {
  additionKey,
  planFleetAdditionsFromIrishSailing,
  planHandicapUpdatesFromIrishSailing,
  type FleetAdditionCandidate,
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
      ircVariantByFleet: { 'f-irc': 'spin' },
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
      ircVariantByFleet: { 'f-irc': 'non-spin' },
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.918 });
  });

  it('resolves spin and non-spin IRC fleets independently in one pass', () => {
    const twoIrc = [fleet('f-spin', 'irc'), fleet('f-nonspin', 'irc')];
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-spin', 'f-nonspin'])],
      targetFleets: twoIrc,
      ratings: [rating('IRL1431', { ircTcc: 0.932, ircNonSpinTcc: 0.918 })],
      ircVariantByFleet: { 'f-nonspin': 'non-spin' }, // f-spin omitted → defaults to spin
    });
    const byFleet = new Map(rows.map((r) => [r.targetFleetId, r]));
    expect(byFleet.get('f-spin')).toMatchObject({ newTcf: 0.932, ircVariant: 'spin' });
    expect(byFleet.get('f-nonspin')).toMatchObject({ newTcf: 0.918, ircVariant: 'non-spin' });
  });

  it('matches sail numbers regardless of spacing/case', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'irl 1431', ['f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.932, status: 'change' });
  });

  it('marks unchanged when the current value already matches', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'], { ircTcc: 0.932 })],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    expect(byKey(rows).get('c1::irc')!.status).toBe('unchanged');
  });

  it('omits NHC/PY fleets entirely (Irish Sailing publishes neither)', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-nhc', 'f-py', 'f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932, echo: 0.975 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    // Only the IRC row is produced; no noise rows for NHC/PY.
    expect(rows.map((r) => r.system)).toEqual(['irc']);
  });

  it('reports a boat absent from the list as no-source-competitor', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL9999', ['f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
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
      ircVariantByFleet: { 'f-irc': 'spin' },
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
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    expect(rows).toEqual([]);
  });
});

describe('planHandicapUpdatesFromIrishSailing — matching', () => {
  it('matches a country-code-less competitor to the prefixed record', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', '1431', ['f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    const row = byKey(rows).get('c1::irc')!;
    expect(row).toMatchObject({ newTcf: 0.932, status: 'change' });
    expect(row.match).toMatchObject({ method: 'sail-no-country', sail: 'IRL1431' });
  });

  it('does not annotate an exact sail match', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    expect(byKey(rows).get('c1::irc')!.match).toBeUndefined();
  });

  it('refuses to match across differing country prefixes', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'GBR1431', ['f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-competitor',
    });
  });

  it('flags two records with the same sail core as ambiguous', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', '1431', ['f-irc'])],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { ircTcc: 0.932 }), rating('GBR1431', { ircTcc: 0.94 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'ambiguous-match',
    });
  });

  it('matchByName resolves a boat with no sail match', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', '9999', ['f-irc'], { boatName: '3 Cheers' })],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { boatName: '3 Cheers', ircTcc: 0.932 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
      matchByName: true,
    });
    const row = byKey(rows).get('c1::irc')!;
    expect(row).toMatchObject({ newTcf: 0.932, status: 'change' });
    expect(row.match).toMatchObject({ method: 'name', sail: 'IRL1431', name: '3 Cheers' });
  });

  it('does not match by name unless the toggle is on', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', '9999', ['f-irc'], { boatName: '3 Cheers' })],
      targetFleets: fleets,
      ratings: [rating('IRL1431', { boatName: '3 Cheers', ircTcc: 0.932 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-competitor',
    });
  });

  it('uses the name to break a sail-core tie when matchByName is on', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', '1431', ['f-irc'], { boatName: 'Bravo' })],
      targetFleets: fleets,
      ratings: [
        rating('IRL1431', { boatName: 'Alpha', ircTcc: 0.932 }),
        rating('GBR1431', { boatName: 'Bravo', ircTcc: 0.94 }),
      ],
      ircVariantByFleet: { 'f-irc': 'spin' },
      matchByName: true,
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.94, status: 'change' });
  });
});

describe('planHandicapUpdatesFromIrishSailing — primary/secondary certificates', () => {
  // IRL7404 Pretty Polly: a primary cert and a secondary "(SC)" with a
  // different sail configuration (lower TCC here).
  const prettyPolly = [
    rating('IRL7404', { boatName: 'Pretty Polly', ircCertNumber: '11479', ircTcc: 1.114, ircNonSpinTcc: 1.092 }),
    rating('IRL7404', { boatName: 'Pretty Polly (SC)', ircCertNumber: '50718', ircTcc: 1.092, ircNonSpinTcc: 1.071 }),
  ];

  it('treats two certs for one sail number as a choice, not an ambiguity', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL7404', ['f-irc'])],
      targetFleets: fleets,
      ratings: prettyPolly,
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    const row = byKey(rows).get('c1::irc')!;
    expect(row.status).toBe('change');
    expect(row.certChoice?.options).toHaveLength(2);
  });

  it('defaults to the higher TCC certificate', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL7404', ['f-irc'])],
      targetFleets: fleets,
      ratings: prettyPolly,
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    const row = byKey(rows).get('c1::irc')!;
    expect(row.newTcf).toBe(1.114); // primary > secondary here
    expect(row.certChoice?.chosen).toBe('cert:11479');
  });

  it('honours an explicit switch to the other certificate', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL7404', ['f-irc'])],
      targetFleets: fleets,
      ratings: prettyPolly,
      ircVariantByFleet: { 'f-irc': 'spin' },
      certChoiceByCompetitor: { c1: 'cert:50718' },
    });
    const row = byKey(rows).get('c1::irc')!;
    expect(row.newTcf).toBe(1.092);
    expect(row.certChoice?.chosen).toBe('cert:50718');
  });

  it('default tracks the variant — picks whichever cert is higher for non-spin', () => {
    // Secondary is the higher non-spin cert in this contrived pair.
    const ratings = [
      rating('IRL10', { boatName: 'A', ircCertNumber: '100', ircTcc: 1.0, ircNonSpinTcc: 0.9 }),
      rating('IRL10', { boatName: 'A (SC)', ircCertNumber: '200', ircTcc: 0.99, ircNonSpinTcc: 0.95 }),
    ];
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL10', ['f-irc'])],
      targetFleets: fleets,
      ratings,
      ircVariantByFleet: { 'f-irc': 'non-spin' },
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.95, status: 'change' });
  });

  it('does not offer a cert choice on ECHO rows (value is the same)', () => {
    const rows = planHandicapUpdatesFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL7404', ['f-echo'])],
      targetFleets: fleets,
      ratings: prettyPolly.map((r) => ({ ...r, echo: 1.12 })),
      ircVariantByFleet: {},
    });
    const row = byKey(rows).get('c1::echo')!;
    expect(row.newTcf).toBe(1.12);
    expect(row.certChoice).toBeUndefined();
  });
});

describe('planFleetAdditionsFromIrishSailing', () => {
  function addByKey(cands: FleetAdditionCandidate[]) {
    return new Map(cands.map((c) => [additionKey(c.competitorId, c.system), c]));
  }

  it('proposes adding a rated boat that is not in the matching fleet', () => {
    const cands = planFleetAdditionsFromIrishSailing({
      // boat is in the scratch fleet, not IRC
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-irc', 'irc')],
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariantByFleet: {},
    });
    const c = addByKey(cands).get(additionKey('c1', 'irc'))!;
    expect(c).toMatchObject({ system: 'irc', targetFleetId: 'f-irc', proposedTcf: 0.932 });
  });

  it('does not propose a boat already in a fleet of that system', () => {
    const cands = planFleetAdditionsFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'])],
      targetFleets: [fleet('f-irc', 'irc')],
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariantByFleet: {},
    });
    expect(cands).toEqual([]);
  });

  it('computes IRC and ECHO candidacy independently', () => {
    // In the ECHO fleet already, but not IRC; has both values.
    const cands = planFleetAdditionsFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-echo'])],
      targetFleets: [fleet('f-irc', 'irc'), fleet('f-echo', 'echo')],
      ratings: [rating('IRL1431', { ircTcc: 0.932, echo: 0.975 })],
      ircVariantByFleet: {},
    });
    const m = addByKey(cands);
    expect(m.has(additionKey('c1', 'irc'))).toBe(true);   // not in IRC → candidate
    expect(m.has(additionKey('c1', 'echo'))).toBe(false); // already in ECHO → not
  });

  it('omits the system when the series has no fleet of it', () => {
    const cands = planFleetAdditionsFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-irc', 'irc')],
      ratings: [rating('IRL1431', { ircTcc: 0.932, echo: 0.975 })],
      ircVariantByFleet: {},
    });
    const m = addByKey(cands);
    expect(m.has(additionKey('c1', 'irc'))).toBe(true);
    expect(m.has(additionKey('c1', 'echo'))).toBe(false); // no ECHO fleet
  });

  it('leaves the target fleet unset when several of that system exist', () => {
    const cands = planFleetAdditionsFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-irc1', 'irc'), fleet('f-irc2', 'irc')],
      ratings: [rating('IRL1431', { ircTcc: 0.932 })],
      ircVariantByFleet: {},
    });
    const c = addByKey(cands).get(additionKey('c1', 'irc'))!;
    expect(c.targetFleetId).toBeNull();
    expect(c.fleetOptions.map((f) => f.fleetId)).toEqual(['f-irc1', 'f-irc2']);
  });

  it('honours the chosen target fleet and its variant', () => {
    const cands = planFleetAdditionsFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-irc1', 'irc'), fleet('f-irc2', 'irc')],
      ratings: [rating('IRL1431', { ircTcc: 0.932, ircNonSpinTcc: 0.918 })],
      ircVariantByFleet: { 'f-irc2': 'non-spin' },
      targetFleetByKey: { [additionKey('c1', 'irc')]: 'f-irc2' },
    });
    const c = addByKey(cands).get(additionKey('c1', 'irc'))!;
    expect(c).toMatchObject({ targetFleetId: 'f-irc2', proposedTcf: 0.918 });
  });

  it('proposes ECHO additions from the published value', () => {
    const cands = planFleetAdditionsFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-echo', 'echo')],
      ratings: [rating('IRL1431', { echo: 0.975 })],
      ircVariantByFleet: {},
    });
    const c = addByKey(cands).get(additionKey('c1', 'echo'))!;
    expect(c).toMatchObject({ system: 'echo', targetFleetId: 'f-echo', proposedTcf: 0.975 });
  });

  it('carries the primary/secondary cert switch into IRC additions', () => {
    const cands = planFleetAdditionsFromIrishSailing({
      targetCompetitors: [comp('c1', 'IRL7404', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-irc', 'irc')],
      ratings: [
        rating('IRL7404', { boatName: 'Pretty Polly', ircCertNumber: '11479', ircTcc: 1.114 }),
        rating('IRL7404', { boatName: 'Pretty Polly (SC)', ircCertNumber: '50718', ircTcc: 1.092 }),
      ],
      ircVariantByFleet: {},
    });
    const c = addByKey(cands).get(additionKey('c1', 'irc'))!;
    expect(c.proposedTcf).toBe(1.114); // higher-TCC default
    expect(c.certChoice?.options).toHaveLength(2);
  });
});
