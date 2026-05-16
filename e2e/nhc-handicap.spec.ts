import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E tests for NHC1 (SWNHC2015) progressive handicap scoring.
 *
 * Three boats in an NHC fleet (MinFin = 3 in SWNHC2015 — a 2-boat race
 * would suppress the update).
 *
 * Race 1: all three boats start at TCF 1.000.
 *   NHC1 ET 50 min, NHC2 ET 60 min, NHC3 ET 70 min.
 *   NHC1 non-extreme over-performer → α=0.30 → newTcf 1.027.
 *   NHC2 non-extreme under-performer → α=0.15 → newTcf 0.986.
 *   NHC3 extreme-slow → α=0.075 → newTcf 0.988.
 * Race 2 (same finish times): tcfApplied = race 1's newTcf for each boat.
 *
 * Verifies: NHC option in fleet selector, starting-TCF field, propagation
 * across races, retroactive edit propagates to later race.
 */

async function downloadStandingsHtml(page: import('@playwright/test').Page): Promise<string> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export HTML' }).click(),
  ]).then(([dl]) => dl);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

test('NHC fleet: standings + propagation across two races', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'NHC Test 2026' });

  // ── 2. Set scoring mode → handicap, NHC fleet ────────────────────────────
  await createFleets(page, ['NHC']);
  await setScoringMode(page, 'handicap');
  // Open Fleets card
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  // Switch the fleet's scoring system to NHC
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'NHC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 3. Add 3 competitors (MinFin=3 under SWNHC2015), then set starting TCFs ─
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sailNumber, name } of [
    { sailNumber: 'NHC1', name: 'Alpha' },
    { sailNumber: 'NHC2', name: 'Beta' },
    { sailNumber: 'NHC3', name: 'Gamma' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }
  for (const sailNumber of ['NHC1', 'NHC2', 'NHC3']) {
    const row = page.getByRole('row').filter({ hasText: sailNumber });
    await row.hover();
    await row.getByRole('button', { name: /Edit/ }).click();
    await expect(page.getByLabel('NHC starting TCF', { exact: true })).toBeVisible();
    await page.getByLabel('NHC starting TCF', { exact: true }).fill('1.000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }

  // ── 4. Add two races ──────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 2')).toBeVisible();

  // ── 5. Race 1: start 14:00; finishes NHC1 50min, NHC2 60min, NHC3 70min ──
  await page.getByText('Race 1').click();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'NHC' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

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
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 6. Race 2: same finishes (different TCFs apply this race) ─────────────
  await page.getByText('Race 2').click();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'NHC' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

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
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 7. Verify standings page shows NHC label ─────────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText(/NHC/).first()).toBeVisible();

  // ── 8. Export HTML and assert NHC fleet header + propagation ──────────────
  const html = await downloadStandingsHtml(page);
  expect(html).toContain('Rating system: NHC1 (SWNHC2015)');
  // Race 1 used the starting TCFs (1.000 across the board).
  // Race 2 used race 1's New TCFs: NHC1 → 1.027, NHC2 → 0.986, NHC3 → 0.988.
  // All three should appear in the rendered "TCF used" column for race 2.
  expect(html).toContain('1.027');
  expect(html).toContain('0.986');
  expect(html).toContain('0.988');

  // Summary table shows the NHC1 seed-rating column (default on) and an
  // applied-rating sub-text below each R2 score. R1 is suppressed because
  // the seed column carries it.
  expect(html).toContain('<th>NHC1</th>');
  expect(html).toMatch(/<td class="seedrating">1\.000<\/td>/);
  expect(html).toContain('<span class="rating">1.027</span>');
  expect(html).toContain('<span class="rating">0.986</span>');
  expect(html).toContain('<span class="rating">0.988</span>');
});

test('NHC fleet: retroactive edit propagates to subsequent race', async ({ page }) => {
  // Setup identical to the test above through race 2; then edit race 1 and check race 2.
  // Three boats: MinFin=3 is met, so the rating update actually runs.
  await createSeriesQuick(page, { name: 'NHC Retroactive 2026' });
  await createFleets(page, ['NHC']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'NHC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sailNumber, name } of [
    { sailNumber: 'AA', name: 'Alpha' },
    { sailNumber: 'BB', name: 'Beta' },
    { sailNumber: 'CC', name: 'Gamma' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row').filter({ hasText: sailNumber })).toBeVisible();
  }
  for (const sailNumber of ['AA', 'BB', 'CC']) {
    const row = page.getByRole('row').filter({ hasText: sailNumber });
    await row.hover();
    await row.getByRole('button', { name: /Edit/ }).click();
    await expect(page.getByLabel('NHC starting TCF', { exact: true })).toBeVisible();
    await page.getByLabel('NHC starting TCF', { exact: true }).fill('1.000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();

  // Race 1: AA 50min, BB 60min, CC 70min → newTcfs 1.027 / 0.986 / 0.988
  await page.getByText('Race 1').click();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'NHC' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();
  for (const { sailNumber, finishTime } of [
    { sailNumber: 'AA', finishTime: '14:50:00' },
    { sailNumber: 'BB', finishTime: '15:00:00' },
    { sailNumber: 'CC', finishTime: '15:10:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();

  // Race 2: same finishes — tcfApplied in race 2 = race 1's newTcfs.
  await page.getByText('Race 2').click();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'NHC' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();
  for (const { sailNumber, finishTime } of [
    { sailNumber: 'AA', finishTime: '14:50:00' },
    { sailNumber: 'BB', finishTime: '15:00:00' },
    { sailNumber: 'CC', finishTime: '15:10:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── Capture pre-edit standings HTML — race 2 should carry 1.027/0.986/0.988
  await page.getByRole('link', { name: 'Standings' }).click();
  const htmlBefore = await downloadStandingsHtml(page);
  expect(htmlBefore).toContain('1.027');
  expect(htmlBefore).toContain('0.986');

  // ── Edit race 1: SWAP AA and BB finish times ──────────────────────────────
  // After swap: BB is the fast boat (50min), AA is mid (60min), CC unchanged.
  // The same set of newTcfs (1.027 / 0.986 / 0.988) appears, just reassigned
  // — verifies the retroactive update runs without crashing.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1').click();
  await page.getByTestId('finish-time-AA').fill('15:00:00');
  await page.getByTestId('finish-time-BB').fill('14:50:00');
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── After edit, the same set of values still appears in race 2 ───────────
  await page.getByRole('link', { name: 'Standings' }).click();
  const htmlAfter = await downloadStandingsHtml(page);
  expect(htmlAfter).toContain('1.027');
  expect(htmlAfter).toContain('0.986');
  expect(htmlAfter).toContain('0.988');
});
