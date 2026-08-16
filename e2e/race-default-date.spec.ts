import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * A newly added race is dated from the series it belongs to, not from the
 * calendar: the last race's date if there is one, otherwise today clamped into
 * the series' own start/end window (issue #397).
 */
test('a new race takes the date of the last race in the series', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Last Race Date Series', venue: 'Howth Yacht Club' });

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Two races on known dates, via the generator.
  await page.getByRole('button', { name: 'More add-race options' }).click();
  await page.getByRole('menuitem', { name: 'Add multiple races…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First race date').fill('2026-05-05');
  await dialog.getByRole('spinbutton').fill('2');
  await dialog.getByRole('button', { name: 'Create 2 races' }).click();

  const rows = page.getByTestId('race-row');
  await expect(rows).toHaveCount(2);

  // A third race, added on its own, continues from the last one's date.
  await page.getByRole('button', { name: 'Add race', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText('2026-05-12');
});

test('a series that has finished dates new races within its window', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Finished Window Series', venue: 'Howth Yacht Club' });

  // A series that ran — and ended — in the past.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page
    .getByRole('heading', { name: 'Basic' })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByLabel('Start date').fill('2026-06-01');
  await page.getByLabel('End date').fill('2026-06-10');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/2026-06-01/).first()).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // The generator seeds its first date the same way, before any race exists.
  await page.getByRole('button', { name: 'More add-race options' }).click();
  await page.getByRole('menuitem', { name: 'Add multiple races…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('First race date')).toHaveValue('2026-06-10');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // And a single added race lands on the series' last day, not today.
  await page.getByRole('button', { name: 'Add race', exact: true }).click();
  const rows = page.getByTestId('race-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('2026-06-10');
});
