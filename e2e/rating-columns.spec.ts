import { test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E test for issue #72: handicap rating columns in competitors list.
 *
 * Verifies that PY / IRC TCC columns appear in the competitors table
 * when the series has fleets using those scoring systems, and that
 * scratch-only series show no rating columns.
 */

test('rating columns appear for handicap fleets', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Rating Columns Test' });

  // ── 2. Create PY fleet ───────────────────────────────────────────────────
  await createFleets(page, ['PY']);
  await page.getByRole('link', { name: 'Competitors' }).click();

  // ── 3. Add two competitors in the PY fleet ───────────────────────────────
  for (const c of [
    { sail: 'PY1', name: 'Alice' },
    { sail: 'PY2', name: 'Bob' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Helm name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  // ── 4. No rating columns yet (fleet is still scratch-scored) ─────────────
  const header = page.getByRole('row').first();
  await expect(header.getByRole('columnheader', { name: 'PY' })).not.toBeVisible();
  await expect(header.getByRole('columnheader', { name: 'IRC TCC' })).not.toBeVisible();

  // ── 5. Switch to handicap mode and change fleet scoring system to PY ──────
  await setScoringMode(page, 'handicap');
  // Open Fleets card for editing
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 6. Edit competitors to set PY numbers ────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();

  const pyNumbers: Record<string, string> = { PY1: '1034', PY2: '1087' };
  for (const sail of ['PY1', 'PY2']) {
    const row = page.getByRole('row').filter({ hasText: sail });
    await row.getByRole('button', { name: /Edit/ }).click();
    await page.getByLabel('PY number').fill(pyNumbers[sail]);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // ── 7. PY column now visible with correct values ─────────────────────────
  await expect(header.getByRole('columnheader', { name: 'PY' })).toBeVisible();
  // IRC column should NOT appear (no IRC fleet)
  await expect(header.getByRole('columnheader', { name: 'IRC TCC' })).not.toBeVisible();

  // Check rating values in each row
  const py1Row = page.getByRole('row').filter({ hasText: 'PY1' });
  const py2Row = page.getByRole('row').filter({ hasText: 'PY2' });
  await expect(py1Row).toContainText('1034');
  await expect(py2Row).toContainText('1087');
});
