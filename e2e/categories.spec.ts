import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * Scorer-defined categories (#154): create one from workspace settings, move a
 * series into it via the home card menu, and confirm the list partitions into
 * a category section.
 */
test('create a category and group a series under it', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Wednesday League' });

  // Create a category from the Series categories card in workspace settings.
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Manage' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('New category name').fill('Club Racing');
  await dialog.getByRole('button', { name: 'Add' }).click();
  // The new-category field clears once the create resolves.
  await expect(dialog.getByPlaceholder('New category name')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Move the series into the category from the home list.
  await page.goto('/');
  await page.getByRole('button', { name: 'Actions for Wednesday League' }).click();
  await page.getByRole('menuitem', { name: 'Move to category' }).click();
  await page.getByRole('menuitemradio', { name: 'Club Racing' }).click();

  // The list now shows a "Club Racing" section heading.
  await expect(page.getByRole('heading', { name: 'Club Racing' })).toBeVisible();
});

/**
 * The new-series setup wizard lets the scorer file the series into a category
 * up front (only shown once the workspace has categories).
 */
test('choose a category when creating a new series', async ({ page }) => {
  // Seed a series so the workspace exists, then add a category.
  await createSeriesQuick(page, { name: 'Seed Series' });
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Manage' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('New category name').fill('Frostbite');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByPlaceholder('New category name')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // New series → setup wizard. Name it and file it under the category.
  await page.goto('/series/new');
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/setup$/);
  await page.getByLabel('Name').fill('Tuesday Twilight');
  await page.getByTestId('setup-category').click();
  // The wizard persists the category live; wait for that write to land before
  // navigating away so the assertion below doesn't race the save. Any non-GET
  // isn't enough — the name field saves through the same endpoint (a full-row
  // write, so every body has a categoryId key, null until one is chosen).
  // Match the write that carries a non-null categoryId string.
  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/v1\/series\//.test(r.url()) &&
        r.request().method() !== 'GET' &&
        r.ok() &&
        (r.request().postData() ?? '').includes('"categoryId":"'),
    ),
    page.getByRole('option', { name: 'Frostbite' }).click(),
  ]);

  // The home list shows the new series under its chosen category section.
  await page.goto('/');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Frostbite' }) });
  await expect(section.getByText('Tuesday Twilight')).toBeVisible();
});
