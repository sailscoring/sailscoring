import { test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * Regression test for issue #116: the Standings tab used to get stuck on
 * "Loading…" for a brand-new series because the underlying finish and
 * race-start queries were `enabled: false` while there were no competitors
 * or races, so their `data` never left `undefined` and the loading guard
 * won before the friendly empty states could render.
 */

test('Standings tab shows the empty state for a brand-new series', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Empty Series 116' });

  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  await expect(page.getByText('No competitors yet. Add competitors to see standings.')).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
});
