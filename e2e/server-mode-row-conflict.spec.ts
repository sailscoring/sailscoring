/**
 * Row-scoped conflict dialog (#111).
 *
 * Reproduces a realistic concurrent edit by issuing a direct API write
 * that bumps the row's `version` server-side, then driving a UI edit
 * that uses the now-stale cached version. The page intercepts the 409
 * and opens the row-scoped conflict dialog. Both resolution paths are
 * exercised — "Use the current value" and "Keep my change".
 */
// Uses the base Playwright test (not ./fixtures) because triggering a 409
// produces an unavoidable browser console.error from the failed fetch,
// which the fixture would treat as a test failure.
import { test, expect } from '@playwright/test';
import { createSeriesQuick, signInFreshUser } from './helpers';

test.describe('row-scoped conflict dialog', () => {
  test('save 409 → dialog → "Use the current value" reverts the local edit', async ({ page }) => {
    await signInFreshUser(page, 'server-conflict-use');

    await createSeriesQuick(page, { name: `RowConflict ${Date.now()}` });

    // Add a competitor.
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill('C1');
    await page.getByLabel('Competitor name').fill('Alice');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: 'C1' })).toBeVisible();

    // Add a race and finish C1 (no time — scratch series).
    await page.getByRole('link', { name: 'Races' }).click();
    await page.getByRole('button', { name: 'Add race' }).click();
    await page.getByText('Race 1').click();
    await page.getByLabel('Sail number').fill('C1');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

    // Bump the row's version out-of-band by re-saving the same payload via
    // the HTTP API. Subsequent UI edits will fire with the stale cached
    // version and 409.
    const raceUrl = page.url();
    const raceId = raceUrl.match(/\/races\/([^/?]+)/)?.[1];
    expect(raceId).toBeTruthy();
    const finishesRes = await page.request.get(`/api/v1/races/${raceId}/finishes`);
    expect(finishesRes.status()).toBe(200);
    const finishes = (await finishesRes.json()) as Array<{ id: string; version: number }>;
    const finisher = finishes.find((f) => f.version != null);
    expect(finisher).toBeTruthy();
    const bumpRes = await page.request.put(
      `/api/v1/races/${raceId}/finishes/${finisher!.id}`,
      {
        data: { ...finisher, sortOrder: 1 },
        headers: { 'if-match': String(finisher!.version) },
      },
    );
    expect(bumpRes.status()).toBe(200);

    // Now drive a UI edit on the same row. The page's cache still has the
    // old version → save 409s → dialog opens. Open the penalty editor and
    // apply ZFP — that fires saveFinish against the stale cached version.
    await page.getByRole('button', { name: 'Row actions for C1' }).click();
    await page.getByRole('menuitem', { name: 'Set scoring penalty' }).click();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: /ZFP/ }).click();
    await page.getByRole('button', { name: 'Apply' }).click();

    // The conflict dialog appears.
    await expect(page.getByTestId('row-conflict-dialog')).toBeVisible();
    await expect(page.getByTestId('row-conflict-dialog')).toContainText('C1');

    // "Use the current value" — dismisses, no penalty persisted.
    await page.getByTestId('conflict-use-current').click();
    await expect(page.getByTestId('row-conflict-dialog')).not.toBeVisible();
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  });

  test('save 409 → dialog → "Keep my change" retries against the fresh version', async ({ page }) => {
    await signInFreshUser(page, 'server-conflict-keep');

    await createSeriesQuick(page, { name: `RowConflictKeep ${Date.now()}` });
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill('K1');
    await page.getByLabel('Competitor name').fill('Bob');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: 'K1' })).toBeVisible();

    await page.getByRole('link', { name: 'Races' }).click();
    await page.getByRole('button', { name: 'Add race' }).click();
    await page.getByText('Race 1').click();
    await page.getByLabel('Sail number').fill('K1');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

    const raceId = page.url().match(/\/races\/([^/?]+)/)?.[1];
    const finishesRes = await page.request.get(`/api/v1/races/${raceId}/finishes`);
    const finishes = (await finishesRes.json()) as Array<{ id: string; version: number }>;
    const finisher = finishes.find((f) => f.version != null);
    await page.request.put(
      `/api/v1/races/${raceId}/finishes/${finisher!.id}`,
      {
        data: { ...finisher, sortOrder: 1 },
        headers: { 'if-match': String(finisher!.version) },
      },
    );

    // UI edit fires with the stale cached version → 409 → dialog.
    await page.getByRole('button', { name: 'Row actions for K1' }).click();
    await page.getByRole('menuitem', { name: 'Set scoring penalty' }).click();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: /ZFP/ }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('row-conflict-dialog')).toBeVisible();

    // "Keep my change" retries with the fresh version → succeeds.
    await page.getByTestId('conflict-keep-mine').click();
    await expect(page.getByTestId('row-conflict-dialog')).not.toBeVisible();
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

    // The penalty made it through.
    const after = await (await page.request.get(`/api/v1/races/${raceId}/finishes`)).json();
    expect(after[0].penaltyCode).toBe('ZFP');
  });
});
