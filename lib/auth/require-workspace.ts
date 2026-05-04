import 'server-only';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { member, session as sessionTable } from '@/lib/db/schema/auth';

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
  role: WorkspaceRole;
}

/**
 * Returns the active workspace context for the current request, or throws.
 *
 * Reads `session.activeOrganizationId` (the value the workspace switcher
 * writes via Better Auth's `setActiveOrganization`). When unset *and* the
 * user has exactly one membership, we bootstrap-pick that membership and
 * persist it to the session row — this covers the known edge case from
 * Phase 1 where Better Auth queues `user.create.after` past the
 * session-create transaction, so the very first session of a new user
 * has `activeOrganizationId = null` even though their personal workspace
 * exists. With multiple memberships and no active set, we throw — Phase 7
 * removed the silent "fall back to oldest by createdAt" because it picked
 * arbitrarily for users in multiple orgs.
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
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, input.userId))
    .orderBy(member.createdAt);

  if (memberships.length === 0) {
    throw new ForbiddenError('no-workspace');
  }

  if (input.activeOrganizationId) {
    const active = memberships.find(
      (m) => m.organizationId === input.activeOrganizationId,
    );
    if (active) {
      return {
        userId: input.userId,
        email: input.email,
        workspaceId: active.organizationId,
        role: active.role as WorkspaceRole,
      };
    }
    // Stale active id — the user was removed from that org since the
    // session column was last written. Fall through to the bootstrap
    // path so single-membership users still resolve cleanly.
  }

  if (memberships.length === 1) {
    const only = memberships[0];
    if (input.sessionId) {
      await getDb()
        .update(sessionTable)
        .set({ activeOrganizationId: only.organizationId })
        .where(eq(sessionTable.id, input.sessionId));
    }
    return {
      userId: input.userId,
      email: input.email,
      workspaceId: only.organizationId,
      role: only.role as WorkspaceRole,
    };
  }

  throw new ForbiddenError('no-active-workspace');
}
