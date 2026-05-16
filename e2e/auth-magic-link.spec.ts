import { test, expect } from './fixtures';
import { readLatestMagicLink } from './helpers';

/**
 * Magic-link sign-in via the dev sender. The dev sender
 * (lib/auth/email.ts when RESEND_API_KEY is unset) appends every
 * magic-link URL to tests/.magic-links.log; the helper filters by
 * email so parallel workers don't collide.
 */

test.describe('magic-link sign-in', () => {
  test('signs in and lands in a personal workspace', async ({ page }) => {
    const email = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@sailscoring.test`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    await expect(page.getByText(/Check your inbox/i)).toBeVisible();

    const link = await readLatestMagicLink(email);
    await page.goto(link);

    // Default callback lands the user on the home page.
    await expect(page).toHaveURL(/\/$/);

    // /account renders the email + active workspace. Scope to <main>
    // because the header user menu also shows the email and the
    // workspace switcher also shows the workspace name.
    await page.goto('/account');
    await expect(page.getByRole('main').getByText(email)).toBeVisible();
    await expect(
      page.getByRole('main').getByText('My Workspace'),
    ).toBeVisible();
  });

  test('signs out from header user menu', async ({ page }) => {
    const email = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-out@sailscoring.test`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    const link = await readLatestMagicLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.waitForURL(/\/sign-in/);
    await page.goto('/account');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
