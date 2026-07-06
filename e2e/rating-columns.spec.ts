import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E test for issue #72: handicap rating column in the competitors list.
 *
 * Verifies that a Rating column appears in the competitors table when the
 * series has fleets using a non-scratch scoring system, and that scratch-only
 * series show no Rating column.
 */

test('rating columns appear for handicap fleets', async ({ page }) => {
  test.slow();
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
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  // ── 4. No Rating column yet (fleet is still scratch-scored) ─────────────
  const header = page.getByRole('row').first();
  await expect(header.getByRole('columnheader', { name: 'Rating' })).not.toBeVisible();

  // ── 5. Switch to handicap mode and change fleet scoring system to PY ──────
  await setScoringMode(page, 'handicap');
  // Open Fleets card for editing
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 6. Edit competitors to set PY numbers ────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();

  // Gate on the fleet-scoring change having propagated before opening the edit
  // dialog. The Rating column and the edit form's fleet data both come from the
  // same fleets query; navigating here can briefly serve the stale (scratch)
  // cache, in which case the form renders without the PY number field. The
  // Rating column appearing is the exact signal that the refetch has landed.
  await expect(header.getByRole('columnheader', { name: 'Rating' })).toBeVisible();

  const pyNumbers: Record<string, string> = { PY1: '1034', PY2: '1087' };
  for (const sail of ['PY1', 'PY2']) {
    const row = page.getByRole('row').filter({ hasText: sail });
    await row.click();
    await page.getByLabel('PY number', { exact: true }).fill(pyNumbers[sail]);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // ── 7. Rating column now visible with correct values ─────────────────────
  await expect(header.getByRole('columnheader', { name: 'Rating' })).toBeVisible();

  // Single-system series: cells show the bare value, no system label suffix.
  const py1Row = page.getByRole('row').filter({ hasText: 'PY1' });
  const py2Row = page.getByRole('row').filter({ hasText: 'PY2' });
  await expect(py1Row).toContainText('1034');
  await expect(py2Row).toContainText('1087');
});
