'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authClient } from '@/lib/auth-client';

import { queryKeys } from './query-keys';

/**
 * Member + invitation management for the active workspace (#153). These wrap
 * the Better Auth organization client directly — no /api/v1 surface — and all
 * operate on the active organization. Mutations invalidate the members query
 * so the card reflects changes immediately.
 */

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface WorkspaceMemberRow {
  id: string;
  userId: string;
  role: string;
  user: { email: string; name: string | null };
}

export interface WorkspaceInvitationRow {
  id: string;
  email: string;
  role: string | null;
  status: string;
}

export interface FullWorkspace {
  members: WorkspaceMemberRow[];
  invitations: WorkspaceInvitationRow[];
}

function unwrap<T>(res: { data: T | null; error: { message?: string } | null }): T {
  if (res.error) throw new Error(res.error.message ?? 'request failed');
  return res.data as T;
}

export function useFullWorkspace() {
  return useQuery<FullWorkspace>({
    queryKey: queryKeys.workspaceMembers.all,
    queryFn: async () => {
      const full = unwrap(await authClient.organization.getFullOrganization());
      const f = full as unknown as {
        members?: WorkspaceMemberRow[];
        invitations?: WorkspaceInvitationRow[];
      };
      return {
        members: f.members ?? [],
        // Only pending invitations are actionable; accepted/cancelled ones
        // are noise on the card.
        invitations: (f.invitations ?? []).filter((i) => i.status === 'pending'),
      };
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: WorkspaceRole }) =>
      authClient.organization.inviteMember({ email, role }).then(unwrap),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.workspaceMembers.all }),
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: WorkspaceRole }) =>
      authClient.organization.updateMemberRole({ memberId, role }).then(unwrap),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.workspaceMembers.all }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberIdOrEmail: string) =>
      authClient.organization.removeMember({ memberIdOrEmail }).then(unwrap),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.workspaceMembers.all }),
  });
}

export function useCancelInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      authClient.organization.cancelInvitation({ invitationId }).then(unwrap),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.workspaceMembers.all }),
  });
}
