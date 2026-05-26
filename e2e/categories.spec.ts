import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * Scorer-defined categories (#154): create one from the home list, move a
 * series into it via the card menu, and confirm the list partitions into a
 * category section.
 */
test('create a category and group a series under it', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Wednesday League' });
  await page.goto('/');

  // Create a category via Manage Categories.
  await page.getByRole('button', { name: 'Categories' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('New category name').fill('Club Racing');
  await dialog.getByRole('button', { name: 'Add' }).click();
  // The new-category field clears once the create resolves.
  await expect(dialog.getByPlaceholder('New category name')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Move the series into the category.
  await page.getByRole('button', { name: 'Actions for Wednesday League' }).click();
  await page.getByRole('menuitem', { name: 'Move to category' }).click();
  await page.getByRole('menuitemradio', { name: 'Club Racing' }).click();

  // The list now shows a "Club Racing" section heading.
  await expect(page.getByRole('heading', { name: 'Club Racing' })).toBeVisible();
});
