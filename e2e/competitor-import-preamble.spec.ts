import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, importMapColumns } from './helpers';

function csvBuffer(content: string) {
  return { name: 'entries.csv', mimeType: 'text/csv', buffer: Buffer.from(content) };
}

/** The lines a HalSail class export puts above its column headings. */
const HALSAIL_PREAMBLE = [
  'INSTRUCTIONS FOR RELOADING THIS SPREADSHEET INTO HALSAIL',
  '"THE COLUMN HEADINGS MUST BE IN ONE OF THE FIRST THREE ROWS. YOU CAN USE ANY OF THE FIRST 26 COLUMNS (A TO Z). THE ONLY MANDATORY ONE IS SAIL NUMBER."',
  '"HALSAIL STOPS READING THE SPREADSHEET WHEN IT ENCOUNTERS A ROW WITH NO SAIL NUMBER, SO DON\'T LEAVE ANY BLANK CELLS IN THAT COLUMN. IF THE BOAT HAS NO SAIL NUMBER ENTER 0."',
  'BOATS IN CLASS CRUISERS MASTER 2026',
];

test('a HalSail export imports its boats, not its instructions', async ({ page }) => {
  await createSeriesQuick(page, { name: 'HalSail Export Import' });

  const csv = [
    ...HALSAIL_PREAMBLE,
    'SAIL NUMBER,Name,Owner',
    '930,Uforia,Pat Walsh',
    '1552,Movita,Mary Burke',
  ].join('\n');
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(csv));

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('import-skipped-rows')).toContainText('4 lines above them');
  await importMapColumns(page);
  // HalSail's Name column is the boat; the Owner column is the primary.
  await expect(dialog.getByRole('radio', { name: /^Owner/ })).toBeChecked();
  await expect(dialog.getByTestId('implausible-sail-numbers')).toHaveCount(0);

  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('columnheader', { name: 'Boat', exact: true })).toBeVisible();
  const row = page.getByRole('row', { name: /930/ });
  await expect(row).toContainText('Uforia');
  await expect(row).toContainText('Pat Walsh');
  await expect(page.getByRole('cell', { name: /SAIL NUMBER|BOATS IN CLASS|HALSAIL/ })).toHaveCount(0);
});

test('a sail number that reads like text is flagged before import', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Odd Sail Number Import' });

  const csv = [
    'Sail No,Helm',
    '930,Pat Walsh',
    'SEE NOTES BELOW,',
  ].join('\n');
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(csv));
  await importMapColumns(page);

  const warning = page.getByRole('dialog').getByTestId('implausible-sail-numbers');
  await expect(warning).toContainText("1 row has a sail number that doesn't look like one");
  await expect(warning).toContainText('SEE NOTES BELOW');
  await expect(page.getByRole('dialog').getByTestId('import-skipped-rows')).toHaveCount(0);
});
