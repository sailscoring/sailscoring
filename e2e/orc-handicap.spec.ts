import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * E2E for ORC certificate import and APHT time-on-time scoring. The ORC
 * database fetch is stubbed from a fixture so the test is hermetic. APHT
 * values are the boats' real 2026 IRL certificates (the AL 2025 report's
 * Class 2 boats): Impetuous 0.9631, Mojo 1.0089.
 *
 * ORC is a gated, opt-in feature, so the workspace enables it first.
 */

function cert(
  sailNo: string,
  yachtName: string,
  refNo: string,
  fields: Record<string, number>,
) {
  return {
    record: {
      SailNo: sailNo,
      YachtName: yachtName,
      RefNo: refNo,
      CertNo: refNo,
      C_Type: 'CLUB',
      Family: 'ORC',
      IssueDate: '2026-03-01T00:00:00.000Z',
      ...fields,
    },
    expiryDate: '2026-12-31T00:00:00.000Z',
    vppYear: 2026,
  };
}

const LISTING_FIXTURE = {
  updatedAt: '19/08/2026',
  countryId: 'IRL',
  family: 'ORC',
  records: [
    cert('IRL 2507', 'IMPETUOUS', '051800048LU', { APHT: 0.9631, APHD: 623.0, CDL: 6.989, GPH: 675.4 }),
    cert('IRL 1551', 'MOJO', '051800048F1', { APHT: 1.0089, APHD: 594.7, CDL: 7.125, GPH: 645.2 }),
  ],
  scoringOptions: [],
};

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['orc']);
  // Stub the server fetch of the ORC active-certificates listing.
  await page.route('**/api/v1/handicap-sources/orc?*', (route) =>
    route.fulfill({ json: LISTING_FIXTURE }),
  );
});

/** Create an ORC-scored fleet and the given boats. */
async function setUpOrcFleet(
  page: import('@playwright/test').Page,
  boats: { sailNumber: string; name: string }[],
) {
  await createFleets(page, ['Class 2']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'ORC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }
}

/** Run the Update-handicaps ORC source and apply everything it proposes. */
async function importCertificates(page: import('@playwright/test').Page, expected: number) {
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('ORC certificates', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('ORC certificates as of 19/08/2026')).toBeVisible();
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText(`${expected} ORC`)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
}

test('import seeds whole certificates by sail number', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ORC Import Test 2026' });
  // Exact match, country-code-less match (1551 ↔ IRL 1551), and one unlisted.
  await setUpOrcFleet(page, [
    { sailNumber: 'IRL 2507', name: 'Impetuous' },
    { sailNumber: '1551', name: 'Mojo' },
    { sailNumber: 'IRL9999', name: 'Unlisted' },
  ]);

  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('ORC certificates', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // The issuing-country control defaults to the instance's country.
  await expect(page.getByLabel('Issuing country')).toHaveValue('IRL');
  // Preview shows the fleet's time-on-time rating (APHT default) as the delta,
  // with the prefix-less match flagged for verification.
  await expect(page.getByText('ORC certificates as of 19/08/2026')).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 0.9631' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 1.0089' })).toBeVisible();
  await expect(page.getByText('matched without country code → IRL 1551')).toBeVisible();

  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('2 ORC')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // The class-division columns render the certificate numbers.
  await expect(page.getByRole('columnheader', { name: 'CDL' })).toBeVisible();
  const impRow = page.getByRole('row').filter({ hasText: 'IRL 2507' });
  await expect(impRow).toContainText('6.989');
  await expect(impRow).toContainText('0.9631');

  // The edit dialog shows the stored certificate, read-only, with its
  // reference number linked to the printable ORC page.
  await impRow.click();
  await expect(page.getByText('ORC certificate', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '051800048LU' })).toBeVisible();
  await expect(page.getByText(/APHT 0\.9631/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('ORC fleet: standings ordered by APHT corrected time', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ORC Scoring Test 2026' });
  await setUpOrcFleet(page, [
    { sailNumber: 'IRL 2507', name: 'Impetuous' },
    { sailNumber: 'IRL 1551', name: 'Mojo' },
  ]);
  await importCertificates(page, 2);

  // A race started at 14:00:00. Mojo crosses two minutes ahead:
  //   Mojo      ET 3480 × 1.0089 → CT 3511
  //   Impetuous ET 3600 × 0.9631 → CT 3467 — wins on corrected time.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'Class 2' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  for (const { sailNumber, finishTime } of [
    { sailNumber: 'IRL 1551', finishTime: '14:58:00' },
    { sailNumber: 'IRL 2507', finishTime: '15:00:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('IRL 2507');
  await expect(page.getByRole('row').nth(2)).toContainText('IRL 1551');
});
