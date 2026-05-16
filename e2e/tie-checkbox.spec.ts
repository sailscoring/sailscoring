import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E tests for the "tied with previous row" checkbox (RRS A8.1).
 * Covers issue #76: tie should not appear after timed rows,
 * and moving a tied row should clear the tie.
 */

test('tie checkbox: not shown after a timed row', async ({ page }) => {
  // ── Setup: mixed scratch + handicap series ────────────────────────────────
  await createSeriesQuick(page, { name: 'Tie After Timed' });

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

  // Scratch boat
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('S1');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByRole('checkbox', { name: 'ILCA' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'S1' })).toBeVisible();

  // PY boat
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('P1');
  await page.getByLabel('Competitor name').fill('Bob');
  await page.getByRole('checkbox', { name: 'PY' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'P1' })).toBeVisible();

  // Second scratch boat
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('S2');
  await page.getByLabel('Competitor name').fill('Carol');
  await page.getByRole('checkbox', { name: 'ILCA' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'S2' })).toBeVisible();

  // Set PY number
  const p1Row = page.getByRole('row').filter({ hasText: 'P1' });
  await p1Row.hover();
  await p1Row.getByRole('button', { name: /Edit/ }).click();
  await page.getByLabel('PY number', { exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Save' }).click();

  // ── Add race with starts ─────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'ILCA' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:05:00');
  await page.getByRole('checkbox', { name: 'PY' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:05:00')).toBeVisible();

  // ── Enter finishers: P1 (timed), then S2 (scratch) ───────────────────────
  await page.getByLabel('Sail number').fill('P1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill('14:20:00');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByLabel('Sail number').fill('S2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // S2 is a scratch row at index 1, but the previous row (P1) is timed.
  // The tie checkbox should NOT appear on S2.
  await expect(page.getByTestId('tie-S2')).toHaveCount(0);

  // Now add S1 — it's scratch at index 2, previous row S2 is also scratch.
  // The tie checkbox SHOULD appear.
  await page.getByLabel('Sail number').fill('S1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('tie-S1')).toBeVisible();
});

test('tie checkbox: moving a tied row clears the tie', async ({ page }) => {
  // ── Setup: scratch-only series, 4 boats ───────────────────────────────────
  await createSeriesQuick(page, { name: 'Tie Move Clear' });

  for (const c of [
    { sail: 'T1', name: 'Alice' },
    { sail: 'T2', name: 'Bob' },
    { sail: 'T3', name: 'Carol' },
    { sail: 'T4', name: 'Dave' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  // ── Add race and enter finishers T1, T2, T3, T4 ──────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  for (const sail of ['T1', 'T2', 'T3', 'T4']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }

  // Tick T2 as tied with T1 — wait for the Add saves to settle so the
  // controlled checkbox state survives concurrent in-flight mutations.
  // .click() rather than .check(): .check() retries the click if it
  // doesn't see the state transition immediately, and in autosave mode
  // the React re-render lands a tick after the native click — fast
  // enough for .toBeChecked() but slower than .check()'s tight loop.
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('tie-T2').click();
  await expect(page.getByTestId('tie-T2')).toBeChecked();

  // Move T2 down — tie should be cleared
  await page.getByTestId('move-down-T2').click();

  // T2 is now at index 2 (after T1, T3). Its tie should be cleared.
  await expect(page.getByTestId('tie-T2')).not.toBeChecked();
});

test('tie checkbox: moving group leader clears follower tie', async ({ page }) => {
  // If A, B (tied with A) and we move A down, B loses its tie
  // because A was the group leader.
  await createSeriesQuick(page, { name: 'Tie Leader Move' });

  for (const c of [
    { sail: 'X', name: 'Alice' },
    { sail: 'Y', name: 'Bob' },
    { sail: 'Z', name: 'Carol' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  for (const sail of ['X', 'Y', 'Z']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }

  // Tie Y with X
  // Wait for the Add saves to settle, then click (.check() is too eager —
  // see the comment in the previous test).
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('tie-Y').click();
  await expect(page.getByTestId('tie-Y')).toBeChecked();

  // Move X down — X was the group leader, so Y's tie should be cleared
  await page.getByTestId('move-down-X').click();

  // Order is now Y, X, Z. Y is at index 0 (no tie checkbox shown for first row).
  // X is at index 1 — verify its tie is not set either.
  await expect(page.getByTestId('tie-X')).not.toBeChecked();
});
