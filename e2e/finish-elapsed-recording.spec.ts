import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * Recording a race off a stopwatch: the per-race mode switches the finish
 * sheet's time column from a time of day to an elapsed time, and the race
 * scores from what was written down.
 */

test('a stopwatch sheet records elapsed times and scores from them', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Stopwatch Cup' });

  await createFleets(page, ['PY']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [
    { sail: 'S1', name: 'Alice', py: '1000' },
    { sail: 'S2', name: 'Bob', py: '1100' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    // Single fleet — competitor auto-assigned, no checkbox needed.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: c.sail });
    await row.click();
    await page.getByLabel('PY number', { exact: true }).fill(c.py);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'PY' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  // ── Switch the sheet to elapsed times ────────────────────────────────────
  const mode = page.getByTestId('finish-recording-mode');
  await expect(mode).toBeVisible();
  await mode.click();
  await page.getByRole('option', { name: 'Elapsed times' }).click();
  await expect(mode).toContainText('Elapsed times');

  // ── Enter the sheet: a duration per boat, no time of day anywhere ────────
  await page.getByLabel('Sail number').fill('S1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const elapsedPrompt = page.getByRole('textbox', { name: 'Elapsed time', exact: true });
  await expect(elapsedPrompt).toBeVisible();
  await elapsedPrompt.fill('10:00');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByLabel('Sail number').fill('S2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await elapsedPrompt.fill('15:00');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByTestId('finish-time-S1')).toHaveValue('10:00');
  await expect(page.getByTestId('finish-time-S2')).toHaveValue('15:00');

  // The mode locks once the sheet carries times — the two are different
  // measurements and switching can't convert what's already written down.
  await expect(mode).toBeDisabled();

  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── The race scores from the elapsed times ───────────────────────────────
  // S1: 600 s × (1000/1000) = 600. S2: 900 s × (1000/1100) ≈ 818. S1 wins.
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  const rows = page.getByRole('row');
  // Alice ranks first and neither boat is DNF — which is what an unread
  // elapsed time would have scored them both.
  await expect(rows.filter({ hasText: 'Alice' })).toContainText('1');
  await expect(rows.filter({ hasText: 'Bob' })).toContainText('2');
  await expect(rows.filter({ hasText: 'Alice' })).not.toContainText('DNF');
  await expect(rows.filter({ hasText: 'Bob' })).not.toContainText('DNF');
});

test('a late elapsed entry slots into its crossing-order place', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Stopwatch Slotting' });

  await createFleets(page, ['PY']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [
    { sail: 'E1', name: 'Alice' },
    { sail: 'E2', name: 'Bob' },
    { sail: 'E3', name: 'Carol' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    // Single fleet — competitor auto-assigned, no checkbox needed.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: c.sail });
    await row.click();
    await page.getByLabel('PY number', { exact: true }).fill('1000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByRole('checkbox', { name: 'PY' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  await page.getByTestId('finish-recording-mode').click();
  await page.getByRole('option', { name: 'Elapsed times' }).click();

  const elapsedPrompt = page.getByRole('textbox', { name: 'Elapsed time', exact: true });
  // Entered out of order: the 12:00 boat is transcribed last but sailed the
  // race between the other two, so the sheet must put her second.
  for (const { sail, elapsed } of [
    { sail: 'E1', elapsed: '10:00' },
    { sail: 'E3', elapsed: '15:00' },
    { sail: 'E2', elapsed: '12:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await elapsedPrompt.fill(elapsed);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }

  const row = (n: number) => page.getByRole('listitem').nth(n);
  await expect(row(0)).toContainText('E1');
  await expect(row(1)).toContainText('E2');
  await expect(row(2)).toContainText('E3');
});
