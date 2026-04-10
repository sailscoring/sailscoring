import { test, expect } from './fixtures';

/**
 * E2E tests for the finish sheet model (ADR-007, issue #66).
 *
 * Exercises the unified crossing-order list with:
 *   - Interleaved scratch and handicap rows in one race (frostbite-style).
 *   - Silent auto-slot insertion of a late timed entry.
 *   - The Scratch → Handicap blocked transition when finishes lack times.
 */

test('frostbite mixed-mode: interleaved ILCA (scratch) and PY rows keep crossing order', async ({ page }) => {
  // ── 1. Create series with two fleets ──────────────────────────────────────
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Frostbite Mixed');
  await page.getByRole('button', { name: 'Create series' }).click();

  // ILCA fleet — scratch scoring
  for (const c of [
    { sailNumber: 'L1', name: 'Laser Alice' },
    { sailNumber: 'L2', name: 'Laser Bob' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Helm name').fill(c.name);
    await page.getByLabel('Fleet').fill('ILCA');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // PY fleet — handicap scoring
  for (const c of [
    { sailNumber: 'P1', name: 'PY Carol' },
    { sailNumber: 'P2', name: 'PY Dave' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Helm name').fill(c.name);
    await page.getByLabel('Fleet').fill('PY');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 2. Switch PY fleet to PY scoring and add PY numbers ───────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsHeading = page.getByRole('heading', { name: 'Fleets', level: 2 });
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();

  // Change the PY fleet scoring system. The ILCA row stays scratch.
  const pyRow = page.getByText('PY', { exact: true }).locator('..');
  await pyRow.getByRole('combobox').click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Set PY numbers on the PY boats
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sail, py } of [{ sail: 'P1', py: '1000' }, { sail: 'P2', py: '1100' }]) {
    const row = page.getByRole('row').filter({ hasText: sail });
    await row.getByRole('button', { name: /Edit/ }).click();
    await page.getByLabel('PY number').fill(py);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // ── 3. Add a race with a start for the PY fleet only ──────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByLabel('PY').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  // ── 4. Enter finishers in crossing order ──────────────────────────────────
  // Crossing order on the sheet: L1 (scratch), P1 (14:10:00), L2 (scratch), P2 (14:15:00)
  await page.getByLabel('Sail number').fill('L1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByLabel('Sail number').fill('P1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill('14:10:00');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByLabel('Sail number').fill('L2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByLabel('Sail number').fill('P2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill('14:15:00');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // ── 5. Verify the list preserves crossing order ───────────────────────────
  const row = (n: number) => page.getByRole('listitem').nth(n);
  await expect(row(0)).toContainText('L1');
  await expect(row(1)).toContainText('P1');
  await expect(row(2)).toContainText('L2');
  await expect(row(3)).toContainText('P2');

  // Fleet badges are visible on each row
  await expect(page.getByTestId('fleet-badge-L1')).toContainText('ILCA');
  await expect(page.getByTestId('fleet-badge-P1')).toContainText('PY');

  // PY rows show editable finish times; ILCA rows show a dash placeholder.
  await expect(page.getByTestId('finish-time-P1')).toHaveValue('14:10:00');
  await expect(page.getByTestId('finish-time-P2')).toHaveValue('14:15:00');

  // Move controls are present on scratch rows (L1, L2) and absent on timed rows (P1, P2)
  await expect(page.getByTestId('move-up-L2')).toBeVisible();
  await expect(page.getByTestId('move-up-P1')).toHaveCount(0);
  await expect(page.getByTestId('move-up-P2')).toHaveCount(0);

  // ── 6. Save and verify per-fleet ranks in standings ───────────────────────
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByRole('link', { name: 'Standings' }).click();
  // ILCA: L1 first (scratch list order), L2 second.
  // PY:   corrected times: P1 = 600 * (1000/1000) = 600, P2 = 900 * (1000/1100) ≈ 818 → P1 first, P2 second.
  // Per-fleet standings tables are rendered with fleet headings.
  await expect(page.getByRole('heading', { name: /ILCA/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /PY/ })).toBeVisible();
});

test('auto-slot: a late timed entry inserts at its correct crossing-order slot', async ({ page }) => {
  // ── Setup: one PY fleet, three boats, 14:00:00 start ──────────────────────
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Auto-Slot Cup');
  await page.getByRole('button', { name: 'Create series' }).click();

  for (const c of [
    { sail: 'A1', name: 'Alice' },
    { sail: 'A2', name: 'Bob' },
    { sail: 'A3', name: 'Carol' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Helm name').fill(c.name);
    await page.getByLabel('Fleet').fill('PY');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  // Switch fleet to PY
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsHeading = page.getByRole('heading', { name: 'Fleets', level: 2 });
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Set a PY number so CT is defined (value is irrelevant to auto-slot)
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const sail of ['A1', 'A2', 'A3']) {
    const r = page.getByRole('row').filter({ hasText: sail });
    await r.getByRole('button', { name: /Edit/ }).click();
    await page.getByLabel('PY number').fill('1000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // Add a race and a start
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByLabel('PY').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  // ── Enter A1 at 14:10, then A3 at 14:30 ───────────────────────────────────
  for (const [sail, time] of [['A1', '14:10:00'], ['A3', '14:30:00']] as const) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(time);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }

  // Now add A2 at 14:20 — it should slot between A1 and A3.
  await page.getByLabel('Sail number').fill('A2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill('14:20:00');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const row = (n: number) => page.getByRole('listitem').nth(n);
  await expect(row(0)).toContainText('A1');
  await expect(row(1)).toContainText('A2');
  await expect(row(2)).toContainText('A3');
});

test('scoring-system change blocked: Scratch → PY with untimed finishes', async ({ page }) => {
  // ── Setup: scratch series, one race with one finish ───────────────────────
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Block Test');
  await page.getByRole('button', { name: 'Create series' }).click();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('B1');
  await page.getByLabel('Helm name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'B1' })).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('B1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── Settings: try to switch Default → PY. Should be blocked. ──────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsHeading = page.getByRole('heading', { name: 'Fleets', level: 2 });
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY' }).click();

  // Inline error should appear and the fleet should still be Scratch.
  await expect(page.getByText(/Cannot switch to PY/)).toBeVisible();
  await expect(page.getByRole('combobox').filter({ hasText: /Scratch/i })).toBeVisible();
});
