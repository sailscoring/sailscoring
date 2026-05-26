import { signedInTest as test, expect } from './fixtures';
import { type Page } from '@playwright/test';
import { addCompetitor, createSeriesQuick } from './helpers';

/**
 * E2E for in-app results publishing (ADR-008 Phase 9/10, the bilge
 * replacement — #153).
 *
 * Publish runs server-side and stores the rendered HTML. With no
 * BLOB_READ_WRITE_TOKEN in the test env, `lib/blob-storage.ts` uses its
 * Postgres fallback, so the whole flow — choose slug → publish → public
 * `/p/{ws}/{series}/standings` page → re-publish — runs against the local
 * database with no external service.
 */

/** New series with one competitor finishing one race; returns the series id. */
async function createSeriesWithData(page: Page): Promise<string> {
  await createSeriesQuick(page, { name: 'HYC Autumn League 2026' });
  const seriesId = page.url().match(/\/series\/([0-9a-f-]{36})/)?.[1];
  if (!seriesId) throw new Error(`Not on a series page: ${page.url()}`);

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('42');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('42');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  return seriesId;
}

test('publish with a chosen slug → public page renders → bare slug lists the fleet → re-publish freezes the URL', async ({ page }) => {
  const seriesId = await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();

  // The slug is pre-filled from the series name and editable before publishing.
  const slugInput = dialog.getByLabel('URL slug');
  await expect(slugInput).toHaveValue('hyc-autumn-league-2026');
  await slugInput.fill('autumn-26');

  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // Published: a /p/{ws}/{series}/standings link appears.
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href')) ?? '';
  expect(href).toMatch(/\/p\/[^/]+\/autumn-26\/standings$/);
  const path = new URL(href).pathname;

  // The public, unauthenticated page renders the standings.
  await page.goto(path);
  await expect(page.getByText('HYC Autumn League 2026').first()).toBeVisible();
  await expect(page.getByText('42').first()).toBeVisible();

  // The bare series slug now serves the per-publication listing (#162): a
  // one-item "Standings" listing for this single-fleet series, linking back to
  // the fleet page.
  const bare = path.replace(/\/standings$/, '');
  await page.goto(bare);
  await expect(page.getByText('HYC Autumn League 2026')).toBeVisible();
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/autumn-26\/standings$/);
  await expect(page.getByRole('cell', { name: '42' }).first()).toBeVisible();

  // Re-open: the slug is frozen (no input) and re-publishing keeps the URL.
  await page.goto(`/series/${seriesId}/standings`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('URL slug')).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: /\/autumn-26\/standings$/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Re-publish' }).click();
  await expect(dialog.getByRole('link', { name: /\/autumn-26\/standings$/ })).toBeVisible();
});

test('workspace index lists published series and links through to a fleet page', async ({ page }) => {
  await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;
  const workspaceSlug = path.split('/')[2];

  // The public workspace listing names the series and links to its index.
  await page.goto(`/p/${workspaceSlug}`);
  const seriesLink = page.getByRole('link', { name: 'HYC Autumn League 2026' });
  await expect(seriesLink).toBeVisible();
  await seriesLink.click();

  // → series index → fleet page renders the standings.
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('cell', { name: '42' }).first()).toBeVisible();
});

test('re-publishing is reflected on the public page immediately', async ({ page }) => {
  const seriesId = await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;

  await page.goto(path);
  await expect(page.getByRole('cell', { name: '42' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '99' })).toHaveCount(0);

  // Add a second finisher, then re-publish.
  await page.goto(`/series/${seriesId}/competitors`);
  await addCompetitor(page, { sailNumber: '99', name: 'Bob' });
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByLabel('Sail number').fill('99');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Re-publish rebuilds from the database, so wait until a fresh server fetch
  // confirms the new finisher persisted before publishing — the autosave
  // indicator can read "All changes saved" from a prior save before this write
  // commits. Re-navigating retries the fetch until the standings include 99, so
  // the re-publish is a genuine content change rather than a same-hash no-op.
  await expect(async () => {
    await page.goto(`/series/${seriesId}/standings`);
    await expect(page.getByRole('cell', { name: '99' }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await page.getByRole('button', { name: 'Publish' }).click();
  // Wait for the re-publish POST itself: the dialog already shows the (frozen)
  // URL before re-publishing, so the link being visible doesn't mean the new
  // HTML has been stored yet.
  const [publishResp] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes(`/series/${seriesId}/publish`) &&
        r.request().method() === 'POST',
    ),
    dialog.getByRole('button', { name: 'Re-publish' }).click(),
  ]);
  expect(publishResp.ok()).toBeTruthy();

  // The read path serves the re-published results immediately — no propagation
  // wait (the ?v=contentHash cache-buster sidesteps Blob's overwrite lag, and
  // an unchanged-hash 304 can't mask a real change). `no-cache` on the response
  // means a real browser refresh revalidates rather than showing a stale copy.
  const fresh = await page.request.get(path);
  expect(fresh.headers()['cache-control']).toContain('no-cache');
  expect(await fresh.text()).toContain('>99<');
});

test('keyboard shortcut p opens the publish dialog', async ({ page }) => {
  await createSeriesWithData(page);
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: 'Publish results' })).toBeVisible();
});
