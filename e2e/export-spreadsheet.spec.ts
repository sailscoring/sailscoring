import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import readXlsxFile from 'read-excel-file/node';

import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures, openSeriesActionsMenu } from './helpers';

/**
 * E2E for Export to spreadsheet: a series goes out as an .xlsx workbook with
 * its inputs and its scored results. The series comes in from a real HYC
 * file, a handicap league with a scratch division, so the workbook has
 * ratings, times and discards to carry.
 */

const SAILWAVE_FIXTURE = join(
  process.cwd(),
  'tests/fixtures/sailwave/hyc-2026/2026 Tues Series 1.blw',
);

async function importHycSeries(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Series' }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('import-format-sailwave').click(),
  ]);
  await fileChooser.setFiles({
    name: '2026 Tues Series 1.blw',
    mimeType: 'application/octet-stream',
    buffer: readFileSync(SAILWAVE_FIXTURE),
  });
  await expect(page.getByRole('heading', { name: 'Import from Sailwave' })).toBeVisible();
  await page.getByTestId('sailwave-import-submit').click();
  await expect(page).toHaveURL(/\/series\/[^/]+\/competitors$/, { timeout: 15_000 });
}

test('export to spreadsheet: a workbook with the inputs and every scored result', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['sailwave-import', 'spreadsheet-export']);
  await importHycSeries(page);

  await openSeriesActionsMenu(page);
  const download = page.waitForEvent('download');
  await page.getByTestId('export-to-spreadsheet').click();
  const dl = await download;
  expect(dl.suggestedFilename()).toMatch(/\.xlsx$/);
  const chunks: Buffer[] = [];
  for await (const chunk of await dl.createReadStream()) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const sheets = await readXlsxFile(Buffer.concat(chunks));
  expect(sheets.map((s) => s.sheet)).toEqual(['About', 'Fleets', 'Competitors', 'Races', 'Finishes', 'Results', 'Standings']);
  const data = (name: string) => sheets.find((s) => s.sheet === name)!.data;

  // 29 boats, one row each, whichever fleets they sail in.
  expect(data('Competitors')).toHaveLength(1 + 29);

  // Every handicap finisher carries a rating and a corrected time.
  const [header, ...results] = data('Results');
  const col = (name: string) => (header as string[]).indexOf(name);
  expect(col('Corrected (s)')).toBeGreaterThan(-1);
  const corrected = results.filter((r) => typeof r[col('Corrected (s)')] === 'number');
  expect(corrected.length).toBeGreaterThan(0);
  expect(corrected.every((r) => typeof r[col('Rating applied')] === 'number')).toBe(true);
  // Whether each score is discarded is a true/false cell, not a bracket.
  expect(results.every((r) => typeof r[col('Discarded')] === 'boolean')).toBe(true);

  // The standings are the wide table: rank, totals and a column per race.
  const standingsHeader = data('Standings')[0] as string[];
  expect(standingsHeader).toEqual(expect.arrayContaining(['Fleet', 'Rank', 'Total', 'Net', 'R1']));
});

test('export to spreadsheet is not offered while the feature is off', async ({ page }) => {
  await createSeriesQuick(page, { name: 'No spreadsheet' });
  await openSeriesActionsMenu(page);
  await expect(page.getByRole('menuitem', { name: /Save to File/ })).toBeVisible();
  await expect(page.getByTestId('export-to-spreadsheet')).toHaveCount(0);
});
