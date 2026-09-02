/**
 * Stepping down from, and leaving, a shared workspace from the Members card.
 *
 * The Members card used to hide every control on your own row, so an owner
 * who had handed ownership on still couldn't step back. The rule that actually
 * matters — a workspace can't be left without an owner — is Better Auth's, and
 * the card now lets it speak: a sole owner's Leave is refused with the server's
 * message; once someone else owns the workspace, the same owner can demote
 * themselves and leave, landing in their personal workspace.
 *
 * Base Playwright (two contexts: the second user only needs to exist), so
 * console errors are guarded manually.
 */
import { test, expect, type Page } from '@playwright/test';

import {
  addMemberByEmail,
  createOrgWorkspace,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test.describe('leaving a workspace', () => {
  test('a sole owner is refused; with a second owner they step down and leave', async ({
    browser,
  }) => {
    const ctxAlice = await browser.newContext();
    const ctxBob = await browser.newContext();
    const alice: Page = await ctxAlice.newPage();
    const bob: Page = await ctxBob.newPage();

    const errors: string[] = [];
    alice.on('pageerror', (e) => errors.push(e.message));
    alice.on('console', (m) => {
      // The refused leave is a 400 the card renders; Chromium's own "Failed
      // to load resource" line for it is the same noise ./fixtures filters.
      if (m.type() === 'error' && !/Failed to load resource:/i.test(m.text())) {
        errors.push(m.text());
      }
    });

    try {
      const stamp = Date.now();
      const emailAlice = await signInFreshUser(alice, `leave-alice-${stamp}`);
      const emailBob = await signInFreshUser(bob, `leave-bob-${stamp}`);

      const orgName = `Leave Panel ${stamp}`;
      const org = await createOrgWorkspace(orgName);
      await addMemberByEmail(org.id, emailAlice, 'owner');
      await setActiveWorkspace(alice, org.id);

      // Alice's own row carries a role select and Leave, not nothing.
      await alice.goto('/workspace');
      const members = alice.getByTestId('members-list');
      await expect(members).toContainText(emailAlice);
      await expect(alice.getByTestId(`member-role-${emailAlice}`)).toContainText('owner');
      const leave = alice.getByTestId('leave-workspace');
      await expect(leave).toBeVisible();

      // As the only owner she can't go: the server's refusal, verbatim, and
      // she's still listed.
      await leave.click();
      await expect(alice.getByText('You cannot leave the organization as the only owner')).toBeVisible();
      await expect(members).toContainText(emailAlice);
      await expect(alice.getByTestId('workspace-switcher')).toContainText(orgName);

      // Bob becomes an owner too. Now Alice can step down to admin…
      await addMemberByEmail(org.id, emailBob, 'owner');
      await alice.reload();
      await expect(members).toContainText(emailBob);
      await alice.getByTestId(`member-role-${emailAlice}`).click();
      await alice.getByRole('option', { name: 'admin' }).click();
      await expect(alice.getByTestId(`member-role-${emailAlice}`)).toContainText('admin');

      // …and leave, landing in her personal workspace with the panel gone
      // from her switcher.
      await alice.getByTestId('leave-workspace').click();
      await alice.waitForURL(/\/$/);
      const switcher = alice.getByTestId('workspace-switcher');
      await expect(switcher).toContainText('My Workspace');
      await switcher.click();
      await expect(alice.getByRole('menuitem', { name: orgName })).toHaveCount(0);
    } finally {
      await ctxAlice.close();
      await ctxBob.close();
      if (errors.length > 0) {
        throw new Error(`unexpected console/page errors:\n${errors.join('\n')}`);
      }
    }
  });
});
