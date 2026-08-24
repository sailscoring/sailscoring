import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * E2E for ORC certificate import and scoring — APHT time-on-time and
 * windward/leeward Performance Curve Scoring. The ORC database fetch is
 * stubbed from the boats' real 2026 IRL certificates (the AL 2025 report's
 * Class 2 boats — Impetuous APHT 0.9631, Mojo 1.0089 — complete with their
 * time-allowance matrices, which PCS needs).
 *
 * ORC is a gated, opt-in feature, so the workspace enables it first.
 */

const SAMPLE = JSON.parse(
  readFileSync(join(__dirname, '../tests/fixtures/orc/downrms-irl-sample.json'), 'utf-8').replace(/^﻿/, ''),
) as { rms: Array<Record<string, unknown>> };

function cert(yachtName: string) {
  const record = SAMPLE.rms.find((r) => r.YachtName === yachtName);
  if (!record) throw new Error(`no fixture certificate for ${yachtName}`);
  return { record, expiryDate: '2026-12-31T00:00:00.000Z', vppYear: 2026 };
}

const LISTING_FIXTURE = {
  updatedAt: '19/08/2026',
  countryId: 'IRL',
  family: 'ORC',
  records: [cert('IMPETUOUS'), cert('MOJO')],
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
  // Mojo's certificate registers the hyphenated form of its sail number.
  await expect(page.getByText('matched without country code → IRL-1551')).toBeVisible();

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

test('ORC fleet: performance curve scoring over the W/L model', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ORC PCS Test 2026' });
  await setUpOrcFleet(page, [
    { sailNumber: 'IRL 2507', name: 'Impetuous' },
    { sailNumber: 'IRL 1551', name: 'Mojo' },
  ]);

  // Windward/leeward performance-curve scoring.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: 'All-purpose · time-on-time' }).click();
  await page.getByRole('option', { name: 'Windward/leeward · performance curve (PCS)' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  await importCertificates(page, 2);

  // A 3.9 NM W/L race, start 14:00:00. From the boats' performance curves:
  // Mojo's implied wind 7.70 kt is the scoring wind; corrected times
  // Mojo 3390 (scratch — its elapsed), Impetuous 3402 — Mojo wins.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByLabel(/Course length/).fill('3.9');
  // The PCS-only scoring-wind override field is offered (and left blank).
  await expect(page.getByLabel(/Scoring wind/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Class 2' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  for (const { sailNumber, finishTime } of [
    { sailNumber: 'IRL 1551', finishTime: '14:56:30' },
    { sailNumber: 'IRL 2507', finishTime: '14:58:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('IRL 1551');
  await expect(page.getByRole('row').nth(2)).toContainText('IRL 2507');
});

test('ORC fleet: time-on-distance over the start course length', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ORC ToD Test 2026' });
  await setUpOrcFleet(page, [
    { sailNumber: 'IRL 2507', name: 'Impetuous' },
    { sailNumber: 'IRL 1551', name: 'Mojo' },
  ]);

  // Switch the fleet's rating option to all-purpose time-on-distance (APHD).
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: 'All-purpose · time-on-time' }).click();
  await page.getByRole('option', { name: 'All-purpose · time-on-distance (APHD)' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  await importCertificates(page, 2);

  // A 3.24 NM course, start 15:15:00 (the 16-orc-aphd-tod fixture numbers):
  //   Mojo (APHD 594.7, scratch) ET 2151 → CT 2151
  //   Impetuous (APHD 623.0)     ET 2209 → CT 2209 − 28.3 × 3.24 = 2117 — wins.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('15:15:00');
  await page.getByLabel(/Course length/).fill('3.24');
  await page.getByRole('checkbox', { name: 'Class 2' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('15:15:00')).toBeVisible();
  await expect(page.getByText('3.24 NM')).toBeVisible();

  for (const { sailNumber, finishTime } of [
    { sailNumber: 'IRL 1551', finishTime: '15:50:51' },
    { sailNumber: 'IRL 2507', finishTime: '15:51:49' },
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
