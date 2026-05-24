import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick } from './helpers';

/**
 * E2E for the finish-entry competitor label and fleet badge (issues #156, #151).
 *
 * One keelboat ("Eclipse", helm "Hogan") entered in two fleets that share a
 * start — a handicap fleet and a scratch fleet. Verifies that at finish entry:
 *   #156 — the row leads with the boat name ("Eclipse — Hogan"), not just the
 *          helm, because boatName is an enabled display field.
 *   #151 — the fleet badge reflects *both* fleets, not just the first.
 */

test('finish entry shows the boat name and every fleet badge', async ({ page }) => {
  // ── 1. Series (boatName is an enabled field by default) ───────────────────
  await createSeriesQuick(page, { name: 'Keelboat Display 2025', venue: 'HYC' });

  // ── 2. Two fleets sharing a start ─────────────────────────────────────────
  await createFleets(page, ['Puppeteer HPH', 'Puppeteer Scr']);

  // ── 3. One boat entered in both fleets, with a boat name ──────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('20');
  await page.getByLabel('Competitor name').fill('Hogan');
  await page.getByLabel('Boat name').fill('Eclipse');
  await page.getByLabel('Club').fill('HYC');
  await page.getByRole('checkbox', { name: 'Puppeteer HPH' }).check();
  await page.getByRole('checkbox', { name: 'Puppeteer Scr' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '20' })).toBeVisible();

  // ── 4. Add a race and open finish entry ───────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // ── 5. Finish the boat ────────────────────────────────────────────────────
  const sailInput = page.getByLabel('Sail number');
  await sailInput.fill('20');
  await sailInput.press('Enter');

  // #156 — the row leads with the boat name, then the helm.
  await expect(page.getByText('Eclipse — Hogan')).toBeVisible();

  // #151 — both fleets are badged, not just the first-registered one.
  const badge = page.getByTestId('fleet-badge-20');
  await expect(badge).toContainText('Puppeteer HPH');
  await expect(badge).toContainText('Puppeteer Scr');
});
