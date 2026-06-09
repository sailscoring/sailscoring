import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for the History tab (#166).
 *
 * Revisions coalesce by *context* (#166 phase 2): editing the same thing folds
 * into one revision, while switching to a different kind of work starts a new
 * one. So entering several finishes for a race is a single revision, but
 * creating the series, adding the race, and entering finishes are three.
 */
test('history tab: same-context edits coalesce, different contexts split', async ({ page }) => {
  await createSeriesQuick(page, { name: 'History Spec Series' });

  // Two competitors (single adds don't create revisions of their own).
  for (const [sail, name] of [['H1', 'Boat One'], ['H2', 'Boat Two']]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sail);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // A race, then two finishes in it (same context → one revision).
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  for (const sail of ['H1', 'H2']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();

  // History tab.
  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/history$/);

  const list = page.getByTestId('revision-list');
  await expect(list).toBeVisible();

  // The two finishes coalesced into a single finishes revision…
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Recorded finishes for Race 1' }),
  ).toHaveCount(1);
  // …while creating the series and adding the race are their own revisions.
  await expect(list).toContainText('Created the series');
  await expect(list).toContainText('Added Race 1');
});
