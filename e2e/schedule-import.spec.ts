import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures } from './helpers';

/**
 * Import schedule… on the Races tab reads a season's races from a
 * spreadsheet, one row per race, with a column of guns per fleet: a blank or
 * a dash sits that fleet out, ASAP is a start with no gun yet, and a row
 * without a date is left out and named. Gated (`schedule-import`).
 */
test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['schedule-import']);
});

test('import a schedule with a column of guns per fleet', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Frostbite Series', venue: 'Royal Cork Yacht Club' });
  await createFleets(page, ['Topper & Feva', 'ILCA & 420']);

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByRole('button', { name: 'Add race' })).toBeVisible();

  const csv = [
    'Frostbite Series 2025',
    'Race,Date,Topper & Feva,ILCA & 420,Notes',
    '1,08/11/2025,11:00,11:05,',
    '2,08/11/2025,ASAP,ASAP,',
    '3,15/11/2025,11:00,11:05,',
    '12,06/12/2025,,11:00,Toppers ashore',
    '13,06/12/2025,—,ASAP,',
    '14,,11:00,11:00,',
  ].join('\n');

  // The menu item opens the file picker; feed the input it clicks.
  await page.getByRole('button', { name: 'More add-race options' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Import schedule…' }).click();
  await (await chooser).setFiles({
    name: 'frostbite.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });

  // Mapping: every column recognised, the notes column ignored, the title
  // line above the headings left out.
  const mapping = page.getByRole('dialog');
  await expect(mapping.getByText('Import schedule — map columns')).toBeVisible();
  await expect(mapping.getByLabel('Read Topper & Feva as')).toHaveText('Start: Topper & Feva');
  await expect(mapping.getByLabel('Read Notes as')).toHaveText('(ignore)');
  await mapping.getByRole('button', { name: 'Preview 6 rows' }).click();

  const preview = page.getByRole('dialog');
  await expect(preview.getByText('5 races will be added, numbered from Race 1.')).toBeVisible();
  await expect(preview.getByTestId('schedule-import-errors')).toContainText('Row 8: no date');
  const rows = preview.getByTestId('schedule-import-preview').locator('tbody tr');
  await expect(rows).toHaveCount(5);
  const starts = (i: number) => rows.nth(i).getByTestId('schedule-import-starts').locator('div');
  await expect(starts(0)).toHaveText(['11:00 — Topper & Feva', '11:05 — ILCA & 420']);
  await expect(starts(1)).toHaveText(['No gun time — Topper & Feva', 'No gun time — ILCA & 420']);
  await expect(rows.nth(3)).toContainText('2025-12-06');
  await expect(starts(3)).toHaveText(['11:00 — ILCA & 420']);
  await preview.getByRole('button', { name: 'Import 5 races' }).click();
  await expect(preview).toBeHidden();

  const raceRows = page.getByTestId('race-row');
  await expect(raceRows).toHaveCount(5);
  await expect(raceRows.nth(1)).toContainText('2025-11-08');
  await expect(raceRows.nth(4)).toContainText('2025-12-06');

  // Race 5: only ILCA & 420 sail, and its gun is still to come.
  await raceRows.nth(4).getByText('Race 5', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Race starts' })).toBeVisible();
  await expect(page.getByText('No gun time')).toBeVisible();
  await expect(page.getByText(/— ILCA & 420$/)).toBeVisible();
  await expect(page.getByText(/Topper & Feva/)).toHaveCount(0);
});

test('a mapping that names a Start column and fleet columns is refused', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Mixed Columns' });
  await createFleets(page, ['ILCA 7']);

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByRole('button', { name: 'Add race' })).toBeVisible();

  // The `t` shortcut opens the same picker.
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('t');
  await (await chooser).setFiles({
    name: 'schedule.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(['Date,Start,ILCA 7', '2025-11-08,11:00,11:00'].join('\n')),
  });

  const mapping = page.getByRole('dialog');
  await expect(mapping.getByText(/either one Start column or a column per fleet/)).toBeVisible();
  await expect(mapping.getByRole('button', { name: 'Preview 1 row' })).toBeDisabled();

  // Ignoring the fleet column leaves the Start column — and this series has
  // no default start sequence for it to run.
  await mapping.getByLabel('Read ILCA 7 as').click();
  await page.getByRole('option', { name: '(ignore)' }).click();
  await expect(mapping.getByText(/this series has none/)).toBeVisible();

  // Ignoring Start instead imports the dates alone.
  await mapping.getByLabel('Read Start as').click();
  await page.getByRole('option', { name: '(ignore)' }).click();
  await mapping.getByRole('button', { name: 'Preview 1 row' }).click();
  await page.getByRole('button', { name: 'Import 1 race' }).click();
  await expect(page.getByTestId('race-row')).toHaveCount(1);
});
