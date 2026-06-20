import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * A scorer can give a race a name distinct from its number ("Round the
 * Island"). This verifies the inline editor on the race results page persists
 * the name, that it survives a reload, shows on the Races list, and can be
 * cleared back to unnamed.
 */
test('name a race from the race results page', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Tuesday Evening Series', venue: 'Howth Yacht Club' });

  // Add a race and open it.
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // A fresh race is unnamed: the editor shows the "Set name" affordance.
  await expect(page.getByRole('button', { name: 'Edit name for Race 1' })).toContainText('Set name');
  await page.getByRole('button', { name: 'Edit name for Race 1' }).click();
  const input = page.getByLabel('Name for Race 1');
  await input.fill('Round the Island');
  await input.press('Enter');

  // The editor collapses back to a button showing the saved name.
  await expect(page.getByRole('button', { name: 'Edit name for Race 1' })).toContainText(
    'Round the Island',
  );

  // It survives a reload (persisted, not just local state).
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit name for Race 1' })).toContainText(
    'Round the Island',
  );

  // And it shows on the Races list beside the number.
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByText('Round the Island')).toBeVisible();

  // Clearing the name reverts the race to unnamed.
  await page.getByText('Race 1').click();
  await page.getByRole('button', { name: 'Edit name for Race 1' }).click();
  const editAgain = page.getByLabel('Name for Race 1');
  await editAgain.fill('');
  await editAgain.press('Enter');
  await expect(page.getByRole('button', { name: 'Edit name for Race 1' })).toContainText('Set name');
});
