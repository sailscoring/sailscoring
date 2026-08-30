'use client';

import { useIsSpectator } from '@/components/spectator-context';
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
 *
 * The one place that fallback is wrong is a spectator view (#475): there is
 * no workspace behind it and never will be, so the permissive default would
 * offer a reader every workspace action on someone else's published results.
 * Denying at this single point covers every `can(...)`-gated affordance at
 * once, which is the whole of what those controls mean here.
 */
export function useWorkspacePermissions(): {
  role: string | null;
  can: (permission: Permission) => boolean;
} {
  const { memberships, activeOrganizationId } = useWorkspaceMemberships();
  const spectator = useIsSpectator();
  const active =
    memberships.find((m) => m.organizationId === activeOrganizationId) ??
    (memberships.length === 1 ? memberships[0] : undefined);
  if (spectator) return { role: null, can: () => false };
  return {
    role: active?.role ?? null,
    can: (permission) => (active ? hasPermission(active.role, permission) : true),
  };
}
