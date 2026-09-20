/**
 * #611 — a joined personal workspace carries its owner.
 *
 * Every personal workspace is stored as "My Workspace", on the reasoning that
 * it has exactly one member who already knows whose it is. That breaks the
 * moment an operator joins someone's personal workspace to help with a
 * support question: the switcher ends with a second row reading "My
 * Workspace", the role line under it says nothing useful either, and picking
 * the right one is guesswork — with switching into the wrong person's
 * workspace as the mistake the list should be preventing.
 *
 * Base Playwright (two contexts: the second user only needs to exist), so
 * console errors are guarded manually.
 */
import { test, expect, type Page } from '@playwright/test';

import {
  addMemberByEmail,
  personalWorkspaceOf,
  signInFreshUser,
} from './helpers';

test.describe('personal workspace naming', () => {
  test('someone else’s personal workspace is named for its owner, yours is not', async ({
    browser,
  }) => {
    const ctxOperator = await browser.newContext();
    const ctxOwner = await browser.newContext();
    const operator: Page = await ctxOperator.newPage();
    const owner: Page = await ctxOwner.newPage();

    const errors: string[] = [];
    for (const [who, pg] of [
      ['operator', operator],
      ['owner', owner],
    ] as const) {
      pg.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
      pg.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${who}: ${m.text()}`);
      });
    }

    try {
      const stamp = Date.now();
      const operatorEmail = await signInFreshUser(operator, `pwn-op-${stamp}`);
      const ownerEmail = await signInFreshUser(owner, `pwn-owner-${stamp}`);

      // The owner sees their own as "My Workspace" — the property the help
      // docs describe, and the one this fix must not disturb.
      await owner.goto('/');
      await expect(owner.getByTestId('workspace-switcher')).toContainText('My Workspace');

      // The operator joins it, the way support does.
      const theirs = await personalWorkspaceOf(ownerEmail);
      await addMemberByEmail(theirs.id, operatorEmail, 'admin');

      await operator.goto('/');
      const switcher = operator.getByTestId('workspace-switcher');
      // Their own is still "My Workspace"…
      await expect(switcher).toContainText('My Workspace');
      await switcher.click();
      // …and the joined one carries its owner, so the two rows are told apart.
      const joined = operator.getByTestId(`workspace-switcher-item-${theirs.slug}`);
      await expect(joined).toContainText(ownerEmail);
      await expect(joined).toContainText('personal');
      await expect(joined).not.toHaveText(/^My Workspace/);
    } finally {
      await ctxOperator.close();
      await ctxOwner.close();
      expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
    }
  });
});
