import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for alternative sail numbers in finish entry (issue #379).
 *
 * A boat that changes sails mid-event races under a number it did not enter
 * under. Listing that number against the entry lets finish entry match it, and
 * the committed row records which number was actually used — the row still
 * displays the registered sail number, so without the marker the sheet would
 * silently read back as a different boat's number.
 */

async function enableAlternativeSailNumbers(page: import('@playwright/test').Page) {
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('heading', { name: 'Competitor fields' })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('checkbox', { name: 'Alternative sail numbers' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
}

test('finish entry matches an alternative sail number and records which was used', async ({
  page,
}) => {
  await createSeriesQuick(page, { name: 'Replacement Sail 2026', venue: 'HYC' });
  await enableAlternativeSailNumbers(page);

  // ── A boat carrying two spare numbers, plus an ordinary entry ─────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number *').fill('567');
  await page.getByLabel('Alternative sail numbers').fill('IRL 99, 7');
  await page.getByLabel('Competitor name').fill('Sail Swapper');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '567', exact: true })).toBeVisible();
  // The list is shown as entered, comma-separated.
  await expect(page.getByRole('columnheader', { name: 'Also sails as' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL 99, 7', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number *').fill('890');
  await page.getByLabel('Competitor name').fill('Regular');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '890', exact: true })).toBeVisible();

  // ── The filter finds the boat by a number it never entered under ─────────
  await page.getByLabel('Filter competitors').fill('irl 99');
  await expect(page.getByText('1 of 2 competitors')).toBeVisible();
  await page.getByLabel('Filter competitors').press('Escape');

  // ── Enter a finish under the alternative number ──────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  const input = page.getByLabel('Sail number');
  await input.fill('IRL 99');
  const suggestion = page.getByRole('option').filter({ hasText: 'sails as IRL 99' });
  await expect(suggestion).toBeVisible();
  // The suggestion shows the registered number, not the one typed.
  await expect(suggestion).toContainText('567');

  await input.press('Enter');

  // ── The committed row says which sail the boat actually raced under ──────
  const badge = page.getByTestId('alternative-match-567');
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await expect(badge).toHaveText('sailed as IRL 99');
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await expect(page.getByTestId('non-finisher-567')).toHaveCount(0);
  await expect(page.getByTestId('non-finisher-890')).toBeVisible();

  // ── It survives a reload — this is recorded, not a transient hint ────────
  await page.reload();
  await expect(page.getByTestId('alternative-match-567')).toBeVisible();
  await expect(page.getByTestId('alternative-match-567')).toHaveText('sailed as IRL 99');
});

test('a registered sail number wins over another boat’s alternative', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Alternative Precedence 2026', venue: 'HYC' });
  await enableAlternativeSailNumbers(page);

  // Boat A lists 890 as an alternative; boat B is registered as 890.
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number *').fill('567');
  await page.getByLabel('Alternative sail numbers').fill('890');
  await page.getByLabel('Competitor name').fill('Claimant');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /Claimant/ })).toBeVisible();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number *').fill('890');
  await page.getByLabel('Competitor name').fill('Rightful Owner');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /Rightful Owner/ })).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  await page.getByLabel('Sail number').fill('890');
  await page.getByLabel('Sail number').press('Enter');

  // 890 resolved to the boat registered under it, with no provenance marker —
  // an alternative must never shadow a real entry.
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('non-finisher-890')).toHaveCount(0);
  await expect(page.getByTestId('non-finisher-567')).toBeVisible();
  await expect(page.getByTestId('alternative-match-890')).toHaveCount(0);
});
