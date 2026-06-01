import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * E2E for the "Irish Sailing ECHO" source in the Update Handicaps dialog (#168).
 * Irish Sailing is the ECHO source (IRC TCCs come from the international IRC
 * list — see update-handicaps-irc-rating.spec.ts). The national ratings fetch
 * is stubbed from a fixture so the test is hermetic and never hits sailing.ie.
 */

const RATINGS_FIXTURE = {
  updatedAt: '28/05/2026 @ 14:51',
  records: [
    { sailNumber: 'IRL1431', boatName: '3 Cheers', ircTcc: 0.932, echo: 0.975 },
    { sailNumber: 'IRL1601', boatName: 'Antix', ircTcc: 1.041, echo: 1.05 },
  ],
};

test.beforeEach(async ({ page, signedInEmail }) => {
  // `echo` is now the single Irish/ECHO gate (scoring system + this dialog source).
  await enableFeatures(page, signedInEmail, ['echo']);
  // Stub the server fetch of the national ratings list.
  await page.route('**/api/v1/handicap-sources/irish-sailing', (route) =>
    route.fulfill({ json: RATINGS_FIXTURE }),
  );
});

test('Update handicaps from Irish Sailing seeds ECHO by sail number', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ECHO Import Test 2026' });

  // ECHO fleet in handicap mode.
  await createFleets(page, ['ECHO']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'ECHO' }).click();
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

  // Open the dialog and choose the Irish Sailing ECHO source.
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('Irish Sailing ECHO').click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Preview: exact match (IRL1431 → 0.975) and country-code-less match
  // (1601 ↔ IRL1601 → 1.05), the latter flagged for verification.
  await expect(page.getByText('Irish Sailing ratings as of 28/05/2026 @ 14:51')).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 0.975' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 1.050' })).toBeVisible();
  await expect(page.getByText('matched without country code → IRL1601')).toBeVisible();

  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('2 ECHO')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Persisted: the country-code-less boat now carries its ECHO handicap.
  const row = page.getByRole('row').filter({ hasText: '1601' });
  await row.click();
  await expect(page.getByLabel('ECHO starting handicap', { exact: true })).toHaveValue('1.05');
});

test('add a newly-rated boat to the ECHO fleet (#170)', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ECHO Add Test 2026' });

  // One scratch fleet + handicap mode; add the boat there (no ECHO fleet yet).
  await createFleets(page, ['White Sail']);
  await setScoringMode(page, 'handicap');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('IRL1431');
  await page.getByLabel('Competitor name').fill('3 Cheers');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'IRL1431' })).toBeVisible();

  // Now add an ECHO fleet — the boat is NOT a member of it.
  await createFleets(page, ['ECHO']);
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByTestId('fleet-row').filter({ hasText: 'ECHO' }).getByRole('combobox').click();
  await page.getByRole('option', { name: 'ECHO' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Open the dialog → Irish Sailing ECHO → the add-to-fleet section.
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('Irish Sailing ECHO').click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText('Add to handicap fleet')).toBeVisible();

  // Tick the candidate (target ECHO fleet auto-selected) and apply.
  await page.getByRole('checkbox').last().check();
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('1 added to a handicap fleet')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Persisted: now a member of the ECHO fleet with the seeded handicap.
  const compRow = page.getByRole('row').filter({ hasText: 'IRL1431' });
  await expect(compRow).toContainText('ECHO');
  await compRow.click();
  await expect(page.getByLabel('ECHO starting handicap', { exact: true })).toHaveValue('0.975');
});
