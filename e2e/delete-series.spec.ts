import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * UI flow for the delete-series action. Server-side cascade integrity
 * is covered by Postgres FKs and the postgres-repository tests; this
 * spec asserts only what the user sees.
 */
test('delete series with warning dialog', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Series to Keep' });
  await createSeriesQuick(page, { name: 'Series to Delete' });

  await page.goto('/');
  await expect(page.getByText('Series to Keep')).toBeVisible();
  await expect(page.getByText('Series to Delete')).toBeVisible();

  // Warning dialog shows the series name and the irreversibility copy.
  await page.getByRole('button', { name: 'Delete Series to Delete' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Series to Delete/ })).toBeVisible();
  await expect(page.getByText(/permanently delete/i)).toBeVisible();
  await expect(page.getByText(/cannot be undone/i)).toBeVisible();

  // Cancel leaves both series intact.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Series to Delete')).toBeVisible();

  // Confirm deletes the targeted series only.
  await page.getByRole('button', { name: 'Delete Series to Delete' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Delete series' }).click();
  await expect(page.getByText('Series to Delete')).not.toBeVisible();
  await expect(page.getByText('Series to Keep')).toBeVisible();
});
