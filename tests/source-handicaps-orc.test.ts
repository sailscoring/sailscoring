import { describe, expect, it } from 'vitest';

import type { OrcCertEntry } from '@/lib/orc-certificate';
import {
  additionKey,
  orcPlanChecks,
  planOrcFleetAdditions,
  planOrcFleetRemovals,
  planOrcUpdates,
  type PreviewRow,
} from '@/lib/source-handicaps';
import type { Competitor, Fleet, OrcCertData } from '@/lib/types';

const NOW = Date.parse('2026-08-24T12:00:00Z');

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

function fleet(id: string, system: Fleet['scoringSystem'], extras: Partial<Fleet> = {}): Fleet {
  return { id, seriesId: 's-target', name: id, displayOrder: 0, scoringSystem: system, ...extras };
}

function entry(
  sailNo: string,
  fields: Record<string, unknown> = {},
  meta: Partial<Omit<OrcCertEntry, 'record'>> = {},
): OrcCertEntry {
  return {
    record: {
      SailNo: sailNo,
      YachtName: `Boat ${sailNo}`,
      RefNo: `ref-${sailNo}`,
      IssueDate: '2026-03-01T00:00:00.000Z',
      APHT: 0.95,
      APHD: 631.6,
      ...fields,
    },
    expiryDate: '2026-12-31T00:00:00.000Z',
    vppYear: 2026,
    ...meta,
  };
}

const orcFleet = fleet('f-orc', 'orc');
const nsFleet = fleet('f-orc-ns', 'orc', { displayOrder: 1 });

describe('planOrcUpdates', () => {
  it('proposes the certificate with the fleet-option rating as the delta scalar', () => {
    const rows = planOrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-orc'])],
      targetFleets: [orcFleet],
      entriesByFamily: { ORC: [entry('IRL 1431', { APHT: 0.9631 })] },
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ system: 'orc', newTcf: 0.9631, status: 'change' });
    expect(rows[0].orcCert?.record.RefNo).toBe('ref-IRL 1431');
    expect(rows[0].orcCert?.expiryDate).toBe('2026-12-31T00:00:00.000Z');
    expect(rows[0].orcCert?.importedAt).toBe(NOW);
  });

  it('matches the fleet-configured national option and falls back to APHT for ToD', () => {
    const banded = fleet('f-orc', 'orc', { orcProfile: { option: 'IRL_5B_WL_M_TOT', kind: 'tot' } });
    const rows = planOrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-orc'])],
      targetFleets: [banded],
      entriesByFamily: { ORC: [entry('IRL1431', { IRL_5B_WL_M_TOT: 0.7841 })] },
      now: NOW,
    });
    expect(rows[0].newTcf).toBe(0.7841);

    const tod = fleet('f-orc', 'orc', { orcProfile: { option: 'APHD', kind: 'tod' } });
    const todRows = planOrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-orc'])],
      targetFleets: [tod],
      entriesByFamily: { ORC: [entry('IRL1431', { APHT: 0.9631 })] },
      now: NOW,
    });
    // ToD option: the comparable scalar shown is APHT.
    expect(todRows[0].newTcf).toBe(0.9631);
  });

  it('reads the current rating off the held certificate the same way as the new one', () => {
    // A boat whose certificate is already imported: current is read off the
    // stored record under the fleet's option, with the same APHT fallback the
    // incoming certificate gets — so the delta is the re-rating, not the
    // whole number against a blank.
    const stored: OrcCertData = {
      record: { RefNo: 'ref-old', IssueDate: '2026-03-01T00:00:00.000Z', APHT: 0.95, APHD: 640 },
      importedAt: 1,
    };
    const held = [comp('c1', 'IRL1431', ['f-orc'], { orcCert: stored })];
    const listing = { ORC: [entry('IRL1431', { APHT: 0.9631, IssueDate: '2026-08-01T00:00:00.000Z' })] };

    for (const configured of [
      orcFleet,
      fleet('f-orc', 'orc', { orcProfile: { option: 'APHD', kind: 'tod' } }),
      fleet('f-orc', 'orc', { orcProfile: { option: 'WL', kind: 'pcs' } }),
    ]) {
      const rows = planOrcUpdates({
        targetCompetitors: held,
        targetFleets: [configured],
        entriesByFamily: listing,
        now: NOW,
      });
      expect(rows[0]).toMatchObject({ currentTcf: 0.95, newTcf: 0.9631, status: 'change' });
    }
  });

  it('falls back to APHT on both sides when the stored certificate lacks the fleet option', () => {
    const stored: OrcCertData = {
      record: { RefNo: 'ref-old', IssueDate: '2026-03-01T00:00:00.000Z', APHT: 0.95 },
      importedAt: 1,
    };
    const rows = planOrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-orc'], { orcCert: stored })],
      targetFleets: [fleet('f-orc', 'orc', { orcProfile: { option: 'TMF_Inshore', kind: 'tot' } })],
      entriesByFamily: { ORC: [entry('IRL1431', { TMF_Inshore: 1.02, IssueDate: '2026-08-01T00:00:00.000Z' })] },
      now: NOW,
    });
    expect(rows[0]).toMatchObject({ currentTcf: 0.95, newTcf: 1.02 });
  });

  it('reads the family listing the fleet is configured for', () => {
    const rows = planOrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-orc-ns'])],
      targetFleets: [nsFleet],
      entriesByFamily: {
        ORC: [entry('IRL1431', { APHT: 0.95 })],
        NS: [entry('IRL1431', { APHT: 0.91, C_Type: 'NSCL', Family: 'NS' })],
      },
      familyByFleet: { 'f-orc-ns': 'NS' },
      now: NOW,
    });
    expect(rows[0].newTcf).toBe(0.91);
    expect(rows[0].orcCert?.record.Family).toBe('NS');
  });

  it('imports the standard certificate for a boat the fleet\u2019s family doesn\u2019t rate', () => {
    const rows = planOrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-orc-ns']), comp('c2', 'IRL2222', ['f-orc-ns'])],
      targetFleets: [nsFleet],
      entriesByFamily: {
        ORC: [entry('IRL1431', { APHT: 0.95 }), entry('IRL2222', { APHT: 0.99 })],
        NS: [entry('IRL2222', { APHT: 0.91, Family: 'NS' })],
      },
      familyByFleet: { 'f-orc-ns': 'NS' },
      now: NOW,
    });
    const byId = new Map(rows.map((r) => [r.competitorId, r]));
    // No non-spinnaker certificate: the standard one, annotated as such.
    expect(byId.get('c1')).toMatchObject({ newTcf: 0.95, status: 'change', orcCertFamily: 'ORC' });
    // Its own family rates it — untouched, and unannotated.
    expect(byId.get('c2')).toMatchObject({ newTcf: 0.91, status: 'change' });
    expect(byId.get('c2')?.orcCertFamily).toBeUndefined();
    expect(byId.get('c2')?.orcCert?.record.Family).toBe('NS');
  });

  it('never falls back past an ambiguous match in the fleet\u2019s own family', () => {
    const rows = planOrcUpdates({
      targetCompetitors: [comp('c1', '1431', ['f-orc-ns'])],
      targetFleets: [nsFleet],
      entriesByFamily: {
        ORC: [entry('IRL1431', { APHT: 0.95 })],
        NS: [entry('IRL1431', { Family: 'NS' }), entry('GBR1431', { Family: 'NS' })],
      },
      familyByFleet: { 'f-orc-ns': 'NS' },
      defaultCountry: '',
      now: NOW,
    });
    expect(rows[0]).toMatchObject({ status: 'not-found', notFoundReason: 'ambiguous-match' });
  });

  it('produces no rows for a family whose listing is not loaded', () => {
    const rows = planOrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-orc-ns'])],
      targetFleets: [nsFleet],
      entriesByFamily: { ORC: [entry('IRL1431')] },
      familyByFleet: { 'f-orc-ns': 'NS' },
      now: NOW,
    });
    expect(rows).toHaveLength(0);
  });

  it('is unchanged only for the same certificate issue (RefNo + IssueDate)', () => {
    const stored: OrcCertData = {
      record: { RefNo: 'ref-IRL1431', IssueDate: '2026-03-01T00:00:00.000Z', APHT: 0.95 },
      importedAt: 1,
    };
    const same = planOrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-orc'], { orcCert: stored })],
      targetFleets: [orcFleet],
      entriesByFamily: { ORC: [entry('IRL1431')] },
      now: NOW,
    });
    expect(same[0].status).toBe('unchanged');

    const reissued = planOrcUpdates({
      targetCompetitors: [comp('c1', 'IRL1431', ['f-orc'], { orcCert: stored })],
      targetFleets: [orcFleet],
      entriesByFamily: { ORC: [entry('IRL1431', { IssueDate: '2026-08-01T00:00:00.000Z' })] },
      now: NOW,
    });
    // Same rating number, but a newer certificate issue — still a change.
    expect(reissued[0].status).toBe('change');
    expect(reissued[0].newTcf).toBe(0.95);
  });

  it('surfaces unmatched boats and picks the latest of duplicate certificates', () => {
    const rows = planOrcUpdates({
      targetCompetitors: [comp('c1', 'IRL9999', ['f-orc']), comp('c2', 'IRL1431', ['f-orc'])],
      targetFleets: [orcFleet],
      entriesByFamily: {
        ORC: [
          entry('IRL1431', { APHT: 0.94, IssueDate: '2026-01-01T00:00:00.000Z' }),
          entry('IRL1431', { APHT: 0.96, IssueDate: '2026-06-01T00:00:00.000Z' }),
        ],
      },
      now: NOW,
    });
    const byId = new Map(rows.map((r) => [r.competitorId, r]));
    expect(byId.get('c1')).toMatchObject({ status: 'not-found', notFoundReason: 'no-source-competitor' });
    expect(byId.get('c2')?.newTcf).toBe(0.96);
  });
});

describe('planOrcFleetAdditions / planOrcFleetRemovals', () => {
  it('offers a certified boat outside any ORC fleet, seeding the sole fleet', () => {
    const adds = planOrcFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', [])],
      targetFleets: [orcFleet],
      entriesByFamily: { ORC: [entry('IRL1431', { APHT: 0.9631 })] },
      now: NOW,
    });
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({ system: 'orc', targetFleetId: 'f-orc', proposedTcf: 0.9631 });
    expect(adds[0].orcCert?.record.RefNo).toBe('ref-IRL1431');
  });

  it('offers a standard-only boat for a non-spinnaker fleet, annotated', () => {
    const adds = planOrcFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', [])],
      targetFleets: [nsFleet],
      entriesByFamily: { ORC: [entry('IRL1431', { APHT: 0.9631 })], NS: [] },
      familyByFleet: { 'f-orc-ns': 'NS' },
      now: NOW,
    });
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({
      targetFleetId: 'f-orc-ns',
      proposedTcf: 0.9631,
      orcCertFamily: 'ORC',
    });
  });

  it('offers every ORC fleet when the series spans two certificate families', () => {
    const input = {
      targetCompetitors: [comp('c1', 'IRL1431', [])],
      targetFleets: [orcFleet, nsFleet],
      entriesByFamily: {
        ORC: [entry('IRL1431', { APHT: 0.9631 })],
        NS: [entry('IRL1431', { APHT: 0.9412 })],
      },
      familyByFleet: { 'f-orc-ns': 'NS' } as const,
      now: NOW,
    };
    const adds = planOrcFleetAdditions(input);
    expect(adds).toHaveLength(1);
    // Both divisions are on offer; the standard fleet comes first, so that is
    // the default — and it is what seeds the rating.
    expect(adds[0].fleetOptions.map((f) => f.fleetId)).toEqual(['f-orc', 'f-orc-ns']);
    expect(adds[0]).toMatchObject({ targetFleetId: 'f-orc', proposedTcf: 0.9631 });

    // Choosing the non-spinnaker fleet seeds the non-spinnaker certificate.
    const moved = planOrcFleetAdditions({
      ...input,
      targetFleetByKey: { [additionKey('c1', 'orc')]: 'f-orc-ns' },
    });
    expect(moved[0]).toMatchObject({ targetFleetId: 'f-orc-ns', proposedTcf: 0.9412 });
    expect(moved[0].orcCertFamily).toBeUndefined();
  });

  it('leaves no rating when the chosen fleet\'s family does not rate the boat', () => {
    const adds = planOrcFleetAdditions({
      targetCompetitors: [comp('c1', 'IRL1431', [])],
      targetFleets: [orcFleet, nsFleet],
      // A non-spinnaker certificate only: it rates the NS fleet, but nothing
      // rates the spinnaker division.
      entriesByFamily: { ORC: [], NS: [entry('IRL1431', { APHT: 0.9412 })] },
      familyByFleet: { 'f-orc-ns': 'NS' },
      targetFleetByKey: { [additionKey('c1', 'orc')]: 'f-orc' },
      now: NOW,
    });
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({ targetFleetId: 'f-orc', proposedTcf: null });
    expect(adds[0].orcCert).toBeUndefined();
  });

  it('spares a standard-only boat in a non-spinnaker fleet from removal', () => {
    const input = {
      targetCompetitors: [comp('c1', 'IRL1431', ['f-orc-ns']), comp('c2', 'IRL9999', ['f-orc-ns'])],
      targetFleets: [nsFleet],
      entriesByFamily: { ORC: [entry('IRL1431')], NS: [] },
      familyByFleet: { 'f-orc-ns': 'NS' } as const,
      now: NOW,
    };
    // c1 holds a standard certificate — the fallback rates it, so it stays.
    // c2 holds none at all, in either family.
    expect(planOrcFleetRemovals(input).map((r) => r.competitorId)).toEqual(['c2']);

    // …and with the standard listing still loading, neither is proposed.
    expect(
      planOrcFleetRemovals({ ...input, entriesByFamily: { NS: [] } }),
    ).toHaveLength(0);
  });

  it('offers removal for an uncertified boat in an ORC fleet, sparing boats with results', () => {
    const input = {
      targetCompetitors: [comp('c1', 'IRL9999', ['f-orc']), comp('c2', 'IRL8888', ['f-orc'])],
      targetFleets: [orcFleet],
      entriesByFamily: { ORC: [entry('IRL1431')] },
      now: NOW,
    };
    const removals = planOrcFleetRemovals({ ...input, competitorIdsWithResults: new Set(['c2']) });
    expect(removals).toHaveLength(1);
    expect(removals[0]).toMatchObject({ competitorId: 'c1', fleetId: 'f-orc', system: 'orc' });
  });
});

describe('orcPlanChecks', () => {
  it('counts expired certificates and collects distinct VPP years', () => {
    const rows: PreviewRow[] = [
      {
        competitorId: 'a', targetFleetId: 'f-orc', system: 'orc', currentTcf: null, newTcf: 1, status: 'change',
        orcCert: { record: {}, expiryDate: '2025-12-31T00:00:00.000Z', vppYear: 2025, importedAt: NOW },
      },
      {
        competitorId: 'b', targetFleetId: 'f-orc', system: 'orc', currentTcf: null, newTcf: 1, status: 'change',
        orcCert: { record: {}, expiryDate: '2026-12-31T00:00:00.000Z', vppYear: 2026, importedAt: NOW },
      },
    ];
    expect(orcPlanChecks(rows, NOW)).toEqual({ expiredCount: 1, vppYears: [2025, 2026] });
  });
});
