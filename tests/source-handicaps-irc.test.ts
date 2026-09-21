import { describe, expect, it } from 'vitest';

import {
  additionKey,
  planIrcFleetAdditions,
  planIrcFleetRemovals,
  planIrcUpdates,
  type FleetAdditionCandidate,
  type PreviewRow,
  type RatingRecord,
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
    names: [id],
    clubs: [],
    gender: '',
    age: null,
    createdAt: 0,
    ...extras,
  };
}

function fleet(id: string, system: Fleet['scoringSystem']): Fleet {
  return { id, seriesId: 's-target', name: id, displayOrder: 0, scoringSystem: system };
}

function rec(sailNumber: string, extras: Partial<RatingRecord> = {}): RatingRecord {
  return { sailNumber, ...extras };
}

function byKey(rows: PreviewRow[]) {
  return new Map(rows.map((r) => [`${r.competitorId}::${r.system}`, r]));
}

const fleets = [fleet('f-irc', 'irc'), fleet('f-echo', 'echo'), fleet('f-nhc', 'nhc'), fleet('f-py', 'py')];

describe('planIrcUpdates', () => {
  it('seeds spin IRC TCC by default', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'])],
      targetFleets: fleets,
      records: [rec('IRL1431', { ircTcc: 0.932, ircNonSpinTcc: 0.918 })],
      ircVariantByFleet: { 'f-irc': 'spin' },
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.932, status: 'change' });
  });

  it('uses the non-spin TCC when that variant is chosen', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'])],
      targetFleets: fleets,
      records: [rec('IRL1431', { ircTcc: 0.932, ircNonSpinTcc: 0.918 })],
      ircVariantByFleet: { 'f-irc': 'non-spin' },
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.918 });
  });

  it('resolves spin and non-spin IRC fleets independently in one pass', () => {
    const twoIrc = [fleet('f-spin', 'irc'), fleet('f-nonspin', 'irc')];
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-spin', 'f-nonspin'])],
      targetFleets: twoIrc,
      records: [rec('IRL1431', { ircTcc: 0.932, ircNonSpinTcc: 0.918 })],
      ircVariantByFleet: { 'f-nonspin': 'non-spin' }, // f-spin omitted → defaults to spin
    });
    const byFleet = new Map(rows.map((r) => [r.targetFleetId, r]));
    expect(byFleet.get('f-spin')).toMatchObject({ newTcf: 0.932, ircVariant: 'spin' });
    expect(byFleet.get('f-nonspin')).toMatchObject({ newTcf: 0.918, ircVariant: 'non-spin' });
  });

  it('marks unchanged when the current value already matches', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'], { ircTcc: 0.932 })],
      targetFleets: fleets,
      records: [rec('IRL1431', { ircTcc: 0.932 })],
    });
    expect(byKey(rows).get('c1::irc')!.status).toBe('unchanged');
  });

  it('emits IRC rows only — ECHO/NHC/PY fleets produce nothing', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-echo', 'f-nhc', 'f-py', 'f-irc'])],
      targetFleets: fleets,
      records: [rec('IRL1431', { ircTcc: 0.932, echo: 0.975 })],
    });
    expect(rows.map((r) => r.system)).toEqual(['irc']);
  });

  it('reports a boat absent from the list as no-source-competitor', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL9999', ['f-irc'])],
      targetFleets: fleets,
      records: [rec('IRL1431', { ircTcc: 0.932 })],
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-competitor',
    });
  });

  it('reports a matched boat with no IRC value as no-source-value', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1773', ['f-irc'])],
      targetFleets: fleets,
      records: [rec('IRL1773', { echo: 1.01 })], // ECHO-only record, no TCC
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-value',
    });
  });

  it('ignores scratch fleets', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch')],
      records: [rec('IRL1431', { ircTcc: 0.932 })],
    });
    expect(rows).toEqual([]);
  });
});

describe('planIrcUpdates — matching and the default country code', () => {
  it('does not annotate an exact sail match', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'])],
      targetFleets: fleets,
      records: [rec('IRL1431', { ircTcc: 0.932 })],
      defaultCountry: 'IRL',
    });
    expect(byKey(rows).get('c1::irc')!.match).toBeUndefined();
  });

  it('matches a country-code-less competitor to the prefixed record, flagged', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', '1431', ['f-irc'])],
      targetFleets: fleets,
      records: [rec('IRL1431', { ircTcc: 0.932 })],
      defaultCountry: 'IRL',
    });
    const row = byKey(rows).get('c1::irc')!;
    expect(row).toMatchObject({ newTcf: 0.932, status: 'change' });
    expect(row.match).toMatchObject({ method: 'sail-no-country', sail: 'IRL1431' });
  });

  it('uses the default country to disambiguate a bare number in a worldwide list', () => {
    // "1431" exists for several nations; the IRL default resolves to the Irish boat.
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', '1431', ['f-irc'])],
      targetFleets: fleets,
      records: [rec('IRL1431', { ircTcc: 0.932 }), rec('GBR1431', { ircTcc: 0.94 })],
      defaultCountry: 'IRL',
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.932, status: 'change' });
  });

  it('reports the same bare number as ambiguous when no default country is set', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', '1431', ['f-irc'])],
      targetFleets: fleets,
      records: [rec('IRL1431', { ircTcc: 0.932 }), rec('GBR1431', { ircTcc: 0.94 })],
      defaultCountry: '',
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'ambiguous-match',
    });
  });

  it('honours a competitor that does carry a different country code', () => {
    // Even with an IRL default, an explicit GBR competitor matches the GBR boat.
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'GBR1431', ['f-irc'])],
      targetFleets: fleets,
      records: [rec('IRL1431', { ircTcc: 0.932 }), rec('GBR1431', { ircTcc: 0.94 })],
      defaultCountry: 'IRL',
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.94, status: 'change' });
  });

  it('matchByName resolves a boat with no sail match', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', '9999', ['f-irc'], { boatName: '3 Cheers' })],
      targetFleets: fleets,
      records: [rec('IRL1431', { boatName: '3 Cheers', ircTcc: 0.932 })],
      matchByName: true,
      defaultCountry: 'IRL',
    });
    const row = byKey(rows).get('c1::irc')!;
    expect(row).toMatchObject({ newTcf: 0.932, status: 'change' });
    expect(row.match).toMatchObject({ method: 'name', sail: 'IRL1431' });
  });

  it('refuses a name match when the two sail numbers name different countries', () => {
    // The Alchemy case: an uncertificated Elan 31 sailing as IRL3154 matched by
    // name to GBR9608 and took that boat's non-spinnaker TCC. `sailNumbersMatch`
    // refuses IRL3154 against GBR9608; the name fallback must not walk around it.
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', '3154', ['f-irc'], { boatName: 'Alchemy' })],
      targetFleets: fleets,
      records: [rec('GBR9608', { boatName: 'ALCHEMY', ircTcc: 0.88, ircNonSpinTcc: 0.867 })],
      matchByName: true,
      defaultCountry: 'IRL',
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ status: 'not-found' });
  });

  it('still matches by name within one country', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL3154', ['f-irc'], { boatName: 'Alchemy' })],
      targetFleets: fleets,
      records: [rec('IRL9608', { boatName: 'ALCHEMY', ircTcc: 0.88 })],
      matchByName: true,
      defaultCountry: 'IRL',
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 0.88, status: 'change' });
  });

  it('reports a name-narrowed sail match as resting on the name too', () => {
    // Two boats share the core, and the name picked between them — so the name
    // is part of what the scorer is being asked to verify.
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', '1431', ['f-irc'], { boatName: 'Halcyon' })],
      targetFleets: fleets,
      records: [
        rec('1431', { boatName: 'Halcyon', ircTcc: 0.932 }),
        rec('IRL1431', { boatName: 'Sundowner', ircTcc: 0.94 }),
      ],
      matchByName: true,
      defaultCountry: '',
    });
    expect(byKey(rows).get('c1::irc')!.match).toMatchObject({ method: 'sail-and-name' });
  });
});

describe('planIrcUpdates — the certificate behind the number (#615)', () => {
  const alchemy = rec('IRL3154', {
    boatName: 'Alchemy',
    ircTcc: 0.94,
    ircNonSpinTcc: 0.927,
    ircCertNumber: '2951',
    certYear: '2026',
    issueDate: '01/03/2026',
    hullLength: 9.45,
    beam: 3.1,
    crew: 6,
  });

  it('records which certificate a rating came from, and off which list', () => {
    // `ircTcc` on its own is a bare number, so a competitor asking why their
    // boat was rated as it was had nobody who could answer.
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL3154', ['f-irc'])],
      targetFleets: fleets,
      records: [alchemy],
      source: { name: 'IRC ClubListing', updatedAt: '30/05/2026' },
    });
    expect(byKey(rows).get('c1::irc')!.ircCert).toMatchObject({
      certNumber: '2951',
      sailNumber: 'IRL3154',
      boatName: 'Alchemy',
      certYear: '2026',
      issueDate: '01/03/2026',
      tcc: 0.94,
      nonSpinTcc: 0.927,
      variantApplied: 'spin',
      source: 'IRC ClubListing',
      sourceUpdatedAt: '30/05/2026',
      matchedBy: 'exact-sail',
    });
  });

  it('records the shape of the boat, which is what tells two of a name apart', () => {
    // 8.56 m x 2.82 m is not an Elan 31 — the discrepancy a competitor spotted
    // in seconds when nothing in the app had.
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL3154', ['f-irc'])],
      targetFleets: fleets,
      records: [alchemy],
    });
    expect(byKey(rows).get('c1::irc')!.ircCert).toMatchObject({
      hullLength: 9.45,
      beam: 3.1,
      crew: 6,
    });
  });

  it('records which of the TCC pair was applied', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL3154', ['f-irc'])],
      targetFleets: fleets,
      records: [alchemy],
      ircVariantByFleet: { 'f-irc': 'non-spin' },
    });
    const row = byKey(rows).get('c1::irc')!;
    expect(row.newTcf).toBe(0.927);
    expect(row.ircCert).toMatchObject({ variantApplied: 'non-spin' });
  });

  it('records how the boat was matched, so a weak basis stays visible', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', '3154', ['f-irc'])],
      targetFleets: fleets,
      records: [alchemy],
      defaultCountry: 'IRL',
    });
    expect(byKey(rows).get('c1::irc')!.ircCert).toMatchObject({
      matchedBy: 'sail-no-country',
    });
  });

  it('leaves no certificate on a non-IRC row', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL3154', ['f-echo'])],
      targetFleets: fleets,
      records: [rec('IRL3154', { echo: 1.02 })],
    });
    expect(byKey(rows).get('c1::echo')?.ircCert).toBeUndefined();
  });
});

describe('planIrcFleetAdditions — a name match never enrols a boat', () => {
  it('does not offer to add a boat matched by name alone', () => {
    // Enrolling a boat in an IRC fleet asserts she holds an IRC certificate.
    // A shared boat name is no evidence of that, and 12% of the list shares a
    // name with another boat on it.
    const candidates = planIrcFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL3154', ['f-nhc'], { boatName: 'Alchemy' })],
      targetFleets: fleets,
      records: [rec('IRL9608', { boatName: 'ALCHEMY', ircTcc: 0.88 })],
      matchByName: true,
      defaultCountry: 'IRL',
    });
    expect(candidates).toHaveLength(0);
  });

  it('still offers a boat matched on her sail number', () => {
    const candidates = planIrcFleetAdditions({
      targetCompetitors: [comp('c1', '3154', ['f-nhc'], { boatName: 'Alchemy' })],
      targetFleets: fleets,
      records: [rec('IRL3154', { boatName: 'Alchemy', ircTcc: 0.88 })],
      matchByName: true,
      defaultCountry: 'IRL',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].match).toMatchObject({ method: 'sail-no-country' });
  });
});

describe('planIrcUpdates — primary/secondary certificates (Secondary=SEC flag)', () => {
  const prettyPolly = [
    rec('IRL7404', { boatName: 'Pretty Polly', ircCertNumber: '11479', ircTcc: 1.114, ircNonSpinTcc: 1.092, isSecondary: false }),
    rec('IRL7404', { boatName: 'Pretty Polly - SEC', ircCertNumber: '50718', ircTcc: 1.092, ircNonSpinTcc: 1.071, isSecondary: true }),
  ];

  it('treats two certs for one sail number as a choice, not an ambiguity', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL7404', ['f-irc'])],
      targetFleets: fleets,
      records: prettyPolly,
    });
    const row = byKey(rows).get('c1::irc')!;
    expect(row.status).toBe('change');
    expect(row.certChoice?.options).toHaveLength(2);
  });

  it('defaults to the higher TCC certificate', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL7404', ['f-irc'])],
      targetFleets: fleets,
      records: prettyPolly,
    });
    const row = byKey(rows).get('c1::irc')!;
    expect(row.newTcf).toBe(1.114);
    expect(row.certChoice?.chosen).toBe('cert:11479');
  });

  it('honours an explicit switch to the other certificate', () => {
    const rows = planIrcUpdates({
      targetCompetitors: [comp('c1', 'IRL7404', ['f-irc'])],
      targetFleets: fleets,
      records: prettyPolly,
      certChoiceByCompetitor: { c1: 'cert:50718' },
    });
    expect(byKey(rows).get('c1::irc')).toMatchObject({ newTcf: 1.092 });
  });
});

describe('planIrcFleetAdditions', () => {
  function addByKey(cands: FleetAdditionCandidate[]) {
    return new Map(cands.map((c) => [additionKey(c.competitorId, c.system), c]));
  }

  it('proposes adding a rated boat that is not in an IRC fleet', () => {
    const cands = planIrcFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-irc', 'irc')],
      records: [rec('IRL1431', { ircTcc: 0.932 })],
    });
    expect(addByKey(cands).get(additionKey('c1', 'irc'))).toMatchObject({
      system: 'irc',
      targetFleetId: 'f-irc',
      proposedTcf: 0.932,
    });
  });

  it('does not propose a boat already in an IRC fleet', () => {
    const cands = planIrcFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'])],
      targetFleets: [fleet('f-irc', 'irc')],
      records: [rec('IRL1431', { ircTcc: 0.932 })],
    });
    expect(cands).toEqual([]);
  });

  it('never proposes ECHO additions (those are the Irish Sailing source)', () => {
    const cands = planIrcFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-echo', 'echo')],
      records: [rec('IRL1431', { ircTcc: 0.932, echo: 0.975 })],
    });
    expect(addByKey(cands).has(additionKey('c1', 'echo'))).toBe(false);
  });

  it('honours the chosen target fleet and its variant', () => {
    const cands = planIrcFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-irc1', 'irc'), fleet('f-irc2', 'irc')],
      records: [rec('IRL1431', { ircTcc: 0.932, ircNonSpinTcc: 0.918 })],
      ircVariantByFleet: { 'f-irc2': 'non-spin' },
      targetFleetByKey: { [additionKey('c1', 'irc')]: 'f-irc2' },
    });
    expect(addByKey(cands).get(additionKey('c1', 'irc'))).toMatchObject({
      targetFleetId: 'f-irc2',
      proposedTcf: 0.918,
    });
  });

  it('carries the primary/secondary cert switch into IRC additions', () => {
    const cands = planIrcFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL7404', ['f-scratch'])],
      targetFleets: [fleet('f-scratch', 'scratch'), fleet('f-irc', 'irc')],
      records: [
        rec('IRL7404', { boatName: 'Pretty Polly', ircCertNumber: '11479', ircTcc: 1.114, isSecondary: false }),
        rec('IRL7404', { boatName: 'Pretty Polly - SEC', ircCertNumber: '50718', ircTcc: 1.092, isSecondary: true }),
      ],
    });
    const c = addByKey(cands).get(additionKey('c1', 'irc'))!;
    expect(c.proposedTcf).toBe(1.114);
    expect(c.certChoice?.options).toHaveLength(2);
  });
});

describe('planIrcFleetRemovals', () => {
  it('proposes removing a boat in an IRC fleet that the list does not rate', () => {
    // The over-full fleet an import creates: an entry list with no IRC column
    // can't say who holds a certificate, so everyone joined.
    const cands = planIrcFleetRemovals({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc']), comp('c2', 'IRL9999', ['f-irc'])],
      targetFleets: [fleet('f-irc', 'irc')],
      records: [rec('IRL1431', { ircTcc: 0.932 })],
    });
    expect(cands).toEqual([
      { competitorId: 'c2', fleetId: 'f-irc', fleetName: 'f-irc', system: 'irc' },
    ]);
  });

  it('leaves a boat that has already raced alone', () => {
    // Taking it out would drop scored races — not a tidy-up.
    const cands = planIrcFleetRemovals({
      targetCompetitors: [comp('c2', 'IRL9999', ['f-irc'])],
      targetFleets: [fleet('f-irc', 'irc')],
      records: [],
      competitorIdsWithResults: new Set(['c2']),
    });
    expect(cands).toEqual([]);
  });

  it('only touches fleets of its own system', () => {
    const cands = planIrcFleetRemovals({
      targetCompetitors: [comp('c2', 'IRL9999', ['f-irc', 'f-nhc', 'f-echo'])],
      targetFleets: fleets,
      records: [],
    });
    expect(cands.map((c) => c.fleetId)).toEqual(['f-irc']);
  });

  it('keeps a boat the list rates only for a different system', () => {
    // An ECHO number is not an IRC certificate.
    const cands = planIrcFleetRemovals({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'])],
      targetFleets: [fleet('f-irc', 'irc')],
      records: [rec('IRL1431', { echo: 0.975 })],
    });
    expect(cands.map((c) => c.competitorId)).toEqual(['c1']);
  });

  it('keeps a boat rated only on its non-spin TCC', () => {
    const cands = planIrcFleetRemovals({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-irc'])],
      targetFleets: [fleet('f-irc', 'irc')],
      records: [rec('IRL1431', { ircNonSpinTcc: 0.918 })],
    });
    expect(cands).toEqual([]);
  });
});
