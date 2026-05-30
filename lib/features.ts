/**
 * Experimental-feature gating (#155).
 *
 * These are features we deliberately keep behind a gate because we might
 * *delete* them later. Gating keeps the audience small and enumerable, so
 * when a feature is retired there is a known, scoped group to explain it to.
 * See `docs/...` / issue #155 for the "containment, not ramp-up" framing.
 *
 * This module is pure — no `server-only`, no DB imports — so it can be unit
 * tested and imported from both the server (`require-workspace`) and client
 * (`useFeatures`). The registry is the single source of truth for which keys
 * exist; everything else (CLI validation, help-doc gating, metadata parsing)
 * defers to it.
 */

export interface FeatureDef {
  /** Human label — used by the CLI `list-feature` audience report and any
   *  future admin UI. */
  label: string;
  /** Help-page anchor ids whose table-of-contents entries (and whole
   *  sections, where the feature owns one outright) should be hidden when
   *  the feature is off. Sub-block-only features list nothing here and are
   *  gated inline in `app/help/page.tsx`. */
  helpSectionIds: string[];
}

/**
 * The gated feature registry. Keys are kebab-case because they appear in
 * `organization.metadata` JSON and as CLI arguments. To retire a feature,
 * delete its entry here and follow the references — the registry is what the
 * rest of the system enumerates.
 */
export const FEATURES = {
  'sailwave-import': {
    label: 'Sailwave import',
    helpSectionIds: [],
  },
  'csv-finish-import': {
    label: 'CSV finish-sheet import',
    helpSectionIds: ['importing-finish-sheet'],
  },
  'ftp-upload': {
    label: 'FTP upload',
    helpSectionIds: [],
  },
  'nhc-parameters': {
    label: 'Custom NHC parameters',
    helpSectionIds: [],
  },
  echo: {
    label: 'ECHO scoring',
    helpSectionIds: [],
  },
  'irish-sailing-ratings': {
    label: 'Irish Sailing ECHO import',
    helpSectionIds: ['update-handicaps-irish-sailing'],
  },
  'irc-rating': {
    label: 'IRC TCC import (international)',
    helpSectionIds: ['update-handicaps-irc-rating'],
  },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;

export const ALL_FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export function isFeatureKey(s: string): s is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, s);
}

export type WorkspaceKind = 'personal' | 'club';

export interface OrgMetadata {
  kind: WorkspaceKind;
  enabledFeatures: FeatureKey[];
}

/**
 * Personal workspaces use the slug convention `u-${userId.slice(0,16)}`
 * (see `personalWorkspaceSlug` in `lib/auth/require-workspace.ts`). We
 * re-derive the test here rather than importing that `server-only` helper so
 * this module stays pure.
 */
export function isPersonalWorkspaceSlug(slug: string): boolean {
  return slug.startsWith('u-');
}

/**
 * Parse the `organization.metadata` column. Unknown / future feature keys are
 * dropped rather than throwing — stale keys left behind by a retired feature
 * must not break resolution. `kind` defaults from the slug when absent.
 */
export function parseOrgMetadata(
  raw: string | null | undefined,
  slug?: string,
): OrgMetadata {
  const fallbackKind: WorkspaceKind =
    slug !== undefined && isPersonalWorkspaceSlug(slug) ? 'personal' : 'club';
  if (!raw) return { kind: fallbackKind, enabledFeatures: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: fallbackKind, enabledFeatures: [] };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: fallbackKind, enabledFeatures: [] };
  }
  const obj = parsed as Record<string, unknown>;
  const kind: WorkspaceKind =
    obj.kind === 'personal' || obj.kind === 'club' ? obj.kind : fallbackKind;
  const enabledFeatures = Array.isArray(obj.enabledFeatures)
    ? (obj.enabledFeatures.filter(
        (k): k is FeatureKey => typeof k === 'string' && isFeatureKey(k),
      ) as FeatureKey[])
    : [];
  return { kind, enabledFeatures: dedupe(enabledFeatures) };
}

export function serializeOrgMetadata(meta: OrgMetadata): string {
  return JSON.stringify({
    kind: meta.kind,
    enabledFeatures: dedupe(meta.enabledFeatures),
  });
}

export interface FeatureMembership {
  slug: string;
  metadata: string | null;
}

/**
 * Compute the effective feature set for a request (Model B, #155):
 *
 *   - club workspace    → that workspace's own enabled features.
 *   - personal workspace → its own features ∪ the features of every club the
 *                          user belongs to.
 *
 * The personal-workspace union is what lets a trusted individual experiment
 * in their own sandbox with a feature their club has, without leaking it into
 * an unrelated club's workspace they also belong to.
 *
 * `memberships` is every org the user is a member of (already loaded by
 * `resolveWorkspace`), each carrying its raw `metadata`. `activeSlug`
 * identifies which of them is the active workspace.
 */
export function computeEffectiveFeatures(
  activeSlug: string,
  memberships: FeatureMembership[],
): FeatureKey[] {
  const active = memberships.find((m) => m.slug === activeSlug);
  const own = active
    ? parseOrgMetadata(active.metadata, active.slug).enabledFeatures
    : [];
  if (!isPersonalWorkspaceSlug(activeSlug)) {
    return dedupe(own);
  }
  const inherited = memberships
    .filter((m) => !isPersonalWorkspaceSlug(m.slug))
    .flatMap((m) => parseOrgMetadata(m.metadata, m.slug).enabledFeatures);
  return dedupe([...own, ...inherited]);
}

function dedupe(keys: FeatureKey[]): FeatureKey[] {
  return [...new Set(keys)];
}
