/**
 * Invitations + member management on a shared workspace (#153, Phase 10).
 *
 * The Phase 10 exit criterion for self-serve membership: an owner invites a
 * co-scorer by email from the Members card, the invitee accepts via the
 * /accept-invitation page, and the owner can then change their role — all
 * without the provision-org CLI.
 *
 * Base Playwright (two contexts = two sessions); both pages are clean paths,
 * so console errors are guarded manually.
 */
import { test, expect, type Page } from '@playwright/test';

import {
  addMemberByEmail,
  createOrgWorkspace,
  latestInvitationId,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test.describe('workspace invitations', () => {
  test('owner invites a co-scorer, who accepts and is then promoted', async ({
    browser,
  }) => {
    const ctxAlice = await browser.newContext();
    const ctxBob = await browser.newContext();
    const alice: Page = await ctxAlice.newPage();
    const bob: Page = await ctxBob.newPage();

    const errors: string[] = [];
    for (const [who, pg] of [
      ['alice', alice],
      ['bob', bob],
    ] as const) {
      pg.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
      pg.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${who}: ${m.text()}`);
      });
    }

    try {
      const stamp = Date.now();
      const emailAlice = await signInFreshUser(alice, `inv-alice-${stamp}`);
      const emailBob = await signInFreshUser(bob, `inv-bob-${stamp}`);

      // Alice owns a shared org workspace (provisioned out-of-band, as today).
      const orgName = `Invite Panel ${stamp}`;
      const org = await createOrgWorkspace(orgName);
      await addMemberByEmail(org.id, emailAlice, 'owner');
      await setActiveWorkspace(alice, org.id);

      // Alice invites Bob from the Members card.
      await alice.goto('/workspace');
      await expect(alice.getByTestId('members-list')).toContainText(emailAlice);
      await alice.getByLabel('Invite a co-scorer by email').fill(emailBob);
      await alice.getByRole('button', { name: 'Invite', exact: true }).click();
      await expect(alice.getByTestId('pending-invitations')).toContainText(emailBob);

      // Bob opens the invitation link and accepts.
      const invitationId = await latestInvitationId(emailBob);
      await bob.goto(`/accept-invitation/${invitationId}`);
      await expect(bob.getByTestId('accept-invitation')).toContainText(orgName);
      await bob.getByTestId('accept-invitation-accept').click();
      await bob.waitForURL(/\/$/);

      // Bob is now in the org: his switcher shows it, and it's his active one.
      await expect(bob.getByTestId('workspace-switcher')).toContainText(orgName);

      // Alice's roster now lists Bob; the pending invitation is gone.
      await alice.goto('/workspace');
      await expect(alice.getByTestId('members-list')).toContainText(emailBob);
      await expect(alice.getByTestId('pending-invitations')).toHaveCount(0);

      // Alice promotes Bob to admin via the role select.
      await alice.getByTestId(`member-role-${emailBob}`).click();
      await alice.getByRole('option', { name: 'admin' }).click();
      await expect(alice.getByTestId(`member-role-${emailBob}`)).toContainText('admin');
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
      if (errors.length > 0) {
        throw new Error(`unexpected console/page errors:\n${errors.join('\n')}`);
      }
    }
  });
});
