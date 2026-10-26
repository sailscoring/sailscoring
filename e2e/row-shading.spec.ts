import type { Locator } from '@playwright/test';
import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * Alternate-row shading on the lists a scorer checks row by row: the finishing
 * order, the non-finishers, and the competitors table. Every other row is
 * tinted, and a hovered row takes a colour distinct from both.
 */

const boats = [
  { sailNumber: 'A1', name: 'Alice' },
  { sailNumber: 'B2', name: 'Bob' },
  { sailNumber: 'C3', name: 'Carol' },
  { sailNumber: 'D4', name: 'Dave' },
  { sailNumber: 'E5', name: 'Eve' },
  { sailNumber: 'F6', name: 'Frank' },
];

const background = (row: Locator) =>
  row.evaluate((el) => getComputedStyle(el).backgroundColor);

/** Rows 1 and 3 share a tint, row 2 is plain, and hovering row 2 gives it a third colour. */
async function expectStriped(rows: Locator) {
  const [first, second, third] = [rows.nth(0), rows.nth(1), rows.nth(2)];
  // Park the pointer away from the rows so none of them is hovered.
  await first.page().mouse.move(0, 0);
  await expect.poll(() => background(second)).toBe('rgba(0, 0, 0, 0)');
  const shaded = await background(first);
  expect(shaded).not.toBe('rgba(0, 0, 0, 0)');
  expect(await background(third)).toBe(shaded);

  await second.hover();
  await expect.poll(() => background(second)).not.toBe('rgba(0, 0, 0, 0)');
  // The hover colour is a fixed endpoint once the transition settles; it must
  // not be the same tint as a shaded row.
  await expect.poll(() => background(second)).not.toBe(shaded);
}

test('alternate rows are shaded on the competitors table and finish sheet', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Row Shading 2026', venue: 'HYC' });

  for (const b of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(b.sailNumber);
    await page.getByLabel('Competitor name').fill(b.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sailNumber })).toBeVisible();
  }
  await expectStriped(page.locator('tbody tr'));

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  for (const sail of ['A1', 'B2', 'C3']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: sail })).toBeVisible();
  }
  await expectStriped(page.locator('li[data-entry-key]'));
  await expectStriped(page.locator('[data-testid^="non-finisher-"]'));
});
