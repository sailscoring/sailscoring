import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, openSeriesActionsMenu } from './helpers';

/**
 * "Duplicate…" (#330): copy a series within its own workspace from the
 * series actions menu. The duplicate carries competitors and races; edits
 * to it don't touch the source, and it is listed on the workspace series
 * list — both on a soft route back and on a fresh load (#366).
 */

test('duplicate carries competitors and races; edits stay on the copy', async ({ page }) => {
  const sourceName = `Duplicate Source ${Date.now()}`;
  await createSeriesQuick(page, { name: sourceName });

  // Two competitors and a race so the duplicate has children to carry.
  for (const [sail, name] of [['D1', 'Dana'], ['D2', 'Drew']]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sail);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  const sourceId = page.url().match(/series\/([0-9a-f-]{36})\//)![1];

  // Visit the list before duplicating, so the copy has to reach a cache that
  // already holds the pre-copy list — the situation the scorer is in.
  await page.getByRole('link', { name: 'Sail Scoring — home' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.locator('[data-testid="series-row"]')).toHaveCount(1);
  await page.getByRole('link', { name: sourceName }).click();
  await page.waitForURL(new RegExp(`/series/${sourceId}/`));

  // Duplicate from the actions menu, accepting the default name.
  await openSeriesActionsMenu(page);
  await page.getByRole('menuitem', { name: 'Duplicate…' }).click();
  await expect(page.getByLabel('Name')).toHaveValue(`Copy of ${sourceName}`);
  await page.getByTestId('duplicate-series-submit').click();

  // Lands on the duplicate's competitors tab — a different series id. The
  // wait excludes the source id: this page is itself a `/competitors` URL, so
  // the pattern alone would match before the copy is even written.
  await page.waitForURL(
    (url) =>
      /\/series\/[0-9a-f-]{36}\/competitors$/.test(url.pathname) &&
      !url.pathname.includes(sourceId),
  );
  const dupId = page.url().match(/series\/([0-9a-f-]{36})\//)![1];
  expect(dupId).not.toBe(sourceId);
  await expect(page.getByRole('heading', { name: `Copy of ${sourceName}` })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'D1' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'D2' })).toBeVisible();
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  // The copy is on the series list. Soft-route home so the list renders from
  // the cache the duplicate left behind — that paint used to omit the copy,
  // because the dialog only marked the (unmounted) list query stale.
  const copyRow = page
    .locator('[data-testid="series-row"]')
    .filter({ hasText: `Copy of ${sourceName}` });
  await page.getByRole('link', { name: 'Sail Scoring — home' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await page.locator('[data-testid="series-row"]').first().waitFor();
  // Deliberately not a retrying assertion: the copy must be in the paint the
  // cache drives, not only once a background refetch catches up.
  expect(await copyRow.count(), 'copy missing from the first paint').toBe(1);
  // And a fresh load agrees.
  await page.goto('/');
  await expect(copyRow).toBeVisible();

  // Edit the duplicate: add a third competitor.
  await copyRow.getByRole('link').click();
  await page.waitForURL(new RegExp(`/series/${dupId}/`));
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('cell', { name: 'D1' })).toBeVisible();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('D3');
  await page.getByLabel('Competitor name').fill('Dot');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'D3' })).toBeVisible();

  // The source is untouched: still two competitors, original name.
  await page.goto(`/series/${sourceId}/competitors`);
  await expect(page.getByRole('heading', { name: sourceName })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'D1' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'D3' })).not.toBeVisible();
});
