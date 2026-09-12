import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, downloadFleetHtml, enableFeatures, setScoringMode } from './helpers';

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

/** Mojo's non-spinnaker certificate: a separate issue, at its own rating.
 *  Impetuous holds no non-spinnaker certificate. */
function nsListing() {
  const mojo = cert('MOJO');
  return {
    ...LISTING_FIXTURE,
    family: 'NS',
    records: [
      {
        ...mojo,
        record: { ...mojo.record, RefNo: '051800051NS', Family: 'NS', APHT: 0.9712 },
      },
    ],
  };
}

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['orc']);
  // Stub the server fetch of the ORC active-certificates listing, per family.
  await page.route('**/api/v1/handicap-sources/orc?*', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.get('family') === 'NS'
        ? nsListing()
        : LISTING_FIXTURE,
    }),
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

  // The listing carries the one rating a scorer reads — the fleet's — and not
  // the class-division numbers beside it.
  await expect(page.getByRole('columnheader', { name: 'CDL' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'GPH' })).toHaveCount(0);
  const impRow = page.getByRole('row').filter({ hasText: 'IRL 2507' });
  await expect(impRow).toContainText('0.9631');

  // The edit dialog shows the stored certificate, read-only, with its
  // reference number linked to the printable ORC page — and the class-division
  // numbers, which are read per boat rather than scanned down a table.
  await impRow.click();
  await expect(page.getByText('ORC certificate', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '051800048LU' })).toBeVisible();
  await expect(page.getByText(/APHT 0\.9631/)).toBeVisible();
  await expect(page.getByText(/CDL 6\.989/)).toBeVisible();
  await expect(page.getByText(/GPH /)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('non-spinnaker fleet: a boat with no NS certificate gets its standard one', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ORC Non-Spin Test 2026' });
  await setUpOrcFleet(page, [
    { sailNumber: 'IRL 2507', name: 'Impetuous' },
    { sailNumber: 'IRL 1551', name: 'Mojo' },
  ]);

  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('ORC certificates', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('ORC certificates as of 19/08/2026')).toBeVisible();

  // Race the fleet under non-spinnaker certificates.
  await page.getByRole('combobox').filter({ hasText: 'Standard (fully crewed)' }).click();
  await page.getByRole('option', { name: 'Non-spinnaker' }).click();

  // Mojo holds one; Impetuous doesn't, and is rated off its standard
  // certificate instead — said once above the table and marked on the row.
  await expect(
    page.getByText('1 boat holds no certificate in its fleet’s family'),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 0.9712' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 0.9631' })).toBeVisible();
  const impRow = page.getByRole('row').filter({ hasText: 'IRL 2507' });
  await expect(impRow).toContainText('ORC (standard cert)');
  await expect(page.getByRole('row').filter({ hasText: 'IRL 1551' })).not.toContainText('standard cert');
  // Neither boat is offered for removal — both hold a certificate.
  await expect(page.getByText('Not on the rating list')).toHaveCount(0);

  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('2 ORC')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('row').filter({ hasText: 'IRL 1551' })).toContainText('0.9712');
  await expect(page.getByRole('row').filter({ hasText: 'IRL 2507' })).toContainText('0.9631');
});

test('add to fleet: both divisions are offered, and the fleet picks the certificate', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ORC Add Test 2026' });

  // A scratch entry fleet holding the boat, so it starts in no ORC fleet.
  await createFleets(page, ['Entries']);
  await setScoringMode(page, 'handicap');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('IRL 1551');
  await page.getByLabel('Competitor name').fill('Mojo');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'IRL 1551' })).toBeVisible();

  // Two ORC divisions: a spinnaker class and a non-spinnaker one.
  await createFleets(page, ['Class 2', 'Non-Spin']);
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  for (const name of ['Class 2', 'Non-Spin']) {
    await page.getByTestId('fleet-row').filter({ hasText: name }).getByRole('combobox').click();
    await page.getByRole('option', { name: 'ORC' }).click();
  }
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('ORC certificates', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Race the non-spinnaker division under non-spinnaker certificates.
  const familyCard = page.getByText('Certificate family per fleet').locator('..');
  await familyCard.locator('div').filter({ hasText: /^Non-Spin/ }).getByRole('combobox').click();
  await page.getByRole('option', { name: 'Non-spinnaker' }).click();

  // Mojo holds both certificates, so either division could have it — both are
  // on offer, and the spinnaker class is the default with its standard rating.
  await expect(page.getByText('Add to handicap fleet')).toBeVisible();
  const target = page.getByLabel('Target fleet');
  await expect(target.locator('option')).toHaveText(['Class 2', 'Non-Spin']);
  await expect(target).toHaveValue(/.+/);
  const addRow = page.getByRole('row').filter({ hasText: 'IRL 1551' });
  await expect(addRow).toContainText('1.0089');

  // Choosing the non-spinnaker division seeds its non-spinnaker certificate.
  await target.selectOption({ label: 'Non-Spin' });
  await expect(addRow).toContainText('0.9712');

  const addSection = page.getByText('Add to handicap fleet').locator('..');
  await addSection.getByRole('checkbox', { name: /Add IRL 1551/ }).check();
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('1 added to a handicap fleet')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  const compRow = page.getByRole('row').filter({ hasText: 'IRL 1551' });
  await expect(compRow).toContainText('Non-Spin');
  await expect(compRow).toContainText('0.9712');
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
  await page.getByPlaceholder('14:05', { exact: true }).fill('14:00:00');
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
  await page.getByPlaceholder('14:05', { exact: true }).fill('14:00:00');
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

test('ORC fleet: PCS over a constructed course entered leg by leg', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ORC CC Test 2026' });
  await setUpOrcFleet(page, [
    { sailNumber: 'IRL 2507', name: 'Impetuous' },
    { sailNumber: 'IRL 1551', name: 'Mojo' },
  ]);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: 'All-purpose · time-on-time' }).click();
  await page.getByRole('option', { name: 'Constructed course · performance curve (PCS)' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // The stored selection survives a server round-trip: the profile comes
  // back from jsonb (which re-orders object keys), and the picker must
  // still display it rather than rendering empty.
  await page.reload();
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await expect(
    page.getByRole('combobox').filter({ hasText: 'Constructed course · performance curve (PCS)' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  await importCertificates(page, 2);

  // The ORC Race Management Guide's sample constructed course (8.11 NM),
  // start 14:00:00. From the boats' curves: Impetuous implied wind 18.06 kt
  // (the scoring wind), corrected 5009 vs Mojo 5190 — Impetuous wins on
  // corrected time despite crossing well behind.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05', { exact: true }).fill('14:00:00');

  const legs: Array<[string, string, string]> = [
    ['2.09', '162', '160'],
    ['0.06', '60', '155'],
    ['1.91', '340', '155'],
    ['1.89', '161', '160'],
    ['0.06', '60', '160'],
    ['1.91', '340', '160'],
    ['0.19', '316', '160'],
  ];
  for (let i = 0; i < legs.length; i++) {
    await page.getByRole('button', { name: 'Add leg' }).click();
    const [distance, bearing, wind] = legs[i];
    await page.getByLabel(`Leg ${i + 1} distance`).fill(distance);
    await page.getByLabel(`Leg ${i + 1} bearing`).fill(bearing);
    await page.getByLabel(`Leg ${i + 1} wind direction`).fill(wind);
  }
  await expect(page.getByText('8.11 NM total')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Class 2' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('8.11 NM · 7 legs')).toBeVisible();

  for (const { sailNumber, finishTime } of [
    { sailNumber: 'IRL 1551', finishTime: '15:26:30' },
    { sailNumber: 'IRL 2507', finishTime: '15:28:11' },
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

  // The published page carries the full audit trail: how the corrected
  // times were arrived at, and the course record itself.
  const download = await downloadFleetHtml(page);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString('utf-8');
  expect(html).toContain('Scored on ORC performance curves');
  expect(html).toContain('Constructed course');
  expect(html).toContain('8.11 NM');
  expect(html).toContain("Scoring wind 18.06 kt (winner's implied wind)");
  expect(html).toContain('<th>Implied wind</th>');
  expect(html).toContain('Legs: 2.09 NM @ 162&deg; (wind 160&deg;)');

  // And, folded away beside the course, what that course bought off the
  // certificate: its own allowance table, every row and column of it, with
  // the share of the rating in each cell.
  expect(html).toContain('<details class="orc-course orc-mix"><summary>Show handicap mix</summary>');
  expect(html).toContain('<th scope="row">Beat VMG</th>');
  expect(html).toContain('<th scope="row">Run VMG</th>');
  expect(html).toContain('<th scope="row">110°</th>');
  expect(html).toContain('certificate, at a scoring wind of 18.06 kt.');
});

test('ORC fleet: the wind band picked on the start re-scores the race', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ORC Band Test 2026' });
  await setUpOrcFleet(page, [
    { sailNumber: 'IRL 2507', name: 'Impetuous' },
    { sailNumber: 'IRL 1551', name: 'Mojo' },
  ]);
  await importCertificates(page, 2);

  // A race on the APHT default: Impetuous wins 3467 to 3511.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05', { exact: true }).fill('14:00:00');
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

  // The race committee announces the Medium band: pick it on the start.
  // The certificates' IRL five-band W/L Medium values flip the race —
  // Mojo corrects to 2917 against Impetuous's 2956 — with no finish
  // re-entered.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Edit start' }).click();
  await page.getByTestId('start-orc-option').click();
  await page.getByRole('option', { name: 'IRL_5B_WL_M_TOT' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('IRL 1551');
  await expect(page.getByRole('row').nth(2)).toContainText('IRL 2507');
});

test('ORC fleet: the start option switches one race to performance curves', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ORC Option Test 2026' });
  await setUpOrcFleet(page, [
    { sailNumber: 'IRL 2507', name: 'Impetuous' },
    { sailNumber: 'IRL 1551', name: 'Mojo' },
  ]);
  await importCertificates(page, 2);

  // A 3.9 NM race scored on the fleet default (APHT time-on-time):
  //   Impetuous ET 3480 × 0.9631 → CT 3352 — wins
  //   Mojo      ET 3390 × 1.0089 → CT 3420
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05', { exact: true }).fill('14:00:00');
  await page.getByLabel(/Course length/).fill('3.9');
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
  await expect(page.getByRole('row').nth(1)).toContainText('IRL 2507');

  // The race committee had announced performance-curve scoring for this
  // race: pick the W/L PCS option on the start. The whole method switches —
  // Mojo's implied wind 7.70 kt becomes the scoring wind and it corrects
  // out ahead (3390 scratch vs 3402) — with no finish re-entered.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Edit start' }).click();
  await page.getByTestId('start-orc-option').click();
  await page.getByRole('option', { name: 'Windward/leeward · performance curve (PCS)' }).click();
  // Choosing a PCS option surfaces the scoring-wind override field.
  await expect(page.getByLabel(/Scoring wind/)).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  // The start listing names the option it overrides the fleet default with.
  await expect(
    page.getByTitle('ORC scoring option for this start (overrides the fleet default)'),
  ).toHaveText('WL');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('IRL 1551');
  await expect(page.getByRole('row').nth(2)).toContainText('IRL 2507');

  // The published page states the method the race was actually scored on.
  const download = await downloadFleetHtml(page);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString('utf-8');
  expect(html).toContain('Scored on ORC performance curves');
  expect(html).toContain("Scoring wind 7.70 kt (winner's implied wind)");
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
  await page.getByPlaceholder('14:05', { exact: true }).fill('15:15:00');
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
