import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * E2E for the "Irish Sailing certificates" source in the Update Handicaps
 * dialog (#168). The national ratings fetch is stubbed from a fixture so the
 * test is hermetic and never hits sailing.ie.
 */

const RATINGS_FIXTURE = {
  updatedAt: '28/05/2026 @ 14:51',
  records: [
    {
      sailNumber: 'IRL1431',
      boatName: '3 Cheers',
      ircTcc: 0.932,
      ircNonSpinTcc: 0.918,
      echo: 0.975,
    },
  ],
};

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['irish-sailing-ratings']);
  // Stub the server fetch of the national ratings list.
  await page.route('**/api/v1/handicap-sources/irish-sailing', (route) =>
    route.fulfill({ json: RATINGS_FIXTURE }),
  );
});

test('Update handicaps from Irish Sailing seeds IRC TCC by sail number', async ({ page }) => {
  await createSeriesQuick(page, { name: 'IRC Import Test 2026' });

  // IRC fleet in handicap mode.
  await createFleets(page, ['IRC']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Two boats: one on the Irish Sailing list, one not.
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sailNumber, name } of [
    { sailNumber: 'IRL1431', name: '3 Cheers' },
    { sailNumber: 'IRL9999', name: 'Unlisted' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }

  // Open the dialog and choose the Irish Sailing source.
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('Irish Sailing certificates').click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Preview: IRL1431 gets the spin TCC; provenance stamp is shown.
  await expect(page.getByText('Irish Sailing ratings as of 28/05/2026 @ 14:51')).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 0.932' })).toBeVisible();

  // Switching to non-spinnaker re-proposes the other column.
  await page.getByRole('combobox').filter({ hasText: 'Spinnaker TCC' }).click();
  await page.getByRole('option', { name: 'Non-spinnaker TCC', exact: true }).click();
  await expect(page.getByRole('cell', { name: '— → 0.918' })).toBeVisible();

  // Back to spin and apply.
  await page.getByRole('combobox').filter({ hasText: 'Non-spinnaker TCC' }).click();
  await page.getByRole('option', { name: 'Spinnaker TCC', exact: true }).click();
  await page.getByRole('button', { name: /^Apply/ }).click();

  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('1 IRC')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Persisted: IRL1431 now carries 0.932.
  const row = page.getByRole('row').filter({ hasText: 'IRL1431' });
  await row.hover();
  await row.getByRole('button', { name: /Edit/ }).click();
  await expect(page.getByLabel('IRC TCC', { exact: true })).toHaveValue('0.932');
});
