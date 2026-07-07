import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for bow-number matching in finish entry (issue #234).
 *
 * When a boat's bow number differs from its registered sail number (a borrowed
 * hull, say) the recorders often write the bow number on the finish sheet.
 * With the optional Bow number field enabled, typing the bow number resolves to
 * the right competitor. Because the row then shows the registered sail number,
 * a "matched on bow" marker appears on the suggestion and an "entered by bow"
 * badge on the committed row, so the recorder understands the mismatch.
 */

test('finish entry matches on bow number and flags the committed row', async ({ page }) => {
  // Heavy: enable a field, add two competitors, materialise a race, then commit
  // a finish whose autosave + list refetch settle before the row re-renders —
  // the setup can brush the 30s cap under full-suite load.
  test.slow();
  await createSeriesQuick(page, { name: 'Borrowed Hull 2026', venue: 'HYC' });

  // ── Enable the Bow number competitor field ────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('heading', { name: 'Competitor fields' })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('checkbox', { name: 'Bow number' }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── Add a boat whose bow number differs from its sail number, plus one
  //    ordinary boat ─────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('567');
  await page.getByLabel('Bow number').fill('1234');
  await page.getByLabel('Competitor name').fill('Borrower');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '567', exact: true })).toBeVisible();
  // The Bow no. column carries the value.
  await expect(page.getByRole('columnheader', { name: 'Bow no.' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '1234', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('890');
  await page.getByLabel('Competitor name').fill('Regular');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '890', exact: true })).toBeVisible();

  // ── Open the race results screen ─────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  const input = page.getByLabel('Sail number');

  // ── Typing the bow number surfaces the boat, flagged as a bow match, and
  //    showing its registered sail number (567), not what was typed (1234) ───
  await input.fill('1234');
  const suggestion = page.getByRole('option').filter({ hasText: 'matched on bow 1234' });
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText('567');

  // ── Enter commits the bow-matched boat ───────────────────────────────────
  await input.press('Enter');

  // ── The committed row is tagged "entered by bow" — assert this stable
  //    post-commit anchor before the non-finishers panel, which briefly
  //    re-renders as the commit's autosave + refetch settle ─────────────────
  const bowBadge = page.getByTestId('bow-match-567');
  await expect(bowBadge).toBeVisible({ timeout: 15_000 });
  await expect(bowBadge).toHaveText('entered by bow 1234');
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // 567 left the non-finishers panel — it was recorded, matched by bow number.
  await expect(page.getByTestId('non-finisher-567')).toHaveCount(0);
  // 890 is untouched.
  await expect(page.getByTestId('non-finisher-890')).toBeVisible();

  // ── The flag persists across a reload ────────────────────────────────────
  await page.reload();
  await expect(page.getByTestId('bow-match-567')).toBeVisible();
});

test('a sail number wins over another boat’s bow number', async ({ page }) => {
  // Heavy: enable a field, add two competitors, materialise a race, then commit
  // a finish whose autosave + list refetch settle before the row re-renders —
  // the setup can brush the 30s cap under full-suite load.
  test.slow();
  await createSeriesQuick(page, { name: 'Bow Precedence 2026', venue: 'HYC' });

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('heading', { name: 'Competitor fields' })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('checkbox', { name: 'Bow number' }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // Boat A carries bow number 1234; boat B's *sail* number is 1234.
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('567');
  await page.getByLabel('Bow number').fill('1234');
  await page.getByLabel('Competitor name').fill('Bow Boat');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '567', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1234');
  await page.getByLabel('Competitor name').fill('Sail Boat');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '1234', exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Typing 1234 must resolve to the sail-number boat (1234), not the bow boat.
  await page.getByLabel('Sail number').fill('1234');
  await page.getByLabel('Sail number').press('Enter');
  // Anchor on the committed boat's row before asserting the panel state — the
  // commit triggers an autosave + list refetch that can momentarily re-render
  // the non-finishers panel.
  await expect(page.getByTestId('drag-handle-1234')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await expect(page.getByTestId('non-finisher-1234')).toHaveCount(0);
  await expect(page.getByTestId('non-finisher-567')).toBeVisible();
  // Sail match, so no bow badge on the committed row.
  await expect(page.getByTestId('bow-match-1234')).toHaveCount(0);
});
