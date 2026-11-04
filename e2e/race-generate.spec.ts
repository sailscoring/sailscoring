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
  await dialog.getByRole('spinbutton', { name: 'Number of races' }).fill('4');

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

  // The generator's shortcut is `m`, leaving `g` free as the go-to chord
  // prefix — so the chords work on this page too.
  await page.keyboard.press('m');
  await expect(dialog.getByText('Add multiple races')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.keyboard.press('g');
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/competitors$/);
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

/**
 * Several races a day: the count becomes a count of days, the preview lists
 * one row per day, and every race of a day carries that day's date.
 */
test('generate four Sundays with three races each', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Sunday Series', venue: 'Howth Yacht Club' });

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByRole('button', { name: 'More add-race options' }).click();
  await page.getByRole('menuitem', { name: 'Add multiple races…' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First race date').fill('2026-11-08');
  await dialog.getByLabel('Races each day').fill('3');
  await expect(dialog.getByLabel('First race day')).toBeVisible();
  await dialog.getByRole('spinbutton', { name: 'Number of race days' }).fill('4');

  await expect(dialog.getByText('12 races on 4 days will be created:')).toBeVisible();
  const preview = dialog.getByTestId('gen-preview').getByRole('listitem');
  await expect(preview).toHaveCount(4);
  await expect(preview.first()).toHaveText('2026-11-08 · Races 1–3');
  await expect(preview.last()).toHaveText('2026-11-29 · Races 10–12');

  await dialog.getByRole('button', { name: 'Create 12 races' }).click();

  const rows = page.getByTestId('race-row');
  await expect(rows).toHaveCount(12);
  await expect(rows.nth(0)).toContainText('2026-11-08');
  await expect(rows.nth(2)).toContainText('2026-11-08');
  await expect(rows.nth(3)).toContainText('2026-11-15');
  await expect(rows.nth(11)).toContainText('Race 12');
  await expect(rows.nth(11)).toContainText('2026-11-29');
});

/**
 * An uneven calendar: six Saturdays, two races on some and one on others,
 * and a date skipped. The preview renumbers as days change, and changing an
 * input that generates the list throws the edits away.
 */
test('vary races per day and skip a date in the preview', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Autumn League', venue: 'Howth Yacht Club' });

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByRole('button', { name: 'More add-race options' }).click();
  await page.getByRole('menuitem', { name: 'Add multiple races…' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First race date').fill('2026-09-05');
  await dialog.getByRole('spinbutton', { name: 'Number of races' }).fill('6');
  await expect(dialog.getByText('6 races will be created:')).toBeVisible();

  // A day already at one race can't be stepped down — skipping is how it goes.
  await expect(dialog.getByRole('button', { name: 'One race fewer on 2026-09-05' })).toBeDisabled();

  await dialog.getByRole('button', { name: 'One more race on 2026-09-05' }).click();
  await dialog.getByRole('button', { name: 'One more race on 2026-09-19' }).click();
  await dialog.getByRole('button', { name: 'Skip 2026-09-26' }).click();

  await expect(dialog.getByText('7 races on 5 days will be created:')).toBeVisible();
  const preview = dialog.getByTestId('gen-preview').getByRole('listitem');
  await expect(preview).toHaveText([
    '2026-09-05 · Races 1–2',
    '2026-09-12 · Race 3',
    '2026-09-19 · Races 4–5',
    '2026-10-03 · Race 6',
    '2026-10-10 · Race 7',
  ]);

  // Changing how many throws the edits away, as the dialog warns.
  await expect(dialog.getByText(/starts this list again/)).toBeVisible();
  await dialog.getByRole('spinbutton', { name: 'Number of races' }).fill('4');
  await expect(dialog.getByText('4 races will be created:')).toBeVisible();
  await expect(dialog.getByText(/starts this list again/)).toBeHidden();

  // Edit again and create.
  await dialog.getByRole('button', { name: 'One more race on 2026-09-12' }).click();
  await dialog.getByRole('button', { name: 'Skip 2026-09-19' }).click();
  await dialog.getByRole('button', { name: 'Create 4 races' }).click();

  const rows = page.getByTestId('race-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('2026-09-05');
  await expect(rows.nth(1)).toContainText('2026-09-12');
  await expect(rows.nth(2)).toContainText('2026-09-12');
  await expect(rows.nth(3)).toContainText('Race 4');
  await expect(rows.nth(3)).toContainText('2026-09-26');
});
