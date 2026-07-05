import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick, downloadFleetHtml, enableFeatures, setScoringMode } from './helpers';

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['echo']);
});

/**
 * E2E tests for ECHO progressive handicap scoring (Phase 2 ECHO pass).
 *
 * Three boats in an ECHO fleet, α = 0.25 (the default 75/25 club split per
 * the Irish Sailing 2022 ECHO Guide). ECHO requires at least 3 finishers for
 * the rating update to fire (sample SI 12); 3 is the minimum.
 *
 * Race 1 (start 14:00, all H=1.000): A 50min, B 55min, C 60min.
 *   Engine emits PI = ΣH_S / (T_E × Σ(1/T_E)).
 *   New handicaps round to:  A → 1.023, B → 0.999, C → 0.978.
 *
 * Race 2 (same finish times) carries those handicaps as `Starting H` in the
 * ECHO column header.
 */

async function downloadStandingsHtml(page: import('@playwright/test').Page): Promise<string> {
  const download = await downloadFleetHtml(page);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

test('ECHO fleet: standings + propagation across two races', async ({ page }) => {
  // Heavy setup (three boats added then reopened to set starting handicaps, two
  // scored races) — same shape as the NHC/IRC/VPRS tests; headroom for the cap.
  test.slow();
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'ECHO Test 2026' });

  // ── 2. Set scoring mode → handicap, ECHO fleet, α defaults to 0.25 ────────
  await createFleets(page, ['ECHO']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'ECHO' }).click();
  await expect(page.getByTitle(/ECHO blend rate/)).toHaveValue('0.25');
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 3. Add 3 competitors, then edit each to set the ECHO starting handicap ─
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sailNumber, name } of [
    { sailNumber: 'Z1', name: 'Alpha' },
    { sailNumber: 'Z2', name: 'Bravo' },
    { sailNumber: 'Z3', name: 'Charlie' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }
  for (const sailNumber of ['Z1', 'Z2', 'Z3']) {
    const row = page.getByRole('row').filter({ hasText: sailNumber });
    await row.click();
    await expect(page.getByLabel('ECHO starting handicap', { exact: true })).toBeVisible();
    await page.getByLabel('ECHO starting handicap', { exact: true }).fill('1.000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }

  // ── 4. Add two races ──────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 2')).toBeVisible();

  // ── 5. Race 1: start 14:00; A 50min, B 55min, C 60min ─────────────────────
  await page.getByText('Race 1').click();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'ECHO' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  for (const { sailNumber, finishTime } of [
    { sailNumber: 'Z1', finishTime: '14:50:00' },
    { sailNumber: 'Z2', finishTime: '14:55:00' },
    { sailNumber: 'Z3', finishTime: '15:00:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 6. Race 2: same finishes (different starting H apply this race) ───────
  await page.getByText('Race 2').click();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'ECHO' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  for (const { sailNumber, finishTime } of [
    { sailNumber: 'Z1', finishTime: '14:50:00' },
    { sailNumber: 'Z2', finishTime: '14:55:00' },
    { sailNumber: 'Z3', finishTime: '15:00:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 7. Verify standings page shows ECHO label ────────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText(/ECHO/).first()).toBeVisible();

  // ── 8. Export HTML and assert ECHO fleet header + propagation ─────────────
  const html = await downloadStandingsHtml(page);
  expect(html).toContain('Rating system: ECHO');
  expect(html).toContain('α = 0.25');
  // Race 1 used the starting handicaps (1.000 each).
  // Race 2 used race 1's New H values: A → 1.023, B → 0.999, C → 0.978.
  // Each appears in the rendered "Starting H" / "TCF used" column for race 2.
  expect(html).toContain('1.023');
  expect(html).toContain('0.999');
  expect(html).toContain('0.978');
});
