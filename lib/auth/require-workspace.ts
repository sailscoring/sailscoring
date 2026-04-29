import 'server-only';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { member } from '@/lib/db/schema/auth';

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
 * Prefers `session.activeOrganizationId` when set, falling back to the
 * user's first membership by `createdAt`. The fallback covers a known
 * edge case from Phase 1: Better Auth queues `user.create.after` past
 * the surrounding session-create transaction, so `activeOrganizationId`
 * is null on the very first session of a new user. A real
 * "switch workspace" UI in Phase 4 will set the column reliably.
 */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthenticatedError();
  return resolveWorkspace({
    userId: session.user.id,
    email: session.user.email,
    activeOrganizationId: session.session.activeOrganizationId ?? null,
  });
}

/**
 * Internal helper, exported for tests. Given just the session-level facts,
 * resolves a workspace context against the database.
 */
export async function resolveWorkspace(input: {
  userId: string;
  email: string;
  activeOrganizationId: string | null;
}): Promise<WorkspaceContext> {
  const memberships = await getDb()
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, input.userId))
    .orderBy(member.createdAt);

  if (memberships.length === 0) {
    throw new ForbiddenError('no-workspace');
  }

  const active = input.activeOrganizationId
    ? memberships.find((m) => m.organizationId === input.activeOrganizationId)
    : null;
  const pick = active ?? memberships[0];

  return {
    userId: input.userId,
    email: input.email,
    workspaceId: pick.organizationId,
    role: pick.role as WorkspaceRole,
  };
}
