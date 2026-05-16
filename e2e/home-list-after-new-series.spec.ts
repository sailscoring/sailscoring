import { signedInTest as test, expect } from './fixtures';

/**
 * Regression test for the sibling of issue #116: clicking "New series" from
 * the home page creates a series via `seriesRepo.save()` directly (not via
 * `useSaveSeries`), so the home page's cached series list never gets
 * invalidated. Within `staleTime` (30s), navigating back to home shows the
 * stale list and the new series is missing.
 */

test('new series appears on home after navigating away and back', async ({ page }) => {
  await page.goto('/');
  // Prime the home page's series-list cache while empty.
  await expect(page.getByText(/No series yet/)).toBeVisible();

  await page.getByRole('link', { name: 'New series' }).click();
  // The new-series page auto-creates with a placeholder name and redirects
  // to the setup wizard.
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/setup$/);

  // Match the user's reported flow: visit Standings before going home.
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  await page.goto('/');
  // Placeholder names are "<Adjective> <Noun> Series" — see lib/placeholder-names.ts.
  await expect(page.locator('a[href^="/series/"]').filter({ hasText: /Series$/ })).toBeVisible();
  await expect(page.getByText(/No series yet/)).not.toBeVisible();
});
