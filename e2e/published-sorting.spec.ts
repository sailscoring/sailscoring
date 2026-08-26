import { signedInTest as test, expect } from './fixtures';
import { type Locator, type Page } from '@playwright/test';
import { addCompetitor, createSeriesQuick, settleFinish } from './helpers';

/**
 * Sortable columns on published results tables (issue #443).
 *
 * The published page carries an inline sorter: click a header to sort
 * ascending, again for descending, a third time to restore the served rank
 * order. Race-score cells sort on the number inside the cell, so a coded
 * finish ("4.0 DNF") orders by its points.
 *
 * Series: three boats, two races, one DNF.
 *   Race 1: 69 (1pt), 7 (2pts), 217236 DNF (4pts)
 *   Race 2: 69 (1pt), 7 (2pts), 217236 (3pts)
 *   Standings: 1st 69 (2), 2nd 7 (4), 3rd 217236 (7)
 * Clubs: 69 and 7 sail for Howth YC, 217236 for Alpha SC.
 */

/** The sail-number cell of every summary row, in rendered order. */
async function sailOrder(summary: Locator): Promise<string[]> {
  return summary.locator('tbody tr').evaluateAll((rows) =>
    rows.map((r) => r.querySelectorAll('td')[1]?.textContent?.trim() ?? ''),
  );
}

/** The stripe class of every summary row, in rendered order. Shading is
 *  positional, so it must read odd/even/odd/… whatever order the rows are
 *  displayed in — a sort reassigns the classes rather than letting each row
 *  carry its served shade along. */
async function stripeOrder(summary: Locator): Promise<string[]> {
  return summary.locator('tbody tr').evaluateAll((rows) =>
    rows.map((r) => (r.classList.contains('odd') ? 'odd' : r.classList.contains('even') ? 'even' : '?')),
  );
}

async function createAndPublish(page: Page): Promise<string> {
  await createSeriesQuick(page, { name: 'Published Sorting League' });
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
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  return new URL((await link.getAttribute('href')) ?? '').pathname;
}

test('published standings sort by column and restore the served order', async ({ page }) => {
  const path = await createAndPublish(page);
  await page.goto(path);

  const summary = page.locator('table.summarytable');
  await expect(summary).toBeVisible();
  await expect.poll(() => sailOrder(summary)).toEqual(['69', '7', '217236']);

  // ── Sail numbers sort numerically, not by first digit ────────────────────
  const sailHead = summary.locator('th', { hasText: 'Sail Number' });
  await sailHead.click();
  await expect(sailHead).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => sailOrder(summary)).toEqual(['7', '69', '217236']);

  // ── Second click reverses; the shading follows display order ────────────
  await sailHead.click();
  await expect(sailHead).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => sailOrder(summary)).toEqual(['217236', '69', '7']);
  await expect.poll(() => stripeOrder(summary)).toEqual(['odd', 'even', 'odd']);

  // ── Third click restores the served rank order ───────────────────────────
  await sailHead.click();
  await expect(sailHead).not.toHaveAttribute('aria-sort', /./);
  await expect.poll(() => sailOrder(summary)).toEqual(['69', '7', '217236']);
  await expect.poll(() => stripeOrder(summary)).toEqual(['odd', 'even', 'odd']);

  // ── Text columns sort alphabetically, ties keeping their rank order ─────
  const clubHead = summary.locator('th', { hasText: 'Club' });
  await clubHead.click();
  await expect(clubHead).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => sailOrder(summary)).toEqual(['217236', '69', '7']);

  // ── A race column sorts on the score, reading through "4.0 DNF" ─────────
  // The R1 header text is a link to the race's own table; clicking the header
  // element itself (outside the link) sorts. Descending puts the DNF first.
  const r1Head = summary.locator('th').filter({ hasText: /^R1$/ });
  await r1Head.evaluate((el) => (el as HTMLElement).click());
  await expect(r1Head).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => sailOrder(summary)).toEqual(['69', '7', '217236']);
  await r1Head.evaluate((el) => (el as HTMLElement).click());
  await expect(r1Head).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => sailOrder(summary)).toEqual(['217236', '7', '69']);

  // ── The race header's own link still navigates ───────────────────────────
  await summary.locator('th a', { hasText: 'R1' }).click();
  await expect(page).toHaveURL(/#r1$/);
});
