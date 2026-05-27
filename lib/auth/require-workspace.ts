import 'server-only';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  member,
  organization,
  session as sessionTable,
} from '@/lib/db/schema/auth';
import {
  computeEffectiveFeatures,
  type FeatureKey,
  type FeatureMembership,
} from '@/lib/features';

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

export type WorkspaceRole = 'owner' | 'admin' | 'member';

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
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthenticatedError();
  return resolveWorkspace({
    userId: session.user.id,
    email: session.user.email,
    activeOrganizationId: session.session.activeOrganizationId ?? null,
    sessionId: session.session.id,
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
 * `sessionId` is optional so test callers can exercise the resolution
 * logic without a real session; when provided, the bootstrap-pick path
 * persists the chosen organization back to the session row so subsequent
 * requests skip this branch.
 */
export async function resolveWorkspace(input: {
  userId: string;
  email: string;
  activeOrganizationId: string | null;
  sessionId?: string;
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

  if (input.activeOrganizationId) {
    const active = memberships.find(
      (m) => m.organizationId === input.activeOrganizationId,
    );
    if (active) {
      return {
        userId: input.userId,
        email: input.email,
        workspaceId: active.organizationId,
        workspaceSlug: active.slug,
        role: active.role as WorkspaceRole,
        features: computeEffectiveFeatures(active.slug, featureMemberships),
      };
    }
    // Stale active id — the user was removed from that org since the
    // session column was last written. Fall through to the bootstrap
    // path.
  }

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
    return {
      userId: input.userId,
      email: input.email,
      workspaceId: bootstrap.organizationId,
      workspaceSlug: bootstrap.slug,
      role: bootstrap.role as WorkspaceRole,
      features: computeEffectiveFeatures(bootstrap.slug, featureMemberships),
    };
  }

  throw new ForbiddenError('no-active-workspace');
}
