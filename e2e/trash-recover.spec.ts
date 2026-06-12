import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';
import type { Page } from '@playwright/test';

/**
 * The Trash actions for a soft-deleted series ("Recover a deleted series"):
 * Recover brings it back (archived) and permanent delete drops it for good,
 * gated behind typing the series name. A trashed series can't be opened — these
 * are the only two paths out of the Trash.
 */

/** Archive then delete a series from the home list, leaving it in the Trash. */
async function archiveAndDelete(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('button', { name: /Archived \(\d+\)/ }).click();
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  await page.getByRole('button', { name: 'Delete series' }).click();
  await expect(page.getByText(name)).toBeHidden();
}

test('recover a deleted series brings it back archived', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Recoverable Series' });
  await page.goto('/');
  await archiveAndDelete(page, 'Recoverable Series');

  // Recover it from the Trash.
  await page.getByRole('button', { name: /Trash \(1\)/ }).click();
  await expect(page.getByText('Recoverable Series')).toBeVisible();
  await page.getByRole('button', { name: 'Recover', exact: true }).click();

  // Gone from the Trash…
  await expect(page.getByRole('button', { name: /Trash/ })).toBeHidden();
  // …and back in the (collapsed) Archived section. Reload so the assertion
  // doesn't race the post-recover refetch re-render.
  await page.goto('/');
  await page.getByRole('button', { name: /Archived \(1\)/ }).click();
  // `exact` — the card's activity strip ("Recovered series …") repeats the name.
  await expect(page.getByText('Recoverable Series', { exact: true })).toBeVisible();
});

test('permanent delete requires typing the series name', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Doomed Series' });
  await page.goto('/');
  await archiveAndDelete(page, 'Doomed Series');

  await page.getByRole('button', { name: /Trash \(1\)/ }).click();
  await page.getByRole('button', { name: 'Permanently delete Doomed Series' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Delete forever' });
  // Disabled until the name matches exactly.
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type the series name to confirm').fill('wrong name');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type the series name to confirm').fill('Doomed Series');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // Gone entirely — no Trash section left.
  await expect(page.getByText('Doomed Series')).toBeHidden();
  await expect(page.getByRole('button', { name: /Trash/ })).toBeHidden();
});
