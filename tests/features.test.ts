import { describe, expect, it } from 'vitest';

import {
  ALL_FEATURE_KEYS,
  applyFeatureToggle,
  computeEffectiveFeatures,
  isFeatureKey,
  isPersonalWorkspaceSlug,
  isSelfServiceFeature,
  parseOrgMetadata,
  SELF_SERVICE_FEATURES,
  serializeOrgMetadata,
  type FeatureMembership,
  type OrgMetadata,
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
      seededFeatureSamples: [],
    });
    expect(parseOrgMetadata('', 'u-abc')).toEqual({
      kind: 'personal',
      enabledFeatures: [],
      disabledFeatures: [],
      seededFeatureSamples: [],
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
      seededFeatureSamples: [],
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
      seededFeatureSamples: [],
    });
  });

  it('dedupes', () => {
    const raw = JSON.stringify({ enabledFeatures: ['echo', 'echo'] });
    expect(parseOrgMetadata(raw, 'hyc').enabledFeatures).toEqual(['echo']);
  });
});

describe('serializeOrgMetadata round-trips', () => {
  it('preserves kind, enabled, disabled, and seeded-sample features', () => {
    const meta = {
      kind: 'club' as const,
      enabledFeatures: ['echo' as const],
      disabledFeatures: ['irc-rating' as const],
      seededFeatureSamples: ['sub-series' as const],
    };
    expect(parseOrgMetadata(serializeOrgMetadata(meta))).toEqual(meta);
  });

  it('defaults seededFeatureSamples to empty when the key is absent', () => {
    const raw = JSON.stringify({ kind: 'club', enabledFeatures: ['echo'] });
    expect(parseOrgMetadata(raw).seededFeatureSamples).toEqual([]);
  });

  it('applyFeatureToggle carries the seeded-sample marker through', () => {
    const base = parseOrgMetadata(
      JSON.stringify({ kind: 'club', seededFeatureSamples: ['sub-series'] }),
    );
    const next = applyFeatureToggle(base, 'prizes', true);
    expect(next.seededFeatureSamples).toEqual(['sub-series']);
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

describe('self-service classification', () => {
  it('operator-managed keys are excluded from the self-service set', () => {
    // The deliberately small operator-only set (issue #278): identity adoption
    // stays centrally managed, and ftp-upload is on its way out with scupper.
    for (const k of [
      'ftp-upload',
      'competitor-identity',
      'competitor-reconcile',
    ] as const) {
      expect(isSelfServiceFeature(k)).toBe(false);
      expect(SELF_SERVICE_FEATURES).not.toContain(k);
    }
  });

  it('every other key is self-service by default', () => {
    for (const k of ALL_FEATURE_KEYS) {
      const operatorOnly = !isSelfServiceFeature(k);
      expect(SELF_SERVICE_FEATURES.includes(k)).toBe(!operatorOnly);
    }
    // e.g. vprs is opt-in but still self-service.
    expect(isSelfServiceFeature('vprs')).toBe(true);
    expect(isSelfServiceFeature('prizes')).toBe(true);
  });
});

describe('applyFeatureToggle', () => {
  const base = (
    enabledFeatures: string[] = [],
    disabledFeatures: string[] = [],
    kind: 'personal' | 'club' = 'club',
  ): OrgMetadata =>
    parseOrgMetadata(
      JSON.stringify({ kind, enabledFeatures, disabledFeatures }),
    );

  it('enable adds to enabledFeatures and clears any opt-out', () => {
    const next = applyFeatureToggle(base([], ['prizes']), 'prizes', true);
    expect(next.enabledFeatures).toContain('prizes');
    expect(next.disabledFeatures).not.toContain('prizes');
  });

  it('disable drops the enable and records the opt-out', () => {
    const next = applyFeatureToggle(base(['prizes']), 'prizes', false);
    expect(next.enabledFeatures).not.toContain('prizes');
    expect(next.disabledFeatures).toContain('prizes');
  });

  it('disabling a default-on feature records an opt-out that wins in resolution', () => {
    const next = applyFeatureToggle(base(), 'echo', false);
    expect(next.disabledFeatures).toContain('echo');
    expect(
      computeEffectiveFeatures('hyc', [
        { slug: 'hyc', metadata: serializeOrgMetadata(next) },
      ]),
    ).not.toContain('echo');
  });

  it('a personal-workspace opt-out overrides a club-inherited feature', () => {
    // Personal workspace inherits sailwave-import from a club it belongs to;
    // toggling it off must record an opt-out (there is nothing in its own
    // enabledFeatures to remove).
    const personal = applyFeatureToggle(
      base([], [], 'personal'),
      'sailwave-import',
      false,
    );
    expect(personal.disabledFeatures).toContain('sailwave-import');
    const memberships = [
      { slug: 'hyc', metadata: serializeOrgMetadata(base(['sailwave-import'])) },
      { slug: 'u-alice', metadata: serializeOrgMetadata(personal) },
    ];
    expect(computeEffectiveFeatures('u-alice', memberships)).not.toContain(
      'sailwave-import',
    );
  });

  it('is idempotent in both directions', () => {
    const on1 = applyFeatureToggle(base(), 'prizes', true);
    const on2 = applyFeatureToggle(on1, 'prizes', true);
    expect(on2.enabledFeatures.filter((k) => k === 'prizes')).toHaveLength(1);
    const off1 = applyFeatureToggle(on2, 'prizes', false);
    const off2 = applyFeatureToggle(off1, 'prizes', false);
    expect(off2.disabledFeatures.filter((k) => k === 'prizes')).toHaveLength(1);
    expect(off2.enabledFeatures).not.toContain('prizes');
  });

  it('preserves kind', () => {
    expect(applyFeatureToggle(base([], [], 'personal'), 'prizes', true).kind).toBe(
      'personal',
    );
  });
});
