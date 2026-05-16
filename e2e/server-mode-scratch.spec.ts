/**
 * Server round-trip smoke for scratch scoring. A few high-signal
 * assertions covering the full UI → API → repository → Postgres path,
 * including a hard reload to confirm the data survives the in-memory
 * query cache. Companion to `scratch-event-one-fleet-2-races.spec.ts`
 * which exercises a fuller happy path.
 */
import { test, expect } from './fixtures';
import { createSeriesQuick, signInFreshUser } from './helpers';

test.describe('scratch event, server mode', () => {
  test('sign in, create series, add competitor, reload, persists', async ({ page }) => {
    await signInFreshUser(page, 'server-scratch');

    const seriesName = `Server Mode Scratch ${Date.now()}`;
    await createSeriesQuick(page, { name: seriesName, venue: 'Howth Yacht Club' });
    await expect(page.getByRole('heading', { name: seriesName })).toBeVisible();

    // Add one competitor through the same UI the local-mode test uses.
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill('1001');
    await page.getByLabel('Competitor name').fill('Alice Murphy');
    await page.getByLabel('Club').fill('HYC');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: '1001' })).toBeVisible();

    // Hard reload — the row must come back from /api/v1, not the in-memory
    // TanStack cache. Verifies the round-trip is real.
    await page.reload();
    await expect(page.getByRole('cell', { name: '1001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Alice Murphy', exact: true })).toBeVisible();
  });

  test('listing the home page shows the just-created series after sign-in', async ({ page }) => {
    await signInFreshUser(page, 'server-list');

    const seriesName = `Server Mode Listing ${Date.now()}`;
    await createSeriesQuick(page, { name: seriesName });

    await page.goto('/');
    await expect(page.getByRole('link', { name: new RegExp(seriesName) })).toBeVisible();
  });
});
