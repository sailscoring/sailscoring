import { signedInTest as test, expect } from './fixtures';
import { createSplitFleetSeries, enableFeatures } from './helpers';

/**
 * The championship that never bands its fleet (#585): one fleet sails the
 * opening series and the only division ever made is into the deciding fleet.
 * The Irish Sailing Junior Champions' Cup sails it every year — NoR 8.1 is
 * "an opening series of up to 8 races and a Medal Race", and that is the
 * whole regatta.
 *
 * What this proves end to end is the shape, not the arithmetic (fixtures
 * 23–25 carry that): the second stage is gone from the settings and from the
 * page, the cut into the deciding fleet is drawn where it would fall and
 * offered from the stage that actually exists, and the boats who miss it are
 * scored in the deciding race rather than left out of it.
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

test('one fleet, no split, then a deciding race', async ({ page, signedInEmail }) => {
  test.setTimeout(240_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);

  await createSplitFleetSeries(page, {
    name: 'Junior Champions Cup Demo',
    venue: 'Schull',
    fleetCount: 1,
  });

  // ── The format: one fleet, and the settings that describe a second stage
  // are gone with it ────────────────────────────────────────────────────────
  await expect(page.locator('#sf-fleet-count')).toHaveValue('1');
  await expect(page.locator('#sf-split')).toHaveCount(0);
  await expect(page.locator('#sf-equalization')).toHaveCount(0);

  // Take the preset for this format so the series speaks the wording its
  // notice of race uses — an opening series and a medal race.
  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/v1\/series\/[^/]+\/split-fleets$/.test(r.url()) &&
        r.request().method() === 'PUT' &&
        r.ok(),
    ),
    page.locator('#sf-format').selectOption('opening-medal-unbanded'),
  ]);
  // The generated sailing instructions say what the format is, and say
  // nothing about dividing a fleet that is never divided.
  const si = page.getByTestId('sf-si-translation');
  await expect(si).toContainText('sailed as an opening series followed by the medal race');
  await expect(si).toContainText('in one fleet');
  await expect(si).not.toContainText('will be divided into');
  await expect(si).not.toContainText('boats will be assigned on the basis of their ranks');
  // The clause the engine applies and the published page asserts, said where
  // a scorer can check it against their notice of race.
  await expect(si).toContainText(
    'The boats qualified to compete in the medal races will be ranked highest in the event.',
  );

  // ── Race it ───────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(
    page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }),
  ).toBeHidden();

  await page.getByRole('button', { name: 'Assign opening fleets' }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: /Also create/ }).check();
  await page.getByRole('button', { name: /Commit Round 1/ }).click();

  const q1Row = page.getByTestId('logical-race-qualifying-1');
  await q1Row.getByRole('link', { name: /enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  await enterFinishes(page, sails);
  await page.goBack();

  // ── The format section still says what shape the event is, now that the
  // fleet count is frozen ──────────────────────────────────────────────────
  // Racing has started, so the count can no longer be changed — but it is the
  // one setting that decides the shape of the championship, and a scorer
  // checking their configuration against the notice of race has to be able to
  // read it.
  await page.getByRole('button', { name: /^Format/ }).click();
  await expect(page.locator('#sf-fleet-count')).toHaveCount(0);
  await expect(page.getByText('Fleet — one fleet, never split')).toBeVisible();
  await expect(
    page.getByText(/Every boat sails every race in one fleet, all 24 of them/),
  ).toBeVisible();
  await expect(page.getByText(/reassigned by series rank/)).toHaveCount(0);
  await page.getByRole('button', { name: /^Format/ }).click();

  // ── The cut line: where the deciding fleet would be taken from if racing
  // ended now. Not a band boundary — this one decides who races again ──────
  await expect(page.getByText(/Medal fleet cut if the opening series ended now/)).toBeVisible();

  // There is no middle stage to open, and the cut is offered from the stage
  // that does exist.
  await expect(page.getByRole('button', { name: /^Final series/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Select medal fleet…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Select the medal fleet');
  await expect(dialog).toContainText('everyone else has finished racing, and is scored DNC there');
  await dialog.getByRole('checkbox', { name: /Also create/ }).check();
  await page.getByRole('button', { name: /Commit medal fleet \(top 10\)/ }).click();

  // ── The deciding race, and what it does to the boats outside it ──────────
  await expect(page.getByText('Medal races score ×2')).toBeVisible();
  await expect(
    page.getByText(/scored DNC here, at the entry list plus one, ×2/),
  ).toBeVisible();
  // And the cut line is gone: a committed fleet is a fact, not a projection.
  await expect(page.getByText(/cut if the opening series ended now/)).toHaveCount(0);

  // The ten sail it; the fourteen who missed the cut are scored DNC in it at
  // 24 entries + 1, doubled — 50, and not a blank.
  await page.getByRole('link', { name: /M1 .*enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  await enterFinishes(page, sails.slice(0, 10));
  await page.goBack();
  await expect(page.getByText('50 DNC').first()).toBeVisible();

  // ── The standings separate the two groups, as the published page does ────
  // The ten are a table of their own, above everyone else, and the reason is
  // stated: they rank ahead whatever the points say.
  await expect(page.getByRole('heading', { name: 'Medal fleet' })).toBeVisible();
  await expect(
    page.getByText('These boats are ranked ahead of every other boat in the event.'),
  ).toBeVisible();
});
