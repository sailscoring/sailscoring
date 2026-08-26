/**
 * Personal-workspace banner visibility.
 *
 * "Self-service" is detected per-user as memberships.length === 1: the
 * only workspace is the personal one auto-created at sign-up. Users on a
 * club workspace (added via `scripts/provision-org.ts add-member` or an
 * invitation) always have ≥2 memberships and never see the banner.
 *
 * A welcome note also appears in the first magic-link email sent to a new
 * self-service user (lib/auth.ts + lib/auth/email.ts), but that path is
 * covered by inspecting the email module directly; the e2e covers only
 * the in-app banner.
 */
import { test, expect } from './fixtures';
import { addMemberByEmail, createOrgWorkspace, signInFreshUser } from './helpers';

test.describe('personal workspace banner', () => {
  test('banner is visible for a fresh self-service user', async ({ page }) => {
    await signInFreshUser(page, 'banner-solo');
    await expect(page.getByTestId('personal-workspace-banner')).toBeVisible();
    await expect(page.getByTestId('personal-workspace-banner')).toContainText('mark@hyc.ie');
  });

  test('banner disappears once user is added to a second workspace', async ({ page }) => {
    const email = await signInFreshUser(page, 'banner-club');
    await expect(page.getByTestId('personal-workspace-banner')).toBeVisible();

    const org = await createOrgWorkspace(`Banner Org ${Date.now()}`);
    await addMemberByEmail(org.id, email, 'member');

    await page.goto('/');
    await expect(page.getByTestId('personal-workspace-banner')).toHaveCount(0);
  });
});
