import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * Mixed laps: one start, the slow boat sent round once while the rest go
 * round twice. Turning laps on asks for the full course and writes it on
 * every timed row; the scorer edits the short boat down, and the race scores
 * her on the full course — Bray's Winter Series 2024/25 Race 11, where the
 * Hansa that crossed first corrects last.
 */

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['mixed-laps']);
});

test('a boat on fewer laps is scored on the full course', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Winter Laps' });

  await createFleets(page, ['Mixed PY']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [
    { sail: '3639', name: 'Colbert', py: '1026' },
    { sail: '1888', name: 'Mary', py: '1434' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
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
  await page.getByPlaceholder('14:05', { exact: true }).fill('10:00:00');
  await page.getByRole('checkbox', { name: 'Mixed PY' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('10:00:00')).toBeVisible();

  // The Laps control waits for a finisher to write the count on.
  await expect(page.getByTestId('turn-on-laps')).toBeDisabled();

  const timePrompt = page.getByRole('textbox', { name: 'Finish time', exact: true });
  for (const { sail, time } of [
    { sail: '1888', time: '10:23:41' },
    { sail: '3639', time: '10:26:15' },
  ]) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await timePrompt.fill(time);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId(`finish-time-${sail}`)).toHaveValue(time);
  }

  // ── Turn laps on: two laps for the full course, on every row ─────────────
  await page.getByTestId('turn-on-laps').click();
  await page.getByTestId('full-course-laps').fill('2');
  await page.getByRole('button', { name: 'Set', exact: true }).click();
  await expect(page.getByTestId('laps-3639')).toHaveValue('2');
  await expect(page.getByTestId('laps-1888')).toHaveValue('2');

  // ── The Hansa sailed one ─────────────────────────────────────────────────
  await page.getByTestId('laps-1888').fill('1');
  await page.getByTestId('laps-1888').press('Enter');
  await expect(page.getByTestId('laps-1888')).toHaveValue('1');
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // A count survives a reload: it is on the finish row, not in the page.
  await page.reload();
  await expect(page.getByTestId('laps-1888')).toHaveValue('1');
  await expect(page.getByTestId('laps-3639')).toHaveValue('2');

  // ── Scored on the full course ────────────────────────────────────────────
  // 3639: 1575 s × 1000/1026 = 1535. 1888: 1421 s × 2 × 1000/1434 = 1982.
  // Over the one lap she sailed she would have corrected to 991 and won.
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'Colbert' })).toContainText('1');
  await expect(rows.filter({ hasText: 'Mary' })).toContainText('2');
});
