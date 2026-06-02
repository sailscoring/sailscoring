import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * A scorer can correct a race's date from the race results page. New races
 * default to today's date; this verifies the inline editor persists a change
 * and that it survives a reload and shows up back on the Races list.
 */
test('edit a race date from the race results page', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Tuesday Evening Series', venue: 'Howth Yacht Club' });

  // Add a race and open it.
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Edit the date: click the inline editor, set a new value, commit with Enter.
  await page.getByRole('button', { name: 'Edit date for Race 1' }).click();
  const input = page.getByLabel('Date for Race 1');
  await input.fill('2026-05-19');
  await input.press('Enter');

  // The editor collapses back to a button showing the saved date.
  await expect(page.getByRole('button', { name: 'Edit date for Race 1' })).toContainText(
    '2026-05-19',
  );

  // It survives a reload (i.e. it was persisted, not just local state).
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit date for Race 1' })).toContainText(
    '2026-05-19',
  );

  // And it shows on the Races list.
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByText('2026-05-19')).toBeVisible();
});
