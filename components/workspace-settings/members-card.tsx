'use client';

import { useState } from 'react';
import { Loader2, LogOut, Trash2 } from 'lucide-react';

import {
  useCancelInvitation,
  useFullWorkspace,
  useInviteMember,
  useLeaveWorkspace,
  useRemoveMember,
  useUpdateMemberRole,
  type WorkspaceRole,
} from '@/hooks/use-workspace-members';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function RoleSelect({
  roles,
  value,
  onChange,
  disabled,
  testId,
}: {
  roles: WorkspaceRole[];
  value: WorkspaceRole;
  onChange: (role: WorkspaceRole) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as WorkspaceRole)} disabled={disabled}>
      <SelectTrigger className="h-8 w-28" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r} value={r}>
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Member + invitation management for the active workspace (#153). Owners and
 * admins can invite by email, change roles, remove members, and cancel
 * pending invitations; everyone else sees a read-only roster. The current
 * user's email comes from the (server) workspace page so we can find their
 * member row — and their role — once the roster loads.
 *
 * Your own row is not special-cased away: an owner or admin can change their
 * own role, and anyone can leave. Better Auth enforces the one rule that
 * matters — a workspace can't be left without an owner — and its refusal is
 * shown verbatim rather than pre-empted here, so the card never says no
 * where the server would have said yes.
 *
 * Only mounted for a shared workspace. A personal workspace has no members
 * to speak of — it is single-user by design — so the caller leaves this card
 * out entirely rather than rendering a roster of one.
 */
export function MembersCard({
  currentUserEmail,
  canAssignScorer = false,
}: {
  currentUserEmail: string | null;
  /** Whether the `scorer` role is offered — the `fine-grained-roles` feature. */
  canAssignScorer?: boolean;
}) {
  // The roles on offer in the invite and change-role selects. `archivist`
  // (the archive-repo CI credential role, ADR-010) is deliberately absent:
  // it is provisioned by operator tooling for API keys, never assigned to
  // people — a member holding it (or any other unoffered role) renders
  // read-only below, with Remove still available.
  const roles: WorkspaceRole[] = canAssignScorer
    ? ['owner', 'admin', 'scorer', 'member']
    : ['owner', 'admin', 'member'];
  const { data, isLoading, isError } = useFullWorkspace();
  const invite = useInviteMember();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const leaveWorkspace = useLeaveWorkspace();
  const cancelInvitation = useCancelInvitation();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [error, setError] = useState<string | null>(null);

  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];
  const me = members.find((m) => m.user.email === currentUserEmail);
  const canManage = me?.role === 'owner' || me?.role === 'admin';

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const email = inviteEmail.trim();
    if (!email) return;
    try {
      await invite.mutateAsync({ email, role: inviteRole });
      setInviteEmail('');
      setInviteRole('member');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation.');
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  async function leave() {
    if (!data) return;
    await run(async () => {
      await leaveWorkspace.mutateAsync(data.id);
      // The session's active workspace is gone; a hard reload lets every
      // server component re-resolve, which lands on the personal workspace
      // (the same reason the switcher reloads rather than soft-routing).
      window.location.assign('/');
    });
  }

  return (
    <section className="bg-card rounded-lg border p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Members</h2>
        <p className="text-sm text-muted-foreground">
          Owners and admins can see and edit every series in this workspace;
          members get read-only access. Invitations, role changes, and removals
          are recorded on the workspace&apos;s Activity tab.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
        </p>
      )}
      {isError && (
        <p className="text-sm text-muted-foreground">Couldn’t load members.</p>
      )}

      {!isLoading && !isError && (
        <ul className="divide-y" data-testid="members-list">
          {members.map((m) => {
            const isSelf = m.user.email === currentUserEmail;
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm truncate">
                    {m.user.name?.trim() || m.user.email}
                    {isSelf && <span className="text-muted-foreground"> (you)</span>}
                  </div>
                  {m.user.name?.trim() && (
                    <div className="text-xs text-muted-foreground truncate">{m.user.email}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canManage && roles.includes(m.role as WorkspaceRole) ? (
                    <RoleSelect
                      roles={roles}
                      value={m.role as WorkspaceRole}
                      onChange={(role) => run(() => updateRole.mutateAsync({ memberId: m.id, role }))}
                      disabled={updateRole.isPending}
                      testId={`member-role-${m.user.email}`}
                    />
                  ) : (
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid={`member-role-${m.user.email}`}
                    >
                      {m.role}
                    </span>
                  )}
                  {isSelf ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={leaveWorkspace.isPending}
                      onClick={leave}
                      data-testid="leave-workspace"
                    >
                      <LogOut className="h-4 w-4" />
                      Leave
                    </Button>
                  ) : (
                    canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${m.user.email}`}
                        disabled={removeMember.isPending}
                        onClick={() => run(() => removeMember.mutateAsync(m.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {invitations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Pending invitations</h3>
          <ul className="divide-y" data-testid="pending-invitations">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm truncate">{inv.email}</div>
                  <div className="text-xs text-muted-foreground">invited as {inv.role ?? 'member'}</div>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={cancelInvitation.isPending}
                    onClick={() => run(() => cancelInvitation.mutateAsync(inv.id))}
                  >
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage && (
        <form onSubmit={handleInvite} className="space-y-2 border-t pt-4">
          <Label htmlFor="invite-email">Invite a co-scorer by email</Label>
          <div className="flex gap-2">
            <Input
              id="invite-email"
              type="email"
              placeholder="scorer@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={invite.isPending}
            />
            <RoleSelect roles={roles} value={inviteRole} onChange={setInviteRole} disabled={invite.isPending} testId="invite-role" />
            <Button type="submit" disabled={invite.isPending || !inviteEmail.trim()}>
              {invite.isPending ? 'Inviting…' : 'Invite'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            They’ll get an email with a link to accept. The invite is pending
            until they do. Members can view everything but change nothing;
            {canAssignScorer && (
              <> scorers can run race days — races, finishes, publishing —
              but can&apos;t change series setup;</>
            )}{' '}
            admins have full access.
          </p>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
