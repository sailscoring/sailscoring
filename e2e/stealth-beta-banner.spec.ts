/**
 * #121 — stealth-beta warning surfaces.
 *
 * The classification is per-user: a user with only their auto-created
 * personal workspace (memberships.length === 1) is "self-service" and
 * sees the banner; a user added to a club workspace via
 * `scripts/provision-org.ts add-member` (≥2 memberships) does not.
 */
import { test, expect } from './fixtures';
import {
  addMemberByEmail,
  createOrgWorkspace,
  readLatestMagicLink,
  signInFreshUser,
} from './helpers';

test.describe('@server stealth beta surfaces', () => {
  test('sign-in page shows the stealth-beta notice', async ({ page }) => {
    await page.goto('/sign-in');
    const notice = page.getByTestId('stealth-beta-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('stealth beta');
    await expect(notice).toContainText('mark@hyc.ie');
    await expect(notice).toContainText(/may be deleted/i);
  });

  test('banner is visible for solo-membership users and hidden after joining a second workspace', async ({
    page,
  }) => {
    const email = await signInFreshUser(page, 'banner');

    // Fresh user — only the auto-created personal workspace, banner shows.
    await expect(page.getByTestId('stealth-beta-banner')).toBeVisible();

    // Provision a club workspace and add this user to it. Once the user
    // has ≥2 memberships, the banner should disappear on next page load.
    const org = await createOrgWorkspace(`Stealth Banner Org ${Date.now()}`);
    await addMemberByEmail(org.id, email, 'member');

    await page.goto('/');
    await expect(page.getByTestId('stealth-beta-banner')).toHaveCount(0);
  });

  test('sign-in notice is shown even before the email field is touched', async ({
    page,
  }) => {
    // A second visitor lands on /sign-in cold. Ensure the notice is part of
    // the initial render, not gated behind any interaction.
    const email = `cold-${Date.now()}@sailscoring.test`;
    await page.goto('/sign-in');
    await expect(page.getByTestId('stealth-beta-notice')).toBeVisible();
    // Sanity-check the form still works alongside the notice.
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    await expect(page.getByText(/Check your inbox/i)).toBeVisible();
    await readLatestMagicLink(email);
  });
});
