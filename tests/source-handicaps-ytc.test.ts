import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { planYtcUpdates, type PreviewRow } from '@/lib/source-handicaps';
import type { Competitor, Fleet } from '@/lib/types';
import { parseYtcListing } from '@/lib/ytc-rating';

/**
 * The YTC source, against the listing fixture: Mayo Sailing Club's boats as
 * the RORC publishes them, entered the way Mayo enters them on HalSail — bare
 * sail numbers, matched on an Irish instance.
 */
const records = parseYtcListing(readFileSync(join(__dirname, 'fixtures', 'ytc-listing.csv'), 'utf8'));

function comp(id: string, sailNumber: string, extras: Partial<Competitor> = {}): Competitor {
  return {
    id, seriesId: 's', fleetIds: ['f-ytc'], sailNumber, names: [id],
    clubs: [], gender: '', age: null, createdAt: 0, ...extras,
  };
}

const fleets: Fleet[] = [
  { id: 'f-ytc', seriesId: 's', name: 'Cruisers YTC', displayOrder: 0, scoringSystem: 'ytc' },
  { id: 'f-py', seriesId: 's', name: 'PY', displayOrder: 1, scoringSystem: 'py' },
];

function plan(competitors: Competitor[], extras: Partial<Parameters<typeof planYtcUpdates>[0]> = {}): Map<string, PreviewRow> {
  const rows = planYtcUpdates({
    targetCompetitors: competitors,
    targetFleets: fleets,
    records,
    defaultCountry: 'IRL',
    ...extras,
  });
  return new Map(rows.map((r) => [r.competitorId, r]));
}

describe('planYtcUpdates', () => {
  it('seeds each Mayo boat with the spinnaker number on its certificate', () => {
    const rows = plan([
      comp('crozz', '3062', { ytcNumber: 920 }),
      comp('movita', '1552'),
      comp('fusion', '2552', { ytcNumber: 943 }),
    ]);
    expect(rows.get('crozz')).toMatchObject({ system: 'ytc', currentTcf: 920, newTcf: 941, status: 'change', ircVariant: 'spin' });
    expect(rows.get('movita')).toMatchObject({ newTcf: 919, status: 'change' });
    expect(rows.get('fusion')).toMatchObject({ newTcf: 943, status: 'unchanged' });
  });

  it('says what the listing says of the certificate, for the scorer to check', () => {
    expect(plan([comp('crozz', 'IRL3062')]).get('crozz')?.ytcCertificate).toEqual({
      boatType: 'ELAN 31 1.85',
      provisional: false,
      issueDate: '2026-08-13',
    });
    expect(plan([comp('quick', 'GBR8812')]).get('quick')?.ytcCertificate?.provisional).toBe(true);
  });

  it('uses the white-sail number for a fleet set to it', () => {
    const rows = plan([comp('crozz', '3062')], { ircVariantByFleet: { 'f-ytc': 'non-spin' } });
    expect(rows.get('crozz')).toMatchObject({ newTcf: 965, ircVariant: 'non-spin' });
  });

  it('flags a match made without the country code', () => {
    // Listed as IRL3062, entered as a bare 3062: the default country joins them.
    expect(plan([comp('crozz', '3062')]).get('crozz')?.match).toMatchObject({ method: 'sail-no-country', sail: 'IRL3062' });
    expect(plan([comp('movita', '1552')]).get('movita')?.match).toBeUndefined();
  });

  it('treats two listed boats sharing a sail number as ambiguous, not as one boat\'s two certificates', () => {
    const boat = comp('first', '127', { boatName: 'First of Two' });
    expect(plan([boat]).get('first')).toMatchObject({ status: 'not-found', notFoundReason: 'ambiguous-match' });
    // The boat name settles it once the scorer allows name matching.
    expect(plan([boat], { matchByName: true }).get('first')).toMatchObject({
      newTcf: 1040,
      match: { method: 'sail-and-name', sail: '127', name: 'FIRST OF TWO' },
    });
  });

  it('matches a boat listed under a placeholder sail number by name only, and only when allowed', () => {
    const boat = comp('spray', 'GBR 1', { boatName: 'Sea Spray' });
    expect(plan([boat]).get('spray')).toMatchObject({ status: 'not-found', notFoundReason: 'no-source-competitor' });
    expect(plan([boat], { matchByName: true }).get('spray')).toMatchObject({ newTcf: 1001, match: { method: 'name' } });
  });

  it('proposes nothing for a boat in a fleet of another system', () => {
    expect(plan([comp('crozz', '3062', { fleetIds: ['f-py'] })]).size).toBe(0);
  });
});
