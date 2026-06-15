import 'server-only';

import type { WorkspaceContext } from '@/lib/auth/require-workspace';

/**
 * ADR-009 M4 — the caller's resolved identity and active workspace, for
 * `GET /api/v1/workspace` (the CLI's `whoami`). Everything here is already in
 * the request's `WorkspaceContext`, so there is no extra query: it just
 * projects the safe, caller-owned fields.
 */
export interface WorkspaceIdentity {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceSlug: string;
  role: WorkspaceContext['role'];
  features: WorkspaceContext['features'];
}

export function workspaceIdentity(workspace: WorkspaceContext): WorkspaceIdentity {
  return {
    userId: workspace.userId,
    email: workspace.email,
    workspaceId: workspace.workspaceId,
    workspaceSlug: workspace.workspaceSlug,
    role: workspace.role,
    features: workspace.features,
  };
}
