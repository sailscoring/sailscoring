import { describe, expect, it } from 'vitest';

import {
  identityIdForSlug,
  MANIFEST_VERSION,
  parseManifest,
  planManifestApply,
  type Manifest,
} from '@/lib/competitor-identity-manifest';

const NATIONALS = '0c111111-1111-4111-8111-111111111111';
const LEINSTERS = '7a222222-2222-4222-8222-222222222222';

function manifestJson(overrides: Partial<Manifest> = {}): string {
  const base: Manifest = {
    version: MANIFEST_VERSION,
    series: {
      'iodai-nationals-2019': NATIONALS,
      'iodai-leinsters-2020': LEINSTERS,
    },
    identities: [
      {
        slug: 'charlie-keating-x78q',
        name: 'Charlie Keating',
        club: 'HYC',
        nationality: 'IRL',
        members: [
          ['iodai-nationals-2019', '1423'],
          ['iodai-leinsters-2020', '1599'],
        ],
        note: 'changed boat 2020',
      },
    ],
  };
  return JSON.stringify({ ...base, ...overrides });
}

/** A lookup backed by a plain `seriesId|sail` → competitorId map (one each). */
function lookupFrom(index: Record<string, string>) {
  return (seriesId: string, sail: string) => {
    const id = index[`${seriesId}|${sail}`];
    return id ? [{ competitorId: id, name: '' }] : undefined;
  };
}

/** A lookup where a `seriesId|sail` key can carry several named candidates. */
function lookupCandidates(index: Record<string, Array<{ competitorId: string; name: string }>>) {
  return (seriesId: string, sail: string) => index[`${seriesId}|${sail}`];
}

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = parseManifest(manifestJson());
    expect(m.identities).toHaveLength(1);
    expect(m.identities[0].members[0]).toEqual(['iodai-nationals-2019', '1423']);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseManifest('{ not json')).toThrow(/not valid JSON/);
  });

  it('rejects an unknown version', () => {
    expect(() => parseManifest(manifestJson({ version: 99 as 1 }))).toThrow(/validation/);
  });

  it('rejects a non-UUID series id', () => {
    const bad = JSON.stringify({
      version: MANIFEST_VERSION,
      series: { 'iodai-nationals-2019': 'not-a-uuid' },
      identities: [],
    });
    expect(() => parseManifest(bad)).toThrow(/validation/);
  });

  it('rejects an upper-case slug', () => {
    expect(() =>
      parseManifest(
        manifestJson({
          identities: [
            { slug: 'Charlie-Keating', name: 'Charlie Keating', members: [['iodai-nationals-2019', '1423']] },
          ],
        }),
      ),
    ).toThrow(/slug must be lowercase/);
  });
});

describe('identityIdForSlug', () => {
  it('is deterministic and a valid v5 uuid', () => {
    const a = identityIdForSlug('ws1', 'charlie-keating-x78q');
    const b = identityIdForSlug('ws1', 'charlie-keating-x78q');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is workspace-scoped — same slug, different workspace → different id', () => {
    expect(identityIdForSlug('ws1', 'charlie-keating-x78q')).not.toBe(
      identityIdForSlug('ws2', 'charlie-keating-x78q'),
    );
  });
});

describe('planManifestApply', () => {
  it('resolves members to competitor ids and picks the last sail as representative', () => {
    const m = parseManifest(manifestJson());
    const plan = planManifestApply(
      m,
      'ws1',
      lookupFrom({ [`${NATIONALS}|1423`]: 'comp-a', [`${LEINSTERS}|1599`]: 'comp-b' }),
    );
    expect(plan.assignments).toHaveLength(1);
    const a = plan.assignments[0];
    expect(a.competitorIds).toEqual(['comp-a', 'comp-b']);
    expect(a.identityId).toBe(identityIdForSlug('ws1', 'charlie-keating-x78q'));
    expect(a.label).toBe('Charlie Keating');
    expect(a.sailNumber).toBe('1599');
    expect(a.club).toBe('HYC');
    expect(plan.unresolvedMembers).toEqual([]);
  });

  it('a member listed twice claims both same-sail rows (published duplicates)', () => {
    // The 2022 Ulsters coached page lists the same child twice on one sail
    // ("Addison" + the "Adeson" typo row): duplicating the member row makes
    // the second pass prefer the still-unclaimed candidate.
    const m = parseManifest(
      manifestJson({
        identities: [
          {
            slug: 'addison-carmody-7qry',
            name: 'Addison Carmody',
            members: [
              ['iodai-nationals-2019', '1087'],
              ['iodai-nationals-2019', '1087'],
            ],
          },
        ],
      }),
    );
    const plan = planManifestApply(
      m,
      'ws1',
      lookupCandidates({
        [`${NATIONALS}|1087`]: [
          { competitorId: 'comp-addison', name: 'Addison Carmody' },
          { competitorId: 'comp-adeson', name: 'Adeson Carmody' },
        ],
      }),
    );
    expect(plan.assignments[0].competitorIds).toEqual([
      'comp-addison',
      'comp-adeson',
    ]);
    expect(plan.unresolvedMembers).toEqual([]);
  });

  it('reports an unknown series-slug without dropping the rest', () => {
    const m = parseManifest(
      manifestJson({
        identities: [
          {
            slug: 'charlie-keating-x78q',
            name: 'Charlie Keating',
            members: [
              ['iodai-nationals-2019', '1423'],
              ['iodai-phantom-2099', '1'],
            ],
          },
        ],
      }),
    );
    const plan = planManifestApply(m, 'ws1', lookupFrom({ [`${NATIONALS}|1423`]: 'comp-a' }));
    expect(plan.assignments[0].competitorIds).toEqual(['comp-a']);
    expect(plan.unresolvedMembers).toEqual([
      { slug: 'charlie-keating-x78q', seriesSlug: 'iodai-phantom-2099', sailNumber: '1', reason: 'unknown-series' },
    ]);
  });

  it('reports a member with no matching competitor', () => {
    const m = parseManifest(manifestJson());
    const plan = planManifestApply(m, 'ws1', lookupFrom({ [`${NATIONALS}|1423`]: 'comp-a' }));
    expect(plan.assignments[0].competitorIds).toEqual(['comp-a']);
    expect(plan.unresolvedMembers).toEqual([
      { slug: 'charlie-keating-x78q', seriesSlug: 'iodai-leinsters-2020', sailNumber: '1599', reason: 'no-competitor' },
    ]);
  });

  it('refuses to let two identities claim the same competitor row', () => {
    const m = parseManifest(
      manifestJson({
        identities: [
          { slug: 'a-one', name: 'A One', members: [['iodai-nationals-2019', '1423']] },
          { slug: 'b-two', name: 'B Two', members: [['iodai-nationals-2019', '1423']] },
        ],
      }),
    );
    const plan = planManifestApply(m, 'ws1', lookupFrom({ [`${NATIONALS}|1423`]: 'comp-a' }));
    expect(plan.assignments[0].competitorIds).toEqual(['comp-a']);
    expect(plan.assignments[1].competitorIds).toEqual([]);
    expect(plan.unresolvedMembers).toEqual([
      { slug: 'b-two', seriesSlug: 'iodai-nationals-2019', sailNumber: '1423', reason: 'already-claimed' },
    ]);
  });

  it('disambiguates a shared sail by name so each sailor gets their own row', () => {
    // Two siblings carry the same sail in one series (a shared hull / placeholder).
    const m = parseManifest(
      manifestJson({
        identities: [
          { slug: 'jess-tottenham-x', name: 'Jess Tottenham', members: [['iodai-nationals-2019', '1682']] },
          { slug: 'ellie-tottenham-y', name: 'Ellie Tottenham', members: [['iodai-nationals-2019', '1682']] },
        ],
      }),
    );
    const plan = planManifestApply(
      m,
      'ws1',
      lookupCandidates({
        [`${NATIONALS}|1682`]: [
          { competitorId: 'comp-jess', name: 'Jess Tottenham' },
          { competitorId: 'comp-ellie', name: 'Ellie Tottenham' },
        ],
      }),
    );
    expect(plan.assignments[0].competitorIds).toEqual(['comp-jess']);
    expect(plan.assignments[1].competitorIds).toEqual(['comp-ellie']);
    expect(plan.unresolvedMembers).toEqual([]);
  });

  it('matches across a name variant (mojibake / casing) via token overlap', () => {
    const m = parseManifest(
      manifestJson({
        identities: [
          { slug: 'skye-x', name: "Skye O'Callaghan", members: [['iodai-nationals-2019', '1464']] },
          { slug: 'jacob-y', name: 'Jacob Browne', members: [['iodai-nationals-2019', '1464']] },
        ],
      }),
    );
    const plan = planManifestApply(
      m,
      'ws1',
      lookupCandidates({
        [`${NATIONALS}|1464`]: [
          { competitorId: 'comp-skye', name: 'Skye Oâ€™Callaghan' }, // mojibake in the DB
          { competitorId: 'comp-jacob', name: 'Jacob Browne' },
        ],
      }),
    );
    expect(plan.assignments[0].competitorIds).toEqual(['comp-skye']);
    expect(plan.assignments[1].competitorIds).toEqual(['comp-jacob']);
  });

  it('flags a member whose name matches none of the candidates as ambiguous', () => {
    const m = parseManifest(
      manifestJson({
        identities: [
          { slug: 'stranger-z', name: 'Total Stranger', members: [['iodai-nationals-2019', '0']] },
        ],
      }),
    );
    const plan = planManifestApply(
      m,
      'ws1',
      lookupCandidates({
        [`${NATIONALS}|0`]: [
          { competitorId: 'comp-a', name: 'Alice Adams' },
          { competitorId: 'comp-b', name: 'Bob Burns' },
        ],
      }),
    );
    expect(plan.assignments[0].competitorIds).toEqual([]);
    expect(plan.unresolvedMembers).toEqual([
      { slug: 'stranger-z', seriesSlug: 'iodai-nationals-2019', sailNumber: '0', reason: 'ambiguous' },
    ]);
  });

  it('flags a slug used by more than one entry', () => {
    const m = parseManifest(
      manifestJson({
        identities: [
          { slug: 'dup-one', name: 'First', members: [['iodai-nationals-2019', '1423']] },
          { slug: 'dup-one', name: 'Second', members: [['iodai-leinsters-2020', '1599']] },
        ],
      }),
    );
    const plan = planManifestApply(
      m,
      'ws1',
      lookupFrom({ [`${NATIONALS}|1423`]: 'comp-a', [`${LEINSTERS}|1599`]: 'comp-b' }),
    );
    expect(plan.duplicateSlugs).toEqual(['dup-one']);
  });
});
