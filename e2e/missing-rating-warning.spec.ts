import { test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * Issue #88: missing-rating warning should surface the specific fleet + rating
 * both in a tooltip on the competitors list and as an inline hint in the edit
 * dialog.
 */

test('missing handicap rating: tooltip + dialog hint name the fleet and rating', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Missing Rating Warning' });

  await createFleets(page, ['Cruisers']);
  await setScoringMode(page, 'handicap');
  // Change Cruisers fleet to IRC scoring
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();

  // Add a competitor but leave IRC TCC blank (single-fleet case: competitor is
  // auto-assigned to the only fleet on save)
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('IRL1234');
  await page.getByLabel('Helm name').fill('Test Skipper');
  await page.getByRole('button', { name: 'Save' }).click();

  // Row should render the warning icon with the descriptive aria-label
  const warning = page.getByRole('row').filter({ hasText: 'IRL1234' }).getByLabel(/Missing IRC TCC for Cruisers fleet/);
  await expect(warning).toBeVisible();

  // Hovering shows the Radix tooltip content
  await warning.hover();
  await expect(
    page.getByRole('tooltip', { name: 'Missing IRC TCC for Cruisers fleet' }),
  ).toBeVisible();

  // Re-open the edit dialog and confirm the hint is visible there too
  await page.getByRole('row').filter({ hasText: 'IRL1234' }).getByRole('button', { name: /Edit/ }).click();
  await expect(page.getByText('Required for Cruisers fleet.')).toBeVisible();

  // Fill the TCC: hint disappears once the field is populated
  await page.getByRole('textbox', { name: 'IRC TCC' }).fill('0.972');
  await expect(page.getByText('Required for Cruisers fleet.')).not.toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  // Warning icon gone from the row
  await expect(
    page.getByRole('row').filter({ hasText: 'IRL1234' }).getByLabel(/Missing/),
  ).toHaveCount(0);
});
