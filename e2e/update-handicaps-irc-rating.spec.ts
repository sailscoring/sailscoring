import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * E2E for the "IRC TCC (international)" source in the Update Handicaps dialog
 * (#168 follow-up). The worldwide IRC rating fetch is stubbed from a fixture so
 * the test is hermetic and never hits the live listing.
 */

const RATINGS_FIXTURE = {
  updatedAt: '30/05/2026',
  records: [
    { sailNumber: 'IRL1431', boatName: '3 Cheers', ircTcc: 0.932, ircNonSpinTcc: 0.918, isSecondary: false },
    { sailNumber: 'IRL1601', boatName: 'Antix', ircTcc: 1.041, ircNonSpinTcc: 1.02, isSecondary: false },
    // A boat holding a primary plus a secondary (SEC) certificate.
    { sailNumber: 'IRL7404', boatName: 'Pretty Polly', ircCertNumber: '11479', ircTcc: 1.114, ircNonSpinTcc: 1.092, isSecondary: false },
    { sailNumber: 'IRL7404', boatName: 'Pretty Polly - SEC', ircCertNumber: '50718', ircTcc: 1.092, ircNonSpinTcc: 1.071, isSecondary: true },
  ],
};

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['irc-rating']);
  // Stub the server fetch of the worldwide IRC list.
  await page.route('**/api/v1/handicap-sources/irc-rating', (route) =>
    route.fulfill({ json: RATINGS_FIXTURE }),
  );
});

test('Update handicaps from IRC ratings seeds IRC TCC by sail number', async ({ page }) => {
  await createSeriesQuick(page, { name: 'IRC Intl Import Test 2026' });

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

  // Open the dialog and choose the international IRC source.
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('IRC TCC (international)').click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Preview: exact match (IRL1431 → 0.932) and country-code-less match
  // (1601 ↔ IRL1601 → 1.041), the latter flagged for verification.
  await expect(page.getByText('IRC ratings as of 30/05/2026')).toBeVisible();
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
  await createSeriesQuick(page, { name: 'IRC Intl SC Test 2026' });

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
  await page.getByText('IRC TCC (international)').click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Defaults to the higher TCC (primary 1.114, not secondary 1.092).
  await expect(page.getByRole('cell', { name: '— → 1.114' })).toBeVisible();

  // Switch to the secondary (SEC) certificate.
  await page.getByLabel('Certificate').selectOption('cert:50718');
  await expect(page.getByRole('cell', { name: '— → 1.092' })).toBeVisible();

  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  const row = page.getByRole('row').filter({ hasText: 'IRL7404' });
  await row.click();
  await expect(page.getByLabel('IRC TCC', { exact: true })).toHaveValue('1.092');
});

test('add a newly-rated boat to the IRC fleet (#170)', async ({ page }) => {
  await createSeriesQuick(page, { name: 'IRC Intl Add Test 2026' });

  // One scratch fleet + handicap mode; add the boat there (no IRC fleet yet).
  await createFleets(page, ['White Sail']);
  await setScoringMode(page, 'handicap');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('IRL1431');
  await page.getByLabel('Competitor name').fill('3 Cheers');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'IRL1431' })).toBeVisible();

  // Now add an IRC fleet — the boat is NOT a member of it.
  await createFleets(page, ['IRC']);
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByTestId('fleet-row').filter({ hasText: 'IRC' }).getByRole('combobox').click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // A sailed race, so the DNC caution applies.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  // Open the dialog → IRC ratings → the add-to-fleet section.
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('IRC TCC (international)').click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText('Add to handicap fleet')).toBeVisible();
  await expect(
    page.getByText('Boats added here are scored DNC for races already sailed'),
  ).toBeVisible();

  // Tick the candidate (target IRC fleet auto-selected) and apply.
  await page.getByRole('checkbox').last().check();
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('1 added to a handicap fleet')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Persisted: now a member of the IRC fleet (Fleet column) with the seeded TCC.
  const compRow = page.getByRole('row').filter({ hasText: 'IRL1431' });
  await expect(compRow).toContainText('IRC');
  await compRow.click();
  await expect(page.getByLabel('IRC TCC', { exact: true })).toHaveValue('0.932');
});
