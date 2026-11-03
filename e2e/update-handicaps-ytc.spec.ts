import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * E2E for YTC: a fleet scored on YTC, seeded from the RORC's YTC listing in
 * the Update Handicaps dialog. The listing is stubbed so the test is hermetic
 * and never reaches the RORC's page or Google's sheet.
 */

const LISTING = {
  updatedAt: null,
  fetchedAt: '2026-11-03T12:00:00.000Z',
  records: [
    { sailNumber: 'IRL3062', boatName: 'CROZZ', boatType: 'ELAN 31 1.85', ytc: 941, ytcWhiteSail: 965, provisional: false, issueDate: '2026-08-13' },
    { sailNumber: 'GBR8812', boatName: 'QUICKSILVER', boatType: 'J/99', ytc: 861, ytcWhiteSail: 880, provisional: true, issueDate: '2026-05-02' },
  ],
};

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['ytc']);
  await page.route('**/api/v1/handicap-sources/ytc-rating', (route) =>
    route.fulfill({ json: LISTING }),
  );
});

test('Update handicaps from the YTC listing seeds each boat\'s number, spinnaker or white sail', async ({ page }) => {
  await createSeriesQuick(page, { name: 'YTC Import Test 2026' });

  // A YTC fleet in handicap mode.
  await createFleets(page, ['Cruisers YTC']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'YTC', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Three boats: one listed, one listed on a provisional certificate, one not.
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sailNumber, name } of [
    { sailNumber: 'IRL3062', name: 'Gerry Daly' },
    { sailNumber: 'GBR8812', name: 'Visitor' },
    { sailNumber: 'IRL9999', name: 'Unlisted' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('YTC numbers', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Preview: the spinnaker number by default, and the provisional
  // certificate called out.
  await expect(page.getByText(/YTC listing fetched at/)).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 941' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 861' })).toBeVisible();
  await expect(page.getByText('provisional certificate')).toBeVisible();
  await expect(page.getByText('Preview: 2 changes, 0 unchanged, 1 not found')).toBeVisible();

  // A white-sail fleet takes the other number.
  await page.getByRole('combobox').filter({ hasText: 'Spinnaker' }).click();
  await page.getByRole('option', { name: 'White sail', exact: true }).click();
  await expect(page.getByRole('cell', { name: '— → 965' })).toBeVisible();

  // Back to spinnaker and apply.
  await page.getByRole('combobox').filter({ hasText: 'White sail' }).click();
  await page.getByRole('option', { name: 'Spinnaker', exact: true }).click();
  await expect(page.getByRole('cell', { name: '— → 941' })).toBeVisible();
  await page.getByRole('button', { name: /^Apply/ }).click();

  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('2 YTC')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Persisted: the boat now carries the number off its certificate.
  await page.getByRole('row').filter({ hasText: 'IRL3062' }).click();
  await expect(page.getByLabel('YTC number', { exact: true })).toHaveValue('941');
});
