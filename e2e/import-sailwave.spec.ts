import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signedInTest as test, expect } from './fixtures';
import { enableFeatures } from './helpers';

/**
 * E2E for the Import Series → Sailwave file flow.
 *
 * Uses a real HYC Sailwave `.blw` file (helm/crew names anonymised) from
 * `tests/fixtures/sailwave/hyc-2026/`.
 */

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['sailwave-import']);
});

const SAILWAVE_FIXTURE = join(
  process.cwd(),
  'tests/fixtures/sailwave/hyc-2026/2026 Tues Series 1.blw',
);

test('import series: Sailwave .blw → wizard → new series, lands on Competitors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Series' })).toBeVisible();

  // Open the format-choice dialog and pick Sailwave.
  await page.getByRole('button', { name: 'Import Series' }).click();
  await expect(page.getByRole('dialog', { name: 'Import Series' })).toBeVisible();

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('import-format-sailwave').click(),
  ]);
  await fileChooser.setFiles({
    name: '2026 Tues Series 1.blw',
    mimeType: 'application/octet-stream',
    buffer: readFileSync(SAILWAVE_FIXTURE),
  });

  // Wizard loads with detected preview.
  await expect(page).toHaveURL(/\/series\/import-sailwave$/);
  await expect(page.getByRole('heading', { name: 'Import from Sailwave' })).toBeVisible();
  await expect(page.getByText('29 competitors')).toBeVisible();
  await expect(page.getByText('4 fleets')).toBeVisible();

  // Submit straight away — start date is no longer required; the wizard
  // uses Sailwave's per-race dates and falls back to today for un-dated ones.
  await page.getByTestId('sailwave-import-submit').click();

  // Lands on the Competitors tab.
  await expect(page).toHaveURL(/\/series\/[^/]+\/competitors$/, { timeout: 15_000 });

  // Confirm at least one imported competitor row renders (anonymised helm name).
  await expect(page.getByText('Garret Barry').first()).toBeVisible();
});

test('update from Sailwave: re-import in place replaces data and keeps the series', async ({ page }) => {
  // Import once to get a Sailwave-born series (source = 'sailwave').
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Series' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-format-sailwave').click();
  await (await chooser).setFiles({
    name: '2026 Tues Series 1.blw',
    mimeType: 'application/octet-stream',
    buffer: readFileSync(SAILWAVE_FIXTURE),
  });
  await page.getByTestId('sailwave-import-submit').click();
  await expect(page).toHaveURL(/\/series\/[^/]+\/competitors$/, { timeout: 15_000 });

  const seriesId = page.url().match(/\/series\/([^/]+)\/competitors/)![1];

  // The "Update from Sailwave file" affordance is offered in the series
  // actions menu for a Sailwave-born series.
  await page.getByRole('button', { name: 'Series actions' }).click();
  const updateButton = page.getByTestId('update-from-sailwave');
  await expect(updateButton).toBeVisible();

  // Re-import the same file over this series.
  const updateChooser = page.waitForEvent('filechooser');
  await updateButton.click();
  await (await updateChooser).setFiles({
    name: '2026 Tues Series 1.blw',
    mimeType: 'application/octet-stream',
    buffer: readFileSync(SAILWAVE_FIXTURE),
  });

  // The wizard runs in update mode: replace warning, no name field.
  await expect(page).toHaveURL(/\/series\/import-sailwave$/);
  await expect(page.getByRole('heading', { name: 'Update from Sailwave' })).toBeVisible();
  await expect(page.getByTestId('sailwave-update-warning')).toBeVisible();
  await expect(page.getByTestId('sailwave-name')).toHaveCount(0);

  // Submit lands back on this same series' Competitors tab (not a new series).
  await page.getByTestId('sailwave-import-submit').click();
  await expect(page).toHaveURL(new RegExp(`/series/${seriesId}/competitors$`), { timeout: 15_000 });
  await expect(page.getByText('Garret Barry').first()).toBeVisible();

  // No duplicate series was created — the home list still shows a single entry.
  await page.goto('/');
  await expect(page.getByText('Club Racing 2026', { exact: true })).toHaveCount(1);
});

test('import series: re-importing the same Sailwave file disambiguates the name', async ({ page }) => {
  // First import
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Series' }).click();
  let chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-format-sailwave').click();
  await (await chooser).setFiles({
    name: '2026 Tues Series 1.blw',
    mimeType: 'application/octet-stream',
    buffer: readFileSync(SAILWAVE_FIXTURE),
  });
  await page.getByTestId('sailwave-import-submit').click();
  await expect(page).toHaveURL(/\/series\/[^/]+\/competitors$/, { timeout: 15_000 });

  // Second import — same file, with a distinct name we can assert against.
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Series' }).click();
  chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-format-sailwave').click();
  await (await chooser).setFiles({
    name: '2026 Tues Series 1.blw',
    mimeType: 'application/octet-stream',
    buffer: readFileSync(SAILWAVE_FIXTURE),
  });
  await page.getByTestId('sailwave-name').fill('Club Racing 2026');
  await page.getByTestId('sailwave-import-submit').click();
  await expect(page).toHaveURL(/\/series\/[^/]+\/competitors$/, { timeout: 15_000 });

  // Back on the home list, two series should appear — one with " (2)" suffix.
  await page.goto('/');
  await expect(page.getByText('Club Racing 2026', { exact: true })).toBeVisible();
  await expect(page.getByText('Club Racing 2026 (2)', { exact: true })).toBeVisible();
});
