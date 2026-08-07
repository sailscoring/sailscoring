import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick } from './helpers';

/** The sail-number cell of every row, in the order the table renders them. */
async function sailOrder(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('tbody tr').evaluateAll((rows) =>
    rows.map((r) => r.querySelectorAll('td')[1]?.textContent?.trim() ?? ''),
  );
}

test('competitor list sorts by column, and stacks up to three of them', async ({ page }) => {
  // ── 1. Sail numbers of differing length, across two clubs ────────────────
  await createSeriesQuick(page, { name: 'Sorting Series' });
  await addCompetitor(page, { sailNumber: '217236', name: 'Long Number', club: 'Howth YC' });
  await addCompetitor(page, { sailNumber: '7', name: 'Short Number', club: 'Howth YC' });
  await addCompetitor(page, { sailNumber: '69', name: 'Middle Number', club: 'Dun Laoghaire' });
  await expect(page.getByText('3 competitors')).toBeVisible();

  // ── 2. The default order is the number itself, not its first digit ───────
  await expect.poll(() => sailOrder(page)).toEqual(['7', '69', '217236']);

  const club = page.getByRole('columnheader', { name: 'Club' });
  const sail = page.getByRole('columnheader', { name: 'Sail no.' });
  await expect(club).toHaveAttribute('aria-sort', 'none');

  // ── 3. Click sorts ascending; ties keep their sail-number order ──────────
  await club.getByRole('button').click();
  await expect(club).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => sailOrder(page)).toEqual(['69', '7', '217236']);

  // ── 4. Clicking again reverses it ────────────────────────────────────────
  await club.getByRole('button').click();
  await expect(club).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => sailOrder(page)).toEqual(['7', '217236', '69']);

  // ── 5. A third click clears the sort, back to the default order ──────────
  await club.getByRole('button').click();
  await expect(club).toHaveAttribute('aria-sort', 'none');
  await expect.poll(() => sailOrder(page)).toEqual(['7', '69', '217236']);

  // ── 6. Shift-click stacks a second key: club, then sail descending ───────
  await club.getByRole('button').click();
  await sail.getByRole('button').click({ modifiers: ['Shift'] });
  await sail.getByRole('button').click({ modifiers: ['Shift'] });
  await expect(club).toHaveAttribute('aria-sort', 'ascending');
  await expect(sail).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => sailOrder(page)).toEqual(['69', '217236', '7']);

  // ── 7. A plain click drops the stack and sorts by that column alone ──────
  await sail.getByRole('button').click();
  await expect(club).toHaveAttribute('aria-sort', 'none');
  await expect.poll(() => sailOrder(page)).toEqual(['7', '69', '217236']);
});

test('sorting composes with the filter and leaves the selection alone', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Sort And Filter Series' });
  await addCompetitor(page, { sailNumber: '101', name: 'Blue Heron', club: 'Old YC' });
  await addCompetitor(page, { sailNumber: '9', name: 'Blue Jay', club: 'Howth YC' });
  await addCompetitor(page, { sailNumber: '55', name: 'Red Rover', club: 'Old YC' });
  await expect(page.getByText('3 competitors')).toBeVisible();

  // Select a boat, then sort — the selection is by id, so it survives.
  await page.getByRole('row', { name: /Red Rover/ }).getByRole('checkbox').check();
  await expect(page.getByText('1 selected')).toBeVisible();

  // Howth YC first; the two Old YC boats keep their sail-number order.
  await page.getByRole('columnheader', { name: 'Club' }).getByRole('button').click();
  await expect.poll(() => sailOrder(page)).toEqual(['9', '55', '101']);
  await expect(page.getByText('1 selected')).toBeVisible();

  // Filtering narrows the sorted list rather than resetting it.
  await page.getByLabel('Filter competitors').fill('blue');
  await expect(page.getByText('2 of 3 competitors')).toBeVisible();
  await expect.poll(() => sailOrder(page)).toEqual(['9', '101']);
});
