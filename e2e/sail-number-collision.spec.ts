import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick } from './helpers';

/**
 * E2E test for sail number collisions across fleets (issue #70).
 *
 * Two fleets (Puppeteer and Howth17), each with a boat numbered "20".
 * Verifies that:
 * 1. Autocomplete shows fleet badges to disambiguate
 * 2. Pressing Enter on an ambiguous sail shows a disambiguation message
 * 3. Selecting from the dropdown correctly identifies the right boat
 * 4. Both boats can be finished in the same race
 */

const competitors = [
  { sailNumber: '20', name: 'Alice', club: 'HYC', fleet: 'Puppeteer' },
  { sailNumber: '21', name: 'Bob', club: 'HYC', fleet: 'Puppeteer' },
  { sailNumber: '20', name: 'Carol', club: 'HYC', fleet: 'Howth17' },
  { sailNumber: '22', name: 'Dave', club: 'HYC', fleet: 'Howth17' },
];

test('sail number collision across fleets is disambiguated at finish entry', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Collision Test 2025', venue: 'HYC' });

  // ── 2. Create fleets and add competitors ──────────────────────────────────
  await createFleets(page, ['Puppeteer', 'Howth17']);
  await page.getByRole('link', { name: 'Competitors' }).click();

  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByLabel('Club').fill(c.club);
    await page.getByRole('checkbox', { name: c.fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.name, exact: true })).toBeVisible();
  }

  // ── 3. Add a race ─────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // ── 4. Type colliding sail "20" and press Enter — should show disambiguation
  const sailInput = page.getByLabel('Sail number');
  await sailInput.fill('20');

  // Autocomplete should show two suggestions with fleet badges
  const suggestions = page.getByRole('option');
  await expect(suggestions).toHaveCount(2);
  await expect(suggestions.filter({ hasText: 'Puppeteer' })).toHaveCount(1);
  await expect(suggestions.filter({ hasText: 'Howth17' })).toHaveCount(1);

  // Pressing Enter without selecting should show disambiguation error
  await sailInput.press('Enter');
  await expect(page.getByText('Multiple boats with sail 20')).toBeVisible();

  // ── 5. Select the Puppeteer boat (Alice) from the dropdown ────────────────
  await sailInput.fill('20');
  await expect(suggestions).toHaveCount(2);
  // Click the Puppeteer option
  await suggestions.filter({ hasText: 'Alice' }).click();
  // Should be added to the finishing order with fleet badge
  await expect(page.getByTestId('fleet-badge-20')).toContainText('Puppeteer');

  // ── 6. Now type "20" again — only Howth17's 20 should remain ──────────────
  await sailInput.fill('20');
  await expect(suggestions).toHaveCount(1);
  await expect(suggestions.nth(0)).toContainText('Howth17');

  // Press Enter — should resolve to the only remaining candidate
  await sailInput.press('Enter');
  // Both boats now in the finishing order
  const finishList = page.getByRole('list').first();
  await expect(finishList.getByText('Alice')).toBeVisible();
  await expect(finishList.getByText('Carol')).toBeVisible();

  // ── 7. Add the non-colliding boats and save ───────────────────────────────
  await sailInput.fill('21');
  await sailInput.press('Enter');
  await sailInput.fill('22');
  await sailInput.press('Enter');

  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 8. Check standings — both fleets should have correct results ──────────
  await page.getByRole('link', { name: 'Standings' }).click();
  // Puppeteer standings: 20 (Alice) = 1st, 21 (Bob) = 2nd
  const puppeteerSection = page.getByText('Puppeteer').locator('..');
  await expect(puppeteerSection.getByRole('row').filter({ hasText: 'Alice' })).toBeVisible();
  // Howth17 standings: 20 (Carol) = 1st (she finished 2nd overall but 1st in fleet)
  const howth17Section = page.getByText('Howth17').locator('..');
  await expect(howth17Section.getByRole('row').filter({ hasText: 'Carol' })).toBeVisible();
});
