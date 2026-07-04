import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Update Handicaps dialog (#144) end-to-end via the NHC path — the
 * headline use case from #143 (HYC's NHC tuning experiment).
 *
 * Unlike the IRC e2e, which exercises only the "read current value off
 * the source competitor" path, this test goes through the full
 * resolver/history-loading chain:
 *
 *   1. Source series with one scored NHC race produces TcfRecord rows
 *      whose newTcf values diverge from the starting 1.000.
 *   2. Target series with the same three boats at the same starting
 *      1.000 → all three should be flagged as `change` rows.
 *   3. After applying, the target competitor list shows the carried-over
 *      TCFs.
 */

async function configureNhcFleet(page: Page, fleetName: string): Promise<void> {
  await createFleets(page, [fleetName]);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'NHC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
}

async function addBoatWithNhcStartingTcf(
  page: Page,
  sailNumber: string,
  name: string,
  startingTcf: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill(sailNumber);
  await page.getByLabel('Competitor name').fill(name);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  // The starting-TCF field only renders in the edit dialog for a saved boat,
  // so reopen the row to set it.
  const row = page.getByRole('row').filter({ hasText: sailNumber });
  await row.click();
  const editDialog = page.getByRole('dialog', { name: 'Edit competitor' });
  await editDialog.getByLabel('NHC starting TCF', { exact: true }).fill(startingTcf);
  await editDialog.getByRole('button', { name: 'Save' }).click();
  // Sync on the dialog actually closing before reading the row back: an open
  // dialog aria-hides the table behind it, so the cell drops out of the
  // accessibility tree until the (under load, laggy) save settles. Waiting on
  // the cell alone raced that — allow the settle a generous window.
  await expect(editDialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
}

async function scoreOneNhcRace(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'NHC' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  // Finish times spread enough to produce a non-trivial extreme spread
  // (over/under-performers under SWNHC2015).
  for (const { sailNumber, finishTime } of [
    { sailNumber: 'NHC1', finishTime: '14:50:00' },
    { sailNumber: 'NHC2', finishTime: '15:00:00' },
    { sailNumber: 'NHC3', finishTime: '15:10:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
}

test('Update Handicaps dialog: carry NHC TCFs from a scored source series', async ({ page }) => {
  // Long by nature: six boats each set up in two steps (add, then reopen to set
  // the starting TCF), a scored race, and the full update-handicaps flow. Under
  // full-suite DB contention the setup alone approached the 30s default and
  // occasionally tipped over it. Triple the budget rather than race the cap.
  test.slow();
  // ── 1. Source series, NHC fleet, scored race ──────────────────────────────
  await createSeriesQuick(page, { name: 'NHC Source 2026' });
  await configureNhcFleet(page, 'NHC');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await addBoatWithNhcStartingTcf(page, 'NHC1', 'Alpha', '1.000');
  await addBoatWithNhcStartingTcf(page, 'NHC2', 'Beta',  '1.000');
  await addBoatWithNhcStartingTcf(page, 'NHC3', 'Gamma', '1.000');
  await scoreOneNhcRace(page);

  // ── 2. Target series, same boats with the same starting TCFs ──────────────
  await page.goto('/');
  await createSeriesQuick(page, { name: 'NHC Target 2026' });
  await configureNhcFleet(page, 'NHC');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await addBoatWithNhcStartingTcf(page, 'NHC1', 'Alpha', '1.000');
  await addBoatWithNhcStartingTcf(page, 'NHC2', 'Beta',  '1.000');
  await addBoatWithNhcStartingTcf(page, 'NHC3', 'Gamma', '1.000');

  // ── 3. Carry the source's end-of-race TCFs into the target ───────────────
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('combobox').filter({ hasText: 'Pick a series' }).click();
  await page.getByRole('option', { name: 'NHC Source 2026' }).click();

  // All three boats moved away from 1.000 — the source race spread is wide
  // enough that even the average boat shifts a few thousandths.
  await expect(page.getByText(/Preview: 3 changes/)).toBeVisible();

  await page.getByRole('button', { name: /Apply 3/ }).click();
  await expect(page.getByRole('heading', { name: 'Handicaps updated' })).toBeVisible();
  await expect(page.getByText(/Updated/).filter({ hasText: /3/ })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  // ── 4. Verify NHC1's starting TCF in the target was overwritten ───────────
  // Pin via the edit dialog rather than the rating column (which renders
  // differently across competitors): the edit form's "NHC starting TCF"
  // field is the source of truth and is easy to read back.
  const row = page.getByRole('row').filter({ hasText: 'NHC1' });
  await row.click();
  const tcfField = page.getByLabel('NHC starting TCF', { exact: true });
  await expect(tcfField).toBeVisible();
  const updatedValue = await tcfField.inputValue();
  // The original was 1.000; any change confirms the bulk update applied.
  // Exact values are unit-tested in tests/scoring.test.ts.
  expect(updatedValue).not.toBe('1.000');
  expect(updatedValue).not.toBe('1');
  expect(parseFloat(updatedValue)).toBeGreaterThan(0);
});
