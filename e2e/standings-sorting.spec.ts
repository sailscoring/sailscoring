import { signedInTest as test, expect } from './fixtures';
import { type Page } from '@playwright/test';
import { addCompetitor, createSeriesQuick, settleFinish } from './helpers';

/**
 * Sortable columns on the Standings tab (issue #444) — the Competitors tab's
 * click-to-sort machinery on the standings table, with race columns sorting
 * through their header menu (whose click is already taken by the race menu).
 *
 * Series: three boats, two races, one DNF.
 *   Race 1: 69 (1pt), 7 (2pts), 217236 DNF (4pts)
 *   Race 2: 69 (1pt), 7 (2pts), 217236 (3pts)
 *   Standings: 1st 69 (2), 2nd 7 (4), 3rd 217236 (7)
 */

/** The sail-number cell of every standings row, in rendered order. */
async function sailOrder(page: Page): Promise<string[]> {
  return page.locator('tbody tr').evaluateAll((rows) =>
    rows.map((r) => r.querySelectorAll('td')[1]?.textContent?.trim() ?? ''),
  );
}

test('standings sort by column, and by a race through its header menu', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Standings Sorting Series' });
  await addCompetitor(page, { sailNumber: '69', name: 'Middle Number', club: 'Howth YC' });
  await addCompetitor(page, { sailNumber: '7', name: 'Short Number', club: 'Howth YC' });
  await addCompetitor(page, { sailNumber: '217236', name: 'Long Number', club: 'Alpha SC' });

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 2')).toBeVisible();

  await page.getByText('Race 1').click();
  for (const sail of ['69', '7']) {
    await page.getByLabel('Sail number').fill(sail);
    await settleFinish(page, () => page.getByRole('button', { name: 'Add', exact: true }).click());
  }
  await page.getByTestId('non-finisher-217236').getByRole('combobox').click();
  await settleFinish(page, () => page.getByRole('option', { name: 'DNF' }).click());
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByText('Race 2').click();
  for (const sail of ['69', '7', '217236']) {
    await page.getByLabel('Sail number').fill(sail);
    await settleFinish(page, () => page.getByRole('button', { name: 'Add', exact: true }).click());
  }

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect.poll(() => sailOrder(page)).toEqual(['69', '7', '217236']);

  // ── Sail numbers sort numerically; the Rank column keeps the series rank ─
  const sail = page.getByRole('columnheader', { name: 'Sail no.' });
  await sail.getByRole('button').click();
  await expect(sail).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => sailOrder(page)).toEqual(['7', '69', '217236']);
  await expect(page.locator('tbody tr').first().locator('td').first()).toHaveText('2');

  // ── Second click reverses, third restores the ranking ────────────────────
  await sail.getByRole('button').click();
  await expect(sail).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => sailOrder(page)).toEqual(['217236', '69', '7']);
  await sail.getByRole('button').click();
  await expect(sail).toHaveAttribute('aria-sort', 'none');
  await expect.poll(() => sailOrder(page)).toEqual(['69', '7', '217236']);

  // ── Text columns sort too ────────────────────────────────────────────────
  const club = page.getByRole('columnheader', { name: 'Club' });
  await club.getByRole('button').click();
  await expect.poll(() => sailOrder(page)).toEqual(['217236', '69', '7']);
  await club.getByRole('button').click();
  await club.getByRole('button').click();

  // ── A race column sorts through its header menu (a single-fleet series
  //    has no exclusion item there); descending puts the DNF (4pts) first ───
  const r1 = page.getByRole('columnheader', { name: 'R1' });
  await r1.getByRole('button').click();
  await expect(page.getByRole('menu')).toContainText('Race 1');
  await page.getByRole('menuitemcheckbox', { name: 'Sort high to low' }).click();
  await expect(r1).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => sailOrder(page)).toEqual(['217236', '7', '69']);

  // ── Picking the active direction again clears the sort ───────────────────
  await r1.getByRole('button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Sort high to low' }).click();
  await expect(r1).toHaveAttribute('aria-sort', 'none');
  await expect.poll(() => sailOrder(page)).toEqual(['69', '7', '217236']);
});
