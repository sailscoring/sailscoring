import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * The "Add multiple races" generator hangs off the Add race split button. It
 * bulk-creates a weekly/fortnightly run of races on a fixed weekday, previewing
 * the dates before committing. Each generated race is an ordinary row
 * afterwards (renumbered, dated, editable).
 */
test('generate a weekly run of races from the Add race menu', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Generator Series', venue: 'Howth Yacht Club' });

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Open the chevron menu beside Add race → Add multiple races…
  await page.getByRole('button', { name: 'More add-race options' }).click();
  await page.getByRole('menuitem', { name: 'Add multiple races…' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Add multiple races')).toBeVisible();

  // Tuesdays, weekly, four races.
  await dialog.getByLabel('First race date').fill('2026-05-05');
  await expect(dialog.getByText('Races fall on Tuesdays.')).toBeVisible();
  await dialog.getByRole('spinbutton').fill('4');

  // Preview reflects the inputs before committing.
  await expect(dialog.getByText('4 races will be created:')).toBeVisible();

  await dialog.getByRole('button', { name: 'Create 4 races' }).click();

  const rows = page.getByTestId('race-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Race 1');
  await expect(rows.nth(0)).toContainText('2026-05-05');
  await expect(rows.nth(1)).toContainText('2026-05-12');
  await expect(rows.nth(3)).toContainText('2026-05-26');

  // Persisted across a reload.
  await page.reload();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText('2026-05-26');
});

/**
 * Until-date mode, appending after existing races: the run continues the
 * numbering rather than restarting it, and a supplied name lands on every row.
 */
test('generate fortnightly until a date, appended and named', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Append Series', venue: 'Howth Yacht Club' });

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // One race up front via the primary split-button segment.
  await page.getByRole('button', { name: 'Add race', exact: true }).click();
  const rows = page.getByTestId('race-row');
  await expect(rows).toHaveCount(1);

  await page.getByRole('button', { name: 'More add-race options' }).click();
  await page.getByRole('menuitem', { name: 'Add multiple races…' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First race date').fill('2026-06-02');
  await dialog.getByLabel('Repeat').selectOption('fortnightly');
  await dialog.getByRole('radio', { name: 'Until date' }).check();
  await dialog.getByLabel('Last race on or before').fill('2026-07-14');
  await dialog.getByLabel('Name (optional)').fill('Evening Race');

  // 02 Jun, 16 Jun, 30 Jun, 14 Jul = 4 races.
  await expect(dialog.getByText('4 races will be created:')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create 4 races' }).click();

  // Appended after the existing race: total 5, numbered 1..5.
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(1)).toContainText('Race 2');
  await expect(rows.nth(1)).toContainText('Evening Race');
  await expect(rows.nth(1)).toContainText('2026-06-02');
  await expect(rows.nth(4)).toContainText('Race 5');
  await expect(rows.nth(4)).toContainText('2026-07-14');
});
