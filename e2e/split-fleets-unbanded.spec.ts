import { signedInTest as test, expect } from './fixtures';
import {
  createSplitFleetSeries,
  enableFeatures,
  showSailingInstructions,
  showStageSettings,
} from './helpers';

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

  // ── The championship as created: one fleet, an opening series and a
  // medal race at double points. The opening series card says so, and offers
  // the division rather than showing settings for a stage it doesn't have ──
  await showStageSettings(page, 'Opening series');
  await expect(page.locator('#sf-fleet-count')).toHaveValue('1');
  await expect(
    page.getByRole('button', { name: 'Divide into a qualifying series and a final series' }),
  ).toBeVisible();
  await expect(page.getByText('Elimination series')).toHaveCount(0);
  await showStageSettings(page, 'Opening series', false);

  // The generated sailing instructions say what the format is, and say
  // nothing about dividing a fleet that is never divided.
  const si = await showSailingInstructions(page);
  await expect(si).toContainText('sailed as an opening series followed by the medal race');
  await expect(si).toContainText('in one fleet');
  await expect(si).not.toContainText('will be divided into');
  await expect(si).not.toContainText('boats will be assigned on the basis of their ranks');
  // The clause the engine applies and the published page asserts, said where
  // a scorer can check it against their notice of race.
  await expect(si).toContainText(
    'The boats qualified to compete in the medal races will be ranked highest in the event.',
  );
  await expect(si).toContainText(
    'the boats that do not qualify for it will have no score for the medal race',
  );

  // ── Race it ───────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(
    page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }),
  ).toBeHidden();

  // One fleet is everyone: the first race creates the round with it.
  await page.getByRole('button', { name: 'Add race Q1' }).click();

  const q1Row = page.getByTestId('logical-race-qualifying-1');
  await q1Row.getByRole('link', { name: /enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  await enterFinishes(page, sails);
  await page.goBack();

  // ── The card still says what shape the event is, now that the fleet
  // count is settled ────────────────────────────────────────────────────
  await showStageSettings(page, 'Opening series');
  await expect(page.locator('#sf-fleet-count')).toBeDisabled();
  await expect(page.getByText('A boat that doesn’t finish scores the number of entries, plus one.')).toBeVisible();
  await expect(page.locator('#sf-vocabulary')).toBeDisabled();
  await showStageSettings(page, 'Opening series', false);

  // ── The cut line: where the deciding fleet would be taken from if racing
  // ended now. Not a band boundary — this one decides who races again ──────
  await expect(page.getByText(/Medal fleet cut if the opening series ended now/)).toBeVisible();

  // There is no middle stage to open, and the cut is offered from the stage
  // that does exist.
  await expect(page.getByRole('button', { name: /^Final series/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Select medal fleet…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Select the medal fleet');
  await expect(dialog).toContainText('everyone else has no score for it');
  await dialog.getByRole('checkbox', { name: /Also create/ }).check();
  await page.getByRole('button', { name: /Commit medal fleet \(top 10\)/ }).click();

  // ── The deciding race, and what it does to the boats outside it ──────────
  await expect(page.getByText('Medal races score ×2')).toBeVisible();
  // And the cut line is gone: a committed fleet is a fact, not a projection.
  await expect(page.getByText(/cut if the opening series ended now/)).toHaveCount(0);

  // The ten sail it. The fourteen who missed the cut are not scored for it at
  // all — no DNC for a race they were not permitted to sail.
  await page.getByRole('link', { name: /M1 .*enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  await enterFinishes(page, sails.slice(0, 10));
  await page.goBack();
  // 24 entries + 1, doubled, is what a DNC in this race would score.
  await expect(page.getByText('50 DNC')).toHaveCount(0);

  // ── And one more race for the rest, where the sailing instructions give
  // them one: the opening series card's next race is the companion race ─────
  await page.getByRole('button', { name: 'Add companion race Q2' }).click();
  await page
    .getByTestId('logical-race-qualifying-2')
    .getByRole('link', { name: /enter finishes/ })
    .click();
  await expect(page).toHaveURL(/\/races\//);
  // A medal boat is still assigned to the fleet, but this race is not hers:
  // her sail number is refused, with the reason.
  await page.getByLabel('Sail number').fill(sails[0]);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    page.getByText(`${sails[0]} is in the medal fleet — this race is for the boats outside it.`),
  ).toBeVisible();
  await enterFinishes(page, sails.slice(10));
  await page.goBack();
  // The ten are absent from it, not DNC in it (24 entries + 1).
  await expect(page.getByText('25 DNC')).toHaveCount(0);

  // ── The standings separate the two groups, as the published page does ────
  // The ten are a table of their own, above everyone else, and the reason is
  // stated: they rank ahead whatever the points say.
  await expect(page.getByRole('heading', { name: 'Medal fleet' })).toBeVisible();
  await expect(
    page.getByText('These boats are ranked ahead of every other boat in the event.'),
  ).toBeVisible();
});
