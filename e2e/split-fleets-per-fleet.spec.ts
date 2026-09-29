import { signedInTest as test, expect } from './fixtures';
import { createSplitFleetSeries, enableFeatures, showStageSettings } from './helpers';

/**
 * Fleets drawn once and each ranked on its own: the Irish Sailing Champions'
 * Cups' qualifying flights, where "helms ranked 1st and 2nd from each
 * Qualifying Fleet" go through. End to end: the setting on the opening
 * series card, a table and a cut line per fleet, the top two of each fleet
 * selected, and the next boat of each suggested for the seats left open.
 */

const DEMO_COUNT = 24;
const sails = Array.from({ length: DEMO_COUNT }, (_, i) => `${210001 + i * 137}`);

async function enterFinishes(page: import('@playwright/test').Page, sailNumbers: string[]) {
  for (const sail of sailNumbers) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
}

test('each fleet ranked on its own, the top two of each through', async ({ page, signedInEmail }) => {
  test.setTimeout(240_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSplitFleetSeries(page, { name: 'Flights Demo', venue: 'Dun Laoghaire', fleetCount: 1 });

  const saved = () =>
    page.waitForResponse(
      (r) => /\/api\/v1\/series\/[^/]+\/split-fleets$/.test(r.url()) && r.request().method() === 'PUT' && r.ok(),
    );

  // ── Two flights, each ranked on its own ──────────────────────────────────
  await showStageSettings(page, 'Opening series');
  await Promise.all([saved(), page.locator('#sf-fleet-count').selectOption('2')]);
  await Promise.all([
    saved(),
    page.getByRole('radiogroup', { name: 'How the fleets are ranked' }).getByLabel('Each on its own').click(),
  ]);
  await expect(page.getByText('A race counts for a fleet once that fleet has sailed it.')).toBeVisible();
  await showStageSettings(page, 'Opening series', false);

  // ── Six seats, two from each flight, nothing carried in ──────────────────
  await showStageSettings(page, 'Medal races');
  await Promise.all([saved(), page.locator('#sf-medal-size-setting').fill('6')]);
  await Promise.all([
    saved(),
    page.getByRole('radiogroup', { name: 'Score carried into the medal races' }).getByLabel('Nothing').click(),
  ]);
  await Promise.all([saved(), page.locator('#sf-medal-from-each').fill('2')]);
  await showStageSettings(page, 'Medal races', false);

  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` })).toBeHidden();
  await page.getByRole('button', { name: 'Assign opening fleets' }).click();
  await page.getByRole('button', { name: /Commit Round 1/ }).click();

  // One race on one sheet: each fleet is ranked among its own boats by
  // their order on it.
  await page.getByRole('button', { name: 'Add race Q1' }).click();
  await page
    .getByTestId('logical-race-qualifying-1')
    .getByRole('link', { name: /enter finishes/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/races\//);
  await enterFinishes(page, sails);
  await page.goBack();

  // ── A table and a cut line per fleet ─────────────────────────────────────
  await expect(page.getByTestId('sf-fleet-standings')).toHaveCount(2);
  await expect(page.getByText(/Medal fleet cut if the opening series ended now/)).toHaveCount(2);
  for (const fleet of await page.getByTestId('sf-fleet-standings').all()) {
    await expect(fleet.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('1');
  }

  // ── The top two of each flight go through ────────────────────────────────
  await page.getByRole('button', { name: 'Select medal fleet…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#sf-medal-each')).toHaveValue('2');
  await expect(dialog).toContainText('The other 2 of the 6 seats are filled afterwards');
  await dialog.getByRole('button', { name: /Commit medal fleet \(top 2 of each fleet\)/ }).click();
  await expect(dialog).toBeHidden();
  const repechage = page.getByTestId('sf-repechage');
  await expect(repechage.getByTestId('sf-seats-open')).toHaveText('2 seats open in the medal fleet');

  // ── The fallback: the next boat of each flight is suggested ──────────────
  await repechage.getByRole('button', { name: /Promote from the opening series ranking/ }).click();
  const promote = page.getByRole('dialog');
  const candidates = promote.getByTestId('sf-promote-candidates');
  await expect(candidates.getByRole('checkbox', { checked: true })).toHaveCount(2);
  // Each suggested boat is third in her own flight.
  for (const row of await candidates.getByRole('row').filter({ has: page.getByRole('checkbox', { checked: true }) }).all()) {
    await expect(row.getByRole('cell').nth(1)).toHaveText('3');
  }
  await promote.getByRole('button', { name: 'Promote 2 boats' }).click();
  await expect(repechage.getByTestId('sf-seats-open')).toHaveText('0 seats open in the medal fleet');
});
