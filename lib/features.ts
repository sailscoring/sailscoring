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
  /** When false, the feature is operator-managed: it never appears in the
   *  self-service Workspace-settings features card, and can only be toggled
   *  through the `provision-org` CLI. Defaults to true — owners/admins turn it
   *  on and off themselves. Kept deliberately small: reserved for features
   *  whose audience we manage centrally (cross-series competitor identity) or
   *  that are slated for removal (FTP upload). Orthogonal to `defaultOn` and to
   *  resolution — `computeEffectiveFeatures` honours the metadata regardless;
   *  this only governs the settings UI and its API guard. */
  selfService?: boolean;
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
    // Operator-managed (not self-service): HYC is the only workspace that needs
    // it, and it's slated for removal with scupper — so we keep it off the
    // self-service card and toggle it by hand.
    label: 'FTP upload',
    helpSectionIds: [],
    selfService: false,
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
    // Gates the *public* side of the cross-series competitor-identity spine:
    // the competitor index (/p/{ws}/competitors), the per-competitor timeline,
    // and the index link on the public results listing — all read off the
    // identity link the reconcile pass populates. Off by default and introduced
    // for IODAI first (a one-design junior class with a deep historical corpus)
    // — invisible and inert everywhere else, per the containment model. The
    // in-app reconcile UI is gated separately by `competitor-reconcile`.
    // Operator-managed (not self-service): we control the adoption of the
    // cross-series identity spine workspace by workspace for now.
    label: 'Cross-series competitor identity (public)',
    helpSectionIds: ['competitor-identity'],
    selfService: false,
  },
  'combined-pages': {
    // Combined published pages (#255): publish several fleets' results as
    // sections of one page — an all-fleets "Overall" page, or a multi-method
    // class page replacing its members' standalone pages. Gates the
    // series-settings editor and the publish dialog's group rows; a series
    // that already carries group config keeps rendering it (like sub-series,
    // the gate contains the authoring surface, not existing data). Opt-in
    // (default off) while the page composition proves out with HYC's panel,
    // per the containment model.
    label: 'Combined published pages',
    helpSectionIds: ['combined-pages'],
  },
  'rrs-import': {
    // Pushing the competitor list to a racingrulesofsailing.org event via its
    // competitor-import API: the Import dialog's "Import to rrs.org" option
    // (both alongside a CSV import and push-only from the competitor listing).
    // Opt-in (default off) while the integration proves out against real
    // events, per the containment model.
    label: 'RRS.org competitor push',
    helpSectionIds: ['rrs-org-push'],
  },
  'prizes': {
    // Prize allocation (#240): the Prizes tab (named awards with an
    // eligibility predicate over fleet / subdivision axes / rank, top-N by
    // series standing) and the published prize-sheet page. Opt-in (default
    // off) while the predicate model proves out against real NoRs, per the
    // containment model.
    label: 'Prizes',
    helpSectionIds: ['prizes'],
  },
  'competitor-reconcile': {
    // Gates the *in-app* reconcile surface (/workspace/competitors, its
    // switcher entry, and the /api/v1/competitor-identities endpoints behind
    // it) — the rename/split tooling for correcting auto-matched identities.
    // Held back separately from the public feature: the public pages are
    // settled, but the reconcile UX isn't, and cleanup currently runs
    // out-of-band (the iodai-archive manifest, #218), so the UI stays hidden
    // until we return to it. Off by default.
    // Operator-managed (not self-service): the counterpart of
    // `competitor-identity`; adoption stays centrally controlled while the
    // reconcile UX beds in.
    label: 'Cross-series competitor reconcile (in-app)',
    helpSectionIds: [],
    selfService: false,
  },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;

export const ALL_FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** Features that are on for every workspace unless explicitly opted out. */
export const DEFAULT_ON_FEATURES = ALL_FEATURE_KEYS.filter(
  (k) => (FEATURES[k] as FeatureDef).defaultOn,
);

/** Features owners/admins may toggle themselves from Workspace settings. The
 *  complement (`selfService: false`) is operator-managed via the CLI and never
 *  rendered in the self-service card. */
export const SELF_SERVICE_FEATURES = ALL_FEATURE_KEYS.filter(
  (k) => (FEATURES[k] as FeatureDef).selfService !== false,
);

export function isFeatureKey(s: string): s is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, s);
}

/** Whether owners/admins may toggle `key` from the self-service settings card.
 *  The server API guard and the card both defer to this. */
export function isSelfServiceFeature(key: FeatureKey): boolean {
  return (FEATURES[key] as FeatureDef).selfService !== false;
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

/**
 * Apply a single feature toggle to a workspace's metadata — the shared policy
 * behind both the self-service settings card and the `provision-org` CLI, so
 * the two can never diverge.
 *
 *   - enable:  add to `enabledFeatures`, clear any opt-out.
 *   - disable: drop from `enabledFeatures` **and** record the opt-out in
 *              `disabledFeatures`.
 *
 * Recording the opt-out unconditionally — not only for default-on features — is
 * what lets a workspace switch off a feature it would otherwise still see: a
 * default-on one, or one inherited from a club under Model B, since
 * `computeEffectiveFeatures` subtracts `disabledFeatures` last. For a plain
 * opt-in feature with no inheritance the opt-out is a harmless no-op (it removes
 * a key that isn't otherwise present). Both directions are idempotent.
 */
export function applyFeatureToggle(
  meta: OrgMetadata,
  key: FeatureKey,
  enabled: boolean,
): OrgMetadata {
  const enabledSet = new Set(meta.enabledFeatures);
  const disabledSet = new Set(meta.disabledFeatures);
  if (enabled) {
    enabledSet.add(key);
    disabledSet.delete(key);
  } else {
    enabledSet.delete(key);
    disabledSet.add(key);
  }
  return {
    kind: meta.kind,
    enabledFeatures: [...enabledSet],
    disabledFeatures: [...disabledSet],
  };
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
