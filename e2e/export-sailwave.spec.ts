import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signedInTest as test, expect } from './fixtures';
import { enableFeatures, openSeriesActionsMenu } from './helpers';
import { parseSailwaveBlw } from '@/lib/sailwave-import';

/**
 * E2E for Export to Sailwave: a series goes out as a `.blw` the importer
 * reads back, and anything Sailwave cannot carry is listed before the
 * download. The series comes in from a real HYC file so the export has
 * fleets, aliases, starts and results to write.
 */

const SAILWAVE_FIXTURE = join(
  process.cwd(),
  'tests/fixtures/sailwave/hyc-2026/2026 Tues Series 1.blw',
);

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['sailwave-import', 'sailwave-export', 'race-scoring-options']);
});

async function downloadBytes(download: Promise<import('@playwright/test').Download>): Promise<Buffer> {
  const dl = await download;
  expect(dl.suggestedFilename()).toMatch(/\.blw$/);
  const chunks: Buffer[] = [];
  for await (const chunk of await dl.createReadStream()) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

test('export to Sailwave: a .blw the importer reads back, with warnings shown first when needed', async ({ page }) => {
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

  // A club series carries clean: the download starts straight away.
  await openSeriesActionsMenu(page);
  const download = page.waitForEvent('download');
  await page.getByTestId('export-to-sailwave').click();
  const bytes = await downloadBytes(download);
  const raw = parseSailwaveBlw(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  expect(raw.globals?.serversion).toBe('2.38.02');
  const competitors = Object.values(raw.competitors ?? {});
  // 29 boats, each scored under HPH and Scratch: a primary plus an alias each.
  expect(competitors).toHaveLength(58);
  expect(competitors.filter((c) => c.compalias !== '0')).toHaveLength(29);
  expect(Object.keys(raw.races ?? {}).length).toBeGreaterThan(0);
  expect(Object.values(raw.results ?? {}).some((r) => r.rrestyp === '4' && r.rft)).toBe(true);

  // Make one race count double and never be discarded: two things Sailwave
  // cannot carry, so the export now says so before offering the file.
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1', { exact: false }).first().click();
  await page.getByTestId('race-scoring-options').click();
  const options = page.getByTestId('race-scoring-options-dialog');
  await options.getByRole('radio', { name: /Must count/ }).check();
  await options.getByLabel('Points multiplier').fill('2');
  await options.getByRole('button', { name: 'Save' }).click();
  await expect(options).toHaveCount(0);

  await openSeriesActionsMenu(page);
  await page.getByTestId('export-to-sailwave').click();
  const warnings = page.getByTestId('sailwave-export-warnings');
  await expect(warnings).toContainText('Race 1 must count');
  await expect(warnings).toContainText('points multiplier');
  const second = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download anyway' }).click();
  await downloadBytes(second);
  await expect(page.getByRole('dialog', { name: 'Export to Sailwave' })).toHaveCount(0);
});

test('Shift+S exports from any series tab', async ({ page }) => {
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
  await page.getByTestId('sailwave-import-submit').click();
  await expect(page).toHaveURL(/\/series\/[^/]+\/competitors$/, { timeout: 15_000 });

  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const download = page.waitForEvent('download');
  await page.keyboard.press('Shift+S');
  await downloadBytes(download);
});
