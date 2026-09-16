import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick } from './helpers';

/**
 * E2E for the Select all / Clear all toggle on the Add start dialog's fleet
 * list (#596): a club night where every class starts together shouldn't cost
 * one click per class, and fleets another start group already claimed are
 * stepped over rather than ticked into a validation error.
 */

test('select all ticks every offered fleet, skipping ones another start claims', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Select All Starts' });
  await createFleets(page, ['Blue', 'Red', 'Green']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  await addCompetitor(page, { sailNumber: 'BLU1', name: 'Blue One', fleet: 'Blue' });
  await addCompetitor(page, { sailNumber: 'RED1', name: 'Red One', fleet: 'Red' });
  await addCompetitor(page, { sailNumber: 'GRN1', name: 'Green One', fleet: 'Green' });

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // ── 1. Select all, then Clear all, round-trips the whole list ───────────
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Add start' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Select all' }).click();
  for (const name of ['Blue', 'Red', 'Green']) {
    await expect(dialog.getByRole('checkbox', { name })).toBeChecked();
  }
  await dialog.getByRole('button', { name: 'Clear all' }).click();
  for (const name of ['Blue', 'Red', 'Green']) {
    await expect(dialog.getByRole('checkbox', { name })).not.toBeChecked();
  }

  // ── 2. Select all saves a start carrying every fleet ────────────────────
  await dialog.getByRole('button', { name: 'Select all' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Blue, Red, Green')).toBeVisible();

  // ── 3. A second start: Blue only, so the first start has to give it up ──
  await page.getByRole('button', { name: 'Edit start' }).click();
  await dialog.getByRole('button', { name: 'Clear all' }).click();
  await dialog.getByRole('checkbox', { name: 'Blue' }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // ── 4. Select all in the new start skips Blue, which start 1 claims ─────
  await page.getByRole('button', { name: 'Add start' }).click();
  await expect(dialog.getByRole('heading', { name: 'Add start' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Select all' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Blue' })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Red' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Green' })).toBeChecked();

  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Red, Green')).toBeVisible();
});
