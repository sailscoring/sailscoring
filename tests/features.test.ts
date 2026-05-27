import { describe, expect, it } from 'vitest';

import {
  ALL_FEATURE_KEYS,
  computeEffectiveFeatures,
  isFeatureKey,
  isPersonalWorkspaceSlug,
  parseOrgMetadata,
  serializeOrgMetadata,
  type FeatureMembership,
} from '@/lib/features';

describe('isFeatureKey', () => {
  it('accepts registered keys', () => {
    expect(isFeatureKey('echo')).toBe(true);
    expect(isFeatureKey('ftp-upload')).toBe(true);
  });
  it('rejects unknown / retired keys', () => {
    expect(isFeatureKey('teleport')).toBe(false);
    expect(isFeatureKey('')).toBe(false);
  });
});

describe('isPersonalWorkspaceSlug', () => {
  it('treats the u- prefix as personal', () => {
    expect(isPersonalWorkspaceSlug('u-abc123')).toBe(true);
    expect(isPersonalWorkspaceSlug('hyc')).toBe(false);
    expect(isPersonalWorkspaceSlug('e2e-org')).toBe(false);
  });
});

describe('parseOrgMetadata', () => {
  it('returns empty features for null/blank', () => {
    expect(parseOrgMetadata(null, 'hyc')).toEqual({
      kind: 'club',
      enabledFeatures: [],
    });
    expect(parseOrgMetadata('', 'u-abc')).toEqual({
      kind: 'personal',
      enabledFeatures: [],
    });
  });

  it('defaults kind from the slug when absent', () => {
    expect(parseOrgMetadata('{}', 'u-abc').kind).toBe('personal');
    expect(parseOrgMetadata('{}', 'hyc').kind).toBe('club');
  });

  it('parses kind and known features', () => {
    const raw = JSON.stringify({
      kind: 'club',
      enabledFeatures: ['echo', 'ftp-upload'],
    });
    expect(parseOrgMetadata(raw)).toEqual({
      kind: 'club',
      enabledFeatures: ['echo', 'ftp-upload'],
    });
  });

  it('drops unknown / retired feature keys rather than throwing', () => {
    const raw = JSON.stringify({
      kind: 'club',
      enabledFeatures: ['echo', 'retired-feature', 42],
    });
    expect(parseOrgMetadata(raw).enabledFeatures).toEqual(['echo']);
  });

  it('survives malformed JSON', () => {
    expect(parseOrgMetadata('{not json', 'hyc')).toEqual({
      kind: 'club',
      enabledFeatures: [],
    });
  });

  it('dedupes', () => {
    const raw = JSON.stringify({ enabledFeatures: ['echo', 'echo'] });
    expect(parseOrgMetadata(raw, 'hyc').enabledFeatures).toEqual(['echo']);
  });
});

describe('serializeOrgMetadata round-trips', () => {
  it('preserves kind and features', () => {
    const meta = { kind: 'club' as const, enabledFeatures: ['echo' as const] };
    expect(parseOrgMetadata(serializeOrgMetadata(meta))).toEqual(meta);
  });
});

describe('computeEffectiveFeatures (Model B)', () => {
  const club = (slug: string, features: string[]): FeatureMembership => ({
    slug,
    metadata: JSON.stringify({ kind: 'club', enabledFeatures: features }),
  });
  const personal = (slug: string, features: string[] = []): FeatureMembership => ({
    slug,
    metadata: JSON.stringify({ kind: 'personal', enabledFeatures: features }),
  });

  it('a club workspace sees only its own features', () => {
    const memberships = [
      club('hyc', ['echo', 'ftp-upload']),
      personal('u-alice'),
    ];
    expect(computeEffectiveFeatures('hyc', memberships).sort()).toEqual([
      'echo',
      'ftp-upload',
    ]);
  });

  it('a personal workspace inherits the union of its clubs', () => {
    const memberships = [
      club('hyc', ['echo']),
      club('rstgyc', ['ftp-upload', 'sailwave-import']),
      personal('u-alice'),
    ];
    expect(computeEffectiveFeatures('u-alice', memberships).sort()).toEqual([
      'echo',
      'ftp-upload',
      'sailwave-import',
    ]);
  });

  it("a club workspace does NOT leak another club's features", () => {
    // Alice is in HYC (echo) and RSTGYC (ftp-upload). In RSTGYC's workspace
    // she must not see echo.
    const memberships = [club('hyc', ['echo']), club('rstgyc', ['ftp-upload'])];
    expect(computeEffectiveFeatures('rstgyc', memberships)).toEqual([
      'ftp-upload',
    ]);
  });

  it('a personal workspace can carry its own features too', () => {
    // The e2e seeding path grants features directly to the personal
    // workspace; Model B reads the active workspace's own features regardless
    // of kind, so this works without a club membership.
    const memberships = [personal('u-alice', ['nhc-parameters'])];
    expect(computeEffectiveFeatures('u-alice', memberships)).toEqual([
      'nhc-parameters',
    ]);
  });

  it('returns empty when the user has no enabled features anywhere', () => {
    expect(
      computeEffectiveFeatures('u-alice', [personal('u-alice')]),
    ).toEqual([]);
  });
});

describe('registry invariants', () => {
  it('every key is kebab-case-ish and unique', () => {
    expect(new Set(ALL_FEATURE_KEYS).size).toBe(ALL_FEATURE_KEYS.length);
    for (const k of ALL_FEATURE_KEYS) {
      expect(isFeatureKey(k)).toBe(true);
    }
  });
});
