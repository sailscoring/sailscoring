import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';
import type { Page } from '@playwright/test';

/**
 * E2E for the Update Handicaps dialog (#144).
 *
 * Uses IRC for the test fixture rather than NHC: IRC is a static handicap
 * pulled straight off the source competitor record, so no race-scoring
 * setup is needed. The dialog and the bulk-update endpoint are the same
 * across all four systems — exercising the IRC path covers the whole UX.
 * NHC- and ECHO-specific resolver logic is unit-tested in
 * tests/source-handicaps.test.ts.
 *
 * Flow:
 *   1. Source series, IRC fleet, three boats with TCC values.
 *   2. Target series, IRC fleet, same three sail numbers with different TCCs.
 *   3. Open Update Handicaps; pick source; apply.
 *   4. Verify the target's TCCs now match the source's.
 */

async function configureIrcFleet(page: Page, fleetName: string): Promise<void> {
  await createFleets(page, [fleetName]);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
}

async function addBoatWithTcc(page: Page, sailNumber: string, name: string, tcc: string): Promise<void> {
  // Add row (no TCC yet — Add form doesn't surface IRC TCC until a fleet
  // is assigned, and the auto-fleet behaviour depends on context).
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill(sailNumber);
  await page.getByLabel('Competitor name').fill(name);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  // Edit to set IRC TCC — same pattern as the existing IRC handicap e2e.
  const row = page.getByRole('row').filter({ hasText: sailNumber });
  await row.click();
  await expect(page.getByLabel('IRC TCC', { exact: true })).toBeVisible();
  await page.getByLabel('IRC TCC', { exact: true }).fill(tcc);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
}

test('Update Handicaps dialog: carry IRC TCCs from source series to target', async ({ page }) => {
  // ── 1. Source series: IRC, three boats with stable TCCs ───────────────────
  await createSeriesQuick(page, { name: 'IRC Source 2026' });
  await configureIrcFleet(page, 'IRC');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await addBoatWithTcc(page, 'IRL 1001', 'Alpha', '0.940');
  await addBoatWithTcc(page, 'IRL 1002', 'Beta',  '0.985');
  await addBoatWithTcc(page, 'IRL 1003', 'Gamma', '1.075');

  // ── 2. Target series: IRC, same three boats with wrong TCCs ──────────────
  await page.goto('/');
  await createSeriesQuick(page, { name: 'IRC Target 2026' });
  await configureIrcFleet(page, 'IRC');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await addBoatWithTcc(page, 'IRL 1001', 'Alpha', '1.000');
  await addBoatWithTcc(page, 'IRL 1002', 'Beta',  '1.000');
  await addBoatWithTcc(page, 'IRL 1003', 'Gamma', '1.000');

  // ── 3. Open the dialog ────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Update handicaps' })).toBeVisible();

  // Step 1 → Next
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(
    page.getByRole('heading', { name: 'Update handicaps from another series' }),
  ).toBeVisible();

  // ── 4. Pick the source series ─────────────────────────────────────────────
  await page.getByRole('combobox').filter({ hasText: 'Pick a series' }).click();
  await page.getByRole('option', { name: 'IRC Source 2026' }).click();

  // Three change rows surface (all three boats moving from 1.000 → source TCC).
  await expect(page.getByText(/Preview: 3 changes/)).toBeVisible();
  await expect(page.getByText('1.000 → 0.940')).toBeVisible();
  await expect(page.getByText('1.000 → 0.985')).toBeVisible();
  await expect(page.getByText('1.000 → 1.075')).toBeVisible();

  // ── 5. Apply ──────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /Apply 3/ }).click();
  await expect(page.getByRole('heading', { name: 'Handicaps updated' })).toBeVisible();
  await expect(page.getByText(/Updated/).filter({ hasText: /3/ })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  // ── 6. Verify the target competitors carry the source's TCCs now ──────────
  // The Competitors table renders the raw stored number — trailing zeros
  // are dropped (0.940 → 0.94). Match the stored shape rather than the
  // dialog's 3-dp display.
  for (const expected of ['0.94', '0.985', '1.075']) {
    await expect(page.getByRole('cell', { name: expected, exact: true })).toBeVisible();
  }
});

test('Update Handicaps dialog stays within the viewport when the preview is tall (#161)', async ({ page }) => {
  // Repro for #161: with enough competitors the preview made the dialog
  // taller than the page; because it's vertically centred with no height
  // cap, the title and the Apply footer spilled off-screen with no way to
  // scroll to them. A short viewport reproduces the same overflow mechanics
  // with three boats — far faster than seeding dozens.
  await createSeriesQuick(page, { name: 'IRC Source Tall' });
  await configureIrcFleet(page, 'IRC');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await addBoatWithTcc(page, 'IRL 2001', 'Alpha', '0.940');
  await addBoatWithTcc(page, 'IRL 2002', 'Beta',  '0.985');
  await addBoatWithTcc(page, 'IRL 2003', 'Gamma', '1.075');

  await page.goto('/');
  await createSeriesQuick(page, { name: 'IRC Target Tall' });
  await configureIrcFleet(page, 'IRC');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await addBoatWithTcc(page, 'IRL 2001', 'Alpha', '1.000');
  await addBoatWithTcc(page, 'IRL 2002', 'Beta',  '1.000');
  await addBoatWithTcc(page, 'IRL 2003', 'Gamma', '1.000');

  // Shrink the viewport only now — data setup above is more robust at a
  // normal height. 380px guarantees the preview content exceeds the page.
  await page.setViewportSize({ width: 1024, height: 380 });

  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('combobox').filter({ hasText: 'Pick a series' }).click();
  await page.getByRole('option', { name: 'IRC Source Tall' }).click();
  await expect(page.getByText(/Preview: 3 changes/)).toBeVisible();

  // The dialog must sit entirely within the viewport — not bleed off the
  // top or bottom the way the un-capped, centred dialog did.
  const viewport = page.viewportSize()!;
  const box = await page.getByRole('dialog').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);

  // Header and the Apply footer stay on-screen; the middle scrolls instead.
  await expect(
    page.getByRole('heading', { name: 'Update handicaps from another series' }),
  ).toBeInViewport();
  const applyBtn = page.getByRole('button', { name: /Apply 3/ });
  await expect(applyBtn).toBeInViewport();

  // …and Apply is actually usable from here.
  await applyBtn.click();
  await expect(page.getByRole('heading', { name: 'Handicaps updated' })).toBeVisible();
});
