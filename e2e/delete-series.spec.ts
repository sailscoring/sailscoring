import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * Delete is gated behind archiving first (#154): a series can only be deleted
 * once it's archived (archive-then-delete, to block destructive snap
 * decisions). This spec drives that two-step from the home list. Server-side
 * cascade integrity is covered by the postgres-repository tests.
 */
test('archive then delete a series from the home list', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Series to Keep' });
  await createSeriesQuick(page, { name: 'Series to Delete' });

  await page.goto('/');
  await expect(page.getByText('Series to Keep')).toBeVisible();
  await expect(page.getByText('Series to Delete')).toBeVisible();

  // An active series has no delete — archive it first via the card menu.
  await page.getByRole('button', { name: 'Actions for Series to Delete' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();

  // It drops into the collapsed Archived section.
  await expect(page.getByText('Series to Delete')).toBeHidden();
  await page.getByRole('button', { name: /Archived \(1\)/ }).click();
  await expect(page.getByText('Series to Delete')).toBeVisible();

  // Now Delete is available from the archived card's menu, behind a confirm.
  await page.getByRole('button', { name: 'Actions for Series to Delete' }).click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/permanently delete/i)).toBeVisible();
  await page.getByRole('button', { name: 'Delete series' }).click();

  await expect(page.getByText('Series to Delete')).toBeHidden();
  await expect(page.getByText('Series to Keep')).toBeVisible();
});
