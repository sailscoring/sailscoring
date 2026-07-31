import { signedInTest as test, expect } from './fixtures';

/**
 * Workspace seasons management (ADR-011): the Settings card defines seasons
 * ahead of publishing and flags the current one. The publish-side behaviour
 * (season mode, auto-join) is covered in publishing.spec.ts.
 */

test('seasons card: add seasons and move the current flag', async ({ page }) => {
  await page.goto('/workspace');
  const card = page.getByTestId('seasons-card');
  await expect(card.getByText('No seasons yet')).toBeVisible();

  // Add two seasons; the newest label is current by default.
  await card.getByLabel('New season label').fill('2027');
  await card.getByRole('button', { name: 'Add' }).click();
  await expect(card.getByText('Current')).toBeVisible();

  await card.getByLabel('New season label').fill('2026-27');
  await card.getByRole('button', { name: 'Add' }).click();
  await expect(card.getByText('2026-27')).toBeVisible();
  await expect(card.getByText('nothing published yet').first()).toBeVisible();

  // Flag the year-spanning season current; the badge moves.
  await card.getByRole('button', { name: 'Make current' }).click();
  const rows = card.locator('li');
  await expect(rows.filter({ hasText: '2026-27' }).getByText('Current')).toBeVisible();
  await expect(rows.filter({ hasText: '2027' }).getByRole('button', { name: 'Make current' })).toBeVisible();
});
