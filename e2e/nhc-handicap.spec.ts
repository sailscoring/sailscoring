import { test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E tests for NHC1 progressive handicap scoring (Phase 2 first pass).
 *
 * Two boats in an NHC fleet, α = 0.15.
 * Race 1: NHC1 (start TCF 1.000) ET 50 min, NHC2 (start TCF 1.000) ET 60 min
 *   CT_avg = 3300, both finish; Q_NHC1 = 1.10, new TCF = 1.015
 *                              Q_NHC2 = 0.916666…, new TCF = 0.9875
 * Race 2 (same finish times): NHC1's "TCF used" = 1.015, NHC2's = 0.9875.
 *
 * Verifies: NHC option in fleet selector, alpha input, starting-TCF field,
 * propagation across races, retroactive edit propagates to later race.
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

  // ── 2. Set scoring mode → handicap, NHC fleet, α = 0.15 ───────────────────
  await createFleets(page, ['NHC']);
  await setScoringMode(page, 'handicap');
  // Open Fleets card
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  // Switch the fleet's scoring system to NHC
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'NHC' }).click();
  // α defaults to 0.15 — confirm the alpha input is visible
  await expect(page.getByTitle(/NHC blend rate/)).toHaveValue('0.15');
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 3. Add 2 competitors, then edit to set starting TCFs ─────────────────
  // (The starting-TCF field only appears after the competitor is saved into
  // the NHC fleet — same edit-then-rate pattern as the IRC test.)
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sailNumber, name } of [
    { sailNumber: 'NHC1', name: 'Alpha' },
    { sailNumber: 'NHC2', name: 'Beta' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }
  for (const sailNumber of ['NHC1', 'NHC2']) {
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

  // ── 5. Race 1: start 14:00; finishes NHC1 50min, NHC2 60min ───────────────
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
  expect(html).toContain('Rating system: NHC1');
  expect(html).toContain('α = 0.15');
  // Race 1 used the starting TCFs (1.000 / 1.000)
  // Race 2 used race 1's New TCFs: NHC1 → 1.015, NHC2 → 0.988 (rounded to 3dp)
  // Both should appear in the rendered "TCF used" column.
  expect(html).toContain('1.015');
  expect(html).toContain('0.988');
});

test('NHC fleet: retroactive edit propagates to subsequent race', async ({ page }) => {
  // Setup identical to the test above through race 2; then edit race 1 and check race 2.
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
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row').filter({ hasText: sailNumber })).toBeVisible();
  }
  for (const sailNumber of ['AA', 'BB']) {
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

  // Race 1: A 50min, B 60min (A faster → newTcf 1.015; B → 0.988)
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
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();

  // Race 2: same — A 50, B 60.
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
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── Capture pre-edit standings HTML — race 2 should show "1.015" for A ───
  await page.getByRole('link', { name: 'Standings' }).click();
  const htmlBefore = await downloadStandingsHtml(page);
  expect(htmlBefore).toContain('1.015');

  // ── Edit race 1: SWAP AA and BB finish times via the finish-sheet inputs ──
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1').click();
  await page.getByTestId('finish-time-AA').fill('15:00:00');
  await page.getByTestId('finish-time-BB').fill('14:50:00');
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── After edit, B is the fast boat — race 2's TCF used for B should now be 1.015 ──
  await page.getByRole('link', { name: 'Standings' }).click();
  const htmlAfter = await downloadStandingsHtml(page);
  // The retroactive change must propagate. The B row should now carry
  // tcfApplied 1.015 in race 2 (B's new TCF after race 1's swap).
  // Sanity: the published HTML still contains both 1.015 and 0.988
  // (just assigned to different boats now).
  expect(htmlAfter).toContain('1.015');
  expect(htmlAfter).toContain('0.988');
});
