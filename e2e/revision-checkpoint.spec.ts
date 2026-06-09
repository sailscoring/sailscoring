import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for named checkpoints (#166, revision history phase 6).
 *
 * A scorer pins the current state as a named version; unlike automatic
 * revisions it never coalesces, so it appears as its own entry headlined by the
 * given name and marked as a checkpoint.
 */
test('history tab: name a version creates a pinned checkpoint', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Checkpoint Spec Series' });

  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/history$/);

  const list = page.getByTestId('revision-list');
  await expect(list).toBeVisible();

  // Name the current version.
  await page.getByRole('button', { name: 'Name this version' }).click();
  const dialog = page.getByRole('dialog', { name: 'Name this version' });
  await dialog.getByPlaceholder('e.g. Before protest hearing').fill('Before protest hearing');
  await dialog.getByRole('button', { name: 'Save checkpoint' }).click();
  await expect(dialog).toBeHidden();

  // It appears as its own pinned, labelled entry.
  await expect(list).toContainText('Before protest hearing');
  const checkpointRow = list.getByRole('listitem').filter({ hasText: 'Before protest hearing' });
  await expect(checkpointRow).toContainText('Checkpoint');
});
