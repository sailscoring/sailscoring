import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, downloadFleetHtml } from './helpers';

/**
 * E2E coverage for competitor nationality (#142). Exercises the
 * Settings toggle, form input, CSV import auto-detect, and HTML export
 * — including flag <symbol>/<use> dedup so the published file isn't
 * 200 copies of the same SVG for a same-country fleet.
 */

function csvBuffer(content: string) {
  return { name: 'competitors.csv', mimeType: 'text/csv', buffer: Buffer.from(content) };
}

async function uploadCsv(page: import('@playwright/test').Page, content: string) {
  await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles(csvBuffer(content));
}

async function enableNationality(page: import('@playwright/test').Page) {
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('checkbox', { name: 'Nationality' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
}

test('nationality: form add, Settings toggle, and table column visibility', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Worlds 2026' });
  await enableNationality(page);

  // Form: the input accepts IRL and survives a round-trip.
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('IRL-7');
  await page.getByLabel('Competitor name').fill('Skipper');
  await page.getByLabel('Nationality').fill('irl');
  // The hint identifies the canonical record by English name.
  await expect(page.getByText('Ireland', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  // Table: Nat column visible, IRL cell visible.
  await expect(page.getByRole('columnheader', { name: 'Nat' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL' }).first()).toBeVisible();

  // Settings: turning the toggle off hides the column without touching the data.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('checkbox', { name: 'Nationality' }).uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('columnheader', { name: 'Nat' })).toHaveCount(0);
});

test('nationality: CSV import auto-detects nat column and enables the field', async ({ page }) => {
  await createSeriesQuick(page, { name: 'IODAI Nationals' });
  await page.getByRole('link', { name: 'Competitors' }).click();

  // Three boats: two IRL, one GBR. The `nat` header is the IODAI reference
  // spelling — it must auto-detect to nationality despite containing "na…".
  const csv =
    'sail_no,name,club,nat\n' +
    '7,Alice,HYC,IRL\n' +
    '42,Bob,RIYC,IRL\n' +
    '99,Charlie,RTYC,GBR\n';
  await uploadCsv(page, csv);

  // Mapping wizard is open; run the import.
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Import 3 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Nat column appears (field auto-enabled by the import) with the codes.
  await expect(page.getByRole('columnheader', { name: 'Nat' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'GBR' }).first()).toBeVisible();
});

test('nationality: HTML export contains the Nat column and deduped flag <symbol>s', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Flag Export Test' });
  await enableNationality(page);

  // Two IRL boats — the export must emit ONE <symbol id="flag-IRL"> shared by both rows.
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sail, name } of [
    { sail: '1', name: 'Alpha' },
    { sail: '2', name: 'Bravo' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sail);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByLabel('Nationality').fill('IRL');
    await page.getByRole('button', { name: 'Save' }).click();
  }

  // Race so a standings export is available.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Sail number').fill('2');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Preview → Download.
  await page.getByRole('link', { name: 'Standings' }).click();
  const download = await downloadFleetHtml(page);
  const path = await download.path();
  const fs = await import('node:fs');
  const html = fs.readFileSync(path, 'utf-8');

  // Nat column header is present.
  expect(html).toContain('<th>Nationality</th>');
  // The Irish flag definition exists EXACTLY once across the whole document
  // even though two boats reference it (dedup via <use href="#flag-IRL">).
  expect(html.match(/<symbol id="flag-IRL"/g)?.length).toBe(1);
  // Both rows reference the symbol — two summary cells + two race cells.
  expect((html.match(/<use href="#flag-IRL"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  // The code itself appears below the flag, in its own nattext span.
  expect(html).toContain('>IRL</span></td>');
});
