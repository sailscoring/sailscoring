import { test, expect } from './fixtures';
import { freshTestEmail, readLatestMagicLink } from './helpers';
import type { Page } from '@playwright/test';

/**
 * The first-sign-in name prompt (welcome step) and the editable name on
 * the account page. A magic-link sign-up never collects a name, so these
 * two surfaces are the only ways a user gets one onto their record.
 */

/**
 * Assert the account page shows `name`, tolerating the brief read-after-write
 * window between saving on /welcome and the value being visible to a fresh
 * server render on a subsequent navigation. Re-navigates until it appears.
 */
async function expectAccountName(page: Page, name: string): Promise<void> {
  await expect(async () => {
    await page.goto('/account');
    await expect(page.getByRole('main').getByText(name)).toBeVisible({
      timeout: 1500,
    });
  }).toPass({ timeout: 10000 });
}

test.describe('welcome name step', () => {
  test('new user can set their name on the welcome step', async ({ page }) => {
    const email = freshTestEmail('welcome');

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    const link = await readLatestMagicLink(email);
    await page.goto(link);

    await expect(page).toHaveURL(/\/welcome/);
    await page.getByTestId('welcome-name').fill('Mary Murphy');
    await page.getByTestId('welcome-save').click();

    // Saving lands the user on the home page, and the name is now on record.
    await expect(page).toHaveURL(/\/$/);
    await expectAccountName(page, 'Mary Murphy');
  });

  test('user who skipped can add and edit their name on the account page', async ({
    page,
  }) => {
    const email = freshTestEmail('welcome-edit');

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    const link = await readLatestMagicLink(email);
    await page.goto(link);

    // Skip the welcome step — no name yet.
    await expect(page).toHaveURL(/\/welcome/);
    await page.getByTestId('welcome-skip').click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/account');
    // Add a name via the account-page prompt.
    await page.getByTestId('account-name-edit').click();
    await page.getByTestId('account-name-input').fill('Sean Sailor');
    await page.getByTestId('account-name-save').click();
    await expect(page.getByRole('main').getByText('Sean Sailor')).toBeVisible();

    // Edit it again to confirm the round-trip.
    await page.getByTestId('account-name-edit').click();
    await page.getByTestId('account-name-input').fill('Seán Sailor');
    await page.getByTestId('account-name-save').click();
    await expect(page.getByRole('main').getByText('Seán Sailor')).toBeVisible();
  });

  test('welcome step does not re-prompt a user who already has a name', async ({
    page,
  }) => {
    const email = freshTestEmail('welcome-named');

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    const link = await readLatestMagicLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/welcome/);
    await page.getByTestId('welcome-name').fill('Already Named');
    await page.getByTestId('welcome-save').click();
    await expect(page).toHaveURL(/\/$/);

    await expectAccountName(page, 'Already Named');

    // Visiting /welcome directly now redirects straight to the destination.
    await page.goto('/welcome');
    await expect(page).toHaveURL(/\/$/);
  });
});
