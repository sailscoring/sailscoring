import type { Page } from '@playwright/test';

import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E test for issue #72: handicap rating column in the competitors list.
 *
 * Verifies that a Rating column appears in the competitors table when the
 * series has fleets using a non-scratch scoring system, and that scratch-only
 * series show no Rating column, and (issue #381) that the multiplier ratings
 * are shown to three decimal places.
 */

/** Switch the series to handicap mode and move its only fleet onto `system`,
 *  from the Settings tab. */
async function useScoringSystem(
  page: Page,
  system: 'PY' | 'IRC',
  code: 'py' | 'irc',
): Promise<void> {
  await setScoringMode(page, 'handicap');
  // Open Fleets card for editing
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  // Changing the scoring system is a fire-and-forget fleet PUT. Wait for it to
  // persist before moving on: without this, navigating to Competitors and
  // reading the fleets query can race the write, and the edit form (whose
  // rating field only appears once it sees the fleet's scoring system) can
  // render against the stale (scratch) fleet and never show the field.
  await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/api\/v1\/series\/[^/]+\/fleets\//.test(r.url()) &&
        r.request().method() === 'PUT' &&
        r.ok() &&
        (r.request().postData() ?? '').includes(`"scoringSystem":"${code}"`),
    ),
    page.getByRole('option', { name: system, exact: true }).click(),
  ]);
  await page.getByRole('button', { name: 'Done' }).click();
}

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
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  // ── 4. No Rating column yet (fleet is still scratch-scored) ─────────────
  const header = page.getByRole('row').first();
  await expect(header.getByRole('columnheader', { name: 'Rating' })).not.toBeVisible();

  // ── 5. Switch to handicap mode and change fleet scoring system to PY ──────
  await useScoringSystem(page, 'PY', 'py');

  // ── 6. Edit competitors to set PY numbers ────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();

  // The Rating column appearing is the exact signal the PY scoring change is
  // live in the page's fleet data.
  await expect(header.getByRole('columnheader', { name: 'Rating' })).toBeVisible();

  const pyNumbers: Record<string, string> = { PY1: '1034', PY2: '1087' };
  const dialog = page.getByRole('dialog', { name: 'Edit competitor' });
  for (const sail of ['PY1', 'PY2']) {
    // Start each edit from a fully-closed dialog. After saving the first
    // competitor the dialog animates shut; without this wait the next iteration
    // could see the still-closing dialog as "open", skip the row click, and
    // then wait out the budget on a PY field that's about to unmount.
    await expect(dialog).not.toBeVisible();
    const row = page.getByRole('row').filter({ hasText: sail });
    const pyField = dialog.getByLabel('PY number', { exact: true });
    // The row can re-render (queries refetch settling after the previous save)
    // between hit-test and dispatch, swallowing the click — the edit dialog
    // then never opens and the fill below waits out the whole test budget.
    // Re-click until the PY field is actually there, but only while the dialog
    // is still closed: once it's open, clicking the row again just hangs on
    // actionability (the overlay intercepts the pointer).
    await expect(async () => {
      if (!(await dialog.isVisible())) await row.click();
      await expect(pyField).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await pyField.fill(pyNumbers[sail]);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).not.toBeVisible();
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

test('IRC ratings are shown to three decimal places', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Rating Decimals Test' });
  await createFleets(page, ['IRC']);
  await useScoringSystem(page, 'IRC', 'irc');

  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('IRL 1');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'IRL 1' })).toBeVisible();

  // The Rating column appearing is the signal the IRC scoring change is live
  // in the page's fleet data, so the edit dialog will offer the TCC field.
  const header = page.getByRole('row').first();
  await expect(header.getByRole('columnheader', { name: 'Rating' })).toBeVisible();

  // A certificate reads 1.130; typing it without the trailing zero must still
  // display as 1.130.
  const dialog = page.getByRole('dialog', { name: 'Edit competitor' });
  const row = page.getByRole('row').filter({ hasText: 'IRL 1' });
  const tccField = dialog.getByLabel('IRC TCC', { exact: true });
  // Same re-render race as the PY test above: the row can swallow the click
  // while queries settle, so re-click until the dialog is actually open.
  await expect(async () => {
    if (!(await dialog.isVisible())) await row.click();
    await expect(tccField).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await tccField.fill('1.13');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).not.toBeVisible();

  await expect(row).toContainText('1.130');
});
