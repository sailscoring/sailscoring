import { signedInTest as test, expect } from './fixtures';
import { type Page } from '@playwright/test';
import { createSeriesQuick } from './helpers';

/**
 * E2E for in-app results publishing (ADR-008 Phase 9, the bilge replacement).
 *
 * Publish runs server-side and stores the rendered HTML. With no
 * BLOB_READ_WRITE_TOKEN in the test env, `lib/blob-storage.ts` uses its
 * Postgres fallback — so the whole flow (publish → public /p/{slug} page →
 * re-publish) runs against the local database with no external service and no
 * network interception.
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

function slugFromUrl(url: string): string {
  const m = url.match(/\/p\/([^/\s]+)/);
  if (!m) throw new Error(`No /p/{slug} in URL: ${url}`);
  return m[1];
}

test('publish → public page renders → re-publish keeps the same URL', async ({ page }) => {
  const seriesId = await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // The published URL appears as a /p/{slug} link.
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const slug = slugFromUrl((await link.getAttribute('href')) ?? '');

  // The public page renders the standings, unauthenticated route.
  await page.goto(`/p/${slug}`);
  await expect(page.getByText('HYC Autumn League 2026').first()).toBeVisible();
  await expect(page.getByText('42').first()).toBeVisible();

  // Re-open the dialog and re-publish — the slug (public URL) is stable.
  await page.goto(`/series/${seriesId}/standings`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: new RegExp(slug) })).toBeVisible();
  await dialog.getByRole('button', { name: 'Re-publish' }).click();
  await expect(dialog.getByRole('link', { name: new RegExp(slug) })).toBeVisible();
});

test('keyboard shortcut p opens the publish dialog', async ({ page }) => {
  await createSeriesWithData(page);
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: 'Publish results' })).toBeVisible();
});
