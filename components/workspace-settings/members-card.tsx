'use client';

import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

import {
  useCancelInvitation,
  useFullWorkspace,
  useInviteMember,
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
 * A personal workspace shows a read-only roster and nothing else: it is
 * single-user by design, and collaboration means asking for a club
 * workspace. The server refuses such invitations regardless; this only keeps
 * the UI honest.
 */
export function MembersCard({
  currentUserEmail,
  canAssignScorer = false,
  isPersonal = false,
}: {
  currentUserEmail: string | null;
  /** Whether the `scorer` role is offered — the `fine-grained-roles` feature. */
  canAssignScorer?: boolean;
  /** Whether the active workspace is the viewer's personal one. */
  isPersonal?: boolean;
}) {
  const roles: WorkspaceRole[] = canAssignScorer
    ? ['owner', 'admin', 'scorer', 'member']
    : ['owner', 'admin', 'member'];
  const { data, isLoading, isError } = useFullWorkspace();
  const invite = useInviteMember();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const cancelInvitation = useCancelInvitation();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [error, setError] = useState<string | null>(null);

  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];
  const me = members.find((m) => m.user.email === currentUserEmail);
  // A personal workspace has no membership controls at all — not even
  // removal. It should only ever hold its owner, so there is nothing to
  // manage; the one workspace that picked up members before invitations were
  // blocked is being cleared by hand.
  const canManage = !isPersonal && (me?.role === 'owner' || me?.role === 'admin');

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

  return (
    <section className="bg-card rounded-lg border p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Members</h2>
        <p className="text-sm text-muted-foreground">
          {isPersonal ? (
            <>
              This is your personal workspace, so it&apos;s yours alone. To
              score alongside other people, request a club or class workspace
              from your <a className="underline" href="/account">account page</a>.
            </>
          ) : (
            <>
              Owners and admins can see and edit every series in this
              workspace; members get read-only access. Changes show up in each
              series&apos; Activity log.
            </>
          )}
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
                {canManage && !isSelf ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <RoleSelect
                      roles={roles}
                      value={m.role as WorkspaceRole}
                      onChange={(role) => run(() => updateRole.mutateAsync({ memberId: m.id, role }))}
                      disabled={updateRole.isPending}
                      testId={`member-role-${m.user.email}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${m.user.email}`}
                      disabled={removeMember.isPending}
                      onClick={() => run(() => removeMember.mutateAsync(m.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground shrink-0">{m.role}</span>
                )}
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
