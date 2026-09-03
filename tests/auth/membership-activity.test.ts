import { describe, expect, test } from 'vitest';

import { membershipActivity, type MembershipActor } from '@/lib/auth/membership-activity';

const alice: MembershipActor = { id: 'usr_alice', name: 'Alice Adams', email: 'alice@example.test' };
const bob: MembershipActor = { id: 'usr_bob', name: 'Bob Brown', email: 'bob@example.test' };
const lookupUser = async (id: string) => (id === bob.id ? bob : null);

describe('membershipActivity', () => {
  test('an invitation names the invitee and role', async () => {
    const r = await membershipActivity({
      path: '/organization/invite-member',
      actor: alice,
      returned: { id: 'inv_1', organizationId: 'org_1', email: 'bob@example.test', role: 'member' },
      lookupUser,
    });
    expect(r).toMatchObject({
      workspaceId: 'org_1',
      action: 'member.invited',
      summary: 'Invited bob@example.test as member',
    });
  });

  test('accepting names the joiner (the actor) and their role', async () => {
    const r = await membershipActivity({
      path: '/organization/accept-invitation',
      actor: bob,
      returned: { invitation: { id: 'inv_1' }, member: { id: 'mem_1', organizationId: 'org_1', role: 'admin' } },
      lookupUser,
    });
    expect(r).toMatchObject({
      workspaceId: 'org_1',
      action: 'member.joined',
      summary: 'Bob Brown accepted an invitation and joined as admin',
    });
  });

  test('a role change names the member, or says "own" when it is the caller', async () => {
    const other = await membershipActivity({
      path: '/organization/update-member-role',
      actor: alice,
      returned: { id: 'mem_2', organizationId: 'org_1', userId: 'usr_bob', role: 'owner' },
      lookupUser,
    });
    expect(other?.summary).toBe('Changed Bob Brown’s role to owner');
    expect(other?.action).toBe('member.role-changed');

    const self = await membershipActivity({
      path: '/organization/update-member-role',
      actor: alice,
      returned: { id: 'mem_1', organizationId: 'org_1', userId: 'usr_alice', role: 'admin' },
      lookupUser,
    });
    expect(self?.summary).toBe('Changed own role to admin');

    // An unknown user degrades to the id rather than failing the entry.
    const unknown = await membershipActivity({
      path: '/organization/update-member-role',
      actor: alice,
      returned: { id: 'mem_3', organizationId: 'org_1', userId: 'usr_gone', role: 'member' },
      lookupUser,
    });
    expect(unknown?.summary).toBe('Changed usr_gone’s role to member');
  });

  test('removal and leaving are distinct actions', async () => {
    const removed = await membershipActivity({
      path: '/organization/remove-member',
      actor: alice,
      returned: { member: { id: 'mem_2', organizationId: 'org_1', userId: 'usr_bob', role: 'member' } },
      lookupUser,
    });
    expect(removed).toMatchObject({ action: 'member.removed', summary: 'Removed Bob Brown' });

    const left = await membershipActivity({
      path: '/organization/leave',
      actor: alice,
      returned: { id: 'mem_1', organizationId: 'org_1', userId: 'usr_alice', role: 'admin' },
      lookupUser,
    });
    expect(left).toMatchObject({ action: 'member.left', summary: 'Left the workspace' });
  });

  test('a cancelled invitation names the address', async () => {
    const r = await membershipActivity({
      path: '/organization/cancel-invitation',
      actor: alice,
      returned: { id: 'inv_1', organizationId: 'org_1', email: 'bob@example.test', status: 'canceled' },
      lookupUser,
    });
    expect(r).toMatchObject({ action: 'invitation.cancelled', summary: 'Cancelled the invitation to bob@example.test' });
  });

  test('other endpoints, failures, and malformed returns map to nothing', async () => {
    expect(
      await membershipActivity({ path: '/organization/list-members', actor: alice, returned: { members: [] }, lookupUser }),
    ).toBeNull();
    expect(
      await membershipActivity({ path: '/organization/invite-member', actor: alice, returned: new Error('nope'), lookupUser }),
    ).toBeNull();
    expect(
      await membershipActivity({ path: '/organization/remove-member', actor: alice, returned: { member: null }, lookupUser }),
    ).toBeNull();
  });
});
