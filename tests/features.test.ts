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
      disabledFeatures: [],
    });
    expect(parseOrgMetadata('', 'u-abc')).toEqual({
      kind: 'personal',
      enabledFeatures: [],
      disabledFeatures: [],
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
      disabledFeatures: [],
    });
  });

  it('parses an explicit opt-out (disabledFeatures)', () => {
    const raw = JSON.stringify({
      kind: 'club',
      enabledFeatures: [],
      disabledFeatures: ['irc-rating'],
    });
    expect(parseOrgMetadata(raw).disabledFeatures).toEqual(['irc-rating']);
  });

  it('drops unknown / retired feature keys rather than throwing', () => {
    const raw = JSON.stringify({
      kind: 'club',
      enabledFeatures: ['echo', 'retired-feature', 42],
      disabledFeatures: ['irc-rating', 'irish-sailing-ratings'],
    });
    expect(parseOrgMetadata(raw).enabledFeatures).toEqual(['echo']);
    // 'irish-sailing-ratings' was retired — dropped from the opt-out list too.
    expect(parseOrgMetadata(raw).disabledFeatures).toEqual(['irc-rating']);
  });

  it('survives malformed JSON', () => {
    expect(parseOrgMetadata('{not json', 'hyc')).toEqual({
      kind: 'club',
      enabledFeatures: [],
      disabledFeatures: [],
    });
  });

  it('dedupes', () => {
    const raw = JSON.stringify({ enabledFeatures: ['echo', 'echo'] });
    expect(parseOrgMetadata(raw, 'hyc').enabledFeatures).toEqual(['echo']);
  });
});

describe('serializeOrgMetadata round-trips', () => {
  it('preserves kind, enabled, and disabled features', () => {
    const meta = {
      kind: 'club' as const,
      enabledFeatures: ['echo' as const],
      disabledFeatures: ['irc-rating' as const],
    };
    expect(parseOrgMetadata(serializeOrgMetadata(meta))).toEqual(meta);
  });
});

describe('computeEffectiveFeatures (Model B)', () => {
  const club = (
    slug: string,
    features: string[],
    disabled: string[] = [],
  ): FeatureMembership => ({
    slug,
    metadata: JSON.stringify({
      kind: 'club',
      enabledFeatures: features,
      disabledFeatures: disabled,
    }),
  });
  const personal = (
    slug: string,
    features: string[] = [],
    disabled: string[] = [],
  ): FeatureMembership => ({
    slug,
    metadata: JSON.stringify({
      kind: 'personal',
      enabledFeatures: features,
      disabledFeatures: disabled,
    }),
  });

  it('a club workspace sees its own features plus the default-on ones', () => {
    const memberships = [
      club('hyc', ['echo', 'ftp-upload']),
      personal('u-alice'),
    ];
    expect(computeEffectiveFeatures('hyc', memberships).sort()).toEqual([
      'echo',
      'ftp-upload',
      'irc-rating',
      'logo-library',
      'rya-py',
    ]);
  });

  it('a personal workspace inherits the union of its clubs (plus default-on)', () => {
    const memberships = [
      club('hyc', ['echo']),
      club('rstgyc', ['ftp-upload', 'sailwave-import']),
      personal('u-alice'),
    ];
    expect(computeEffectiveFeatures('u-alice', memberships).sort()).toEqual([
      'echo',
      'ftp-upload',
      'irc-rating',
      'logo-library',
      'rya-py',
      'sailwave-import',
    ]);
  });

  it("a club workspace does NOT leak another club's opt-in features", () => {
    // Alice is in HYC (sailwave-import) and RSTGYC (ftp-upload). In RSTGYC's
    // workspace she must not see sailwave-import — but echo and irc-rating are
    // on everywhere by default.
    const memberships = [
      club('hyc', ['sailwave-import']),
      club('rstgyc', ['ftp-upload']),
    ];
    expect(computeEffectiveFeatures('rstgyc', memberships).sort()).toEqual([
      'echo',
      'ftp-upload',
      'irc-rating',
      'logo-library',
      'rya-py',
    ]);
  });

  it('a personal workspace can carry its own features too', () => {
    // The e2e seeding path grants features directly to the personal
    // workspace; Model B reads the active workspace's own features regardless
    // of kind, so this works without a club membership.
    const memberships = [personal('u-alice', ['nhc-parameters'])];
    expect(computeEffectiveFeatures('u-alice', memberships).sort()).toEqual([
      'echo',
      'irc-rating',
      'logo-library',
      'nhc-parameters',
      'rya-py',
    ]);
  });

  it('default-on features are present with no enabled features anywhere', () => {
    expect(
      computeEffectiveFeatures('u-alice', [personal('u-alice')]).sort(),
    ).toEqual(['echo', 'irc-rating', 'logo-library', 'rya-py']);
  });

  it('an explicit opt-out switches a default-on feature off', () => {
    // Opt out irc-rating; the other default-on features stay on.
    const memberships = [personal('u-alice', [], ['irc-rating'])];
    expect(computeEffectiveFeatures('u-alice', memberships).sort()).toEqual([
      'echo',
      'logo-library',
      'rya-py',
    ]);
  });

  it('the active workspace opt-out wins over a club-inherited feature', () => {
    // HYC enables echo; Alice opts out of echo in her own workspace. Her
    // active personal workspace must not see it, even though the club has it.
    const memberships = [
      club('hyc', ['echo']),
      personal('u-alice', [], ['echo']),
    ];
    expect(computeEffectiveFeatures('u-alice', memberships).sort()).toEqual([
      'irc-rating',
      'logo-library',
      'rya-py',
    ]);
  });

  it('a club can opt out of a default-on feature for its workspace', () => {
    // Opt out irc-rating; the other default-on features stay on.
    const memberships = [club('hyc', [], ['irc-rating']), personal('u-alice')];
    expect(computeEffectiveFeatures('hyc', memberships).sort()).toEqual([
      'echo',
      'logo-library',
      'rya-py',
    ]);
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
