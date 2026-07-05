import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for the race-entry switcher (issue #265): move between the races of a
 * series without going back to the Races tab, via the prev/next arrows, the
 * [ / ] keys, and the dropdown.
 */
test('race switcher navigates between races', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Race Switcher 2026', venue: 'HYC' });
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  for (const n of [1, 2, 3]) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${n}`, { exact: false }).first()).toBeVisible();
  }

  await page.getByText('Race 1', { exact: false }).first().click();
  await expect(page.getByRole('heading', { name: /Race 1 .* results/ })).toBeVisible();

  // First race: no previous; next arrow → Race 2.
  await expect(page.getByRole('button', { name: 'Previous race' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next race' }).click();
  await expect(page.getByRole('heading', { name: /Race 2 .* results/ })).toBeVisible();
  await expect(page).toHaveURL(/\/races\/[0-9a-f-]{36}$/);

  // Keyboard (when not typing in the sail box): ] next, [ previous.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(']');
  await expect(page.getByRole('heading', { name: /Race 3 .* results/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next race' })).toBeDisabled();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('[');
  await expect(page.getByRole('heading', { name: /Race 2 .* results/ })).toBeVisible();

  // Dropdown jumps straight to any race.
  await page.getByRole('button', { name: 'Switch race' }).click();
  await page.getByRole('menuitem', { name: 'Race 1' }).click();
  await expect(page.getByRole('heading', { name: /Race 1 .* results/ })).toBeVisible();
});
