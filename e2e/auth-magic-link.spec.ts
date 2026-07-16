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

    // First-time sign-up lands on the welcome (name) step; skip it.
    await expect(page).toHaveURL(/\/welcome/);
    await page.getByTestId('welcome-skip').click();
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

  // Regression: the verify endpoint URL-decodes its callback params once
  // more than the sign-in form encoded them, so a destination containing
  // a query string used to collapse inside newUserCallbackURL and fail
  // Better Auth's callback validation with INVALID_CALLBACK_URL.
  test('new-user sign-in from a callbackURL with a query string lands on it', async ({
    page,
  }) => {
    const email = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-qs@sailscoring.test`;
    const destination = '/account?via=e2e';

    await page.goto(`/sign-in?callbackURL=${encodeURIComponent(destination)}`);
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    await expect(page.getByText(/Check your inbox/i)).toBeVisible();

    const link = await readLatestMagicLink(email);
    await page.goto(link);

    await expect(page).toHaveURL(/\/welcome/);
    await page.getByTestId('welcome-skip').click();
    await expect(page).toHaveURL(destination);
  });

  test('an invalid or expired link lands back on sign-in with an explanation', async ({
    page,
  }) => {
    const email = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-bad@sailscoring.test`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    await expect(page.getByText(/Check your inbox/i)).toBeVisible();

    // Corrupt the token: the verify endpoint treats it exactly like an
    // expired one, so this exercises the dead-link path deterministically.
    const link = await readLatestMagicLink(email);
    await page.goto(link.replace(/token=[^&]+/, 'token=corrupted'));

    await expect(page).toHaveURL(/\/sign-in\?error=/);
    await expect(page.getByText(/expired or already been used/i)).toBeVisible();
  });

  test('signs out from header user menu', async ({ page }) => {
    const email = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-out@sailscoring.test`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    const link = await readLatestMagicLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/welcome/);
    await page.getByTestId('welcome-skip').click();
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.waitForURL(/\/sign-in/);
    await page.goto('/account');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
