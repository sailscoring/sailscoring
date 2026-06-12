'use client';

import { useWorkspaceMemberships } from '@/components/workspace-memberships-provider';
import { hasPermission, type Permission } from '@/lib/auth/permissions';

/**
 * The signed-in user's permissions in the active workspace, for gating UI
 * affordances. The server is the real guard (every `/api/v1` write checks the
 * role); this is the UX layer that keeps read-only members and scorers from
 * reaching for controls that would only bounce with a 403.
 *
 * Falls back to permissive when the active membership can't be determined —
 * signed-out rendering and the brief bootstrap window before the session's
 * active workspace id is written. Showing a control that the server then
 * refuses is a better transient failure than hiding the whole UI.
 */
export function useWorkspacePermissions(): {
  role: string | null;
  can: (permission: Permission) => boolean;
} {
  const { memberships, activeOrganizationId } = useWorkspaceMemberships();
  const active =
    memberships.find((m) => m.organizationId === activeOrganizationId) ??
    (memberships.length === 1 ? memberships[0] : undefined);
  return {
    role: active?.role ?? null,
    can: (permission) => (active ? hasPermission(active.role, permission) : true),
  };
}
