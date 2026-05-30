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
    {
      sailNumber: 'IRL1601',
      boatName: 'Antix',
      ircTcc: 1.041,
      ircNonSpinTcc: 1.02,
      echo: 1.05,
    },
    // A boat holding a primary plus a secondary "(SC)" certificate.
    {
      sailNumber: 'IRL7404',
      boatName: 'Pretty Polly',
      ircCertNumber: '11479',
      ircTcc: 1.114,
      ircNonSpinTcc: 1.092,
      echo: 1.12,
    },
    {
      sailNumber: 'IRL7404',
      boatName: 'Pretty Polly (SC)',
      ircCertNumber: '50718',
      ircTcc: 1.092,
      ircNonSpinTcc: 1.071,
      echo: 1.12,
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

  // Three boats: exact match, country-code-less match (1601 ↔ IRL1601), and
  // one not on the list.
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sailNumber, name } of [
    { sailNumber: 'IRL1431', name: '3 Cheers' },
    { sailNumber: '1601', name: 'Antix' },
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

  // Preview: exact match (IRL1431 → 0.932) and country-code-less match
  // (1601 ↔ IRL1601 → 1.041), the latter flagged for verification.
  await expect(page.getByText('Irish Sailing ratings as of 28/05/2026 @ 14:51')).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 0.932' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 1.041' })).toBeVisible();
  await expect(page.getByText('matched without country code → IRL1601')).toBeVisible();

  // Switching to non-spinnaker re-proposes the other column.
  await page.getByRole('combobox').filter({ hasText: 'Spinnaker TCC' }).click();
  await page.getByRole('option', { name: 'Non-spinnaker TCC', exact: true }).click();
  await expect(page.getByRole('cell', { name: '— → 0.918' })).toBeVisible();

  // Back to spin and apply both.
  await page.getByRole('combobox').filter({ hasText: 'Non-spinnaker TCC' }).click();
  await page.getByRole('option', { name: 'Spinnaker TCC', exact: true }).click();
  await page.getByRole('button', { name: /^Apply/ }).click();

  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('2 IRC')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Persisted: the country-code-less boat now carries its TCC.
  const row = page.getByRole('row').filter({ hasText: '1601' });
  await row.click();
  await expect(page.getByLabel('IRC TCC', { exact: true })).toHaveValue('1.041');
});

test('primary/secondary certificate: defaults to higher TCC, switchable', async ({ page }) => {
  await createSeriesQuick(page, { name: 'IRC SC Test 2026' });

  await createFleets(page, ['IRC']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('IRL7404');
  await page.getByLabel('Competitor name').fill('Pretty Polly');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'IRL7404' })).toBeVisible();

  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('Irish Sailing certificates').click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Defaults to the higher TCC (primary 1.114, not secondary 1.092).
  await expect(page.getByRole('cell', { name: '— → 1.114' })).toBeVisible();

  // Switch to the secondary "(SC)" certificate.
  await page.getByLabel('Certificate').selectOption('cert:50718');
  await expect(page.getByRole('cell', { name: '— → 1.092' })).toBeVisible();

  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  const row = page.getByRole('row').filter({ hasText: 'IRL7404' });
  await row.click();
  await expect(page.getByLabel('IRC TCC', { exact: true })).toHaveValue('1.092');
});
