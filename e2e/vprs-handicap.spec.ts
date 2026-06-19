import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * E2E for VPRS time-corrected handicap scoring (#175).
 *
 * VPRS is scored time-on-time exactly like IRC (CT = ET × TCC). Three boats in
 * a VPRS fleet start at 14:00:00, with real Dublin Bay SC 2026 spinnaker TCCs:
 *
 *   IRL216  Gung-Ho   TCC 0.855  finish 15:08:10 → ET 4090 → CT 3497 → 1st
 *   IRL1725 Optique   TCC 1.003  finish 14:58:18 → ET 3498 → CT 3508 → 2nd
 *   IRL1367 Boomerang TCC 0.992  finish 14:59:00 → ET 3540 → CT 3512 → 3rd
 *
 * Gung-Ho crosses the line last but wins on handicap.
 *
 * VPRS is a gated, opt-in feature, so the workspace enables it first.
 */

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['vprs']);
});

test('VPRS fleet: standings ordered by corrected time', async ({ page }) => {
  await createSeriesQuick(page, { name: 'VPRS Test 2026' });

  // VPRS fleet in handicap mode.
  await createFleets(page, ['VPRS']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'VPRS' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Three boats.
  await page.getByRole('link', { name: 'Competitors' }).click();
  const boats = [
    { sailNumber: 'IRL216', name: 'Gung-Ho' },
    { sailNumber: 'IRL1725', name: 'Optique' },
    { sailNumber: 'IRL1367', name: 'Boomerang' },
  ];
  for (const c of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // Add VPRS TCCs via the edit dialog (the "VPRS TCC" field shows for VPRS fleets).
  const tccs: Record<string, string> = { IRL216: '0.855', IRL1725: '1.003', IRL1367: '0.992' };
  for (const c of boats) {
    const row = page.getByRole('row').filter({ hasText: c.sailNumber });
    await row.click();
    await expect(page.getByLabel('VPRS TCC', { exact: true })).toBeVisible();
    await page.getByLabel('VPRS TCC', { exact: true }).fill(tccs[c.sailNumber]);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // Add a race.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  // Start time 14:00:00 for the VPRS fleet.
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'VPRS' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  // Finish times.
  for (const { sailNumber, finishTime } of [
    { sailNumber: 'IRL1725', finishTime: '14:58:18' },
    { sailNumber: 'IRL1367', finishTime: '14:59:00' },
    { sailNumber: 'IRL216', finishTime: '15:08:10' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }

  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Standings: Gung-Ho (lowest CT) first, Boomerang (highest CT) last.
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText(/VPRS/)).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toContainText('IRL216');
  await expect(page.getByRole('row').nth(3)).toContainText('IRL1367');
});
