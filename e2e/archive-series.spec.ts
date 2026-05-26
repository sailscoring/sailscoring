import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * Archiving a series makes it read-only (#154): the GitHub-style archive that
 * subsumes locking. Archive from the home card menu, open the archived series,
 * confirm it's read-only (banner + no edit affordances), then unarchive and
 * confirm editing is restored.
 */
test('archive makes a series read-only; unarchive restores editing', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Spring Series' });
  // createSeriesQuick lands on the Competitors tab; Add competitor is present.
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();

  // Archive from the home card menu.
  await page.goto('/');
  await page.getByRole('button', { name: 'Actions for Spring Series' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();

  // It drops into the collapsed Archived section; open it from there.
  await page.getByRole('button', { name: /Archived \(1\)/ }).click();
  await page.getByRole('link', { name: /Spring Series/ }).click();
  await expect(page).toHaveURL(/\/competitors$/);

  // Read-only: the banner's Unarchive button is present and Add is gone.
  await expect(page.getByRole('button', { name: 'Unarchive' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeHidden();

  // Unarchive from the banner restores editing.
  await page.getByRole('button', { name: 'Unarchive' }).click();
  await expect(page.getByRole('button', { name: 'Unarchive' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
});
