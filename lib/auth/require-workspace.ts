import 'server-only';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  apikey,
  member,
  organization,
  session as sessionTable,
} from '@/lib/db/schema/auth';
import {
  hasPermission,
  type Permission,
  type WorkspaceRole,
} from '@/lib/auth/permissions';
import {
  computeEffectiveFeatures,
  type FeatureKey,
  type FeatureMembership,
} from '@/lib/features';

export type { Permission, WorkspaceRole };

/**
 * Personal workspaces are created with slug `u-${userId.slice(0, 16)}`
 * by both the sign-up hook (`lib/auth.ts`) and the provision-org CLI
 * (`scripts/provision-org.ts`). Encoding the user id in the slug means
 * we can identify the personal workspace from its slug alone, without
 * extra metadata or a lookup against organization name.
 */
export function personalWorkspaceSlug(userId: string): string {
  return `u-${userId.slice(0, 16)}`;
}

/**
 * ADR-008 Phase 2: single seam for resolving the active workspace
 * (= Better Auth organization) on every server request.
 *
 * Used by `/api/v1/...` route handlers (PR #5) and reusable for any
 * server component that needs a workspace-scoped repository. Defence
 * in depth: route handlers call this before instantiating a repository,
 * and the repository layer is then the second line of enforcement
 * (CVE-2025-29927 made middleware-only auth a known failure mode).
 */

export class UnauthenticatedError extends Error {
  constructor() {
    super('unauthenticated');
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends Error {
  constructor(public readonly reason?: string) {
    super(reason ? `forbidden: ${reason}` : 'forbidden');
    this.name = 'ForbiddenError';
  }
}

export interface WorkspaceContext {
  userId: string;
  email: string;
  workspaceId: string;
  /** The workspace's organization slug — the public namespace segment in
   *  `/p/{workspaceSlug}/...` published URLs. Personal workspaces are `u-{id}`. */
  workspaceSlug: string;
  role: WorkspaceRole;
  /** Experimental features enabled for this request (#155, Model B): the
   *  active workspace's own features, plus — for a personal workspace — the
   *  features of every club the user belongs to. */
  features: FeatureKey[];
}

/**
 * Throws `ForbiddenError('feature-disabled:<key>')` (→ 403) when the active
 * workspace does not have the experimental feature enabled. The single seam
 * for server-side feature enforcement (#155); used by the `ftp-upload` API
 * routes, whose endpoints could otherwise be hit directly.
 */
export function requireFeature(ctx: WorkspaceContext, key: FeatureKey): void {
  if (!ctx.features.includes(key)) {
    throw new ForbiddenError(`feature-disabled:${key}`);
  }
}

/**
 * Throws `ForbiddenError('permission-denied:<permission>')` (→ 403) when the
 * caller's workspace role doesn't grant the permission. The `workspaceRoute`
 * wrapper applies this to every `/api/v1` request; handlers call it directly
 * only for checks the wrapper can't express (e.g. the target workspace of a
 * cross-workspace copy).
 */
export function requirePermission(
  ctx: WorkspaceContext,
  permission: Permission,
): void {
  if (!hasPermission(ctx.role, permission)) {
    throw new ForbiddenError(`permission-denied:${permission}`);
  }
}

/**
 * Returns the active workspace context for the current request, or throws.
 *
 * Reads `session.activeOrganizationId` (the value the workspace switcher
 * writes via Better Auth's `setActiveOrganization`). When unset, we
 * bootstrap-pick the user's personal workspace (slug
 * `u-${userId.slice(0, 16)}`) and persist it to the session row.
 *
 * The bootstrap path covers the known edge case from Phase 1 where
 * Better Auth queues `user.create.after` past the session-create
 * transaction, so the very first session of a new user has
 * `activeOrganizationId = null` even though their personal workspace
 * already exists. Single-membership users hit the same branch.
 *
 * Phase 7 originally threw `no-active-workspace` for multi-membership
 * users in this case, on the grounds that "oldest by createdAt" was
 * arbitrary. Picking by slug instead is deterministic — every user has
 * exactly one personal workspace, created at sign-up — so it isn't a
 * guess. If a user somehow lacks a personal workspace (only invited
 * memberships), we still throw and the switcher prompts them.
 */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session) throw new UnauthenticatedError();
  // A key-authenticated request (ADR-009) gets a synthesized session from the
  // @better-auth/api-key plugin: `session.session.id` is the API key's id and
  // there is no `activeOrganizationId` property. Use that to (a) read the
  // key's default-workspace metadata and (b) avoid persisting a bootstrap
  // pick to a session row that doesn't exist.
  const isApiKey = !('activeOrganizationId' in session.session);
  const workspaceOverride = hdrs.get('x-sailscoring-workspace') ?? undefined;
  return resolveWorkspace({
    userId: session.user.id,
    email: session.user.email,
    activeOrganizationId: session.session.activeOrganizationId ?? null,
    sessionId: isApiKey ? undefined : session.session.id,
    apiKeyId: isApiKey ? session.session.id : undefined,
    workspaceOverride,
  });
}

/**
 * Effective experimental-feature set for the current request, or `[]` when
 * there is no session / workspace (#155). For server components that gate UI
 * but must still render for signed-out / no-workspace viewers — e.g. `/help`
 * and the workspace settings page — where `requireWorkspace`'s throw-on-absence
 * contract is the wrong shape.
 */
export async function getEffectiveFeatures(): Promise<FeatureKey[]> {
  try {
    const ctx = await requireWorkspace();
    return ctx.features;
  } catch {
    return [];
  }
}

/**
 * Internal helper, exported for tests. Given just the session-level facts,
 * resolves a workspace context against the database.
 *
 * Selection precedence:
 *  1. `workspaceOverride` — an explicit slug or id (the `x-sailscoring-workspace`
 *     header). Wins over everything and **fails closed**: a value the caller is
 *     not a member of throws rather than falling back.
 *  2. `activeOrganizationId` — the session's active workspace (browser flow).
 *  3. `apiKeyId` — for key-authenticated requests with no explicit override,
 *     the key's `metadata.defaultWorkspace`, if it names a current membership.
 *  4. Bootstrap — the personal workspace (or the sole membership).
 *
 * `sessionId` is optional so test callers can exercise the resolution logic
 * without a real session; when provided, the bootstrap-pick path persists the
 * chosen organization back to the session row so subsequent requests skip this
 * branch. It is deliberately omitted for key requests (their `session.id` is an
 * API-key id, not a session row).
 */
export async function resolveWorkspace(input: {
  userId: string;
  email: string;
  activeOrganizationId: string | null;
  sessionId?: string;
  workspaceOverride?: string;
  apiKeyId?: string;
}): Promise<WorkspaceContext> {
  const memberships = await getDb()
    .select({
      organizationId: member.organizationId,
      role: member.role,
      slug: organization.slug,
      metadata: organization.metadata,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, input.userId))
    .orderBy(member.createdAt);

  if (memberships.length === 0) {
    throw new ForbiddenError('no-workspace');
  }

  // All memberships carry their org metadata, so the effective feature set
  // (Model B, #155) is computed from this one query — no extra round-trip.
  const featureMemberships: FeatureMembership[] = memberships.map((m) => ({
    slug: m.slug,
    metadata: m.metadata,
  }));

  type Membership = (typeof memberships)[number];
  const toContext = (m: Membership): WorkspaceContext => ({
    userId: input.userId,
    email: input.email,
    workspaceId: m.organizationId,
    workspaceSlug: m.slug,
    role: m.role as WorkspaceRole,
    features: computeEffectiveFeatures(m.slug, featureMemberships),
  });
  // A workspace reference is either an organization id or its slug.
  const matchRef = (ref: string): Membership | undefined =>
    memberships.find((m) => m.organizationId === ref || m.slug === ref);

  // 1. Explicit override (header) — fail closed.
  if (input.workspaceOverride) {
    const m = matchRef(input.workspaceOverride);
    if (!m) throw new ForbiddenError('workspace-not-a-member');
    return toContext(m);
  }

  // 2. Session active workspace.
  if (input.activeOrganizationId) {
    const active = memberships.find(
      (m) => m.organizationId === input.activeOrganizationId,
    );
    if (active) return toContext(active);
    // Stale active id — the user was removed from that org since the
    // session column was last written. Fall through.
  }

  // 3. API-key default workspace from the key's metadata.
  if (input.apiKeyId) {
    const ref = await apiKeyDefaultWorkspace(input.apiKeyId);
    if (ref) {
      const m = matchRef(ref);
      if (m) return toContext(m);
    }
  }

  // 4. Bootstrap.
  const bootstrap =
    memberships.length === 1
      ? memberships[0]
      : memberships.find(
          (m) => m.slug === personalWorkspaceSlug(input.userId),
        );

  if (bootstrap) {
    if (input.sessionId) {
      await getDb()
        .update(sessionTable)
        .set({ activeOrganizationId: bootstrap.organizationId })
        .where(eq(sessionTable.id, input.sessionId));
    }
    return toContext(bootstrap);
  }

  throw new ForbiddenError('no-active-workspace');
}

/**
 * Read the `defaultWorkspace` (slug or id) from an API key's metadata, or
 * `null` when the key has none. Defensive: a missing key or malformed
 * metadata resolves to `null` rather than throwing, so a bad default falls
 * through to bootstrap rather than failing the request.
 */
async function apiKeyDefaultWorkspace(apiKeyId: string): Promise<string | null> {
  try {
    const [row] = await getDb()
      .select({ metadata: apikey.metadata })
      .from(apikey)
      .where(eq(apikey.id, apiKeyId))
      .limit(1);
    if (!row?.metadata) return null;
    const meta = JSON.parse(row.metadata) as { defaultWorkspace?: unknown };
    return typeof meta.defaultWorkspace === 'string' && meta.defaultWorkspace
      ? meta.defaultWorkspace
      : null;
  } catch {
    return null;
  }
}
