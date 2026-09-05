import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * A recorder at the finish line writes down the digits, not the national
 * letters. Typing the digits alone must find a boat registered with its
 * national letters, and the letters of another nation must not.
 */
test('finish entry finds a nationally prefixed sail from its digits', async ({ page }) => {
  await createSeriesQuick(page, { name: 'National Letters 2026', venue: 'HYC' });

  for (const [sail, name] of [
    ['IRL 4076', 'Irish Boat'],
    ['IRL 4500', 'Other Irish Boat'],
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number *').fill(sail);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail, exact: true })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  const input = page.getByLabel('Sail number');

  // A digit prefix lists only the boat whose core it starts.
  await input.fill('407');
  await expect(page.getByRole('option').filter({ hasText: 'IRL 4076' })).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: 'IRL 4500' })).toHaveCount(0);

  // Another nation's letters find nothing to commit.
  await input.fill('GBR 4076');
  await expect(page.getByRole('option').filter({ hasText: 'IRL 4076' })).toHaveCount(0);

  // The bare digits commit the boat on Enter.
  await input.fill('4076');
  await input.press('Enter');
  await expect(page.getByTestId('non-finisher-IRL 4076')).toHaveCount(0);
  await expect(page.getByTestId('non-finisher-IRL 4500')).toBeVisible();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
});
