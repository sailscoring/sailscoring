import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * Split Fleets prototype smoke (also the demo script): enable the feature,
 * create a series, seed demo competitors, enable split fleets (2 qualifying
 * fleets), commit Round 1 (Q1–Q2 created), enter Q1 finishes for both
 * fleets, watch Q1 flip to "counts" while Q2 awaits, see the provisional
 * cut line, reassign Round 2, split into Gold/Silver, and select the medal
 * fleet.
 */

// Mirrors the page's demo data: sails 210001 + i*137, seeded by sail-number
// order through the 2-fleet pattern Y B B Y | Y B B Y …
const DEMO_COUNT = 24;
const sails = Array.from({ length: DEMO_COUNT }, (_, i) => `${210001 + i * 137}`);
const yellowSails = sails.filter((_, i) => [0, 3].includes(i % 4));
const blueSails = sails.filter((_, i) => [1, 2].includes(i % 4));

async function enterFinishes(page: import('@playwright/test').Page, sailNumbers: string[]) {
  for (const sail of sailNumbers) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
}

test('split fleets: seed → race → reassign → split → medal', async ({ page, signedInEmail }) => {
  test.setTimeout(240_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);

  await createSeriesQuick(page, { name: 'ILCA Demo Worlds', venue: 'Dun Laoghaire' });

  // ── Setup: demo competitors, then enable with 2 qualifying fleets ─────────
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  // The demo button reloads the page.
  await expect(page.getByText(`${DEMO_COUNT} competitors entered.`)).toBeVisible();
  await page.locator('#sf-fleet-count').selectOption('2');
  await page.getByRole('button', { name: 'Enable split fleets' }).click();

  // ── Round 1: seeded, Q1–Q2 created ────────────────────────────────────────
  await page.getByRole('button', { name: 'Create Round 1' }).click();
  await expect(page.getByRole('dialog')).toContainText('Seed the initial qualifying fleets');
  await page.getByRole('button', { name: /Commit Round 1/ }).click();
  await expect(page.getByText('Round 1 · Q1 onward')).toBeVisible();
  await expect(page.getByText('awaiting Yellow, Blue')).toHaveCount(2);

  // ── Q1: both fleets' finish sheets ────────────────────────────────────────
  const q1Row = page.getByTestId('logical-race-qualifying-1');
  await q1Row.getByRole('link', { name: /Yellow · enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  await enterFinishes(page, yellowSails);
  await page.goBack();
  await q1Row.getByRole('link', { name: /Blue · enter finishes/ }).click();
  await enterFinishes(page, blueSails);
  await page.goBack();

  await expect(page.getByText('counts', { exact: true })).toBeVisible();
  await expect(page.getByText('awaiting Yellow, Blue')).toHaveCount(1); // Q2 only
  await expect(page.getByText('1 of 2 qualifying races count')).toBeVisible();

  // Standings: combined table with the provisional cut line.
  await expect(page.getByText(/cut if qualifying ended now/)).toBeVisible();

  // ── Round 2: rank-pattern reassignment from the Q1 ranking ────────────────
  await page.getByRole('button', { name: 'Assign Round 2' }).click();
  await expect(page.getByRole('dialog')).toContainText('From the ranking after Q1');
  await page.getByRole('button', { name: /Commit Round 2/ }).click();
  await expect(page.getByText('Round 2 · Q3 onward')).toBeVisible();

  // ── Split into Gold / Silver ──────────────────────────────────────────────
  await page.getByRole('button', { name: 'End qualifying → split fleets' }).click();
  await expect(page.getByRole('dialog')).toContainText('The split is frozen once committed');
  await page.getByRole('button', { name: /Commit split \(12 \/ 12\)/ }).click();
  await expect(page.getByText('Split committed')).toBeVisible();
  await expect(page.getByRole('link', { name: /F1 · enter finishes/ })).toHaveCount(2);

  // Tiered standings: one table per final fleet.
  await expect(page.getByRole('heading', { name: /Gold/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Silver/ })).toBeVisible();

  // ── Medal fleet ───────────────────────────────────────────────────────────
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Select medal fleet (top 10)' }).click();
  await expect(page.getByText('Medal races score ×2')).toBeVisible();
  await expect(page.getByRole('link', { name: /M1/ })).toHaveCount(2);
});
