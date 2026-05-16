import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signedInTest as test, expect } from './fixtures';

/**
 * E2E for the Import Series → Sailwave export flow.
 *
 * Uses a real reference file from `reference/data/2026-hyc-club-racing/`.
 * That file ships with the repo and is the same one the Python reference
 * script in `reference/data/2026-hyc-club-racing/sailwave-to-sailscoring.py`
 * has been run against.
 */

const SAILWAVE_FIXTURE = join(
  process.cwd(),
  'reference/data/2026-hyc-club-racing/2026 Tues Series 1.json',
);

test('import series: Sailwave .json → wizard → new series with detected fleets and competitors', async ({ page }) => {
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
    name: '2026 Tues Series 1.json',
    mimeType: 'application/json',
    buffer: readFileSync(SAILWAVE_FIXTURE),
  });

  // Wizard loads with detected preview.
  await expect(page).toHaveURL(/\/series\/import-sailwave$/);
  await expect(page.getByRole('heading', { name: 'Import from Sailwave' })).toBeVisible();
  await expect(page.getByText('29 competitors')).toBeVisible();
  await expect(page.getByText('4 fleets')).toBeVisible();

  // Set the required start date and Tuesday cadence.
  await page.getByTestId('sailwave-start-date').fill('2026-05-05');
  await page.getByTestId('sailwave-day-tue').click();

  // Submit. Lands on the new series's races page.
  await page.getByTestId('sailwave-import-submit').click();
  await expect(page).toHaveURL(/\/series\/[^/]+\/races$/, { timeout: 15_000 });

  // Confirm at least one race row from the imported schedule renders.
  // The Tuesday cadence puts the first race on 2026-05-05.
  await expect(page.getByText('2026-05-05').first()).toBeVisible();
});

test('import series: re-importing the same Sailwave file disambiguates the name', async ({ page }) => {
  // First import
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Series' }).click();
  let chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-format-sailwave').click();
  await (await chooser).setFiles({
    name: '2026 Tues Series 1.json',
    mimeType: 'application/json',
    buffer: readFileSync(SAILWAVE_FIXTURE),
  });
  await page.getByTestId('sailwave-start-date').fill('2026-05-05');
  await page.getByTestId('sailwave-import-submit').click();
  await expect(page).toHaveURL(/\/series\/[^/]+\/races$/, { timeout: 15_000 });

  // Second import — same file
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Series' }).click();
  chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-format-sailwave').click();
  await (await chooser).setFiles({
    name: '2026 Tues Series 1.json',
    mimeType: 'application/json',
    buffer: readFileSync(SAILWAVE_FIXTURE),
  });
  await page.getByTestId('sailwave-start-date').fill('2026-05-05');
  // Use a distinct name so we can assert the disambiguated form below.
  await page.getByTestId('sailwave-name').fill('Club Racing 2026');
  await page.getByTestId('sailwave-import-submit').click();
  await expect(page).toHaveURL(/\/series\/[^/]+\/races$/, { timeout: 15_000 });

  // Back on the home list, two series should appear — one with " (2)" suffix.
  await page.goto('/');
  await expect(page.getByText('Club Racing 2026', { exact: true })).toBeVisible();
  await expect(page.getByText('Club Racing 2026 (2)', { exact: true })).toBeVisible();
});
