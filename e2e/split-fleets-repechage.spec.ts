import { signedInTest as test, expect } from './fixtures';
import { createSplitFleetSeries, enableFeatures, showStageSettings } from './helpers';

/**
 * The repêchage: a short series for boats who missed the medal cut, ranked
 * on its own races, whose leaders the scorer promotes into the medal fleet.
 * The Irish Sailing Champions' Cups sail one between their qualifying
 * flights and the Final Series, which carries nothing in.
 *
 * End to end: the direct seats are committed first, the repêchage is picked
 * by hand and sailed, its leaders are promoted, and the standings list every
 * score once — the medal fleet, then the repêchage, then the ranking the
 * boats were cut from.
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

test('a repêchage, sailed and promoted from', async ({ page, signedInEmail }) => {
  test.setTimeout(240_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSplitFleetSeries(page, { name: 'Champions Cup Demo', venue: 'Dun Laoghaire', fleetCount: 1 });

  // The deciding stage is the whole championship score: nothing carried in.
  const saved = () =>
    page.waitForResponse(
      (r) => /\/api\/v1\/series\/[^/]+\/split-fleets$/.test(r.url()) && r.request().method() === 'PUT' && r.ok(),
    );
  await showStageSettings(page, 'Medal races');
  await Promise.all([
    saved(),
    page.getByRole('radiogroup', { name: 'Score carried into the medal races' }).getByLabel('Nothing').click(),
  ]);
  await showStageSettings(page, 'Medal races', false);

  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` })).toBeHidden();
  await page.getByRole('button', { name: 'Add race Q1' }).click();
  await page.getByTestId('logical-race-qualifying-1').getByRole('link', { name: /enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  await enterFinishes(page, sails);
  await page.goBack();

  // ── The direct seats first: eight of a ten-boat medal fleet ──────────────
  await page.getByRole('button', { name: 'Select medal fleet…' }).click();
  await page.locator('#sf-medal-size').fill('8');
  await page.getByRole('button', { name: /Commit medal fleet \(top 8\)/ }).click();
  const repechage = page.getByTestId('sf-repechage');
  await expect(repechage.getByTestId('sf-seats-open')).toHaveText('2 seats open in the medal fleet');

  // ── Then the repêchage, picked by hand: the next four ────────────────────
  await repechage.getByRole('button', { name: 'Add a repêchage…' }).click();
  const addDialog = page.getByRole('dialog');
  for (const sail of sails.slice(8, 12)) {
    await addDialog.getByRole('checkbox', { name: `${sail} sails the repêchage` }).check();
  }
  // A medal boat is not on offer.
  await expect(addDialog.getByRole('checkbox', { name: `${sails[0]} sails the repêchage` })).toHaveCount(0);
  await addDialog.getByRole('checkbox', { name: /Also create R1/ }).check();
  await addDialog.getByRole('button', { name: 'Add the repêchage (4 boats)' }).click();
  await expect(addDialog).toBeHidden();

  // Sailed in reverse of the qualifying order: it is ranked on its own race.
  await page.getByTestId('logical-race-repechage-1').getByRole('link', { name: /enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  await enterFinishes(page, [...sails.slice(8, 12)].reverse());
  await page.goBack();
  await expect(page.getByTestId('sf-next-action')).toContainText('promote from the repêchage');

  // ── Promote its leaders: ticked for the scorer, up to the seats open ─────
  await repechage.getByRole('button', { name: 'Promote from the repêchage…' }).click();
  const promoteDialog = page.getByRole('dialog');
  await expect(promoteDialog.getByRole('checkbox', { name: `Promote ${sails[11]}` })).toBeChecked();
  await expect(promoteDialog.getByRole('checkbox', { name: `Promote ${sails[10]}` })).toBeChecked();
  await expect(promoteDialog.getByRole('checkbox', { name: `Promote ${sails[9]}` })).not.toBeChecked();
  await promoteDialog.getByRole('button', { name: 'Promote 2 boats' }).click();
  await expect(promoteDialog).toBeHidden();
  await expect(repechage.getByTestId('sf-seats-open')).toHaveText('0 seats open in the medal fleet');
  await expect(repechage.getByTestId('sf-promoted')).toContainText(sails[11]);
  await expect(repechage.getByTestId('sf-promoted')).toContainText('from the repêchage');

  // ── The medal race decides it alone ──────────────────────────────────────
  const medalFleet = [...sails.slice(0, 8), sails[11], sails[10]];
  await page.getByRole('button', { name: 'Add race M1' }).click();
  await page.getByRole('link', { name: /M1 .*enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  await enterFinishes(page, [...medalFleet].reverse());
  await page.goBack();

  // ── Every score listed once: the medal fleet on the medal race alone, the
  // repêchage with every boat that sailed it, then the opening series with
  // every boat — the medal boats' earlier scores are nowhere else now ──────
  await expect(page.getByRole('heading', { name: 'Medal fleet' })).toBeVisible();
  const repStandings = page.getByTestId('sf-repechage-standings');
  await expect(repStandings.getByRole('row')).toHaveCount(5);
  await expect(repStandings).toContainText('promoted to the medal fleet');
  const cutStandings = page.getByTestId('sf-cut-standings');
  await expect(cutStandings.getByRole('row')).toHaveCount(DEMO_COUNT + 1);
  await expect(page.getByTestId('sf-promoted-badge').filter({ hasText: 'via the repêchage' })).toHaveCount(2);
});
