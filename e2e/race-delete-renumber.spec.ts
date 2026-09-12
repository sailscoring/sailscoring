import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * Deleting a race closes the gap it would otherwise leave: the survivors
 * renumber 1..n, keeping their identity. A series whose numbering carried a
 * deletion used to be stuck with it — and the next added race then collided
 * with a number the gap had left in place, so Add race silently did nothing.
 */
test('deleting a race renumbers the survivors, and adding still works after', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Delete Renumber Series' });

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  const rows = page.getByTestId('race-row');
  // Named so the assertions can tell a renumbered race from a reassigned one.
  for (const [number, name] of [[1, 'Alpha'], [2, 'Bravo'], [3, 'Charlie']] as const) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(rows).toHaveCount(number);
    await page.getByText(`Race ${number}`, { exact: false }).first().click();
    await page.getByRole('button', { name: `Edit name for Race ${number}` }).click();
    const input = page.getByLabel(`Name for Race ${number}`);
    await input.fill(name);
    await input.press('Enter');
    // Wait for the save to land before navigating away, or the navigation
    // can abort the in-flight save.
    await expect(
      page.getByRole('button', { name: `Edit name for Race ${number}` }),
    ).toContainText(name);
    await page.getByRole('link', { name: 'Races' }).click();
    await expect(page).toHaveURL(/\/races$/);
  }

  // Drop the first race: Bravo and Charlie move up to 1 and 2.
  await rows.filter({ hasText: 'Alpha' }).getByLabel(/^Delete Race/).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(rows).toHaveCount(2);
  await expect(async () => {
    const order = (await rows.allTextContents()).map((t) => t.trim());
    expect(order[0]).toMatch(/Race 1.*Bravo/);
    expect(order[1]).toMatch(/Race 2.*Charlie/);
  }).toPass();

  // The gap is gone on the server too, so the next race appends as Race 3
  // rather than colliding with a number the deletion left behind.
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(rows).toHaveCount(3);

  await page.reload();
  await expect(rows).toHaveCount(3);
  const reloaded = (await rows.allTextContents()).map((t) => t.trim());
  expect(reloaded[0]).toMatch(/Race 1.*Bravo/);
  expect(reloaded[1]).toMatch(/Race 2.*Charlie/);
  expect(reloaded[2]).toMatch(/Race 3/);
});
