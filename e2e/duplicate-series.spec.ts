import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * "Duplicate…" (#330): copy a series within its own workspace from the
 * series actions menu. The duplicate carries competitors and races; edits
 * to it don't touch the source.
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

  // Duplicate from the actions menu, accepting the default name.
  await page.getByRole('button', { name: 'Series actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate…' }).click();
  await expect(page.getByLabel('Name')).toHaveValue(`Copy of ${sourceName}`);
  await page.getByTestId('duplicate-series-submit').click();

  // Lands on the duplicate's competitors tab — a different series id.
  await page.waitForURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
  const dupId = page.url().match(/series\/([0-9a-f-]{36})\//)![1];
  expect(dupId).not.toBe(sourceId);
  await expect(page.getByRole('heading', { name: `Copy of ${sourceName}` })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'D1' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'D2' })).toBeVisible();
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  // Edit the duplicate: add a third competitor.
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
