import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * E2E for the "VPRS TCC" source in the Update Handicaps dialog (#175). The club
 * index and the selected club's listing are both stubbed from fixtures so the
 * test is hermetic and never hits vprs.org.
 */

const CLUBS = {
  clubs: [
    { id: 'dublin_bay_ratings_2026', name: 'Dublin Bay Sailing Club', region: 'Ireland', url: 'https://vprs.org/dublin_bay_ratings_2026.html' },
    { id: 'pyra_ratings_2026', name: 'PYRA (Poole Yacht Racing Association)', region: 'Poole Harbour', url: 'https://vprs.org/pyra_ratings_2026.html' },
  ],
};

const DBSC_RATINGS = {
  updatedAt: '03/05/2026',
  records: [
    { sailNumber: 'IRL1367', boatName: 'Boomerang', vprsTcc: 0.992, vprsNonSpinTcc: 0.945 },
    { sailNumber: 'IRL1725', boatName: 'Optique', vprsTcc: 1.003, vprsNonSpinTcc: 0.954 },
  ],
};

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['vprs']);
  // The club index, and the per-club listing (any ?club= query).
  await page.route('**/api/v1/handicap-sources/vprs-rating/clubs', (route) =>
    route.fulfill({ json: CLUBS }),
  );
  await page.route(/\/api\/v1\/handicap-sources\/vprs-rating\?club=/, (route) =>
    route.fulfill({ json: DBSC_RATINGS }),
  );
});

test('Update handicaps from a VPRS club seeds TCC by sail number, with spin/non-spin', async ({ page }) => {
  await createSeriesQuick(page, { name: 'VPRS Import Test 2026' });

  // VPRS fleet in handicap mode.
  await createFleets(page, ['VPRS']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'VPRS' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Two boats: one on the club list, one not.
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sailNumber, name } of [
    { sailNumber: 'IRL1367', name: 'Boomerang' },
    { sailNumber: 'IRL9999', name: 'Unlisted' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }

  // Open the dialog and choose the VPRS source.
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('VPRS TCC', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Pick the club (Dublin Bay leads — Irish clubs first on an IRL setup).
  await page.getByRole('combobox').filter({ hasText: /Pick a club/ }).click();
  await page.getByRole('option', { name: 'Dublin Bay Sailing Club' }).click();

  // Preview: the listed boat gets its spinnaker TCC.
  await expect(page.getByText('VPRS ratings as of 03/05/2026')).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 0.992' })).toBeVisible();

  // Switching the fleet to no-spinnaker re-proposes the other column.
  await page.getByRole('combobox').filter({ hasText: 'Spinnaker TCC' }).click();
  await page.getByRole('option', { name: 'No-spinnaker TCC', exact: true }).click();
  await expect(page.getByRole('cell', { name: '— → 0.945' })).toBeVisible();

  // Back to spin and apply.
  await page.getByRole('combobox').filter({ hasText: 'No-spinnaker TCC' }).click();
  await page.getByRole('option', { name: 'Spinnaker TCC', exact: true }).click();
  await page.getByRole('button', { name: /^Apply/ }).click();

  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('1 VPRS')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Persisted: the listed boat now carries its VPRS TCC.
  const row = page.getByRole('row').filter({ hasText: 'IRL1367' });
  await row.click();
  await expect(page.getByLabel('VPRS TCC', { exact: true })).toHaveValue('0.992');
});
