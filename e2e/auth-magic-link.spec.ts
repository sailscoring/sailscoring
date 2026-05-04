import { test, expect } from './fixtures';
import { readLatestMagicLink } from './helpers';

/**
 * Magic-link sign-in via the dev sender. Tagged @auth so it only runs
 * in the `db-tests` workflow, which provisions Postgres and applies
 * migrations. The local-first e2e workflow filters this out via the
 * `chromium-local` project's `grepInvert`.
 *
 * The dev sender (lib/auth/email.ts when RESEND_API_KEY is unset)
 * appends every magic-link URL to tests/.magic-links.log; the helper
 * filters by email so parallel workers don't collide.
 */

test.describe('@auth magic-link sign-in', () => {
  test('signs in and lands in a personal workspace', async ({ page }) => {
    const email = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@sailscoring.test`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send magic link' }).click();
    await expect(page.getByText(/Check your inbox/i)).toBeVisible();

    const link = await readLatestMagicLink(email);
    await page.goto(link);

    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByText(email)).toBeVisible();
    // Personal workspaces are all named "My Workspace" — the user's own
    // identity is on /account two lines up, no need to repeat it.
    // Scoped to <main> because the Phase 7 workspace switcher in the
    // header also shows the workspace name.
    await expect(
      page.getByRole('main').getByText('My Workspace'),
    ).toBeVisible();
  });

  test('signs out from /account', async ({ page }) => {
    const email = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-out@sailscoring.test`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send magic link' }).click();
    const link = await readLatestMagicLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/account/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/sign-in/);
    await page.goto('/account');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
