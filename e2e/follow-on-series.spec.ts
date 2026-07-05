import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';
import type { Page } from '@playwright/test';

/**
 * "Create follow-on series" (#201): roll a scored NHC series into the next
 * one of the season from the series-list row menu. The follow-on carries
 * the fleet and competitors but no races, and each boat's NHC starting TCF
 * is seeded from its end-of-series TCF in the source — verified here by the
 * value moving away from the 1.000 every boat started on.
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
  const row = page.getByRole('row').filter({ hasText: sailNumber });
  await row.click();
  await expect(page.getByLabel('NHC starting TCF', { exact: true })).toBeVisible();
  await page.getByLabel('NHC starting TCF', { exact: true }).fill(startingTcf);
  await page.getByRole('button', { name: 'Save' }).click();
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

  // Finish times spread enough that every boat's TCF moves off 1.000.
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

test('roll a scored NHC series into a follow-on with seeded handicaps', async ({ page, signedInEmail }) => {
  // Heavy: a full NHC series (three boats set up two-step, a scored race) is
  // built before the follow-on is even created — headroom for the 30s cap.
  test.slow();
  await enableFeatures(page, signedInEmail, ['follow-on-series']);

  // ── 1. Source series: NHC fleet, three boats at 1.000, one scored race ────
  await createSeriesQuick(page, { name: 'Spring Series 1' });
  await configureNhcFleet(page, 'NHC');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await addBoatWithNhcStartingTcf(page, 'NHC1', 'Alpha', '1.000');
  await addBoatWithNhcStartingTcf(page, 'NHC2', 'Beta',  '1.000');
  await addBoatWithNhcStartingTcf(page, 'NHC3', 'Gamma', '1.000');
  await scoreOneNhcRace(page);

  // ── 2. Create the follow-on from the series-list row menu ─────────────────
  await page.goto('/');
  await page.getByRole('button', { name: 'Actions for Spring Series 1' }).click();
  await page.getByRole('menuitem', { name: 'Create follow-on series…' }).click();

  // The name suggestion increments the trailing number.
  await expect(page.getByLabel('Name')).toHaveValue('Spring Series 2');
  await page.getByLabel('Start date').fill('2026-06-01');
  await page.getByTestId('follow-on-submit').click();

  // ── 3. Lands on the new series's Competitors tab with provenance ──────────
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
  await expect(page.getByTestId('follow-on-provenance')).toContainText(
    'carried forward from Spring Series 1',
  );
  for (const sail of ['NHC1', 'NHC2', 'NHC3']) {
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // ── 4. Seeded starting TCF moved off the source's 1.000 ───────────────────
  await page.getByRole('row').filter({ hasText: 'NHC1' }).click();
  const tcfField = page.getByLabel('NHC starting TCF', { exact: true });
  await expect(tcfField).toBeVisible();
  const seededValue = await tcfField.inputValue();
  expect(seededValue).not.toBe('1.000');
  expect(seededValue).not.toBe('1');
  expect(parseFloat(seededValue)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ── 5. No races came along ─────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByText('No races yet')).toBeVisible();
});
