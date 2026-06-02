import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E for the "RYA Portsmouth Yardstick" source in the Update Handicaps dialog.
 * Unlike the IRC / Irish Sailing sources (matched by sail number, fetched live),
 * PY is matched by boat class against the bundled RYA list — so there is no
 * network stub. `rya-py` is on by default, so no feature flag is set here.
 */

test('Update handicaps from the RYA PY list sets numbers and normalises classes', async ({
  page,
}) => {
  await createSeriesQuick(page, { name: 'PY Import Test 2026' });

  // A single PY fleet in handicap mode.
  await createFleets(page, ['Handicap']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Enable the optional "Class" competitor field (off by default).
  await page.locator('h2', { hasText: 'Competitor fields' }).locator('..').getByRole('button').click();
  await page.locator('#field-boatClass').check();

  // Two classed boats: a "Laser" (resolves by alias to ILCA 7 / Laser, 1103)
  // and a "Firefly" (exact match, 1178). Numbers are seeded by the dialog.
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sail, name, klass } of [
    { sail: '210999', name: 'Quicksilver', klass: 'Laser' },
    { sail: '1234', name: 'Firefly One', klass: 'Firefly' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sail);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByLabel('Class', { exact: true }).fill(klass);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // Open the dialog and choose the RYA PY source.
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('RYA Portsmouth Yardstick').click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Preview: the Laser resolves to ILCA 7 / Laser (— → 1103), the Firefly to
  // 1178, and the provenance footer is shown.
  await expect(page.getByText('ILCA 7 / Laser')).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 1103' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 1178' })).toBeVisible();
  await expect(page.getByText(/RYA Portsmouth Number List 2026/)).toBeVisible();

  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Persisted: the Laser now carries the canonical class and the RYA number.
  const row = page.getByRole('row').filter({ hasText: '210999' });
  await row.click();
  await expect(page.getByLabel('PY number', { exact: true })).toHaveValue('1103');
  await expect(page.getByLabel('Class', { exact: true })).toHaveValue('ILCA 7 / Laser');
});
