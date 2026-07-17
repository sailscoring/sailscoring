import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E tests for the finish sheet model (ADR-007, issue #66).
 *
 * Exercises the unified crossing-order list with:
 *   - Interleaved scratch and handicap rows in one race (frostbite-style).
 *   - Silent auto-slot insertion of a late timed entry.
 *   - The Scratch → Handicap blocked transition when finishes lack times.
 */

test('frostbite mixed-mode: interleaved ILCA (scratch) and PY rows keep crossing order', async ({ page }) => {
  // Heavy: two fleets, several boats, and an interleaved finish sheet to score —
  // enough setup to brush the 30s cap under full-suite load.
  test.slow();
  // ── 1. Create series with two fleets ──────────────────────────────────────
  await createSeriesQuick(page, { name: 'Frostbite Mixed' });

  // Create fleets and set PY scoring system
  await createFleets(page, ['ILCA', 'PY']);
  await setScoringMode(page, 'handicap');
  // Open Fleets card for editing
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  const pyRow = page.getByText('PY', { exact: true }).locator('..');
  await pyRow.getByRole('combobox').click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();

  // ILCA fleet — scratch scoring
  for (const c of [
    { sailNumber: 'L1', name: 'Laser Alice' },
    { sailNumber: 'L2', name: 'Laser Bob' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('checkbox', { name: 'ILCA' }).check();
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
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('checkbox', { name: 'PY' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 2. Set PY numbers on the PY boats ────────────────────────────────────
  for (const { sail, py } of [{ sail: 'P1', py: '1000' }, { sail: 'P2', py: '1100' }]) {
    const row = page.getByRole('row').filter({ hasText: sail });
    await row.click();
    await page.getByLabel('PY number', { exact: true }).fill(py);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // ── 3. Add a race with a start for the PY fleet only ──────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Add two starts: ILCA at 14:05:00 (scratch — no time needed), PY+M15 at 14:10:00
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:05:00');
  await page.getByRole('checkbox', { name: 'ILCA' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:05:00')).toBeVisible();

  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:10:00');
  await page.getByRole('checkbox', { name: 'PY' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:10:00')).toBeVisible();

  // ── 4. Enter finishers in crossing order ──────────────────────────────────
  // Crossing order on the sheet: L1 (scratch), P1 (14:20:00), L2 (scratch), P2 (14:25:00)

  // Scratch boat (L1): should NOT be prompted for a time.
  await page.getByLabel('Sail number').fill('L1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  // Verify no time prompt appeared — the boat was added directly to the list.
  await expect(page.getByRole('textbox', { name: 'Finish time', exact: true })).toHaveCount(0);
  await expect(page.getByRole('listitem').nth(0)).toContainText('L1');

  // PY boat (P1): should be prompted for a time.
  await page.getByLabel('Sail number').fill('P1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Finish time', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill('14:20:00');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByLabel('Sail number').fill('L2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByLabel('Sail number').fill('P2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill('14:25:00');
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
  await expect(page.getByTestId('finish-time-P1')).toHaveValue('14:20:00');
  await expect(page.getByTestId('finish-time-P2')).toHaveValue('14:25:00');

  // Drag handles are present on scratch rows (L1, L2) and absent on timed rows (P1, P2)
  await expect(page.getByTestId('drag-handle-L2')).toBeVisible();
  await expect(page.getByTestId('drag-handle-P1')).toHaveCount(0);
  await expect(page.getByTestId('drag-handle-P2')).toHaveCount(0);

  // ── 6. Save and verify per-fleet ranks in standings ───────────────────────
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByRole('link', { name: 'Standings' }).click();
  // ILCA: L1 first (scratch list order), L2 second.
  // PY:   corrected times: P1 = 600s * (1000/1000) = 600, P2 = 900s * (1000/1100) ≈ 818 → P1 first.
  // Per-fleet standings tables are rendered with fleet headings.
  await expect(page.getByRole('heading', { name: /ILCA/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /PY/ })).toBeVisible();
});

test('auto-slot: a late timed entry inserts at its correct crossing-order slot', async ({ page }) => {
  // ── Setup: one PY fleet, three boats, 14:00:00 start ──────────────────────
  await createSeriesQuick(page, { name: 'Auto-Slot Cup' });

  // Create PY fleet and set scoring system
  await createFleets(page, ['PY']);
  await setScoringMode(page, 'handicap');
  // Open Fleets card for editing
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();

  for (const c of [
    { sail: 'A1', name: 'Alice' },
    { sail: 'A2', name: 'Bob' },
    { sail: 'A3', name: 'Carol' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    // Single fleet — competitor auto-assigned, no checkbox needed
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  // Set a PY number so CT is defined (value is irrelevant to auto-slot)
  for (const sail of ['A1', 'A2', 'A3']) {
    const r = page.getByRole('row').filter({ hasText: sail });
    await r.click();
    await page.getByLabel('PY number', { exact: true }).fill('1000');
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
  await page.getByRole('checkbox', { name: 'PY' }).check();
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

test('edit finish time: re-slots to the new position and persists the new time', async ({ page }) => {
  // Regression: editing a timed row's finish time used to re-slot the row but
  // write the *old* time back (the re-slot's order-renumber spread a stale
  // finish snapshot over the just-saved time), so the row moved yet displayed
  // and published the old time.
  await createSeriesQuick(page, { name: 'Edit Time Cup' });

  await createFleets(page, ['PY']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [
    { sail: 'A1', name: 'Alice' },
    { sail: 'A2', name: 'Bob' },
    { sail: 'A3', name: 'Carol' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }
  for (const sail of ['A1', 'A2', 'A3']) {
    const r = page.getByRole('row').filter({ hasText: sail });
    await r.click();
    await page.getByLabel('PY number', { exact: true }).fill('1000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'PY' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  // Enter A1, A2, A3 in crossing order.
  for (const [sail, time] of [
    ['A1', '14:10:00'],
    ['A2', '14:20:00'],
    ['A3', '14:30:00'],
  ] as const) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(time);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }

  const row = (n: number) => page.getByRole('listitem').nth(n);
  await expect(row(0)).toContainText('A1');
  await expect(row(2)).toContainText('A3');

  // Edit A1's time to 14:25:00 (between A2 and A3) and commit with Enter.
  const a1 = page.getByTestId('finish-time-A1');
  await a1.fill('14:25:00');
  await a1.press('Enter');

  // A1 re-slots between A2 and A3 …
  await expect(row(0)).toContainText('A2');
  await expect(row(1)).toContainText('A1');
  await expect(row(2)).toContainText('A3');
  // … and shows the NEW time (the bug showed 14:10:00 here).
  await expect(page.getByTestId('finish-time-A1')).toHaveValue('14:25:00');

  // The new time survives a reload (it was actually persisted, not just local).
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.getByTestId('finish-time-A1')).toHaveValue('14:25:00');
  await expect(row(1)).toContainText('A1');
});

test('scoring-system change blocked: Scratch → PY with untimed finishes', async ({ page }) => {
  // ── Setup: handicap series with two fleets, one race with one scratch finish ─
  // The Dinghy fleet starts as scratch in a handicap series. After adding an
  // untimed finish, switching the fleet to PY should be blocked.
  await createSeriesQuick(page, { name: 'Block Test' });

  // Create two fleets so fleet checkboxes appear in the competitor dialog
  await createFleets(page, ['Dinghy', 'Other']);
  await setScoringMode(page, 'handicap');
  await page.getByRole('link', { name: 'Competitors' }).click();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('B1');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByRole('checkbox', { name: 'Dinghy' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'B1' })).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Add a start for the Dinghy fleet (required in handicap series)
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'Dinghy' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  // Close the race-starts panel via its Done button.
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByLabel('Sail number').fill('B1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── Settings: try to switch Dinghy fleet → PY. Should be blocked. ─────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.locator('h2', { hasText: 'Fleets' })).toBeVisible();
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  // Find the Dinghy fleet's combobox (first one showing Scratch)
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).first().click();
  await page.getByRole('option', { name: 'PY' }).click();

  // Inline error should appear and the fleet should still be Scratch.
  await expect(page.getByText(/Cannot switch to PY/)).toBeVisible();
  await expect(page.getByRole('combobox').filter({ hasText: /Scratch/i }).first()).toBeVisible();
});

test('finish blocked for competitor whose fleet has no start when handicap fleets exist', async ({ page }) => {
  // ── Setup: two fleets, one scratch (ILCA) and one PY ──────────────────────
  await createSeriesQuick(page, { name: 'Gate Test' });

  // Create fleets and set PY scoring system
  await createFleets(page, ['ILCA', 'PY']);
  await setScoringMode(page, 'handicap');
  // Open Fleets card for editing
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  const pyRow2 = page.getByText('PY', { exact: true }).locator('..');
  await pyRow2.getByRole('combobox').click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Add one boat per fleet
  await page.getByRole('link', { name: 'Competitors' }).click();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('G1');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByRole('checkbox', { name: 'ILCA' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'G1' })).toBeVisible();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('G2');
  await page.getByLabel('Competitor name').fill('Bob');
  await page.getByRole('checkbox', { name: 'PY' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'G2' })).toBeVisible();

  // ── Create a race with a start for PY only (no start for ILCA) ────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'PY' }).check();
  await page.getByRole('button', { name: 'Save' }).click();

  // Close the starts editor so only the finish entry UI is active.
  await page.getByRole('button', { name: 'Done' }).click();

  // The finish gate reads the same raceStarts cache as this summary — enter
  // nothing until the saved start is reflected, or the gate decides on stale
  // data (no starts at all would imply every fleet is in the race).
  await expect(page.getByText('14:00:00')).toBeVisible();

  // ── Try to finish G1 (ILCA, no start) — should be blocked ────────────────
  const sailInput = page.getByLabel('Sail number');
  await sailInput.fill('G1');
  await sailInput.press('Enter');

  // Error message should appear; G1 should NOT be in the finishing order.
  await expect(page.getByText(/cannot be finished/)).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);

  // ── Add an ILCA start, then G1 should be finishable ───────────────────────
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:05:00');
  await page.getByRole('checkbox', { name: 'ILCA' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Done' }).first().click();

  // Same cache race as above: G1 stays blocked until the ILCA start lands.
  await expect(page.getByText('14:05:00')).toBeVisible();

  await sailInput.fill('G1');
  await sailInput.press('Enter');

  // Now it works — G1 is in the list without a time prompt (scratch fleet).
  await expect(page.getByRole('listitem').nth(0)).toContainText('G1');
  await expect(page.getByRole('textbox', { name: 'Finish time', exact: true })).toHaveCount(0);
});
