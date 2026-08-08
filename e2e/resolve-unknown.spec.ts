import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick } from './helpers';

/**
 * The resolve-an-unknown-sail dialog: narrowing a long candidate list with the
 * filter box, and resolving the highlighted row from the keyboard (#383).
 */

/** Seed a series whose only finisher is 1001, with an unknown 9999 recorded
 *  and the resolve dialog open. */
async function openResolveDialog(page: import('@playwright/test').Page): Promise<void> {
  await createSeriesQuick(page, { name: 'Resolve Filter Series' });
  await addCompetitor(page, { sailNumber: '1001', name: 'Alice Adams' });
  await addCompetitor(page, { sailNumber: '1002', name: 'Bob Byrne' });
  await addCompetitor(page, { sailNumber: '1003', name: 'Cara Casey' });
  await addCompetitor(page, { sailNumber: '1004', name: 'Dan Doyle' });

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  await page.getByLabel('Sail number').fill('1001');
  await page.getByRole('button', { name: 'Add' }).click();

  await page.getByLabel('Sail number').fill('9999');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Record as unknown' }).click();
  await expect(page.getByText('Unknown — not registered')).toBeVisible();

  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByText('Resolve sail 9999')).toBeVisible();
}

test('the resolve dialog filters candidates and resolves the highlighted one', async ({ page }) => {
  await openResolveDialog(page);
  const dialog = page.getByRole('dialog');

  // All three unfinished boats to start (1001 already finished, so it is not
  // offered).
  await expect(dialog.getByRole('button', { name: /1002/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /1003/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /1001/ })).toHaveCount(0);

  // Filtering by name narrows to one — the box has focus on open, so the
  // scorer can type straight away.
  await page.keyboard.type('casey');
  await expect(dialog.getByRole('button', { name: /1003/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /1002/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /1004/ })).toHaveCount(0);

  // A filter matching nothing says so rather than showing an empty box.
  await page.getByLabel('Filter competitors').fill('zzzz');
  await expect(dialog.getByText('No competitor matches that.')).toBeVisible();

  // Enter takes the highlighted row — the first match after filtering.
  await page.getByLabel('Filter competitors').fill('1003');
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();

  await expect(page.getByText('Unknown — not registered')).not.toBeVisible();
  await expect(page.getByText('Cara Casey')).toBeVisible();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
});

test('arrow keys move the resolve highlight', async ({ page }) => {
  await openResolveDialog(page);
  const dialog = page.getByRole('dialog');

  // Down once from the first match (1002) lands on 1003.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Cara Casey')).toBeVisible();
});
