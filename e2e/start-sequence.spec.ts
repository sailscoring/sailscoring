import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E for the default start-sequence editor and the new-race dialog (#75, #95).
 *
 * Configures three fleets at 5-minute intervals starting at 14:05:00 and asserts
 * the resolved start times are 14:05 / 14:10 / 14:15 — i.e. that intervals
 * accumulate correctly. Locks the bug from #95 where intervals stored as
 * cumulative offsets produced colliding start times.
 */

test('three-start sequence at 5-minute intervals resolves to distinct start times', async ({ page }) => {
  // Heavy: three fleets, scoring-mode change, a three-group start sequence,
  // then a materialised race — like its fleet-delete sibling below, the setup
  // alone can brush the 30s default under full-suite load.
  test.slow();
  await createSeriesQuick(page, { name: 'Start Sequence Test' });
  await createFleets(page, ['Class A', 'Class B', 'Class C']);
  await setScoringMode(page, 'handicap');

  // Open Settings ▸ Fleets to reveal the Default start sequence editor.
  const fleetsRow = page.locator('h2', { hasText: 'Fleets' }).locator('..');
  await fleetsRow.getByRole('button', { name: /Edit/ }).click();
  await expect(page.getByText('Default start sequence')).toBeVisible();

  // Build three start groups. Group 1 gets Class A (no interval input).
  // Group 2 gets Class B at +5 min after Start 1.
  // Group 3 gets Class C at +5 min after Start 2.
  // The combobox / number-input for a freshly-added row is always the last one
  // in DOM order — earlier rows already have their selectors filled in but
  // continue to render their own combobox while any fleet is unassigned.
  const editor = page.getByText('Default start sequence').locator('..');
  await editor.getByRole('button', { name: '+ Add start group' }).click();
  await editor.getByRole('combobox').last().click();
  await page.getByRole('option', { name: 'Class A' }).click();

  await editor.getByRole('button', { name: '+ Add start group' }).click();
  await editor.getByRole('combobox').last().click();
  await page.getByRole('option', { name: 'Class B' }).click();
  await editor.locator('input[type="number"]').last().fill('5');

  await editor.getByRole('button', { name: '+ Add start group' }).click();
  await editor.getByRole('combobox').last().click();
  await page.getByRole('option', { name: 'Class C' }).click();
  await editor.locator('input[type="number"]').last().fill('5');

  // Per-step interval label reads correctly after the fix to #95.
  await expect(editor.getByText(/min after Start 1/)).toBeVisible();
  await expect(editor.getByText(/min after Start 2/)).toBeVisible();

  await editor.getByRole('button', { name: 'Save sequence' }).click();
  // The button only renders while the editor is dirty, and it clears that
  // after the save resolves — so it unmounting is the signal that the
  // sequence is persisted and in the series cache the Races page reads.
  // Add race decides between the start-time dialog and creating a race
  // outright from that same data, so clicking too early takes the wrong
  // branch and no dialog ever opens.
  await expect(editor.getByRole('button', { name: 'Save sequence' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).first().click();

  // ── Add a race; the new-race dialog appears in handicap mode ──────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByLabel('First start time').fill('14:05:00');

  // Preview: three distinct resolved times, no collisions.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('14:05:00')).toBeVisible();
  await expect(dialog.getByText('14:10:00')).toBeVisible();
  await expect(dialog.getByText('14:15:00')).toBeVisible();

  await page.getByRole('button', { name: 'Create race' }).click();

  // Race detail view shows all three starts.
  await page.getByText('Race 1').click();
  await expect(page.getByText('14:05:00')).toBeVisible();
  await expect(page.getByText('14:10:00')).toBeVisible();
  await expect(page.getByText('14:15:00')).toBeVisible();
});

test('deleting a fleet strips it from the default start sequence and existing race starts', async ({ page }) => {
  // Heavy: three fleets, a multi-group start sequence, a materialised race, then
  // a fleet deletion — the setup can brush the 30s cap under full-suite load.
  test.slow();
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  await createSeriesQuick(page, { name: 'Fleet Delete Sequence Cleanup' });
  await createFleets(page, ['Class A', 'Class B', 'Class C']);
  await setScoringMode(page, 'handicap');

  // Build a sequence: Start 1 = Class A, Start 2 = Class B + Class C.
  const fleetsRow = page.locator('h2', { hasText: 'Fleets' }).locator('..');
  await fleetsRow.getByRole('button', { name: /Edit/ }).click();
  const editor = page.getByText('Default start sequence').locator('..');

  await editor.getByRole('button', { name: '+ Add start group' }).click();
  await editor.getByRole('combobox').last().click();
  await page.getByRole('option', { name: 'Class A' }).click();

  await editor.getByRole('button', { name: '+ Add start group' }).click();
  await editor.getByRole('combobox').last().click();
  await page.getByRole('option', { name: 'Class B' }).click();
  await editor.getByRole('combobox').last().click();
  await page.getByRole('option', { name: 'Class C' }).click();
  await editor.locator('input[type="number"]').last().fill('5');

  await editor.getByRole('button', { name: 'Save sequence' }).click();
  // See the sibling test: the Save button unmounting is the signal that the
  // sequence is persisted, and Add race picks its branch from that data.
  await expect(editor.getByRole('button', { name: 'Save sequence' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).first().click();

  // Create a race so the sequence gets materialised into raceStarts rows.
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByLabel('First start time').fill('14:05:00');
  await page.getByRole('button', { name: 'Create race' }).click();

  // Delete Class B from Settings. The trigger is the destructive × on its row;
  // the dialog confirms with a "Delete fleet" button.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  // Anchor on the target page before acting: App Router keeps the previous
  // page mounted until the new route's data resolves, and under full-suite
  // load an action fired too early can wait against the stale page.
  await expect(page).toHaveURL(/\/settings$/);
  await fleetsRow.getByRole('button', { name: /Edit/ }).click();
  const classBRow = page.locator('[data-testid="fleet-row"]').filter({ hasText: 'Class B' });
  await classBRow.getByTitle('Delete fleet').click();
  await page.getByRole('button', { name: 'Delete fleet' }).click();

  // Default start sequence editor: Class B gone, no orphan UUID chip.
  await expect(editor.getByText('Class B')).toHaveCount(0);
  await expect(editor.getByText(UUID_RE)).toHaveCount(0);
  await expect(editor.getByText('Class A')).toBeVisible();
  await expect(editor.getByText('Class C')).toBeVisible();

  // Race detail: the second start now reads "Class C" only — no orphan UUID.
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByText('Race 1').click();
  await expect(page.getByText(/14:05:00.*Class A/)).toBeVisible();
  await expect(page.getByText(/14:10:00.*Class C/)).toBeVisible();
  await expect(page.getByText(UUID_RE)).toHaveCount(0);
});
