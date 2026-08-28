import { type Page } from '@playwright/test';
import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';
import { resolve } from 'path';

/**
 * E2E for the RaceSense regatta-export import.
 *
 * The fixture workbook (tests/fixtures/xlsx/racesense-regatta.xlsx) is shaped
 * like a real export: three race sheets plus a Summary, an uncleared OCS boat
 * filed in the Finishes tail as a DNF, a cleared OCS whose finish stands, and
 * a race nobody finished with no Finishes block at all — one of whose boats
 * never checked her device in, which is the only evidence a RaceSense export
 * carries that a boat wasn't there.
 *
 * What's actually being tested is the safety property. A RaceSense export is
 * a snapshot of the whole regatta, so the same file gets uploaded again and
 * again through a championship — and it must never quietly overwrite a race
 * the scorer has already corrected by hand.
 *
 * Gated behind the operator-managed `racesense-import` feature (#155).
 */

const FIXTURE = resolve(__dirname, '../tests/fixtures/xlsx/racesense-regatta.xlsx');

/** The workbook's three boats, entered into a series with three empty races
 *  for its three sheets to land in. Leaves the browser on the Races tab. */
async function seriesForTheFixture(page: Page, name: string) {
  await createSeriesQuick(page, { name });

  for (const c of [
    { sail: '15', name: 'Alice Pearson' },
    { sail: '22', name: 'Bob Dickson' },
    { sail: '254', name: 'Carol Walls' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail, exact: true })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByRole('button', { name: 'Add race' })).toBeVisible();
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${i}`, { exact: true })).toBeVisible();
  }
}

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['racesense-import']);
});

test('import a RaceSense regatta export race by race', async ({ page }) => {
  // ── 1. A series with the workbook's three boats and three races ───────────
  await seriesForTheFixture(page, 'RaceSense Regatta');

  // ── 2. Upload the workbook ────────────────────────────────────────────────
  await page.getByTestId('racesense-input').setInputFiles(FIXTURE);

  const plan = page.getByTestId('racesense-plan');
  await expect(plan).toBeVisible();
  await expect(plan).toContainText('Spring Championship');
  await expect(plan).toContainText('Fleet A');

  // Races 1 and 2 land in empty races and are ticked; race 3 is the one
  // nobody finished, so it waits to be chosen.
  await expect(page.getByTestId('racesense-row-1')).toContainText('New');
  await expect(page.getByTestId('racesense-row-3')).toContainText('Nobody finished');
  await expect(page.getByRole('checkbox', { name: 'Import Race 1' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Import Race 3' })).not.toBeChecked();

  // 254's DNF in race 1 is a code the import chose, not one the sheet states.
  // Saying so is the whole point: the race is still ticked, because the
  // correction is made on the finish sheet the import writes.
  await expect(page.getByTestId('racesense-row-1')).toContainText('254 DNF');
  await expect(page.getByTestId('racesense-row-1'))
    .toContainText('correct it on the finish sheet');

  await expect(page.getByTestId('racesense-confirm')).toHaveText('Import 2 races');
  await page.getByTestId('racesense-confirm').click();
  await expect(plan).toBeHidden();

  // ── 3. Race 1 reads back in crossing order ────────────────────────────────
  await expect(page.getByText('2 finishers').first()).toBeVisible();
  await page.getByText('Race 1', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch race' })).toContainText('Race 1');
  await expect(page.getByRole('listitem').nth(0)).toContainText('15');
  await expect(page.getByRole('listitem').nth(1)).toContainText('22');
  await expect(page.getByTestId('non-finisher-254')).toContainText('DNF');

  // ── 4. Race 2: the OCS survives, the cleared OCS keeps her finish ─────────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByText('Race 2', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch race' })).toContainText('Race 2');
  // RaceSense files 22 in the DNF tail; her Status is the only record that
  // she was over the line, and it is the one that counts.
  await expect(page.getByTestId('non-finisher-22')).toContainText('OCS');
  await expect(page.getByRole('listitem').nth(0)).toContainText('254');
  await expect(page.getByRole('listitem').nth(1)).toContainText('15');

  // ── 5. Race 3, taken deliberately: the boat who never appeared is DNC ─────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByTestId('racesense-input').setInputFiles(FIXTURE);
  await expect(plan).toBeVisible();
  await expect(page.getByTestId('racesense-row-1')).toContainText('Unchanged');
  await expect(page.getByTestId('racesense-row-2')).toContainText('Unchanged');
  // Nobody finished, so nothing is recommended — but a race that was sailed
  // and abandoned by nobody is the scorer's to take.
  await expect(page.getByTestId('racesense-row-3'))
    .toContainText('whose device never checked in');
  await page.getByRole('checkbox', { name: 'Import Race 3' }).check();
  await page.getByTestId('racesense-confirm').click();
  await expect(plan).toBeHidden();

  await page.getByText('Race 3', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch race' })).toContainText('Race 3');
  // 254's device never checked in and never saw the line: she did not come to
  // the starting area. 15 and 22 were there, so all the sheet says of them is
  // that they didn't finish.
  await expect(page.getByTestId('non-finisher-254')).toContainText('DNC');
  await expect(page.getByTestId('non-finisher-15')).toContainText('DNF');
  await expect(page.getByTestId('non-finisher-22')).toContainText('DNF');

  // ── 6. The same workbook again: nothing to do ─────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByTestId('racesense-input').setInputFiles(FIXTURE);
  await expect(plan).toBeVisible();
  await expect(page.getByTestId('racesense-row-1')).toContainText('Unchanged');
  await expect(page.getByTestId('racesense-row-3')).toContainText('Unchanged');
  await expect(page.getByTestId('racesense-confirm')).toBeDisabled();
});

test('a sheet that would overwrite a different race comes unticked, with the changes shown', async ({ page }) => {
  await seriesForTheFixture(page, 'RaceSense Shift');

  await page.getByTestId('racesense-input').setInputFiles(FIXTURE);
  await expect(page.getByTestId('racesense-confirm')).toHaveText('Import 2 races');
  await page.getByTestId('racesense-confirm').click();
  await expect(page.getByTestId('racesense-plan')).toBeHidden();

  // Upload again, but shifted by one — as a resail that renumbered the export
  // would leave things. Sheet "Race 1" now points at the race holding sheet
  // "Race 2"'s results.
  await page.getByTestId('racesense-input').setInputFiles(FIXTURE);
  await expect(page.getByTestId('racesense-plan')).toBeVisible();
  await page.getByTestId('racesense-offset').fill('1');

  const shifted = page.getByTestId('racesense-row-1');
  await expect(shifted).toContainText('Differs');
  await expect(page.getByRole('checkbox', { name: 'Import Race 1' })).not.toBeChecked();

  await shifted.getByRole('button', { name: /Show \d+ changes?/ }).click();
  await expect(page.getByTestId('racesense-plan')).toContainText('Stored now');
  await expect(page.getByTestId('racesense-plan')).toContainText('Would become');

  // The last sheet has run off the end of the series, and says so.
  await expect(page.getByTestId('racesense-row-3')).toContainText('No race');

  // Nothing was written by looking.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('racesense-plan')).toBeHidden();
  await page.getByText('Race 2', { exact: true }).click();
  await expect(page.getByTestId('non-finisher-22')).toContainText('OCS');
});

test('publish the track data the import recorded, behind the series opt-in', async ({ page }) => {
  await seriesForTheFixture(page, 'Track Data Regatta');

  await page.getByTestId('racesense-input').setInputFiles(FIXTURE);
  const plan = page.getByTestId('racesense-plan');
  await expect(plan).toBeVisible();
  await page.getByTestId('racesense-confirm').click();
  await expect(plan).toBeHidden();

  // Imported but not opted in: the preview carries no track columns.
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  let frame = page.frameLocator('iframe[title="Results preview"]');
  await expect(frame.getByRole('columnheader', { name: 'Points' }).first()).toBeVisible();
  await expect(frame.getByRole('columnheader', { name: 'DTL (m)' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The opt-in lives on the Publishing card, shown only under the feature.
  await page.getByRole('link', { name: 'Settings' }).click();
  const publishing = page.getByTestId('publishing-card');
  await publishing.getByRole('button', { name: 'Edit ▸' }).click();
  // The control auto-saves: the click round-trips through the series PATCH
  // before the checked state lands, so poll rather than check().
  const toggle = page.getByRole('checkbox', { name: 'Publish RaceSense track data on race results' });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await publishing.getByRole('button', { name: 'Done' }).click();
  await expect(publishing.getByText('track data published')).toBeVisible();

  // Now the per-race tables carry the columns — values as the device wrote
  // them, average speed derived (1.188 km in 500.83 s is 4.61 kn).
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  frame = page.frameLocator('iframe[title="Results preview"]');
  await expect(frame.getByRole('columnheader', { name: 'DTL (m)' }).first()).toBeVisible();
  await expect(frame.getByRole('columnheader', { name: 'Avg speed (kn)' }).first()).toBeVisible();
  await expect(frame.getByText('1.188')).toBeVisible();
  await expect(frame.getByText('4.61')).toBeVisible();
});

test('the scorer can see what the device recorded, without publishing it', async ({ page }) => {
  await seriesForTheFixture(page, 'Track Data In App');

  await page.getByTestId('racesense-input').setInputFiles(FIXTURE);
  const plan = page.getByTestId('racesense-plan');
  await expect(plan).toBeVisible();
  // The plan says what it captured before anything is committed — on a New
  // race, which is where a scorer would otherwise never be told.
  await expect(page.getByTestId('racesense-row-1')).toContainText('New');
  await expect(page.getByTestId('racesense-row-1')).toContainText('track data for 3');
  await page.getByTestId('racesense-confirm').click();
  await expect(plan).toBeHidden();

  // Every boat with a row in the race carries data, so the badge is a count
  // rather than a fraction.
  await expect(page.getByTestId('race-track-data-badge').first()).toHaveText('Track data 3');

  // ── The finish sheet: a marker per boat, opening what she recorded ────────
  await page.getByText('Race 2', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch race' })).toContainText('Race 2');

  const strip = page.getByTestId('track-data-15');
  await expect(strip).toBeHidden();
  await page.getByTestId('track-data-toggle-15').click();
  // 1.19 km in 560.5 s is 4.13 kn. Her DTL is stored as -0.9: she was over
  // the line at the gun, and in the app that reads as words, not a sign.
  await expect(strip).toContainText('Elapsed 9:21');
  await expect(strip).toContainText('1.19 km');
  await expect(strip).toContainText('4.13 kn avg');
  await expect(strip).toContainText('7 kn max');
  await expect(strip).toContainText('0.9 m over');

  // A boat who started cleanly reads the other way round, and two rows can be
  // open at once — there is no table here to compare them in.
  await page.getByTestId('track-data-toggle-254').click();
  await expect(page.getByTestId('track-data-254')).toContainText('2.2 m to line');
  await expect(strip).toBeVisible();

  await page.getByTestId('track-data-toggle-15').click();
  await expect(strip).toBeHidden();

  // ── The publish toggle knows how much data it is about ───────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const publishing = page.getByTestId('publishing-card');
  await publishing.getByRole('button', { name: 'Edit ▸' }).click();
  await expect(page.getByTestId('track-data-coverage')).toHaveText('2 races carry track data.');
});
