import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for the History tab (#166, revision history phase 3).
 *
 * A single editing session by one scorer coalesces into one "auto" revision
 * (5-minute idle window), which is expandable to the individual changes it
 * covers (the activity entries in its window).
 */
test('history tab: a session is one revision, expandable to its changes', async ({ page }) => {
  await createSeriesQuick(page, { name: 'History Spec Series' });

  // A competitor (no revision of its own) so a finish has something to attach to.
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('H1');
  await page.getByLabel('Competitor name').fill('History Boat');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'H1' })).toBeVisible();

  // A race and a recorded finish.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('H1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();

  // History tab.
  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/history$/);

  const list = page.getByTestId('revision-list');
  await expect(list).toBeVisible();

  // All of this session's edits coalesced into a single revision, headlined by
  // the set of changes it covers (not just the last action).
  const rows = list.getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(list).toContainText('Created the series');

  // Expand it → every change in the session is listed underneath.
  await page.getByRole('button', { name: /Created the series/ }).click();
  await expect(list).toContainText('Added Race 1');
  await expect(list).toContainText('Recorded finishes for Race 1');
});
