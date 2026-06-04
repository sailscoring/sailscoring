import { describe, expect, it } from 'vitest';

import {
  planVprsUpdates,
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

function rec(sailNumber: string, extras: Partial<RatingRecord> = {}): RatingRecord {
  return { sailNumber, ...extras };
}

function byKey(rows: PreviewRow[]) {
  return new Map(rows.map((r) => [`${r.competitorId}::${r.system}`, r]));
}

const fleets = [fleet('f-vprs', 'vprs'), fleet('f-irc', 'irc'), fleet('f-echo', 'echo')];

describe('planVprsUpdates', () => {
  it('seeds the spin VPRS TCC by default', () => {
    const rows = planVprsUpdates({
      targetCompetitors: [comp('c1', 'IRL1367', ['f-vprs'])],
      targetFleets: fleets,
      records: [rec('IRL1367', { vprsTcc: 0.992, vprsNonSpinTcc: 0.945 })],
      ircVariantByFleet: { 'f-vprs': 'spin' },
    });
    expect(byKey(rows).get('c1::vprs')).toMatchObject({
      newTcf: 0.992,
      status: 'change',
      ircVariant: 'spin',
    });
  });

  it('uses the No-spin TCC when that variant is chosen', () => {
    const rows = planVprsUpdates({
      targetCompetitors: [comp('c1', 'IRL1367', ['f-vprs'])],
      targetFleets: fleets,
      records: [rec('IRL1367', { vprsTcc: 0.992, vprsNonSpinTcc: 0.945 })],
      ircVariantByFleet: { 'f-vprs': 'non-spin' },
    });
    expect(byKey(rows).get('c1::vprs')).toMatchObject({ newTcf: 0.945, ircVariant: 'non-spin' });
  });

  it('resolves spin and non-spin VPRS fleets independently in one pass', () => {
    const twoVprs = [fleet('f-spin', 'vprs'), fleet('f-nonspin', 'vprs')];
    const rows = planVprsUpdates({
      targetCompetitors: [comp('c1', 'IRL1367', ['f-spin', 'f-nonspin'])],
      targetFleets: twoVprs,
      records: [rec('IRL1367', { vprsTcc: 0.992, vprsNonSpinTcc: 0.945 })],
      ircVariantByFleet: { 'f-nonspin': 'non-spin' }, // f-spin omitted → defaults to spin
    });
    const byFleet = new Map(rows.map((r) => [r.targetFleetId, r]));
    expect(byFleet.get('f-spin')).toMatchObject({ newTcf: 0.992, ircVariant: 'spin' });
    expect(byFleet.get('f-nonspin')).toMatchObject({ newTcf: 0.945, ircVariant: 'non-spin' });
  });

  it('falls back to the No-spin TCC for a boat rated without a spinnaker', () => {
    // The boat has no spin TCC ("-" in the listing); the non-spin fleet still
    // seeds, while a spin fleet finds no value.
    const rows = planVprsUpdates({
      targetCompetitors: [comp('c1', 'IRL5643', ['f-vprs'])],
      targetFleets: fleets,
      records: [rec('IRL5643', { vprsNonSpinTcc: 0.873 })],
      ircVariantByFleet: { 'f-vprs': 'non-spin' },
    });
    expect(byKey(rows).get('c1::vprs')).toMatchObject({ newTcf: 0.873 });
  });

  it('reports no-source-value when the chosen variant has no TCC', () => {
    const rows = planVprsUpdates({
      targetCompetitors: [comp('c1', 'IRL5643', ['f-vprs'])],
      targetFleets: fleets,
      records: [rec('IRL5643', { vprsNonSpinTcc: 0.873 })], // no spin value
      ircVariantByFleet: { 'f-vprs': 'spin' },
    });
    expect(byKey(rows).get('c1::vprs')).toMatchObject({
      status: 'not-found',
      notFoundReason: 'no-source-value',
    });
  });

  it('marks unchanged when the current value already matches', () => {
    const rows = planVprsUpdates({
      targetCompetitors: [comp('c1', 'IRL1367', ['f-vprs'], { vprsTcc: 0.992 })],
      targetFleets: fleets,
      records: [rec('IRL1367', { vprsTcc: 0.992 })],
    });
    expect(byKey(rows).get('c1::vprs')!.status).toBe('unchanged');
  });

  it('emits VPRS rows only — IRC/ECHO fleets produce nothing', () => {
    const rows = planVprsUpdates({
      targetCompetitors: [comp('c1', 'IRL1367', ['f-vprs', 'f-irc', 'f-echo'])],
      targetFleets: fleets,
      records: [rec('IRL1367', { vprsTcc: 0.992, ircTcc: 0.93, echo: 1.0 })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].system).toBe('vprs');
  });
});
