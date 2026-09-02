import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * The workspace Activity tab: the whole workspace's log, including the
 * workspace-level entries no series page can show. A created series shows up
 * linked to itself; once it is deleted and purged, the purge entry stands on
 * its summary alone — there is nothing left to link to.
 */
test('the workspace Activity tab shows series-linked and workspace-level entries', async ({
  page,
}) => {
  const name = 'Logged Regatta';
  await createSeriesQuick(page, { name });
  const seriesId = page.url().match(/\/series\/([^/]+)/)?.[1];
  expect(seriesId).toBeTruthy();

  // Reached from the workspace tab bar.
  await page.goto('/');
  await page.getByRole('link', { name: 'Activity' }).click();
  await page.waitForURL(/\/workspace\/activity$/);
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();

  // The creation entry links through to the series.
  const feed = page.getByTestId('workspace-activity');
  const created = feed.locator('[data-action="series.created"]').first();
  await expect(created).toContainText(name);
  await expect(created.getByRole('link', { name })).toHaveAttribute(
    'href',
    `/series/${seriesId}`,
  );

  // Delete and purge the series from the home list.
  await page.goto('/');
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('button', { name: /Archived \(\d+\)/ }).click();
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  await page.getByRole('button', { name: 'Delete series' }).click();
  await page.getByRole('button', { name: /Trash \(1\)/ }).click();
  await page.getByRole('button', { name: `Permanently delete ${name}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type the series name to confirm').fill(name);
  await dialog.getByRole('button', { name: 'Delete forever' }).click();
  await expect(page.getByRole('button', { name: /Trash/ })).toBeHidden();

  // The purge is a workspace-level entry: shown, naming the series, with no
  // link because there is no series any more — and the earlier creation
  // entry has lost its link for the same reason.
  await page.goto('/workspace/activity');
  const purged = feed.locator('[data-action="series.purged"]').first();
  await expect(purged).toContainText(`Permanently deleted series “${name}”`);
  await expect(purged.getByRole('link')).toHaveCount(0);
  await expect(feed.locator('[data-action="series.created"]').first().getByRole('link')).toHaveCount(0);
});
