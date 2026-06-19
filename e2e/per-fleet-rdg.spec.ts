import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick } from './helpers';

/**
 * E2E for per-fleet scorer-stated redress points (#224).
 *
 * A boat scored in two fleets (the classic "tandem series" case — one start
 * scored under IRC and ECHO) can be granted a *different* stated redress value
 * in each fleet. A fleet left without a value is scored as the A9 average and
 * flagged on the standings.
 */

// Tandem is entered in both fleets; the fillers keep each fleet non-trivial.
async function addCompetitor(
  page: import('@playwright/test').Page,
  sail: string,
  name: string,
  fleets: string[],
) {
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill(sail);
  await page.getByLabel('Competitor name').fill(name);
  for (const f of fleets) await page.getByRole('checkbox', { name: f }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: sail }).first()).toBeVisible();
}

async function enterRace(
  page: import('@playwright/test').Page,
  raceLabel: string,
  sails: string[],
) {
  await page.getByText(raceLabel, { exact: true }).click();
  for (const sail of sails) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
}

test('per-fleet stated redress: different value scored in each fleet', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Tandem RDG', venue: 'DBSC' });
  await createFleets(page, ['IRC', 'ECHO']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  await addCompetitor(page, 'T', 'Tandem', ['IRC', 'ECHO']);
  await addCompetitor(page, 'A', 'Alpha', ['IRC']);
  await addCompetitor(page, 'B', 'Bravo', ['ECHO']);

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();

  // Finish order: Tandem 1st, Alpha 2nd, Bravo 3rd.
  await enterRace(page, 'Race 1', ['T', 'A', 'B']);

  // Grant Tandem redress, method A9(c) stated, with different points per fleet.
  await page.getByRole('button', { name: 'Row actions for T' }).click();
  await page.getByRole('menuitem', { name: /redress \(RDG\)/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByText('scorer-stated points').click();

  // Two fleets → defaults to one value for all; expand to set each fleet.
  await dialog.getByTestId('per-fleet-expand').click();
  await dialog.getByTestId('per-fleet-input-IRC').fill('8');
  await dialog.getByTestId('per-fleet-input-ECHO').fill('2');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).not.toBeVisible();

  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();

  await page.getByRole('link', { name: 'Standings' }).click();

  // The IRC fleet shows RDG(8); the ECHO fleet shows RDG(2).
  await expect(page.getByText('RDG(8)')).toBeVisible();
  await expect(page.getByText('RDG(2)')).toBeVisible();
});

test('per-fleet stated redress: a fleet with no value is averaged and flagged', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Tandem RDG Gap', venue: 'DBSC' });
  await createFleets(page, ['IRC', 'ECHO']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  await addCompetitor(page, 'T', 'Tandem', ['IRC', 'ECHO']);
  await addCompetitor(page, 'A', 'Alpha', ['IRC']);
  await addCompetitor(page, 'B', 'Bravo', ['ECHO']);

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();

  // Race 1: Tandem 1st (granted RDG below). Race 2: Tandem 1st in both fleets.
  await enterRace(page, 'Race 1', ['T', 'A', 'B']);
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await enterRace(page, 'Race 2', ['T', 'A', 'B']);
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();

  // RDG stated for IRC only; leave ECHO blank — a deliberate gap.
  await page.getByText('Race 1', { exact: true }).click();
  await page.getByRole('button', { name: 'Row actions for T' }).click();
  await page.getByRole('menuitem', { name: /redress \(RDG\)/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('scorer-stated points').click();
  await dialog.getByTestId('per-fleet-expand').click();
  await dialog.getByTestId('per-fleet-input-IRC').fill('8');
  // ECHO left blank.
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();

  await page.getByRole('link', { name: 'Standings' }).click();

  // IRC honours the stated value; ECHO surfaces the gap notice naming the boat.
  await expect(page.getByText('RDG(8)')).toBeVisible();
  await expect(page.getByText(/none set for this fleet/)).toBeVisible();
  await expect(page.getByText(/Tandem/).first()).toBeVisible();
});
