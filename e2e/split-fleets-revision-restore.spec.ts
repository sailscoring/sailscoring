import { signedInTest as test, expect } from './fixtures';
import { createSplitFleetSeries, enableFeatures } from './helpers';

/**
 * Restoring a version on a split-fleet championship (#510).
 *
 * The series layout stays mounted across the tab clicks below, and it is the
 * layout that observes the split-fleet query. So the Split Fleets tab reached
 * after a restore reads the cache the restore left behind, not a fresh one:
 * unless the revert refreshes that cache, the scorer is shown an assignment
 * the restore has already discarded server-side.
 */
test('split fleets: restoring a version drops the assignment it undid', async ({
  page,
  signedInEmail,
}) => {
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSplitFleetSeries(page, { name: 'Restore Championship', fleetCount: 2 });

  // Seed the entry list. The demo button reloads the page; wait for it to go.
  await page.getByRole('button', { name: /Add \d+ demo competitors/ }).click();
  await expect(page.getByRole('button', { name: /Add \d+ demo competitors/ })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Assign Preliminary fleets' })).toBeVisible();

  // Pin the un-assigned state as a named version.
  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/history$/);
  await page.getByRole('button', { name: 'Name this version' }).click();
  const nameDialog = page.getByRole('dialog', { name: 'Name this version' });
  await nameDialog.getByPlaceholder('e.g. Before protest hearing').fill('Before Round 1');
  await nameDialog.getByRole('button', { name: 'Save checkpoint' }).click();
  await expect(nameDialog).toBeHidden();

  // Assign Round 1.
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await page.getByRole('button', { name: 'Assign Preliminary fleets' }).click();
  await expect(page.getByRole('dialog')).toContainText('Make the initial assignment');
  await page.getByRole('button', { name: /Commit Round 1/ }).click();
  await expect(page.getByText('Round 1 · Q1 onward')).toBeVisible();

  // Pin the assigned state too. The newest version is the current state, so
  // the one to restore to has to have a version after it.
  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Name this version' }).click();
  const afterDialog = page.getByRole('dialog', { name: 'Name this version' });
  await afterDialog.getByPlaceholder('e.g. Before protest hearing').fill('After Round 1');
  await afterDialog.getByRole('button', { name: 'Save checkpoint' }).click();
  await expect(afterDialog).toBeHidden();

  // Restore the version taken before the assignment.
  const list = page.getByTestId('revision-list');
  await list.getByRole('listitem').filter({ hasText: 'Before Round 1' })
    .getByRole('button', { name: 'Restore' }).click();
  const restoreDialog = page.getByRole('dialog', { name: 'Restore this version?' });
  await restoreDialog.getByRole('button', { name: 'Restore' }).click();
  await expect(list).toContainText('Revert');

  // The round is gone, and the tab asks for the assignment again.
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await expect(page.getByRole('button', { name: 'Assign Preliminary fleets' })).toBeVisible();
  await expect(page.getByText('Round 1 · Q1 onward')).toHaveCount(0);
});
