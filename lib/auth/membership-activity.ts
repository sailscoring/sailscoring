import type { ActivityAction } from '@/lib/activity-actions';

/**
 * What a membership change through Better Auth's organization endpoints
 * should leave in the workspace activity log. Pure: the after-hook in
 * `lib/auth.ts` hands in the endpoint path, the acting session user, and what
 * the endpoint returned, and records whatever comes back. Anything that isn't
 * a membership change, or that didn't succeed, maps to null.
 *
 * The role-change and removal endpoints act on someone other than the caller,
 * so the summary needs that person's name; `lookupUser` fetches it, and falls
 * back to the bare id if it can't.
 */

export interface MembershipActor {
  id: string;
  name?: string | null;
  email: string;
}

export interface MembershipActivity {
  workspaceId: string;
  action: ActivityAction;
  summary: string;
  metadata: Record<string, unknown>;
}

type UserLookup = (userId: string) => Promise<MembershipActor | null>;

function label(u: MembershipActor | null | undefined, fallback: string): string {
  return u?.name?.trim() || u?.email || fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !(v instanceof Error);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Better Auth stores several roles as one comma-joined string. */
function roleLabel(role: unknown): string {
  if (Array.isArray(role)) return role.join(', ');
  return str(role) ?? 'member';
}

export async function membershipActivity(input: {
  path: string;
  actor: MembershipActor;
  returned: unknown;
  lookupUser: UserLookup;
}): Promise<MembershipActivity | null> {
  const { path, actor, returned, lookupUser } = input;
  if (!isRecord(returned)) return null;

  switch (path) {
    case '/organization/invite-member': {
      const workspaceId = str(returned.organizationId);
      const email = str(returned.email);
      if (!workspaceId || !email) return null;
      const role = roleLabel(returned.role);
      return {
        workspaceId,
        action: 'member.invited',
        summary: `Invited ${email} as ${role}`,
        metadata: { email, role, invitationId: str(returned.id) },
      };
    }
    case '/organization/accept-invitation': {
      const member = isRecord(returned.member) ? returned.member : null;
      const workspaceId = str(member?.organizationId);
      if (!workspaceId) return null;
      const role = roleLabel(member?.role);
      return {
        workspaceId,
        action: 'member.joined',
        summary: `${label(actor, actor.id)} accepted an invitation and joined as ${role}`,
        metadata: { role, memberId: str(member?.id) },
      };
    }
    case '/organization/cancel-invitation': {
      const workspaceId = str(returned.organizationId);
      const email = str(returned.email);
      if (!workspaceId || !email) return null;
      return {
        workspaceId,
        action: 'invitation.cancelled',
        summary: `Cancelled the invitation to ${email}`,
        metadata: { email, invitationId: str(returned.id) },
      };
    }
    case '/organization/update-member-role': {
      const workspaceId = str(returned.organizationId);
      const userId = str(returned.userId);
      if (!workspaceId || !userId) return null;
      const role = roleLabel(returned.role);
      const self = userId === actor.id;
      const target = self ? null : await lookupUser(userId).catch(() => null);
      return {
        workspaceId,
        action: 'member.role-changed',
        summary: self
          ? `Changed own role to ${role}`
          : `Changed ${label(target, userId)}’s role to ${role}`,
        metadata: { role, targetUserId: userId, memberId: str(returned.id) },
      };
    }
    case '/organization/remove-member': {
      const member = isRecord(returned.member) ? returned.member : null;
      const workspaceId = str(member?.organizationId);
      const userId = str(member?.userId);
      if (!workspaceId || !userId) return null;
      const target = userId === actor.id ? actor : await lookupUser(userId).catch(() => null);
      return {
        workspaceId,
        action: 'member.removed',
        summary: `Removed ${label(target, userId)}`,
        metadata: { targetUserId: userId, role: roleLabel(member?.role), memberId: str(member?.id) },
      };
    }
    case '/organization/leave': {
      const workspaceId = str(returned.organizationId);
      if (!workspaceId) return null;
      return {
        workspaceId,
        action: 'member.left',
        summary: 'Left the workspace',
        metadata: { role: roleLabel(returned.role), memberId: str(returned.id) },
      };
    }
    default:
      return null;
  }
}
