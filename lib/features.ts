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
  /** When true the feature is on for *every* workspace unless that workspace
   *  records an explicit opt-out (`disabledFeatures`). Most features are
   *  opt-in (default off, "containment not ramp-up"); a default-on feature is
   *  one we're confident enough in to ship broadly while keeping the gate so
   *  a workspace can switch it back off. */
  defaultOn?: boolean;
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
  'sub-series': {
    // Named blocks of races inside one series, each scored independently
    // (own standings, discards, published pages) over a shared entry list,
    // with progressive handicaps chaining across block boundaries.
    label: 'Sub-series',
    helpSectionIds: ['sub-series'],
  },
  'logo-library': {
    // The flag locker — the per-workspace logo library plus the built-in
    // canonical tier and per-workspace logo. On by default: the picker draws on
    // the canonical set served from logos.sailscoring.ie, so it's useful to
    // every workspace out of the box. A workspace can still opt out.
    label: 'Logo library',
    helpSectionIds: ['logo-library'],
    defaultOn: true,
  },
  'nhc-parameters': {
    label: 'Custom NHC parameters',
    helpSectionIds: [],
  },
  echo: {
    // The single Irish/ECHO gate: the ECHO scoring system *and* the Irish
    // Sailing ECHO source in the Update-handicaps dialog. On by default — the
    // seeded club-racing sample series uses ECHO fleets, so every workspace
    // needs it functional; a workspace can still opt out.
    label: 'ECHO scoring',
    helpSectionIds: ['update-handicaps-irish-sailing'],
    defaultOn: true,
  },
  'irc-rating': {
    // Gates the IRC scoring system *and* the IRC TCC source in the
    // Update-handicaps dialog. On by default; a workspace can opt out.
    label: 'IRC TCC import (international)',
    helpSectionIds: ['update-handicaps-irc-rating'],
    defaultOn: true,
  },
  'rya-py': {
    // Gates the PY (Portsmouth Yardstick) scoring system *and* the RYA PY-list
    // source in the Update-handicaps dialog. On by default; a workspace can opt
    // out.
    label: 'RYA Portsmouth Yardstick',
    helpSectionIds: ['update-handicaps-rya-py'],
    defaultOn: true,
  },
  vprs: {
    // Gates the VPRS scoring system *and* the VPRS club rating source in the
    // Update-handicaps dialog (#175). Opt-in (default off): VPRS is new and not
    // yet reconciled against real published results, so we keep the audience
    // small and enumerable until it's proven, per the containment model. Also
    // gated inline in the help page's rating-systems list.
    label: 'VPRS scoring',
    helpSectionIds: ['update-handicaps-vprs'],
  },
  'follow-on-series': {
    // Gates the "Create follow-on series" action on the series list: roll a
    // finished series into the next one of the season, carrying competitors
    // and seeding progressive starting handicaps from the end-of-series TCFs.
    // Opt-in (default off) while the rollover semantics are proven against a
    // real season, per the containment model.
    label: 'Follow-on series',
    helpSectionIds: ['creating-a-follow-on-series'],
  },
  'fine-grained-roles': {
    // Gates offering the `scorer` role in the Members card's role selects.
    // Enforcement of role permissions is always on — this flag only controls
    // whether a workspace can hand the new role out while it bakes. Opt-in
    // (default off) per the containment model.
    label: 'Fine-grained roles (scorer)',
    helpSectionIds: ['collaboration'],
  },
  'competitor-identity': {
    // Gates the cross-series competitor-identity spine: the reconcile surface
    // that collapses a sailor's per-series competitor rows onto one recurring
    // identity, and the public career-arc page read off that link. Off by
    // default and introduced for IODAI first (a one-design junior class with a
    // deep historical corpus) — invisible and inert everywhere else, per the
    // containment model.
    label: 'Cross-series competitor identity',
    helpSectionIds: ['competitor-identity'],
  },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;

export const ALL_FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** Features that are on for every workspace unless explicitly opted out. */
export const DEFAULT_ON_FEATURES = ALL_FEATURE_KEYS.filter(
  (k) => (FEATURES[k] as FeatureDef).defaultOn,
);

export function isFeatureKey(s: string): s is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, s);
}

export type WorkspaceKind = 'personal' | 'club';

export interface OrgMetadata {
  kind: WorkspaceKind;
  /** Features explicitly switched on for this workspace (opt-in features). */
  enabledFeatures: FeatureKey[];
  /** Features explicitly switched off for this workspace — only meaningful
   *  for default-on features, where it records the opt-out. */
  disabledFeatures: FeatureKey[];
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
  const empty = (kind: WorkspaceKind): OrgMetadata => ({
    kind,
    enabledFeatures: [],
    disabledFeatures: [],
  });
  if (!raw) return empty(fallbackKind);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty(fallbackKind);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return empty(fallbackKind);
  }
  const obj = parsed as Record<string, unknown>;
  const kind: WorkspaceKind =
    obj.kind === 'personal' || obj.kind === 'club' ? obj.kind : fallbackKind;
  return {
    kind,
    enabledFeatures: dedupe(parseFeatureArray(obj.enabledFeatures)),
    disabledFeatures: dedupe(parseFeatureArray(obj.disabledFeatures)),
  };
}

/** Filter an arbitrary JSON value down to the known feature keys it contains.
 *  Unknown / future / non-string entries are dropped — stale keys from a
 *  retired feature must not break resolution. */
function parseFeatureArray(value: unknown): FeatureKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (k): k is FeatureKey => typeof k === 'string' && isFeatureKey(k),
  );
}

export function serializeOrgMetadata(meta: OrgMetadata): string {
  return JSON.stringify({
    kind: meta.kind,
    enabledFeatures: dedupe(meta.enabledFeatures),
    disabledFeatures: dedupe(meta.disabledFeatures),
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
 * On top of that union, `DEFAULT_ON_FEATURES` are added for every workspace,
 * and the **active workspace's** `disabledFeatures` are subtracted last —
 * so an explicit opt-out always wins, even over a default-on feature or one
 * inherited from a club.
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
  const activeMeta = active
    ? parseOrgMetadata(active.metadata, active.slug)
    : null;
  const own = activeMeta ? activeMeta.enabledFeatures : [];
  const inherited = isPersonalWorkspaceSlug(activeSlug)
    ? memberships
        .filter((m) => !isPersonalWorkspaceSlug(m.slug))
        .flatMap((m) => parseOrgMetadata(m.metadata, m.slug).enabledFeatures)
    : [];
  const enabled = new Set<FeatureKey>([
    ...DEFAULT_ON_FEATURES,
    ...own,
    ...inherited,
  ]);
  for (const key of activeMeta?.disabledFeatures ?? []) {
    enabled.delete(key);
  }
  return [...enabled];
}

function dedupe(keys: FeatureKey[]): FeatureKey[] {
  return [...new Set(keys)];
}
