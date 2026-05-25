import { signedInTest as test, expect } from './fixtures';
import { type Page } from '@playwright/test';
import { createSeriesQuick } from './helpers';

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

test('publish with a chosen slug → public page renders → bare slug 404s → re-publish freezes the URL', async ({ page }) => {
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

  // The bare series slug is reserved for the listing (#162) — 404 for now.
  const bare = path.replace(/\/standings$/, '');
  expect((await page.request.get(bare)).status()).toBe(404);

  // Re-open: the slug is frozen (no input) and re-publishing keeps the URL.
  await page.goto(`/series/${seriesId}/standings`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('URL slug')).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: /\/autumn-26\/standings$/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Re-publish' }).click();
  await expect(dialog.getByRole('link', { name: /\/autumn-26\/standings$/ })).toBeVisible();
});

test('keyboard shortcut p opens the publish dialog', async ({ page }) => {
  await createSeriesWithData(page);
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: 'Publish results' })).toBeVisible();
});
