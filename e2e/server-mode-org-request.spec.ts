/**
 * Self-service org-creation request (#153, Phase 10 iteration 3).
 *
 * A solo scorer requests a shared workspace from /account and sees it go
 * pending. The project owner fulfils it out-of-band (provision-org), and the
 * scorer then owns the new workspace and can switch into it.
 *
 * Uses ./fixtures so any stray console error fails the test (single page,
 * clean path).
 */
import { expect } from '@playwright/test';

import { test } from './fixtures';
import {
  fulfilOrgRequest,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test('request a shared workspace, then own it once fulfilled', async ({ page }) => {
  const stamp = Date.now();
  const email = await signInFreshUser(page, `orgreq-${stamp}`);
  const workspaceName = `My Club Panel ${stamp}`;

  // Submit the request from the account page.
  await page.goto('/account');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByRole('button', { name: 'Request a workspace' }).click();

  // It shows pending, and survives a reload (persisted).
  await expect(page.getByTestId('org-request-pending')).toContainText(workspaceName);
  await page.reload();
  await expect(page.getByTestId('org-request-pending')).toContainText(workspaceName);

  // Owner fulfils it out-of-band.
  const org = await fulfilOrgRequest(email);
  expect(org.name).toBe(workspaceName);

  // The account page now reflects the fulfilled request…
  await page.reload();
  await expect(page.getByTestId('org-request-card')).toContainText('has been set up');

  // …and the scorer is the owner of the new workspace they can switch into.
  await setActiveWorkspace(page, org.id);
  await page.goto('/');
  await expect(page.getByTestId('workspace-switcher')).toContainText(workspaceName);
});
