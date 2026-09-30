import { signedInTest as test, expect } from './fixtures';
import { createSplitFleetSeries, enableFeatures, showStageSettings } from './helpers';

/**
 * Fleets drawn once and each ranked on its own: the Irish Sailing Champions'
 * Cups' qualifying flights, where "helms ranked 1st and 2nd from each
 * Qualifying Fleet" go through. End to end: the setting on the opening
 * series card, a table and a cut line per fleet, the top two of each fleet
 * selected, and as many more promoted as the scorer chooses.
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
  // The series' own non-finisher rule, which a split-fleet series offers
  // only here: Rule A5.3, as the Champions' Cups' SIs say.
  await page.locator('#sf-non-finishers').selectOption('startingArea');
  await expect(page.getByText(/^Rule A5\.3 applies: a boat that came to the starting area/)).toBeVisible();
  await showStageSettings(page, 'Opening series', false);

  // ── The top two from each flight, nothing carried in ─────────────────────
  // With each fleet ranked on its own the medal fleet has no size of its
  // own: the card asks only how many of each fleet go through.
  await showStageSettings(page, 'Medal races');
  await expect(page.locator('#sf-medal-size-setting')).toHaveCount(0);
  await Promise.all([
    saved(),
    page.getByRole('radiogroup', { name: 'Score carried into the medal races' }).getByLabel('Nothing').click(),
  ]);
  await Promise.all([saved(), page.locator('#sf-medal-from-each').fill('2')]);
  await showStageSettings(page, 'Medal races', false);

  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` })).toBeHidden();
  // Placed by hand, as drawn at the briefing: nothing dealt, nothing to
  // override.
  await page.getByRole('button', { name: 'Assign opening fleets' }).click();
  const assign = page.getByRole('dialog');
  await assign.locator('#sf-seed-order').selectOption('by-hand');
  await expect(assign.getByRole('button', { name: /Commit Round 1/ })).toBeDisabled();
  await expect(assign).toContainText('24 boats are in no fleet');
  for (const [i, sail] of sails.entries()) {
    await assign.getByLabel(`Fleet for ${sail}`).selectOption(i % 2 === 0 ? 'Yellow' : 'Blue');
  }
  await expect(assign.getByText('moved by hand')).toHaveCount(0);
  await assign.getByRole('button', { name: 'Commit Round 1 (12 / 12)' }).click();
  await expect(assign).toBeHidden();

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
  await expect(dialog).toContainText('Any more are promoted afterwards');
  await dialog.getByRole('button', { name: /Commit medal fleet \(top 2 of each fleet\)/ }).click();
  await expect(dialog).toBeHidden();
  const repechage = page.getByTestId('sf-repechage');
  await expect(repechage.getByTestId('sf-seats-open')).toHaveText(
    'Promote as many competitors as the sailing instructions say',
  );

  // ── The fallback: the third of each flight, promoted by hand ─────────────
  await repechage.getByRole('button', { name: /Promote from the opening series ranking/ }).click();
  const promote = page.getByRole('dialog');
  const candidates = promote.getByTestId('sf-promote-candidates');
  // No fixed size, so nothing to suggest up to.
  await expect(candidates.getByRole('checkbox', { checked: true })).toHaveCount(0);
  const thirds = candidates.getByRole('row').filter({ has: page.getByRole('cell', { name: '3', exact: true }) });
  await expect(thirds).toHaveCount(2);
  for (const row of await thirds.all()) await row.getByRole('checkbox').check();
  await promote.getByRole('button', { name: 'Promote 2 competitors' }).click();
  await expect(promote).toBeHidden();
  await expect(repechage.getByTestId('sf-promoted')).toContainText('from the opening series ranking');
});
