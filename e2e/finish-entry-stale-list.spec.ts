import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * A finish committed while the finishes-list fetch is still in flight must
 * survive that fetch's response.
 *
 * The races page dispatches a per-race finishes GET as soon as a race row
 * renders; opening the race shares the same query, so a scorer can commit a
 * finish before the list response lands. React Query applies fetch results
 * last-resolve-wins, so without a guard the pre-commit (empty) response would
 * overwrite the optimistically patched cache and the committed row would
 * silently vanish from the sheet — the load-shaped flake this pins down
 * deterministically by holding the list response until after the commit.
 */
test('a finish committed while the list fetch is in flight survives its stale response', async ({ page }) => {
  test.slow();
  await createSeriesQuick(page, { name: 'Stale List 2026', venue: 'HYC' });

  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('42');
  await page.getByLabel('Competitor name').fill('Racer');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();

  // Trap the first finishes-list GET: fetch its (pre-commit, empty) body now,
  // but hold the response until the test releases it after committing.
  let releaseStaleList = () => {};
  const staleListGate = new Promise<void>((resolve) => {
    releaseStaleList = resolve;
  });
  let heldFirstList = false;
  await page.route('**/api/v1/races/*/finishes', async (route) => {
    if (route.request().method() !== 'GET' || heldFirstList) return route.fallback();
    heldFirstList = true;
    const response = await route.fetch();
    await staleListGate;
    await route.fulfill({ response });
  });

  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Commit a finish while the list fetch is still held in flight.
  await page.getByLabel('Sail number').fill('42');
  await page.getByLabel('Sail number').press('Enter');
  await expect(page.getByTestId('drag-handle-42')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Release the stale (empty) list response — the committed row must survive.
  const staleLanded = page.waitForResponse(
    (r) => /\/api\/v1\/races\/[^/]+\/finishes$/.test(r.url()) && r.request().method() === 'GET',
  );
  releaseStaleList();
  await staleLanded;
  // A beat for the client to process (and discard) the response.
  await page.waitForTimeout(250);
  await expect(page.getByTestId('drag-handle-42')).toBeVisible();
  await expect(page.getByTestId('non-finisher-42')).toHaveCount(0);
});
